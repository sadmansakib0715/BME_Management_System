-- =====================================================================================
-- BME Workflow · one-shot database setup for a NEW, EMPTY Supabase project
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Run it once.
-- Contains supabase/migrations/0001…0015 in order, then supabase/seed.sql
-- (PO1–PO12, PEO1–PEO4, BME course catalog). No people or student data.
--
-- OPEN ACCESS IS ON after this script: no sign-in, every visitor can view and edit everything.
-- To require sign-in later, run:   update public.app_settings set open_access = false;
-- (and first add yourself as HOD with first_admin.sql so you can still get in).
-- =====================================================================================


-- ===== supabase/migrations/0001_core.sql =====
-- BME Workflow · 0001 core: identity, curriculum, terms, offerings
-- Target: Supabase Postgres 15+. All business tables live in `public` and are protected by RLS (0005).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- identity
create table public.faculty (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  display_name  text not null,
  designation   text,
  email         text unique check (email = lower(email)),
  status        text not null default 'active' check (status in ('active','on_leave','former')),
  created_at    timestamptz not null default now()
);

create table public.faculty_aliases (
  alias       text primary key,
  faculty_id  uuid not null references public.faculty(id) on delete cascade
);

-- Who may sign in, and with which application role. Role changes apply immediately.
create table public.allowed_users (
  email       text primary key check (email = lower(email)),
  faculty_id  uuid unique references public.faculty(id) on delete set null,
  app_role    text not null default 'faculty' check (app_role in ('faculty','admin','hod')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- curriculum
create table public.courses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z][a-z]* [0-9]{3}$' or code ~ '^[A-Z]+ [0-9]{3}$'),
  title          text not null,
  course_type    text not null check (course_type in ('theory','sessional','design','thesis','attachment')),
  level          smallint check (level between 1 and 4),
  term_no        smallint check (term_no between 1 and 2),
  credits        numeric(4,2),
  contact_hours  numeric(4,2),
  elective_group text check (elective_group in ('I','II')),
  dept           text not null default 'BME'
);

-- ---------------------------------------------------------------- terms
create table public.terms (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name                   text not null,
  starts_on              date,
  ends_on                date,
  total_weeks            smallint not null default 14 check (total_weeks between 1 and 30),
  latest_completed_week  smallint not null default 0,
  calendar_status        text not null default 'active' check (calendar_status in ('active','paused')),
  pause_reason           text,
  is_current             boolean not null default false,
  read_only              boolean not null default false,
  check (latest_completed_week between 0 and total_weeks)
);
create unique index terms_one_current on public.terms (is_current) where is_current;

create table public.academic_weeks (
  term_id    uuid not null references public.terms(id) on delete cascade,
  week_no    smallint not null,
  starts_on  date,
  ends_on    date,
  primary key (term_id, week_no),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

-- ---------------------------------------------------------------- offerings
create table public.offerings (
  id         uuid primary key default gen_random_uuid(),
  term_id    uuid not null references public.terms(id) on delete cascade,
  course_id  uuid not null references public.courses(id),
  batch      text,
  status     text not null default 'active' check (status in ('draft','active','archived')),
  unique (term_id, course_id)
);

create table public.sections (
  id           uuid primary key default gen_random_uuid(),
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  name         text not null,
  unique (offering_id, name)
);

create table public.section_teachers (
  section_id  uuid not null references public.sections(id) on delete cascade,
  faculty_id  uuid not null references public.faculty(id),
  position    smallint not null default 1,
  primary key (section_id, faculty_id)
);

-- Term-wide deadlines; a row with offering_id overrides the term default for that course.
create table public.term_milestones (
  id           uuid primary key default gen_random_uuid(),
  term_id      uuid not null references public.terms(id) on delete cascade,
  offering_id  uuid references public.offerings(id) on delete cascade,
  kind         text not null check (kind in ('outline_sharing','question_submission','exam_start',
                 'theory_gradesheet','sessional_gradesheet','feedback_deadline','car_deadline')),
  due_on       date not null,
  unique nulls not distinct (term_id, offering_id, kind)
);

-- ===== supabase/migrations/0002_workflow.sql =====
-- BME Workflow · 0002 workflow: theory exam chain, sessional gradesheets, course records

create table public.exam_assignments (
  offering_id  uuid primary key references public.offerings(id) on delete cascade,
  qp_a         uuid references public.faculty(id),
  qp_b         uuid references public.faculty(id),
  mod_1        uuid references public.faculty(id),
  mod_2        uuid references public.faculty(id),
  scrutinizer  uuid references public.faculty(id),
  updated_at   timestamptz not null default now(),
  -- Hard rules from the department spreadsheet (NULL means "not yet assigned").
  constraint qp_distinct          check (qp_a <> qp_b),
  constraint moderators_distinct  check (mod_1 <> mod_2),
  constraint mod1_not_preparer    check (mod_1 <> qp_a and mod_1 <> qp_b),
  constraint mod2_not_preparer    check (mod_2 <> qp_a and mod_2 <> qp_b),
  constraint scrutinizer_not_qp   check (scrutinizer <> qp_a and scrutinizer <> qp_b)
);

create table public.exam_tasks (
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  step         text not null check (step in ('qp_a','qp_b','mod_1','mod_2','printing','exam_a','exam_b',
                                             'scrutiny','gs_prep','gs_scrutiny','hod')),
  status       text not null default 'not_started',
  due_on       date,
  note         text,
  updated_by   uuid references public.faculty(id),
  updated_at   timestamptz not null default now(),
  primary key (offering_id, step)
);

create table public.moderation_rounds (
  id            uuid primary key default gen_random_uuid(),
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  moderator_step text not null check (moderator_step in ('mod_1','mod_2')),
  half          text not null check (half in ('A','B')),
  comment       text,
  returned_by   uuid references public.faculty(id),
  returned_at   timestamptz not null default now(),
  resolved_at   timestamptz
);

-- Step definitions shared by the RPC below. Kept in SQL so the server is the authority;
-- src/lib/workflow.ts mirrors it for display only.
create or replace function public.exam_step_done(p_step text, p_status text)
returns boolean language sql immutable as $$
  select case p_step
    when 'qp_a' then p_status = 'submitted'      when 'qp_b' then p_status = 'submitted'
    when 'mod_1' then p_status = 'finalized'     when 'mod_2' then p_status = 'finalized'
    when 'printing' then p_status = 'printed'
    when 'exam_a' then p_status = 'examined'     when 'exam_b' then p_status = 'examined'
    when 'scrutiny' then p_status = 'scrutinized'
    when 'gs_prep' then p_status = 'uploaded_biis'
    when 'gs_scrutiny' then p_status = 'scrutinized'
    when 'hod' then p_status = 'received'
    else false end
$$;

create or replace function public.exam_step_statuses(p_step text)
returns text[] language sql immutable as $$
  select case
    when p_step in ('qp_a','qp_b') then array['not_started','under_preparation','under_correction','submitted']
    when p_step in ('mod_1','mod_2') then array['not_started','under_moderation','needs_correction','finalized']
    when p_step = 'printing' then array['not_started','sent_to_print','printed']
    when p_step in ('exam_a','exam_b') then array['not_started','under_examination','examined']
    when p_step in ('scrutiny','gs_scrutiny') then array['not_started','under_scrutiny','scrutinized']
    when p_step = 'gs_prep' then array['not_started','under_preparation','prepared','uploaded_biis']
    when p_step = 'hod' then array['not_started','forwarded','received']
  end
$$;

create or replace function public.exam_step_deps(p_step text)
returns text[] language sql immutable as $$
  select case p_step
    when 'mod_1' then array['qp_a','qp_b']        when 'mod_2' then array['qp_a','qp_b']
    when 'printing' then array['mod_1','mod_2']
    when 'exam_a' then array['printing']          when 'exam_b' then array['printing']
    when 'scrutiny' then array['exam_a','exam_b']
    when 'gs_prep' then array['scrutiny']
    when 'gs_scrutiny' then array['gs_prep']
    when 'hod' then array['gs_scrutiny']
    else array[]::text[] end
$$;

-- Derived owners: Examiner A = QP-A, Examiner B = QP-B, Gradesheet preparer = QP-A,
-- Gradesheet scrutinizer = Script scrutinizer. Printing and HOD receipt belong to admins / HOD.
create or replace view public.v_exam_owners with (security_invoker = true) as
select a.offering_id, s.step,
       case s.step
         when 'qp_a' then a.qp_a when 'exam_a' then a.qp_a when 'gs_prep' then a.qp_a when 'hod' then a.qp_a
         when 'qp_b' then a.qp_b when 'exam_b' then a.qp_b
         when 'mod_1' then a.mod_1 when 'mod_2' then a.mod_2
         when 'scrutiny' then a.scrutinizer when 'gs_scrutiny' then a.scrutinizer
       end as owner_id
from public.exam_assignments a
cross join (values ('qp_a'),('qp_b'),('mod_1'),('mod_2'),('printing'),('exam_a'),('exam_b'),
                   ('scrutiny'),('gs_prep'),('gs_scrutiny'),('hod')) as s(step);

-- Every assignment gets its full task list.
create or replace function public.tg_exam_assignment_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exam_tasks (offering_id, step)
  select new.offering_id, s from unnest(array['qp_a','qp_b','mod_1','mod_2','printing','exam_a','exam_b',
                                              'scrutiny','gs_prep','gs_scrutiny','hod']) s
  on conflict do nothing;
  return new;
end $$;
create trigger exam_assignment_tasks after insert on public.exam_assignments
  for each row execute function public.tg_exam_assignment_tasks();

create table public.sessional_gradesheets (
  offering_id      uuid primary key references public.offerings(id) on delete cascade,
  preparer         uuid references public.faculty(id),
  scrutinizer      uuid references public.faculty(id),
  prep_status      text not null default 'not_started'
                   check (prep_status in ('not_started','under_preparation','prepared','uploaded_biis','forwarded')),
  scrutiny_status  text not null default 'not_started'
                   check (scrutiny_status in ('not_started','under_scrutiny','scrutinized','forwarded_hod')),
  updated_at       timestamptz not null default now(),
  constraint preparer_not_scrutinizer check (preparer <> scrutinizer)
);

-- Spreadsheet trackers 03, 06, 09 (outline, student feedback, course file / CAR).
create table public.course_records (
  offering_id      uuid primary key references public.offerings(id) on delete cascade,
  outline_status   text not null default 'not_started'
                   check (outline_status in ('not_started','under_preparation','prepared','shared')),
  feedback_status  text not null default 'not_started'
                   check (feedback_status in ('not_started','students_reminded','collected')),
  car_status       text not null default 'not_started'
                   check (car_status in ('not_started','under_preparation','prepared','final')),
  notes            text,
  updated_at       timestamptz not null default now()
);

-- ===== supabase/migrations/0003_obe.sql =====
-- BME Workflow · 0003 OBE: outcomes, students, assessment plan, marks, attainment

-- ---------------------------------------------------------------- program outcomes
create table public.peos (
  code       text primary key check (code ~ '^PEO[0-9]+$'),
  statement  text not null
);

create table public.pos (
  code        text primary key check (code ~ '^PO[0-9]+$'),
  no          smallint not null unique,
  title       text not null,
  statement   text not null,
  k_profiles  text
);

create table public.peo_po_map (
  peo_code  text references public.peos(code) on delete cascade,
  po_code   text references public.pos(code) on delete cascade,
  primary key (peo_code, po_code)
);

-- ---------------------------------------------------------------- course outcomes
create table public.course_outcomes (
  id           uuid primary key default gen_random_uuid(),
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  code         text not null check (code ~ '^CO[0-9]+$'),
  statement    text not null,
  domain       text not null default 'cognitive' check (domain in ('cognitive','affective','psychomotor')),
  level        smallint not null default 3 check (level between 1 and 6),
  sort         smallint not null default 0,
  unique (offering_id, code)
);

create table public.co_po_map (
  co_id     uuid not null references public.course_outcomes(id) on delete cascade,
  po_code   text not null references public.pos(code),
  strength  smallint not null check (strength between 1 and 3),
  primary key (co_id, po_code)
);

-- ---------------------------------------------------------------- students
create table public.students (
  id          uuid primary key default gen_random_uuid(),
  student_no  text not null unique check (student_no ~ '^[0-9]{7}$'),
  name        text not null,
  batch       text
);

create table public.enrolments (
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  section_id   uuid references public.sections(id) on delete set null,
  primary key (offering_id, student_id)
);

-- ---------------------------------------------------------------- assessment plan
create table public.assessment_components (
  id           uuid primary key default gen_random_uuid(),
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  kind         text not null check (kind in ('attendance','class_test','term_final','lab_report','lab_test',
                 'quiz','viva','presentation','demonstration','project','assignment','other')),
  name         text not null,
  item_count   smallint not null default 1 check (item_count between 1 and 40),
  marks_each   numeric(6,2) not null default 10 check (marks_each > 0),
  weight       numeric(5,2) not null default 0 check (weight between 0 and 100),
  best_n       smallint check (best_n is null or best_n >= 1),
  per_section  boolean not null default false,
  sort         smallint not null default 0,
  check (best_n is null or best_n <= item_count)
);

create table public.assessment_items (
  id            uuid primary key default gen_random_uuid(),
  component_id  uuid not null references public.assessment_components(id) on delete cascade,
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  section_id    uuid references public.sections(id) on delete cascade,
  seq           smallint not null,
  title         text not null,
  held_on       date,
  held_time     text,
  total_marks   numeric(6,2) not null check (total_marks > 0),
  status        text not null default 'planned'
                check (status in ('planned','scheduled','held','postponed','cancelled')),
  marks_status  text not null default 'none'
                check (marks_status in ('none','entering','verified','published','locked')),
  responsible   uuid references public.faculty(id),
  syllabus      text,
  unique nulls not distinct (component_id, section_id, seq)
);
create index assessment_items_offering on public.assessment_items (offering_id);
create index assessment_items_date on public.assessment_items (held_on);

create table public.item_date_history (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.assessment_items(id) on delete cascade,
  old_date    date,
  new_date    date,
  reason      text,
  changed_by  uuid references public.faculty(id),
  changed_at  timestamptz not null default now()
);

create table public.assessment_questions (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.assessment_items(id) on delete cascade,
  label      text not null,
  max_marks  numeric(6,2) not null check (max_marks > 0),
  co_id      uuid references public.course_outcomes(id) on delete set null,
  sort       smallint not null default 0
);
create index assessment_questions_item on public.assessment_questions (item_id);

create table public.marks (
  question_id  uuid not null references public.assessment_questions(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  value        numeric(6,2) check (value is null or value >= 0),
  flag         text check (flag in ('AB','EX')),
  updated_by   uuid references public.faculty(id),
  updated_at   timestamptz not null default now(),
  primary key (question_id, student_id),
  check (not (value is not null and flag is not null))
);

-- ---------------------------------------------------------------- attainment
create table public.attainment_settings (
  term_id  uuid primary key references public.terms(id) on delete cascade,
  x_pct    numeric(5,2) not null default 60 check (x_pct between 0 and 100),
  y_pct    numeric(5,2) not null default 50 check (y_pct between 0 and 100),
  level1   numeric(5,2) not null default 50,
  level2   numeric(5,2) not null default 60,
  level3   numeric(5,2) not null default 70,
  check (level1 <= level2 and level2 <= level3)
);

create table public.attainment_snapshots (
  id           uuid primary key default gen_random_uuid(),
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  payload      jsonb not null,
  settings     jsonb not null,
  computed_by  uuid references public.faculty(id),
  computed_at  timestamptz not null default now()
);

-- ===== supabase/migrations/0004_functions.sql =====
-- BME Workflow · 0004 access helpers, sign-up gate, guarded RPCs, notifications

-- ---------------------------------------------------------------- access helpers
create or replace function public.fn_me() returns table (faculty_id uuid, app_role text)
language sql stable security definer set search_path = public as $$
  select a.faculty_id, a.app_role
  from public.profiles p
  join public.allowed_users a on a.email = lower(p.email) and a.active
  where p.user_id = auth.uid()
$$;

create or replace function public.fn_faculty() returns uuid
language sql stable security definer set search_path = public as $$ select faculty_id from public.fn_me() $$;

create or replace function public.fn_is_active() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.fn_me()) $$;

create or replace function public.fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fn_me() where app_role in ('admin','hod'))
$$;

