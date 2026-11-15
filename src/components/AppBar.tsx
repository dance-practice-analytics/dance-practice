import type { ReactNode } from 'react'
import { href, useHash, parse, type Route } from '../router'
import { auth, signOut } from '../state/app'
import { useStore } from '../state/store'
import { toggleTheme, useTheme } from '../state/theme'
import { study, toggleStudyPanel } from '../study/log'
import { usingMockApi } from '../api/client'

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <g fill="none" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="16" cy="7.5" r="2.6" fill="var(--surface)" stroke="none" />
        <path d="M16 11v9M10 8.5l6 3 6-3M16 20l-3.5 7M16 20l3.5 7" />
      </g>
    </svg>
  )
}

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const NAV: { route: Route; label: string; match: Route['name'][]; icon: ReactNode }[] = [
  {
    route: { name: 'journal' },
    label: 'Home',
    match: ['journal', 'workspace', 'confirm', 'processing'],
    icon: <path {...ICON} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  },
  {
    route: { name: 'progress' },
    label: 'Progress',
    match: ['progress'],
    icon: <g {...ICON}><path d="M4 20h16" /><path d="M6 16l4-5 3.5 3L19 7" /><circle cx="19" cy="7" r="1.2" fill="currentColor" /></g>,
  },
  {
    route: { name: 'new' },
    label: 'New',
    match: ['new'],
    icon: <g {...ICON}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></g>,
  },
]

/** Left rail shared by every signed-in screen: where you are, where you can go, who you are. */
export function SideNav() {
  const theme = useTheme()
  const a = useStore(auth)
  const s = useStore(study)
  const current = parse(useHash()).name

  return (
    <nav className="sidenav" aria-label="Main">
      <a className="sidenav-brand" href={href({ name: 'journal' })} title="Practice Studio">
        <BrandMark size={30} />
      </a>
      <ul className="sidenav-items">
        {NAV.map((n) => {
          const on = n.match.includes(current)
          return (
            <li key={n.label}>
              <a className={`sidenav-item ${on ? 'on' : ''}`} href={href(n.route)} aria-current={on ? 'page' : undefined}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">{n.icon}</svg>
                <span>{n.label}</span>
              </a>
            </li>
          )
        })}
      </ul>
      <div className="sidenav-foot">
        {s.enabled && (
          <button className="sidenav-item study-on" onClick={toggleStudyPanel} title="Study log is recording (Ctrl+Shift+S)">
            <span className="rec-dot" />
            <span>Study</span>
          </button>
        )}
        <button className="sidenav-item" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            {theme === 'dark'
              ? <g {...ICON}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></g>
              : <path {...ICON} d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />}
          </svg>
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
        {a.status === 'signedIn' && (
          <div className="sidenav-account">
            <span className="avatar" title="Signed in by participant code">{a.account.participant}</span>
            <button className="sidenav-signout" onClick={signOut}>Sign out</button>
          </div>
        )}
      </div>
    </nav>
  )
}

/** Slim top bar for a screen: `children` (title or breadcrumbs) on the left, `actions` on the right. */
export function AppBar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="header">
      <div className="header-middle">{children}</div>
      <div className="header-actions">
        {usingMockApi && <span className="pill" title="No backend connected: synthetic sessions stored in this browser">Mock API</span>}
        {actions}
      </div>
    </header>
  )
}
