// Screen 5 — Import clips (FR-3.2.1–3.2.6).
// Design: Import.dc.html, ImportMobile.dc.html; error patterns in States.dc.html.
// Files are opened locally: header, fingerprint (SHA-256) and thumbnail are read on
// this device and only rows (name, fingerprint, length, tags) go to Supabase. The
// clips are registered in clips.ts and handed to the on-device pipeline.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { baseName, clipNumberOrNull } from '../../data/clipFile'
import { attemptTrim } from '../../data/repo'
import { CAMERA_VIEWS, MOVEMENT_TYPES, NOTE_MAX_CHARS, type CameraView, type MovementType } from '../../data/schema'
import { client } from '../auth'
import { registerClip } from '../clips'
import { Alert, ErrorAlert, Icon, NoteBox, PageHeader, PrivacyPill, StatusPill } from '../components'
import { invalidate, useLibrary } from '../data'
import { formatDate, MOVEMENT_CHOICE_LABELS, MOVEMENT_LABELS } from '../format'
import { enqueue, type PipelineJob } from '../pipeline'
import { href, navigate } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import './import/import.css'
import {
  checkRows,
  countChecks,
  formatLength,
  groupIntoSessions,
  alignTakeDates,
  linkedTakes,
  type TakeLink,
  localDate,
  parseTags,
  rowTrim,
  SUBJECT_CODES,
  summaryDetail,
  trimSummary,
  type Check,
  type ClipDraft,
  type ImportSource,
  type KnownClip,
  videoFilesOfFolder,
} from './import/model'
import { probeFile } from './import/probe'
import { createImport } from './import/submit'
import { TrimEditor } from './import/TrimEditor'

interface Row extends ClipDraft {
  file: File
  thumb: string | null
  /** Frame height in pixels, for the '1080p' caption on phones. */
  height: number | null
  /** Ticked for "Apply to N selected". */
  selected: boolean
}

const VIEW_SHORT: Record<CameraView, string> = { front: 'Front', side: 'Side', diagonal: 'Diagonal' }
const MOVEMENT_SHORT: Record<MovementType, string> = { releve_balance: 'Relevé', pirouette: 'Pirouette', phrase: 'Phrase' }

let nextRowId = 0

function newRow(file: File, sessionDate: string | null): Row {
  // Shown on this screen only; what is saved is a de-identified label (FR-3.2.5).
  const name = baseName(file.name)
  const tags = parseTags(name)
  return {
    id: `clip-${++nextRowId}`,
    file,
    name,
    sizeBytes: file.size,
    probe: 'reading',
    problem: null,
    durationS: null,
    sha: null,
    thumb: null,
    height: null,
    subject: tags.subject,
    movement: tags.movement ?? 'releve_balance',
    view: tags.view ?? 'front',
    recordedOn: sessionDate ?? localDate(file.lastModified),
    clipNumber: tags.clipNumber,
    reprocess: false,
    failure: null,
    selected: true,
  }
}

