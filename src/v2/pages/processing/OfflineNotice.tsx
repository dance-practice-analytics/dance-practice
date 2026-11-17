// FR-3.8.6: results processed while the device was offline (or the save failed on the
// network) wait in this browser and upload by themselves when the connection is back.
// This card shows how many are waiting and offers "Retry now".

import { useState } from 'react'
import { Alert, NoteBox } from '../../components'
import { flushQueue, useOfflineQueue } from '../../offline/uploadQueue'

export function OfflineNotice() {
  const { ids, flushing, lastError, unavailable } = useOfflineQueue()
  const [tried, setTried] = useState(false)
  const n = ids.length

  if (n === 0) {
    if (!unavailable) return null
    return (
      <NoteBox title="Results can’t be kept offline in this browser.">
        Storage is blocked here (for example in a private window), so keep the connection on while clips are processed.
      </NoteBox>
    )
  }

  const retry = async () => {
    setTried(true)
    await flushQueue()
  }
  const title = `${n} processed ${n === 1 ? 'clip is' : 'clips are'} waiting to upload.`
  return (
    <Alert
      role="status"
      title={title}
      actions={
        <button className="btn btn-secondary btn-sm" type="button" disabled={flushing} onClick={() => void retry()}>
          {flushing ? 'Uploading…' : 'Retry now'}
        </button>
      }
    >
      The pose data and measurements are kept in this browser (never the video) and upload by themselves when the connection is back.
      {tried && lastError && !flushing ? ` ${lastError.message} ${lastError.recovery ?? ''}` : ''}
    </Alert>
  )
}
