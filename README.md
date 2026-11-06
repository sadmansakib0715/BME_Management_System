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
| OBE master data | Every course in the department OBE folder (49 offerings, Jul 2022 – Jul 2025): COs, CO–PO and K/P/A mapping, the assessment map (409 question parts and rubric criteria tagged to COs), cohort attainment, outlines, past CARs (parts C–E) and BUGS resolutions. A new offering starts from the last one (COs, mapping, assessment map, outline) for the teachers to review |
| Assessment map | Per offering: each exam question part or marking criterion with its marks and CO tags (table, or drag-to-connect), marks per CO and the outline's marks distribution; printable |
| Rubrics | Teacher-made rubrics for presentations, demos, projects and reports: criteria × levels with mark bands, pasted from Excel/Sheets or started from the sample, each criterion connected to COs by drag-and-drop |
| CO–PO mapping | Drag a CO onto a PO to link it (Connect view) or tick a table; BAETE-expected POs are tagged for culminating courses |
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
2. In **SQL Editor**, paste and run `supabase/setup.sql` (all migrations plus reference data in one file),
   then `supabase/seed_obe_master.sql` (the department's OBE data).
   An **existing** project only needs `supabase/update_obe_master.sql` (migrations 0013–0015 plus the OBE data, safe to run again).
   Both data files are generated from the OBE master copy: `python3 -I scripts/build_obe_seed.py path/to/obe_master.json`.
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

**Existing databases:** run `supabase/migrations/0010_notify_only.sql`, `0011_obe_results.sql` and then `0012_date_later.sql` once each in the SQL Editor.
0010 lets gradesheet preparation start without published marks, which this site no longer collects. 0011 adds the OBE
tables (imported attainment, CAR, course file, BUGS resolutions, CQI log) and flags BME 300/350/400 as culminating.
0012 adds the "To be set later" choice for assessment dates. (`setup.sql` already includes all three.)

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


### Activity log (0017)

**Activity log** in the sidebar shows who scheduled, changed or removed what, newest first: e.g. “Sadman Sakib Himel scheduled
CT 01 for Fri, 20 Nov 2026 at 10:00 · BME 203”, with the changed fields underneath. Filter by person and course, or see a course's
own log on its **Log** tab. Rows saved together appear as one entry; a reschedule shows its reason.

The database writes the log (triggers on every table the website edits, `public.tg_audit`), so nothing can be changed
without a log line, and nobody can edit the log. Signed in, the account names the person. With open access on, the website sends
the name chosen under **Viewing as** (`x-acting-as` header) and the log records it; changes made with no name chosen show as
“Someone (no name)”. Existing databases run `supabase/update_activity_log.sql` once.

### Department document templates (0016)

The PDFs follow the department's Word templates in `Templates/` (US Letter, 2.5 cm margins, BUET crest): **Course Outline**
(teachers' table with class routine, numbered COs, Assessment, Textbooks, Weekly Schedule, Prepared by), **CO-PO Mapping**
(CO table + Knowledge Profile/CEP/CEA table), **CAR** (Parts A–E, current term first, then the previous one), **Basic information**,
**Instructors & schedule**, the **Question Moderation Form** (Assessment map → term-final rows, Sections A/B) and
**CO and PO Attainment for <course>.xlsx** (CAR page). 0016 adds the academic session and class routine to the outline;
existing databases run `supabase/update_obe_schema.sql` once.

Mapping a CO to a PO ticks the K/P/A table: the PO's knowledge profiles (`pos.k_profiles`), P1 for POs on complex engineering
problems, A1 for POs on complex engineering activities (`impliedKpa` in `src/lib/obe.ts`). “Tick from mapping” fills existing COs.

### Course folder generator (no database changes)

**OBE → Course folder** (also on each course: OBE → *Course folder*) builds the department course file in the browser:

1. Upload the **course outline** (.docx). Both layouts are read: the department's own outline (header fields, Course Teacher(s) table with the
   class routine, COs as a numbered list, `Assessment:` lines such as “Lab Quiz 30%”) and the website outline template (CO table, Distribution of
   Marks). When the outline has no CO table, also upload the department's **CO-PO Mapping.docx** for each CO's POs and Assessment Tool(s); on a
   course's page the website's own COs and mapping fill in otherwise. **course_information.xlsx** is optional (sheets `info`, `faculties`,
   `routine`, `sections`): it is checked against the outline (course no, credit hours, level/term, session; the outline's credit hours win). Without
   it, type the term, batch, number of students and missing rolls.
2. Beside the uploads the page shows what was read (course details, teachers, COs with their POs and tools) and the **assessment tree**: each
   assessment from the outline with its weight, its marks (credit hours × 100 × weight) and the COs whose Assessment Tool(s) name it. It can be
   edited: rename, change a weight, tick COs, change how an assessment covering several COs is split, add or remove assessments.
   **Download marks sheet** builds the sheet from the tree: one `ca` sheet with a column per assessment (per CO when it covers several), its CO
   and marks, and the student IDs. Theory courses assessed only by attendance, class tests and the term final can instead use the BME 211 workbook
   (Attendance Summary, CA Marks with best *k* of *n* CTs, TF Marks, Assessment-CO Mapping for the Q1/Q5 sub-parts, CO Marks, attainment sheets),
   with the weights from the tree. No sheet has Position columns.
3. Upload the filled sheet (and optionally last term's generated workbook for the CAR's previous-term table) → **Build course folder** downloads
   `<course> (<semester>).zip`: the course outline, **CO-PO Mapping**, **Instructors and Schedule**, **CAR** (parts A–B filled, C–E as yellow
   placeholders with a drafted attainment comment), a **CO-PO Attainment Report**, the BUGS resolution link, the **CO-PO assessment marks
   workbook** with live formulas, one folder per assessment with *Sample scripts to upload.txt* (highest, average = closest to the mean, lowest),
   and the Lecture Materials folders, plus `_generation_log.txt` with every warning.

Rules: student CO% = marks on the CO's items ÷ their maximum, attained at ≥ 40%; cohort ≥ 40% of students; student PO% = mean of the CO% of the
COs mapped to it. `Abs`/`Absent`: absent in every item of a CO leaves the student out of that CO, absent in some counts as 0. The Word documents
fill copies of the department's own files in `src/assets/course-folder/` (edit those to change the look). Code: `src/lib/courseFolder/`,
tests: `tests/courseFolder.test.ts`. Marks are read in the browser and never stored.

### OBE documents and attainment from marks (0015)

| Step | Where | What the teacher gets |
| --- | --- | --- |
| Course outline | OBE → Outline | Contents, objectives, assessment strategy, distribution of marks, textbooks and lecture plan; **Outline PDF** in the department's outline layout (with COs, CO–PO and K/P/A tables) |
| COs & mapping | OBE → COs & mapping | **CO-PO mapping PDF** laid out like CO-PO Mapping.docx |
| Rubrics | OBE → Rubrics | **Rubric PDF** (Criterion & CO mapping · Max score · bands); **Add to assessment map** puts the criteria into the marksheet |
| Marksheet | OBE → Attainment | **Marksheet template** (.xlsx) built from the assessment map: one column per question part or criterion, its COs and max marks; one row per student ID, generated from the batch, number of students and missing rolls (batch + 18 + roll, e.g. 2018001). No names |
| Attainment | OBE → Attainment | **Upload marksheet** → checks (marks above max, duplicates, text, missing columns) → student CO% and PO%, cohort CO% and PO% (≥ 40% / ≥ 40%), highest/average/lowest scripts, **Results workbook** |
| CAR | OBE → CAR | Part B filled from the results; **Draft from results** writes a first Part C/E; **CAR PDF** in the department's CAR layout |

Marks are read in the browser and never stored: only per-student CO%/PO% (`obe_student_attainment`, visible to the course's
teachers and admins), cohort results (`obe_attainment`, source `computed`) and the run record (`obe_attainment_runs`) are saved.
`v_student_program_po` gives a student's program PO across BME 300/350/400 (BAETE step 2.2, pending BUGS approval).
In the marksheet, `A` = absent (counts as 0) and `EX` = exempt (left out of that student's totals).

**Existing databases:** run `supabase/migrations/0015_obe_computed.sql` once in the SQL Editor (or the regenerated `update_obe_master.sql`).

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
Saving the course folder's documents back to the database (the zip is built from uploaded files), PEO surveys, rubric and peer-review tools for BME 300/350/400, notices, meetings and minutes,
leave, lab inventory, purchase requisitions, class routine, and grade computation/export.