export function Import() {
  const narrow = useIsNarrow()
  const library = useLibrary()
  const [source, setSource] = useState<ImportSource>('study')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ queued: number; failed: number } | null>(null)
  /** Session date chosen by the user (FR-3.2.2); null = each file's own date. */
  const [sessionDate, setSessionDate] = useState<string | null>(null)
  const [sessionNote, setSessionNote] = useState('')
  const [skipped, setSkipped] = useState(0)
  const noteTooLong = [...sessionNote.trim()].length > NOTE_MAX_CHARS

  const patch = useCallback((id: string, change: Partial<Row>) => {
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)))
  }, [])
  const remove = useCallback((id: string) => setRows((list) => list.filter((r) => r.id !== id)), [])

  const changeSessionDate = (day: string | null) => {
    setSessionDate(day)
    setRows((list) => list.map((r) => ({ ...r, recordedOn: day ?? localDate(r.file.lastModified) })))
  }

  const addFiles = useCallback(
    (files: readonly File[], skippedFiles = 0) => {
      setSkipped(skippedFiles)
      if (files.length === 0) return
      const added = files.map((f) => newRow(f, sessionDate))
      setNotice(null)
      setRows((list) => [...list, ...added])
      for (const row of added) {
        void probeFile(row.file).then((res) =>
          res.ok
            ? patch(row.id, { probe: 'ok', durationS: res.meta.durationS, height: res.meta.height, sha: res.sha, thumb: res.thumb })
            : patch(row.id, { probe: 'unreadable', problem: res.message }),
        )
      }
    },
    [patch, sessionDate],
  )

  // Clips this account already has, by fingerprint.
  const known = useMemo(() => {
    const map = new Map<string, KnownClip>()
    for (const a of library.data?.attempts ?? []) {
      if (!a.video_sha256) continue
      map.set(a.video_sha256, {
        attemptId: a.id,
        importedAt: a.created_at,
        subjectCode: a.session.subject_code,
        movement: a.session.movement_type,
        status: a.status,
        trim: attemptTrim(a),
      })
    }
    return map
  }, [library.data])

  // Until the library has loaded a duplicate can't be told from a new clip, so rows wait.
  const libraryReady = library.data !== null
  const checks = useMemo(
    () => checkRows(libraryReady ? rows : rows.map((r) => ({ ...r, probe: r.probe === 'ok' ? ('reading' as const) : r.probe })), known, source),
    [rows, known, source, libraryReady],
  )
  const counts = useMemo(() => countChecks(checks.values()), [checks])
  const selected = rows.filter((r) => r.selected)

  async function submit() {
    if (busy || !library.data || noteTooLong) return
    setBusy(true)
    setNotice(null)
    const jobs: PipelineJob[] = []
    let failed = 0
    try {
      const fresh = rows.filter((r) => checks.get(r.id)?.kind === 'ready')
      const outcomes = await createImport(client(), source, groupIntoSessions(alignTakeDates(fresh)), library.data.sessions, sessionNote)
      const changes = new Map<string, Partial<Row> | null>()
      for (const row of fresh) {
        const res = outcomes.get(row.id)
        if (res?.ok) {
          registerClip(res.attempt.id, row.file)
          jobs.push({ attemptId: res.attempt.id, movement: row.movement, clipName: row.name, trim: rowTrim(row).range })
          changes.set(row.id, null)
        } else {
          failed++
          changes.set(row.id, { failure: res?.message ?? 'This clip wasn’t added. Try again.' })
        }
      }
      // Library duplicates the user asked to run again: same attempt row, new results.
      for (const row of rows) {
        const check = checks.get(row.id)
        if (check?.kind !== 'duplicate' || !check.reprocess) continue
        registerClip(check.known.attemptId, row.file)
        jobs.push({ attemptId: check.known.attemptId, movement: check.known.movement, clipName: row.name, trim: check.known.trim ?? null })
        changes.set(row.id, null)
      }
      setRows((list) =>
        list.flatMap((r) => {
          if (!changes.has(r.id)) return [r]
          const change = changes.get(r.id)
          return change ? [{ ...r, ...change }] : []
        }),
      )
    } finally {
      invalidate()
      if (jobs.length > 0) enqueue(jobs)
      setBusy(false)
    }
    // With nothing left to say here, go and watch the queue; otherwise stay and explain.
    if (failed === 0 && jobs.length > 0) navigate({ name: 'processing' })
    else setNotice({ queued: jobs.length, failed })
  }

  const applyToSelected = (change: Partial<Pick<Row, 'subject' | 'movement' | 'view'>>) => {
    setRows((list) => list.map((r) => (r.selected || narrow ? { ...r, ...change } : r)))
  }

  return (
    <>
      <PageHeader
        title="Import clips"
        mobileTitle="Import"
        subtitle="Add several clips at once. Tag each with a subject code, movement and camera view before processing."
        actions={<PrivacyPill />}
      />

      {library.error && <ErrorAlert error={library.error} onRetry={library.refetch} />}

      <SourceStep source={source} onChange={setSource} narrow={narrow} />
      <FileStep onFiles={addFiles} narrow={narrow} />

      {skipped > 0 && (
        <p className="t-caption" role="status">
          {skipped} {skipped === 1 ? 'file in that folder isn’t a video and was' : 'files in that folder aren’t videos and were'} left out.
        </p>
      )}

      {notice && (
        <Alert
          title={
            notice.failed > 0
              ? `${notice.failed} ${notice.failed === 1 ? 'clip was' : 'clips were'} not added.`
              : 'Nothing was added to the queue.'
          }
          actions={
            notice.queued > 0 && (
              <a className="btn btn-secondary btn-sm" href={href({ name: 'processing' })}>
                Go to processing
              </a>
            )
          }
        >
          {notice.queued > 0
            ? `${notice.queued} ${notice.queued === 1 ? 'clip is' : 'clips are'} in the processing queue. The rest is listed below with the reason.`
            : 'The reason is shown next to each clip below.'}
        </Alert>
      )}

      {rows.length === 0 && (
        <NoteBox title="Clips stay on this device.">
          Only a clip label made from the subject code and clip number (never the file name), a fingerprint, the length and the tags are saved to
          your account; the video is read here and never sent.
        </NoteBox>
      )}

      {rows.length > 0 && (
        <>
          {narrow ? (
            <TagCards rows={rows} checks={checks} source={source} patch={patch} remove={remove} onApplyAll={applyToSelected} />
          ) : (
            <TagTable
              rows={rows}
              checks={checks}
              source={source}
              selectedCount={selected.length}
              patch={patch}
              remove={remove}
              onSelectAll={(on) => setRows((list) => list.map((r) => ({ ...r, selected: on })))}
              onApply={applyToSelected}
            />
          )}

          <TakeLinks links={linkedTakes(rows.filter((r) => taggable(checks.get(r.id))))} />

          <SessionStep
            date={sessionDate ?? rows[0].recordedOn}
            fromFiles={sessionDate === null}
            onDate={changeSessionDate}
            note={sessionNote}
            onNote={setSessionNote}
            tooLong={noteTooLong}
            narrow={narrow}
          />

          <div className="card v2-imp-bar">
            <p style={narrow ? { textAlign: 'center' } : { flex: '1 1 300px' }} className={narrow ? 't-caption' : undefined} role="status">
              <span style={{ fontWeight: 600 }}>{counts.ready} ready</span>
              {summaryDetail(counts) && <span className="muted"> · {summaryDetail(counts)}</span>}
            </p>
            {!narrow && (
              <a className="btn btn-ghost" href={href({ name: 'library' })}>
                Cancel
              </a>
            )}
            <button
              className={narrow ? 'btn btn-primary btn-lg btn-block' : 'btn btn-primary'}
              type="button"
              disabled={busy || counts.toQueue === 0 || counts.reading > 0 || !library.data || noteTooLong}
              aria-busy={busy}
              onClick={() => void submit()}
            >
              {busy
                ? 'Adding clips…'
                : narrow
                  ? `Process ${counts.toQueue} ${counts.toQueue === 1 ? 'clip' : 'clips'} on this phone`
                  : `Add ${counts.toQueue} ${counts.toQueue === 1 ? 'clip' : 'clips'} to processing queue`}
            </button>
          </div>
        </>
      )}
    </>
  )
}

