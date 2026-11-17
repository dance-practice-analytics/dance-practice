// Opt-in video backup (videoBackup.ts): one line per clip with its upload progress,
// "Try again" when an upload failed. Shown only when backup was turned on at Import.

import { Icon, StatusPill } from '../../components'
import { formatBytes } from '../../format'
import { href } from '../../router'
import { clearFinishedBackups, retryBackup, useBackups, type BackupItem } from '../../videoBackup'

const LABEL: Record<BackupItem['status'], string> = {
  waiting: 'Waits for processing',
  uploading: 'Backing up',
  done: 'Backed up',
  failed: 'Not backed up',
  skipped: 'Not backed up',
}
const PILL = { waiting: 'queued', uploading: 'processing', done: 'done', failed: 'failed', skipped: 'cancelled' } as const

export function BackupNotice() {
  const items = useBackups()
  if (items.length === 0) return null
  const done = items.filter((it) => it.status === 'done').length
  const open = items.some((it) => it.status === 'waiting' || it.status === 'uploading')
  return (
    <section className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="v2-backup-h">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 className="t-h3" id="v2-backup-h" style={{ flex: '1 1 200px' }}>
          Video backup · {done} of {items.length} done
        </h2>
        {!open && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={clearFinishedBackups}>
            Clear finished
          </button>
        )}
      </div>
      <p className="t-caption">Stored privately in your account; only you can see them. Keep this tab open until the uploads finish.</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <li key={it.attemptId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-backup={it.status}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {it.status === 'done' ? (
                <a className="mono v2-clip" style={{ fontSize: 12, flex: '1 1 160px' }} href={href({ name: 'review', attemptId: it.attemptId })}>
                  {it.name}
                </a>
              ) : (
                <span className="mono v2-clip" style={{ fontSize: 12, flex: '1 1 160px' }}>
                  {it.name}
                </span>
              )}
              <span className="t-caption num">{formatBytes(it.size)}</span>
              <StatusPill
                status={PILL[it.status]}
                label={it.status === 'uploading' ? `${LABEL.uploading} ${Math.round(it.fraction * 100)}%` : LABEL[it.status]}
              />
              {it.status === 'failed' && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => retryBackup(it.attemptId)}>
                  <Icon name="refresh" />
                  Try again
                </button>
              )}
            </div>
            {it.status === 'uploading' && (
              <div
                className="bar"
                role="progressbar"
                aria-label={`Backing up ${it.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(it.fraction * 100)}
              >
                <i style={{ width: `${(it.fraction * 100).toFixed(1)}%` }} />
              </div>
            )}
            {it.reason && <span className="t-caption">{it.reason}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