create or replace function public.fn_is_hod() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fn_me() where app_role = 'hod')
$$;

create or replace function public.fn_teaches(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.section_teachers st join public.sections s on s.id = st.section_id
                 where s.offering_id = p_offering and st.faculty_id = public.fn_faculty())
$$;

create or replace function public.fn_exam_role(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.exam_assignments a where a.offering_id = p_offering
                 and public.fn_faculty() in (a.qp_a, a.qp_b, a.mod_1, a.mod_2, a.scrutinizer))
$$;

-- Student marks are visible only to the offering's teachers, its exam-role holders, and admins.
create or replace function public.fn_can_mark(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.fn_is_admin() or public.fn_teaches(p_offering) or public.fn_exam_role(p_offering)
$$;

create or replace function public.fn_can_manage(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.fn_is_admin() or public.fn_teaches(p_offering)
$$;

create or replace function public.fn_teaches_any() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.section_teachers where faculty_id = public.fn_faculty())
$$;

-- ---------------------------------------------------------------- sign-up gate
-- Only allow-listed addresses can create an account; each account gets a profile row.
create or replace function public.signup_email_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users where email = lower(trim(p_email)) and active)
$$;

create or replace function public.tg_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.signup_email_allowed(new.email) then
    raise exception 'This email is not approved for BME Workflow. Ask the department admin.';
  end if;
  insert into public.profiles (user_id, email) values (new.id, lower(new.email)) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_auth_user_created();

-- ---------------------------------------------------------------- notifications
create table public.notifications_outbox (
  id          uuid primary key default gen_random_uuid(),
  to_faculty  uuid not null references public.faculty(id) on delete cascade,
  kind        text not null,
  subject     text not null,
  body        text not null,
  dedupe_key  text unique,
  status      text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create or replace function public.fn_notify(p_to uuid, p_kind text, p_subject text, p_body text, p_key text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_to is null then return; end if;
  insert into public.notifications_outbox (to_faculty, kind, subject, body, dedupe_key)
  values (p_to, p_kind, p_subject, p_body, p_key) on conflict (dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------- theory exam RPC
create or replace function public.set_exam_task(
  p_offering uuid, p_step text, p_status text, p_note text default null, p_half text default null)
returns public.exam_tasks
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.fn_faculty();
  admin boolean := public.fn_is_admin();
  owner uuid;
  dep text;
  blocked text[] := '{}';
  v_row public.exam_tasks;
  code text;
  step_after text;
begin
  if me is null and not admin then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not (p_status = any (public.exam_step_statuses(p_step))) then
    raise exception 'Status "%" is not valid for step %', p_status, p_step using errcode = '22023';
  end if;

  select owner_id into owner from public.v_exam_owners where offering_id = p_offering and step = p_step;
  if p_step = 'hod' and p_status = 'received' then
    if not public.fn_is_hod() and not admin then raise exception 'Only the HOD can confirm receipt' using errcode = '42501'; end if;
  elsif p_step = 'printing' then
    if not admin then raise exception 'Printing is updated by the department office (admins)' using errcode = '42501'; end if;
  elsif owner is distinct from me and not admin then
    raise exception 'This step belongs to another faculty member' using errcode = '42501';
  end if;

  -- Dependencies: a step can move past not_started only when every prerequisite is done.
  if p_status <> 'not_started' then
    foreach dep in array public.exam_step_deps(p_step) loop
      if not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = dep
                     and public.exam_step_done(t.step, t.status)) then
        blocked := blocked || dep;
      end if;
    end loop;
    if array_length(blocked, 1) > 0 and not (admin and coalesce(trim(p_note), '') <> '') then
      raise exception 'Waiting on: %', array_to_string(blocked, ', ') using errcode = 'P0001',
        hint = 'Admins can override with a note.';
    end if;
  end if;

  -- Gradesheet preparation also needs every class test's marks published.
  if p_step = 'gs_prep' and p_status <> 'not_started' and exists (
      select 1 from public.assessment_items i join public.assessment_components c on c.id = i.component_id
      where i.offering_id = p_offering and c.kind = 'class_test' and i.status <> 'cancelled'
        and i.marks_status not in ('published','locked')) and not admin then
    raise exception 'Publish all class test marks before preparing the gradesheet' using errcode = 'P0001';
  end if;

  -- Moderator returns a half for correction.
  if p_step in ('mod_1','mod_2') and p_status = 'needs_correction' then
    if p_half not in ('A','B') then raise exception 'Choose which half (A or B) needs correction' using errcode = '22023'; end if;
    insert into public.moderation_rounds (offering_id, moderator_step, half, comment, returned_by)
    values (p_offering, p_step, p_half, p_note, me);
    update public.exam_tasks set status = 'under_correction', updated_by = me, updated_at = now()
     where offering_id = p_offering and step = case p_half when 'A' then 'qp_a' else 'qp_b' end;
    perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering
                               and step = case p_half when 'A' then 'qp_a' else 'qp_b' end),
      'returned', 'Question paper returned for correction',
      coalesce(p_note, 'A moderator returned your half of the question paper.'), null);
  end if;

  -- A preparer resubmits: open rounds close, moderators who returned it go back to reviewing.
  if p_step in ('qp_a','qp_b') and p_status = 'submitted' then
    update public.moderation_rounds set resolved_at = now()
     where offering_id = p_offering and resolved_at is null and half = case p_step when 'qp_a' then 'A' else 'B' end;
    update public.exam_tasks t set status = 'under_moderation', updated_at = now()
     where t.offering_id = p_offering and t.step in ('mod_1','mod_2') and t.status = 'needs_correction'
       and not exists (select 1 from public.moderation_rounds r where r.offering_id = p_offering
                       and r.moderator_step = t.step and r.resolved_at is null);
  end if;

  update public.exam_tasks set status = p_status, note = coalesce(p_note, note), updated_by = me, updated_at = now()
   where offering_id = p_offering and step = p_step
  returning * into v_row;
  if v_row is null then raise exception 'No exam workflow exists for this course yet' using errcode = 'P0002'; end if;

  -- Tell owners of steps that just unlocked.
  select c.code into code from public.offerings o join public.courses c on c.id = o.course_id where o.id = p_offering;
  if public.exam_step_done(p_step, p_status) then
    for step_after in select unnest(array['mod_1','mod_2','printing','exam_a','exam_b','scrutiny','gs_prep','gs_scrutiny','hod']) loop
      if p_step = any (public.exam_step_deps(step_after)) and not exists (
          select 1 from unnest(public.exam_step_deps(step_after)) d
          where not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = d
                            and public.exam_step_done(t.step, t.status))) then
        perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering and step = step_after),
          'unlocked', code || ': your next exam step is ready',
          'The step "' || step_after || '" for ' || code || ' can now proceed.', p_offering || ':' || step_after || ':unlocked');
      end if;
    end loop;
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------- sessional gradesheet RPC
create or replace function public.set_sessional_gradesheet(p_offering uuid, p_part text, p_status text)
returns public.sessional_gradesheets
language plpgsql security definer set search_path = public as $$
declare me uuid := public.fn_faculty(); g public.sessional_gradesheets; admin boolean := public.fn_is_admin();
begin
  select * into g from public.sessional_gradesheets where offering_id = p_offering;
  if g is null then raise exception 'No gradesheet assignment for this course' using errcode = 'P0002'; end if;
  if p_part = 'prep' then
    if g.preparer is distinct from me and not admin then raise exception 'Only the gradesheet preparer can update this' using errcode = '42501'; end if;
    if p_status <> 'not_started' and not admin and exists (
        select 1 from public.assessment_items where offering_id = p_offering and status <> 'cancelled'
        and marks_status not in ('published','locked')) then
      raise exception 'Publish every assessment item in all sub-sections first' using errcode = 'P0001';
    end if;
    update public.sessional_gradesheets set prep_status = p_status, updated_at = now() where offering_id = p_offering returning * into g;
    if p_status = 'forwarded' then
      perform public.fn_notify(g.scrutinizer, 'unlocked', 'Sessional gradesheet ready for scrutiny', 'A sessional gradesheet was forwarded to you.', p_offering || ':sg:scrutiny');
    end if;
  elsif p_part = 'scrutiny' then
    if g.scrutinizer is distinct from me and not admin then raise exception 'Only the gradesheet scrutinizer can update this' using errcode = '42501'; end if;
    if p_status <> 'not_started' and g.prep_status <> 'forwarded' and not admin then
      raise exception 'Waiting on the gradesheet preparer' using errcode = 'P0001';
    end if;
    update public.sessional_gradesheets set scrutiny_status = p_status, updated_at = now() where offering_id = p_offering returning * into g;
  else
    raise exception 'Unknown part %', p_part using errcode = '22023';
  end if;
  return g;
end $$;

