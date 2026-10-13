import { h } from './dom.ts';
import { sprite } from './sprite.ts';

import type { Kind } from '../shared/dna.ts';
import { KINDS } from '../shared/dna.ts';

const colors = ['#ffa83c', '#7f7f7f', '#7fbf3f', '#bf7f00'];
const grid = h('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;padding:16px' });
KINDS.forEach((kind: Kind, i) =>
  grid.append(h('div', { class: 'box', style: 'width:150px;padding:10px' }, sprite(colors[i % colors.length]!, 110, kind), h('div', {}, kind))),
);
document.getElementById('app')!.append(h('h2', {}, 'Mutant gallery'), grid);
