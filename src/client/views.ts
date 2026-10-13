import type { BattleReport, SideReport } from '../shared/battle.ts';
import { spriteSize } from '../shared/stats.ts';
import type { FightStep, Pedigree, SlimeView } from '../shared/types.ts';
import { h, span } from './dom.ts';
import { sprite } from './sprite.ts';

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export { sprite } from './sprite.ts';

const FORM_LABEL = { wings: '🪽 Winged', metal: '⚙ Metal', horn: '🦄 Horned' } as const;

export function slimeHeader(s: SlimeView, opts: { versus?: boolean } = {}): HTMLElement {
  const rank = s.rank ? `Rank ${s.rank}` : 'Unranked';
  const title = h('div', { class: 'head' });
  if (opts.versus) {
    title.append(span('yellow', 'versus '), `(rank ${s.rank ?? '-'}) `);
  } else {
    title.append(h('b', {}, rank + ' '));
  }
  title.append(
    h('b', { class: 'pink' }, s.name),
    h('span', { class: 'sub' }, String(s.gen)),
    s.defenses > 0 ? span('yellow sub', ` ${s.defenses}`) : '',
    ...(s.forms ?? []).map((f) => span(`badge ${f}`, FORM_LABEL[f])),
    ` / `,
    s.seeds > 0 ? span('yellow', String(s.seeds)) : '0',
    ` seeds left / ${s.children} children / ${s.wins} - ${s.losses}`,
    s.bestRank ? ` / Highest rank: ${s.bestRank}` : '',
    ` / ${s.points}`,
    h('small', {}, 'pts.'),
  );
  return title;
}

function pedName(p: Pedigree | undefined, ranked: Set<number>, big: boolean, gen = false): HTMLElement {
  const wrap = h('div', { style: big ? '' : 'font-size:0.85em' });
  if (!p) return wrap;
  const label = p.name || ' ';
  if (ranked.has(p.id)) wrap.append(h('a', { href: `#/rank/${p.id}` }, label));
  else wrap.append(span('cyan', label));
  wrap.append(h('span', { class: big ? 'sub' : '' }, big ? String(p.gen) : ` ${p.gen}`));
  void gen;
  return wrap;
}

/** Pedigree: parents | grandparents | owner-side great-grandparents | mate-side great-grandparents. */
export function pedigree(s: SlimeView): HTMLElement {
  const ranked = new Set(s.rankedIds);
  const p = s.pedigree;
  const eve = { id: 0, name: 'Eve', gen: 0 } satisfies Pedigree;
  const adam = { id: 0, name: 'Adam', gen: 0 } satisfies Pedigree;
  const L1 = p ? [p.a, p.b] : [eve, adam];
  const L2 = p ? [p.a?.a, p.a?.b, p.b?.a, p.b?.b] : [];
  const L3a = p ? [p.a?.a?.a, p.a?.a?.b, p.a?.b?.a, p.a?.b?.b] : [];
  const L3b = p ? [p.b?.a?.a, p.b?.a?.b, p.b?.b?.a, p.b?.b?.b] : [];
  const col = (items: (Pedigree | undefined)[], big: boolean, split = false) => {
    const td = h('td', { valign: 'middle' });
    items.forEach((it, i) => {
      if (split && i === items.length / 2) td.append(h('hr'));
      td.append(pedName(it, ranked, big));
    });
    return td;
  };
  return h('table', { class: 'ped' }, h('tr', {}, col(L1, true, true), col(L2, false, true), col(L3a, false), col(L3b, false)));
}

export function slimeCard(s: SlimeView, opts: { versus?: boolean; id?: string } = {}): HTMLElement {
  const st = s.stats;
  const root = h('div', opts.id ? { id: opts.id } : {});
  root.append(slimeHeader(s, opts));
  root.append(
    h(
      'div',
      { class: 'slime' },
      h('div', { class: 'box' }, sprite(s.color, spriteSize(st.weight), s.forms ?? []), `weight:${st.weight}`),
      h(
        'div',
        { class: 'info' },
        h(
          'table',
          { class: 'stats' },
          h('tr', {}, h('th', {}, `generation ${s.gen} : born ${fmtDate(s.born)}`), ...['HP', 'STM', 'STR', 'DEX', 'SPD'].map((t) => h('th', {}, t))),
          h('tr', {}, h('th', {}, `Owner: ${s.owner}`), ...[st.hp, st.stm, st.str, st.dex, st.spd].map((n) => h('th', {}, String(n)))),
        ),
        pedigree(s),
      ),
    ),
  );
  return root;
}

function sideRow(r: SideReport, me: boolean, won: boolean): HTMLElement {
  const luck = `LUCK: ${r.luckHit}(${r.luckDmg ?? ''})`;
  return h(
    'tr',
    me ? { class: 'me' } : {},
    h('td', {}, r.name),
    h('td', {}, 'HP:', span('yellow', String(r.hp)), '/', h('span', { class: 'sub' }, String(r.maxHp))),
    h('td', {}, `STM: ${r.stmPct}%`),
    h('td', {}, `${r.hits} Hits Landed /`),
    h('td', {}, `${r.attacks} Attacks Attempted`),
    h('td', {}, `DmgAve ${r.dmgAve}`),
    h('td', {}, luck),
    won ? h('td', {}, '★') : h('td'),
  );
}

export function battleReport(rep: BattleReport): HTMLElement {
  const log = h('div', { class: 'log' });
  for (const ch of rep.log) {
    if (ch === ' ') log.append(' ');
    else log.append(h('span', { class: /[OX]/.test(ch) ? 'm' : '' }, ch));
  }
  return h(
    'div',
    {},
    h('table', { class: 'battle' }, sideRow(rep.a, true, rep.winner === 'a'), sideRow(rep.b, false, rep.winner === 'b')),
    log,
    h('div', { class: 'small' }, '[O]=Hit [X]=Missed [o]=Got hit [x]=Evaded'),
  );
}

/** Numbers, log and the result banner for one round (shown after the replay). */
export function roundDetails(step: FightStep, finalPoints: number): HTMLElement {
  const root = h('div', { class: 'details' }, battleReport(step.report));
  if (step.won) {
    root.append(h('div', { class: 'result stamp' }, h('div', { class: 'big win' }, 'YOU WIN!'), `+${step.gained} pts. NOW ${step.total}`, h('small', {}, 'pts.')));
  } else {
    root.append(h('div', { class: 'result stamp' }, h('div', { class: 'big lose' }, 'YOU LOSE!'), `TOTAL ${finalPoints}`, h('small', {}, 'pts.')));
  }
  return root;
}
