import { useEffect } from 'react'
import { navigate, parse, useHash, type Route } from './router'
import { SideNav } from './components/AppBar'
import { Progress } from './pages/Progress'
import { auth, restoreAuth } from './state/app'
import { useStore } from './state/store'
import { setStudyEnabled, setStudyParticipant, toggleStudyPanel, track } from './study/log'
import { StudyPanel } from './study/StudyPanel'
import { SignIn } from './pages/SignIn'
import { Journal } from './pages/Journal'
import { NewSession } from './pages/NewSession'
import { Processing } from './pages/Processing'
import { ConfirmAttempts } from './pages/ConfirmAttempts'
import { Workspace } from './pages/Workspace'
import { Spinner, Toasts } from './components/ui'

/** Shared SVG patterns for low-confidence and missing-tracking bands. */
function Patterns() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <pattern id="hatch-low" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="hatch-low-bg" />
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-low-line" strokeWidth="2" />
        </pattern>
        <pattern id="hatch-missing" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="hatch-missing-bg" />
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-missing-line" strokeWidth="2" />
        </pattern>
      </defs>
    </svg>
  )
}

function useStudyToggle() {
  const hash = useHash()
  useEffect(() => {
    const q = new URLSearchParams(hash.split('?')[1] ?? '')
    if (q.get('study') === 'on') setStudyEnabled(true)
    if (q.get('study') === 'off') setStudyEnabled(false)
  }, [hash])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        toggleStudyPanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Screen() {
  const hash = useHash()
  const a = useStore(auth)
  const route = parse(hash)

  useEffect(() => {
    if (a.status === 'signedOut' && route.name !== 'signin') navigate({ name: 'signin' }, { replace: true })
    if (a.status === 'signedIn' && route.name === 'signin') navigate({ name: 'journal' }, { replace: true })
    if (route.name === 'notFound') navigate({ name: 'journal' }, { replace: true })
  }, [a.status, route.name])

  useEffect(() => {
    setStudyParticipant(a.status === 'signedIn' ? a.account.participant : null)
  }, [a])

  useEffect(() => {
    track('route', { screen: route.name })
    window.scrollTo(0, 0)
  }, [route.name])

  if (a.status === 'loading') return <Spinner label="Opening Practice Studio…" />
  if (a.status === 'signedOut') return route.name === 'signin' ? <SignIn /> : null
  return (
    <div className="shell">
      <SideNav />
      <div className="shell-main" key={route.name}>{page(route)}</div>
    </div>
  )
}

function page(route: Route) {
  switch (route.name) {
    case 'journal':
      return <Journal />
    case 'progress':
      return <Progress />
    case 'new':
      return <NewSession />
    case 'processing':
      return <Processing key={route.id} id={route.id} />
    case 'confirm':
      return <ConfirmAttempts key={route.id} id={route.id} />
    case 'workspace':
      return <Workspace id={route.id} />
    default:
      return null
  }
}

export default function App() {
  useEffect(() => {
    restoreAuth()
  }, [])
  useStudyToggle()
  return (
    <>
      <Patterns />
      <Screen />
      <Toasts />
      <StudyPanel />
    </>
  )
}
