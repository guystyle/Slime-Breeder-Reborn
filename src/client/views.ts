import type { BattleReport, SideReport } from '../shared/battle.ts';
import type { Kind } from '../shared/dna.ts';
import type { Lin } from '../shared/lineage.ts';
import type { FightStep, Pedigree, SlimeView } from '../shared/types.ts';
import { h, span } from './dom.ts';
import { t } from './i18n.ts';
import { sprite } from './sprite.ts';

export { sprite } from './sprite.ts';

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const kindLabel = (k: Kind) => t(`kind.${k}` as const);

export const mobileQuery = () => matchMedia('(max-width: 700px)');
export const isMobile = () => mobileQuery().matches;
/** Squeeze the 33–170px sprite range into 33–124px for the narrow card, keeping every size step visible. */
export const phonePx = (px: number) => Math.round(33 + ((Math.min(170, Math.max(33, px)) - 33) * (124 - 33)) / (170 - 33));

/** Slime header: rank, name and form on the first line, seeds / children / record / points as small chips below. */
export function slimeHeader(s: SlimeView, opts: { versus?: boolean } = {}): HTMLElement {
  const main = h('div', { class: 'head-main' });
  if (opts.versus) main.append(span('yellow', `${t('card.versus')} `), `(${t('card.rank', { n: s.rank ?? '-' })}) `);
  else main.append(h('b', {}, (s.rank ? t('card.rank', { n: s.rank }) : t('card.unranked')) + ' '));
  main.append(
    h('b', { class: `pink${s.rank === 1 ? ' champ' : ''}` }, s.name),
    h('span', { class: 'sub' }, String(s.gen)),
    s.defenses > 0 ? span('yellow sub', ` ${'★'.repeat(Math.min(5, s.defenses))}${s.defenses}`) : '',
    s.kind !== 'normal' ? span(`badge ${s.kind}`, kindLabel(s.kind)) : '',
  );
  const chip = (...kids: (Node | string)[]) => h('span', { class: 'chip' }, ...kids);
  const sub = h(
    'div',
    { class: 'head-sub' },
    chip(s.seeds > 0 ? span('yellow', t('card.seeds', { n: s.seeds })) : t('card.seeds', { n: 0 })),
    chip(t('card.children', { n: s.children })),
    chip(t('card.record', { w: s.wins, l: s.losses })),
    s.bestRank ? chip(t('card.best', { n: s.bestRank })) : '',
    chip(span('yellow pts', String(s.points)), h('small', {}, t('card.pts'))),
  );
  return h('div', { class: 'head' }, main, sub);
}

const lineLink = (l: Lin | undefined, cls = '') => {
  if (!l || !l.no) return h('span', { class: 'small' }, ' ');
  return h('a', { href: `#/lineage/${l.no}`, class: cls }, t('card.line', { name: l.name || '?', no: l.no }));
};

function pedName(p: Pedigree | undefined, ranked: Set<number>, opts: { big?: boolean; pink?: boolean } = {}): HTMLElement {
  const wrap = h('div', { class: opts.big ? '' : 'small' });
  if (!p) return wrap;
  if (p.unknown) {
    wrap.append(span('cyan', t('card.unknownSeed')));
    return wrap;
  }
  const label = p.name || ' ';
  wrap.append(ranked.has(p.id) ? h('a', { href: `#/rank/${p.id}` }, label) : span('cyan', label));
  wrap.append(h('span', { class: opts.pink ? 'pinkgen' : opts.big ? 'sub' : '' }, opts.big ? String(p.gen) : ` ${p.gen}`));
  return wrap;
}

/**
 * Pedigree in the plus edition's layout. Row 1 is the owner's (mother's) side,
 * row 2 the mate's: parent | grandparents | great-grandfathers | bloodlines.
 */
export function pedigree(s: SlimeView): HTMLElement {
  const ranked = new Set(s.rankedIds);
  const p = s.pedigree;
  const eve: Pedigree = { id: 0, name: t('ped.eve'), gen: 0 };
  const adam: Pedigree = { id: 0, name: t('ped.adam'), gen: 0 };
  const M = p ? p.a : eve;
  const F = p ? p.b : adam;
  const cell = (...nodes: HTMLElement[]) => h('td', { valign: 'middle' }, ...nodes);
  const row = (side: Pedigree | undefined, lins: [Lin, Lin]) =>
    h(
      'tr',
      {},
      cell(pedName(side, ranked, { big: true, pink: true })),
      cell(pedName(side?.a, ranked, { pink: true }), pedName(side?.b, ranked)),
      cell(pedName(side?.a?.b, ranked), pedName(side?.b?.b, ranked)),
      cell(lineLink(lins[0]), lineLink(lins[1], lins[1].no === s.lineage[3].no ? 'own-line' : 'mother-line')),
    );
  return h(
    'table',
    { class: 'ped' },
    row(M, [s.lineage[0], s.lineage[1]]),
    row(F, [s.lineage[2], s.lineage[3]]),
  );
}

