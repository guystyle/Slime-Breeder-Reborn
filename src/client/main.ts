import type { EnterResponse, NixTable } from '../shared/types.ts';
import { STAT_KEYS } from '../shared/lineage.ts';
import { ApiError, api } from './api.ts';
import { arena } from './arena.ts';
import { h, span } from './dom.ts';
import { fxEnabled, hatch, setFx, sparkleAt, startAmbient } from './fx.ts';
import { guideView } from './guide.ts';
import { errorText, getLang, setLang, t } from './i18n.ts';
import { hallView, lineageView, lineagesView, rankView, titlesView } from './lists.ts';
import { BG2_STRIP, BG_STRIP } from './sprites.gen.ts';
import { battleReport, fmtDate, roundDetails, slimeCard } from './views.ts';

type Session = Extract<EnterResponse, { ok: true }>;

let session: Session | null = null;
/** Content that replaces the routed bottom view (a fight in progress or its result) until the route changes. */
let bottomOverride: HTMLElement | null = null;
let banner = '';

const app = document.getElementById('app')!;
const root = document.documentElement;
root.style.setProperty('--bg-strip', `url(${BG_STRIP})`);
root.style.setProperty('--bg-strip2', `url(${BG2_STRIP})`);

const showError = (box: HTMLElement, e: unknown) => {
  box.textContent = e instanceof ApiError ? errorText(e.code, e.params) : e instanceof Error ? e.message : String(e);
};

/** Run an async action behind a button, surfacing errors into `box`. */
function guarded(btn: HTMLButtonElement, box: HTMLElement, fn: () => Promise<void>) {
  return async () => {
    btn.disabled = true;
    box.textContent = '';
    try {
      await fn();
    } catch (e) {
      showError(box, e);
      btn.disabled = false;
    }
  };
}
const errorBox = () => h('div', { class: 'error', role: 'alert' });

// ---------------------------------------------------------------------------
// frame layout: a fixed top frame (title / game forms) and a scrolling bottom frame, like the original frameset
// ---------------------------------------------------------------------------

const top = h('div', { id: 'frame-top' });
const divider = h('div', { id: 'divider', role: 'separator', 'aria-orientation': 'horizontal', title: '↕' });
const bottom = h('div', { id: 'frame-bottom' });
app.append(top, divider, bottom);

divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const y = ev.clientY - app.getBoundingClientRect().top;
    top.style.height = `${Math.max(120, Math.min(innerHeight - 160, y))}px`;
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', move), { once: true });
});

function nav(): HTMLElement {
  const link = (href: string, label: string, onclick?: () => void) => h('a', { href, ...(onclick ? { onclick } : {}) }, label);
  const sep = () => ' / ';
  return h(
    'nav',
    {},
    link('#/', t('nav.home'), () => {
      session = null;
      banner = '';
      bottomOverride = null;
      renderAll();
    }),
    sep(),
    link('#/guide', t('nav.guide')),
    sep(),
    link('#/rank', t('nav.rank')),
    sep(),
    link('#/lineages', t('nav.lineages')),
    sep(),
    link('#/hall', t('nav.hall')),
    sep(),
    link('#/titles', t('nav.titles')),
    sep(),
    link('#/', t('nav.reload'), () => {
      session = null;
      renderAll();
    }),
    h('span', { class: 'nav-right' },
      h('button', { type: 'button', class: 'mini', onclick: () => { setFx(!fxEnabled()); renderTop(); } }, fxEnabled() ? t('nav.fx.off') : t('nav.fx.on')),
      ' ',
      h('button', { type: 'button', class: 'mini', onclick: () => { setLang(getLang() === 'ko' ? 'en' : 'ko'); renderAll(); } }, t('nav.lang')),
    ),
  );
}

const COPYRIGHT = () =>
  h(
    'footer',
    {},
    h('i', {}, h('b', {}, 'SLIME BREEDER'), ' (plus v1.08) ', t('footer.copy'), ' ', h('a', { href: 'http://www2j.biglobe.ne.jp/~tatuta/_MENU.htm', target: '_blank', rel: 'noopener' }, 'tatuta'), '.'),
    h('br'),
    h('i', {}, t('footer.mod'), ' ', h('a', { href: 'https://github.com/guystyle/Slime-Breeder-Reborn', target: '_blank', rel: 'noopener' }, 'guystyle'), ' — ', t('footer.notice')),
  );

// ---------------------------------------------------------------------------
// top frame
// ---------------------------------------------------------------------------

function logo(): HTMLElement {
  const word = (text: string, base: number) =>
    h('span', { class: 'word' }, ...[...text].map((ch, i) => { const s = h('span', { class: 'ch' }, ch); s.style.setProperty('--i', String(base + i)); return s; }));
  return h(
    'div',
    { class: 'logo-wrap' },
    h('h1', { class: 'logo', 'aria-label': 'SLIME BREEDER' }, word('SLIME', 0), ' ', word('BREEDER', 5), h('sup', {}, '+')),
    h('div', { class: 'tagline' }, t('title.tagline')),
  );
}

