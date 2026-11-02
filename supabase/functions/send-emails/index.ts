// Supabase Edge Function: delivers pending rows of notifications_outbox by email (Resend).
// Deploy:   supabase functions deploy send-emails --no-verify-jwt
// Secrets:  supabase secrets set RESEND_API_KEY=... MAIL_FROM="BME Workflow <noreply@your-domain>" APP_URL=https://...
// Schedule: see README (pg_cron calls enqueue_reminders() daily and this function every 10 minutes).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const RESEND = Deno.env.get('RESEND_API_KEY');
const FROM = Deno.env.get('MAIL_FROM') ?? 'BME Workflow <onboarding@resend.dev>';
const APP_URL = Deno.env.get('APP_URL') ?? '';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

Deno.serve(async () => {
  const { data: rows, error } = await db.from('notifications_outbox')
    .select('id, subject, body, faculty:to_faculty (email, display_name)')
    .eq('status', 'pending').order('created_at').limit(50);
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0, failed = 0, skipped = 0;
  for (const r of rows ?? []) {
    const f = r.faculty as unknown as { email: string | null; display_name: string } | null;
    if (!f?.email || !RESEND) {
      await db.from('notifications_outbox').update({ status: 'skipped', error: !RESEND ? 'RESEND_API_KEY not set' : 'No email on file' }).eq('id', r.id);
      skipped++; continue;
    }
    const html = `<p>Dear ${esc(f.display_name)},</p><p>${esc(r.body)}</p>${APP_URL ? `<p><a href="${APP_URL}">Open BME Workflow</a></p>` : ''}
      <p style="color:#64748b;font-size:12px">Department of BME, BUET · automated message</p>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [f.email], subject: r.subject, html }),
    });
    if (res.ok) { await db.from('notifications_outbox').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id); sent++; }
    else { await db.from('notifications_outbox').update({ status: 'failed', error: (await res.text()).slice(0, 500) }).eq('id', r.id); failed++; }
  }
  return Response.json({ sent, failed, skipped });
});
