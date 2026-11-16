// Screen 3 — Dashboard.
// Design: Dashboard.dc.html (dancer and researcher variants), DashboardMobile.dc.html;
// empty / loading / error patterns in States.dc.html. The variant is the account's real
// `profiles.role`; there is no role switch. View-model: ./dashboard/model.ts.

import { useAuth } from '../auth'
import { EmptyState, ErrorAlert, Icon, PageHeader, PrivacyPill, Skeleton } from '../components'
import { latestProcessed, useLibrary } from '../data'
import { href } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { DancerDashboard } from './dashboard/Dancer'
import { ResearcherDashboard } from './dashboard/Researcher'
import { useLiveStatus, useWho } from './library/hooks'
import './library/library.css'
import { useAccountNotes } from './library/notes'

export function Dashboard() {
  const lib = useLibrary()
  const { role } = useAuth()
  const who = useWho()
  const narrow = useIsNarrow()
  const notes = useAccountNotes()
  const live = useLiveStatus()
  const data = lib.data
  const researcher = role === 'researcher'
  const iconSize = { width: 20, height: 20 }

  return (
    <>
      <PageHeader
        title="Dashboard"
        eyebrow={`Signed in as ${who}`}
        subtitle={
          researcher
            ? 'Study progress, clips that need attention, and recent activity.'
            : 'Your latest practice, how each metric has changed, and what is still processing.'
        }
        actions={<PrivacyPill>Clips processed on this device, not uploaded</PrivacyPill>}
        mobileActions={
          <>
            <a
              className="btn btn-ghost btn-icon btn-lg"
              href={href({ name: 'chat', attemptId: latestProcessed(data?.attempts)?.id })}
              aria-label="Ask Mika about your practice"
            >
              <Icon name="chat" style={iconSize} />
            </a>
            <a className="btn btn-ghost btn-icon btn-lg" href={href({ name: 'import' })} aria-label="Import clips">
              <Icon name="plus" style={iconSize} />
            </a>
          </>
        }
      />
      {narrow && <PrivacyPill style={{ alignSelf: 'flex-start' }} />}
      {lib.error && <ErrorAlert error={lib.error} onRetry={lib.refetch} />}

      {lib.loading ? (
        <LoadingDashboard narrow={narrow} />
      ) : !data ? null : data.attempts.length === 0 ? (
        <EmptyState
          icon="review"
          title="No clips yet"
          action={
            <a className="btn btn-primary" href={href({ name: 'import' })}>
              Import clips
            </a>
          }
        >
          Import study clips or a video of your own. Study clips are processed on this device and never uploaded.
        </EmptyState>
      ) : researcher ? (
        <ResearcherDashboard data={data} notes={notes} live={live} />
      ) : (
        <DancerDashboard data={data} notes={notes} live={live} narrow={narrow} />
      )}
    </>
  )
}

function LoadingDashboard({ narrow }: { narrow: boolean }) {
  const card = (flex: string, lines: number) => (
    <div className="card" style={{ padding: narrow ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 12, flex, minWidth: 0 }}>
      <Skeleton height={12} width="30%" />
      <Skeleton height={20} width="60%" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 60 : 12} width={i === 0 ? '100%' : '80%'} />
      ))}
    </div>
  )
  return (
    <div aria-busy="true" aria-label="Loading dashboard" style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 16 : 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {card('2 1 520px', 2)}
        {card('1 1 300px', 2)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${narrow ? 150 : 240}px, 100%), 1fr))`, gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={narrow ? 120 : 132} radius={12} />
        ))}
      </div>
    </div>
  )
}
