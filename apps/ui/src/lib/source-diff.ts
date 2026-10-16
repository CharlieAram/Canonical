import type { ExtractedNode, SourceCitation } from '@canonical/contracts';

export interface DiffLine {
  kind: 'add' | 'remove' | 'context';
  text: string;
  oldLine?: number;
  newLine?: number;
  noNewline?: boolean;
}
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
  omittedBefore: number;
}
export interface SourceFileDiff {
  path: string;
  before?: SourceCitation;
  after?: SourceCitation;
  hunks: DiffHunk[];
  unchanged: boolean;
  truncated: boolean;
  omittedAfter: number;
  otherCitations: number;
  unpaired?: boolean;
}

const MAX_LINES = 300;
const MAX_CHARACTERS = 40_000;

interface Line { text: string; newline: boolean }
function boundedLines(citation?: SourceCitation): { lines: Line[]; truncated: boolean } {
  if (!citation || !citation.excerpt) return { lines: [], truncated: false };
  const bounded = citation.excerpt.slice(0, MAX_CHARACTERS);
  const parts = bounded.split('\n');
  if (bounded.endsWith('\n')) parts.pop();
  const truncated = citation.excerpt.length > bounded.length || parts.length > MAX_LINES;
  return {
    lines: parts.slice(0, MAX_LINES).map((text, index) => ({ text, newline: index < parts.length - 1 || bounded.endsWith('\n') })),
    truncated,
  };
}

/** Bounded LCS over actual source lines; source position is never part of line identity. */
export function diffCitations(before?: SourceCitation, after?: SourceCitation): {
  lines: DiffLine[]; truncated: boolean;
} {
  const left = boundedLines(before), right = boundedLines(after);
  const a = left.lines, b = right.lines;
  const equal = (i: number, j: number) => a[i].text === b[j].text && a[i].newline === b[j].newline;
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i * width + j] = equal(i, j) ? table[(i + 1) * width + j + 1] + 1
      : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const lines: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && equal(i, j)) {
      lines.push({ kind: 'context', text: a[i].text, oldLine: before!.startLine + i, newLine: after!.startLine + j, noNewline: !a[i].newline });
      i++; j++;
    } else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      lines.push({ kind: 'remove', text: a[i].text, oldLine: before!.startLine + i, noNewline: !a[i].newline });
      i++;
    } else {
      lines.push({ kind: 'add', text: b[j].text, newLine: after!.startLine + j, noNewline: !b[j].newline });
      j++;
    }
  }
  return { lines, truncated: left.truncated || right.truncated };
}

function hunksFor(lines: DiffLine[], before?: SourceCitation, after?: SourceCitation): { hunks: DiffHunk[]; omittedAfter: number } {
  const changed = lines.flatMap((line, index) => line.kind === 'context' ? [] : [index]);
  const ranges: Array<{ start: number; end: number }> = [];
  // Identical excerpts still show a short, honest preview rather than an empty diff.
  if (!changed.length && lines.length) ranges.push({ start: 0, end: Math.min(lines.length, 6) });
  for (const index of changed) {
    const start = Math.max(0, index - 3), end = Math.min(lines.length, index + 4);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  let previousEnd = 0;
  const hunks = ranges.map(({ start, end }) => {
    const slice = lines.slice(start, end);
    const priorOld = lines.slice(0, start).filter(line => line.oldLine !== undefined).length;
    const priorNew = lines.slice(0, start).filter(line => line.newLine !== undefined).length;
    const oldCount = slice.filter(line => line.oldLine !== undefined).length;
    const newCount = slice.filter(line => line.newLine !== undefined).length;
    const hunk: DiffHunk = {
      oldStart: before ? before.startLine + priorOld - (oldCount ? 0 : 1) : 0, oldCount,
      newStart: after ? after.startLine + priorNew - (newCount ? 0 : 1) : 0, newCount,
      lines: slice, omittedBefore: start - previousEnd,
    };
    previousEnd = end;
    return hunk;
  });
  return { hunks, omittedAfter: lines.length - previousEnd };
}

function citationsByPath(citations: SourceCitation[]): Map<string, SourceCitation[]> {
  const paths = new Map<string, SourceCitation[]>();
  const seen = new Set<string>();
  for (const citation of citations) {
    const key = JSON.stringify(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.set(citation.path, [...paths.get(citation.path) ?? [], citation]);
  }
  return paths;
}

function noncontained(citations: SourceCitation[]): SourceCitation[] {
  return citations.filter(citation => !citations.some(other => other !== citation && other.sha === citation.sha
    && other.startLine <= citation.startLine && other.endLine >= citation.endLine
    && other.excerpt.length > citation.excerpt.length && other.excerpt.includes(citation.excerpt)));
}

function sourceTokens(text: string): string {
  // Keep quoted text intact: whitespace inside a string is source, not formatting.
  return (text.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s+|[\w$]+|[^\s]/g) ?? [])
    .filter(token => !/^\s+$/.test(token) && !token.startsWith('//') && !token.startsWith('/*')).join('\u0000');
}

function anchor(excerpt: string): string | undefined {
  const text = excerpt.replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)+/, '');
  const callable = text.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([\w$]+)/);
  if (callable) return `function:${callable[1]}`;
  const binding = text.match(/^(?:(?:const|let|var)\s+)?([\w$]+)\s*=(?!=|>)/);
  if (binding) return `binding:${binding[1]}`;
  const method = text.match(/^(?:async\s+)?(?:(get|set)\s+)?([\w$]+)\s*\([^)]*\)\s*\{/);
  if (method && !['if', 'for', 'while', 'switch', 'catch', 'with'].includes(method[2])) return `method:${method[1] ?? ''}:${method[2]}`;
  return undefined;
}

export function sourceDiff(before?: ExtractedNode, after?: ExtractedNode): SourceFileDiff[] {
  const left = citationsByPath(before?.citations ?? []), right = citationsByPath(after?.citations ?? []);
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap(path => {
    const baseline = left.get(path) ?? [], candidate = right.get(path) ?? [];
    const oldBlocks = noncontained(baseline), remaining = noncontained(candidate);
    const omitted = baseline.length + candidate.length - oldBlocks.length - remaining.length;
    const pairs: Array<{ before?: SourceCitation; after?: SourceCitation }> = [];
    for (const old of oldBlocks) {
      let index = remaining.findIndex(next => sourceTokens(old.excerpt) === sourceTokens(next.excerpt));
      const identity = anchor(old.excerpt);
      if (index < 0 && identity) index = remaining.findIndex(next => anchor(next.excerpt) === identity);
      pairs.push({ before: old, after: index < 0 ? undefined : remaining.splice(index, 1)[0] });
    }
    pairs.push(...remaining.map(after => ({ after })));
    return pairs.map(({ before: beforeCitation, after: afterCitation }, index) => {
      const diff = diffCitations(beforeCitation, afterCitation);
      return {
        path, before: beforeCitation, after: afterCitation,
        ...hunksFor(diff.lines, beforeCitation, afterCitation),
        unchanged: !!beforeCitation && !!afterCitation && beforeCitation.excerpt === afterCitation.excerpt,
        truncated: diff.truncated,
        otherCitations: index === 0 ? omitted : 0,
        unpaired: baseline.length > 0 && candidate.length > 0 && (!beforeCitation || !afterCitation),
      };
    });
  });
}