// ---------- 1 · Source ----------

function SourceStep({ source, onChange, narrow }: { source: ImportSource; onChange(s: ImportSource): void; narrow: boolean }) {
  const isStudy = source === 'study'
  return (
    <>
      <fieldset
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
          gap: narrow ? 10 : 12,
        }}
      >
        <legend className="t-label" style={{ marginBottom: 10 }}>
          1 · Source
        </legend>
        <label className={isStudy ? 'choice on' : 'choice'} style={narrow ? { padding: 14 } : undefined}>
          <input type="radio" name="v2-imp-src" checked={isStudy} onChange={() => onChange('study')} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 2 : 4 }}>
            <span style={{ fontWeight: 600 }}>Study dataset</span>
            <span className="t-small muted">
              {narrow
                ? 'Local files · never uploaded'
                : 'Local files from the study drive. Processed on this device and never uploaded — this can’t be changed.'}
            </span>
            {!narrow && <PrivacyPill style={{ alignSelf: 'flex-start', marginTop: 6 }}>Never uploaded</PrivacyPill>}
          </span>
        </label>
        <label className={isStudy ? 'choice' : 'choice on'} style={narrow ? { padding: 14 } : undefined}>
          <input type="radio" name="v2-imp-src" checked={!isStudy} onChange={() => onChange('own')} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 2 : 4 }}>
            <span style={{ fontWeight: 600 }}>My own video</span>
            <span className="t-small muted">
              {narrow ? 'Processed here · stays on this phone' : 'Your personal practice footage. Processed on this device, the same way as study clips.'}
            </span>
            {!narrow && (
              <span className="tag" style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                Upload · off
              </span>
            )}
          </span>
        </label>
      </fieldset>

      {isStudy ? (
        narrow && <PrivacyPill style={{ alignSelf: 'flex-start' }}>Study clips can’t be uploaded</PrivacyPill>
      ) : (
        // The optional backup of a personal video is not built: shown, but not operable.
        <label className="card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500 }}>Back up videos to my account</span>
            <span className="t-caption" id="v2-imp-backup-why">
              Off — backup isn’t available in this version. Videos stay on this {narrow ? 'phone' : 'device'}.
            </span>
          </span>
          <input className="switch" type="checkbox" role="switch" checked={false} disabled readOnly aria-describedby="v2-imp-backup-why" style={{ opacity: 0.5, cursor: 'not-allowed' }} />
        </label>
      )}
    </>
  )
}

