-- BME Workflow demo data. ALL PEOPLE AND STUDENTS ARE FICTIONAL. For local development only.
-- Run after migrations and seed.sql:  psql "$DB_URL" -f supabase/seed_demo.sql
-- Sign up with any of the emails below (password of your choice) to explore each role.

insert into public.terms (code, name, starts_on, ends_on, total_weeks, latest_completed_week, is_current)
values ('DEMO-2026', 'Demo Term 2026', '2026-06-20', '2026-11-30', 14, 9, true) on conflict (code) do nothing;

insert into public.faculty (id, full_name, display_name, designation, email) values
 ('00000000-0000-4000-a000-000000000001','Ayesha Rahman','Dr. Ayesha Rahman','Professor','hod@example.edu'),
 ('00000000-0000-4000-a000-000000000002','Kamal Hossain','Dr. Kamal Hossain','Associate Professor','kamal@example.edu'),
 ('00000000-0000-4000-a000-000000000003','Nadia Islam','Ms. Nadia Islam','Lecturer','nadia@example.edu'),
 ('00000000-0000-4000-a000-000000000004','Farhan Ahmed','Mr. Farhan Ahmed','Assistant Professor','farhan@example.edu'),
 ('00000000-0000-4000-a000-000000000005','Tania Chowdhury','Ms. Tania Chowdhury','Lecturer','tania@example.edu'),
 ('00000000-0000-4000-a000-000000000006','Rafiq Uddin','Mr. Rafiq Uddin','Lecturer','rafiq@example.edu')
on conflict (id) do nothing;

insert into public.allowed_users (email, faculty_id, app_role) values
 ('hod@example.edu','00000000-0000-4000-a000-000000000001','hod'),
 ('kamal@example.edu','00000000-0000-4000-a000-000000000002','admin'),
 ('nadia@example.edu','00000000-0000-4000-a000-000000000003','faculty'),
 ('farhan@example.edu','00000000-0000-4000-a000-000000000004','faculty'),
 ('tania@example.edu','00000000-0000-4000-a000-000000000005','faculty'),
 ('rafiq@example.edu','00000000-0000-4000-a000-000000000006','faculty')
on conflict (email) do nothing;

do $$
declare
  t uuid := (select id from public.terms where code = 'DEMO-2026');
  o201 uuid; o203 uuid; o202 uuid; sx uuid; sx3 uuid; a1 uuid; a2 uuid;
  co1 uuid; co2 uuid; co3 uuid; ct uuid; tf uuid; lr uuid; it uuid; q uuid; s record; n int; k int;
  F1 uuid := '00000000-0000-4000-a000-000000000001'; F2 uuid := '00000000-0000-4000-a000-000000000002';
  F3 uuid := '00000000-0000-4000-a000-000000000003'; F4 uuid := '00000000-0000-4000-a000-000000000004';
  F5 uuid := '00000000-0000-4000-a000-000000000005'; F6 uuid := '00000000-0000-4000-a000-000000000006';
