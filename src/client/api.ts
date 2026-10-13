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
    readonly detail?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // offline, blocked, or the connection dropped
    throw new ApiError('server', {}, 'Network error', `network: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Read the text first: a platform error page (timeout, crash) is not JSON, and Safari reports a failed
  // res.json() only as "The string did not match the expected pattern", which hides what really happened.
  const text = await res.text();
  let data: (T & { ok?: boolean; error?: string; code?: string; params?: Record<string, string | number>; detail?: string }) | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 140);
    throw new ApiError('server', {}, 'Unexpected response', `HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`);
  }
  if (!res.ok || data?.ok === false) throw new ApiError(data?.code ?? 'server', data?.params ?? {}, data?.error ?? 'Request failed', data?.detail);
  return data as T;
}

export const api = {
  enter: (user: string, pass: string, remember = false) => call<EnterResponse & { ok: true }>('/api/enter', { user, pass, remember }),
  /** Continue with the remembered device (HttpOnly cookie); rejects with code 'no-login' or 'cooldown'. */
  resume: () => call<EnterResponse & { ok: true }>('/api/resume', {}),
  me: () => call<{ user: string | null }>('/api/me'),
  logout: () => call<{ ok: true }>('/api/logout', {}),
  mate: (token: string, sel: number | 'no') => call<MateResponse>('/api/mate', { token, sel }),
  fight: (token: string, name: string) => call<FightResponse>('/api/fight', { token, name }),
  rank: () => call<{ slimes: SlimeView[] }>('/api/rank'),
  hall: () => call<{ entries: HallEntry[] }>('/api/hall'),
  comments: () => call<{ comments: CommentView[] }>('/api/comments'),
  say: (user: string, text: string) => call<{ ok: true }>('/api/comments', { user, text }),
  lineages: () => call<{ lineages: LineageRow[] }>('/api/lineages'),
  lineage: (no: number, token?: string) => call<LineageDetail>(`/api/lineage?no=${no}${token ? `&token=${encodeURIComponent(token)}` : ''}`),
  nix: (token: string) => call<NixTable>(`/api/nix?token=${encodeURIComponent(token)}`),
  titleMatches: () => call<{ matches: TitleMatchLog[] }>('/api/title-matches'),
};
