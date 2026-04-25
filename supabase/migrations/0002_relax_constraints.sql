-- Relax constraints applied manually after 0001_init.sql so the demo flow works
-- without real auth. Reproduces the patches already applied to the deployed
-- Supabase project so a fresh database can be brought up by running every
-- migration in order.
--
-- Why each statement:
--   1. The FK from canvases.user_id -> auth.users(id) blocks inserts when the
--      app uses the hardcoded demo user UUID (no matching auth.users row).
--   2. Dropping NOT NULL on user_id lets us write canvases with no owner at all
--      while we are pre-auth.
--   3. RLS on source_extractions blocks even service-role upserts in some
--      configurations; turn it off until a real auth model is in place.

alter table public.canvases drop constraint if exists canvases_user_id_fkey;
alter table public.canvases alter column user_id drop not null;
alter table public.source_extractions disable row level security;
