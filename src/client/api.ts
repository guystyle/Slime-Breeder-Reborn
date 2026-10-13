import type {
  CommentView,
  EnterResponse,
  FightResponse,
  HallEntry,
  MateResponse,
  SlimeView,
} from '../shared/types.ts';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error ?? 'Request failed');
  return data;
}

export const api = {
  enter: (user: string, pass: string) => call<EnterResponse & { ok: true }>('/api/enter', { user, pass }),
  mate: (token: string, sel: number) => call<MateResponse>('/api/mate', { token, sel }),
  fight: (token: string, name: string) => call<FightResponse>('/api/fight', { token, name }),
  rank: () => call<{ slimes: SlimeView[] }>('/api/rank'),
  hall: () => call<{ entries: HallEntry[] }>('/api/hall'),
  comments: () => call<{ comments: CommentView[] }>('/api/comments'),
  say: (user: string, text: string) => call<{ ok: true }>('/api/comments', { user, text }),
};
