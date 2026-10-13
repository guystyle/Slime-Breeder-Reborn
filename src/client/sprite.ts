import type { Kind } from '../shared/dna.ts';
import { spriteSize } from '../shared/stats.ts';

/** Drawable parts; each mutant type of the original is a combination of them. */
type Part = 'wings' | 'crown' | 'ribbon' | 'halo' | 'devil' | 'musi' | 'aura' | 'aho' | 'zombie' | 'dark' | 'oyaji';

export const KIND_PARTS: Record<Kind, Part[]> = {
  normal: [],
  aura: ['aura'],
  hider: ['dark'],
  wing: ['wings'],
  ribbon: ['ribbon'],
  ribbonw: ['ribbon', 'wings'],
  crown: ['crown'],
  crownw: ['crown', 'wings'],
  aho: ['aho'],
  zombie: ['zombie'],
  oyaji: ['oyaji'],
  musi: ['musi'],
  angel: ['wings', 'halo'],
  devil: ['devil'],
};

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

const clamp8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
/** mix a #rrggbb colour toward white (t>0) or black (t<0) */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => clamp8(t >= 0 ? c + (255 - c) * t : c * (1 + t)));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

type Attrs = Record<string, string>;
function el(parent: Element, tag: string, attrs: Attrs = {}): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e);
  return e as SVGElement;
}

const BODY = 'M8 108 C8 52 36 18 62 18 C90 18 112 52 112 108 Z';

/** One flapping wing pair. The outer group mirrors the right wing; the inner one flaps. */
function wings(svg: SVGElement, kind: 'feather' | 'bat' | 'insect') {
  for (const side of ['l', 'r'] as const) {
    const outer = el(svg, 'g', side === 'r' ? { transform: 'translate(120 0) scale(-1 1)' } : {});
    const g = el(outer, 'g', { class: 'wing' });
    if (kind === 'feather') {
      const f = (d: string) => el(g, 'path', { d, fill: '#fff', stroke: '#9fb4d8', 'stroke-width': '2' });
      f('M30 70 C10 70 -6 56 -8 36 C6 40 16 40 26 46 Z');
      f('M30 66 C12 58 4 44 6 22 C16 32 26 34 34 44 Z');
      f('M32 62 C22 48 22 30 32 12 C38 28 44 38 46 52 Z');
    } else if (kind === 'bat') {
      el(g, 'path', { d: 'M34 70 C20 64 8 48 -6 30 C4 28 8 24 12 18 C16 28 24 30 30 30 C28 38 30 44 38 50 Z', fill: '#16161c', stroke: '#000', 'stroke-width': '1.5' });
      el(g, 'path', { d: 'M12 18 C10 10 14 4 18 2 C18 8 16 12 12 18 Z', fill: '#d33' });
    } else {
      el(g, 'ellipse', { cx: '20', cy: '48', rx: '24', ry: '14', transform: 'rotate(-28 20 48)', fill: '#fff8c4', stroke: '#e8dc8a', 'stroke-width': '1.5', opacity: '0.92' });
    }
  }
}