async function ticker(): Promise<HTMLElement> {
  const box = h('div', { class: 'marquee' });
  try {
    const { comments } = await api.comments();
    const items = comments.filter((c) => c.user === '@hall').slice(0, 5).map((c) => {
      const [name, gen, owner] = c.text.split('|');
      return t('comment.hall', { name: name ?? '', gen: gen ?? '', owner: owner ?? '' });
    });
    if (items.length) box.append(h('span', { class: 'marquee-inner shine-gold' }, `★ ${items.join('   ★ ')} `));
  } catch {
    /* the ticker is decoration */
  }
  return box;
}

async function titleTop(): Promise<HTMLElement> {
  const user = h('input', { type: 'text', size: 16, maxlength: 32, autocomplete: 'username' });
  const pass = h('input', { type: 'password', size: 8, maxlength: 8, autocomplete: 'current-password' });
  const err = errorBox();
  const btn = h('button', { type: 'submit' }, t('login.enter'));
  const form = h('form', {}, `${t('login.user')} `, user, ` ${t('login.pass')} `, pass, ' ', btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      session = await api.enter(user.value, pass.value);
      banner = '';
      renderTop();
    })();
  });

  const cName = h('input', { type: 'text', size: 12, maxlength: 32, value: t('comment.name') });
  const cText = h('input', { type: 'text', size: 50, maxlength: 300 });
  const cBtn = h('button', { type: 'submit' }, t('comment.say'));
  const cErr = errorBox();
  const list = h('div');
  const cForm = h('form', {}, `${t('comment.label')} `, cName, ' ', cText, ' ', cBtn, ' ', h('small', {}, t('comment.limit')));
  const loadComments = async () => {
    const { comments } = await api.comments();
    list.replaceChildren(
      ...comments
        .filter((c) => c.user !== '@hall')
        .map((c) => h('div', { class: 'comment' }, span('date', fmtDate(c.at)), ' ', span('cyan', c.user), h('b', {}, `(${c.text})`))),
    );
  };
  cForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(cBtn, cErr, async () => {
      await api.say(cName.value, cText.value);
      cText.value = '';
      cBtn.disabled = false;
      await loadComments();
    })();
  });

  const stage = h(
    'div',
    { class: 'stage' },
    logo(),
    form,
    err,
    banner ? h('div', { class: 'banner' }, banner) : '',
    h('small', {}, t('login.note')),
  );
  const out = h('div', {}, await ticker(), stage, h('hr'), cForm, cErr, h('hr'), list);
  void loadComments().catch(() => undefined);
  return out;
}

function mateTop(s: Session): HTMLElement {
  const sel = h('select', {}, h('option', { value: '' }, t('mate.option')));
  for (const m of s.mates) {
    sel.append(h('option', { value: m.id }, m.from === 'hall' ? `${t('mate.hall')} ${m.name} ${m.gen}` : `${t('card.rank', { n: m.rank })} ${m.name} ${m.gen}`));
  }
  sel.append(h('option', { value: 'no' }, t('mate.unknown')));
  const btn = h('button', { type: 'submit' }, t('mate.go'));
  const err = errorBox();
  const form = h(
    'form',
    { class: 'rel' },
    h('div', { class: 'msg' }, t('mate.welcome', { user: s.mother.owner, name: s.mother.name }), s.registered ? ` ${t('mate.newAccount')}` : ''),
    h('b', { class: 'pink' }, s.mother.name),
    h('span', { class: 'sub' }, String(s.mother.gen)),
    ' × ',
    sel,
    ' ',
    btn,
    err,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      if (!sel.value) throw new Error(t('mate.pick'));
      const r = await api.mate(s.token, sel.value === 'no' ? 'no' : Number(sel.value));
      await hatch(form);
      s.pending = r.child;
      s.phase = 'fight';
      renderTop();
    })();
  });

  // lineage compatibility list: pick a lineage to list its slimes in the lower frame
  const nixSel = h('select', {}, h('option', { value: '' }, t('mate.nixList')));
  const show = h('button', { type: 'button' }, t('mate.show'));
  show.addEventListener('click', () => {
    if (nixSel.value) location.hash = `#/lineage/${nixSel.value}`;
  });
  void api
    .nix(s.token)
    .then((tbl: NixTable) => {
      let divided = false;
      for (const r of tbl.rows) {
        if (r.count === 0 && !divided) {
          nixSel.append(h('option', { value: '' }, '－－－－－－'));
          divided = true;
        }
        nixSel.append(h('option', { value: r.no }, `${r.print} ${r.name} ${r.no} (${STAT_KEYS[r.type]!.toUpperCase()})`));
      }
    })
    .catch(() => undefined);

  return h('div', {}, form, slimeCard(s.mother), h('div', { class: 'nixbar' }, nixSel, ' ', show, h('br'), h('small', {}, t('mate.nixHelp'))));
}