-- ---------------------------------------------------------------- assessment items
-- Generates items from a component's count, per section when requested. Never deletes an item
-- that already holds marks; the caller gets an error naming it instead.
create or replace function public.generate_items(p_component uuid)
returns setof public.assessment_items
language plpgsql security definer set search_path = public as $$
declare c public.assessment_components; s record; n int; base text;
begin
  select * into c from public.assessment_components where id = p_component;
  if c is null then raise exception 'Component not found' using errcode = 'P0002'; end if;
  if not public.fn_can_manage(c.offering_id) then raise exception 'Not allowed' using errcode = '42501'; end if;

  if exists (select 1 from public.assessment_items i join public.assessment_questions q on q.item_id = i.id
             join public.marks m on m.question_id = q.id
             where i.component_id = c.id and (i.seq > c.item_count
               or (c.per_section and i.section_id is null) or (not c.per_section and i.section_id is not null))) then
    raise exception 'Some items you are removing already have marks. Clear their marks first.' using errcode = 'P0001';
  end if;
  delete from public.assessment_items i where i.component_id = c.id and (i.seq > c.item_count
    or (c.per_section and i.section_id is null) or (not c.per_section and i.section_id is not null));

  base := c.name;
  for s in select id, name from public.sections where offering_id = c.offering_id and c.per_section
           union all select null::uuid, null::text where not c.per_section loop
    for n in 1..c.item_count loop
      insert into public.assessment_items (component_id, offering_id, section_id, seq, title, total_marks)
      values (c.id, c.offering_id, s.id, n,
              base || ' ' || lpad(n::text, 2, '0') || coalesce(' (' || s.name || ')', ''), c.marks_each)
      on conflict (component_id, section_id, seq) do update set total_marks = excluded.total_marks;
    end loop;
  end loop;
  return query select * from public.assessment_items where component_id = c.id order by section_id nulls first, seq;
end $$;

-- Moves an item's date, keeping history and blocking two class tests for one batch on one day.
create or replace function public.reschedule_item(p_item uuid, p_date date, p_reason text default null, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.assessment_items; kind text; conflicts jsonb;
begin
  select * into i from public.assessment_items where id = p_item;
  if i is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  if not public.fn_can_manage(i.offering_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select c.kind into kind from public.assessment_components c where c.id = i.component_id;

  if kind = 'class_test' and p_date is not null then
    select coalesce(jsonb_agg(jsonb_build_object('item', x.id, 'course', cr.code, 'title', x.title)), '[]') into conflicts
    from public.assessment_items x
    join public.assessment_components xc on xc.id = x.component_id and xc.kind = 'class_test'
    join public.offerings xo on xo.id = x.offering_id
    join public.offerings o on o.id = i.offering_id
    join public.courses cr on cr.id = xo.course_id
    where x.id <> i.id and x.held_on = p_date and x.status <> 'cancelled'
      and xo.term_id = o.term_id and xo.batch is not distinct from o.batch;
    if jsonb_array_length(conflicts) > 0 and not (p_force and public.fn_is_admin() and coalesce(trim(p_reason),'') <> '') then
      return jsonb_build_object('ok', false, 'conflicts', conflicts);
    end if;
  end if;

  if i.held_on is distinct from p_date then
    insert into public.item_date_history (item_id, old_date, new_date, reason, changed_by)
    values (i.id, i.held_on, p_date, p_reason, public.fn_faculty());
  end if;
  update public.assessment_items set held_on = p_date,
    status = case when p_date is not null and status in ('planned','postponed') then 'scheduled' else status end
  where id = p_item;
  return jsonb_build_object('ok', true, 'conflicts', coalesce(conflicts, '[]'::jsonb));
end $$;

-- Locked marks are final: only admins can unlock an item or change its marks.
create or replace function public.tg_item_lock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.marks_status = 'locked' and new.marks_status <> 'locked' and not public.fn_is_admin() then
    raise exception 'Locked marks can only be reopened by an admin' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger item_lock_guard before update on public.assessment_items
  for each row execute function public.tg_item_lock_guard();

create or replace function public.tg_marks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare maxm numeric; st text;
begin
  select q.max_marks, i.marks_status into maxm, st
  from public.assessment_questions q join public.assessment_items i on i.id = q.item_id
  where q.id = coalesce(new.question_id, old.question_id);
  if st = 'locked' and not public.fn_is_admin() then
    raise exception 'Marks for this item are locked' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    if new.value > maxm then raise exception 'Mark % exceeds the question maximum %', new.value, maxm using errcode = '22003'; end if;
    new.updated_by := public.fn_faculty();
    new.updated_at := now();
    return new;
  end if;
  return old;
end $$;
create trigger marks_guard before insert or update or delete on public.marks
  for each row execute function public.tg_marks_guard();

-- ---------------------------------------------------------------- reminders (run daily by pg_cron)
create or replace function public.enqueue_reminders(p_today date default (now() at time zone 'Asia/Dhaka')::date)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; days int;
begin
  for r in
    select t.offering_id, t.step, coalesce(t.due_on, m.due_on) as due_on, o2.owner_id, c.code
    from public.exam_tasks t
    join public.offerings o on o.id = t.offering_id
    join public.terms tm on tm.id = o.term_id and tm.is_current
    join public.courses c on c.id = o.course_id
    join public.v_exam_owners o2 on o2.offering_id = t.offering_id and o2.step = t.step
    left join public.term_milestones m on m.term_id = o.term_id and m.offering_id is null
      and m.kind = case when t.step in ('qp_a','qp_b','mod_1','mod_2') then 'question_submission' else 'theory_gradesheet' end
    where not public.exam_step_done(t.step, t.status)
  loop
    continue when r.due_on is null or r.owner_id is null;
    days := r.due_on - p_today;
    if days in (7,3,1,0) or (days < 0 and days >= -5) then
      perform public.fn_notify(r.owner_id, 'reminder',
        r.code || ': ' || r.step || case when days < 0 then ' is overdue' when days = 0 then ' is due today' else ' is due in ' || days || ' days' end,
        'Due ' || to_char(r.due_on, 'DD Mon YYYY') || '. Open BME Workflow to update the status.',
        r.offering_id || ':' || r.step || ':' || p_today);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ===== supabase/migrations/0005_import.sql =====
-- BME Workflow · 0005 spreadsheet import (admin only, one transaction)
-- The browser parses and normalizes the workbook (src/lib/importer.ts) and shows a preview;
-- this function writes the confirmed plan. Re-running it for the same term updates in place.

create or replace function public.import_term_plan(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t_id uuid; f jsonb; o jsonb; s jsonb; e jsonb; x jsonb;
  off_id uuid; sec_id uuid; comp_id uuid; fac uuid; pos int;
  counts jsonb := '{}'::jsonb; n_items int := 0; kv record;
begin
  if not public.fn_is_admin() then raise exception 'Only admins can import' using errcode = '42501'; end if;

  insert into public.terms (code, name, total_weeks, latest_completed_week)
  values (p->'term'->>'code', p->'term'->>'name', coalesce((p->'term'->>'total_weeks')::int, 14),
          coalesce((p->'term'->>'latest_completed_week')::int, 0))
  on conflict (code) do update set name = excluded.name
  returning id into t_id;

  for f in select * from jsonb_array_elements(coalesce(p->'faculty', '[]')) loop
    if not exists (select 1 from public.faculty where display_name = f->>'display_name') then
      insert into public.faculty (full_name, display_name) values (coalesce(f->>'full_name', f->>'display_name'), f->>'display_name');
    end if;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p->'courses', '[]')) loop
    insert into public.courses (code, title, course_type, credits, contact_hours, level, term_no)
    values (x->>'code', x->>'title', x->>'course_type', (x->>'credits')::numeric, (x->>'contact_hours')::numeric,
            (x->>'level')::smallint, (x->>'term_no')::smallint)
    on conflict (code) do update set contact_hours = coalesce(excluded.contact_hours, public.courses.contact_hours);
  end loop;

  for o in select * from jsonb_array_elements(coalesce(p->'offerings', '[]')) loop
    -- Batch defaults to the curriculum level-term (e.g. L2T1) so class-test clashes are checked per cohort.
    insert into public.offerings (term_id, course_id, batch)
    select t_id, c.id, coalesce(o->>'batch', 'L' || c.level || coalesce('T' || c.term_no, ''))
    from public.courses c where c.code = o->>'code'
    on conflict (term_id, course_id) do update set batch = coalesce(excluded.batch, public.offerings.batch)
    returning id into off_id;
    insert into public.course_records (offering_id) values (off_id) on conflict do nothing;
    for s in select * from jsonb_array_elements(coalesce(o->'sections', '[]')) loop
      insert into public.sections (offering_id, name) values (off_id, s->>'name')
      on conflict (offering_id, name) do update set name = excluded.name returning id into sec_id;
      delete from public.section_teachers where section_id = sec_id;
      pos := 0;
      for f in select * from jsonb_array_elements(coalesce(s->'teachers', '[]')) loop
        pos := pos + 1;
        select id into fac from public.faculty where display_name = f #>> '{}';
        if fac is not null then
          insert into public.section_teachers (section_id, faculty_id, position) values (sec_id, fac, pos) on conflict do nothing;
        end if;
      end loop;
    end loop;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p->'exam', '[]')) loop
    select o2.id into off_id from public.offerings o2 join public.courses c on c.id = o2.course_id
     where o2.term_id = t_id and c.code = e->>'code';
    continue when off_id is null;
    insert into public.exam_assignments (offering_id, qp_a, qp_b, mod_1, mod_2, scrutinizer)
    values (off_id,
      (select id from public.faculty where display_name = e->>'qp_a'),
      (select id from public.faculty where display_name = e->>'qp_b'),
      (select id from public.faculty where display_name = e->>'mod_1'),
      (select id from public.faculty where display_name = e->>'mod_2'),
      (select id from public.faculty where display_name = e->>'scrutinizer'))
    on conflict (offering_id) do update set qp_a = excluded.qp_a, qp_b = excluded.qp_b, mod_1 = excluded.mod_1,
      mod_2 = excluded.mod_2, scrutinizer = excluded.scrutinizer, updated_at = now();
    for kv in select key, value #>> '{}' as val from jsonb_each(coalesce(e->'statuses', '{}')) loop
      update public.exam_tasks set status = kv.val
       where offering_id = off_id and step = kv.key and kv.val = any (public.exam_step_statuses(kv.key));
    end loop;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p->'sessional_grades', '[]')) loop
    select o2.id into off_id from public.offerings o2 join public.courses c on c.id = o2.course_id
     where o2.term_id = t_id and c.code = e->>'code';
    continue when off_id is null;
    insert into public.sessional_gradesheets (offering_id, preparer, scrutinizer, prep_status, scrutiny_status)
    values (off_id, (select id from public.faculty where display_name = e->>'preparer'),
            (select id from public.faculty where display_name = e->>'scrutinizer'),
            coalesce(e->>'prep_status', 'not_started'), coalesce(e->>'scrutiny_status', 'not_started'))
    on conflict (offering_id) do update set preparer = excluded.preparer, scrutinizer = excluded.scrutinizer,
      prep_status = excluded.prep_status, scrutiny_status = excluded.scrutiny_status;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p->'records', '[]')) loop
    update public.course_records r set
      outline_status = coalesce(e->>'outline_status', r.outline_status),
      feedback_status = coalesce(e->>'feedback_status', r.feedback_status),
      car_status = coalesce(e->>'car_status', r.car_status)
    from public.offerings o2 join public.courses c on c.id = o2.course_id
    where r.offering_id = o2.id and o2.term_id = t_id and c.code = e->>'code';
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p->'milestones', '[]')) loop
    insert into public.term_milestones (term_id, kind, due_on) values (t_id, e->>'kind', (e->>'due_on')::date)
    on conflict (term_id, offering_id, kind) do update set due_on = excluded.due_on;
  end loop;

  -- Class tests: one "Class Tests" component per course, one item per CT number.
  for e in select * from jsonb_array_elements(coalesce(p->'class_tests', '[]')) loop
    select o2.id into off_id from public.offerings o2 join public.courses c on c.id = o2.course_id
     where o2.term_id = t_id and c.code = e->>'code';
    continue when off_id is null;
    select id into comp_id from public.assessment_components where offering_id = off_id and kind = 'class_test';
    if comp_id is null then
      insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, sort)
      values (off_id, 'class_test', 'Class Test', 1, 20, 20, 1) returning id into comp_id;
    end if;
    update public.assessment_components set item_count = greatest(item_count, (e->>'seq')::int) where id = comp_id;
    insert into public.assessment_items (component_id, offering_id, seq, title, held_on, total_marks, status, marks_status)
    values (comp_id, off_id, (e->>'seq')::int, 'CT ' || lpad(e->>'seq', 2, '0'), (e->>'held_on')::date, 20,
            coalesce(e->>'status', 'planned'), coalesce(e->>'marks_status', 'none'))
    on conflict (component_id, section_id, seq) do update set held_on = excluded.held_on,
      status = excluded.status, marks_status = excluded.marks_status;
    n_items := n_items + 1;
  end loop;

  -- Sessional evaluations: imported per sub-section under one editable component.
  for e in select * from jsonb_array_elements(coalesce(p->'sessional_items', '[]')) loop
    select o2.id into off_id from public.offerings o2 join public.courses c on c.id = o2.course_id
     where o2.term_id = t_id and c.code = e->>'code';
    continue when off_id is null;
    select id into sec_id from public.sections where offering_id = off_id and name = e->>'section';
    select id into comp_id from public.assessment_components where offering_id = off_id and name = 'Imported evaluations';
    if comp_id is null then
      insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, per_section, sort)
      values (off_id, 'other', 'Imported evaluations', 1, 10, 0, true, 9) returning id into comp_id;
    end if;
    update public.assessment_components set item_count = greatest(item_count, (e->>'seq')::int) where id = comp_id;
    insert into public.assessment_items (component_id, offering_id, section_id, seq, title, held_on, total_marks, status, marks_status)
    values (comp_id, off_id, sec_id, (e->>'seq')::int, e->>'title', (e->>'held_on')::date, 10,
            coalesce(e->>'status', 'planned'), coalesce(e->>'marks_status', 'none'))
    on conflict (component_id, section_id, seq) do update set title = excluded.title, held_on = excluded.held_on,
      status = excluded.status, marks_status = excluded.marks_status;
    n_items := n_items + 1;
  end loop;

  insert into public.attainment_settings (term_id) values (t_id) on conflict do nothing;

  counts := jsonb_build_object('term_id', t_id,
    'offerings', (select count(*) from public.offerings where term_id = t_id),
    'faculty', (select count(*) from public.faculty),
    'items', n_items);
  return counts;
