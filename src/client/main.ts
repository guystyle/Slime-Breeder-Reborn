import type { EnterResponse, SlimeView } from '../shared/types.ts';
import { api } from './api.ts';
import { h, span } from './dom.ts';
import { arena } from './arena.ts';
import { hatch } from './fx.ts';
import { battleReport, fmtDate, roundDetails, slimeCard } from './views.ts';

type Session = Extract<EnterResponse, { ok: true }>;

const app = document.getElementById('app')!;
let session: Session | null = null;

/** The author's copyright and link must stay (see NOTICE.md); this is a modified version, credited below. */
const COPYRIGHT = h(
  'footer',
  {},
  h('i', {}, h('b', {}, 'SLIME BREEDER'), ' (plus v1.08 rules) Copyright ©1999-2002 ', h('a', { href: 'http://www2j.biglobe.ne.jp/~tatuta/_MENU.htm', target: '_blank', rel: 'noopener' }, 'tatuta'), '.'),
  h('br'),
  h('i', {}, 'Modified version “Reborn” by ', h('a', { href: 'https://github.com/guystyle/Slime-Breeder-Reborn', target: '_blank', rel: 'noopener' }, 'guystyle'), ' — see NOTICE.md.'),
);

function nav(): HTMLElement {
  return h(
    'nav',
    {},
    h('a', { href: '#/' }, 'Home'),
    ' / ',
    h('a', { href: '#/guide' }, 'Instructions'),
    ' / ',
    h('a', { href: '#/rank' }, 'Ranking'),
    ' / ',
    h('a', { href: '#/hall' }, 'Hall of Fame'),
    ' / ',
    h('a', { href: '#/', onclick: () => { session = null; } }, 'Reload'),
  );
}

function page(...content: (Node | string)[]) {
  app.replaceChildren(nav(), ...content, h('hr'), COPYRIGHT);
}

const errorBox = () => h('div', { class: 'error', role: 'alert' });

/** Run an async action behind a button, surfacing errors into `box`. */
function guarded(btn: HTMLButtonElement, box: HTMLElement, fn: () => Promise<void>) {
  return async () => {
    btn.disabled = true;
    box.textContent = '';
    try {
      await fn();
    } catch (e) {
      box.textContent = (e as Error).message;
      btn.disabled = false;
    }
  };
}

// ---------- title / login ----------

function bubbles(): HTMLElement {
  const box = h('div', { class: 'bubbles', 'aria-hidden': 'true' });
  for (let i = 0; i < 14; i++) {
    const b = h('i');
    b.style.setProperty('--s', `${8 + ((i * 7) % 22)}px`);
    b.style.setProperty('--x', `${(i * 71) % 100}%`);
    b.style.setProperty('--t', `${6 + ((i * 3) % 7)}s`);
    b.style.setProperty('--w', `${-(i * 1.3)}s`);
    b.style.setProperty('--dx', `${((i % 5) - 2) * 14}px`);
    box.append(b);
  }
  return box;
}

async function titleView() {
  const user = h('input', { type: 'text', size: 16, maxlength: 32, autocomplete: 'username' });
  const pass = h('input', { type: 'password', size: 8, maxlength: 8, autocomplete: 'current-password' });
  const err = errorBox();
  const btn = h('button', { type: 'submit' }, 'Enter');
  const form = h(
    'form',
    {},
    'Username: ',
    user,
    ' Password: ',
    pass,
    ' ',
    btn,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      session = await api.enter(user.value, pass.value);
      location.hash = '#/';
      render();
    })();
  });

  const cName = h('input', { type: 'text', size: 16, maxlength: 32, value: 'Name' });
  const cText = h('input', { type: 'text', size: 60, maxlength: 300 });
  const cBtn = h('button', { type: 'submit' }, 'Say It!');
  const cErr = errorBox();
  const list = h('div');
  const cForm = h('form', {}, 'One-liner comments: ', cName, ' ', cText, ' ', cBtn, ' ', h('small', {}, '(must be less than 300 characters)'));
  const loadComments = async () => {
    const { comments } = await api.comments();
    list.replaceChildren(
      ...comments.map((c) =>
        h('div', { class: 'comment' }, span('date', fmtDate(c.at)), ' ', span('cyan', c.user), h('b', {}, `(${c.text})`)),
      ),
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

  page(
    h(
      'div',
      { class: 'stage' },
      bubbles(),
      h('h1', { class: 'logo' }, 'SLIME BREEDER'),
      form,
      err,
      h(
        'small',
        {},
        'If this is your first time, you will register to play with the information you enter above. Passwords are stored hashed, but still don’t reuse an important one.',
      ),
    ),
    h('hr'),
    cForm,
    cErr,
    h('hr'),
    list,
  );
  await loadComments().catch(() => undefined);
}

// ---------- mate / fight ----------

function mateView(s: Session) {
  const sel = h('select', {}, h('option', { value: '' }, 'Mate'), ...s.mates.map((m) => h('option', { value: m.id }, `Rank ${m.rank} / ${m.name} ${m.gen}`)));
  const btn = h('button', { type: 'submit' }, 'Mate!');
  const err = errorBox();
  const form = h(
    'form',
    { class: 'rel' },
    h('div', { class: 'msg' }, `Welcome, ${s.mother.owner}${s.registered ? ' (new account created)' : ''}. Please select the mate for `, h('b', { class: 'pink' }, s.mother.name), '.'),
    h('span', { class: 'pink' }, s.mother.name),
    h('span', { class: 'sub' }, String(s.mother.gen)),
    ' x ',
    sel,
    ' ',
    btn,
    err,
    slimeCard(s.mother),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      if (!sel.value) throw new Error('Pick a mate first.');
      const r = await api.mate(s.token, Number(sel.value));
      await hatch(form);
      s.pending = r.child;
      s.phase = 'fight';
      render();
    })();
  });
  page(form);
}

