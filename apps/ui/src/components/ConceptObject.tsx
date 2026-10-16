import { useId, type ReactNode } from 'react';
import type { Concept } from '@canonical/contracts';

// Stand-in for the pre-rendered clay object library: small isometric SVGs in one house style.
// Matte faces, soft rounded edges, one top-left key light, a rounded plinth in the family colour.
export type Family = 'orders' | 'cold' | 'network' | 'fleet' | 'code';
type Shape = 'figure' | 'parcel' | 'quote' | 'policy' | 'database' | 'truck' | 'cube';

export const families: Record<Family, { name: string; base: string; light: string; plinth: string; dark: string }> = {
  orders: { name: 'Orders and customers', base: '#E09474', light: '#F1C8B3', plinth: '#EED3C4', dark: '#B4664A' },
  cold: { name: 'Cold chain', base: '#88B7DE', light: '#CBE0F2', plinth: '#D6E5F2', dark: '#5A8BB6' },
  network: { name: 'Network', base: '#DBB683', light: '#EEDBBC', plinth: '#EBDECA', dark: '#A47D4B' },
  fleet: { name: 'Fleet', base: '#8FB487', light: '#D9E7D1', plinth: '#DAE5D3', dark: '#5F8963' },
  code: { name: 'Code', base: '#ABA2DB', light: '#D9D4F1', plinth: '#DFDBF1', dark: '#7A6FBD' },
};

const rules: [RegExp, Shape, Family][] = [
  [/polic|rule|requirement|contract/i, 'policy', 'network'],
  [/cache|database|store|storage|memo/i, 'database', 'cold'],
  [/account|customer|user|client|driver/i, 'figure', 'orders'],
  [/order|parcel|shipment|package/i, 'parcel', 'orders'],
  [/quote|invoice|price|bill|payment/i, 'quote', 'orders'],
  [/truck|vehicle|fleet/i, 'truck', 'fleet'],
];

export function classify(concept: Pick<Concept, 'id' | 'label'>): { shape: Shape; family: Family } {
  const text = `${concept.id} ${concept.label}`;
  const match = rules.find(([pattern]) => pattern.test(text));
  return match ? { shape: match[1], family: match[2] } : { shape: 'cube', family: 'code' };
}

