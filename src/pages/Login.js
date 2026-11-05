import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowRight, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { InkMountains } from '@/components/illustrations';
import { useState } from 'react';
import { Button, Callout, Field, Input, SegTabs } from '@/components/ui';
import { configured, humanError, supabase } from '@/lib/supabase';
export default function Login() {
    const [mode, setMode] = useState('password');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const addr = email.trim().toLowerCase();
        try {
            if (mode !== 'password') {
                const { data: ok } = await supabase.rpc('signup_email_allowed', { p_email: addr });
                if (!ok)
                    throw new Error('This email is not on the department list. Ask a department admin to add you.');
            }
            if (mode === 'password') {
                const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
                if (error)
                    throw error;
            }
            else if (mode === 'link') {
                const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: window.location.href, shouldCreateUser: true } });
                if (error)
                    throw error;
                setMsg({ tone: 'ok', text: 'Check your inbox for a sign-in link.' });
            }
            else {
                const { error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: window.location.href } });
                if (error)
                    throw error;
                setMsg({ tone: 'ok', text: 'Account created. Confirm your email if asked, then sign in.' });
            }
        }
        catch (err) {
            setMsg({ tone: 'bad', text: humanError(err) });
        }
        setBusy(false);
    }
    return (_jsxs("div", { className: "min-h-dvh grid lg:grid-cols-2", children: [_jsxs("div", { className: "relative hidden lg:flex flex-col justify-between overflow-hidden bg-hero text-hero-fg p-10", children: [_jsx(InkMountains, { className: "absolute inset-x-0 bottom-0 w-full h-3/5 pointer-events-none" }), _jsx("div", { className: "relative text-sm font-semibold tracking-wide opacity-90", children: "Department of Biomedical Engineering \u00B7 BUET" }), _jsxs("div", { className: "relative", children: [_jsx("h1", { className: "text-3xl font-semibold tracking-tight max-w-md", children: "Every course, exam step and outcome in one place." }), _jsx("p", { className: "mt-3 max-w-md opacity-85", children: "Question papers, class tests, sessional assessments and course outcomes. Everyone knows whose turn it is, from the first week to the HOD." })] }), _jsxs("div", { className: "relative flex items-center justify-between gap-4 text-2xs", children: [_jsx("span", { className: "opacity-80", children: "Access is limited to department faculty." }), _jsxs(Link, { to: "/guide", className: "inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline", children: ["How it works", _jsx(ArrowRight, { className: "size-3.5", "aria-hidden": true })] })] })] }), _jsx("div", { className: "flex items-center justify-center p-6", children: _jsxs("form", { onSubmit: submit, className: "w-full max-w-sm space-y-4", noValidate: true, children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-semibold", children: "Sign in to BME Workflow" }), _jsx("p", { className: "text-sm text-muted mt-1", children: "Use your department email address." })] }), !configured && _jsx(Callout, { tone: "warn", title: "Not configured", children: "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart." }), _jsx(SegTabs, { label: "Sign-in method", value: mode, onChange: (v) => { setMode(v); setMsg(null); }, options: [{ value: 'password', label: 'Password' }, { value: 'link', label: 'Email link' }, { value: 'signup', label: 'First time' }] }), _jsx(Field, { label: "Email", htmlFor: "email", children: _jsx(Input, { id: "email", type: "email", autoComplete: "email", required: true, value: email, onChange: (e) => setEmail(e.target.value), placeholder: "name@bme.buet.ac.bd" }) }), mode !== 'link' && (_jsx(Field, { label: "Password", htmlFor: "pw", hint: mode === 'signup' ? 'At least 8 characters.' : undefined, children: _jsx(Input, { id: "pw", type: "password", autoComplete: mode === 'signup' ? 'new-password' : 'current-password', required: true, minLength: 8, value: password, onChange: (e) => setPassword(e.target.value) }) })), msg && _jsx(Callout, { tone: msg.tone === 'ok' ? 'ok' : 'bad', children: msg.text }), _jsx(Button, { type: "submit", variant: "primary", className: "w-full", loading: busy, icon: mode === 'link' ? _jsx(Mail, { className: "size-4", "aria-hidden": true }) : undefined, disabled: !email || (mode !== 'link' && password.length < 8), children: mode === 'password' ? 'Sign in' : mode === 'link' ? 'Email me a link' : 'Create account' }), _jsx("p", { className: "lg:hidden text-center text-sm", children: _jsx(Link, { to: "/guide", className: "link", children: "New here? See how BME Workflow works" }) })] }) })] }));
}
