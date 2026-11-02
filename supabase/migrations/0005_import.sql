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
