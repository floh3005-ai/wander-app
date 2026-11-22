-- Wander-App: Tabelle für die Touren.
-- Einmal im Supabase-Projekt ausführen (SQL Editor → einfügen → Run).

create table if not exists public.touren (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null default '',
  daten      jsonb,
  geaendert  timestamptz not null default now(),
  geloescht  boolean not null default false
);

-- Jede angemeldete Person sieht und ändert nur ihre eigenen Touren.
alter table public.touren enable row level security;

drop policy if exists "eigene touren" on public.touren;
create policy "eigene touren" on public.touren
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.touren to authenticated;
-- Ohne Anmeldung ist nichts zu sehen (keine Regel für "anon"); das Leserecht braucht
-- nur der tägliche "Wach halten"-Aufruf, der dadurch eine leere Liste bekommt.
grant select on public.touren to anon;
