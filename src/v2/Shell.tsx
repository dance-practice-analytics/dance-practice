// Frame of every signed-in screen (Sidebar.dc.html, BottomNav.dc.html).
// Wide: 240px sidebar with every destination, Mika included. Under 900px: the page's
// own `.mhead` (rendered by PageHeader, with the Mika button) and the five-item bottom
// navigation, where the attempt screens light up Library. Processing is the second half
// of Import: it appears under Import only while clips are queued or being read (or while open).
// The role shown is the real profiles.role; the Dancer/Researcher switch on the
// canvas is a design prop, so here it is a label, not a control.

import type { ReactNode } from 'react'
import { signOut, useAuth } from './auth'
import { Icon, Logo, type IconName } from './components/Icon'
import { useOfflineQueue } from './offline/uploadQueue'
import { usePipeline } from './pipeline'
import { href, type Route, type RouteName } from './router'
import { toggleTheme, useTheme } from './theme'

interface NavItem {
  route: Route
  label: string
  icon: IconName
  /** Other routes that light this item up as their parent (the item gets `.parent`, not aria-current). */
  covers?: RouteName[]
  researcherOnly?: boolean
}

/** Screens of one attempt, shown as a "current attempt" sub-item under Library. */
const ATTEMPT_SCREENS: Partial<Record<RouteName, { label: string; icon: IconName }>> = {
  review: { label: 'Review', icon: 'review' },
  compare: { label: 'Compare', icon: 'compare' },
  notes: { label: 'Practice notes', icon: 'notes' },
  chat: { label: 'Mika', icon: 'chat' },
}
const ATTEMPT_ROUTES = Object.keys(ATTEMPT_SCREENS) as RouteName[]

const SIDE_ITEMS: NavItem[] = [
  { route: { name: 'dashboard' }, label: 'Dashboard', icon: 'home' },
  { route: { name: 'library' }, label: 'Library', icon: 'library' },
  { route: { name: 'import' }, label: 'Import', icon: 'import', covers: ['processing'] },
  { route: { name: 'review' }, label: 'Review', icon: 'review' },
  { route: { name: 'compare' }, label: 'Compare', icon: 'compare' },
  { route: { name: 'progress' }, label: 'Progress', icon: 'progress' },
  { route: { name: 'notes' }, label: 'Practice notes', icon: 'notes' },
  { route: { name: 'chat' }, label: 'Mika', icon: 'chat' },
  { route: { name: 'dataset' }, label: 'Study dataset', icon: 'dataset', researcherOnly: true },
  { route: { name: 'settings' }, label: 'Settings & data', icon: 'settings' },
]

// The phone has five slots, the same top level as the sidebar; each one also lights
// up for the screens reached from it.
const BOTTOM_ITEMS: (NavItem & { covers: RouteName[] })[] = [
  { route: { name: 'dashboard' }, label: 'Home', icon: 'home', covers: ['dashboard', 'dataset'] },
  { route: { name: 'library' }, label: 'Library', icon: 'library', covers: ['library', ...ATTEMPT_ROUTES] },
  { route: { name: 'import' }, label: 'Import', icon: 'import', covers: ['import', 'processing'] },
  { route: { name: 'progress' }, label: 'Progress', icon: 'progress', covers: ['progress'] },
  { route: { name: 'settings' }, label: 'Settings', icon: 'settings', covers: ['settings'] },
]

/** Clips waiting or being read in this tab. Own component: the queue updates on every frame step. */
function useQueueCount(): number {
  return usePipeline().items.filter((it) => it.status === 'queued' || it.status === 'processing').length
}

function QueueCount({ inline }: { inline?: boolean }) {
  const queued = useQueueCount()
  // The phone has no sidebar status line, so its badge also counts results waiting to upload.
  const waiting = useOfflineQueue().ids.length
  const pending = inline ? 0 : waiting
  const n = queued + pending
  if (n === 0) return null
  const parts = [
    queued > 0 ? `${queued} ${queued === 1 ? 'clip' : 'clips'} in the queue` : null,
    pending > 0 ? `${pending} ${pending === 1 ? 'result' : 'results'} waiting to upload` : null,
  ].filter(Boolean)
  return (
    <span className={inline ? 'v2-navcount' : 'v2-navcount v2-navcount-dot'}>
      {n}
      <span className="v2-sr"> {parts.join(', ')}</span>
    </span>
  )
}

