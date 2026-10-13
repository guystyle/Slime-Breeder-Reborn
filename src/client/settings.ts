import { DEFAULT_COOLDOWN_MIN } from '../shared/ladder.ts';

/** Server-side rules the UI mentions; loaded once at start-up (the defaults apply if the request fails). */
export const settings = { cooldownMin: DEFAULT_COOLDOWN_MIN };

export async function loadSettings(): Promise<void> {
  try {
    const res = await fetch('/api/config');
    const data = (await res.json()) as { cooldownMin?: number };
    if (typeof data.cooldownMin === 'number') settings.cooldownMin = data.cooldownMin;
  } catch {
    /* keep defaults */
  }
}