function flames(svg: SVGElement, color: string) {
  const g = el(svg, 'g', { class: 'flames', fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round' });
  const tongues = [
    'M10 100 C-4 84 6 66 2 50 C14 58 12 42 22 32',
    'M22 70 C14 52 26 40 22 24 C32 34 34 20 44 10',
    'M44 40 C38 24 48 16 46 2 C56 12 60 -2 66 -10',
    'M66 36 C70 20 80 14 80 0 C90 12 94 4 100 -4',
    'M92 44 C98 30 110 28 106 12 C118 26 118 30 120 40',
    'M112 100 C126 84 116 66 120 50',
  ];
  tongues.forEach((d, i) => {
    const p = el(g, 'path', { d, class: 'flame' });
    p.style.setProperty('--fd', `${i * 0.17}s`);
  });
}

/**
 * A slime drawn as SVG (own artwork, modelled on the original's mutant types).
 * The body takes the genetic colour; `kind` selects the mutant parts.
 * `idle` adds a breathing/hovering loop.
 */
export function sprite(color: string, size: number, kind: Kind = 'normal', opts: { idle?: boolean; flip?: boolean } = {}): SVGSVGElement {
  const id = `g${++uid}`;
  const parts = KIND_PARTS[kind] ?? [];
  const has = (f: Part) => parts.includes(f);
  const flying = has('wings') || has('devil') || has('musi');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'sprite' + (opts.idle !== false ? ' idle' : '') + (flying ? ' flying' : ''));
  svg.style.setProperty('--d', `${-(uid % 7) * 0.4}s`);
  if (opts.flip) svg.style.transform = 'scaleX(-1)';

  const dark = has('dark');
  const defs = el(svg, 'defs');
  el(el(defs, 'clipPath', { id: `${id}c` }), 'path', { d: BODY });

  // behind the body
  if (has('aura') || dark) flames(svg, dark ? color : shade(color, 0.1));
  if (has('wings')) wings(svg, 'feather');
  if (has('devil')) wings(svg, 'bat');
  if (has('musi')) wings(svg, 'insect');

  // body
  const fill = dark ? '#16161d' : color;
  el(svg, 'path', { d: BODY, fill, stroke: dark ? color : '#fff', 'stroke-width': dark ? '2' : '3' });
  if (!dark) el(svg, 'path', { d: 'M30 50 C36 36 48 28 58 26', fill: 'none', stroke: '#fff', 'stroke-width': '5', 'stroke-linecap': 'round', opacity: '0.6' });

  // face
  const ink = '#222';
  const rect = (x: number, c: string) => el(svg, 'rect', { class: 'eye', x: String(x), y: '70', width: '6', height: '14', rx: '2', fill: c });
  if (has('oyaji')) {
    // panda-like: dark patches, big ringed eyes, little nose and a single hair
    el(svg, 'ellipse', { cx: '84', cy: '50', rx: '11', ry: '7', transform: 'rotate(28 84 50)', fill: '#111' });
    el(svg, 'ellipse', { cx: '12', cy: '88', rx: '6', ry: '12', fill: '#111' });
    el(svg, 'ellipse', { cx: '107', cy: '84', rx: '6', ry: '13', fill: '#111' });
    el(svg, 'path', { d: 'M58 20 C55 10 60 2 66 6', fill: 'none', stroke: '#111', 'stroke-width': '3', 'stroke-linecap': 'round' });
    for (const x of [40, 80]) {
      el(svg, 'circle', { cx: String(x), cy: '88', r: '13', fill: '#111' });
      el(svg, 'circle', { class: 'eye', cx: String(x), cy: '88', r: '8', fill: '#fff' });
      el(svg, 'circle', { cx: String(x), cy: '88', r: '4', fill: '#111' });
    }
    el(svg, 'ellipse', { cx: '60', cy: '106', rx: '5', ry: '3.5', fill: '#111' });
  } else if (has('aho')) {
    el(svg, 'circle', { cx: '44', cy: '66', r: '6', fill: '#1d2548' });
    el(svg, 'circle', { cx: '74', cy: '66', r: '6', fill: '#1d2548' });
    el(svg, 'path', { d: 'M46 82 Q60 96 74 82', fill: 'none', stroke: '#1d2548', 'stroke-width': '3', 'stroke-linecap': 'round' });
    for (const x of [26, 94]) el(svg, 'path', { d: `M${x - 5} 84 a6 6 0 1 1 6 6 a3 3 0 1 1 -3 -3`, fill: 'none', stroke: '#e44', 'stroke-width': '2.5', 'stroke-linecap': 'round' });
  } else if (has('halo')) {
    el(svg, 'path', { d: 'M40 78 Q46 84 52 78', fill: 'none', stroke: ink, 'stroke-width': '2.5', 'stroke-linecap': 'round' });
    el(svg, 'path', { d: 'M68 78 Q74 84 80 78', fill: 'none', stroke: ink, 'stroke-width': '2.5', 'stroke-linecap': 'round' });
  } else if (has('zombie')) {
    el(svg, 'circle', { cx: '60', cy: '76', r: '7', fill: '#1b1b2a' });
    el(svg, 'path', { d: 'M86 62 L88 30 M84 36 L88 28 L92 36', fill: 'none', stroke: '#d22', 'stroke-width': '3', 'stroke-linecap': 'round' });
  } else rect(44, dark ? '#ffe84a' : has('devil') ? '#3a6bff' : ink), rect(70, dark ? '#ffe84a' : has('devil') ? '#3a6bff' : ink);
  if (!has('aho') && !has('zombie') && !has('oyaji') && !dark) {
    el(svg, 'ellipse', { cx: '34', cy: '88', rx: '6', ry: '3', fill: '#e55', opacity: '0.8' });
    el(svg, 'ellipse', { cx: '86', cy: '88', rx: '6', ry: '3', fill: '#e55', opacity: '0.8' });
  }
  if (has('devil')) {
    for (const x of [42, 70]) el(svg, 'path', { d: `M${x} 100 l5 12 l5 -12 Z`, fill: '#ffe25a', stroke: '#b8860b', 'stroke-width': '1' });
  }
  if (has('zombie')) {
    el(svg, 'ellipse', { cx: '66', cy: '112', rx: '48', ry: '8', fill: '#c4161c', opacity: '0.92' });
    for (const [x, y] of [[40, 104], [58, 110]] as const) {
      el(svg, 'circle', { cx: String(x), cy: String(y), r: '6', fill: '#fff', stroke: '#c4161c', 'stroke-width': '1.5' });
      el(svg, 'circle', { cx: String(x), cy: String(y), r: '2.4', fill: '#222' });
    }
  }

  // on top
  if (has('crown')) el(svg, 'path', { d: 'M47 28 L50 10 L56 21 L62 6 L68 21 L74 10 L77 28 Z', fill: '#ffe900', stroke: '#c9a800', 'stroke-width': '2', 'stroke-linejoin': 'round' });
  if (has('ribbon')) {
    const r = el(svg, 'g', { transform: 'rotate(-28 30 42)' });
    el(r, 'path', { d: 'M30 42 L12 32 L14 52 Z', fill: '#ff4a4a', stroke: '#b22', 'stroke-width': '1.5', 'stroke-linejoin': 'round' });
    el(r, 'path', { d: 'M30 42 L48 32 L46 52 Z', fill: '#ff4a4a', stroke: '#b22', 'stroke-width': '1.5', 'stroke-linejoin': 'round' });
    el(r, 'circle', { cx: '30', cy: '42', r: '4.5', fill: '#d22' });
  }
  if (has('halo')) el(svg, 'ellipse', { class: 'halo', cx: '62', cy: '4', rx: '26', ry: '6', fill: 'none', stroke: '#ffe600', 'stroke-width': '4' });
  if (has('musi')) {
    for (const [x1, x2, ex] of [[52, 46, 40], [68, 70, 80]] as const) {
      el(svg, 'path', { d: `M${x1} 24 C${x2 - 6} 6 ${ex} -4 ${ex + (ex > 60 ? 4 : -2)} -8`, fill: 'none', stroke: '#111', 'stroke-width': '3', 'stroke-linecap': 'round', class: 'antenna' });
      el(svg, 'circle', { cx: String(ex + (ex > 60 ? 4 : -2)), cy: '-8', r: '3.2', fill: '#ffd500' });
    }
  }
  return svg;
}

export { spriteSize };
