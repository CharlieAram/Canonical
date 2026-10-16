import type { AnalysisRun } from '@canonical/contracts';
import type { MergedNode } from './review';

export type BusinessStatus = 'pending' | 'passed' | 'failed' | 'error';
export function businessEntries(run: AnalysisRun) {
  return run.requirements.map(rule => {
    const entry = run.review?.billOfBusiness.find(item => item.id === rule.id);
    const check = run.results.find(result => result.variant === 'candidate')?.checks.find(item => item.requirementId === rule.id);
    const status: BusinessStatus = entry?.status ?? check?.status ?? (run.status === 'error' ? 'error' : 'pending');
    return { ...rule, status, evidence: entry?.evidence ?? (check ? [{ variant: 'candidate' as const, ...check }] : []) };
  });
}

const words = (text: string) => new Set(text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const has = (tokens: Set<string>, ...terms: string[]) => terms.some(term => tokens.has(term));
function signals(node: MergedNode) {
  const result = new Set<string>();
  // Use both revisions so deleting a relevant step does not hide its requirement.
  for (const side of [node.before, node.after].filter(item => !!item)) {
    const label = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(side.label) ? side.label.split('.').at(-1)! : side.label;
    const identity = words([label, ...Object.keys(side.properties), ...Object.values(side.properties)].join(' '));
    const source = words(side.citations.map(citation => citation.excerpt).join(' '));
    // Labels/properties describe the selected step more narrowly than a citation
    // that may cover its entire parent function. Use source only as a fallback.
    const focused = has(identity, 'quantity', 'quantities', 'account', 'accounts', 'price', 'prices', 'pricing', 'cache', 'cached', 'sku', 'quote', 'quotes') ? identity : source;
    for (const token of focused) result.add(token);
  }
  return result;
}

/** Conservative UI context matching for the supported pricing harness; never changes verdicts. */
export function businessRelevance(requirementId: string, nodes: MergedNode[]): 'relevant' | 'unrelated' | 'unknown' {
  if (!nodes.length) return 'unknown';
  if (!['account-price', 'repeat-price', 'positive-quantity'].includes(requirementId)) return 'unknown';
  const relevant = nodes.some(node => {
    const tokens = signals(node);
    const quantityOnly = has(tokens, 'quantity', 'quantities') && !has(tokens, 'account', 'accounts', 'price', 'prices', 'pricing', 'cache', 'cached', 'sku');
    if (requirementId === 'positive-quantity') return has(tokens, 'quantity', 'quantities');
    if (quantityOnly) return false;
    if (requirementId === 'account-price') return has(tokens, 'account', 'accounts', 'price', 'prices', 'pricing', 'cache', 'cached', 'sku', 'quote', 'quotes');
    return has(tokens, 'price', 'prices', 'pricing', 'cache', 'cached', 'quote', 'quotes');
  });
  return relevant ? 'relevant' : 'unrelated';
}