/**
 * FR-3.8.6: results processed offline that still wait to upload. A quiet status line,
 * not an error; Processing has the details and "Retry now".
 */
function PendingUploads() {
  const { ids, flushing } = useOfflineQueue()
  const n = ids.length
  return (
    <p className="t-caption" role="status" style={{ display: n > 0 ? 'flex' : 'none', alignItems: 'center', gap: 6, padding: '0 8px' }}>
      <Icon name={flushing ? 'refresh' : 'upload'} size={14} style={{ flex: 'none' }} />
      {n > 0 && (
        <a href={href({ name: 'processing' })}>
          {flushing ? 'Uploading saved results…' : `${n} ${n === 1 ? 'result' : 'results'} waiting to upload`}
        </a>
      )}
    </p>
  )
}

/** "Processing" under Import: only while the queue has work, or while it is the open screen. */
function ProcessingSubItem({ active }: { active: RouteName }) {
  const n = useQueueCount()
  const pending = useOfflineQueue().ids.length
  const on = active === 'processing'
  if (n === 0 && pending === 0 && !on) return null
  return (
    <ul className="v2-subnav">
      <li>
        <a href={href({ name: 'processing' })} className={on ? 'active' : undefined} aria-current={on ? 'page' : undefined}>
          <Icon name="processing" />
          Processing
          {n > 0 && <QueueCount inline />}
        </a>
      </li>
    </ul>
  )
}

export interface ShellProps {
  /** The current route name, for `aria-current`. */
  active: RouteName
  /** The routed page. It renders inside `<main class="v2-main">` (flex column, gap 24 / 16). */
  children: ReactNode
}

export function Shell({ active, children }: ShellProps) {
  const { user, role, profile } = useAuth()
  const theme = useTheme()
  const items = SIDE_ITEMS.filter((i) => role === 'researcher' || !i.researcherOnly)

  return (
    <div className="v2-shell">
      <nav className="v2-side" aria-label="Primary">
        <a
          href={href({ name: 'dashboard' })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', textDecoration: 'none', color: 'var(--text)' }}
        >
          <Logo />
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: '16px' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Dance Practice</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Analytics</span>
          </span>
        </a>

        <ul className="sidenav" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((it) => {
            const on = it.route.name === active
            // A parent of the open screen is marked visually; aria-current stays on the sub-item.
            const parent = !on && !!it.covers?.includes(active)
            return (
              <li key={it.route.name}>
                <a
                  href={href(it.route)}
                  className={on ? 'active' : parent ? 'parent' : undefined}
                  aria-current={on ? 'page' : undefined}
                >
                  <Icon name={it.icon} />
                  {it.label}
                </a>
                {it.route.name === 'import' && <ProcessingSubItem active={active} />}
              </li>
            )
          })}
        </ul>

        <div style={{ flex: 1 }} />

        <PendingUploads />

        <p className="t-caption" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
          <Icon name="device" size={14} style={{ flex: 'none' }} />
          Clips stay on this device
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 4px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="t-small v2-clip" title={user?.email}>
              {profile?.display_name || user?.email}
            </span>
            <span className="t-caption">Signed in as {role}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" type="button" style={{ flex: 1, padding: '0 8px' }} onClick={() => void signOut()}>
              <Icon name="sign-out" />
              Sign out
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </div>
      </nav>

      <main className="v2-main" id="v2-main">
        {children}
      </main>

      <div className="v2-bnav">
        <nav className="bnav" aria-label="Primary">
          {BOTTOM_ITEMS.map((it) => {
            const on = it.covers.includes(active)
            // 'page' only for the exact screen; 'true' when the slot is the open screen's parent.
            const current = it.route.name === active ? 'page' : on ? 'true' : undefined
            return (
              <a key={it.route.name} href={href(it.route)} className={on ? 'active' : undefined} aria-current={current}>
                <span className="ic">
                  <Icon name={it.icon} />
                  {it.route.name === 'import' && <QueueCount />}
                </span>
                {it.label}
              </a>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
