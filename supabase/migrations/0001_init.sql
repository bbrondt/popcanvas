-- Canvases hold a full board state as JSONB. Simple and good enough for a learning scaffold.
-- For production you'd split nodes/edges into their own tables for partial updates and realtime.

create table if not exists public.canvases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null default 'Untitled canvas',
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  viewport jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canvases_user_id_idx on public.canvases(user_id);

-- Cached extracted text. Keyed by source_key (url, file hash, etc) so the same youtube
-- video pulled into ten canvases only gets extracted once.
create table if not exists public.source_extractions (
  id uuid primary key default gen_random_uuid(),
  source_key text unique not null,
  source_type text not null check (source_type in ('youtube','pdf','url','image','text')),
  title text,
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists source_extractions_key_idx on public.source_extractions(source_key);

-- File storage bucket for uploaded PDFs and images.
insert into storage.buckets (id, name, public)
values ('canvas-uploads', 'canvas-uploads', false)
on conflict (id) do nothing;

-- Row level security
alter table public.canvases enable row level security;
alter table public.source_extractions enable row level security;

create policy "users read own canvases"
  on public.canvases for select
  using (auth.uid() = user_id);

create policy "users insert own canvases"
  on public.canvases for insert
  with check (auth.uid() = user_id);

create policy "users update own canvases"
  on public.canvases for update
  using (auth.uid() = user_id);

create policy "users delete own canvases"
  on public.canvases for delete
  using (auth.uid() = user_id);

-- Extractions are global (cached for everyone) but only readable to authenticated users.
create policy "auth reads extractions"
  on public.source_extractions for select
  to authenticated
  using (true);

-- Inserts go through the service role key in API routes, no public insert policy.

-- Updated_at trigger
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists canvases_touch_updated_at on public.canvases;
create trigger canvases_touch_updated_at
  before update on public.canvases
  for each row execute function public.touch_updated_at();
