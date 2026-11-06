-- BME Workflow · require sign-in (turn open access off). Run once in Supabase → SQL Editor.
--
-- With open access on, nobody signs in: every visitor acts as an admin, so anyone can edit any course and the activity log
-- only knows the name picked under "Viewing as". With it off, each teacher signs in with their department email, and the
-- database rules that already exist apply to everyone:
--   * a course's COs, CO-PO mapping, assessment map, rubrics, outline, attainment, CAR and course records: only that course's teachers
--     (and admins / HOD) can change them;
--   * an exam step (question setting, moderation, scrutiny, gradesheet …): only the person assigned to that step can update it,
--     so a moderator can update the moderation step and nothing else in the course;
--   * reviewing or finalising a CAR: the OBE Cell / HOD; term setup, people and imports: admins.
-- The activity log then names the signed-in teacher for every change.
--
-- Before running: make sure you (or the HOD) are an admin or HOD in People & access, or run supabase/first_admin.sql first.

do $$ begin
  if not exists (select 1 from public.allowed_users where active and app_role in ('admin', 'hod')) then
    raise exception 'No active admin or HOD on the access list. Run supabase/first_admin.sql (or add one in People & access) first, or nobody can manage the site after sign-in is required.';
  end if;
end $$;

-- 1. Every current faculty member with an email gets on the access list (as faculty), linked to their name.
insert into public.allowed_users (email, faculty_id, app_role)
select f.email, f.id, 'faculty' from public.faculty f
 where f.email is not null and f.status <> 'former'
   and not exists (select 1 from public.allowed_users a where a.email = f.email or a.faculty_id = f.id)
on conflict do nothing;

-- Faculty without an email cannot sign in until one is added (People & access):
select display_name as "no email yet: add one in People & access" from public.faculty where email is null and status <> 'former' order by display_name;

-- 2. Require sign-in. Each teacher then opens the site and chooses "First time" with their department email to set a password.
update public.app_settings set open_access = false, updated_at = now();

-- To go back to open access (not recommended): update public.app_settings set open_access = true;
