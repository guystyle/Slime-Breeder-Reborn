import type {
  CommentView,
  EnterResponse,
  FightResponse,
  HallEntry,
  LineageDetail,
  LineageRow,
  MateResponse,
  NixTable,
  SlimeView,
  TitleMatchLog,
} from '../shared/types.ts';

/** A server error carrying a translatable code. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string | number>,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string; code?: string; params?: Record<string, string | number> };
  if (!res.ok || data.ok === false) throw new ApiError(data.code ?? 'server', data.params ?? {}, data.error ?? 'Request failed');
  return data;
}

export const api = {
  enter: (user: string, pass: string) => call<EnterResponse & { ok: true }>('/api/enter', { user, pass }),
  mate: (token: string, sel: number | 'no') => call<MateResponse>('/api/mate', { token, sel }),
  fight: (token: string, name: string) => call<FightResponse>('/api/fight', { token, name }),
  rank: () => call<{ slimes: SlimeView[] }>('/api/rank'),
  hall: () => call<{ entries: HallEntry[] }>('/api/hall'),
  comments: () => call<{ comments: CommentView[] }>('/api/comments'),
  say: (user: string, text: string) => call<{ ok: true }>('/api/comments', { user, text }),
  lineages: () => call<{ lineages: LineageRow[] }>('/api/lineages'),
  lineage: (no: number, token?: string) => call<LineageDetail>(`/api/lineage/${no}${token ? `?token=${encodeURIComponent(token)}` : ''}`),
  nix: (token: string) => call<NixTable>(`/api/nix?token=${encodeURIComponent(token)}`),
  titleMatches: () => call<{ matches: TitleMatchLog[] }>('/api/title-matches'),
};