// ---------- 2 · Files ----------

/**
 * Folder picking (FR-3.2.4). Phones report `webkitdirectory` but their pickers can't
 * choose a folder, so the option is shown on desktop browsers only.
 */
function canPickFolder(): boolean {
  if (typeof document === 'undefined') return false
  const probe = document.createElement('input')
  if (!('webkitdirectory' in probe)) return false
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const touchMac = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(ua) && !touchMac
}

function FileStep({ onFiles, narrow }: { onFiles(files: File[], skipped?: number): void; narrow: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const [folderOk] = useState(canPickFolder)

  // Not in React's attribute types; set on the element itself.
  useEffect(() => {
    const el = folderInput.current
    if (!el) return
    el.setAttribute('webkitdirectory', '')
    el.setAttribute('directory', '')
  }, [folderOk])

  const folderPicker = folderOk && (
    <input
      ref={folderInput}
      type="file"
      multiple
      className="v2-sr"
      tabIndex={-1}
      aria-label="Choose a folder of video clips"
      data-testid="import-folder"
      onChange={(e) => {
        // Only the bare file names are read; the folder path never reaches a row.
        const { videos, skipped } = videoFilesOfFolder([...(e.target.files ?? [])])
        onFiles(videos, skipped)
        e.target.value = ''
      }}
    />
  )
  const folderButton = (size: string) =>
    folderOk && (
      <button className={`btn btn-secondary ${size}`} type="button" onClick={() => folderInput.current?.click()}>
        Choose a folder
      </button>
    )

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setOver(false)
    onFiles([...e.dataTransfer.files])
  }

  const picker = (
    <input
      ref={input}
      type="file"
      accept="video/*"
      multiple
      className="v2-sr"
      tabIndex={-1}
      aria-label="Choose video files"
      data-testid="import-files"
      onChange={(e) => {
        onFiles([...(e.target.files ?? [])])
        // So the same file can be chosen again after it was removed.
        e.target.value = ''
      }}
    />
  )

  if (narrow) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Files">
        {picker}
        {folderPicker}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <button className="btn btn-secondary btn-lg" type="button" onClick={() => input.current?.click()}>
            <Icon name="library" />
            Choose videos
          </button>
          {folderButton('btn-lg')}
          <button className="btn btn-secondary btn-lg" type="button" disabled aria-describedby="v2-imp-record-why">
            <Icon name="camera" />
            Record
          </button>
        </div>
        <p className="t-caption" id="v2-imp-record-why">
          Recording inside the app isn’t available yet. Record with the camera app, then choose the video. Up to 60 s each.
        </p>
      </section>
    )
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="t-label">2 · Files</p>
      <div
        className={over ? 'drop over' : 'drop'}
        style={{ padding: '28px 24px' }}
        role="group"
        aria-label="Add video clips"
        onDragEnter={(e) => {
          e.preventDefault()
          depth.current++
          setOver(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (depth.current === 0) setOver(false)
        }}
        onDrop={onDrop}
      >
        {picker}
        {folderPicker}
        <Icon name="upload" size={28} style={{ color: 'var(--text-2)' }} />
        <p style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontWeight: 600 }}>Drop video clips here</span> <span className="muted">or</span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => input.current?.click()}>
            Choose files
          </button>
          {folderButton('btn-sm')}
        </p>
        <p className="t-caption">
          MP4 or MOV (H.264) · up to 60 s each · file names like <span className="mono">S05_releve_side_01.mp4</span> fill the tags and clip number for you ·{' '}
          <span className="mono">D01_att3_f.mp4</span> (f, s, d) links the cameras of one take
        </p>
      </div>
    </section>
  )
}

// ---------- 4 · Session ----------

interface SessionStepProps {
  date: string
  /** True while the date still comes from the files. */
  fromFiles: boolean
  onDate(day: string | null): void
  note: string
  onNote(note: string): void
  tooLong: boolean
  narrow: boolean
}

