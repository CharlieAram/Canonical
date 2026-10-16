import ts from 'typescript';
import { LayerDiffSchema, type ExtractedNode, type LayerDiff, type LayerSnapshot, type RevisionSource, type SourceCitation } from '@canonical/contracts';

// AST parsing and printing only: no imports, repository commands or code execution.
// https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
type Callable = ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
type Binding = ts.VariableDeclaration | ts.ParameterDeclaration;
const isCallable = (node: ts.Node): node is Callable => ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

class SourceModel {
  readonly file: ts.SourceFile;
  readonly callables: Array<{ node: Callable; scope: string }> = [];
  readonly variables: Array<{ node: ts.VariableDeclaration; scope: string }> = [];
  readonly scopes = new Map<ts.Node, string>();
  private bindings = new Map<ts.Node, Map<string, Binding>>();

  constructor(readonly revision: RevisionSource) {
    if (!/^[a-f0-9]{40}$/.test(revision.sha)) throw new Error('Static extraction requires an immutable commit SHA');
    this.file = ts.createSourceFile(revision.path, revision.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const diagnostics = ts.transpileModule(revision.content, {
      fileName: revision.path, compilerOptions: { target: ts.ScriptTarget.ES2022, allowJs: true }, reportDiagnostics: true,
    }).diagnostics ?? [];
    if (diagnostics.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error('Cannot extract layers from syntactically invalid source');
    const bind = (scope: ts.Node, binding: Binding) => {
      if (!ts.isIdentifier(binding.name)) return;
      const names = this.bindings.get(scope) ?? new Map<string, Binding>();
      names.set(binding.name.text, binding);
      this.bindings.set(scope, names);
    };
    const visit = (node: ts.Node, scope: string) => {
      // Anonymous callbacks are deliberately not expanded into independent flows.
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
      if (isCallable(node)) {
        const name = node.name ? this.text(node.name) : 'default';
        scope = scope === 'module' ? name : `${scope}.${name}`;
        this.callables.push({ node, scope });
        if (node.body) node.parameters.forEach(parameter => bind(node.body!, parameter));
      }
      this.scopes.set(node, scope);
      if (ts.isVariableDeclaration(node)) {
        this.variables.push({ node, scope });
        let block: ts.Node | undefined = node.parent;
        while (block && !ts.isBlock(block) && !ts.isSourceFile(block)) block = block.parent;
        if (block) bind(block, node);
      }
      ts.forEachChild(node, child => visit(child, scope));
    };
    visit(this.file, 'module');
  }

  text(node?: ts.Node): string {
    return node ? printer.printNode(ts.EmitHint.Unspecified, node, this.file).trim() : '';
  }

  citation(node: ts.Node): SourceCitation {
    const start = node.getStart(this.file);
    const end = node.getEnd();
    return {
      path: this.revision.path, sha: this.revision.sha,
      startLine: this.file.getLineAndCharacterOfPosition(start).line + 1,
      endLine: this.file.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1,
      excerpt: this.revision.content.slice(start, end),
    };
  }

  binding(identifier: ts.Identifier): Binding | undefined {
    let owner: ts.Node | undefined = identifier;
    while (owner) {
      const found = this.bindings.get(owner)?.get(identifier.text);
      if (found) return found;
      owner = owner.parent;
    }
    return undefined;
  }

  resolveKey(expression: ts.Expression): { expression: ts.Expression; inputs: string[]; citations: SourceCitation[] } {
    const seen = new Set<ts.Node>();
    const citations: SourceCitation[] = [];
    const resolve = (value: ts.Expression): ts.Expression => {
      if (!ts.isIdentifier(value)) return value;
      const binding = this.binding(value);
      if (!binding || !ts.isVariableDeclaration(binding) || !binding.initializer || seen.has(binding) ||
          !ts.isVariableDeclarationList(binding.parent) || !(binding.parent.flags & ts.NodeFlags.Const)) return value;
      seen.add(binding);
      citations.push(this.citation(binding));
      return resolve(binding.initializer);
    };
    const resolved = resolve(expression);
    const inputs = new Set<string>();
    const collect = (node: ts.Node) => {
      if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        if (this.binding(node)) inputs.add(node.text);
      }
      ts.forEachChild(node, collect);
    };
    collect(resolved);
    return { expression: resolved, inputs: [...inputs].sort(), citations };
  }

  calls(node: ts.Node, includeNamedFunctions = false): ts.CallExpression[] {
    const calls: ts.CallExpression[] = [];
    const visit = (child: ts.Node) => {
      if (isCallable(child) && child !== node && !includeNamedFunctions) return;
      if (ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return;
      if (ts.isCallExpression(child)) calls.push(child);
      ts.forEachChild(child, visit);
    };
    visit(node);
    return calls;
  }
}

function snapshotBuilder() {
  const nodes = new Map<string, ExtractedNode>();
  const edges = new Map<string, LayerSnapshot['edges'][number]>();
  return {
    nodes,
    add(node: ExtractedNode) { nodes.set(node.id, node); },
    edge(source: string, target: string, label: string) {
      const id = `${source}->${target}:${label}`;
      edges.set(id, { id, source, target, label });
    },
    result(): LayerSnapshot { return { nodes: [...nodes.values()], edges: [...edges.values()] }; },
  };
}

function objectSnapshot(revision: RevisionSource): LayerSnapshot {
  const model = new SourceModel(revision);
  const graph = snapshotBuilder();
  const bindingIds = new Map<Binding, string>();
  for (const { node, scope } of model.callables) {
    const id = `object:${scope}`;
    const kind = ts.isGetAccessorDeclaration(node) ? 'getter' : ts.isMethodDeclaration(node) ? 'method' : 'function';
    graph.add({ id, label: scope.split('.').at(-1)!, kind,
      description: `${kind === 'getter' ? 'Getter' : 'Callable'} declared in ${revision.path}.`,
      properties: { parameters: node.parameters.map(parameter => model.text(parameter)).join(', '),
        async: String(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false) },
      citations: [model.citation(node)],
    });
    for (const parameter of node.parameters) {
      const name = model.text(parameter.name);
      const parameterId = `${id}:parameter:${name}`;
      bindingIds.set(parameter, parameterId);
      graph.add({ id: parameterId, label: name, kind: 'parameter', description: `Input to ${scope}.`,
        properties: { ...(parameter.initializer ? { default: model.text(parameter.initializer) } : {}) }, citations: [model.citation(parameter)] });
      graph.edge(id, parameterId, 'accepts');
    }
  }
  for (const { node, scope } of model.variables) {
    const name = model.text(node.name);
    const id = `object:${scope}:state:${name}`;
    bindingIds.set(node, id);
    const properties: Record<string, string> = {
      declaration: ts.isVariableDeclarationList(node.parent) && node.parent.flags & ts.NodeFlags.Const ? 'const' : 'let',
      initializer: model.text(node.initializer),
    };
    const citations = [model.citation(node)];
    if (node.initializer && ts.isNewExpression(node.initializer)) properties.collection = model.text(node.initializer.expression);
    if (properties.collection === 'Map') {
      const keys = new Set<string>();
      const inputs = new Set<string>();
      const operations = new Set<string>();
      for (const call of model.calls(model.file, true)) {
        if (!ts.isPropertyAccessExpression(call.expression) || !ts.isIdentifier(call.expression.expression) ||
            model.binding(call.expression.expression) !== node || !['get', 'set', 'has', 'delete'].includes(call.expression.name.text) || !call.arguments[0]) continue;
        const key = model.resolveKey(call.arguments[0]);
        keys.add(model.text(key.expression)); key.inputs.forEach(input => inputs.add(input));
        operations.add(call.expression.name.text);
        citations.push(model.citation(call), ...key.citations);
      }
      properties.keyExpressions = [...keys].sort().join(' | ');
      properties.keyInputs = [...inputs].sort().join(', ');
      properties.operations = [...operations].sort().join(', ');
    }
    graph.add({ id, label: name, kind: properties.collection === 'Map' ? 'collection' : 'state',
      description: properties.collection === 'Map' ? `Declared Map ${name}; observed key inputs: ${properties.keyInputs || 'none found'}.` : `Declared ${properties.declaration} binding in ${scope}.`,
      properties, citations });
    if (graph.nodes.has(`object:${scope}`)) graph.edge(`object:${scope}`, id, 'declares');
  }
  const visit = (node: ts.Node) => {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      const scope = model.scopes.get(node) ?? 'module';
      const id = `object:${scope}:result`;
      const fields = node.expression.properties.map(property => property.name ? model.text(property.name) : 'spread');
      graph.add({ id, label: `${scope.split('.').at(-1)} result`, kind: 'object',
        description: 'Object literal returned by this function.', properties: { fields: fields.join(', ') }, citations: [model.citation(node.expression)] });
      graph.edge(`object:${scope}`, id, 'returns');
      for (const property of node.expression.properties) {
        if (!property.name) continue;
        const name = model.text(property.name);
        if (isCallable(property)) graph.edge(id, `object:${scope}.${name}`, 'exposes');
        else {
          const fieldId = `${id}:field:${name}`;
          graph.add({ id: fieldId, label: name, kind: 'field', description: `Returned field on ${scope}.`,
            properties: { value: ts.isPropertyAssignment(property) ? model.text(property.initializer) : name }, citations: [model.citation(property)] });
          graph.edge(id, fieldId, 'contains');
        }
      }
    }
    if (ts.isIdentifier(node)) {
      const target = bindingIds.get(model.binding(node)!);
      const owner = `object:${model.scopes.get(node)}`;
      if (target && graph.nodes.has(owner) && target !== owner &&
          !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) &&
          !(ts.isParameter(node.parent) && node.parent.name === node) &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) graph.edge(owner, target, 'uses');
    }
    ts.forEachChild(node, visit);
  };
  visit(model.file);
  return graph.result();
}

