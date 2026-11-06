-- BME Workflow · 0016 the last fields of the department's Course Outline template: the academic session and the class routine.
-- Teachers' phone numbers go in obe_offering_docs.instructors ([{name, room, email, phone}]), which is jsonb already.
alter table public.obe_offering_docs
  add column if not exists academic_session text,   -- e.g. "2023-2024", as printed under Level/Term
  add column if not exists class_routine    text;   -- e.g. "Sunday: 09:00 AM-09:50 AM", one slot per line

-- Carry-forward keeps the session and routine empty on purpose: both change every term.
notify pgrst, 'reload schema';