/** Session date and optional note (FR-3.2.2). The note is the dancer's own; it is never sent to the AI. */
function SessionStep({ date, fromFiles, onDate, note, onNote, tooLong, narrow }: SessionStepProps) {
  const length = [...note.trim()].length
  return (
    <section className="card" style={{ padding: narrow ? 14 : 16, display: 'flex', flexDirection: 'column', gap: 12 }} aria-labelledby="v2-imp-session-h">
      <h2 className="t-h3" id="v2-imp-session-h">
        4 · Session
      </h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: '0 1 200px' }}>
          <label className="field-label" htmlFor="v2-imp-date">
            Session date
          </label>
          <input
            id="v2-imp-date"
            className="input input-sm"
            type="date"
            value={date}
            max={localDate(Date.now())}
            onChange={(e) => onDate(e.target.value || null)}
            aria-describedby="v2-imp-date-hint"
          />
          <span className="hint" id="v2-imp-date-hint">
            {fromFiles ? 'From the files’ dates on this device.' : 'Used for every clip in this import.'}{' '}
            {!fromFiles && (
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onDate(null)} style={{ padding: '0 4px', height: 'auto' }}>
                Use file dates
              </button>
            )}
          </span>
        </div>
        <div className="field" style={{ flex: '1 1 320px' }}>
          <label className="field-label" htmlFor="v2-imp-note">
            Note <span className="subtle" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            id="v2-imp-note"
            className="input"
            rows={2}
            value={note}
            onChange={(e) => onNote(e.target.value)}
            aria-invalid={tooLong || undefined}
            aria-describedby="v2-imp-note-hint"
            placeholder="e.g. new shoes, tired after class"
            style={{ height: 'auto', minHeight: 64, padding: '10px 12px', resize: 'vertical' }}
          />
          <span className="hint" id="v2-imp-note-hint">
            {tooLong ? (
              <span className="err-msg">
                <Icon name="warning" />
                {length} of {NOTE_MAX_CHARS} characters. Shorten the note to import.
              </span>
            ) : (
              'Saved with the session for you only. Not used by the practice notes or Mika. Don’t write names.'
            )}
          </span>
        </div>
      </div>
    </section>
  )
}

function ClipNumberInput({ row, patch, disabled, width }: { row: Row; patch: TagProps['patch']; disabled?: boolean; width?: number | string }) {
  return (
    <input
      className="input input-sm mono"
      type="number"
      inputMode="numeric"
      min={1}
      max={999}
      step={1}
      aria-label={`Take number for ${row.name}`}
      placeholder="—"
      style={{ width: width ?? 72 }}
      value={row.clipNumber ?? ''}
      disabled={disabled}
      onChange={(e) => patch(row.id, { clipNumber: clipNumberOrNull(e.target.value === '' ? null : Number(e.target.value)) })}
    />
  )
}

// ---------- same take, several cameras ----------

const VIEW_NAME: Record<CameraView, string> = { front: 'Front', side: 'Side', diagonal: 'Diagonal' }

/** Which clips in the list are one take filmed from several cameras (linked in Review and Compare). */
function TakeLinks({ links }: { links: TakeLink[] }) {
  if (links.length === 0) return null
  const repeated = links.filter((l) => l.repeated.length > 0)
  return (
    <NoteBox title="Same take, different cameras" icon="camera">
      <span className="v2-imp-takes" role="list">
        {links.map((l) => (
          <span role="listitem" key={l.key}>
            <span className="mono">{[l.subject, `take ${l.take}`].filter(Boolean).join(' · ')}</span>: {l.views.map((v) => VIEW_NAME[v]).join(' · ')}
          </span>
        ))}
      </span>
      <span className="t-caption">
        In Review and Compare you can switch between these cameras at the same moment. To link other clips, give them the same take number.
      </span>
      {repeated.length > 0 && (
        <span className="t-caption" style={{ display: 'block' }}>
          {repeated.map((l) => `Take ${l.take} has more than one ${l.repeated.map((v) => VIEW_NAME[v].toLowerCase()).join(' and ')} clip`).join('; ')}: only one clip per camera
          is shown when switching. Check the take numbers or camera views.
        </span>
      )}
    </NoteBox>
  )
}

// ---------- 3 · Tags ----------

interface TagProps {
  rows: Row[]
  checks: Map<string, Check>
  source: ImportSource
  patch(id: string, change: Partial<Row>): void
  remove(id: string): void
}

/** Tags only matter for rows that can become a new attempt. */
const taggable = (check: Check | undefined) =>
  check?.kind === 'ready' ||
  check?.kind === 'needs_subject' ||
  check?.kind === 'reading' ||
  check?.kind === 'failed' ||
  check?.kind === 'bad_trim'

/** FR-3.2.7: opens the trim editor; says the range once one is set. */
function TrimButton({ row, open, onToggle, disabled, roomy }: { row: Row; open: boolean; onToggle(): void; disabled?: boolean; roomy?: boolean }) {
  const summary = trimSummary(row)
  return (
    <button
      className={roomy ? 'btn btn-ghost' : 'btn btn-ghost btn-sm'}
      type="button"
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
      title={summary ? `Processes ${summary}` : 'Process only part of this clip'}
    >
      {summary ? <span className="mono" style={{ fontSize: 12 }}>Trim {summary.split(' of ')[0]}</span> : 'Trim'}
      <span className="v2-sr">{` ${row.name}`}</span>
    </button>
  )
}

