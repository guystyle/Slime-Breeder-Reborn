import { h } from './dom.ts';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let fxOn = true;
try {
  fxOn = localStorage.getItem('slime-fx') !== 'off';
} catch {
  /* ignore */
}

/** Particle effects and big motion are skipped when the user asks for reduced motion or turns them off. */
export const reduceMotion = () => reducedMotion() || !fxOn;
export const fxEnabled = () => fxOn && !reducedMotion();
export function setFx(on: boolean) {
  fxOn = on;
  document.documentElement.classList.toggle('no-fx', !on);
  try {
    localStorage.setItem('slime-fx', on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

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

/** CSS colour with plain decimals: tiny floats print as 1e-7, which some browsers reject in canvas gradients. */
const hsla = (h: number, sat: number, light: number, a: number) => `hsla(${h.toFixed(1)},${sat}%,${light}%,${Math.min(1, Math.max(0, a)).toFixed(3)})`;

// ---------------------------------------------------------------------------
// Ambient particles: drifting bubbles, twinkling stars, cursor sparkles.
// One fixed canvas behind the page; cheap enough to leave running.
// ---------------------------------------------------------------------------

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  life: number; // seconds left, Infinity for ambient
  max: number;
  kind: 'bubble' | 'star' | 'spark';
  phase: number;
}

export function startAmbient(): void {
  const canvas = h('canvas', { id: 'ambient', 'aria-hidden': 'true' });
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let w = 0;
  let hgt = 0;
  const parts: P[] = [];
  const mouse = { x: -999, y: -999, lx: -999, ly: -999 };

  const small = matchMedia('(max-width: 700px)').matches; // fewer particles and a cheaper canvas on phones
  const resize = () => {
    const dpr = Math.min(small ? 1.5 : 2, devicePixelRatio || 1);
    w = innerWidth;
    hgt = innerHeight;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  for (let i = 0; i < (small ? 12 : 26); i++) parts.push({ x: rnd(0, w), y: rnd(0, hgt), vx: rnd(-6, 6), vy: rnd(-22, -6), r: rnd(6, 26), hue: rnd(150, 330), life: Infinity, max: 1, kind: 'bubble', phase: rnd(0, 6.28) });
  for (let i = 0; i < (small ? 22 : 46); i++) parts.push({ x: rnd(0, w), y: rnd(0, hgt), vx: 0, vy: 0, r: rnd(1, 2.6), hue: rnd(40, 300), life: Infinity, max: 1, kind: 'star', phase: rnd(0, 6.28) });

  const spark = (x: number, y: number, n = 1, speed = 40) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(speed * 0.3, speed);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, r: rnd(2, 5), hue: rnd(0, 360), life: rnd(0.5, 1.1), max: 1.1, kind: 'spark', phase: rnd(0, 6.28) });
    }
  };

  addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (!fxEnabled()) return;
    const d = Math.hypot(mouse.x - mouse.lx, mouse.y - mouse.ly);
    if (d > 14) {
      spark(mouse.x, mouse.y, 1, 30);
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
    }
  });
  addEventListener('pointerdown', (e) => fxEnabled() && spark(e.clientX, e.clientY, 16, 120));

  let last = performance.now();
  const star = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x - r * 2, y);
    ctx.lineTo(x + r * 2, y);
    ctx.moveTo(x, y - r * 2);
    ctx.lineTo(x, y + r * 2);
    ctx.stroke();
  };
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, w, hgt);
    if (!fxEnabled()) return;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]!;
      p.phase += dt;
      if (p.kind === 'bubble') {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < 120 && d > 0) {
          p.vx += (dx / d) * 90 * dt;
          p.vy += (dy / d) * 90 * dt;
        }
        p.vx *= 0.99;
        p.x += (p.vx + Math.sin(p.phase * 0.8) * 8) * dt;
        p.y += p.vy * dt;
        if (p.y < -40) {
          p.y = hgt + 30;
          p.x = rnd(0, w);
          p.vy = rnd(-22, -6);
        }
        if (p.x < -40) p.x = w + 30;
        if (p.x > w + 40) p.x = -30;
        const g = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.1, p.x, p.y, p.r);
        g.addColorStop(0, hsla(p.hue, 100, 90, 0.28));
        g.addColorStop(1, hsla(p.hue, 100, 60, 0.05));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fill();
        ctx.strokeStyle = hsla(p.hue, 100, 85, 0.25);
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (p.kind === 'star') {
        const a = 0.2 + 0.6 * Math.abs(Math.sin(p.phase * 1.2));
        ctx.strokeStyle = hsla(p.hue, 100, 85, a);
        ctx.lineWidth = 1;
        star(p.x, p.y, p.r);
      } else {
        p.life -= dt;
        if (p.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        p.vy += 40 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = Math.max(0, p.life / p.max);
        ctx.strokeStyle = hsla(p.hue, 100, 75, a);
        ctx.lineWidth = 1.5;
        star(p.x, p.y, p.r * a + 1);
      }
    }
  };
  requestAnimationFrame(frame);
}

/** Pulse a short sparkle burst at an element (used on new results and champions). */
export function sparkleAt(el: Element) {
  if (!fxEnabled()) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    const s = h('i', { class: 'spark-bit' });
    s.style.left = `${r.left + Math.random() * r.width}px`;
    s.style.top = `${r.top + Math.random() * r.height}px`;
    s.style.setProperty('--h', String(Math.floor(Math.random() * 360)));
    document.body.append(s);
    s.animate(
      [
        { transform: 'translateY(0) scale(0)', opacity: 1 },
        { transform: `translate(${(Math.random() - 0.5) * 40}px, -30px) scale(1)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${(Math.random() - 0.5) * 60}px, -60px) scale(0.2)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 400, easing: 'ease-out', delay: Math.random() * 200 },
    ).onfinish = () => s.remove();
  }
}