export function slimeCard(s: SlimeView, opts: { versus?: boolean; id?: string; showNix?: boolean; orange?: boolean } = {}): HTMLElement {
  const sh = s.shown;
  const root = h('div', { class: 'slime-card' + (opts.orange ? ' orange' : ''), ...(opts.id ? { id: opts.id } : {}) });
  root.append(slimeHeader(s, opts));
  const cells: ['HP' | 'STM' | 'STR' | 'DEX' | 'AGL' | 'SPD', number][] = [
    ['HP', sh.hp],
    ['STM', sh.stm],
    ['STR', sh.str],
    ['DEX', sh.dex],
    ['AGL', sh.agl],
    ['SPD', sh.spd],
  ];
  const ped = h('details', { class: 'ped-details', ...(isMobile() ? {} : { open: true }) }, h('summary', {}, t('ped.title')), pedigree(s));
  root.append(
    h(
      'div',
      { class: 'slime' },
      h(
        'div',
        { class: 'box' },
        sprite(s.color, isMobile() ? phonePx(s.px) : s.px, s.kind),
        h('div', { class: 'small' }, t('card.weight', { n: s.stats.weight })),
        s.lineage[3].no ? h('div', { class: 'small' }, lineLink(s.lineage[3], 'own-line')) : '',
      ),
      h(
        'div',
        { class: 'info' },
        h('div', { class: 'meta small' }, `${t('card.gen', { n: s.gen, date: fmtDate(s.born) })} · ${t('card.owner', { x: s.owner })}`),
        h('div', { class: 'statgrid' }, ...cells.map(([k, v]) => h('div', { class: 'cell' }, h('span', { class: 'k' }, t(`stat.${k}` as const)), h('span', { class: 'v' }, String(v))))),
        ped,
        opts.showNix ? h('div', { class: 'small nixfit' }, `${t('born.nix')} ${s.nix}`) : '',
      ),
    ),
  );
  return root;
}

function sideRow(r: SideReport, me: boolean, won: boolean): HTMLElement {
  return h(
    'tr',
    me ? { class: 'me' } : {},
    h('td', {}, r.name),
    h('td', {}, 'HP:', span('yellow', String(r.hp)), '/', h('span', { class: 'sub' }, String(r.maxHp))),
    h('td', {}, `STM:${r.stmPct}%`),
    h('td', {}, t('battle.hits', { h: r.hits })),
    h('td', {}, t('battle.attacks', { a: r.attacks })),
    h('td', {}, t('battle.dmg', { n: r.dmgAve })),
    h('td', {}, `LUCK:${r.luckAtk}(${r.luckHit})`),
    won ? h('td', { class: 'star' }, '★') : h('td'),
  );
}

export function battleReport(rep: BattleReport): HTMLElement {
  const log = h('div', { class: 'log' });
  for (const ch of rep.log) {
    if (ch === ' ') log.append(' ');
    else log.append(h('span', { class: /[OXC]/.test(ch) ? 'm' : '' }, ch));
  }
  return h(
    'div',
    {},
    h('table', { class: 'battle' }, sideRow(rep.a, true, rep.winner === 'a'), sideRow(rep.b, false, rep.winner === 'b')),
    log,
    h('div', { class: 'small' }, t('battle.legend')),
  );
}

/** Numbers, log and the result banner for one round (shown after the replay). */
export function roundDetails(step: FightStep, finalPoints: number): HTMLElement {
  const root = h('div', { class: 'details' }, battleReport(step.report));
  if (step.won) {
    root.append(
      h('div', { class: 'result stamp' }, h('div', { class: 'big win rainbow' }, t('result.win')), t('result.gain', { n: step.gained }), t('result.now', { n: step.total }), h('small', {}, t('card.pts'))),
    );
  } else {
    root.append(
      h(
        'div',
        { class: 'result stamp' },
        h('div', { class: 'big lose' }, t('result.lose')),
        t('result.total', { n: finalPoints }),
        h('small', {}, t('card.pts')),
        step.given > 1 ? h('div', { class: 'small' }, t('result.took', { name: step.opponent.name, n: step.given })) : '',
      ),
    );
  }
  return root;
}
