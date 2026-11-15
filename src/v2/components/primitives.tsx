// Small shared pieces of the design system: badges, pills, callouts, empty and
// loading states, the page header. Presentational only — no data fetching in here.
// Design sources: Main.dc.html (showcase) and States.dc.html (empty/loading/error).

import type { CSSProperties, ReactNode } from 'react'
import type { AttemptStatus } from '../../data/schema'
import { CONFIDENCE_LABELS, STATUS_LABELS, type ConfidenceLevel } from '../format'
import { useIsNarrow } from '../useIsNarrow'
import { Icon, type IconName } from './Icon'

// ---------- confidence ----------

export type Confidence = ConfidenceLevel | 'none'

const CONF_CLASS: Record<Confidence, string> = { high: 'conf-high', medium: 'conf-med', low: 'conf-low', none: 'conf-none' }

export interface ConfBadgeProps {
  /** 'none' = no tracking (hatched, dashed). */
  level: Confidence
  /** Replaces the default word (High / Medium / Low / No tracking). */
  label?: string
}

/** `.conf`: three bars plus a word. Told apart by shape and text, never by hue. */
export function ConfBadge({ level, label }: ConfBadgeProps) {
  return (
    <span className={`conf ${CONF_CLASS[level]}`}>
      <span className="conf-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label ?? CONFIDENCE_LABELS[level]}
    </span>
  )
}

// ---------- processing status ----------

export type Status = AttemptStatus | 'cancelled'

export interface StatusPillProps {
  status: Status
  /** Replaces the default word, e.g. 'Processing · 42%'. */
  label?: string
}

/** `.status st-*`: dot shape plus a word. */
export function StatusPill({ status, label }: StatusPillProps) {
  return (
    <span className={`status st-${status}`}>
      <span className="dot" aria-hidden="true" />
      {label ?? STATUS_LABELS[status]}
    </span>
  )
}

// ---------- privacy pill ----------

export interface PrivacyPillProps {
  /** Default: 'Processed on this device, not uploaded'. */
  children?: ReactNode
  /** Dark variant for use on the video stage. */
  onStage?: boolean
  style?: CSSProperties
}

export function PrivacyPill({ children, onStage, style }: PrivacyPillProps) {
  return (
    <span className={onStage ? 'privacy privacy-stage' : 'privacy'} style={style}>
      <Icon name="device" />
      {children ?? 'Processed on this device, not uploaded'}
    </span>
  )
}

// ---------- callouts ----------

export interface AlertProps {
  /** Bold lead sentence: what happened. */
  title?: ReactNode
  /** What still works / what to do. */
  children?: ReactNode
  /** Buttons or links (use `.btn .btn-sm`). */
  actions?: ReactNode
  /** role="alert" announces it at once; pass 'status' for something less urgent. */
  role?: 'alert' | 'status'
}

/** `.alert`: a system state that needs attention. Neutral — never comments on the dancer. */
export function Alert({ title, children, actions, role = 'alert' }: AlertProps) {
  return (
    <div className="alert" role={role}>
      <Icon name="warning" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <p>
          {title && <strong>{title}</strong>} {children}
        </p>
        {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
    </div>
  )
}

/** Alert for a thrown ApiError: its message, its recovery hint and an optional retry. */
export function ErrorAlert({ error, onRetry }: { error: { message: string; recovery?: string }; onRetry?: () => void }) {
  return (
    <Alert
      title={error.message}
      actions={
        onRetry && (
          <button className="btn btn-secondary btn-sm" type="button" onClick={onRetry}>
            Try again
          </button>
        )
      }
    >
      {error.recovery}
    </Alert>
  )
}

export interface NoteBoxProps {
  /** Bold lead-in. */
  title?: ReactNode
  children?: ReactNode
  icon?: IconName
}

/** `.note-box`: quiet information (offline, storage, how something is measured). */
export function NoteBox({ title, children, icon = 'info' }: NoteBoxProps) {
  return (
    <div className="note-box">
      <Icon name={icon} />
      <p>
        {title && <strong style={{ color: 'var(--text)' }}>{title}</strong>} {children}
      </p>
    </div>
  )
}

// ---------- empty state ----------

export interface EmptyStateProps {
  icon: IconName
  title: string
  /** One or two sentences: what is missing and what still works. */
  children?: ReactNode
  /** One next step: an `<a class="btn …">` or a button. */
  action?: ReactNode
  /** Drop the card frame when it sits inside another card. */
  bare?: boolean
  style?: CSSProperties
}

/** The empty card of States.dc.html: icon tile, title, a sentence, one next step. */
export function EmptyState({ icon, title, children, action, bare, style }: EmptyStateProps) {
  return (
    <div
      className={bare ? undefined : 'card'}
      style={{
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 12,
        ...style,
      }}
    >
      <div
        className="well"
        style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16 }}
      >
        <Icon name={icon} size={24} />
      </div>
      <h2 className="t-h3">{title}</h2>
      {children && (
        <p className="t-small muted" style={{ maxWidth: 440 }}>
          {children}
        </p>
      )}
      {action}
    </div>
  )
}

