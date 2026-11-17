-- Dance Practice Analytics (MT-2-HCI): reference attempt and clip trim.
-- FR-3.6.6 (mark an attempt as a personal reference for later comparisons) and
-- FR-3.2.7 (trim the start and end of a clip before processing).
--
-- RLS: attempts already has the owner-only policies of the init migration
-- ("own rows - select/insert/update/delete", owner_id = auth.uid()), which apply to whole
-- rows, and its table privileges were never narrowed to columns, so the new columns are
-- covered without new policies or grants. The trigger function below is SECURITY INVOKER:
-- the rows it clears are read and updated under the caller's RLS, so it can only ever
-- touch the caller's own attempts.

-- ---------- FR-3.6.6 reference attempt ----------
-- "Later comparisons" span sessions, so the reference is kept per movement, and per
-- subject code because a researcher account holds several dancers (S01–S12). Sessions
-- without a subject form one group. A partial unique index can't span attempts and
-- sessions, so a trigger clears the previous reference of the same group; the unique
-- index per session is a hard backstop for the common case.

alter table public.attempts
  add column if not exists is_reference boolean not null default false;

comment on column public.attempts.is_reference is
  'FR-3.6.6: the attempt the owner compares others with (one per movement and subject). Not a grade.';

create unique index if not exists attempts_one_reference_per_session
  on public.attempts (owner_id, session_id) where is_reference;

create or replace function public.attempts_single_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m public.movement_type;
  subj uuid;
begin
  select s.movement_type, s.subject_id into m, subj
    from public.sessions s
   where s.id = new.session_id;
  update public.attempts a
     set is_reference = false
    from public.sessions s
   where a.session_id = s.id
     and a.owner_id = new.owner_id
     and a.id <> new.id
     and a.is_reference
     and s.movement_type = m
     and s.subject_id is not distinct from subj;
  return new;
end;
$$;

drop trigger if exists attempts_single_reference on public.attempts;
create trigger attempts_single_reference
  before insert or update of is_reference on public.attempts
  for each row when (new.is_reference)
  execute function public.attempts_single_reference();

-- ---------- FR-3.2.7 trim ----------
-- Seconds of the ORIGINAL clip. Keypoint frames keep original-clip times, so Review and
-- relinking by SHA-256 work on the untouched local video. Both null = whole clip.

alter table public.attempts
  add column if not exists trim_start_s real,
  add column if not exists trim_end_s real;
alter table public.attempts
  drop constraint if exists attempts_trim_range;
alter table public.attempts
  add constraint attempts_trim_range check (
    (trim_start_s is null and trim_end_s is null)
    or (trim_start_s >= 0 and trim_end_s > trim_start_s)
  );

comment on column public.attempts.trim_start_s is 'FR-3.2.7: start of the processed part, seconds of the original clip (null = whole clip).';
comment on column public.attempts.trim_end_s is 'FR-3.2.7: end of the processed part, seconds of the original clip (null = whole clip).';
