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
