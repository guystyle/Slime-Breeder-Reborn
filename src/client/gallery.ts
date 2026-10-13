import type { MutationName } from '../shared/dna.ts';
import { h } from './dom.ts';
import { sprite } from './sprite.ts';

/** Every mutation part and the combinations seen in the original (angel, crowned wings, ...). */
const SETS: [string, MutationName[]][] = [
  ['normal', []],
  ['wings', ['wings']],
  ['angel (wings+halo)', ['wings', 'halo']],
  ['crown', ['crown']],
  ['crown + wings', ['crown', 'wings']],
  ['ribbon', ['ribbon']],
  ['ribbon + wings', ['ribbon', 'wings']],
  ['devil', ['devil']],
  ['insect', ['musi']],
  ['aura', ['aura']],
  ['dark', ['dark']],
  ['ahoge', ['aho']],
  ['zombie', ['zombie']],
  ['metal', ['metal']],
];

const colors = ['#ffa83c', '#7f7f7f', '#7fbf3f', '#bf7f00'];
const grid = h('div', { style: 'display:flex;flex-wrap:wrap;gap:14px;padding:16px' });
SETS.forEach(([label, forms], i) =>
  grid.append(h('div', { class: 'box', style: 'width:150px;padding:10px' }, sprite(colors[i % colors.length]!, 110, forms), h('div', {}, label))),
);
document.getElementById('app')!.append(h('h2', {}, 'Mutation gallery'), grid);