function fightView(s: Session) {
  const child = s.pending!;
  const name = h('input', { type: 'text', size: 18, maxlength: 36, value: child.name });
  const btn = h('button', { type: 'submit' }, 'Round 1...Fight!');
  const err = errorBox();
  const results = h('div');
  const form = h(
    'form',
    {},
    h('div', { class: 'msg' }, `The child of ${s.mother.name} has been born! Give it a name, and challenge the ranked slimes!`),
    'Name: ',
    name,
    ' ',
    btn,
    err,
    slimeCard(child),
    h('div', {}, `This slime is number ${child.id} to be born into this realm.`),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void guarded(btn, err, async () => {
      const r = await api.fight(s.token, name.value);
      // show the newborn as it was before the fights; swap in the final record afterwards
      const born = h('div', { class: 'pop' }, slimeCard(child));
      form.replaceWith(born);
      let skipAll = false;
      const skipBtn = h('button', { type: 'button' }, 'Skip all animations ▸▸');
      skipBtn.addEventListener('click', () => {
        skipAll = true;
        current?.skip();
      });
      results.append(skipBtn);
      let current: ReturnType<typeof arena> | null = null;
      for (const [i, st] of r.steps.entries()) {
        const round = h('div', { class: 'round' }, h('div', { class: 'round-label' }, st.title ? 'Title match!' : `Round ${i + 1}`), slimeCard(st.opponent, { versus: true }));
        results.append(round);
        current = arena(r.slime, st.opponent, st.report, st.title);
        if (skipAll) current.skip();
        round.append(current.el);
        await current.play();
        round.append(roundDetails(st, r.finalPoints));
      }
      if (r.defense) {
        const d = r.defense;
        const panel = h(
          'div',
          { class: 'round' },
          h('div', { class: 'round-label' }, `Title defense match: ${d.challenger.name} vs champion ${d.champion.name}`),
        );
        results.append(panel);
        current = arena(d.challenger, d.champion, d.report, true);
        if (skipAll) current.skip();
        panel.append(current.el);
        await current.play();
        panel.append(
          battleReport(d.report),
          h('div', { class: 'result stamp' }, d.championHeld ? `${d.champion.name} defended the title!` : `${d.challenger.name} is the new champion!`),
        );
      }
      skipBtn.remove();
      born.replaceChildren(slimeCard(r.slime));
      session = null; // a fresh login is needed for the next generation (15 min cooldown)
    })();
  });
  page(form, results);
}

// ---------- ranking / hall / guide ----------

async function rankView(focusId?: number) {
  page(h('div', {}, 'Loading…'));
  const { slimes } = await api.rank();
  const wrap = h('div', {}, h('div', { class: 'head' }, span('yellow', 'Ranking')));
  slimes.forEach((s, i) => {
    const card = h('div', { class: 'fade-up' }, slimeCard(s, { id: `s${s.id}` }), h('hr'));
    card.style.setProperty('--i', `${Math.min(i, 12) * 0.05}s`);
    wrap.append(card);
  });
  page(wrap);
  if (focusId) document.getElementById(`s${focusId}`)?.scrollIntoView();
}

