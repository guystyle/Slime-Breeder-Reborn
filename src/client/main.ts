import type { EnterResponse, NixTable } from '../shared/types.ts';
import { STAT_KEYS } from '../shared/lineage.ts';
import { ApiError, api } from './api.ts';
import { arena } from './arena.ts';
import { h, span } from './dom.ts';
import { fxEnabled, hatch, setFx, sparkleAt, startAmbient } from './fx.ts';
import { guideView } from './guide.ts';
import { errorText, getLang, setLang, t } from './i18n.ts';
import { randomName } from './names.ts';
import { hallView, lineageView, lineagesView, rankView, titlesView } from './lists.ts';
import { settings, loadSettings } from './settings.ts';
import { BG2_STRIP, BG_STRIP } from './sprites.gen.ts';
import { battleReport, fmtDate, isMobile, mobileQuery, roundDetails, slimeCard } from './views.ts';

type Session = Extract<EnterResponse, { ok: true }>;

let session: Session | null = null;
/** Content that replaces the routed bottom view (a fight in progress or its result) until the route changes. */
let bottomOverride: HTMLElement | null = null;
/** The latest battle replay, kept so the player can come back to it after browsing other pages. */
let lastResults: HTMLElement | null = null;
let reopenResults = false;

function showResults() {
  if (!lastResults) return;
  if (routeName() === '') {
    bottomOverride = lastResults;
    applyLayout();
    void renderBottom();
  } else {
    reopenResults = true; // the hashchange handler restores the replay
    location.hash = '#/';
  }
}
let banner = '';
/** The remembered account on this device (from the HttpOnly cookie) and when its next play is allowed. */
let identity: string | null = null;
let waitUntil = 0;
let tickTimer: number | undefined;

const app = document.getElementById('app')!;
const root = document.documentElement;
root.style.setProperty('--bg-strip', `url(${BG_STRIP})`);
root.style.setProperty('--bg-strip2', `url(${BG2_STRIP})`);

const showError = (box: HTMLElement, e: unknown) => {
  box.textContent = e instanceof ApiError ? errorText(e.code, e.params) + (e.code === 'server' && e.detail ? ` [${e.detail}]` : '') : e instanceof Error ? `${e.message} (${e.name}${where(e)})` : String(e);
};

/** Top stack frame, so a phone user can report where an unexpected script error came from. */
const where = (e: Error) => {
  const m = /(?:@|\()?([^@()\s]+:\d+:\d+)\)?\s*$/m.exec((e.stack ?? '').split('\n').find((l) => /:\d+:\d+/.test(l)) ?? '');
  return m ? ` @ ${m[1]!.split('/').pop()}` : '';
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
const tabbar = h('nav', { id: 'tabbar', 'aria-label': 'main' });
const sheet = h('div', { id: 'more-sheet', hidden: true });
app.append(top, divider, bottom);
document.body.append(tabbar, sheet);

divider.addEventListener('pointerdown', (e) => {
  divider.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const y = ev.clientY - app.getBoundingClientRect().top;
    top.style.height = `${Math.max(120, Math.min(innerHeight - 160, y))}px`;
  };
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', () => divider.removeEventListener('pointermove', move), { once: true });
});

const routeName = () => location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';

/**
 * Desktop shows both frames. On a phone there is one column and one view at a time: the
 * play screen (home) or the routed page, switched with the bottom tab bar.
 */
function applyLayout() {
  const mobile = isMobile();
  document.body.classList.toggle('mobile', mobile);
  const home = routeName() === '' && !bottomOverride;
  top.hidden = mobile && !home;
  bottom.hidden = mobile && home;
  divider.hidden = mobile;
  tabbar.hidden = !mobile;
  if (!mobile) sheet.hidden = true;
  if (mobile) renderTabbar();
}

function renderTabbar() {
  const r = routeName();
  const active = bottomOverride ? 'fight' : r === '' ? 'home' : r === 'lineage' ? 'lineages' : ['rank', 'lineages', 'hall'].includes(r) ? r : 'more';
  const tab = (id: string, href: string, ico: string, label: string) =>
    h('a', { href, class: active === id ? 'on' : '', onclick: () => { sheet.hidden = true; } }, h('span', { class: 'ico' }, ico), h('span', {}, label));
  tabbar.replaceChildren(
    tab('home', '#/', '🏠', t('nav.play')),
    ...(lastResults ? [h('a', { href: '#', class: active === 'fight' ? 'on' : '', onclick: (e: Event) => { e.preventDefault(); sheet.hidden = true; showResults(); } }, h('span', { class: 'ico' }, '⚔️'), h('span', {}, t('nav.fight')))] : []),
    tab('rank', '#/rank', '🏆', t('nav.rank')),
    tab('lineages', '#/lineages', '🧬', t('nav.lineages')),
    tab('hall', '#/hall', '👑', t('nav.hall')),
    h('a', { href: '#', class: active === 'more' || !sheet.hidden ? 'on' : '', onclick: (e: Event) => { e.preventDefault(); sheet.hidden = !sheet.hidden; renderSheet(); } }, h('span', { class: 'ico' }, '⋯'), h('span', {}, t('nav.more'))),
  );
}

