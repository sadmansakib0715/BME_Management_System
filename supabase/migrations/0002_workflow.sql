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
