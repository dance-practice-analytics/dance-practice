// Scripted stand-in for the practice companion. It answers only from the
// session's own results and drives the UI through the same actions the real
// Claude agent will call as tools. It never grades technique.

import type { Attempt, Marker, MetricDefinition, MetricId, Phase, PhaseId, PhaseSummary, SessionResults } from '../types'
import type { UIAction } from './actions'
import { describeChange, formatTime, formatValue } from '../lib/format'

export interface CompanionContext {
  results: SessionResults
  attempts: Attempt[]
  summary: (attemptId: string, phase: PhaseId, metricId: MetricId) => PhaseSummary
  releve: Record<string, number | null>
  markers: Marker[]
  focusMetric: MetricId
}

export interface CompanionReply {
  text: string
  actions: UIAction[]
  /** Read-only tools the real agent would have used to answer. */
  lookedAt: string[]
}

export const SUGGESTIONS = [
  'Where did my knees drift the most?',
  'Compare attempt 1 and attempt 3',
  'Which attempt stayed up longest?',
  'Ask me a reflection question',
  'What should I ask my teacher?',
  'Is my technique good?',
]

interface Peak { attempt: Attempt; phase: Phase; value: number; t: number }

const metricOf = (ctx: CompanionContext, id: MetricId) => ctx.results.metrics.find((m) => m.id === id)!

function rank(m: MetricDefinition, v: number) {
  return m.peak === 'min' ? -v : m.peak === 'maxAbs' ? Math.abs(v) : v
}

