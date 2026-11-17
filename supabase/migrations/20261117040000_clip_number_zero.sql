-- Dance Practice Analytics (MT-2-HCI): take 0 is a real clip number (FR-3.2.4).
-- The phrase study numbers its takes from att0 (D01_att0_f/_s/_d), so the range of
-- attempts.clip_number becomes 0-999 (was 1-999). The client mirrors it in
-- src/data/clipFile.ts clipNumberOrNull. Data is not touched here.

alter table public.attempts
  drop constraint if exists attempts_clip_number_range;
alter table public.attempts
  add constraint attempts_clip_number_range check (clip_number is null or clip_number between 0 and 999);

comment on column public.attempts.clip_number is 'Take number within the subject''s dataset, 0-999 (FR-3.2.4).';
