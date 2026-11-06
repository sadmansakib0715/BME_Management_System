-- BME Workflow · 0017 activity log: who scheduled, changed or removed what, readable by the department.
-- Builds on the audit_log of 0007. Each entry now also keeps:
--   actor_name   the person's name at the time (the faculty name; else the signed-in email)
--   offering_id  the course offering the change belongs to, course_code and term_id, so a course and a term can show their log
-- With open access on (0009) nobody signs in, so the website sends the name chosen under "Viewing as" in the
-- x-acting-as request header and the log records that person. Signed in, the account decides and the header is ignored.
-- Safe to run again.

alter table public.audit_log
  add column if not exists actor_name  text,
  add column if not exists offering_id uuid,
  add column if not exists course_code text,
  add column if not exists term_id     uuid;
create index if not exists audit_log_at       on public.audit_log (at desc, id desc);
create index if not exists audit_log_offering on public.audit_log (offering_id, at desc);
create index if not exists audit_log_actor    on public.audit_log (actor, at desc);
create index if not exists audit_log_term     on public.audit_log (term_id, at desc);

-- ---------------------------------------------------------------- who
/** The faculty member making the change: the signed-in account, else (open access only) the "Viewing as" name the website sends. */
create or replace function public.fn_audit_actor() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.fn_faculty(); h text;
begin
  if me is not null then return me; end if;
  if not public.app_open_access() then return null; end if;
  begin
    h := nullif(current_setting('request.headers', true), '')::json ->> 'x-acting-as';
  exception when others then return null;
  end;
  if h ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists (select 1 from public.faculty where id = h::uuid) then
    return h::uuid;
  end if;
  return null;
end $$;

create or replace function public.fn_audit_actor_name(p_actor uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare n text;
begin
  if p_actor is not null then select display_name into n from public.faculty where id = p_actor; end if;
  if n is null then
    begin n := auth.jwt() ->> 'email'; exception when others then n := null; end;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- which course
/** The offering a changed row belongs to, directly or through its parent row. */
create or replace function public.fn_audit_offering(p_table text, r jsonb) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if r is null then return null; end if;
  if p_table = 'offerings' then return (r ->> 'id')::uuid; end if;
  if r ? 'offering_id' then return (r ->> 'offering_id')::uuid; end if;
  return case p_table
    when 'section_teachers'  then (select offering_id from public.sections where id = (r ->> 'section_id')::uuid)
    when 'co_po_map'         then (select offering_id from public.course_outcomes where id = (r ->> 'co_id')::uuid)
    when 'obe_criterion_cos' then (select offering_id from public.obe_criteria where id = (r ->> 'criterion_id')::uuid)
    when 'item_date_history' then (select offering_id from public.assessment_items where id = (r ->> 'item_id')::uuid)
    else null end;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------- the trigger
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pk text; o jsonb; n jsonb; r jsonb; who uuid; off uuid; code text; term uuid;
begin
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  -- An update that changes nothing but the timestamp is not worth a log line.
  if tg_op = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then return new; end if;
  r := coalesce(n, o);
  pk := r ->> coalesce(tg_argv[0], 'id');
  who := public.fn_audit_actor();
  off := public.fn_audit_offering(tg_table_name, r);
  if off is not null then
    select c.code, x.term_id into code, term from public.offerings x join public.courses c on c.id = x.course_id where x.id = off;
  end if;
  if tg_table_name = 'offerings' and code is null then
    select c.code into code from public.courses c where c.id = (r ->> 'course_id')::uuid;
    term := (r ->> 'term_id')::uuid;
  elsif tg_table_name = 'terms' then term := (r ->> 'id')::uuid;
  elsif term is null and r ? 'term_id' then term := (r ->> 'term_id')::uuid;
  end if;
  insert into public.audit_log (table_name, row_pk, action, old_row, new_row, actor, actor_name, offering_id, course_code, term_id)
  values (tg_table_name, pk, tg_op, o, n, who, public.fn_audit_actor_name(who), off, code, term);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------- tables not logged before
do $$ declare t text[]; begin
  foreach t slice 1 in array array[
    array['offerings', 'id'], array['sections', 'id'], array['courses', 'id'], array['terms', 'id'], array['faculty', 'id'],
    array['cqi_items', 'id'], array['course_file_items', 'offering_id'], array['bugs_resolutions', 'id'],
    array['obe_criterion_cos', 'criterion_id'], array['item_date_history', 'item_id']] loop
    if to_regclass('public.' || t[1]) is not null then
      execute format('drop trigger if exists audit on public.%I', t[1]);
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit(%L)', t[1], t[2]);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- older entries: fill in the course and the name
update public.audit_log a set offering_id = public.fn_audit_offering(a.table_name, coalesce(a.new_row, a.old_row))
  where a.offering_id is null;
update public.audit_log a set course_code = c.code, term_id = x.term_id
  from public.offerings x join public.courses c on c.id = x.course_id
  where a.offering_id = x.id and a.course_code is null;
update public.audit_log a set actor_name = f.display_name from public.faculty f where a.actor = f.id and a.actor_name is null;

-- ---------------------------------------------------------------- who can read it
-- Everyone in the department (and every visitor while open access is on) can read the log; nobody can edit it.
alter table public.audit_log enable row level security;
drop policy if exists admin_read on public.audit_log;
drop policy if exists dept_read on public.audit_log;
create policy dept_read on public.audit_log for select to anon, authenticated using (public.fn_is_active());
revoke insert, update, delete on public.audit_log from anon, authenticated;
grant select on public.audit_log to anon, authenticated;

notify pgrst, 'reload schema';
