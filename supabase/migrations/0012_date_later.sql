-- BME Workflow · 0012 "To be set later" for assessment dates.
-- A teacher can mark an item's date as deliberately left for later; the app shows it glowing dark red until a date is set.
alter table public.assessment_items add column if not exists date_later boolean not null default false;

-- Setting a date clears the reminder, whichever page set it.
create or replace function public.tg_item_date_later() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.held_on is not null then new.date_later := false; end if;
  return new;
end $$;
drop trigger if exists item_date_later on public.assessment_items;
create trigger item_date_later before insert or update of held_on, date_later on public.assessment_items
  for each row execute function public.tg_item_date_later();

notify pgrst, 'reload schema';
