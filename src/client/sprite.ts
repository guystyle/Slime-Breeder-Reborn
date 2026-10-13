import { spriteSize } from '../shared/stats.ts';

export type Form = 'wings' | 'metal' | 'horn';

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

const clamp8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
/** mix a #rrggbb colour toward white (t>0) or black (t<0) */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => clamp8(t >= 0 ? c + (255 - c) * t : c * (1 + t)));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

function el(parent: Element, tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.append(e);
  return e as SVGElement;
}

const BODY = 'M8 108 C8 52 36 18 62 18 C90 18 112 52 112 108 Z';

function wing(svg: SVGElement, side: 'l' | 'r') {
  // outer group mirrors the right wing; the inner one carries the flap animation
  const outer = el(svg, 'g', side === 'r' ? { transform: 'translate(120 0) scale(-1 1)' } : {});
  const g = el(outer, 'g', { class: 'wing' });
  // a feathered wing: three overlapping feathers fanning out from the shoulder
  const feather = (d: string, o: string) => el(g, 'path', { d, fill: '#fff', stroke: '#9fb4d8', 'stroke-width': '2', opacity: o });
  feather('M30 70 C10 70 -6 56 -8 36 C6 40 16 40 26 46 Z', '0.95');
  feather('M30 66 C12 58 4 44 6 22 C16 32 26 34 34 44 Z', '0.95');
  feather('M32 62 C22 48 22 30 32 12 C38 28 44 38 46 52 Z', '0.95');
  return g;
}

/**
 * A slime drawn as SVG. The body takes the genetic colour; mutations add
 * wings, a metallic finish or a horn. `idle` adds a breathing/hovering loop.
 */
export function sprite(color: string, size: number, forms: Form[] = [], opts: { idle?: boolean; flip?: boolean } = {}): SVGSVGElement {
  const id = `g${++uid}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'sprite' + (opts.idle !== false ? ' idle' : '') + (forms.includes('wings') ? ' flying' : ''));
  svg.style.setProperty('--d', `${-(uid % 7) * 0.4}s`);
  if (opts.flip) svg.style.transform = 'scaleX(-1)';

  const metal = forms.includes('metal');
  const defs = el(svg, 'defs', {});
  if (metal) {
    const lg = el(defs, 'linearGradient', { id: `${id}m`, x1: '0', y1: '0', x2: '1', y2: '1' });
    el(lg, 'stop', { offset: '0', 'stop-color': shade(color, 0.75) });
    el(lg, 'stop', { offset: '0.45', 'stop-color': shade(color, 0.15) });
    el(lg, 'stop', { offset: '1', 'stop-color': shade(color, -0.55) });
  }
  const clip = el(defs, 'clipPath', { id: `${id}c` });
  el(clip, 'path', { d: BODY });

  if (forms.includes('wings')) {
    wing(svg, 'l');
    wing(svg, 'r');
  }
  el(svg, 'path', { d: BODY, fill: metal ? `url(#${id}m)` : color, stroke: metal ? '#d6e6ff' : '#fff', 'stroke-width': '3' });
  if (metal) {
    const sweep = el(svg, 'g', { 'clip-path': `url(#${id}c)` });
    el(sweep, 'rect', { class: 'shine', x: '-40', y: '0', width: '22', height: '130', fill: '#fff', opacity: '0.55', transform: 'rotate(20 60 60)' });
  }
  el(svg, 'path', { d: 'M30 50 C36 36 48 28 58 26', fill: 'none', stroke: '#fff', 'stroke-width': '5', 'stroke-linecap': 'round', opacity: metal ? '0.9' : '0.6' });
  if (forms.includes('horn')) el(svg, 'path', { d: 'M54 24 C56 14 59 8 62 -2 C65 8 68 14 70 24 Z', fill: '#fff3c0', stroke: '#d9b45a', 'stroke-width': '2.5', 'stroke-linejoin': 'round' });
  el(svg, 'rect', { class: 'eye', x: '44', y: '70', width: '6', height: '14', rx: '2', fill: '#222' });
  el(svg, 'rect', { class: 'eye', x: '70', y: '70', width: '6', height: '14', rx: '2', fill: '#222' });
  el(svg, 'ellipse', { cx: '34', cy: '88', rx: '6', ry: '3', fill: '#e55', opacity: '0.8' });
  el(svg, 'ellipse', { cx: '86', cy: '88', rx: '6', ry: '3', fill: '#e55', opacity: '0.8' });
  return svg;
}

export { spriteSize };