begin
  if exists (select 1 from public.offerings where term_id = t) then return; end if;

  insert into public.offerings (term_id, course_id, batch) select t, id, '21' from public.courses where code = 'BME 201' returning id into o201;
  insert into public.offerings (term_id, course_id, batch) select t, id, '21' from public.courses where code = 'BME 203' returning id into o203;
  insert into public.offerings (term_id, course_id, batch) select t, id, '21' from public.courses where code = 'BME 202' returning id into o202;
  insert into public.course_records (offering_id, outline_status) values (o201,'shared'),(o203,'shared'),(o202,'prepared');

  insert into public.sections (offering_id, name) values (o201,'X') returning id into sx;
  insert into public.sections (offering_id, name) values (o203,'X') returning id into sx3;
  insert into public.sections (offering_id, name) values (o202,'A1') returning id into a1;
  insert into public.sections (offering_id, name) values (o202,'A2') returning id into a2;
  insert into public.section_teachers values (sx,F4,1),(sx,F3,2),(sx3,F5,1),(sx3,F2,2),(a1,F4,1),(a1,F3,2),(a2,F4,1),(a2,F6,2);

  insert into public.exam_assignments (offering_id, qp_a, qp_b, mod_1, mod_2, scrutinizer) values
    (o201, F4, F3, F1, F2, F5), (o203, F5, F2, F1, F6, F3);
  update public.exam_tasks set status = 'submitted' where offering_id = o201 and step in ('qp_a','qp_b');
  update public.exam_tasks set status = 'finalized' where offering_id = o201 and step = 'mod_1';
  update public.exam_tasks set status = 'under_moderation' where offering_id = o201 and step = 'mod_2';
  update public.exam_tasks set status = 'under_preparation' where offering_id = o203 and step in ('qp_a','qp_b');
  insert into public.sessional_gradesheets (offering_id, preparer, scrutinizer) values (o202, F4, F2);

  insert into public.term_milestones (term_id, kind, due_on) values
    (t,'question_submission', current_date + 5), (t,'theory_gradesheet', current_date + 40),
    (t,'sessional_gradesheet', current_date + 30), (t,'car_deadline', current_date + 45);
  insert into public.attainment_settings (term_id) values (t);

  -- Course outcomes for BME 201
  insert into public.course_outcomes (offering_id, code, statement, level, sort) values
    (o201,'CO1','Explain force systems, moments and equilibrium in musculoskeletal structures.',2,1) returning id into co1;
  insert into public.course_outcomes (offering_id, code, statement, level, sort) values
    (o201,'CO2','Apply mechanics of materials to compute stresses in bone and soft tissue.',3,2) returning id into co2;
  insert into public.course_outcomes (offering_id, code, statement, level, sort) values
    (o201,'CO3','Analyze joint kinematics and kinetics of human movement from measured data.',4,3) returning id into co3;
  insert into public.co_po_map values (co1,'PO1',3),(co2,'PO1',2),(co2,'PO2',2),(co3,'PO2',3),(co3,'PO4',1);

  -- Students (fictional IDs)
  for n in 1..12 loop
    insert into public.students (student_no, name, batch)
    values ('21180' || lpad(n::text, 2, '0'), (array['Arif','Bushra','Chayan','Dipa','Emon','Fahim','Gazi','Hasna','Imran','Jui','Kabir','Lamia'])[n] || ' (demo)', '21');
  end loop;
  insert into public.enrolments (offering_id, student_id, section_id) select o201, id, sx from public.students where batch = '21';
  insert into public.enrolments (offering_id, student_id, section_id) select o203, id, sx3 from public.students where batch = '21';
  insert into public.enrolments (offering_id, student_id, section_id)
    select o202, id, case when student_no <= '2118006' then a1 else a2 end from public.students where batch = '21';

  -- BME 201 assessment plan: CTs (best 3 of 4), term final, attendance
  insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, best_n, sort)
    values (o201,'class_test','Class Test',4,20,20,3,1) returning id into ct;
  insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, sort)
    values (o201,'term_final','Term Final',1,210,70,2) returning id into tf;
  insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, sort)
    values (o201,'attendance','Attendance',1,30,10,3);

  for k in 1..4 loop
    insert into public.assessment_items (component_id, offering_id, seq, title, held_on, total_marks, status, marks_status, responsible)
    values (ct, o201, k, 'CT ' || lpad(k::text,2,'0'), current_date - 70 + k * 18, 20,
            case when k <= 3 then 'held' else 'scheduled' end,
            case when k <= 2 then 'published' when k = 3 then 'entering' else 'none' end,
            case when k % 2 = 1 then F4 else F3 end)
    returning id into it;
    if k <= 3 then
      insert into public.assessment_questions (item_id, label, max_marks, co_id, sort)
        values (it, 'Q1', 10, case k when 1 then co1 when 2 then co2 else co3 end, 1) returning id into q;
      insert into public.marks (question_id, student_id, value)
        select q, s2.id, least(10, round(((abs(hashtext(s2.student_no || k || 'a')) % 70) / 10.0 + 3)::numeric, 1)) from public.students s2 where batch = '21';
      insert into public.assessment_questions (item_id, label, max_marks, co_id, sort)
        values (it, 'Q2', 10, case k when 1 then co2 when 2 then co3 else co1 end, 2) returning id into q;
      insert into public.marks (question_id, student_id, value)
        select q, s2.id, least(10, round(((abs(hashtext(s2.student_no || k || 'b')) % 80) / 10.0 + 2)::numeric, 1)) from public.students s2 where batch = '21';
    end if;
  end loop;
  insert into public.assessment_items (component_id, offering_id, seq, title, total_marks) values (tf, o201, 1, 'Term Final', 210);

  -- BME 203 CTs, one clashing date to demonstrate conflict detection
  insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, best_n, sort)
    values (o203,'class_test','Class Test',4,20,20,3,1) returning id into ct;
  for k in 1..4 loop
    insert into public.assessment_items (component_id, offering_id, seq, title, held_on, total_marks, status, responsible)
    values (ct, o203, k, 'CT ' || lpad(k::text,2,'0'), current_date - 60 + k * 18, 20,
            case when k <= 2 then 'held' else 'scheduled' end, F5);
  end loop;

  -- BME 202 sessional plan: lab reports per section
  insert into public.assessment_components (offering_id, kind, name, item_count, marks_each, weight, best_n, per_section, sort)
    values (o202,'lab_report','Lab Report',6,5,40,5,true,1) returning id into lr;
  for s in select id, name from public.sections where offering_id = o202 loop
    for k in 1..6 loop
      insert into public.assessment_items (component_id, offering_id, section_id, seq, title, held_on, total_marks, status, marks_status)
      values (lr, o202, s.id, k, 'Lab Report ' || lpad(k::text,2,'0') || ' (' || s.name || ')', current_date - 63 + k * 7 + (case s.name when 'A2' then 1 else 0 end), 5,
              case when k <= 4 then 'held' else 'scheduled' end, case when k <= 3 then 'published' else 'none' end);
    end loop;
  end loop;
end $$;
