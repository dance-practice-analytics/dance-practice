-- Dance Practice Analytics (MT-2-HCI): movement type 'phrase' and dancer focus themes.
-- FR-3.2 (import a phrase attempt), FR-3.4 (phrase events and theme measures,
-- src/metrics/phrase.ts), FR-3.5/3.6 (review, compare, progress of phrase attempts).
--
-- A phrase attempt keeps the five relevé columns of attempt_metrics null (reason
-- 'not_applicable' in `confidence`) and stores its versioned result in `phrase`.
-- Values only, never a score. sessions.camera_view already accepts 'diagonal'.
--
-- RLS: attempt_metrics keeps the owner-only policies of the init migration, which cover
-- whole rows, so the new column needs no new policy. user_preferences is a new table with
-- the same four owner-only policies. Its rows go with the auth user (on delete cascade).

-- ---------- movement type ----------
-- ADD VALUE may run inside a transaction as long as the value isn't used in the same one;
-- nothing below uses it.
alter type public.movement_type add value if not exists 'phrase';

-- ---------- phrase results ----------
alter table public.attempt_metrics
  add column if not exists phrase jsonb;
alter table public.attempt_metrics
  drop constraint if exists attempt_metrics_phrase_shape;
alter table public.attempt_metrics
  add constraint attempt_metrics_phrase_shape check (
    phrase is null
    or (jsonb_typeof(phrase) = 'object' and phrase ? 'version' and octet_length(phrase::text) <= 262144)
  );

comment on column public.attempt_metrics.phrase is
  'Phrase attempts only: events timeline and theme measures (src/metrics/phrase.ts, versioned by phrase.version). Values, never scores.';

-- ---------- focus themes (per account) ----------
-- The dancer picks up to three phrase themes to see first. Display preference only: no
-- practice data, no free text, and nothing here comes from a teacher.
create table if not exists public.user_preferences (
  owner_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  focus_themes text[] not null default '{}',
  updated_at   timestamptz not null default now(),
  constraint user_preferences_focus_count check (cardinality(focus_themes) <= 3),
  constraint user_preferences_focus_known check (
    focus_themes <@ array['knee_over_toes', 'head_lead', 'neck_range', 'upper_body_curve', 'arm_reach', 'circle_completion']::text[]
  )
);

alter table public.user_preferences enable row level security;

drop policy if exists "own rows - select" on public.user_preferences;
drop policy if exists "own rows - insert" on public.user_preferences;
drop policy if exists "own rows - update" on public.user_preferences;
drop policy if exists "own rows - delete" on public.user_preferences;
create policy "own rows - select" on public.user_preferences for select to authenticated using (owner_id = (select auth.uid()));
create policy "own rows - insert" on public.user_preferences for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own rows - update" on public.user_preferences for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own rows - delete" on public.user_preferences for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.user_preferences from anon;
grant select, insert, update, delete on public.user_preferences to authenticated;

comment on table public.user_preferences is 'Display preferences of the account owner (focus themes). Owner-only RLS.';
comment on column public.user_preferences.focus_themes is 'Up to 3 phrase theme keys shown first on Review. Chosen by the dancer.';
