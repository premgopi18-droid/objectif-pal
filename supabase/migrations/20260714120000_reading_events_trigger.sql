-- Le journal d'états (reading_events, append-only — specs §4.2) ne doit jamais
-- dépendre de la discipline du code applicatif : un trigger l'écrit à chaque
-- création de lecture et à chaque changement d'état. Atomique par construction
-- (même transaction que l'écriture sur readings), impossible à oublier.

create function public.append_reading_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- À l'INSERT, OLD n'existe pas : on écrit toujours. À l'UPDATE, uniquement
  -- si l'état change vraiment (modifier une note ne journalise rien).
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.reading_events (reading_id, user_id, status)
    values (new.id, new.user_id, new.status);
  end if;
  return new;
end;
$$;

create trigger on_reading_status_change
  after insert or update of status on readings
  for each row execute function public.append_reading_event();
