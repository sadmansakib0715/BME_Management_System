import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
const Ctx = createContext(null);
const ACTING = 'bme.actingAs';
const readActing = () => { try {
    return localStorage.getItem(ACTING);
}
catch {
    return null;
} };
export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [me, setMe] = useState(null);
    const [openAccess, setOpenAccess] = useState(null);
    const [actingAs, setActingAsState] = useState(readActing);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
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
            if (!live)
                return;
            // A database without migration 0009 has no switch: fall back to normal sign-in.
            if (e && !/app_open_access|Could not find the function/i.test(e.message)) {
                setError(e.message || 'Could not reach the server.');
                setLoading(false);
                return;
            }
            setOpenAccess(data === true);
        });
        return () => { live = false; };
    }, [attempt]);
    useEffect(() => {
        let live = true;
        if (openAccess === null)
            return;
        if (openAccess) {
            setMe({ facultyId: actingAs, role: 'hod' });
            setLoading(false);
            return;
        }
        if (!session) {
            setMe(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        supabase.rpc('fn_me').then(({ data, error: e }) => {
            if (!live)
                return;
            if (e) {
                setError(e.message || 'Could not reach the server.');
                setMe(null);
                setLoading(false);
                return;
            }
            const row = data?.[0];
            setMe(row ? { facultyId: row.faculty_id, role: row.app_role } : null);
            setLoading(false);
        });
        return () => { live = false; };
    }, [session, openAccess, actingAs, attempt]);
    const setActingAs = useCallback((id) => {
        setActingAsState(id);
        try {
            if (id)
                localStorage.setItem(ACTING, id);
            else
                localStorage.removeItem(ACTING);
        }
        catch { /* private mode */ }
    }, []);
    const value = useMemo(() => ({
        session, me, loading, error, retry: () => setAttempt((n) => n + 1),
        isAdmin: me?.role === 'admin' || me?.role === 'hod', isHod: me?.role === 'hod',
        signOut: async () => { await supabase.auth.signOut(); },
        openAccess: openAccess === true, setActingAs,
    }), [session, me, loading, error, openAccess, setActingAs]);
    return _jsx(Ctx.Provider, { value: value, children: children });
}
export function useAuth() {
    const v = useContext(Ctx);
    if (!v)
        throw new Error('useAuth outside AuthProvider');
    return v;
}