function renderSheet() {
  const item = (label: string, onclick: () => void, href = '#') => h('a', { href, class: 'sheet-item', onclick: (e: Event) => { if (href === '#') e.preventDefault(); onclick(); } }, label);
  sheet.replaceChildren(
    item(t('nav.guide'), () => { sheet.hidden = true; }, '#/guide'),
    item(t('nav.titles'), () => { sheet.hidden = true; }, '#/titles'),
    item(t('nav.lang'), () => { setLang(getLang() === 'ko' ? 'en' : 'ko'); sheet.hidden = true; renderAll(); }),
    item(fxEnabled() ? t('nav.fx.off') : t('nav.fx.on'), () => { setFx(!fxEnabled()); sheet.hidden = true; renderTabbar(); }),
  );
}
document.addEventListener('pointerdown', (e) => {
  if (!sheet.hidden && !(e.target as Element).closest('#more-sheet, #tabbar')) sheet.hidden = true;
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
      lastResults = null;
      renderAll();
    }),
    sep(),
    ...(lastResults ? [h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); showResults(); } }, t('nav.fight')), sep()] : []),
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

const field = (label: string, input: HTMLElement) => h('label', { class: 'field' }, h('span', {}, label), input);

const fmtWait = (ms: number) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/** "Welcome back" panel for a remembered device: continue (when the wait is over) or log out. */
function rememberedPanel(user: string, err: HTMLElement): HTMLElement {
  const goBtn = h('button', { type: 'button' }, t('login.continue'));
  const timer = h('div', { class: 'banner' });
  const refresh = () => {
    const left = waitUntil - Date.now();
    timer.hidden = left <= 0;
    goBtn.disabled = left > 0;
    if (left > 0) timer.textContent = t('login.waitFor', { time: fmtWait(left) });
    return left;
  };
  const tick = () => {
    if (refresh() <= 0) {
      clearInterval(tickTimer);
      void tryResume(); // the wait is over: go straight on
    }
  };
  clearInterval(tickTimer);
  if (refresh() > 0) tickTimer = window.setInterval(tick, 1000);
  goBtn.addEventListener('click', () => void guarded(goBtn, err, async () => {
    if (!(await tryResume(err))) goBtn.disabled = false;
  })());
  const out = h('button', { type: 'button', class: 'mini' }, t('login.logout'));
  out.addEventListener('click', async () => {
    try {
      await api.logout();
    } catch {
      /* the cookie is cleared server side when possible; either way show the login form */
    }
    identity = null;
    waitUntil = 0;
    session = null;
    renderTop();
  });
  return h('div', { class: 'welcome' }, h('div', { class: 'who2' }, t('login.welcome', { user })), timer, h('div', { class: 'row center' }, goBtn), out);
}

/**
 * Try to continue as the remembered account. Returns true when a play screen opened;
 * during the wait it records the remaining time instead.
 */
async function tryResume(err?: HTMLElement): Promise<boolean> {
  try {
    session = await api.resume();
    waitUntil = 0;
    banner = '';
    renderTop();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'cooldown') {
      waitUntil = Date.now() + Number(e.params.leftSec ?? 0) * 1000;
      renderTop();
    } else if (e instanceof ApiError && e.code === 'no-login') {
      identity = null;
      renderTop();
    } else if (err) showError(err, e);
    return false;
  }
}