function SubjectSelect(props: { value: string | null; onChange(v: string | null): void; label: string; source: ImportSource; disabled?: boolean; need?: boolean; width?: number | string }) {
  return (
    <select
      className={props.need ? 'input input-sm v2-imp-need' : 'input input-sm'}
      aria-label={props.label}
      aria-invalid={props.need || undefined}
      style={{ width: props.width ?? 100 }}
      value={props.value ?? ''}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value || null)}
    >
      <option value="">{props.source === 'study' ? 'Choose…' : 'No code'}</option>
      {SUBJECT_CODES.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  )
}

function Thumb({ src, width, height }: { src: string | null; width: number; height: number }) {
  return (
    <div className="thumb v2-imp-thumb" style={{ width, height }}>
      {src && <img src={src} alt="" />}
    </div>
  )
}

/** "Apply to N selected": only the fields that were chosen are changed. */
function BulkApply({ label, source, disabled, onApply }: { label: string; source: ImportSource; disabled: boolean; onApply: TagTableProps['onApply'] }) {
  const [subject, setSubject] = useState('')
  const [movement, setMovement] = useState('')
  const [view, setView] = useState('')
  const nothing = !subject && !movement && !view
  return (
    <>
      <span className="t-small muted">{label}</span>
      <select className="input input-sm" aria-label="Subject for selected" style={{ width: 104 }} value={subject} onChange={(e) => setSubject(e.target.value)}>
        <option value="">Subject…</option>
        {source === 'own' && <option value="none">No code</option>}
        {SUBJECT_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <select className="input input-sm" aria-label="Movement for selected" style={{ width: 150 }} value={movement} onChange={(e) => setMovement(e.target.value)}>
        <option value="">Movement…</option>
        {MOVEMENT_TYPES.map((m) => (
          <option key={m} value={m}>
            {MOVEMENT_CHOICE_LABELS[m]}
          </option>
        ))}
      </select>
      <select className="input input-sm" aria-label="View for selected" style={{ width: 110 }} value={view} onChange={(e) => setView(e.target.value)}>
        <option value="">View…</option>
        {CAMERA_VIEWS.map((v) => (
          <option key={v} value={v}>
            {VIEW_SHORT[v]}
          </option>
        ))}
      </select>
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        disabled={disabled || nothing}
        onClick={() =>
          onApply({
            ...(subject ? { subject: subject === 'none' ? null : subject } : {}),
            ...(movement ? { movement: movement as MovementType } : {}),
            ...(view ? { view: view as CameraView } : {}),
          })
        }
      >
        Apply
      </button>
    </>
  )
}

interface TagTableProps extends TagProps {
  selectedCount: number
  onSelectAll(on: boolean): void
  onApply(change: Partial<Pick<Row, 'subject' | 'movement' | 'view'>>): void
}

function TagTable({ rows, checks, source, selectedCount, patch, remove, onSelectAll, onApply }: TagTableProps) {
  const all = useRef<HTMLInputElement>(null)
  const [trimOpen, setTrimOpen] = useState<string | null>(null)
  useEffect(() => {
    if (all.current) all.current.indeterminate = selectedCount > 0 && selectedCount < rows.length
  }, [selectedCount, rows.length])

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }} aria-labelledby="v2-imp-h">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <h2 className="t-h3" id="v2-imp-h" style={{ flex: '1 1 200px' }}>
          3 · Tag {rows.length} {rows.length === 1 ? 'clip' : 'clips'}
        </h2>
        <BulkApply label={`Apply to ${selectedCount} selected`} source={source} disabled={selectedCount === 0} onApply={onApply} />
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col" style={{ width: 36 }}>
                <input
                  ref={all}
                  type="checkbox"
                  aria-label="Select all"
                  checked={selectedCount === rows.length}
                  onChange={(e) => onSelectAll(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
              </th>
              <th scope="col">File</th>
              <th scope="col">Length</th>
              <th scope="col" title="Clips with the same take number, subject and movement from different cameras are one take">
                Take no.
              </th>
              <th scope="col">Subject</th>
              <th scope="col">Movement</th>
              <th scope="col">Camera view</th>
              <th scope="col">Check</th>
              <th scope="col">
                <span className="v2-sr">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const check = checks.get(row.id)
              const dup = check?.kind === 'duplicate' || check?.kind === 'duplicate_in_list'
              const editable = taggable(check)
              const trimming = trimOpen === row.id && editable
              return (
                <Fragment key={row.id}>
                <tr className={dup ? 'v2-imp-dup' : undefined} data-check={check?.kind}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.selected}
                      aria-label={`Select ${row.name}`}
                      onChange={(e) => patch(row.id, { selected: e.target.checked })}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                      <Thumb src={row.thumb} width={48} height={28} />
                      <span className="mono v2-clip" style={{ fontSize: 12, maxWidth: 260 }} title={row.name}>
                        {row.name}
                      </span>
                    </div>
                  </td>
                  <td className="mono subtle" style={{ fontSize: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                      {formatLength(row.durationS)}
                      {editable && (
                        <TrimButton row={row} open={trimming} disabled={row.durationS === null} onToggle={() => setTrimOpen(trimming ? null : row.id)} />
                      )}
                    </div>
                  </td>
                  <td>
                    <ClipNumberInput row={row} patch={patch} disabled={!editable} />
                  </td>
                  <td>
                    <SubjectSelect
                      value={row.subject}
                      label={`Subject for ${row.name}`}
                      source={source}
                      disabled={!editable}
                      need={check?.kind === 'needs_subject'}
                      onChange={(subject) => patch(row.id, { subject })}
                    />
                  </td>
                  <td>
                    <select
                      className="input input-sm"
                      aria-label={`Movement for ${row.name}`}
                      style={{ width: 150 }}
                      value={row.movement}
                      disabled={!editable}
                      onChange={(e) => patch(row.id, { movement: e.target.value as MovementType })}
                    >
                      {MOVEMENT_TYPES.map((m) => (
                        <option key={m} value={m}>
                          {MOVEMENT_CHOICE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="input input-sm"
                      aria-label={`Camera view for ${row.name}`}
                      style={{ width: 110 }}
                      value={row.view}
                      disabled={!editable}
                      onChange={(e) => patch(row.id, { view: e.target.value as CameraView })}
                    >
                      {CAMERA_VIEWS.map((v) => (
                        <option key={v} value={v}>
                          {VIEW_SHORT[v]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ minWidth: 240 }}>
                    <CheckCell row={row} check={check} patch={patch} remove={remove} />
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Remove ${row.name}`} onClick={() => remove(row.id)}>
                      <Icon name="close" />
                    </button>
                  </td>
                </tr>
                {trimming && (
                  <tr>
                    <td colSpan={9}>
                      <TrimEditor
                        file={row.file}
                        name={row.name}
                        durationS={row.durationS}
                        value={{ trimStart: row.trimStart ?? null, trimEnd: row.trimEnd ?? null }}
                        onChange={(v) => patch(row.id, v)}
                        onClose={() => setTrimOpen(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(v: T): void }) {
  return (
    <div className="seg" role="group" aria-label={label} style={{ width: '100%' }}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          className={key === value ? 'on' : undefined}
          aria-pressed={key === value}
          style={{ flex: 1, justifyContent: 'center', height: 38 }}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

function TagCards({ rows, checks, source, patch, remove, onApplyAll }: TagProps & { onApplyAll: TagTableProps['onApply'] }) {
  const [trimOpen, setTrimOpen] = useState<string | null>(null)
  return (
    <>
      <p className="t-label">
        {rows.length} selected
      </p>
      {rows.length > 1 && (
        <section className="card" style={{ padding: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }} aria-label="Tag all clips">
          <BulkApply label={`Apply to all ${rows.length}`} source={source} disabled={false} onApply={onApplyAll} />
        </section>
      )}
      {rows.map((row) => {
        const check = checks.get(row.id)
        const dup = check?.kind === 'duplicate' || check?.kind === 'duplicate_in_list'
        return (
          <article
            key={row.id}
            className="card"
            data-check={check?.kind}
            style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, borderStyle: dup ? 'dashed' : undefined }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Thumb src={row.thumb} width={64} height={40} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span className="mono v2-clip" style={{ fontSize: 12 }}>
                  {row.name}
                </span>
                <span className="t-caption">
                  {formatLength(row.durationS)}
                  {row.height ? ` · ${row.height}p` : ''}
                </span>
              </div>
              <button className="btn btn-ghost btn-icon btn-lg" type="button" aria-label={`Remove ${row.name}`} onClick={() => remove(row.id)}>
                <Icon name="close" />
              </button>
            </div>
            {taggable(check) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <SubjectSelect
                      value={row.subject}
                      label={`Subject for ${row.name}`}
                      source={source}
                      need={check?.kind === 'needs_subject'}
                      width="100%"
                      onChange={(subject) => patch(row.id, { subject })}
                    />
                  </div>
                  <ClipNumberInput row={row} patch={patch} width={88} />
                </div>
                <Seg
                  label={`Movement for ${row.name}`}
                  value={row.movement}
                  options={MOVEMENT_TYPES.map((m) => [m, MOVEMENT_SHORT[m]] as const)}
                  onChange={(movement) => patch(row.id, { movement })}
                />
                <Seg
                  label={`Camera view for ${row.name}`}
                  value={row.view}
                  options={CAMERA_VIEWS.map((v) => [v, VIEW_SHORT[v]] as const)}
                  onChange={(view) => patch(row.id, { view })}
                />
                <TrimButton
                  row={row}
                  roomy
                  open={trimOpen === row.id}
                  disabled={row.durationS === null}
                  onToggle={() => setTrimOpen(trimOpen === row.id ? null : row.id)}
                />
                {trimOpen === row.id && (
                  <TrimEditor
                    file={row.file}
                    name={row.name}
                    durationS={row.durationS}
                    value={{ trimStart: row.trimStart ?? null, trimEnd: row.trimEnd ?? null }}
                    onChange={(v) => patch(row.id, v)}
                    onClose={() => setTrimOpen(null)}
                  />
                )}
              </div>
            )}
            <CheckCell row={row} check={check} patch={patch} remove={remove} roomy />
          </article>
        )
      })}
    </>
  )
}

// ---------- the check column ----------

function Problem({ icon, title, children, actions }: { icon: 'warning' | 'copy'; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="err-msg">
        <Icon name={icon} />
        {title}
      </span>
      {children && <span className="t-caption">{children}</span>}
      {actions && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  )
}

function CheckCell({ row, check, patch, remove, roomy }: { row: Row; check: Check | undefined; patch: TagProps['patch']; remove: TagProps['remove']; roomy?: boolean }) {
  const btn = (kind: 'secondary' | 'ghost') => (roomy ? `btn btn-${kind}` : `btn btn-${kind} btn-sm`)
  const grow = roomy ? { flex: 1, height: 44 } : undefined
  if (!check || check.kind === 'reading') return <StatusPill status="processing" label="Reading file…" />
  switch (check.kind) {
    case 'ready':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <StatusPill status="done" label="Ready" />
          {check.tooLong && <span className="t-caption">Longer than 60 s. It will still be processed; that takes about as long as the clip.</span>}
        </div>
      )
    case 'needs_subject':
      return <Problem icon="warning" title="Choose a subject code" />
    case 'bad_trim':
      return (
        <Problem icon="warning" title="Check the trim">
          {check.message}
        </Problem>
      )
    case 'empty':
      return (
        <Problem icon="warning" title="This file is empty">
          It has no video in it, so nothing will be created for it.
        </Problem>
      )
    case 'unreadable':
      return (
        <Problem icon="warning" title="Can’t be read as video">
          {check.message}
        </Problem>
      )
    case 'failed':
      return (
        <Problem
          icon="warning"
          title="Not added"
          actions={
            <button className={btn('secondary')} style={grow} type="button" onClick={() => patch(row.id, { failure: null })}>
              Try again
            </button>
          }
        >
          {check.message}
        </Problem>
      )
    case 'duplicate_in_list':
      return (
        <Problem icon="copy" title="Listed twice">
          Same file as <span className="mono">{check.of}</span> above (same fingerprint). Only the first one is imported.
        </Problem>
      )
    case 'duplicate': {
      const earlier = [check.known.subjectCode, MOVEMENT_LABELS[check.known.movement]].filter(Boolean).join(' · ')
      if (check.reprocess) {
        return (
          <Problem
            icon="copy"
            title="Will be processed again"
            actions={
              <button className={btn('ghost')} style={grow} type="button" onClick={() => patch(row.id, { reprocess: false })}>
                Undo
              </button>
            }
          >
            The earlier import ({earlier}) keeps its tags; its saved keypoints and measurements are replaced.
          </Problem>
        )
      }
      return (
        <Problem
          icon="copy"
          title="Already in your library"
          actions={
            <>
              <button className={btn('secondary')} style={grow} type="button" onClick={() => remove(row.id)}>
                Skip
              </button>
              <button className={btn('ghost')} style={grow} type="button" onClick={() => patch(row.id, { reprocess: true })}>
                Process it again
              </button>
            </>
          }
        >
          Same fingerprint as a clip imported {formatDate(check.known.importedAt)} ({earlier}). The library keeps one copy of a file, so it can’t be
          added a second time.
        </Problem>
      )
    }
  }
}
