// Deliberately small fixture. Both variants share the same simulated upstream.
// The candidate's product-only key is the bug Canonical should expose.
export function createQuoteService(variant, upstreamMs = 15) {
  if (!['baseline', 'candidate'].includes(variant)) throw new Error('Unknown variant');
  const cache = new Map();
  let upstreamCalls = 0;

  return {
    get upstreamCalls() { return upstreamCalls; },
    async quote(account, sku, quantity = 1) {
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid quantity');
      if (!['alpha', 'beta'].includes(account) || sku !== 'demo-product') throw new Error('Unknown fixture input');
      if (variant === 'candidate' && cache.has(sku)) return cache.get(sku) * quantity;
      upstreamCalls++;
      await new Promise(resolve => setTimeout(resolve, upstreamMs));
      const price = account === 'alpha' ? 80 : 100;
      if (variant === 'candidate') cache.set(sku, price);
      return price * quantity;
    },
  };
}
