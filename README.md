# BME Workflow

Course workflow and outcome-based education (OBE) system for the Department of Biomedical Engineering, BUET.
It replaces the term Activity Tracker spreadsheet and computes CO/PO attainment from marks stored in the system.

Version 1 covers **Phase 1 (workflow parity)** and **Phase 2 (OBE core)** of the product specification.

| Area | What it does |
| --- | --- |
| My work | One task feed per person across exam steps, class tests, marks, gradesheets and course records, ordered by urgency, including "waiting on" whom |
| Theory exam chain | QP A/B → Moderation 1/2 (with "needs correction" rounds per half) → Printing → Script examination A/B → Scrutiny → Gradesheet prep → Gradesheet scrutiny → HOD. Examiner and gradesheet roles are derived, never typed |
| Sessional courses | A1/A2 tracked separately: assessment plans per sub-section, marks, and the sessional gradesheet chain |
| Class tests | Dates, statuses, date history with reasons, and a hard block on two class tests for the same cohort on one day (admin override with reason) |
| Assessment plan | Components (CT, term final, lab report, viva…), counts, marks, weights, best-N; items are generated automatically |
| Marks | Grid per item with Excel paste, AB/EX flags, validation against question maxima, Entering → Verified → Published → Locked |
| Course outcomes | COs with Bloom domain/level, CO–PO mapping (strength 1–3) against the department's PO1–PO12 |
| Attainment | CO attained if X% of students score ≥ Y%; best-N per student; correlation-weighted PO contribution; snapshots for the CAR; CSV export |
| Program view | Curriculum CO–PO coverage matrix and credit-weighted program PO attainment |
| Department | HOD overview (funnel, course health, workload, setup gaps), assignments, term setup, people & access, workbook import |

## Architecture

- **Frontend:** React 18 + TypeScript + Vite + Tailwind, static, deployable to GitHub Pages (HashRouter, no server rewrites).
- **Backend:** Supabase (Postgres 15, Auth, Edge Functions). **Row-level security is the only security boundary.**
  Workflow rules (dependencies, ownership, correction loop, CT clashes, mark locks, assignment rules) are enforced
  in the database by constraints, triggers and `security definer` functions; the UI mirrors them only to explain them.
- **Privacy:** student rows and marks are visible only to the course's teachers, its exam-role holders and admins.
  Everything else (courses, assignments, statuses, calendar) is readable by all active faculty.
- **Audit:** inserts/updates/deletes on assignments, exam tasks, items, components, outcomes, marks, access and deadlines are logged with old/new values.

```
src/lib/        workflow.ts (exam chain), attainment.ts (OBE maths), importer.ts (workbook), tasks.ts (task feed), api.ts (data)
src/pages/      Home, Courses, course/* (tabs), Calendar, Outcomes, Dashboard, admin/*
supabase/       migrations/0001–0008, seed.sql (POs, PEOs, catalog), seed_demo.sql (fictional), functions/send-emails, tests/
tests/          unit tests (workflow, attainment, importer, dates)
```

## Setup

### 1. Supabase project
1. Create a project at supabase.com (free tier is enough to start).
2. In **SQL Editor**, paste and run `supabase/setup.sql` (all migrations plus reference data in one file).
   (Or with the CLI: `supabase link`, `supabase db push`, then run `seed.sql`.)
3. **Authentication → Providers → Email:** enable. **Authentication → URL configuration:** set the Site URL to where the app is hosted.
4. Add yourself as the first HOD (replace the values) in the SQL Editor:
   ```sql
   insert into public.faculty (full_name, display_name, designation, email)
   values ('Your Name', 'Dr. Your Name', 'Professor', 'you@bme.buet.ac.bd') returning id;
   insert into public.allowed_users (email, faculty_id, app_role)
   values ('you@bme.buet.ac.bd', '<id from above>', 'hod');
   ```
   Only allow-listed emails can create an account. Add everyone else from **People & access** in the app.

