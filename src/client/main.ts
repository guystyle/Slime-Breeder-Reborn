import type { EnterResponse, SlimeView } from '../shared/types.ts';
import { api } from './api.ts';
import { h, span } from './dom.ts';
import { arena } from './arena.ts';
import { hatch } from './fx.ts';
import { fmtDate, roundDetails, slimeCard } from './views.ts';

type Session = Extract<EnterResponse, { ok: true }>;

const app = document.getElementById('app')!;
let session: Session | null = null;

const COPYRIGHT = h(
  'footer',
  {},
  h('b', {}, 'SLIME BREEDER'),
  ' Reborn — a fan restoration of the 1999 game by tatuta.',
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
          ['STM', 'Stamina. Attacking costs 4, evading 1, being hit 6. Below 50% the slime weakens, down to half strength at zero; the drain slows when it is nearly empty. High-status slimes burn it faster.'],
          ['STR', 'Strength: damage per hit.'],
          ['DEX', 'Dexterity: chance an attack lands.'],
          ['SPD', 'Speed: number of attacks and ability to evade.'],
        ].map(([a, b]) => h('tr', {}, h('td', {}, a!), h('td', {}, b!))),
      ),
      d('Heavy slimes hit harder but are less accurate and slower; light slimes are quicker.'),
      h('h3', {}, 'Pedigree'),
      d('Left to right: parents, grandparents, then great-grandparents on your side and on the mate’s side. Names in cyan have already left the ranking; names in blue are links to ranked slimes.'),
      h('h3', {}, 'Battle report'),
      d('LUCK is the average of the random rolls: the first number is the hit roll (target 50), the one in parentheses is the damage roll (target 67). In the log, big O/X are your hits/misses and small o/x are the opponent’s; C/c is a critical hit (about 1% of hits, roughly double damage).'),
      h('h3', {}, 'Ranking'),
      d('Rankings are point-based. A new slime starts with 1 point and fights upward from the bottom of the ladder, meeting only slimes that hold more points than itself (the top three are always fought), until it loses. Beating a slime takes over all of its points; losing never costs points, but the slime that stops your winning streak receives every point you had collected. If you beat the champion you take the title, and a champion who defended it more than 3 times enters the Hall of Fame when dethroned. Only the top 50 stay ranked, and if totals grow too large the whole ladder is divided by 10.'),
      h('h3', {}, 'DNA & evolution'),
      d('Rarely a mutation appears — wings, crown, ribbon, halo, devil, insect, aura, ahoge, zombie, dark or metal — but only when the rest of the DNA suits it, and parts can combine (wings + halo makes an angel). Each trait has two strands; the dominant one shows and the other stays hidden until a later generation. A child gets one strand from each parent, with small mutations that are equally likely to help or hurt. Because weak slimes are picked as mates less often, the species still evolves.'),
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
