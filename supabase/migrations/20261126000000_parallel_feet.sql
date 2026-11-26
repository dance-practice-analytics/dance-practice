-- Dance Practice Analytics (MT-2-HCI): parallel feet (mentor review, task 14).
-- FR-3.4 (metrics), SDD 5.5. Values only, never a score.
--
-- 1. attempt_metrics.feet_angle_deg: relevé balance metric (mt2-metrics-1.3.0,
--    src/metrics/feet.ts). Signed angle between the two feet seen from above, degrees:
--    0 = parallel, > 0 toes apart, < 0 toes towards each other. Null on other movements
--    (reason 'not_applicable' in `confidence`) and on rows computed before 1.3.0.
-- 2. user_preferences.focus_themes accepts the new phrase theme 'parallel_feet'
--    (mt2-phrase-0.4.0); the theme itself lives in the `phrase` jsonb, so it needs no column.
--
-- RLS: the owner-only policies of the init migration cover whole rows; nothing new is needed.
-- Run this before deploying an app build that selects feet_angle_deg.

alter table public.attempt_metrics
  add column if not exists feet_angle_deg real;
alter table public.attempt_metrics
  drop constraint if exists attempt_metrics_feet_angle_range;
alter table public.attempt_metrics
  add constraint attempt_metrics_feet_angle_range check (feet_angle_deg is null or feet_angle_deg between -180 and 180);

comment on column public.attempt_metrics.feet_angle_deg is
  'Relevé only: signed angle between the feet seen from above, degrees (0 parallel, > 0 toes apart). Low confidence at most (depth). Never a score.';

alter table public.user_preferences
  drop constraint if exists user_preferences_focus_known;
alter table public.user_preferences
  add constraint user_preferences_focus_known check (
    focus_themes <@ array['knee_over_toes', 'head_lead', 'neck_range', 'upper_body_curve', 'arm_reach', 'circle_completion', 'parallel_feet']::text[]
  );