/** Most extreme value of a metric in each attempt, across the phases where it is measured. */
function peaksByAttempt(ctx: CompanionContext, id: MetricId): Peak[] {
  const m = metricOf(ctx, id)
  const out: Peak[] = []
  for (const attempt of ctx.attempts) {
    let best: Peak | null = null
    for (const phase of attempt.phases) {
      const s = ctx.summary(attempt.id, phase.id, id)
      if (!s.available || s.peak === null || s.peakT === null) continue
      if (!best || rank(m, s.peak) > rank(m, best.value)) best = { attempt, phase, value: s.peak, t: s.peakT }
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => rank(m, b.value) - rank(m, a.value))
}

function holdMeans(ctx: CompanionContext, id: MetricId) {
  return ctx.attempts
    .map((a) => ({ attempt: a, s: ctx.summary(a.id, 'hold', id) }))
    .filter((x) => x.s.available)
    .map((x) => ({ attempt: x.attempt, mean: x.s.mean! }))
}

function findMoment(ctx: CompanionContext, id: MetricId, intro: string): CompanionReply {
  const m = metricOf(ctx, id)
  const peaks = peaksByAttempt(ctx, id)
  if (!peaks.length) return { text: `I don't have enough tracked frames to measure ${m.name.toLowerCase()} in this session.`, actions: [], lookedAt: ['get_session_results'] }
  const top = peaks[0]
  const last = peaks[peaks.length - 1]
  const contrast = peaks.length > 1 ? ` For contrast, the most extreme value in attempt ${last.attempt.index} was ${formatValue(last.value, m)}.` : ''
  return {
    text: `${intro} attempt ${top.attempt.index}, during the ${top.phase.label.toLowerCase()}, at ${formatTime(top.t)}: ${formatValue(top.value, m)}. I moved the video there and turned on the ${m.name.toLowerCase()} guides.${contrast}`,
    actions: [{ type: 'focus_metric', metricId: id }, { type: 'seek_video', t: top.t }],
    lookedAt: ['get_session_results', 'get_metric_definition'],
  }
}

function compare(ctx: CompanionContext, q: string): CompanionReply {
  const nums = [...q.matchAll(/\b([1-9])\b/g)].map((x) => Number(x[1])).filter((n) => n <= ctx.attempts.length)
  const a = ctx.attempts[(nums[0] ?? 1) - 1]
  const b = ctx.attempts[(nums[1] ?? ctx.attempts.length) - 1]
  if (!a || !b || a.id === b.id) return { text: 'Tell me which two attempts to compare, for example "compare 2 and 4".', actions: [], lookedAt: [] }
  const lines = ctx.results.metrics.map((m) => {
    const sa = ctx.summary(a.id, 'hold', m.id)
    const sb = ctx.summary(b.id, 'hold', m.id)
    if (!sa.available || !sb.available) return `• ${m.name}: not available (${(sa.available ? sb : sa).reason?.toLowerCase()})`
    return `• ${m.name}: ${formatValue(sa.mean, m)} → ${formatValue(sb.mean, m)} (${describeChange(sa.mean!, sb.mean!, m)})`
  })
  return {
    text: `Here are attempts ${a.index} and ${b.index} side by side, matched phase by phase. Averages during the hold:\n${lines.join('\n')}\nWhat those changes mean is for you and your teacher to judge.`,
    actions: [{ type: 'open_comparison', a: a.id, b: b.id, phase: 'hold' }],
    lookedAt: ['get_session_results', 'compare_attempts'],
  }
}

function longestHold(ctx: CompanionContext): CompanionReply {
  const rows = ctx.attempts.map((a) => ({ a, t: ctx.releve[a.id] }))
  const known = rows.filter((r) => r.t !== null) as { a: Attempt; t: number }[]
  if (!known.length) return { text: 'Tracking was too patchy to time any relevé in this session.', actions: [], lookedAt: ['get_session_results'] }
  const top = known.reduce((x, y) => (y.t > x.t ? y : x))
  const hold = top.a.phases.find((p) => p.id === 'hold')!
  const list = rows.map((r) => `• Attempt ${r.a.index}: ${r.t === null ? 'unavailable (tracking gap)' : `${r.t.toFixed(1)} s`}`).join('\n')
  return {
    text: `You stayed on relevé longest in attempt ${top.a.index} (${top.t.toFixed(1)} s). I moved the video to the start of that hold.\n${list}`,
    actions: [{ type: 'focus_metric', metricId: 'heelLift' }, { type: 'seek_video', t: hold.start }],
    lookedAt: ['get_session_results'],
  }
}

function reflection(ctx: CompanionContext): CompanionReply {
  const m = metricOf(ctx, ctx.focusMetric)
  const means = holdMeans(ctx, m.id).sort((x, y) => rank(m, x.mean) - rank(m, y.mean))
  if (means.length < 2) return { text: 'What did you notice in your body during the hold, compared with the rise?', actions: [], lookedAt: ['get_session_results'] }
  const lo = means[0]
  const hi = means[means.length - 1]
  const hold = lo.attempt.phases.find((p) => p.id === 'hold')!
  return {
    text: `Here's one to think about. During the hold, your ${m.name.toLowerCase()} averaged ${formatValue(lo.mean, m)} in attempt ${lo.attempt.index} and ${formatValue(hi.mean, m)} in attempt ${hi.attempt.index}. What was different for you in attempt ${lo.attempt.index}: your focus, your breath, where your weight was? I marked that hold on the timeline so you can rewatch it.`,
    actions: [{ type: 'add_moment_marker', t: hold.start, text: `Reflection: what felt different in attempt ${lo.attempt.index}?` }, { type: 'seek_video', t: hold.start }],
    lookedAt: ['get_session_results', 'get_metric_definition'],
  }
}

function teacherQuestions(ctx: CompanionContext): CompanionReply {
  const knee = metricOf(ctx, 'kneeToe')
  const kneePeak = peaksByAttempt(ctx, 'kneeToe')[0]
  const rel = ctx.attempts.map((a) => ({ a, t: ctx.releve[a.id] })).filter((r) => r.t !== null) as { a: Attempt; t: number }[]
  const longest = rel.length ? rel.reduce((x, y) => (y.t > x.t ? y : x)) : null
  const gap = ctx.attempts.find((a) => ctx.releve[a.id] === null)
  const note = ctx.markers.find((mk) => mk.author === 'dancer' && mk.text.trim())
  const qs: string[] = []
  if (kneePeak) qs.push(`My knees drifted most during the ${kneePeak.phase.label.toLowerCase()} of attempt ${kneePeak.attempt.index} (${formatValue(kneePeak.value, knee)}). Is there a cue that would help me feel that while I rise?`)
  if (longest) qs.push(`Attempt ${longest.a.index} was my longest time on relevé (${longest.t.toFixed(1)} s). From your eye, was my alignment different there?`)
  if (note) qs.push(`At ${formatTime(note.t)} I wrote "${note.text.trim()}". Is that a sensation I should look for?`)
  else if (gap) qs.push(`The camera lost me in attempt ${gap.index}. Where should I put my phone when I film alone?`)
  return {
    text: `Three questions you could bring to class:\n${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}\nCopy any of them into your reflection if they're useful.`,
    actions: [],
    lookedAt: ['get_session_results', 'get_notes'],
  }
}

export function reply(question: string, ctx: CompanionContext): CompanionReply {
  const q = question.toLowerCase()
  if (/\b(pain|hurt|injur\w*|dolor|duele|lesi\w*)\b/.test(q)) {
    return { text: "I can't give medical or injury advice. If something hurts, stop and check with your teacher or a health professional. I can still help you review the video when you're ready.", actions: [], lookedAt: [] }
  }
  if (/\b(good|bad|correct|wrong|grade|score|rate|perfect|bien|mal|nota|calific\w*)\b/.test(q)) {
    const knee = metricOf(ctx, 'kneeToe')
    const means = holdMeans(ctx, 'kneeToe')
    const example = means.length >= 2 ? ` For example, your knee-over-toes average during the hold went from ${formatValue(means[0].mean, knee)} in attempt ${means[0].attempt.index} to ${formatValue(means[means.length - 1].mean, knee)} in attempt ${means[means.length - 1].attempt.index}.` : ''
    return { text: `I can't judge whether your technique is good. That call belongs to you and your teacher. What I can do is show what changed between your own attempts.${example} Want me to open that comparison?`, actions: [], lookedAt: ['get_session_results'] }
  }
  if (/teacher|profe|class|clase|instructor/.test(q)) return teacherQuestions(ctx)
  if (/reflect|reflexi|ask me|pregúntame|preguntame/.test(q)) return reflection(ctx)
  if (/compar|\bvs\b|versus|differen|diferen/.test(q)) return compare(ctx, q)
  if (/knee|rodilla/.test(q)) return findMoment(ctx, 'kneeToe', 'Your knees moved furthest from the line above your toes in')
  if (/shoulder|hombro|ear|oreja/.test(q)) return findMoment(ctx, 'shoulderEar', 'Your shoulders came closest to your ears in')
  if (/tilt|lean|trunk|torso|inclin/.test(q)) return findMoment(ctx, 'trunkTilt', 'Your torso leaned the most in')
  if (/hold|balance|relev|longest|stay|equilibr|tiempo/.test(q)) return longestHold(ctx)
  return {
    text: 'I can find moments in your video ("where did my shoulders lift?"), compare two attempts, ask you a reflection question, or draft questions for your teacher. I only use this session\'s measurements, and I don\'t grade technique.',
    actions: [],
    lookedAt: [],
  }
}