const mix = (a: string, b: string, t: number) => {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map(i => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, '0')).join('')}`;
};
// Isometric projection; z is up. One unit is one SVG pixel.
const p = (x: number, y: number, z: number) => `${(60 + (x - y) * 0.866).toFixed(1)},${(64 + (x + y) * 0.5 - z).toFixed(1)}`;
const face = (points: [number, number, number][], fill: string, key: string) => <polygon key={key} points={points.map(([x, y, z]) => p(x, y, z)).join(' ')} fill={fill} stroke={fill} strokeWidth={3.2} strokeLinejoin="round" />;

function box(x: number, y: number, z: number, w: number, d: number, h: number, color: string, top = mix(color, '#ffffff', 0.28), key = `${x}${y}${z}`): ReactNode {
  return <g key={key}>
    {face([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], mix(color, '#5b4b40', 0.16), 'r')}
    {face([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], color, 'l')}
    {face([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], top, 't')}
  </g>;
}
function cylinder(x: number, y: number, z: number, r: number, h: number, color: string, key = `c${x}${y}${z}`): ReactNode {
  const [cx, cy] = p(x, y, z).split(',').map(Number) as [number, number];
  const rx = r * 1.2247, ry = r * 0.7071;
  return <g key={key}>
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={mix(color, '#5b4b40', 0.14)} />
    <rect x={cx - rx} y={cy - h} width={rx * 2} height={h} fill={mix(color, '#5b4b40', 0.07)} />
    <ellipse cx={cx} cy={cy - h} rx={rx} ry={ry} fill={mix(color, '#ffffff', 0.3)} />
  </g>;
}
const line = (a: [number, number, number], b: [number, number, number], color: string, key: string) => <polyline key={key} points={`${p(...a)} ${p(...b)}`} stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />;

function shapeParts(shape: Shape, c: (typeof families)[Family], headId: string): ReactNode[] {
  const Z = 6;
  switch (shape) {
    case 'parcel': return [box(-16, -16, Z, 28, 28, 20, c.base), box(-11, -11, Z + 20, 18, 18, 12, mix(c.base, c.light, 0.25)), box(-4, -16.4, Z + 0.5, 4, 28.5, 20.2, c.light, c.light, 'tape'), box(14, 10, Z, 10, 10, 8, c.base, undefined, 'small')];
    case 'quote': return [box(-24, -16, Z, 40, 30, 2.5, '#F6EFEA', '#FBF7F3'), ...[0, 1, 2].map(i => line([-18 + i * 2, -10 + i * 7, Z + 3], [6 + i * 2 - (i === 2 ? 10 : 0), -10 + i * 7, Z + 3], c.light, `ln${i}`)), cylinder(12, 16, Z, 7, 4, c.dark, 'coin1'), cylinder(12, 16, Z + 4.5, 7, 4, c.dark, 'coin2'), cylinder(12, 16, Z + 9, 7, 4, mix(c.dark, c.base, 0.4), 'coin3')];
    case 'policy': return [box(-20, -18, Z, 34, 36, 3, '#F7F1E8', '#FCF8F2'), box(-8, -20, Z + 3, 10, 6, 4, c.dark, undefined, 'clip'), ...[0, 1, 2].map(i => line([-14, -8 + i * 8, Z + 3.5], [8 - (i === 2 ? 8 : 0), -8 + i * 8, Z + 3.5], c.base, `ln${i}`)), cylinder(12, 18, Z, 7, 10, c.base, 'seal')];
    case 'database': return [cylinder(0, 0, Z, 17, 9, c.base, 'd1'), cylinder(0, 0, Z + 11, 17, 9, c.base, 'd2'), cylinder(0, 0, Z + 22, 17, 9, mix(c.base, c.light, 0.2), 'd3')];
    case 'figure': {
      const [hx, hy] = p(0, 0, Z + 38).split(',').map(Number) as [number, number];
      return [cylinder(0, 0, Z, 10, 22, c.base, 'body'), <circle key="head" cx={hx} cy={hy} r={9.5} fill={`url(#${headId})`} />, box(14, 8, Z, 10, 10, 7, c.light, undefined, 'tag')];
    }
    case 'truck': return [box(-22, -12, Z + 5, 30, 20, 20, c.light), box(8, -12, Z + 5, 14, 20, 16, c.base), box(21.5, -9, Z + 11, 1, 14, 7, c.dark, c.dark, 'win'), ...[[-14, 9], [0, 9], [16, 9]].map(([x, y]) => <g key={`w${x}`}>{cylinder(x!, y!, Z, 4.5, 6, c.dark)}</g>)];
    case 'cube': return [box(-16, -16, Z, 30, 30, 30, c.base), box(14, 10, Z, 10, 10, 10, mix(c.base, c.light, 0.3), undefined, 'small')];
  }
}

export function ConceptObject({ concept, size = 88, decorative = false }: { concept: Pick<Concept, 'id' | 'label'>; size?: number; decorative?: boolean }) {
  const id = useId().replace(/:/g, '');
  const { shape, family } = classify(concept);
  const c = families[family];
  return <svg className="concept-object" width={size} height={size * 0.8} viewBox="0 0 120 96" {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `${concept.label} object` })}>
    <defs>
      <filter id={`${id}-blur`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2" /></filter>
      <radialGradient id={`${id}-head`} cx="35%" cy="32%" r="70%"><stop offset="0" stopColor={mix(c.base, '#ffffff', 0.35)} /><stop offset="1" stopColor={mix(c.base, '#5b4b40', 0.12)} /></radialGradient>
    </defs>
    <ellipse cx={64} cy={86} rx={44} ry={9} fill="rgba(120,108,96,.22)" filter={`url(#${id}-blur)`} />
    {box(-34, -34, 0, 68, 68, 6, mix(c.plinth, c.base, 0.18), c.plinth, 'plinth')}
    <ellipse cx={62} cy={64} rx={26} ry={11} fill={mix(c.plinth, c.dark, 0.35)} opacity={0.45} filter={`url(#${id}-blur)`} />
    {shapeParts(shape, c, `${id}-head`)}
  </svg>;
}
