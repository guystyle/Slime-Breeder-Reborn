import { STAT_KEYS } from '../shared/lineage.ts';
import type { LineageDetail, LineageRow, SlimeView, TitleMatchLog } from '../shared/types.ts';
import { api } from './api.ts';
import { h, span } from './dom.ts';
import { t } from './i18n.ts';
import { battleReport, fmtDate, slimeCard } from './views.ts';

const typeName = (n: number) => STAT_KEYS[n]!.toUpperCase();

/** A clearly visible "back" bar for detail pages: previous page if there is one, else the title screen. */
function backBar(): HTMLElement {
  const btn = h('button', { type: 'button', class: 'backbtn' }, `← ${t('nav.back')}`);
  btn.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  });
  return h('div', { class: 'backbar' }, btn);
}

/** Bottom-frame views: ranking, lineage census, lineage detail, hall of fame, title matches. */

export async function rankView(page: 'a' | 'b' | 'all', focusId?: number): Promise<HTMLElement> {
  const { slimes } = await api.rank();
  const half = Math.ceil(slimes.length / 2) || 25;
  const nav = h(
    'div',
    { class: 'pager' },
    h('a', { href: '#/rank' }, t('rank.page', { a: 1, b: Math.min(half, 50) })),
    ' ',
    h('a', { href: '#/rank/p2' }, t('rank.page', { a: half + 1, b: 50 })),
    ' ',
    h('a', { href: '#/rank/all' }, t('rank.all')),
  );
  const shown = page === 'all' ? slimes : page === 'b' ? slimes.slice(half) : slimes.slice(0, half);
  const wrap = h('div', {}, h('h2', { class: 'section-title gold' }, t('rank.title')), nav);
  shown.forEach((s, i) => {
    const card = h('div', { class: 'fade-up' }, slimeCard(s, { id: `s${s.id}` }), h('hr'));
    card.style.setProperty('--i', `${Math.min(i, 10) * 0.05}s`);
    wrap.append(card);
  });
  wrap.append(nav);
  queueMicrotask(() => focusId && document.getElementById(`s${focusId}`)?.scrollIntoView({ block: 'start' }));
  return wrap;
}

export async function lineagesView(): Promise<HTMLElement> {
  const { lineages } = await api.lineages();
  const wrap = h('div', { class: 'center' }, h('h2', { class: 'section-title gold' }, t('lin.title')));
  if (!lineages.length) return (wrap.append(t('lin.empty')), wrap);
  const row = (l: LineageRow) => {
    const chain = h('select', { class: 'chain' });
    l.chain.forEach((c, i) => {
      const last = i === l.chain.length - 1;
      const label = i === 0 ? `${t('lin.founder')} ${c.name} ${c.no}` : last ? `${t('lin.gen', { n: i + 1 })} ${c.name} ${c.no}` : `${t('lin.gen', { n: i + 1 })} ${c.name} ${c.no}`;
      chain.append(h('option', last ? { selected: true } : {}, label));
    });
    return h(
      'tr',
      { class: 'fade-up' },
      h('th', {}, String(l.rank)),
      h('td', {}, h('a', { href: `#/lineage/${l.no}`, class: 'own-line' }, `${l.name} ${l.no}`)),
      h('td', { align: 'center' }, typeName(l.type)),
      h('td', { align: 'right' }, t('lin.animals', { n: l.count })),
      h('td', { align: 'right' }, `${l.percent}%`),
      h('td', {}, chain),
    );
  };
  wrap.append(
    h(
      'table',
      { class: 'lintable' },
      h('tr', { class: 'thead' }, ...(['lin.rank', 'lin.name', 'lin.type', 'lin.count', 'lin.pct', 'lin.chain'] as const).map((k) => h('th', {}, t(k)))),
      ...lineages.map(row),
    ),
  );
  return wrap;
}

export function lineageView(d: LineageDetail, token: string | null): HTMLElement {
  const wrap = h('div', {});
  wrap.append(backBar());
  const name = d.lineage ? t('lin.detail', { name: d.lineage.name, no: d.lineage.no }) : t('lin.none');
  wrap.append(h('h2', { class: 'section-title gold' }, name));
  if (d.fromHall) wrap.append(h('p', { class: 'small' }, t('lin.hallOnly')));
  if (!d.slimes.length) wrap.append(h('p', {}, t('lin.none')));
  for (const e of d.slimes) {
    wrap.append(
      h('div', { class: e.orange ? 'orange-line' : '' }, e.variety ? h('div', { class: 'small yellow' }, t('lin.variety', { n: e.variety })) : '', slimeCard(e.slime, { orange: e.orange }), h('hr')),
    );
  }
  if (token) {
    const note = h('p', { class: 'small' });
    note.innerHTML = t('lin.poor');
    wrap.append(note);
  }
  return wrap;
}

export async function hallView(): Promise<HTMLElement> {
  const { entries } = await api.hall();
  const wrap = h('div', {}, h('h2', { class: 'section-title gold' }, t('hall.title')));
  if (!entries.length) wrap.append(h('p', {}, t('hall.none')));
  for (const e of entries) {
    const s: SlimeView = e.slime;
    wrap.append(
      h(
        'div',
        { class: 'hall-entry fade-up' },
        h(
          'div',
          { class: 'hall-head' },
          span('gold-text', `${'★'.repeat(Math.min(10, e.defenses * 2))}`),
          ' ',
          h('b', { class: 'shine-gold' }, s.name),
          h('small', {}, ` ${s.gen}`),
          ' ',
          span('small', `${t('hall.no', { n: s.id })} · ${t('hall.defended', { n: e.defenses })} · ${fmtDate(e.at)}`),
        ),
        slimeCard(s),
        h('hr'),
      ),
    );
  }
  return wrap;
}

function matchEntry(m: TitleMatchLog): HTMLElement {
  return h(
    'div',
    { class: 'fade-up' },
    h('div', { class: 'small' }, `${fmtDate(m.at)} `, h('b', { class: 'pink' }, m.challenger.name), ' VS ', h('b', { class: 'pink' }, m.champion.name), ' — ', m.championHeld ? t('result.held', { name: m.champion.name }) : t('result.newChamp', { name: m.challenger.name })),
    battleReport(m.report),
    h('hr'),
  );
}

export async function titlesView(): Promise<HTMLElement> {
  const { matches } = await api.titleMatches();
  const wrap = h('div', {}, h('h2', { class: 'section-title gold' }, t('titles.title')));
  if (!matches.length) wrap.append(h('p', {}, t('titles.none')));
  for (const m of matches) wrap.append(matchEntry(m));
  return wrap;
}
