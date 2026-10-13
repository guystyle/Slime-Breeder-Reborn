import { h } from './dom.ts';

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Floating text (damage numbers, MISS...) that rises from `host` and fades. */
export function floatText(host: HTMLElement, text: string, cls: string) {
  const t = h('span', { class: `float ${cls}` }, text);
  t.style.left = `${35 + Math.random() * 30}%`;
  host.append(t);
  t.animate(
    [
      { transform: 'translateY(0) scale(0.6)', opacity: 0 },
      { transform: 'translateY(-14px) scale(1.2)', opacity: 1, offset: 0.2 },
      { transform: 'translateY(-54px) scale(1)', opacity: 0 },
    ],
    { duration: 900, easing: 'ease-out' },
  ).onfinish = () => t.remove();
}

/** A burst of coloured bits from the centre of `host`. */
export function confetti(host: HTMLElement, n = 36) {
  if (reduceMotion()) return;
  const colors = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#ff9ff3', '#7fffff'];
  const box = h('div', { class: 'confetti' });
  host.append(box);
  for (let i = 0; i < n; i++) {
    const bit = h('i');
    bit.style.background = colors[i % colors.length]!;
    box.append(bit);
    const a = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * 160;
    bit.animate(
      [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 90}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.4,1)' },
    );
  }
  setTimeout(() => box.remove(), 1900);
}

/** An egg that wobbles, cracks and pops; resolves once the newborn can appear. */
export async function hatch(host: HTMLElement): Promise<void> {
  if (reduceMotion()) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 80 100');
  svg.setAttribute('width', '90');
  svg.setAttribute('class', 'egg');
  const egg = document.createElementNS(ns, 'path');
  egg.setAttribute('d', 'M40 4 C62 4 74 44 74 66 C74 86 58 96 40 96 C22 96 6 86 6 66 C6 44 18 4 40 4 Z');
  egg.setAttribute('fill', '#f7f1d4');
  egg.setAttribute('stroke', '#c9b97a');
  egg.setAttribute('stroke-width', '3');
  const crack = document.createElementNS(ns, 'path');
  crack.setAttribute('d', 'M22 50 L32 58 L40 46 L50 60 L58 50');
  crack.setAttribute('fill', 'none');
  crack.setAttribute('stroke', '#7a6a33');
  crack.setAttribute('stroke-width', '3');
  crack.setAttribute('opacity', '0');
  svg.append(egg, crack);
  const wrap = h('div', { class: 'hatch' }, svg);
  host.append(wrap);
  await svg.animate(
    [
      { transform: 'rotate(0)' },
      { transform: 'rotate(-14deg)' },
      { transform: 'rotate(12deg)' },
      { transform: 'rotate(-18deg)' },
      { transform: 'rotate(16deg)' },
      { transform: 'rotate(0)' },
    ],
    { duration: 900, easing: 'ease-in-out' },
  ).finished;
  crack.setAttribute('opacity', '1');
  await sleep(250);
  await svg.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 260, easing: 'ease-out' }).finished;
  wrap.remove();
  confetti(host, 24);
}
