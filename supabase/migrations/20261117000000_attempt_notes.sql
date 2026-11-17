-- Dance Practice Analytics (MT-2-HCI): session note, attempt note and clip number.
-- FR-3.2.2 (optional session note), FR-3.2.4 (clip number of a dataset clip),
-- FR-3.5.7 (a text note per attempt). Notes are the dancer's own words: they stay in
-- the database under owner-only RLS and are never sent to the AI Edge Functions.
--
-- RLS: sessions and attempts already have the owner-only policies of the init
-- migration ("own rows - select/insert/update/delete"), which apply to whole rows, and
-- their table privileges were never narrowed to columns (only profiles was), so the
-- new columns are covered without new policies or grants.

alter table public.sessions
  add column if not exists note text;
alter table public.sessions
  drop constraint if exists sessions_note_length;
alter table public.sessions
  add constraint sessions_note_length check (note is null or char_length(note) <= 2000);

alter table public.attempts
  add column if not exists note text,
  add column if not exists clip_number integer;
alter table public.attempts
  drop constraint if exists attempts_note_length,
  drop constraint if exists attempts_clip_number_range;
alter table public.attempts
  add constraint attempts_note_length check (note is null or char_length(note) <= 2000),
  add constraint attempts_clip_number_range check (clip_number is null or clip_number between 1 and 999);

comment on column public.sessions.note is 'Optional note by the account owner (<= 2000 chars). Never sent to the AI functions.';
comment on column public.attempts.note is 'Optional note by the account owner (<= 2000 chars). Never sent to the AI functions.';
comment on column public.attempts.clip_number is 'Clip number within the subject''s dataset (FR-3.2.4).';
comment on column public.attempts.clip_name is 'De-identified clip name (S03_att07.mp4 or clip 7.mp4), never the local file name (FR-3.2.5).';

-- Rows saved before this migration may hold the original file name. Rebuild them the
-- way the client does (src/data/clipFile.ts deidentifiedClipName): S03_att07.mp4 when
-- a subject code and a trailing attempt number can be read, else clip 7.mp4 / clip.mp4.
-- Nothing else of the old name is kept.
with parsed as (
  select id,
         upper(substring(clip_name from '(?:^|[^A-Za-z0-9])([Ss][0-9]{2})(?:[^A-Za-z0-9]|$)')) as code,
         substring(clip_name from '(?:^|[^0-9])([0-9]{1,3})(?:\.[A-Za-z0-9]{2,4})?$')::int as num,
         lower(substring(clip_name from '(?i)\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpg|mpeg|ogv|wmv)$')) as ext
    from public.attempts
   where clip_name is not null
     and clip_name !~ '^(S[0-9]{2}_att[0-9]{2,3}|clip( [0-9]{1,3})?)(\.[a-z0-9]{2,4})?$'
)
update public.attempts a
   set clip_name =
         case
           when p.code is not null and p.num between 1 and 999 then p.code || '_att' || lpad(p.num::text, 2, '0')
           when p.num between 1 and 999 then 'clip ' || p.num
           else 'clip'
         end || coalesce('.' || p.ext, ''),
       clip_number = coalesce(a.clip_number, case when p.num between 1 and 999 then p.num end)
  from parsed p
 where a.id = p.id;
