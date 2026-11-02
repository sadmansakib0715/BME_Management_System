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