async function hallView() {
  const { entries } = await api.hall();
  const wrap = h('div', {}, h('h2', { style: 'color:#7f7fff' }, 'Hall of Fame'));
  if (!entries.length) wrap.append('No legend has fallen yet.');
  for (const e of entries) {
    wrap.append(h('div', {}, `${fmtDate(e.at)} — defended the title ${e.defenses} times`), slimeCard(e.slime), h('hr'));
  }
  page(wrap);
}

function guideView() {
  const d = (t: string) => h('p', {}, t);
  page(
    h(
      'div',
      { class: 'guide' },
      h('h2', {}, 'Instructions'),
      h('h3', {}, 'About this game'),
      d('Slime Breeder is a genetic evolution simulator. Every slime carries DNA; its stats and looks are all decided by that DNA. Your only job is to choose a mate for your slime and hope the child turns out stronger.'),
      h('h3', {}, 'How to play'),
      d('Log in, pick a mate from the ranking (slimes with no seeds left cannot be chosen), name the newborn, and send it into battle. It starts from the bottom of the ladder and keeps fighting upward until it loses. You can play once per 15 minutes; accounts idle for over a week are deleted.'),
      h('h3', {}, 'Parameters'),
      h(
        'table',
        {},
        ...[
          ['HP', 'Hit points. At zero the slime loses.'],
          ['STM', 'Stamina. It drains with every attack and blow; below 50% the slime weakens quickly, and at zero it has about half its strength. High-status slimes burn it faster.'],
          ['STR', 'Strength: damage per hit.'],
          ['DEX', 'Dexterity: how easily attacks land.'],
          ['AGL', 'Agility: how well attacks are evaded.'],
          ['SPD', 'Speed: the faster slime attacks more often.'],
        ].map(([a, b]) => h('tr', {}, h('td', {}, a!), h('td', {}, b!))),
      ),
      d('Heavy slimes have more HP and STR; light slimes have higher DEX, AGL and SPD. When the species grows strong the numbers are shown divided by 10, 100… so they stay readable (the real values are unchanged).'),
      h('h3', {}, 'Pedigree'),
      d('Left to right: parents, grandparents, then great-grandparents on your side and on the mate’s side. Names in cyan have already left the ranking; names in blue are links to ranked slimes.'),
      h('h3', {}, 'Battle report'),
      d('LUCK is the average of the random numbers rolled: the first is the hit roll (target 50), the one in parentheses the damage roll (about 80). In the log, big O/X are your hits/misses and small o/x the opponent’s; C/c marks a critical hit (a near-perfect roll, roughly 1% of hits, about double damage).'),
      h('h3', {}, 'Ranking'),
      d('Rankings are point-based. A new slime starts with 1 point and fights upward from the bottom of the ladder, meeting only slimes that hold more points than itself (the top three are always fought), until it loses. Beating a slime takes over all of its points; losing never costs points, but the slime that stops your winning streak receives every point you had collected. If you beat the champion you take the title, and a champion who defended it more than 3 times enters the Hall of Fame when dethroned. Only the top 50 stay ranked, and if totals grow too large the whole ladder is divided by 10.'),
      h('h3', {}, 'DNA & evolution'),
      d('Every slime has two strands of 19 genes. Ten of them shape its body; of each pair the stronger-willed one speaks, and when neither dominates the two blend, so hidden genes can resurface generations later. The rest are switches for colour and for hidden mutants: only when the right switches line up does a rare variant appear — aura, hider, wings, ribbon, crown, angel, devil, insect, ahoge, zombie… They are cosmetic, but they show who you are descended from.'),
      d('Strong or weak is decided by chance at birth with equal odds, but strong slimes are chosen as mates more often and weak ones leave fewer children, so the species evolves.'),
      h('h3', {}, 'Story'),
      d('God was bored and made slimes from clay. Adam made seeds; Eve ate them and turned grey. When food ran out, the battles began.'),
    ),
  );
}

// ---------- router ----------

function render() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, arg] = hash.split('/');
  if (route === 'guide') return guideView();
  if (route === 'rank') return void rankView(arg ? Number(arg) : undefined);
  if (route === 'hall') return void hallView();
  if (session) return session.phase === 'fight' && session.pending ? fightView(session) : mateView(session);
  void titleView();
}

window.addEventListener('hashchange', render);
render();

export type { SlimeView };