type FlowExit = { id: string; label: string };
function logicSnapshot(revision: RevisionSource): LayerSnapshot {
  const model = new SourceModel(revision);
  const graph = snapshotBuilder();
  for (const { node: callable, scope } of model.callables) {
    if (!callable.body) continue;
    const occurrences = new Map<string, number>();
    const add = (anchor: string, label: string, kind: string, syntax: ts.Node, properties: Record<string, string>, incoming: FlowExit[]) => {
      const ordinal = occurrences.get(anchor) ?? 0;
      occurrences.set(anchor, ordinal + 1);
      const id = `logic:${scope}:${anchor}${ordinal ? `:${ordinal + 1}` : ''}`;
      const calls = model.calls(syntax);
      const citations = [model.citation(syntax)];
      const keyExpressions = new Set<string>();
      for (const call of calls) {
        if (ts.isPropertyAccessExpression(call.expression) && ['has', 'get', 'set', 'delete'].includes(call.expression.name.text) && call.arguments[0]) {
          const key = model.resolveKey(call.arguments[0]);
          keyExpressions.add(model.text(key.expression)); citations.push(...key.citations);
        }
      }
      graph.add({ id, label, kind, description: `${kind} in ${scope}; static source structure.`,
        properties: { ...properties, ...(calls.length ? { calls: [...new Set(calls.map(call => model.text(call.expression)))].join(', ') } : {}),
          ...(keyExpressions.size ? { keyExpressions: [...keyExpressions].sort().join(' | ') } : {}) }, citations });
      incoming.forEach(previous => graph.edge(previous.id, id, previous.label));
      return id;
    };
    const anchor = (syntax: ts.Node) => {
      const calls = model.calls(syntax);
      if (calls[0]) return model.text(calls[0].expression);
      const identifiers: string[] = [];
      const collect = (node: ts.Node) => { if (ts.isIdentifier(node)) identifiers.push(node.text); ts.forEachChild(node, collect); };
      collect(syntax);
      return identifiers[0] ?? ts.SyntaxKind[syntax.kind];
    };
    const walk = (statement: ts.Statement, incoming: FlowExit[]): FlowExit[] => {
      if (ts.isBlock(statement)) return statements(statement.statements, incoming);
      if (ts.isFunctionDeclaration(statement)) return incoming;
      if (ts.isIfStatement(statement)) {
        const expression = model.text(statement.expression);
        const id = add(`branch:${anchor(statement.expression)}`, `If ${expression}`, 'branch', statement.expression, { condition: expression }, incoming);
        return [...walk(statement.thenStatement, [{ id, label: 'true' }]),
          ...(statement.elseStatement ? walk(statement.elseStatement, [{ id, label: 'false' }]) : [{ id, label: 'false' }])];
      }
      if (ts.isVariableStatement(statement)) {
        let exits = incoming;
        for (const declaration of statement.declarationList.declarations) {
          const name = model.text(declaration.name);
          if (declaration.initializer && ts.isConditionalExpression(declaration.initializer)) {
            const condition = declaration.initializer;
            const branch = add(`branch:assign:${name}`, `Choose ${name}`, 'branch', condition.condition, { condition: model.text(condition.condition) }, exits);
            const yes = add(`value:${name}:true`, `${name}: ${model.text(condition.whenTrue)}`, 'value', condition.whenTrue, { value: model.text(condition.whenTrue) }, [{ id: branch, label: 'true' }]);
            const no = add(`value:${name}:false`, `${name}: ${model.text(condition.whenFalse)}`, 'value', condition.whenFalse, { value: model.text(condition.whenFalse) }, [{ id: branch, label: 'false' }]);
            exits = [{ id: yes, label: 'assign' }, { id: no, label: 'assign' }];
          }
          const id = add(`assign:${name}`, `Set ${name}`, 'assignment', declaration, { target: name, value: model.text(declaration.initializer) }, exits);
          exits = [{ id, label: 'next' }];
        }
        return exits;
      }
      if (ts.isReturnStatement(statement)) {
        const returnedObject = statement.expression && ts.isObjectLiteralExpression(statement.expression);
        const value = returnedObject ? `{ ${statement.expression!.properties.map(property => property.name ? model.text(property.name) : 'spread').join(', ')} }` : model.text(statement.expression);
        add(`return:${returnedObject ? 'object' : statement.expression ? anchor(statement.expression) : 'void'}`, returnedObject ? 'Return service object' : `Return ${value}`, 'return', statement, { value }, incoming);
        return [];
      }
      if (ts.isThrowStatement(statement)) {
        add(`throw:${model.text(statement.expression)}`, 'Reject request', 'throw', statement, { error: model.text(statement.expression) }, incoming);
        return [];
      }
      const expression = ts.isExpressionStatement(statement) ? statement.expression : statement;
      const kind = ts.isExpressionStatement(statement) ? ts.isAwaitExpression(expression) ? 'await' : model.calls(expression).length ? 'call' : 'operation' : 'unsupported';
      const id = add(`${kind}:${anchor(expression)}`, model.text(expression), kind, statement, { expression: model.text(expression) }, incoming);
      return [{ id, label: 'next' }];
    };
    const statements = (items: ts.NodeArray<ts.Statement>, incoming: FlowExit[]) => {
      let exits = incoming;
      for (const statement of items) {
        if (!exits.length) break; // Do not claim an executable path after a terminal statement.
        exits = walk(statement, exits);
      }
      return exits;
    };
    const entry = add('entry', scope, 'entry', callable.name ?? callable, { parameters: callable.parameters.map(parameter => model.text(parameter)).join(', ') }, []);
    statements(callable.body.statements, [{ id: entry, label: 'next' }]);
  }
  return graph.result();
}

