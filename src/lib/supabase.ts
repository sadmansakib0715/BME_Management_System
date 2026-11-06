import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

/** localStorage key of the name chosen under "Viewing as" while open access is on. */
export const ACTING_KEY = 'bme.actingAs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let sendActing = true;
/** Sends the "Viewing as" name with database requests (x-acting-as) so the activity log (0017) can say who made a change while
    nobody signs in. Signed in, the database uses the account and ignores it. If a server ever refuses the header, it is dropped. */
const actingFetch: typeof fetch = async (input, init) => {
  let id: string | null = null;
  try { id = localStorage.getItem(ACTING_KEY); } catch { /* private window */ }
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!sendActing || !id || !UUID.test(id) || !target.includes('/rest/v1/')) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-acting-as', id);
  try { return await fetch(input, { ...init, headers }); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    // Network-level failure, possibly the header being refused: stop sending it. Reads are retried at once; a write is not
    // repeated blindly (it may have reached the server), so its error shows and trying again works.
    sendActing = false;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' || method === 'HEAD') return fetch(input, init);
    throw e;
  }
};

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: actingFetch },
});

/** Turns a Supabase / Postgres error into one sentence a person can act on. */
export function humanError(e: unknown): string {
  const err = e as { message?: string; details?: string; hint?: string; code?: string };
  const msg = err?.message ?? String(e);
  if (err?.code === '23514' || /violates check constraint/.test(msg)) {
    if (/qp_distinct/.test(msg)) return 'Question preparers A and B must be different people.';
    if (/moderators_distinct/.test(msg)) return 'The two moderators must be different people.';
    if (/mod[12]_not_preparer/.test(msg)) return 'A moderator cannot be one of the question preparers.';
    if (/scrutinizer_not_qp/.test(msg)) return 'The scrutinizer cannot be one of the question preparers.';
    if (/preparer_not_scrutinizer/.test(msg)) return 'Gradesheet preparer and scrutinizer must be different people.';
    return 'That value is not allowed here.';
  }
  if (err?.code === '23505') return 'That already exists.';
  if (err?.code === '42501' && /row-level security/.test(msg)) return 'You do not have permission to change this.';
  return err?.hint ? `${msg} ${err.hint}` : msg;
}
