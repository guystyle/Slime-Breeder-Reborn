import type { BattleReport } from '../shared/battle.ts';
import { spriteSize } from '../shared/stats.ts';
import type { SlimeView } from '../shared/types.ts';
import { h } from './dom.ts';
import { confetti, floatText, reduceMotion, sleep } from './fx.ts';
import { sprite } from './sprite.ts';

interface Side {
  root: HTMLElement;
  body: HTMLElement;
  hp: HTMLElement;
  stm: HTMLElement;
  hpText: HTMLElement;
}

function side(s: Pick<SlimeView, 'name' | 'color' | 'stats' | 'forms'>, maxHp: number, flip: boolean): Side {
  const size = Math.min(200, Math.round(spriteSize(s.stats.weight) * 1.5));
  const hp = h('div', { class: 'bar-fill hp' });
  const stm = h('div', { class: 'bar-fill stm' });
  const hpText = h('span', { class: 'bar-text' }, `${maxHp}`);
  const body = h('div', { class: 'fighter-body' }, sprite(s.color, size, s.forms ?? [], { flip }));
  const root = h(
    'div',
    { class: 'fighter' },
    h('div', { class: 'fighter-name' }, s.name),
    h('div', { class: 'bar' }, hp, hpText),
    h('div', { class: 'bar small' }, stm),
    body,
  );
  return { root, body, hp, stm, hpText };
}

export interface Arena {
  el: HTMLElement;
  /** Plays the replay; resolves when it ends (or is skipped). */
  play(): Promise<void>;
  skip(): void;
}

/**
 * Animated replay of one battle. Left = the challenger. The ledger below the
 * arena (numbers, log) is shown by the caller once `play()` resolves.
 */
export function arena(me: Pick<SlimeView, 'name' | 'color' | 'stats' | 'forms'>, foe: SlimeView, rep: BattleReport, title: boolean): Arena {
  const A = side(me, rep.a.maxHp, false);
  const B = side(foe, rep.b.maxHp, true);
  const caption = h('div', { class: 'arena-caption' }, title ? 'TITLE MATCH!' : 'Fight!');
  const skipBtn = h('button', { type: 'button', class: 'skip' }, 'Skip ▸▸');
  const el = h('div', { class: 'arena' + (title ? ' title-match' : '') }, caption, h('div', { class: 'arena-row' }, A.root, h('div', { class: 'vs' }, 'VS'), B.root), skipBtn);

  let skipped = false;
  const setBars = (s: Side, hp: number, max: number, stm: number) => {
    s.hp.style.width = `${Math.max(0, (100 * hp) / max)}%`;
    s.hpText.textContent = `${Math.max(0, hp)}/${max}`;
    s.stm.style.width = `${stm}%`;
  };
  setBars(A, rep.a.maxHp, rep.a.maxHp, 100);
  setBars(B, rep.b.maxHp, rep.b.maxHp, 100);

  const lunge = (att: Side, dir: 1 | -1) =>
    att.body.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${dir * 46}px) scaleX(1.12)`, offset: 0.4 }, { transform: 'translateX(0)' }],
      { duration: 240, easing: 'ease-out' },
    );
  const shake = (def: Side) =>
    def.body.animate(
      [
        { transform: 'translateX(0)', filter: 'none' },
        { transform: 'translateX(-9px) scale(0.92,1.08)', filter: 'brightness(2.2) saturate(0.3)', offset: 0.25 },
        { transform: 'translateX(7px) scale(1.08,0.92)', filter: 'brightness(1.5)', offset: 0.6 },
        { transform: 'translateX(0)', filter: 'none' },
      ],
      { duration: 300 },
    );
  const dodge = (def: Side) =>
    def.body.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-26px) rotate(-6deg)', offset: 0.45 }, { transform: 'translateY(0)' }],
      { duration: 320, easing: 'ease-out' },
    );

  async function play() {
    if (reduceMotion()) return finish();
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    await sleep(500);
    const n = rep.events.length;
    const gap = Math.max(70, Math.min(300, 9000 / Math.max(1, n)));
    for (const ev of rep.events) {
      if (skipped) break;
      const [att, def, dir] = ev.who === 'a' ? [A, B, 1 as const] : [B, A, -1 as const];
      void lunge(att, dir);
      await sleep(gap * 0.35);
      if (skipped) break;
      if (ev.hit) {
        void shake(def);
        floatText(def.body, `-${ev.dmg}`, 'dmg');
      } else {
        void dodge(def);
        floatText(def.body, 'miss', 'miss');
      }
      setBars(A, ev.hpA, rep.a.maxHp, ev.stmA);
      setBars(B, ev.hpB, rep.b.maxHp, ev.stmB);
      await sleep(gap * 0.65);
    }
    return finish();
  }

  async function finish() {
    const win = rep.winner === 'a';
    // snap bars to the final state so a skipped replay still ends correctly
    const last = rep.events[rep.events.length - 1];
    if (last) {
      setBars(A, last.hpA, rep.a.maxHp, last.stmA);
      setBars(B, last.hpB, rep.b.maxHp, last.stmB);
    }
    skipBtn.remove();
    caption.textContent = win ? (title ? 'New champion!' : 'Victory!') : 'Defeated…';
    caption.classList.add(win ? 'win' : 'lose');
    const [w, l] = win ? [A, B] : [B, A];
    l.body.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.1,0.5) translateY(28px)', opacity: 0.45 }], { duration: 500, fill: 'forwards', easing: 'ease-in' });
    if (!reduceMotion()) {
      w.body.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-30px)' }, { transform: 'translateY(0)' }], { duration: 560, iterations: 2, easing: 'ease-out' });
      if (win) confetti(el, title ? 70 : 36);
      await sleep(900);
    }
  }

  skipBtn.addEventListener('click', () => {
    skipped = true;
  });
  return { el, play, skip: () => (skipped = true) };
}