end $$;

-- ===== supabase/migrations/0006_rls.sql =====
-- BME Workflow · 0006 row-level security. RLS is the only security boundary; the browser is untrusted.

do $$ declare t text; begin
  foreach t in array array['faculty','faculty_aliases','allowed_users','profiles','courses','terms','academic_weeks',
    'offerings','sections','section_teachers','term_milestones','exam_assignments','exam_tasks','moderation_rounds',
    'sessional_gradesheets','course_records','peos','pos','peo_po_map','course_outcomes','co_po_map','students',
    'enrolments','assessment_components','assessment_items','item_date_history','assessment_questions','marks',
    'attainment_settings','attainment_snapshots','notifications_outbox'] loop
    -- ENABLE (not FORCE): signed-in users are always subject to RLS, while the owning role
    -- (Supabase's postgres) can run seeds and the security-definer functions below.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Department-readable reference and workflow data: any active faculty member may read.
do $$ declare t text; begin
  foreach t in array array['faculty','faculty_aliases','courses','terms','academic_weeks','offerings','sections',
    'section_teachers','term_milestones','exam_assignments','exam_tasks','moderation_rounds','sessional_gradesheets',
    'course_records','peos','pos','peo_po_map','course_outcomes','co_po_map','assessment_components',
    'assessment_items','item_date_history','assessment_questions','attainment_settings'] loop
    execute format('create policy dept_read on public.%I for select to authenticated using (public.fn_is_active())', t);
  end loop;
end $$;

-- Admin-maintained setup data.
do $$ declare t text; begin
  foreach t in array array['faculty','faculty_aliases','courses','terms','academic_weeks','offerings','sections',
    'section_teachers','term_milestones','exam_assignments','sessional_gradesheets','peos','pos','peo_po_map',
    'attainment_settings'] loop
    execute format('create policy admin_write on public.%I for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin())', t);
  end loop;
end $$;

-- Identity
create policy own_or_admin on public.allowed_users for select to authenticated
  using (public.fn_is_admin() or email = (select lower(email) from public.profiles where user_id = auth.uid()));
create policy admin_write on public.allowed_users for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy own_or_admin on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.fn_is_admin());

-- Course-owned records: the offering's teachers (and admins) edit them.
create policy teacher_write on public.course_records for update to authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.course_outcomes for all to authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.co_po_map for all to authenticated
  using (public.fn_can_manage((select offering_id from public.course_outcomes where id = co_id)))
  with check (public.fn_can_manage((select offering_id from public.course_outcomes where id = co_id)));
create policy teacher_write on public.assessment_components for all to authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.assessment_items for all to authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.assessment_questions for all to authenticated
  using (public.fn_can_mark((select offering_id from public.assessment_items where id = item_id)))
  with check (public.fn_can_mark((select offering_id from public.assessment_items where id = item_id)));

-- Students and marks: never department-wide. Only people who teach or examine the offering.
create policy offering_read on public.students for select to authenticated
  using (public.fn_is_admin() or exists (select 1 from public.enrolments e where e.student_id = students.id and public.fn_can_mark(e.offering_id)));
create policy roster_write on public.students for insert to authenticated
  with check (public.fn_is_admin() or public.fn_teaches_any());
create policy roster_update on public.students for update to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy offering_read on public.enrolments for select to authenticated using (public.fn_can_mark(offering_id));
create policy roster_write on public.enrolments for all to authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));

create policy offering_marks on public.marks for all to authenticated
  using (public.fn_can_mark((select i.offering_id from public.assessment_questions q
                             join public.assessment_items i on i.id = q.item_id where q.id = question_id)))
  with check (public.fn_can_mark((select i.offering_id from public.assessment_questions q
                             join public.assessment_items i on i.id = q.item_id where q.id = question_id)));

create policy offering_read on public.attainment_snapshots for select to authenticated using (public.fn_can_mark(offering_id));
create policy offering_write on public.attainment_snapshots for insert to authenticated with check (public.fn_can_mark(offering_id));

create policy admin_read on public.notifications_outbox for select to authenticated
  using (public.fn_is_admin() or to_faculty = public.fn_faculty());

-- exam_tasks and moderation_rounds have no write policy: they change only through set_exam_task().

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.set_exam_task(uuid, text, text, text, text),
  public.set_sessional_gradesheet(uuid, text, text), public.generate_items(uuid),
  public.reschedule_item(uuid, date, text, boolean), public.import_term_plan(jsonb),
  public.fn_me() to authenticated;
grant execute on function public.signup_email_allowed(text) to anon, authenticated;
revoke execute on function public.enqueue_reminders(date) from public, anon, authenticated;
revoke all on public.notifications_outbox from anon;

-- ===== supabase/migrations/0007_audit.sql =====
-- BME Workflow · 0007 audit log: who changed what, old and new values.

create table public.audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_pk      text,
  action      text not null,
  old_row     jsonb,
  new_row     jsonb,
  actor       uuid,
  at          timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy admin_read on public.audit_log for select to authenticated using (public.fn_is_admin());

create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare pk text;
begin
  pk := coalesce(to_jsonb(new), to_jsonb(old)) ->> coalesce(tg_argv[0], 'id');
  insert into public.audit_log (table_name, row_pk, action, old_row, new_row, actor)
  values (tg_table_name, pk, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          public.fn_faculty());
  return coalesce(new, old);
end $$;

create trigger audit after insert or update or delete on public.exam_assignments for each row execute function public.tg_audit('offering_id');
create trigger audit after insert or update or delete on public.exam_tasks for each row execute function public.tg_audit('offering_id');
create trigger audit after insert or update or delete on public.section_teachers for each row execute function public.tg_audit('section_id');
create trigger audit after insert or update or delete on public.assessment_items for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.assessment_components for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.course_outcomes for each row execute function public.tg_audit();
create trigger audit after update or delete on public.marks for each row execute function public.tg_audit('question_id');
create trigger audit after insert or update or delete on public.allowed_users for each row execute function public.tg_audit('email');
create trigger audit after insert or update or delete on public.term_milestones for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.sessional_gradesheets for each row execute function public.tg_audit('offering_id');
create trigger audit after update on public.course_records for each row execute function public.tg_audit('offering_id');

-- ===== supabase/migrations/0008_roster.sql =====
-- BME Workflow · 0008 roster loading. A teacher cannot read a student row until it is enrolled in
-- their course (RLS), so adding and enrolling happen together in one checked function.

create or replace function public.enrol_students(p_offering uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; sid uuid; sec uuid; added int := 0; enrolled int := 0; bad jsonb := '[]'; no text;
begin
  if not public.fn_can_manage(p_offering) then raise exception 'Only this course''s teachers or an admin can change its students' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    no := trim(r->>'student_no');
    if no !~ '^[0-9]{7}$' or coalesce(trim(r->>'name'), '') = '' then
      bad := bad || jsonb_build_object('student_no', no, 'reason', 'Need a 7-digit student ID and a name'); continue;
    end if;
    insert into public.students (student_no, name, batch) values (no, trim(r->>'name'), nullif(trim(r->>'batch'), ''))
    on conflict (student_no) do nothing returning id into sid;
    if sid is null then
      select id into sid from public.students where student_no = no;
      if public.fn_is_admin() then update public.students set name = trim(r->>'name') where id = sid; end if;
    else added := added + 1; end if;
    select id into sec from public.sections where offering_id = p_offering and name = coalesce(nullif(trim(r->>'section'), ''), 'X');
    if sec is null then select id into sec from public.sections where offering_id = p_offering order by name limit 1; end if;
    insert into public.enrolments (offering_id, student_id, section_id) values (p_offering, sid, sec)
    on conflict (offering_id, student_id) do update set section_id = excluded.section_id;
    enrolled := enrolled + 1;
  end loop;
  return jsonb_build_object('added', added, 'enrolled', enrolled, 'rejected', bad);
end $$;

-- Copy one course's roster (with sub-sections matched by name) to another course of the same cohort.
create or replace function public.copy_roster(p_from uuid, p_to uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.fn_can_mark(p_from) and public.fn_can_manage(p_to)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  insert into public.enrolments (offering_id, student_id, section_id)
  select p_to, e.student_id, coalesce(
      (select s2.id from public.sections s2 join public.sections s1 on s1.id = e.section_id where s2.offering_id = p_to and s2.name = s1.name),
      (select id from public.sections where offering_id = p_to order by name limit 1))
  from public.enrolments e where e.offering_id = p_from
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.enrol_students(uuid, jsonb), public.copy_roster(uuid, uuid) to authenticated;

-- ===== supabase/migrations/0009_open_access.sql =====
-- BME Workflow · 0009 open-access switch
-- When app_settings.open_access is true, nobody needs to sign in: every visitor (including
-- anonymous ones) acts as an admin and can read and edit everything, including student marks.
-- Turn security back on at any time with ONE line in the SQL Editor:
--     update public.app_settings set open_access = false;
-- and back off again with:
--     update public.app_settings set open_access = true;

create table if not exists public.app_settings (
  id           boolean primary key default true check (id),   -- exactly one row
  open_access  boolean not null default false,
  updated_at   timestamptz not null default now()
);
insert into public.app_settings (id, open_access) values (true, true)
on conflict (id) do update set open_access = true, updated_at = now();
alter table public.app_settings enable row level security;
drop policy if exists read_all on public.app_settings;
create policy read_all on public.app_settings for select to anon, authenticated using (true);
-- No write policy on purpose: the switch can only be changed in the SQL Editor.

create or replace function public.app_open_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select open_access from public.app_settings where id), false)
$$;

-- Permission helpers: open access makes every visitor an active admin and HOD.
create or replace function public.fn_is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_open_access() or exists (select 1 from public.fn_me())
$$;
create or replace function public.fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_open_access() or exists (select 1 from public.fn_me() where app_role in ('admin','hod'))
$$;
create or replace function public.fn_is_hod() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_open_access() or exists (select 1 from public.fn_me() where app_role = 'hod')
$$;

-- The exam RPC must accept callers who are not signed in when open access is on.
create or replace function public.set_exam_task(
  p_offering uuid, p_step text, p_status text, p_note text default null, p_half text default null)
returns public.exam_tasks
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.fn_faculty();
  admin boolean := public.fn_is_admin();
  owner uuid;
  dep text;
  blocked text[] := '{}';
  v_row public.exam_tasks;
  code text;
  step_after text;
