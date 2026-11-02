import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

interface Me { facultyId: string | null; role: AppRole }
interface AuthState {
  session: Session | null; me: Me | null; loading: boolean; error: string | null; retry: () => void;
  isAdmin: boolean; isHod: boolean; signOut: () => Promise<void>;
  /** True when the department has switched sign-in off (app_settings.open_access). Everyone acts as an admin. */
  openAccess: boolean;
  /** Open access only: whose tasks to show. A convenience, not a security setting. */
  setActingAs: (facultyId: string | null) => void;
}

const Ctx = createContext<AuthState | null>(null);
const ACTING = 'bme.actingAs';
const readActing = () => { try { return localStorage.getItem(ACTING); } catch { return null; } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [openAccess, setOpenAccess] = useState<boolean | null>(null);
  const [actingAs, setActingAsState] = useState<string | null>(readActing);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Is sign-in required at all? Asked without a session, so it works for every visitor.
  useEffect(() => {
    let live = true;
    setError(null);
    supabase.rpc('app_open_access').then(({ data, error: e }) => {
      if (!live) return;
      // A database without migration 0009 has no switch: fall back to normal sign-in.
      if (e && !/app_open_access|Could not find the function/i.test(e.message)) { setError(e.message || 'Could not reach the server.'); setLoading(false); return; }
      setOpenAccess(data === true);
    });
    return () => { live = false; };
  }, [attempt]);

  useEffect(() => {
    let live = true;
    if (openAccess === null) return;
    if (openAccess) { setMe({ facultyId: actingAs, role: 'hod' }); setLoading(false); return; }
    if (!session) { setMe(null); setLoading(false); return; }
    setLoading(true);
    supabase.rpc('fn_me').then(({ data, error: e }) => {
      if (!live) return;
      if (e) { setError(e.message || 'Could not reach the server.'); setMe(null); setLoading(false); return; }
      const row = (data as { faculty_id: string | null; app_role: AppRole }[] | null)?.[0];
      setMe(row ? { facultyId: row.faculty_id, role: row.app_role } : null);
      setLoading(false);
    });
    return () => { live = false; };
  }, [session, openAccess, actingAs, attempt]);

  const setActingAs = useCallback((id: string | null) => {
    setActingAsState(id);
    try { if (id) localStorage.setItem(ACTING, id); else localStorage.removeItem(ACTING); } catch { /* private mode */ }
  }, []);

  const value = useMemo<AuthState>(() => ({
    session, me, loading, error, retry: () => setAttempt((n) => n + 1),
    isAdmin: me?.role === 'admin' || me?.role === 'hod', isHod: me?.role === 'hod',
    signOut: async () => { await supabase.auth.signOut(); },
    openAccess: openAccess === true, setActingAs,
  }), [session, me, loading, error, openAccess, setActingAs]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
