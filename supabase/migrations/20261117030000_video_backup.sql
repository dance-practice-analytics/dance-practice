-- Optional video backup for study clips and personal clips (FR-3.2, FR-3.9, NFR privacy).
--
-- Decision of 2026-11-17: the IRB approved storing study videos in Supabase (reported by
-- the project owner). The free plan has 1 GB of storage and a 50 MB per-file cap, so only
-- one dancer's clips are stored. A video is uploaded only when the user turns on
-- "Back up video to your account" in Import. Videos stay in the private `videos` bucket,
-- in the owner's folder ({owner_id}/{attempt_id}.{ext}); only the owner can read them.
-- The language model never receives video (unchanged).

-- 1. A study attempt may now point at its backed-up video.
alter table public.attempts drop constraint if exists study_no_video;

-- The stored path, when set, must sit in the owner's folder of the videos bucket.
alter table public.attempts drop constraint if exists video_path_own_folder;
alter table public.attempts add constraint video_path_own_folder
  check (video_path is null or video_path like owner_id::text || '/' || id::text || '.%');

-- 2. Bucket: private, 50 MB per file (the free plan's cap), video types only.
update storage.buckets
   set public = false,
       file_size_limit = 52428800,
       allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']
 where id = 'videos';

-- 3. Storage policies: owner folder only, for an attempt of the owner of either source.
drop policy if exists "videos own uploads - insert" on storage.objects;
create policy "videos own uploads - insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.attempts a
      where a.owner_id = (select auth.uid())
        and a.id::text = split_part(storage.filename(name), '.', 1)
    )
  );

-- A retry after a half-finished upload overwrites the object (upsert needs update).
drop policy if exists "videos own uploads - update" on storage.objects;
create policy "videos own uploads - update" on storage.objects for update to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.attempts a
      where a.owner_id = (select auth.uid())
        and a.id::text = split_part(storage.filename(name), '.', 1)
    )
  );
