// Frame of every signed-in screen (Sidebar.dc.html, BottomNav.dc.html).
// Wide: 240px sidebar with all destinations. Under 900px: the page's own `.mhead`
// (rendered by PageHeader) and the five-item bottom navigation.
// The role shown is the real profiles.role; the Dancer/Researcher switch on the
// canvas is a design prop, so here it is a label, not a control.

import type { ReactNode } from 'react'
import { signOut, useAuth } from './auth'
import { Icon, Logo, type IconName } from './components/Icon'
import { href, type Route, type RouteName } from './router'
import { toggleTheme, useTheme } from './theme'

interface NavItem {
  route: Route
  label: string
  icon: IconName
  researcherOnly?: boolean
}

const SIDE_ITEMS: NavItem[] = [
  { route: { name: 'dashboard' }, label: 'Dashboard', icon: 'home' },
  { route: { name: 'library' }, label: 'Library', icon: 'library' },
  { route: { name: 'import' }, label: 'Import', icon: 'import' },
  { route: { name: 'processing' }, label: 'Processing', icon: 'processing' },
  { route: { name: 'review' }, label: 'Review', icon: 'review' },
  { route: { name: 'compare' }, label: 'Compare', icon: 'compare' },
  { route: { name: 'progress' }, label: 'Progress', icon: 'progress' },
  { route: { name: 'notes' }, label: 'Practice notes', icon: 'notes' },
  { route: { name: 'chat' }, label: 'Ask AI', icon: 'chat' },
  { route: { name: 'dataset' }, label: 'Study dataset', icon: 'dataset', researcherOnly: true },
  { route: { name: 'settings' }, label: 'Settings & data', icon: 'settings' },
]

// The phone has five slots; each one also lights up for the screens reached from it.
const BOTTOM_ITEMS: (NavItem & { covers: RouteName[] })[] = [
  { route: { name: 'dashboard' }, label: 'Home', icon: 'home', covers: ['dashboard', 'library', 'dataset'] },
  { route: { name: 'import' }, label: 'Import', icon: 'import', covers: ['import', 'processing'] },
  { route: { name: 'review' }, label: 'Review', icon: 'review', covers: ['review', 'compare', 'notes', 'chat'] },
  { route: { name: 'progress' }, label: 'Progress', icon: 'progress', covers: ['progress'] },
  { route: { name: 'settings' }, label: 'Settings', icon: 'settings', covers: ['settings'] },
]

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
            return (
              <li key={it.route.name}>
                <a href={href(it.route)} className={on ? 'active' : undefined} aria-current={on ? 'page' : undefined}>
                  <Icon name={it.icon} />
                  {it.label}
                </a>
              </li>
            )
          })}
        </ul>

        <div style={{ flex: 1 }} />

        <div className="well" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="privacy" style={{ background: 'var(--surface)', alignSelf: 'flex-start' }}>
            <Icon name="device" />
            On-device mode
          </span>
          <p className="t-caption">
            {role === 'researcher' ? 'Clips stay on this computer' : 'Your study clips stay on this device'}
          </p>
        </div>

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
            return (
              <a key={it.route.name} href={href(it.route)} className={on ? 'active' : undefined} aria-current={on ? 'page' : undefined}>
                <span className="ic">
                  <Icon name={it.icon} />
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