function diff(before: LayerSnapshot, after: LayerSnapshot, layer: string): LayerDiff {
  const changes: LayerDiff['changes'] = [];
  for (const entity of ['node', 'edge'] as const) {
    const left = new Map((entity === 'node' ? before.nodes : before.edges).map(item => [item.id, item]));
    const right = new Map((entity === 'node' ? after.nodes : after.edges).map(item => [item.id, item]));
    const semantic = (value: object) => JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'citations')));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id), b = right.get(id);
      changes.push({ id, entity, change: !a ? 'added' : !b ? 'removed' : semantic(a) === semantic(b) ? 'unchanged' : 'modified' });
    }
  }
  const count = (change: string) => changes.filter(item => item.entity === 'node' && item.change === change).length;
  return LayerDiffSchema.parse({ provenance: 'static-analysis', before, after, changes,
    summary: `${layer}: ${count('added')} added, ${count('modified')} modified, ${count('removed')} removed source nodes.`,
    limitations: [
      'Single-file JavaScript AST extraction; descriptions are structural source facts, not inferred business intent or executed outcomes.',
      'Named functions and returned object methods are modeled. Anonymous callbacks, dynamic dispatch, imports and cross-file types are not expanded.',
      'Map key aliases resolve direct const initializers; reassignment, mutation, destructuring and complex alias/dataflow analysis are not proven.',
      'Flow models sequential statements, if/else, ternary assignments, return and throw. Other control constructs are marked unsupported.',
      'Stable IDs use declaration names and operation anchors; repeated equivalent operations use occurrence order rather than source line numbers.',
    ],
  });
}

export function extractObjects(before: RevisionSource, after: RevisionSource): LayerDiff {
  return diff(objectSnapshot(before), objectSnapshot(after), 'Object layer');
}

export function extractLogic(before: RevisionSource, after: RevisionSource): LayerDiff {
  return diff(logicSnapshot(before), logicSnapshot(after), 'Logic layer');
}