// ---------- loading ----------

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number
  style?: CSSProperties
}

/** One `.skel` block. */
export function Skeleton({ width = '100%', height = 12, radius, style }: SkeletonProps) {
  return <div className="skel" style={{ width, height, borderRadius: radius, ...style }} />
}

/** The "Library list" loader: `rows` lines of thumbnail + two text bars + a pill. */
export function SkeletonList({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }} aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Skeleton width={64} height={40} radius={6} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton height={12} width="70%" />
            <Skeleton height={10} width="40%" />
          </div>
          <Skeleton width={64} height={20} />
        </div>
      ))}
    </div>
  )
}

/** The "Review workspace" loader: stage, ribbon, three metric tiles and a caption. */
export function SkeletonWorkspace({ caption = 'Loading keypoints…', label = 'Loading' }: { caption?: string; label?: string }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }} aria-busy="true" aria-label={label}>
      <Skeleton height={220} radius={12} />
      <Skeleton height={22} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <Skeleton height={64} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
      <p className="t-caption">{caption}</p>
    </div>
  )
}

/** Inline `.spinner`; inherits the text colour. */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
}

// ---------- page header ----------

export interface PageHeaderProps {
  /** The h1. */
  title: string
  /** Shorter title for the phone header (e.g. 'Import' for 'Import clips'). */
  mobileTitle?: string
  /** Small line above the title: an uppercase label, a breadcrumb or context. Plain strings get `.t-label`. */
  eyebrow?: ReactNode
  /** One line under the title (`.t-small .muted`). */
  subtitle?: ReactNode
  /** Right side on desktop: privacy pill, buttons, segmented controls. */
  actions?: ReactNode
  /** Right side of the phone header; defaults to nothing (keep it to one or two icon buttons). */
  mobileActions?: ReactNode
  /** Phone only: a back link shown before the title, e.g. `href({ name: 'library' })`. */
  backHref?: string
}

/**
 * The header every routed page starts with. Wide screens: eyebrow, `h1.t-h1`,
 * subtitle and actions in a wrapping row (as in Library.dc.html). Under 900px: the
 * sticky `.mhead` bar of the mobile designs with `h1.t-h2`.
 */
export function PageHeader({ title, mobileTitle, eyebrow, subtitle, actions, mobileActions, backHref }: PageHeaderProps) {
  const narrow = useIsNarrow()
  if (narrow) {
    return (
      <header className="mhead v2-mhead">
        {backHref && (
          <a className="btn btn-ghost btn-icon" href={backHref} aria-label="Back" style={{ marginLeft: -8 }}>
            <Icon name="chevron-left" style={{ width: 20, height: 20 }} />
          </a>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {eyebrow && <span className="t-caption v2-clip">{eyebrow}</span>}
          <h1 className="t-h2 v2-clip">{mobileTitle ?? title}</h1>
        </div>
        {mobileActions}
      </header>
    )
  }
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {eyebrow && (typeof eyebrow === 'string' ? <p className="t-label">{eyebrow}</p> : <div className="t-small subtle">{eyebrow}</div>)}
        <h1 className="t-h1">{title}</h1>
        {subtitle && <p className="t-small muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  )
}