begin
  if me is null and not admin then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not (p_status = any (public.exam_step_statuses(p_step))) then
    raise exception 'Status "%" is not valid for step %', p_status, p_step using errcode = '22023';
  end if;

  select owner_id into owner from public.v_exam_owners where offering_id = p_offering and step = p_step;
  if p_step = 'hod' and p_status = 'received' then
    if not public.fn_is_hod() and not admin then raise exception 'Only the HOD can confirm receipt' using errcode = '42501'; end if;
  elsif p_step = 'printing' then
    if not admin then raise exception 'Printing is updated by the department office (admins)' using errcode = '42501'; end if;
  elsif owner is distinct from me and not admin then
    raise exception 'This step belongs to another faculty member' using errcode = '42501';
  end if;

  -- Dependencies: a step can move past not_started only when every prerequisite is done.
  if p_status <> 'not_started' then
    foreach dep in array public.exam_step_deps(p_step) loop
      if not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = dep
                     and public.exam_step_done(t.step, t.status)) then
        blocked := blocked || dep;
      end if;
    end loop;
    if array_length(blocked, 1) > 0 and not (admin and coalesce(trim(p_note), '') <> '') then
      raise exception 'Waiting on: %', array_to_string(blocked, ', ') using errcode = 'P0001',
        hint = 'Admins can override with a note.';
    end if;
  end if;

  -- Gradesheet preparation also needs every class test's marks published.
  if p_step = 'gs_prep' and p_status <> 'not_started' and exists (
      select 1 from public.assessment_items i join public.assessment_components c on c.id = i.component_id
      where i.offering_id = p_offering and c.kind = 'class_test' and i.status <> 'cancelled'
        and i.marks_status not in ('published','locked')) and not admin then
    raise exception 'Publish all class test marks before preparing the gradesheet' using errcode = 'P0001';
  end if;

  -- Moderator returns a half for correction.
  if p_step in ('mod_1','mod_2') and p_status = 'needs_correction' then
    if p_half not in ('A','B') then raise exception 'Choose which half (A or B) needs correction' using errcode = '22023'; end if;
    insert into public.moderation_rounds (offering_id, moderator_step, half, comment, returned_by)
    values (p_offering, p_step, p_half, p_note, me);
    update public.exam_tasks set status = 'under_correction', updated_by = me, updated_at = now()
     where offering_id = p_offering and step = case p_half when 'A' then 'qp_a' else 'qp_b' end;
    perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering
                               and step = case p_half when 'A' then 'qp_a' else 'qp_b' end),
      'returned', 'Question paper returned for correction',
      coalesce(p_note, 'A moderator returned your half of the question paper.'), null);
  end if;

  -- A preparer resubmits: open rounds close, moderators who returned it go back to reviewing.
  if p_step in ('qp_a','qp_b') and p_status = 'submitted' then
    update public.moderation_rounds set resolved_at = now()
     where offering_id = p_offering and resolved_at is null and half = case p_step when 'qp_a' then 'A' else 'B' end;
    update public.exam_tasks t set status = 'under_moderation', updated_at = now()
     where t.offering_id = p_offering and t.step in ('mod_1','mod_2') and t.status = 'needs_correction'
       and not exists (select 1 from public.moderation_rounds r where r.offering_id = p_offering
                       and r.moderator_step = t.step and r.resolved_at is null);
  end if;

  update public.exam_tasks set status = p_status, note = coalesce(p_note, note), updated_by = me, updated_at = now()
   where offering_id = p_offering and step = p_step
  returning * into v_row;
  if v_row is null then raise exception 'No exam workflow exists for this course yet' using errcode = 'P0002'; end if;

  -- Tell owners of steps that just unlocked.
  select c.code into code from public.offerings o join public.courses c on c.id = o.course_id where o.id = p_offering;
  if public.exam_step_done(p_step, p_status) then
    for step_after in select unnest(array['mod_1','mod_2','printing','exam_a','exam_b','scrutiny','gs_prep','gs_scrutiny','hod']) loop
      if p_step = any (public.exam_step_deps(step_after)) and not exists (
          select 1 from unnest(public.exam_step_deps(step_after)) d
          where not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = d
                            and public.exam_step_done(t.step, t.status))) then
        perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering and step = step_after),
          'unlocked', code || ': your next exam step is ready',
          'The step "' || step_after || '" for ' || code || ' can now proceed.', p_offering || ':' || step_after || ':unlocked');
      end if;
    end loop;
  end if;
  return v_row;
end $$;

-- Let anonymous visitors through every existing policy; the helpers above decide what they get.
-- With open_access = false, anonymous visitors match no helper and see nothing, as before.
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('alter policy %I on public.%I to anon, authenticated', p.policyname, p.tablename);
  end loop;
end $$;

grant usage on schema public to anon;
grant select, insert, update, delete on all tables in schema public to anon;
grant execute on function public.app_open_access(), public.set_exam_task(uuid, text, text, text, text),
  public.set_sessional_gradesheet(uuid, text, text), public.generate_items(uuid),
  public.reschedule_item(uuid, date, text, boolean), public.import_term_plan(jsonb),
  public.enrol_students(uuid, jsonb), public.copy_roster(uuid, uuid), public.fn_me() to anon, authenticated;

-- ===== supabase/migrations/0010_notify_only.sql =====
-- BME Workflow · 0010 notify-only: marks are not kept in this system.
-- Gradesheet preparation no longer waits for marks to be published (they never are here).
-- Same bodies as 0009 set_exam_task and 0004 set_sessional_gradesheet, minus the marks checks.
-- Marks, roster and attainment tables stay in place but are unused by the website.

create or replace function public.set_exam_task(
  p_offering uuid, p_step text, p_status text, p_note text default null, p_half text default null)
returns public.exam_tasks
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.fn_faculty();
  admin boolean := public.fn_is_admin();
  owner uuid;
  dep text;
  blocked text[] := '{}';
  v_row public.exam_tasks;
  code text;
  step_after text;
begin
  if me is null and not admin then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not (p_status = any (public.exam_step_statuses(p_step))) then
    raise exception 'Status "%" is not valid for step %', p_status, p_step using errcode = '22023';
  end if;

  select owner_id into owner from public.v_exam_owners where offering_id = p_offering and step = p_step;
  if p_step = 'hod' and p_status = 'received' then
    if not public.fn_is_hod() and not admin then raise exception 'Only the HOD can confirm receipt' using errcode = '42501'; end if;
  elsif p_step = 'printing' then
    if not admin then raise exception 'Printing is updated by the department office (admins)' using errcode = '42501'; end if;
  elsif owner is distinct from me and not admin then
    raise exception 'This step belongs to another faculty member' using errcode = '42501';
  end if;

  -- Dependencies: a step can move past not_started only when every prerequisite is done.
  if p_status <> 'not_started' then
    foreach dep in array public.exam_step_deps(p_step) loop
      if not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = dep
                     and public.exam_step_done(t.step, t.status)) then
        blocked := blocked || dep;
      end if;
    end loop;
    if array_length(blocked, 1) > 0 and not (admin and coalesce(trim(p_note), '') <> '') then
      raise exception 'Waiting on: %', array_to_string(blocked, ', ') using errcode = 'P0001',
        hint = 'Admins can override with a note.';
    end if;
  end if;

  -- Moderator returns a half for correction.
  if p_step in ('mod_1','mod_2') and p_status = 'needs_correction' then
    if p_half not in ('A','B') then raise exception 'Choose which half (A or B) needs correction' using errcode = '22023'; end if;
    insert into public.moderation_rounds (offering_id, moderator_step, half, comment, returned_by)
    values (p_offering, p_step, p_half, p_note, me);
    update public.exam_tasks set status = 'under_correction', updated_by = me, updated_at = now()
     where offering_id = p_offering and step = case p_half when 'A' then 'qp_a' else 'qp_b' end;
    perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering
                               and step = case p_half when 'A' then 'qp_a' else 'qp_b' end),
      'returned', 'Question paper returned for correction',
      coalesce(p_note, 'A moderator returned your half of the question paper.'), null);
  end if;

  -- A preparer resubmits: open rounds close, moderators who returned it go back to reviewing.
  if p_step in ('qp_a','qp_b') and p_status = 'submitted' then
    update public.moderation_rounds set resolved_at = now()
     where offering_id = p_offering and resolved_at is null and half = case p_step when 'qp_a' then 'A' else 'B' end;
    update public.exam_tasks t set status = 'under_moderation', updated_at = now()
     where t.offering_id = p_offering and t.step in ('mod_1','mod_2') and t.status = 'needs_correction'
       and not exists (select 1 from public.moderation_rounds r where r.offering_id = p_offering
                       and r.moderator_step = t.step and r.resolved_at is null);
  end if;

  update public.exam_tasks set status = p_status, note = coalesce(p_note, note), updated_by = me, updated_at = now()
   where offering_id = p_offering and step = p_step
  returning * into v_row;
  if v_row is null then raise exception 'No exam workflow exists for this course yet' using errcode = 'P0002'; end if;

  -- Tell owners of steps that just unlocked.
  select c.code into code from public.offerings o join public.courses c on c.id = o.course_id where o.id = p_offering;
  if public.exam_step_done(p_step, p_status) then
    for step_after in select unnest(array['mod_1','mod_2','printing','exam_a','exam_b','scrutiny','gs_prep','gs_scrutiny','hod']) loop
      if p_step = any (public.exam_step_deps(step_after)) and not exists (
          select 1 from unnest(public.exam_step_deps(step_after)) d
          where not exists (select 1 from public.exam_tasks t where t.offering_id = p_offering and t.step = d
                            and public.exam_step_done(t.step, t.status))) then
        perform public.fn_notify((select owner_id from public.v_exam_owners where offering_id = p_offering and step = step_after),
          'unlocked', code || ': your next exam step is ready',
          'The step "' || step_after || '" for ' || code || ' can now proceed.', p_offering || ':' || step_after || ':unlocked');
      end if;
    end loop;
  end if;
  return v_row;
end $$;

create or replace function public.set_sessional_gradesheet(p_offering uuid, p_part text, p_status text)
returns public.sessional_gradesheets
language plpgsql security definer set search_path = public as $$
declare me uuid := public.fn_faculty(); g public.sessional_gradesheets; admin boolean := public.fn_is_admin();
begin
  select * into g from public.sessional_gradesheets where offering_id = p_offering;
  if g is null then raise exception 'No gradesheet assignment for this course' using errcode = 'P0002'; end if;
  if p_part = 'prep' then
    if g.preparer is distinct from me and not admin then raise exception 'Only the gradesheet preparer can update this' using errcode = '42501'; end if;
    update public.sessional_gradesheets set prep_status = p_status, updated_at = now() where offering_id = p_offering returning * into g;
    if p_status = 'forwarded' then
      perform public.fn_notify(g.scrutinizer, 'unlocked', 'Sessional gradesheet ready for scrutiny', 'A sessional gradesheet was forwarded to you.', p_offering || ':sg:scrutiny');
    end if;
  elsif p_part = 'scrutiny' then
    if g.scrutinizer is distinct from me and not admin then raise exception 'Only the gradesheet scrutinizer can update this' using errcode = '42501'; end if;
    if p_status <> 'not_started' and g.prep_status <> 'forwarded' and not admin then
      raise exception 'Waiting on the gradesheet preparer' using errcode = 'P0001';
    end if;
    update public.sessional_gradesheets set scrutiny_status = p_status, updated_at = now() where offering_id = p_offering returning * into g;
  else
    raise exception 'Unknown part %', p_part using errcode = '22023';
  end if;
  return g;
end $$;

-- ===== supabase/migrations/0011_obe_results.sql =====
-- BME Workflow · 0011 OBE module (spec "BME OBE Module — Detailed Specification", 2026-11-03), without student marks.
-- Attainment is imported per offering (cohort CO% and PO% from the course workbooks), not computed from marks.
-- Adds: culminating flag, per-offering thresholds and batch, richer CO fields (taxonomy levels, delivery, tools, K/P/A),
-- imported attainment, CAR parts C–E with a review workflow, the course-file checklist, BUGS resolutions and the CQI log.

-- ---------------------------------------------------------------- courses and offerings
alter table public.courses add column if not exists is_culminating boolean not null default false;
update public.courses set is_culminating = true where code in ('BME 300', 'BME 350', 'BME 400');

create table if not exists public.bugs_resolutions (
  id              uuid primary key default gen_random_uuid(),
  meeting_no      text not null,
  held_on         date,
  title           text,
  agenda_tags     text[] not null default '{}' check (agenda_tags <@ array['CO','PO','PEO']),
  link            text,
  effective_term  text,
  created_at      timestamptz not null default now()
);

alter table public.offerings
  add column if not exists student_batch     text,                                  -- e.g. 'BME 20' (program PO is per batch)
  add column if not exists co_threshold      numeric(4,2) not null default 0.40 check (co_threshold between 0 and 1),
  add column if not exists cohort_threshold  numeric(4,2) not null default 0.40 check (cohort_threshold between 0 and 1),
  add column if not exists po_threshold      numeric(4,2) not null default 0.40 check (po_threshold between 0 and 1),
  add column if not exists co_resolution_id  uuid references public.bugs_resolutions(id) on delete set null;

-- ---------------------------------------------------------------- course outcomes (CO-PO Mapping.docx columns)
alter table public.course_outcomes
  add column if not exists domain_levels text[] not null default '{}',
  add column if not exists delivery      text[] not null default '{}',
  add column if not exists tools         text[] not null default '{}',
  add column if not exists kpa           text[] not null default '{}';
