// Root of the v2 app: auth gate → consent gate → Shell + routed page.
// No screen logic lives here; each route maps to one file in pages/.

import { useEffect, type ReactNode } from 'react'
import { startAuth, useAuth } from './auth'
import { releaseAllClips } from './clips'
import { ErrorAlert, Spinner } from './components'
import { useConsents } from './consents'
import { Chat } from './pages/Chat'
import { Compare } from './pages/Compare'
import { Consent } from './pages/Consent'
import { Dashboard } from './pages/Dashboard'
import { Dataset } from './pages/Dataset'
import { Import } from './pages/Import'
import { Library } from './pages/Library'
import { Notes } from './pages/Notes'
import { Processing } from './pages/Processing'
import { Progress } from './pages/Progress'
import { Review } from './pages/Review'
import { Settings } from './pages/Settings'
import { SignIn } from './pages/SignIn'
import { resetPipeline } from './pipeline'
import { navigate, useRoute, type Route } from './router'
import { Shell } from './Shell'
import { useTheme } from './theme'

function page(route: Route): ReactNode {
  switch (route.name) {
    case 'dashboard':
      return <Dashboard />
    case 'library':
      return <Library />
    case 'import':
      return <Import />
    case 'processing':
      return <Processing />
    case 'review':
      return <Review />
    case 'compare':
      return <Compare />
    case 'progress':
      return <Progress />
    case 'notes':
      return <Notes />
    case 'chat':
      return <Chat />
    case 'dataset':
      return <Dataset />
    case 'settings':
      return <Settings />
    case 'signin':
    case 'consent':
      return null
  }
}

function Loading({ label }: { label: string }) {
  return (
    <div className="v2-center" role="status">
      <span className="t-small muted" style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
        <Spinner />
        {label}
      </span>
    </div>
  )
}

function Gate() {
  const auth = useAuth()
  const consents = useConsents()
  const route = useRoute()
  const signedIn = auth.status === 'signedIn'
  const needsConsent = signedIn && consents.status === 'ready' && !consents.requiredAccepted
  const ready = signedIn && consents.status === 'ready' && consents.requiredAccepted
  // The profile decides this; until it has loaded, nobody is sent away from the dataset.
  const datasetDenied = ready && route.name === 'dataset' && auth.profile !== null && auth.role !== 'researcher'

  // Keep the address in step with the gate, so Back and reload behave.
  useEffect(() => {
    if (auth.status === 'signedOut' && route.name !== 'signin') navigate({ name: 'signin' }, { replace: true })
    else if (needsConsent && route.name !== 'consent') navigate({ name: 'consent' }, { replace: true })
    else if (ready && (route.name === 'signin' || route.name === 'consent' || datasetDenied)) {
      navigate({ name: 'dashboard' }, { replace: true })
    }
  }, [auth.status, needsConsent, ready, datasetDenied, route.name])

  // Local clips and the queue belong to the account that picked them.
  useEffect(() => {
    if (auth.status !== 'signedOut') return
    resetPipeline()
    releaseAllClips()
  }, [auth.status])

  if (auth.status === 'loading') return <Loading label="Opening…" />
  if (auth.status === 'signedOut') return <SignIn />
  if (consents.status === 'loading') return <Loading label="Opening your account…" />
  if (consents.status === 'error' && consents.error) {
    return (
      <div className="v2-center">
        <div style={{ maxWidth: 480, width: '100%' }}>
          <ErrorAlert error={consents.error} onRetry={consents.reload} />
        </div>
      </div>
    )
  }
  if (!consents.requiredAccepted) return <Consent />
  const content = datasetDenied ? null : page(route)
  if (content === null) return <Loading label="Opening…" />
  return <Shell active={route.name}>{content}</Shell>
}

export function App() {
  const theme = useTheme()
  useEffect(startAuth, [])
  return (
    <div className={theme === 'dark' ? 'app v2-root dark' : 'app v2-root'}>
      <Gate />
    </div>
  )
}
