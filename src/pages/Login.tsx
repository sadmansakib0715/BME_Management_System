import { Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Callout, Field, Input, SegTabs } from '@/components/ui';
import { configured, humanError, supabase } from '@/lib/supabase';

export default function Login() {
  const [mode, setMode] = useState<'password' | 'link' | 'signup'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const addr = email.trim().toLowerCase();
    try {
      if (mode !== 'password') {
        const { data: ok } = await supabase.rpc('signup_email_allowed', { p_email: addr });
        if (!ok) throw new Error('This email is not on the department list. Ask a department admin to add you.');
      }
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (error) throw error;
      } else if (mode === 'link') {
        const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: window.location.href, shouldCreateUser: true } });
        if (error) throw error;
        setMsg({ tone: 'ok', text: 'Check your inbox for a sign-in link.' });
      } else {
        const { error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: window.location.href } });
        if (error) throw error;
        setMsg({ tone: 'ok', text: 'Account created. Confirm your email if asked, then sign in.' });
      }
    } catch (err) { setMsg({ tone: 'bad', text: humanError(err) }); }
    setBusy(false);
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand text-brand-fg p-10">
        <div className="text-sm font-semibold tracking-wide opacity-90">Department of Biomedical Engineering · BUET</div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight max-w-md">Every course, exam step and outcome in one place.</h1>
          <p className="mt-3 max-w-md opacity-85">Question papers, class tests, sessional assessments, marks and CO/PO attainment, tracked from the first week to the CAR.</p>
        </div>
        <div className="text-2xs opacity-75">Access is limited to department faculty.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4" noValidate>
          <div><h2 className="text-xl font-semibold">Sign in to BME Workflow</h2><p className="text-sm text-muted mt-1">Use your department email address.</p></div>
          {!configured && <Callout tone="warn" title="Not configured">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart.</Callout>}
          <SegTabs label="Sign-in method" value={mode} onChange={(v) => { setMode(v); setMsg(null); }}
            options={[{ value: 'password', label: 'Password' }, { value: 'link', label: 'Email link' }, { value: 'signup', label: 'First time' }]} />
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@bme.buet.ac.bd" />
          </Field>
          {mode !== 'link' && (
            <Field label="Password" htmlFor="pw" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              <Input id="pw" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {msg && <Callout tone={msg.tone === 'ok' ? 'ok' : 'bad'}>{msg.text}</Callout>}
          <Button type="submit" variant="primary" className="w-full" loading={busy} icon={mode === 'link' ? <Mail className="size-4" aria-hidden /> : undefined}
            disabled={!email || (mode !== 'link' && password.length < 8)}>
            {mode === 'password' ? 'Sign in' : mode === 'link' ? 'Email me a link' : 'Create account'}
          </Button>
        </form>
      </div>
    </div>
  );
}