alter table public.course_outcomes drop constraint if exists course_outcomes_kpa_check;
alter table public.course_outcomes add constraint course_outcomes_kpa_check check (kpa <@ array[
  'K1','K2','K3','K4','K5','K6','K7','K8','P1','P2','P3','P4','P5','P6','P7','A1','A2','A3','A4','A5']);
-- The spec maps COs to POs as mapped / not mapped; co_po_map.strength stays as the weight (1 = mapped).

-- ---------------------------------------------------------------- imported attainment (cohort level)
create table if not exists public.obe_attainment (
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  outcome_type  text not null check (outcome_type in ('CO','PO')),
  code          text not null check (code ~ '^(CO|PO)([1-9]|1[0-2])$'),
  value         numeric(7,4) check (value between 0 and 100),  -- cohort %, full precision; null = NA
  source        text not null default 'manual' check (source in ('manual','import')),
  updated_at    timestamptz not null default now(),
  primary key (offering_id, outcome_type, code)
);

-- Program PO per batch: mean of the culminating courses' cohort PO% (BAETE PO reference, level 4).
create or replace view public.v_program_po with (security_invoker = true) as
  select o.student_batch as batch, a.code as po_code, avg(a.value) as value, count(*)::int as courses,
         array_agg(c.code order by c.code) as course_codes
    from public.obe_attainment a
    join public.offerings o on o.id = a.offering_id
    join public.courses c on c.id = o.course_id
   where a.outcome_type = 'PO' and a.value is not null and c.is_culminating and o.student_batch is not null
   group by o.student_batch, a.code;

-- ---------------------------------------------------------------- CAR (parts A and B are rendered from data)
create table if not exists public.car_reports (
  offering_id  uuid primary key references public.offerings(id) on delete cascade,
  part_c       text not null default '',
  part_d       text not null default '',
  part_e       text not null default '',
  status       text not null default 'draft' check (status in ('draft','submitted','reviewed','final')),
  review_note  text,
  updated_at   timestamptz not null default now()
);

-- Review and finalisation belong to the OBE Cell / HOD; a final CAR is reopened only by them.
create or replace function public.tg_car_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.fn_is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status in ('reviewed','final') then
      raise exception 'Only the OBE Cell or HOD can review or finalise a CAR' using errcode = '42501';
    end if;
  else
    if old.status = 'final' then
      raise exception 'This CAR is final. Ask an admin to reopen it' using errcode = '42501';
    end if;
    if new.status in ('reviewed','final') and new.status is distinct from old.status then
      raise exception 'Only the OBE Cell or HOD can review or finalise a CAR' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists car_guard on public.car_reports;
create trigger car_guard before insert or update on public.car_reports for each row execute function public.tg_car_guard();

-- ---------------------------------------------------------------- course file checklist (manual slots; others are derived)
create table if not exists public.course_file_items (
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  slot         text not null check (slot in ('outline','lecture_materials','scripts','attainment_workbook','bsfs_feedback')),
  done         boolean not null default false,
  link         text,
  updated_at   timestamptz not null default now(),
  primary key (offering_id, slot)
);

