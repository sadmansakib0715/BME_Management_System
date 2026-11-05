import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
/** Turns a Supabase / Postgres error into one sentence a person can act on. */
export function humanError(e) {
    const err = e;
    const msg = err?.message ?? String(e);
    if (err?.code === '23514' || /violates check constraint/.test(msg)) {
        if (/qp_distinct/.test(msg))
            return 'Question preparers A and B must be different people.';
        if (/moderators_distinct/.test(msg))
            return 'The two moderators must be different people.';
        if (/mod[12]_not_preparer/.test(msg))
            return 'A moderator cannot be one of the question preparers.';
        if (/scrutinizer_not_qp/.test(msg))
            return 'The scrutinizer cannot be one of the question preparers.';
        if (/preparer_not_scrutinizer/.test(msg))
            return 'Gradesheet preparer and scrutinizer must be different people.';
        return 'That value is not allowed here.';
    }
    if (err?.code === '23505')
        return 'That already exists.';
    if (err?.code === '42501' && /row-level security/.test(msg))
        return 'You do not have permission to change this.';
    return err?.hint ? `${msg} ${err.hint}` : msg;
}
