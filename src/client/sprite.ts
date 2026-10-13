import type { Kind } from '../shared/dna.ts';
import { spriteSize } from '../shared/stats.ts';
import { h } from './dom.ts';
import { SPRITES } from './sprites.gen.ts';

/**
 * A slime sprite: the original artwork split into a colour mask (the body,
 * filled with the genetic colour) and the details drawn on top, scaled smoothly
 * like the original page did. Mutant types are separate GIFs in the original.
 */
export function sprite(color: string, size: number, kind: Kind = 'normal', opts: { idle?: boolean; flip?: boolean } = {}): HTMLElement {
  const s = SPRITES[kind] ?? SPRITES.normal;
  const body = h('i', { class: 'sprite-body' });
  body.style.webkitMaskImage = `url(${s.body})`;
  body.style.maskImage = `url(${s.body})`;
  const art = h('img', { class: 'sprite-art', src: s.art, alt: '', draggable: 'false' });
  const wrap = h('span', { class: `sprite k-${kind}${opts.idle !== false ? ' idle' : ''}` }, body, art);
  wrap.style.setProperty('--c', color);
  wrap.style.setProperty('--s', `${size}px`);
  wrap.style.setProperty('--d', `${-Math.random() * 3}s`);
  if (opts.flip) wrap.style.transform = 'scaleX(-1)';
  return wrap;
}

export { spriteSize };