-- ---------------------------------------------------------------- CQI log (CO / PO / PEO loops)
create table if not exists public.cqi_items (
  id              uuid primary key default gen_random_uuid(),
  loop            text not null check (loop in ('CO','PO','PEO')),
  source          text not null default 'CAR' check (source in ('CAR','attainment','survey','IAP','other')),
  offering_id     uuid references public.offerings(id) on delete set null,
  course_code     text,
  finding         text not null,
  action          text,
  owner           text,
  resolution_id   uuid references public.bugs_resolutions(id) on delete set null,
  effective_term  text,
  status          text not null default 'proposed' check (status in ('proposed','approved','implemented','verified')),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- row-level security
do $$ declare t text; begin
  foreach t in array array['bugs_resolutions','obe_attainment','car_reports','course_file_items','cqi_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists dept_read on public.%I', t);
    execute format('create policy dept_read on public.%I for select to anon, authenticated using (public.fn_is_active())', t);
  end loop;
  foreach t in array array['obe_attainment','car_reports','course_file_items'] loop
    execute format('drop policy if exists teacher_write on public.%I', t);
    execute format('create policy teacher_write on public.%I for all to anon, authenticated using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id))', t);
  end loop;
end $$;
drop policy if exists admin_write on public.bugs_resolutions;
create policy admin_write on public.bugs_resolutions for all to anon, authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
drop policy if exists cqi_write on public.cqi_items;
create policy cqi_write on public.cqi_items for all to anon, authenticated
  using (public.fn_is_admin() or (offering_id is not null and public.fn_can_manage(offering_id)))
  with check (public.fn_is_admin() or (offering_id is not null and public.fn_can_manage(offering_id)));

-- ---------------------------------------------------------------- audit
drop trigger if exists audit on public.obe_attainment;
create trigger audit after insert or update or delete on public.obe_attainment for each row execute function public.tg_audit('offering_id');
drop trigger if exists audit on public.car_reports;
create trigger audit after insert or update or delete on public.car_reports for each row execute function public.tg_audit('offering_id');
drop trigger if exists audit on public.co_po_map;
create trigger audit after insert or update or delete on public.co_po_map for each row execute function public.tg_audit('co_id');

-- ===== supabase/migrations/0012_date_later.sql =====
-- BME Workflow · 0012 "To be set later" for assessment dates.
-- A teacher can mark an item's date as deliberately left for later; the app shows it glowing dark red until a date is set.
alter table public.assessment_items add column if not exists date_later boolean not null default false;

-- Setting a date clears the reminder, whichever page set it.
create or replace function public.tg_item_date_later() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.held_on is not null then new.date_later := false; end if;
  return new;
end $$;
drop trigger if exists item_date_later on public.assessment_items;
create trigger item_date_later before insert or update of held_on, date_later on public.assessment_items
  for each row execute function public.tg_item_date_later();


-- ===== supabase/migrations/0013_obe_master.sql =====
-- BME Workflow · 0013 OBE master data: course outline & documents per offering, the assessment map with
-- teacher-built rubric criteria, and carry-forward so a new offering starts from the last one.
-- Data from the OBE master copy is loaded separately by supabase/seed_obe_master.sql.

-- ---------------------------------------------------------------- outline and documents of an offering
create table if not exists public.obe_offering_docs (
  offering_id         uuid primary key references public.offerings(id) on delete cascade,
  contents            text,                                   -- course contents (as approved by the Academic Council)
  objectives          text,                                   -- one objective per line
  outline_text        text,                                   -- full text of the outline document, for reference
  instructors         jsonb not null default '[]',            -- [{name, room, email}] as written in the outline
  marks_distribution  jsonb not null default '[]',            -- [{component, percent}]
  components          jsonb not null default '[]',            -- workbook component weights [{component, weight, marks}]
  source              jsonb not null default '{}',            -- {folder, files{}, car_text} from the department folder
  issues              text[] not null default '{}',           -- gaps found when the folder was read
  copied_from         uuid references public.offerings(id) on delete set null, -- set while carried-forward content awaits review
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------- assessment map: question parts and rubric criteria
-- Each row is one question part (e.g. "Q01 (a)") or one rubric criterion (e.g. "Clinical Need Identification"),
-- grouped by assessment (Term Final, Presentation 01…), with its marks and the COs it assesses.
-- levels holds the rubric the teachers write: [{label, marks, descriptor}], empty for an exam question.
create table if not exists public.obe_criteria (
  id           uuid primary key default gen_random_uuid(),
  offering_id  uuid not null references public.offerings(id) on delete cascade,
  assessment   text not null check (length(trim(assessment)) > 0),
  label        text not null check (length(trim(label)) > 0),
  max_marks    numeric(7,3) not null check (max_marks > 0),
  levels       jsonb not null default '[]',
  sort         integer not null default 0
);
create index if not exists obe_criteria_offering on public.obe_criteria (offering_id, sort);

create table if not exists public.obe_criterion_cos (
  criterion_id  uuid not null references public.obe_criteria(id) on delete cascade,
  co_id         uuid not null references public.course_outcomes(id) on delete cascade,
  primary key (criterion_id, co_id)
);

-- ---------------------------------------------------------------- carry-forward
/** Order key of a term: its start month, else its code (codes are YYYY-MM). */
create or replace function public.obe_term_key(t public.terms) returns text
language sql immutable as $$ select coalesce(to_char(t.starts_on, 'YYYY-MM'), t.code) $$;

/** Fills an offering's empty parts (COs + mapping, assessment map, outline) from the same course's newest earlier
    offering that has COs. Attainment and the CAR are never copied. Returns what was copied. */
create or replace function public.obe_copy_forward_internal(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tgt record; src uuid; n_co int := 0; n_cr int := 0; docs boolean := false;
begin
  select o.id, o.course_id, public.obe_term_key(t) as k into tgt from offerings o join terms t on t.id = o.term_id where o.id = p_offering;
  if tgt.id is null then return null; end if;
  select o.id into src from offerings o join terms t on t.id = o.term_id
   where o.course_id = tgt.course_id and o.id <> p_offering and public.obe_term_key(t) < tgt.k
     and exists (select 1 from course_outcomes c where c.offering_id = o.id)
   order by public.obe_term_key(t) desc limit 1;
  if src is null then return jsonb_build_object('from', null); end if;

  if not exists (select 1 from course_outcomes where offering_id = p_offering) then
    insert into course_outcomes (offering_id, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa)
    select p_offering, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa from course_outcomes where offering_id = src;
    get diagnostics n_co = row_count;
    insert into co_po_map (co_id, po_code, strength)
    select n.id, m.po_code, m.strength from co_po_map m join course_outcomes s on s.id = m.co_id and s.offering_id = src
      join course_outcomes n on n.offering_id = p_offering and n.code = s.code;
  end if;

  if not exists (select 1 from obe_criteria where offering_id = p_offering) then
    with ins as (
      insert into obe_criteria (offering_id, assessment, label, max_marks, levels, sort)
      select p_offering, assessment, label, max_marks, levels, sort from obe_criteria where offering_id = src
      returning id, sort, label)
    select count(*) into n_cr from ins;
    insert into obe_criterion_cos (criterion_id, co_id)
    select nc.id, nco.id from obe_criteria sc
      join obe_criterion_cos l on l.criterion_id = sc.id
      join course_outcomes sco on sco.id = l.co_id
      join obe_criteria nc on nc.offering_id = p_offering and nc.sort = sc.sort and nc.label = sc.label
      join course_outcomes nco on nco.offering_id = p_offering and nco.code = sco.code
     where sc.offering_id = src
    on conflict do nothing;
  end if;

  if not exists (select 1 from obe_offering_docs where offering_id = p_offering) then
    insert into obe_offering_docs (offering_id, contents, objectives, marks_distribution, components, copied_from)
    select p_offering, contents, objectives,
      case when marks_distribution = '[]' then coalesce((select d.marks_distribution from obe_offering_docs d join offerings o on o.id = d.offering_id
        where o.course_id = tgt.course_id and d.marks_distribution <> '[]' limit 1), '[]') else marks_distribution end,
      components, src
    from obe_offering_docs where offering_id = src;
    docs := found;
  end if;
  if n_co > 0 or n_cr > 0 then
    insert into obe_offering_docs (offering_id, copied_from) values (p_offering, src)
    on conflict (offering_id) do update set copied_from = src;
  end if;
  return jsonb_build_object('from', src, 'cos', n_co, 'criteria', n_cr, 'outline', docs);
end $$;

/** The same, for a teacher of the offering (the "Fill from last term" buttons). */
create or replace function public.obe_copy_forward(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_can_manage(p_offering) then raise exception 'Only this course''s teachers or an admin can do this' using errcode = '42501'; end if;
  return public.obe_copy_forward_internal(p_offering);
end $$;
grant execute on function public.obe_copy_forward(uuid) to anon, authenticated;

-- A new offering (term import or manual setup) starts with last offering's COs, mapping, assessment map and outline.
create or replace function public.tg_offering_copy_forward() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.obe_copy_forward_internal(new.id); return new; end $$;
drop trigger if exists offering_copy_forward on public.offerings;
create trigger offering_copy_forward after insert on public.offerings for each row execute function public.tg_offering_copy_forward();

-- ---------------------------------------------------------------- row-level security and audit
alter table public.obe_offering_docs enable row level security;
alter table public.obe_criteria enable row level security;
alter table public.obe_criterion_cos enable row level security;
do $$ declare t text; begin
  foreach t in array array['obe_offering_docs','obe_criteria','obe_criterion_cos'] loop
    execute format('drop policy if exists dept_read on public.%I', t);
    execute format('create policy dept_read on public.%I for select to anon, authenticated using (public.fn_is_active())', t);
    execute format('drop policy if exists teacher_write on public.%I', t);
  end loop;
end $$;
create policy teacher_write on public.obe_offering_docs for all to anon, authenticated using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.obe_criteria for all to anon, authenticated using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
create policy teacher_write on public.obe_criterion_cos for all to anon, authenticated
  using (public.fn_can_manage((select offering_id from public.obe_criteria where id = criterion_id)))
  with check (public.fn_can_manage((select offering_id from public.obe_criteria where id = criterion_id)));
grant select, insert, update, delete on public.obe_offering_docs, public.obe_criteria, public.obe_criterion_cos to anon, authenticated;

drop trigger if exists audit on public.obe_criteria;
create trigger audit after insert or update or delete on public.obe_criteria for each row execute function public.tg_audit();
drop trigger if exists audit on public.obe_offering_docs;
create trigger audit after insert or update or delete on public.obe_offering_docs for each row execute function public.tg_audit('offering_id');

-- Let the API see the new tables and functions now, not after its next restart.
notify pgrst, 'reload schema';


-- ===== supabase/migrations/0014_rubrics.sql =====
-- BME Workflow · 0014 rubrics a teacher sets for an offering (presentations, demonstrations, projects, reports).
-- Criteria, their bands and their CO links live in one jsonb document per rubric:
--   criteria: [{ id, name, max, levels: [{ label, min, max, text }], cos: [course_outcomes.id, …] }]
-- CO links are by id, so renumbering COs keeps them; links to deleted COs are ignored by the app.
-- Carry-forward (0013) is extended so a new offering also starts with the last offering's rubrics.
create table if not exists public.rubrics (
  id            uuid primary key default gen_random_uuid(),
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  component_id  uuid references public.assessment_components(id) on delete set null,
  title         text not null default '',
  levels        text[] not null default array['Excellent','Good','Satisfactory','Needs Improvement','Poor'],
  criteria      jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),
  note          text not null default '',
  sort          int not null default 0,
  updated_at    timestamptz not null default now()
);
create index if not exists rubrics_offering on public.rubrics(offering_id);

alter table public.rubrics enable row level security;
drop policy if exists dept_read on public.rubrics;
create policy dept_read on public.rubrics for select to anon, authenticated using (public.fn_is_active());
drop policy if exists teacher_write on public.rubrics;
create policy teacher_write on public.rubrics for all to anon, authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));
grant select, insert, update, delete on public.rubrics to anon, authenticated;

drop trigger if exists audit on public.rubrics;
create trigger audit after insert or update or delete on public.rubrics for each row execute function public.tg_audit();

-- ---------------------------------------------------------------- carry-forward, now with rubrics
/** As in 0013, plus rubrics: copied when the target has none, with each criterion's CO ids re-pointed to the
    target's CO of the same code (CO1 → CO1). The assessment link is dropped because components belong to a term. */
create or replace function public.obe_copy_forward_internal(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tgt record; src uuid; n_co int := 0; n_cr int := 0; n_rb int := 0; docs boolean := false;
begin
  select o.id, o.course_id, public.obe_term_key(t) as k into tgt from offerings o join terms t on t.id = o.term_id where o.id = p_offering;
  if tgt.id is null then return null; end if;
  select o.id into src from offerings o join terms t on t.id = o.term_id
   where o.course_id = tgt.course_id and o.id <> p_offering and public.obe_term_key(t) < tgt.k
     and exists (select 1 from course_outcomes c where c.offering_id = o.id)
   order by public.obe_term_key(t) desc limit 1;
  if src is null then return jsonb_build_object('from', null); end if;

  if not exists (select 1 from course_outcomes where offering_id = p_offering) then
    insert into course_outcomes (offering_id, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa)
    select p_offering, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa from course_outcomes where offering_id = src;
    get diagnostics n_co = row_count;
    insert into co_po_map (co_id, po_code, strength)
    select n.id, m.po_code, m.strength from co_po_map m join course_outcomes s on s.id = m.co_id and s.offering_id = src
      join course_outcomes n on n.offering_id = p_offering and n.code = s.code;
  end if;

  if not exists (select 1 from obe_criteria where offering_id = p_offering) then
    with ins as (
      insert into obe_criteria (offering_id, assessment, label, max_marks, levels, sort)
      select p_offering, assessment, label, max_marks, levels, sort from obe_criteria where offering_id = src
      returning id)
    select count(*) into n_cr from ins;
    insert into obe_criterion_cos (criterion_id, co_id)
    select nc.id, nco.id from obe_criteria sc
      join obe_criterion_cos l on l.criterion_id = sc.id
      join course_outcomes sco on sco.id = l.co_id
      join obe_criteria nc on nc.offering_id = p_offering and nc.sort = sc.sort and nc.label = sc.label
      join course_outcomes nco on nco.offering_id = p_offering and nco.code = sco.code
     where sc.offering_id = src
    on conflict do nothing;
  end if;

  if not exists (select 1 from rubrics where offering_id = p_offering) then
    insert into rubrics (offering_id, title, levels, note, sort, criteria)
    select p_offering, r.title, r.levels, r.note, r.sort,
      coalesce((select jsonb_agg(c || jsonb_build_object('cos', coalesce((
          select jsonb_agg(n.id) from jsonb_array_elements_text(c->'cos') x
            join course_outcomes s on s.id::text = x.value and s.offering_id = src
            join course_outcomes n on n.offering_id = p_offering and n.code = s.code), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(r.criteria) with ordinality e(c, ord)), '[]'::jsonb)
    from rubrics r where r.offering_id = src;
    get diagnostics n_rb = row_count;
  end if;

  if not exists (select 1 from obe_offering_docs where offering_id = p_offering) then
    insert into obe_offering_docs (offering_id, contents, objectives, marks_distribution, components, copied_from)
    select p_offering, contents, objectives,
      case when marks_distribution = '[]' then coalesce((select d.marks_distribution from obe_offering_docs d join offerings o on o.id = d.offering_id
        where o.course_id = tgt.course_id and d.marks_distribution <> '[]' limit 1), '[]') else marks_distribution end,
      components, src
    from obe_offering_docs where offering_id = src;
    docs := found;
  end if;
  if n_co > 0 or n_cr > 0 or n_rb > 0 then
    insert into obe_offering_docs (offering_id, copied_from) values (p_offering, src)
    on conflict (offering_id) do update set copied_from = src;
  end if;
  return jsonb_build_object('from', src, 'cos', n_co, 'criteria', n_cr, 'rubrics', n_rb, 'outline', docs);
end $$;

-- Let the API see the new tables and functions now, not after its next restart.
notify pgrst, 'reload schema';


-- ===== supabase/migrations/0015_obe_computed.sql =====
-- BME Workflow · 0015 attainment computed from an uploaded marksheet, and the extra outline fields the outline PDF needs.
-- The marksheet is read in the browser; raw marks are never stored. What is kept:
--   obe_attainment (source 'computed')  cohort CO% / PO% of the offering, as before
--   obe_student_attainment             each student's CO% and PO% (needed for student-level and program PO)
--   obe_attainment_runs                 when, from which file, with which thresholds, and a fingerprint of the assessment map used

alter table public.obe_attainment drop constraint if exists obe_attainment_source_check;
alter table public.obe_attainment add constraint obe_attainment_source_check check (source in ('manual','import','computed'));

create table if not exists public.obe_attainment_runs (
  offering_id   uuid primary key references public.offerings(id) on delete cascade,
  file_name     text,
  students      integer not null default 0,
  columns       integer not null default 0,
  thresholds    jsonb not null default '{}',     -- {studentCo, cohortCo, studentPo, cohortPo} as fractions
  map_hash      text,                            -- fingerprint of the assessment map + CO→PO mapping used
  warnings      text[] not null default '{}',
  samples       jsonb not null default '[]',     -- highest / average / lowest script per assessment (student IDs and totals)
  computed_at   timestamptz not null default now()
);

create table if not exists public.obe_student_attainment (
  offering_id   uuid not null references public.offerings(id) on delete cascade,
  student_no    text not null check (length(trim(student_no)) > 0),   -- student ID or exam code as written in the marksheet
  outcome_type  text not null check (outcome_type in ('CO','PO')),
  code          text not null check (code ~ '^(CO|PO)([1-9]|1[0-2])$'),
  value         numeric(7,4) check (value between 0 and 100),         -- null = no marks for this outcome
  primary key (offering_id, student_no, outcome_type, code)
);
create index if not exists obe_student_attainment_student on public.obe_student_attainment (student_no);

-- Runs are department-readable like the cohort results; per-student results only by the course's teachers and admins.
alter table public.obe_attainment_runs enable row level security;
drop policy if exists dept_read on public.obe_attainment_runs;
create policy dept_read on public.obe_attainment_runs for select to anon, authenticated using (public.fn_is_active());
drop policy if exists teacher_write on public.obe_attainment_runs;
create policy teacher_write on public.obe_attainment_runs for all to anon, authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));

alter table public.obe_student_attainment enable row level security;
drop policy if exists teacher_read on public.obe_student_attainment;
create policy teacher_read on public.obe_student_attainment for select to anon, authenticated using (public.fn_can_manage(offering_id));
drop policy if exists teacher_write on public.obe_student_attainment;
create policy teacher_write on public.obe_student_attainment for all to anon, authenticated
  using (public.fn_can_manage(offering_id)) with check (public.fn_can_manage(offering_id));

grant select, insert, update, delete on public.obe_attainment_runs, public.obe_student_attainment to anon, authenticated;

drop trigger if exists audit on public.obe_attainment_runs;
create trigger audit after insert or update or delete on public.obe_attainment_runs for each row execute function public.tg_audit('offering_id');

-- Student-level program PO (BAETE PO reference, step 2.2): mean of a student's course PO% across the culminating courses of the batch.
-- Documented by the department but not yet approved by BUGS; shown with that label.
create or replace view public.v_student_program_po with (security_invoker = true) as
  select o.student_batch as batch, s.student_no, s.code as po_code, avg(s.value) as value, count(*)::int as courses,
         array_agg(c.code order by c.code) as course_codes
    from public.obe_student_attainment s
    join public.offerings o on o.id = s.offering_id
    join public.courses c on c.id = o.course_id
   where s.outcome_type = 'PO' and s.value is not null and c.is_culminating and o.student_batch is not null
   group by o.student_batch, s.student_no, s.code;
grant select on public.v_student_program_po to anon, authenticated;

-- Saves one calculation atomically: replaces the offering's per-student results, its cohort results and the run record.
-- p_cohort: [{outcome_type, code, value}], p_students: [{student_no, outcome_type, code, value}], p_run: {file_name, students, columns, thresholds, map_hash, warnings, samples}
create or replace function public.obe_save_computed(p_offering uuid, p_cohort jsonb, p_students jsonb, p_run jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare n_c int; n_s int;
begin
  if not public.fn_can_manage(p_offering) then raise exception 'Only this course''s teachers or an admin can save its attainment' using errcode = '42501'; end if;
  delete from obe_student_attainment where offering_id = p_offering;
  insert into obe_student_attainment (offering_id, student_no, outcome_type, code, value)
  select p_offering, trim(x->>'student_no'), x->>'outcome_type', x->>'code', nullif(x->>'value', '')::numeric
    from jsonb_array_elements(p_students) x;
  get diagnostics n_s = row_count;
  -- Cohort results: computed values replace earlier ones; outcomes no longer computed (e.g. a PO now unmapped) are removed.
  delete from obe_attainment a where a.offering_id = p_offering
     and not exists (select 1 from jsonb_array_elements(p_cohort) x where x->>'outcome_type' = a.outcome_type and x->>'code' = a.code);
  insert into obe_attainment (offering_id, outcome_type, code, value, source, updated_at)
  select p_offering, x->>'outcome_type', x->>'code', nullif(x->>'value', '')::numeric, 'computed', now()
    from jsonb_array_elements(p_cohort) x
  on conflict (offering_id, outcome_type, code) do update set value = excluded.value, source = 'computed', updated_at = now();
  get diagnostics n_c = row_count;
  insert into obe_attainment_runs (offering_id, file_name, students, columns, thresholds, map_hash, warnings, samples, computed_at)
  values (p_offering, p_run->>'file_name', coalesce((p_run->>'students')::int, 0), coalesce((p_run->>'columns')::int, 0),
          coalesce(p_run->'thresholds', '{}'), p_run->>'map_hash',
          coalesce(array(select jsonb_array_elements_text(p_run->'warnings')), '{}'), coalesce(p_run->'samples', '[]'), now())
  on conflict (offering_id) do update set file_name = excluded.file_name, students = excluded.students, columns = excluded.columns,
     thresholds = excluded.thresholds, map_hash = excluded.map_hash, warnings = excluded.warnings, samples = excluded.samples, computed_at = now();
  return jsonb_build_object('cohort', n_c, 'student_rows', n_s);
end $$;
grant execute on function public.obe_save_computed(uuid, jsonb, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- course outline fields for the outline PDF (department format)
alter table public.obe_offering_docs
  add column if not exists assessment_strategy text,                       -- "Assessment Strategy" paragraph of the outline
  add column if not exists textbooks           text,                       -- one textbook / reference per line
  add column if not exists lecture_plan        jsonb not null default '[]'; -- [{lectures: '1–3', topic, cos: 'CO1, CO2'}]

-- Carry-forward (0013/0014) now also copies the new outline fields into the next offering.
create or replace function public.obe_copy_forward_internal(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tgt record; src uuid; n_co int := 0; n_cr int := 0; n_rb int := 0; docs boolean := false;
begin
  select o.id, o.course_id, public.obe_term_key(t) as k into tgt from offerings o join terms t on t.id = o.term_id where o.id = p_offering;
  if tgt.id is null then return null; end if;
  select o.id into src from offerings o join terms t on t.id = o.term_id
   where o.course_id = tgt.course_id and o.id <> p_offering and public.obe_term_key(t) < tgt.k
     and exists (select 1 from course_outcomes c where c.offering_id = o.id)
   order by public.obe_term_key(t) desc limit 1;
  if src is null then return jsonb_build_object('from', null); end if;

  if not exists (select 1 from course_outcomes where offering_id = p_offering) then
    insert into course_outcomes (offering_id, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa)
    select p_offering, code, statement, domain, level, sort, domain_levels, delivery, tools, kpa from course_outcomes where offering_id = src;
    get diagnostics n_co = row_count;
    insert into co_po_map (co_id, po_code, strength)
    select n.id, m.po_code, m.strength from co_po_map m join course_outcomes s on s.id = m.co_id and s.offering_id = src
      join course_outcomes n on n.offering_id = p_offering and n.code = s.code;
  end if;

  if not exists (select 1 from obe_criteria where offering_id = p_offering) then
    with ins as (
      insert into obe_criteria (offering_id, assessment, label, max_marks, levels, sort)
      select p_offering, assessment, label, max_marks, levels, sort from obe_criteria where offering_id = src
      returning id)
    select count(*) into n_cr from ins;
    insert into obe_criterion_cos (criterion_id, co_id)
    select nc.id, nco.id from obe_criteria sc
      join obe_criterion_cos l on l.criterion_id = sc.id
      join course_outcomes sco on sco.id = l.co_id
      join obe_criteria nc on nc.offering_id = p_offering and nc.sort = sc.sort and nc.label = sc.label
      join course_outcomes nco on nco.offering_id = p_offering and nco.code = sco.code
     where sc.offering_id = src
    on conflict do nothing;
  end if;

  if not exists (select 1 from rubrics where offering_id = p_offering) then
    insert into rubrics (offering_id, title, levels, note, sort, criteria)
    select p_offering, r.title, r.levels, r.note, r.sort,
      coalesce((select jsonb_agg(c || jsonb_build_object('cos', coalesce((
          select jsonb_agg(n.id) from jsonb_array_elements_text(c->'cos') x
            join course_outcomes s on s.id::text = x.value and s.offering_id = src
            join course_outcomes n on n.offering_id = p_offering and n.code = s.code), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(r.criteria) with ordinality e(c, ord)), '[]'::jsonb)
    from rubrics r where r.offering_id = src;
    get diagnostics n_rb = row_count;
  end if;

  if not exists (select 1 from obe_offering_docs where offering_id = p_offering) then
    insert into obe_offering_docs (offering_id, contents, objectives, assessment_strategy, textbooks, lecture_plan, marks_distribution, components, copied_from)
    select p_offering, contents, objectives, assessment_strategy, textbooks, lecture_plan,
      case when marks_distribution = '[]' then coalesce((select d.marks_distribution from obe_offering_docs d join offerings o on o.id = d.offering_id
        where o.course_id = tgt.course_id and d.marks_distribution <> '[]' limit 1), '[]') else marks_distribution end,
      components, src
    from obe_offering_docs where offering_id = src;
    docs := found;
  end if;
  if n_co > 0 or n_cr > 0 or n_rb > 0 then
    insert into obe_offering_docs (offering_id, copied_from) values (p_offering, src)
    on conflict (offering_id) do update set copied_from = src;
  end if;
  return jsonb_build_object('from', src, 'cos', n_co, 'criteria', n_cr, 'rubrics', n_rb, 'outline', docs);
end $$;

-- Make the new tables visible to the API straight away.
notify pgrst, 'reload schema';

-- ===== supabase/seed.sql =====
-- BME Workflow seed: public reference data only (no people, no rosters).
-- PEOs and POs: https://bme.buet.ac.bd/ug-program-overview/ and https://bme.buet.ac.bd/program-outcomes/
-- Course catalog: BME undergraduate curriculum (2022). Electives may run in either Level-4 term.

insert into public.peos (code, statement) values
('PEO1', 'Be sufficiently skilled to pursue a diverse range of careers, including engineering, research and entrepreneurship.'),
('PEO2', 'Will persistently advance in their respected professional careers through continuous and life-long learning.'),
('PEO3', 'Design, develop, disseminate Biomedical Engineering solutions through research, innovation and application to meet specific healthcare needs of the society with consideration of public health, safety, and welfare, as well as global, cultural, environmental, and economic factors.'),
('PEO4', 'Practice and uphold high ethical and professional standards, and make informed judgments as a leader and/or member of their team, organizations and communities.')
on conflict (code) do update set statement = excluded.statement;

insert into public.pos (code, no, title, statement, k_profiles) values
('PO1', 1, 'Engineering knowledge', 'Apply knowledge of mathematics, science, and engineering to solve complex engineering problems in the broad areas including biomedical instrumentation, imaging, biomaterials, biomechanics, biosignal analysis and informatics.', 'K1–K4'),
('PO2', 2, 'Problem analysis', 'Identify, formulate, research literature and analyze complex biomedical engineering problems reaching substantiated conclusions using first principles of mathematics, natural, medical and engineering sciences.', 'K1–K4'),
('PO3', 3, 'Design/development of solutions', 'Design solutions to complex engineering problems and design systems, components, or processes that meet the needs relevant to biomedical engineering with appropriate considerations to public health and safety, cultural, societal, and environmental considerations.', 'K5'),
('PO4', 4, 'Investigation', 'Conduct investigations of complex problems using research-based knowledge and research methods including design of experiments, clinical needs assessment, analysis and interpretation of data, and synthesis of information to provide valid conclusions.', 'K8'),
('PO5', 5, 'Modern tool usage', 'Use techniques, skills, and modern engineering tools to solve complex and practical engineering problems related to biomedical engineering with understanding of the limitations.', 'K6'),
('PO6', 6, 'The engineer and society', 'Apply reasoning to assess societal, health, safety, legal and cultural issues and the consequent responsibilities relevant to professional engineering practice and solutions to complex engineering problems.', 'K7'),
('PO7', 7, 'Environment and sustainability', 'Understand and evaluate the sustainability and impact of professional engineering work in the solution of complex engineering problems in societal and environmental contexts.', 'K7'),
('PO8', 8, 'Ethics', 'Apply ethical principles and commit to professional ethics and responsibilities and norms of engineering practice.', 'K7'),
('PO9', 9, 'Individual work and teamwork', 'Function effectively as an individual, and as a member or leader in diverse teams and in multi-disciplinary settings.', null),
('PO10', 10, 'Communication', 'Communicate effectively on complex engineering activities with the biomedical engineering and other inter-disciplinary communities and with society at large, such as being able to comprehend and write effective reports and design documentation, make effective presentations, and give and receive clear instructions.', null),
('PO11', 11, 'Project management and finance', 'Demonstrate knowledge and understanding of engineering management principles and economic decision-making and apply these to one''s own work, as a member and leader in a team, to manage projects and in multidisciplinary environments.', null),
('PO12', 12, 'Life-long learning', 'Recognize the need for, and ability to engage in life-long learning and know contemporary aspects related to the field of biomedical engineering.', null)
on conflict (code) do update set statement = excluded.statement, title = excluded.title, k_profiles = excluded.k_profiles;

insert into public.courses (code, title, course_type, level, term_no, credits, contact_hours, elective_group) values
('BME 101','Introduction to Biomedical Engineering','theory',1,1,3,3,null),
('BME 103','Introduction to Living Cells and Human Anatomy','theory',1,2,3,3,null),
('BME 150','Computer Aided Design in Biomedical Engineering Sessional','sessional',1,2,1.5,3,null),
('BME 201','Biomechanics','theory',2,1,3,3,null),
('BME 202','Biomechanics Sessional','sessional',2,1,0.75,1.5,null),
('BME 203','Human Physiology','theory',2,1,3,3,null),
('BME 204','Human Physiology Sessional','sessional',2,1,1.5,3,null),
('BME 205','Biofluid Mechanics and Heat Transfer','theory',2,2,3,3,null),
('BME 206','Biofluid Mechanics and Heat Transfer Sessional','sessional',2,2,1.5,3,null),
('BME 207','Biomaterials','theory',2,2,3,3,null),
('BME 208','Biomaterials Sessional','sessional',2,2,1.5,3,null),
('BME 210','Numerical Techniques Sessional','sessional',2,2,0.75,1.5,null),
('BME 211','Bioelectricity','theory',2,2,3,3,null),
('BME 300','Biomedical Engineering Design - I','design',3,1,1.5,3,null),
('BME 303','Biomedical Instrumentation and Measurements','theory',3,1,3,3,null),
('BME 304','Biomedical Instrumentation and Measurements Sessional','sessional',3,1,1.5,3,null),
('BME 305','Biomedical Control Systems','theory',3,2,3,3,null),
('BME 306','Biomedical Control Systems Sessional','sessional',3,2,1.5,3,null),
('BME 307','Biomedical Transport Fundamentals','theory',3,2,3,3,null),
('BME 309','Quantitative Physiology','theory',3,1,3,3,null),
('BME 310','Communicating Protocols for Biomedical Instruments Sessional','sessional',3,1,1.5,3,null),
('BME 311','Biomedical Signals and Systems','theory',3,1,3,3,null),
('BME 313','Molecular Biology and Immunology','theory',3,2,3,3,null),
('BME 317','Biochemistry for Biomedical Engineers','theory',3,2,3,3,null),
('BME 320','Industrial Attachment','attachment',3,2,1,null,null),
('BME 350','Biomedical Engineering Design - II','design',3,2,1.5,3,null),
('BME 400','Project and Thesis','thesis',4,null,3,6,null),
('BME 403','Medical Imaging','theory',4,1,3,3,null),
('BME 404','Medical Imaging Sessional','sessional',4,1,1.5,3,null),
('BME 405','Healthcare System Management','theory',4,2,3,3,null),
('BME 409','Tissue Engineering and Regenerative Medicine','theory',4,null,3,3,'I'),
('BME 411','BioMEMS','theory',4,null,3,3,'I'),
('BME 413','BioMicro and Nanotechnology','theory',4,null,3,3,'I'),
('BME 415','Bionanomaterials','theory',4,null,3,3,'I'),
('BME 417','Advanced Biofluid Mechanics','theory',4,null,3,3,'I'),
('BME 419','Implantable Systems','theory',4,null,3,3,'I'),
('BME 421','Rehabilitation Engineering','theory',4,null,3,3,'I'),
('BME 423','Human Assist Devices','theory',4,null,3,3,'I'),
('BME 425','Drug Delivery','theory',4,null,3,3,'I'),
('BME 427','Introduction to Medical Robotics','theory',4,null,3,3,'I'),
('BME 431','Telemedicine Systems','theory',4,null,3,3,'II'),
('BME 433','Biosensors','theory',4,null,3,3,'II'),
('BME 435','Introduction of Biophysics of Molecules and Cells','theory',4,null,3,3,'II'),
('BME 437','Engineering Optics for Medical Application','theory',4,null,3,3,'II'),
('BME 439','Neural Systems Modeling','theory',4,null,3,3,'II'),
('BME 441','Neural Engineering','theory',4,null,3,3,'II'),
('BME 443','Magnetic Resonance Imaging','theory',4,null,3,3,'II'),
('BME 445','Biomedical Signal Processing','theory',4,null,3,3,'II'),
('BME 447','Clinical Engineering','theory',4,2,3,3,null),
('BME 449','Machine Learning for Biomedical Engineers','theory',4,null,3,3,'II'),
('BME 471','Pharmaceutical Engineering','theory',4,null,3,3,'I')
on conflict (code) do nothing;

-- Culminating courses (0011) are flagged after the catalog seed above.
update public.courses set is_culminating = true where code in ('BME 300', 'BME 350', 'BME 400');
-- Department OBE data (COs, mapping, assessment maps, attainment, past CARs): run supabase/seed_obe_master.sql next.
