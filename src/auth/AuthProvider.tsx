import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

interface Me { facultyId: string | null; role: AppRole }
interface AuthState { session: Session | null; me: Me | null; loading: boolean; error: string | null; retry: () => void; isAdmin: boolean; isHod: boolean; signOut: () => Promise<void> }

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let live = true;
    if (!session) { setMe(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    supabase.rpc('fn_me').then(({ data, error: e }) => {
      if (!live) return;
      if (e) { setError(e.message || 'Could not reach the server.'); setMe(null); setLoading(false); return; }
      const row = (data as { faculty_id: string | null; app_role: AppRole }[] | null)?.[0];
      setMe(row ? { facultyId: row.faculty_id, role: row.app_role } : null);
      setLoading(false);
    });
    return () => { live = false; };
  }, [session, attempt]);

  const value = useMemo<AuthState>(() => ({
    session, me, loading, error, retry: () => setAttempt((n) => n + 1),
    isAdmin: me?.role === 'admin' || me?.role === 'hod', isHod: me?.role === 'hod',
    signOut: async () => { await supabase.auth.signOut(); },
  }), [session, me, loading, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