async function titleTop(): Promise<HTMLElement> {
  const user = h('input', { type: 'text', size: 16, maxlength: 32, autocomplete: 'username', autocapitalize: 'none', enterkeyhint: 'next' });
  const pass = h('input', { type: 'password', size: 8, maxlength: 8, autocomplete: 'current-password', enterkeyhint: 'go' });
  const keep = h('input', { type: 'checkbox', checked: true });
  const err = errorBox();
  const btn = h('button', { type: 'submit' }, t('login.enter'));
  const form = h('form', { class: 'login' }, field(t('login.user'), user), field(t('login.pass'), pass), h('label', { class: 'keep' }, keep, ' ', t('login.remember')), btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      const entered = await api.enter(user.value, pass.value, keep.checked);
      session = entered;
      if (keep.checked) identity = entered.mother.owner;
      banner = '';
      renderTop();
    })();
  });

  const cName = h('input', { type: 'text', size: 12, maxlength: 32, value: t('comment.name') });
  const cText = h('input', { type: 'text', size: 50, maxlength: 300 });
  const cBtn = h('button', { type: 'submit' }, t('comment.say'));
  const cErr = errorBox();
  const list = h('div');
  const summary = h('summary', {}, t('comment.title', { n: 0 }));
  const cForm = h('form', { class: 'commentform' }, field(t('comment.name'), cName), field(t('comment.label'), cText), cBtn, h('small', {}, t('comment.limit')));
  const loadComments = async () => {
    const { comments } = await api.comments();
    const shown = comments.filter((c) => c.user !== '@hall');
    summary.textContent = t('comment.title', { n: shown.length });
    list.replaceChildren(...shown.map((c) => h('div', { class: 'comment' }, span('date', fmtDate(c.at)), ' ', span('cyan', c.user), h('b', {}, `(${c.text})`))));
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

  const stage = identity
    ? h('div', { class: 'stage' }, logo(), rememberedPanel(identity, err), err)
    : h('div', { class: 'stage' }, logo(), form, err, banner ? h('div', { class: 'banner' }, banner) : '', h('small', {}, t('login.note')));
  const comments = h('details', { class: 'comments', ...(isMobile() ? {} : { open: true }) }, summary, cForm, cErr, list);
  const out = h('div', {}, await ticker(), stage, comments);
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
    h('div', { class: 'row' }, h('span', { class: 'who' }, h('b', { class: 'pink' }, s.mother.name), h('span', { class: 'sub' }, String(s.mother.gen)), ' ×'), sel, btn),
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

  return h('div', {}, form, slimeCard(s.mother), h('div', { class: 'nixbar' }, h('div', { class: 'row' }, nixSel, show), h('small', {}, t('mate.nixHelp'))));
}

function fightTop(s: Session): HTMLElement {
  const child = s.pending!;
  const name = h('input', { type: 'text', size: 18, maxlength: 36, value: randomName() });
  const btn = h('button', { type: 'submit' }, t('born.fight'));
  const dice = h('button', { type: 'button', class: 'dice', title: t('born.reroll'), 'aria-label': t('born.reroll') }, '🎲');
  dice.addEventListener('click', () => {
    name.value = randomName();
  });
  const err = errorBox();
  const form = h(
    'form',
    {},
    h('div', { class: 'msg' }, t('born.msg', { name: s.mother.name })),
    h('div', { class: 'row' }, h('span', { class: 'who' }, t('born.name')), name, dice, btn),
    err,
    slimeCard(child, { showNix: true }),
    h('div', { class: 'small' }, t('born.no', { n: child.id })),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      const token = s.token;
      const r = await api.fight(token, name.value.trim() || randomName());
      // the form stays up as the "born" card; results play in the bottom frame
      session = null;
      banner = !identity && settings.cooldownMin > 0 ? t('result.again', { n: settings.cooldownMin }) : '';
      if (identity && settings.cooldownMin > 0) waitUntil = Date.now() + settings.cooldownMin * 60_000;
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
  lastResults = results;
  bottom.replaceChildren(results);
  applyLayout();
  scrollTo(0, 0);
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
    if (!isMobile()) round.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    h('div', { class: 'endlinks' }, h('a', { href: '#/rank', class: 'btnlink' }, t('result.viewRank')), h('a', { href: '#/', class: 'btnlink' }, t('result.home'))),
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
    if (isMobile()) scrollTo(0, 0);
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
  top.replaceChildren(...(isMobile() ? [body] : [nav(), body]));
}

function renderAll() {
  applyLayout();
  void renderTop();
  void renderBottom();
}

window.addEventListener('hashchange', () => {
  bottomOverride = reopenResults ? lastResults : null;
  reopenResults = false;
  sheet.hidden = true;
  applyLayout();
  scrollTo(0, 0);
  void renderBottom();
});
mobileQuery().addEventListener('change', renderAll);

/** Show unexpected script errors on screen so they can be reported (a phone has no console). */
function installErrorReporter() {
  const seen = new Set<string>();
  const report = (msg: string, where: string) => {
    const text = `${msg} ${where}`.trim();
    if (seen.has(text) || seen.size > 5) return;
    seen.add(text);
    const box = h('div', { class: 'jserror', role: 'alert' }, '⚠ ', text, ' ', h('button', { type: 'button', class: 'mini', onclick: () => box.remove() }, '×'));
    document.body.append(box);
  };
  addEventListener('error', (e) => report(e.message, e.filename ? `(${e.filename.split('/').pop()}:${e.lineno}:${e.colno})` : ''));
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report(r instanceof Error ? r.message : String(r), r instanceof ApiError ? '' : '(promise)');
  });
}

document.documentElement.lang = getLang();
installErrorReporter();
startAmbient();
void (async () => {
  await loadSettings();
  try {
    identity = (await api.me()).user;
  } catch {
    identity = null;
  }
  renderAll();
  if (identity) void tryResume(); // a remembered device goes straight to the play screen
})();
