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