### 2. Run locally
```bash
cp .env.example .env        # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Settings → API)
npm ci
npm run dev                 # http://localhost:5173
```
Sign in with **First time** to create your password, then **Password**.

To explore with fictional data instead, run `supabase/seed_demo.sql` on a development project and sign up as
`hod@example.edu`, `kamal@example.edu` (admin) or `farhan@example.edu` (faculty).

### 3. Load the current term
**Import workbook** (admins): choose the Activity Tracker `.xlsx`. It is parsed in the browser; the preview lists every
automatic fix (date formats, code spacing, spelling, name variants) and every item needing review. Nothing is written
until you press Import; re-importing the same term updates it in place. Then, per course, add students (paste from
Excel or copy from another course of the same cohort), define COs, and build the assessment plan.

### 4. Deploy to GitHub Pages
1. Repo **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Push to `main`. `.github/workflows/deploy.yml` tests, builds and publishes. Add the Pages URL to Supabase's redirect URLs.

### 5. Email notifications (optional)
```bash
supabase functions deploy send-emails --no-verify-jwt
supabase secrets set RESEND_API_KEY=... MAIL_FROM="BME Workflow <noreply@your-domain>" APP_URL=https://<pages-url>
```
Then in SQL (enable the `pg_cron` and `pg_net` extensions first):
```sql
select cron.schedule('bme-reminders', '0 2 * * *', $$select public.enqueue_reminders()$$);          -- 08:00 Dhaka
select cron.schedule('bme-send-mail', '*/10 * * * *', $$select net.http_post(
  url := 'https://<project-ref>.supabase.co/functions/v1/send-emails', body := '{}'::jsonb)$$);
```
The database queues messages when a step unlocks, a paper is returned for correction, and 7/3/1/0 days before
deadlines (then daily while overdue, up to five days).

## Testing
```bash
npm test                                   # unit tests
TRACKER_XLSX=/path/to/tracker.xlsx npm test # also runs the importer against a real workbook (never commit it)
DB_URL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:db   # migrations + integration checks
```
`supabase/tests/integration.sql` signs in as different users and checks: the sign-up gate; marks hidden from
unrelated faculty; direct writes to exam tasks refused; dependency and ownership blocks; the full correction loop;
CT clash detection; over-maximum and locked marks; item generation per sub-section; roster loading; admin-only import.

## Open access (no sign-in)
The database has one switch, `app_settings.open_access`, and `supabase/setup.sql` turns it **on**:
nobody signs in, every visitor acts as an admin, and the sidebar shows a **Viewing as** picker so
**My work** still lists that person's tasks. The picker is a convenience, not security.

While it is on, anyone with the site link (or the database URL and anon key, which every visitor's
browser receives) can read, change or delete everything, including student marks, and changes are not
attributed to a person. Use it for setup and testing; switch it off before entering real marks:

```sql
update public.app_settings set open_access = false;   -- require sign-in (add a HOD first: first_admin.sql)
update public.app_settings set open_access = true;    -- open again
```
The switch cannot be changed from the website, only in the Supabase SQL Editor.

## Rules worth knowing
- **Attainment thresholds** (X, Y, level cut-offs) are set per term in **Term setup** (defaults 60 / 50; levels 50 / 60 / 70).
- Only items with **Published** or **Locked** marks count towards attainment.
- **Locked** marks can only be reopened by an admin; every change is in the audit log.
- Gradesheet preparation is blocked until all class-test marks (theory) or all items in every sub-section (sessional) are published. Admins can override with a note.

## Data safety
`.gitignore` excludes `*.xlsx`, `*.csv` and `.env*`. **Never commit department workbooks, rosters or exports.**
If a workbook was committed before, remove it from history (`git filter-repo --path '<file>' --invert-paths`) and force-push.

## Not in this version (next phases)
Course File/CAR document generation and CQI tracking, thesis and design-project modules, notices, meetings and minutes,
leave, lab inventory, purchase requisitions, class routine, and grade computation/export.
