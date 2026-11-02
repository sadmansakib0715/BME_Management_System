-- BME Workflow · make yourself the first HOD. Edit the three values, then Run in the SQL Editor.
-- After this, add everyone else from the app (People & access).
with me as (
  insert into public.faculty (full_name, display_name, designation, email)
  values ('FULL NAME', 'Dr. DISPLAY NAME', 'Professor', lower('you@bme.buet.ac.bd'))
  returning id, email
)
insert into public.allowed_users (email, faculty_id, app_role)
select email, id, 'hod' from me;
