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
