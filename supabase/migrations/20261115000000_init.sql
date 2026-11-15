-- Dance Practice Analytics (MT-2-HCI): initial schema.
-- Matches SDD section 6. Every table has owner_id and owner-only RLS.

-- ---------- enums ----------
create type public.user_role      as enum ('dancer', 'researcher');
create type public.movement_type  as enum ('releve_balance', 'pirouette');
create type public.attempt_source as enum ('study_dataset', 'user_upload');
create type public.attempt_status as enum ('queued', 'processing', 'done', 'failed');

-- ---------- tables ----------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  display_name text,
  role         public.user_role not null default 'dancer',
  created_at   timestamptz not null default now(),
  constraint profiles_owner_is_self check (owner_id = id)
);

create table public.subjects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_code text not null check (subject_code ~ '^S[0-9]{2}$'),
  notes        text,
  created_at   timestamptz not null default now(),
  unique (owner_id, subject_code)
);

create table public.consents (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id      uuid references public.subjects (id) on delete cascade,
  scope           text not null,          -- e.g. 'keypoints_and_metrics_storage', 'ai_metrics_only', 'demo_display'
  form_reference  text,                   -- reference to the paper form, never a copy
  granted_on      date not null default current_date,
  revoked_on      date,
  created_at      timestamptz not null default now()
);

create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id    uuid references public.subjects (id) on delete set null,
  movement_type public.movement_type not null,
  title         text,
  recorded_on   date,
  camera_view   text check (camera_view in ('front', 'side', 'diagonal')),
  created_at    timestamptz not null default now()
);

create table public.attempts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id    uuid not null references public.sessions (id) on delete cascade,
  source        public.attempt_source not null,
  label         text,
  clip_name     text,                    -- original file name, kept on the client side only for study clips
  video_path    text,                    -- storage path, user_upload only
  video_sha256  text,
  duration_s    real,
  fps           real,
  status        public.attempt_status not null default 'queued',
  error         text,
  created_at    timestamptz not null default now(),
  constraint study_no_video check (source <> 'study_dataset' or video_path is null)
);
create unique index attempts_owner_sha on public.attempts (owner_id, video_sha256) where video_sha256 is not null;

create table public.attempt_keypoints (
  attempt_id   uuid primary key references public.attempts (id) on delete cascade,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null,            -- keypoints/{owner_id}/{attempt_id}.json.gz
  frame_count  integer not null,
  size_bytes   integer,
  model        text not null default 'pose_landmarker_full',
  created_at   timestamptz not null default now()
);

create table public.attempt_metrics (
  attempt_id               uuid primary key references public.attempts (id) on delete cascade,
  owner_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  movement                 public.movement_type not null,
  trunk_inclination_deg    real,
  pelvis_ankle_offset_norm real,
  balance_duration_s       real,
  knee_tracking_dev_deg    real,
  turn_count               real,
  phases                   jsonb not null default '[]'::jsonb,
  confidence               jsonb not null default '{}'::jsonb,
  algorithm_version        text not null,
  computed_at              timestamptz not null default now()
);

create table public.feedback (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  attempt_id      uuid not null references public.attempts (id) on delete cascade,
  model           text not null,
  prompt_version  text not null,
  input_hash      text not null,
  response        jsonb not null,
  created_at      timestamptz not null default now()
);
create index feedback_owner_time on public.feedback (owner_id, created_at desc);

-- ---------- row level security: owner only ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','subjects','consents','sessions','attempts',
                           'attempt_keypoints','attempt_metrics','feedback']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows - select" on public.%I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows - insert" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows - update" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "own rows - delete" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create index if not exists %I on public.%I (owner_id)', t || '_owner_idx', t);
  end loop;
end $$;

-- ---------- profile row on sign-up ----------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, owner_id, display_name)
  values (new.id, new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- storage buckets (private) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('keypoints', 'keypoints', false, 10485760),
       ('videos',    'videos',    false, 209715200)
on conflict (id) do nothing;

create policy "keypoints own folder - select" on storage.objects for select to authenticated
  using (bucket_id = 'keypoints' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "keypoints own folder - insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'keypoints' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "keypoints own folder - update" on storage.objects for update to authenticated
  using (bucket_id = 'keypoints' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "keypoints own folder - delete" on storage.objects for delete to authenticated
  using (bucket_id = 'keypoints' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- videos: path {owner_id}/{attempt_id}.{ext}; only for attempts with source user_upload
create policy "videos own uploads - select" on storage.objects for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "videos own uploads - insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.attempts a
      where a.owner_id = (select auth.uid())
        and a.source = 'user_upload'
        and a.id::text = split_part(storage.filename(name), '.', 1)
    )
  );
create policy "videos own uploads - delete" on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
