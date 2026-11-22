-- Daily Chunker — sync across your devices.
-- Run this once in your Supabase project (the same one Bibliophile uses):
-- SQL Editor → New query → paste → Run. It's safe to run again, and it doesn't touch Bibliophile's tables.
--
-- Each task, habit and your settings are one row, owned by you.
-- Row-level security means each signed-in person can only ever read or change their own rows.

create table if not exists public.chunker_records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('task', 'habit', 'settings')),
  id         text        not null check (char_length(id) between 1 and 100),
  data       jsonb       check (data is null or pg_column_size(data) < 256000),
  deleted    boolean     not null default false,
  client_at  timestamptz not null default now(),  -- when the change was made on the device
  updated_at timestamptz not null default now(),  -- when the server received it (set below)
  primary key (user_id, kind, id)
);
create index if not exists chunker_records_user_updated on public.chunker_records (user_id, updated_at);

create or replace function public.chunker_records_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists chunker_records_touch on public.chunker_records;
create trigger chunker_records_touch before insert or update on public.chunker_records
  for each row execute function public.chunker_records_touch();

alter table public.chunker_records enable row level security;
drop policy if exists "own chunker records" on public.chunker_records;
create policy "own chunker records" on public.chunker_records for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.chunker_records from anon;
grant select, insert, update, delete on public.chunker_records to authenticated;
