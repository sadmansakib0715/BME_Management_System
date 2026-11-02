# BME Workflow

Course workflow and notification system for the Department of Biomedical Engineering, BUET.
It replaces the term Activity Tracker spreadsheet and keeps everyone informed of whose turn it is.
**Marks are not kept here**; the site tracks roles, exam steps, class-test dates, whether each item's marks are
under evaluation or published (a status only), and course outcomes (OBE).

| Area | What it does |
| --- | --- |
| My courses | Start page: each course you teach or examine with its progress and your part, plus your calendar of class tests and exams |
| Department | Open to all faculty: overview, all courses, the shared calendar and program outcomes (workload and setup gaps for HOD/admins) |
| Theory exam chain | QP A/B → Moderation 1/2 (with "needs correction" rounds per half) → Printing → Script examination A/B → Scrutiny → Gradesheet prep → Gradesheet scrutiny → HOD. Examiner and gradesheet roles are derived, never typed |
| Sessional courses | A1/A2 tracked separately: assessment plans per sub-section and the sessional gradesheet chain |
| Class tests | Dates, colour-coded statuses (planned → held) and marks status (not evaluated → under evaluation → published), date history with reasons, and a hard block on two class tests for the same cohort on one day (admin override with reason) |
| Assessment plan | Components (CT, term final, lab report, viva…), counts and weights; items are generated automatically |
| Course outcomes | COs with Bloom domain/level, CO–PO mapping (strength 1–3) against the department's PO1–PO12 |
| OBE (course) | Per offering: COs with taxonomy levels, delivery and tools; CO–PO and K/P/A mapping (binary, as CO-PO Mapping.docx); imported cohort CO% / PO% with Y/N at ≥ 40% and NA for unmapped POs; course-file checklist; CAR (parts A–B from data, C–E written, Draft → Submitted → Reviewed → Final) |
| OBE (program) | Course dashboard, program PO per batch from BME 300/350/400, CO–PO coverage, BUGS resolutions, CQI log (CO / PO / PEO loops), PEOs, POs, K/P/A |
| Term setup | Two ways: import the workbook, or set up by hand (term & dates, courses & sections, teachers & roles, class-test routine) |

## Architecture

- **Frontend:** React 18 + TypeScript + Vite + Tailwind, static, deployable to GitHub Pages (HashRouter, no server rewrites).
- **Backend:** Supabase (Postgres 15, Auth, Edge Functions). **Row-level security is the only security boundary.**
  Workflow rules (dependencies, ownership, correction loop, CT clashes, assignment rules) are enforced
  in the database by constraints, triggers and `security definer` functions; the UI mirrors them only to explain them.
- **Visibility:** courses, assignments, statuses and the calendar are readable by all active faculty.
  The marks, roster and attainment tables from earlier versions remain in the schema but the website no longer uses them.
- **Audit:** inserts/updates/deletes on assignments, exam tasks, items, components, outcomes, access and deadlines are logged with old/new values.

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

### 3. Set up the term (two ways, both under **Term setup**)
1. **Import workbook:** choose the Activity Tracker `.xlsx`. It is parsed in the browser; the preview lists every
   automatic fix (date formats, code spacing, spelling, name variants) and every item needing review. Nothing is written
   until you press Import; re-importing the same term updates it in place.
2. **By hand:** **New term**, then the tabs in order: *Term & dates* → *Courses* (add from the catalog or create a
   catalog course; cohort and sections) → *Teachers & roles* (section teachers, exam roles, sessional gradesheet roles)
   → *Class-test routine* (add class tests to theory courses and set every date).

Either way, everything can be adjusted afterwards in the same tabs. Teachers add course outcomes on each course page.

**Existing databases:** run `supabase/migrations/0010_notify_only.sql` and then `0011_obe_results.sql` once each in the SQL Editor.
0010 lets gradesheet preparation start without published marks, which this site no longer collects. 0011 adds the OBE
tables (imported attainment, CAR, course file, BUGS resolutions, CQI log) and flags BME 300/350/400 as culminating.
(`setup.sql` already includes both.)

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
`supabase/tests/integration.sql` signs in as different users and checks: the sign-up gate; marks-table privacy (legacy);
direct writes to exam tasks refused; dependency and ownership blocks; the full correction loop;
CT clash detection; over-maximum and locked marks; item generation per sub-section; roster loading; admin-only import.

## Open access (no sign-in)
The database has one switch, `app_settings.open_access`, and `supabase/setup.sql` turns it **on**:
nobody signs in, every visitor acts as an admin, and the sidebar shows a **Viewing as** picker so
**My courses** still shows that person's courses. The picker is a convenience, not security.

While it is on, anyone with the site link (or the database URL and anon key, which every visitor's
browser receives) can read, change or delete everything, and changes are not
attributed to a person. Use it for setup and testing; switch it off before real use:

```sql
update public.app_settings set open_access = false;   -- require sign-in (add a HOD first: first_admin.sql)
update public.app_settings set open_access = true;    -- open again
```
The switch cannot be changed from the website, only in the Supabase SQL Editor.

## Rules worth knowing
- An exam step opens only when the steps before it are done; admins can override with a note, which is audited.
- Two class tests for the same cohort cannot share a day; admins can override with a reason.
- Removing a course from a term (Term setup → Courses) deletes its sections, roles, workflow progress, plan and dates for that term.

## Data safety
`.gitignore` excludes `*.xlsx`, `*.csv` and `.env*`. **Never commit department workbooks, rosters or exports.**
If a workbook was committed before, remove it from history (`git filter-repo --path '<file>' --invert-paths`) and force-push.

## Not in this version (next phases)
DOCX export of the CAR and course file (print/PDF works now), PEO surveys, rubric and peer-review tools for BME 300/350/400, notices, meetings and minutes,
leave, lab inventory, purchase requisitions, class routine, and grade computation/export.
