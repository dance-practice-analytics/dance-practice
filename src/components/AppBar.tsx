import type { ReactNode } from 'react'
import { href, useHash, parse, type Route } from '../router'
import { auth, signOut } from '../state/app'
import { useStore } from '../state/store'
import { toggleTheme, useTheme } from '../state/theme'
import { study, toggleStudyPanel } from '../study/log'
import { usingMockApi } from '../api/client'

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    // Logo B1 (arabesque); the same paths as Logo in src/v2/components/Icon.tsx and scripts/make-icons.mjs.
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <g transform="translate(32 32) scale(0.92) translate(-32 -32)">
        <path d="M21.8 33.2C25.6 28.6 34.8 27.4 39.2 30.2C36.6 34.8 27.6 37.4 21.8 33.2Z" fill="var(--surface)" />
        <path
          d="M12.6 16.5a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0M19.6 20.6C23 24.5 26.2 28.2 29.6 31.2M21 22C15.5 21.8 10 20.3 5 17M22.4 22.6C29 22.5 34.5 19.5 38.5 14.5M29.8 32.2C30.6 40 30.9 48 31 56.4L31.3 60M30.8 31.6C39 31.2 48 28.2 59.5 21.8M24 60.6H37"
          fill="none"
          stroke="var(--surface)"
          strokeWidth="4.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
            <span className="avatar" title={a.account.email ? `Signed in as ${a.account.email}` : 'Signed in by participant code'}>
              {a.account.name ? a.account.name.slice(0, 2).toUpperCase() : a.account.participant}
            </span>
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
