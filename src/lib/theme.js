import { useCallback, useEffect, useState } from 'react';
const KEY = 'bme-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
function readPref() {
    try {
        const v = localStorage.getItem(KEY);
        if (v === 'light' || v === 'dark' || v === 'system')
            return v;
    }
    catch { /* storage blocked */ }
    return 'system';
}
function apply(pref) {
    const dark = pref === 'dark' || (pref === 'system' && media().matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1c1c1c' : '#fafaf9');
}
export function useTheme() {
    const [pref, setPrefState] = useState(readPref);
    useEffect(() => {
        apply(pref);
        if (pref !== 'system')
            return;
        const m = media();
        const on = () => apply('system');
        m.addEventListener('change', on);
        return () => m.removeEventListener('change', on);
    }, [pref]);
    const setPref = useCallback((p) => {
        try {
            localStorage.setItem(KEY, p);
        }
        catch { /* storage blocked */ }
        setPrefState(p);
    }, []);
    return { pref, setPref };
}