function fightTop(s: Session): HTMLElement {
  const child = s.pending!;
  const name = h('input', { type: 'text', size: 18, maxlength: 36, value: t('default.name') });
  const btn = h('button', { type: 'submit' }, t('born.fight'));
  const err = errorBox();
  const form = h(
    'form',
    {},
    h('div', { class: 'msg' }, t('born.msg', { name: s.mother.name })),
    t('born.name'),
    ' ',
    name,
    ' ',
    btn,
    err,
    slimeCard(child, { showNix: true }),
    h('div', { class: 'small' }, t('born.no', { n: child.id })),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      const token = s.token;
      const r = await api.fight(token, name.value);
      // the form stays up as the "born" card; results play in the bottom frame
      top.replaceChildren(nav(), h('div', {}, h('div', { class: 'pop' }, slimeCard(child))));
      session = null;
      banner = t('result.again', { n: 15 });
      await playResults(r);
    })();
  });
  return form;
}

// ---------------------------------------------------------------------------
// bottom frame: fight playback and routed views
// ---------------------------------------------------------------------------

async function playResults(r: Awaited<ReturnType<typeof api.fight>>) {
  const results = h('div', { class: 'results' });
  bottomOverride = results;
  bottom.replaceChildren(results);
  let skipAll = false;
  let current: ReturnType<typeof arena> | null = null;
  const skipBtn = h('button', { type: 'button' }, t('battle.skipAll'));
  skipBtn.addEventListener('click', () => {
    skipAll = true;
    current?.skip();
  });
  results.append(skipBtn);

  for (const [i, st] of r.steps.entries()) {
    const round = h('div', { class: 'round' }, h('div', { class: 'round-label rainbow' }, st.title ? t('battle.title') : t('battle.round', { n: i + 1 })), slimeCard(st.opponent, { versus: true }));
    results.append(round);
    current = arena(r.slime, st.opponent, st.report, st.title);
    if (skipAll) current.skip();
    round.append(current.el);
    await current.play();
    round.append(roundDetails(st, r.finalPoints));
    round.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  if (r.defense) {
    const d = r.defense;
    const panel = h('div', { class: 'round' }, h('div', { class: 'round-label rainbow' }, t('result.defense', { a: d.challenger.name, b: d.champion.name })));
    results.append(panel);
    current = arena(d.challenger, d.champion, d.report, true);
    if (skipAll) current.skip();
    panel.append(current.el);
    await current.play();
    panel.append(battleReport(d.report), h('div', { class: 'result stamp' }, d.championHeld ? t('result.held', { name: d.champion.name }) : t('result.newChamp', { name: d.challenger.name })));
  }
  skipBtn.remove();
  const end = h(
    'div',
    { class: 'result' },
    h('div', { class: 'shine-gold big2' }, r.finalRank ? t('result.rank', { name: r.slime.name, n: r.finalRank }) : t('result.noRank', { name: r.slime.name })),
    h('a', { href: '#/rank' }, t('result.viewRank')),
  );
  results.append(end);
  sparkleAt(end);
  renderTop(); // back to the title with a "come back later" banner
}

async function routedBottom(): Promise<HTMLElement> {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, arg] = hash.split('/');
  switch (route) {
    case 'guide':
      return guideView();
    case 'lineages':
      return lineagesView();
    case 'lineage':
      return lineageView(await api.lineage(Number(arg), session?.token), session?.token ?? null);
    case 'hall':
      return hallView();
    case 'titles':
      return titlesView();
    default: {
      const focus = arg && /^\d+$/.test(arg) ? Number(arg) : undefined;
      return rankView(focus || arg === 'all' ? 'all' : arg === 'p2' ? 'b' : 'a', focus);
    }
  }
}

let bottomSeq = 0;
async function renderBottom() {
  if (bottomOverride) {
    bottom.replaceChildren(bottomOverride);
    return;
  }
  const seq = ++bottomSeq;
  bottom.replaceChildren(h('div', { class: 'loading' }, t('loading')));
  try {
    const el = await routedBottom();
    if (seq !== bottomSeq) return;
    bottom.replaceChildren(el, h('hr'), COPYRIGHT());
    bottom.scrollTop = 0;
    if (/^#\/rank\/\d+/.test(location.hash)) {
      const id = location.hash.split('/')[2];
      document.getElementById(`s${id}`)?.scrollIntoView({ block: 'start' });
    }
  } catch (e) {
    if (seq !== bottomSeq) return;
    const box = errorBox();
    showError(box, e);
    bottom.replaceChildren(box);
  }
}

async function renderTop() {
  const body = session ? (session.phase === 'fight' && session.pending ? fightTop(session) : mateTop(session)) : await titleTop();
  top.replaceChildren(nav(), body);
}

function renderAll() {
  void renderTop();
  void renderBottom();
}

window.addEventListener('hashchange', () => {
  bottomOverride = null;
  void renderBottom();
});

document.documentElement.lang = getLang();
startAmbient();
renderAll();
