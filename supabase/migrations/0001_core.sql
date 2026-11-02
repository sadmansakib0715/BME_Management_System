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
