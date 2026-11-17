// Screen 11 — Mika, the AI practice assistant (named after the domain mentor).
// Design: Chat.dc.html, ChatMobile.dc.html.
// Questions go to the Edge Function mika-chat (supabase/functions/mika-chat), which loads
// the attempt's metrics under the dancer's RLS and asks the configured model (Gemini or
// Grok); only metric values ever
// reach the model. Before the function is deployed (404) or while it has no API key, the
// screen keeps the honest "not connected" state and nothing can be sent.

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AI_CONSENT_SCOPE } from '../../feedback/client'
import { client } from '../auth'
import { Alert, ConfBadge, EmptyState, ErrorAlert, Icon, NoteBox, PageHeader, SkeletonList, Spinner } from '../components'
import { useConsents } from '../consents'
import { latestProcessed, useAttempts, type AttemptView } from '../data'
import { formatDate, MOVEMENT_LABELS, VIEW_LABELS } from '../format'
import { href, navigate, useRoute } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { useFocusThemes } from '../focus'
import { chatContext, previousAttempt, suggestedQuestions, type ChatContext, type ChatScope } from './chat/model'
import { askMika, isNotConnected, MAX_QUESTION_CHARS, MikaError, mikaStatus, type ChatMessage } from './chat/mikaClient'
import { AttemptPicker } from './notes/AttemptPicker'
import { attemptDay, attemptLine, attemptTitle } from './notes/model'
import './chat/chat.css'

const NOT_CONNECTED_ID = 'chat-not-connected'
const AI_OFF_ID = 'chat-ai-off'
const CHECKING_ID = 'chat-checking'

// ---------- is Mika connected? ----------

/** 'unknown': the check itself failed (offline, busy); sending is allowed and errors show. */
type Connection = 'checking' | 'ready' | 'not_connected' | 'unknown'

/** Known for the rest of the page load once the function has answered. */
let knownConnection: 'ready' | 'not_connected' | null = null

function useConnection(): [Connection, () => void] {
  const [state, setState] = useState<Connection>(knownConnection ?? 'checking')
  useEffect(() => {
    if (knownConnection) return
    let live = true
    mikaStatus(client())
      .then((ready) => {
        knownConnection = ready ? 'ready' : 'not_connected'
        if (live) setState(knownConnection)
      })
      .catch((e: unknown) => {
        if (isNotConnected(e)) knownConnection = 'not_connected'
        if (live) setState(knownConnection ?? 'unknown')
      })
    return () => {
      live = false
    }
  }, [])
  const markNotConnected = () => {
    knownConnection = 'not_connected'
    setState('not_connected')
  }
  return [state, markNotConnected]
}

export function Chat() {
  const route = useRoute()
  const attempts = useAttempts()
  const narrow = useIsNarrow()
  const consents = useConsents()
  const [connection, markNotConnected] = useConnection()
  const [scope, setScope] = useState<ChatScope>('attempt')
  // Phrase attempts: the dancer's focus themes go along with a question (and order the rows).
  const focus = useFocusThemes().themes
  const routeId = route.name === 'chat' ? route.attemptId : undefined

  const all = attempts.data
  const attempt = useMemo(
    () => (routeId ? (all?.find((a) => a.id === routeId) ?? null) : latestProcessed(all)),
    [all, routeId],
  )
  const context = useMemo(() => (attempt && all ? chatContext(attempt, all, scope, focus) : null), [attempt, all, scope, focus])
  const questions = useMemo(() => (attempt && all ? suggestedQuestions(attempt, all, focus) : []), [attempt, all, focus])
  const compareId = useMemo(() => (attempt && all ? (previousAttempt(attempt, all)?.id ?? null) : null), [attempt, all])
  const pick = (attemptId: string) => navigate({ name: 'chat', attemptId })

  if (attempts.loading || !all) {
    return (
      <>
        <PageHeader title="Mika" />
        {attempts.error ? <ErrorAlert error={attempts.error} onRetry={attempts.refetch} /> : <SkeletonList label="Loading Mika" />}
      </>
    )
  }

  if (!attempt || !context) {
    const missing = Boolean(routeId)
    return (
      <>
        <PageHeader title="Mika" subtitle="Your AI practice assistant. Questions about one attempt, answered from its metrics only." />
        {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}
        {missing && latestProcessed(all) && <AttemptPicker id="chat-attempt" attempts={all} value={null} onChange={pick} />}
        <EmptyState
          icon="chat"
          title={missing ? 'That attempt is no longer here' : 'No attempt to ask about yet'}
          action={
            <a className="btn btn-secondary" href={href({ name: 'library' })}>
              Open library
            </a>
          }
        >
          {missing
            ? 'It may have been deleted, or it belongs to another account. Pick another attempt.'
            : 'Pick a processed attempt first. Only its metric values would be shared — never video, images or keypoints.'}
        </EmptyState>
      </>
    )
  }

  const reviewHref = href({ name: 'review', attemptId: attempt.id })
  const metricsTag = <span className="tag">Metrics only</span>
  // Consent still loading: wait. A failed consent load: let the function decide (it checks too).
  const aiAllowed = consents.status === 'ready' ? consents.has(AI_CONSENT_SCOPE) : consents.status === 'error'
  const live = connection !== 'not_connected'
  const conversation = (
    <Conversation
      key={attempt.id}
      attempt={attempt}
      // The phone has no scope switch: it always asks about this attempt.
      scope={narrow ? 'attempt' : scope}
      compareAttemptId={compareId}
      questions={questions}
      narrow={narrow}
      connection={connection}
      aiAllowed={aiAllowed}
      consentsLoading={consents.status === 'loading'}
      onNotConnected={markNotConnected}
    />
  )

  return (
    <>
      <PageHeader
        title="Mika"
        eyebrow={narrow ? attemptLine(attempt) : undefined}
        subtitle="Your AI practice assistant. Questions about one attempt, answered from its metrics only."
        backHref={reviewHref}
        mobileActions={metricsTag}
      />
      {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}

      {narrow ? (
        <>
          <MobileContext context={chatContext(attempt, all, 'attempt', focus)} live={live} />
          <AttemptPicker id="chat-attempt" attempts={all} value={attempt.id} onChange={pick} label="Asking about" />
          {conversation}
        </>
      ) : (
        <div className="v2-chat-cols">
          <ContextPanel
            attempt={attempt}
            all={all}
            context={context}
            scope={scope}
            setScope={setScope}
            onPick={pick}
            reviewHref={reviewHref}
            live={live}
          />
          {conversation}
        </div>
      )}
    </>
  )
}

interface ContextPanelProps {
  attempt: AttemptView
  all: readonly AttemptView[]
  context: ChatContext
  scope: ChatScope
  setScope(s: ChatScope): void
  onPick(attemptId: string): void
  reviewHref: string
  /** False when Mika isn't connected: nothing can be shared. */
  live: boolean
}

/** What the AI sees — and what it never would. */
function ContextPanel({ attempt, all, context, scope, setScope, onPick, reviewHref, live }: ContextPanelProps) {
  const consents = useConsents()
  const s = attempt.session
  return (
    <aside className="v2-chat-aside" aria-labelledby="chat-ctx-h">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p className="t-label">Asking about</p>
        <h2 className="t-h2" id="chat-ctx-h">
          {attemptTitle(attempt)} · {MOVEMENT_LABELS[s.movement_type]}
        </h2>
        <p className="t-small muted">
          {s.title ? `${s.title} · ` : ''}
          {formatDate(attemptDay(attempt))}
          {s.camera_view ? ` · ${VIEW_LABELS[s.camera_view].toLowerCase()}` : ''} · <a href={reviewHref}>Open in review</a>
        </p>
      </div>
      <AttemptPicker id="chat-attempt" attempts={all} value={attempt.id} onChange={onPick} />
      <div className="seg" role="radiogroup" aria-label="Scope of metrics shared" style={{ width: '100%' }}>
        {(['attempt', 'session'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={scope === v}
            className={scope === v ? 'on' : undefined}
            onClick={() => setScope(v)}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {v === 'attempt' ? 'This attempt' : 'This session'}
          </button>
        ))}
      </div>
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="chat-shared-h">
        <h2 className="t-h3" id="chat-shared-h">
          {live ? 'What is shared with Mika' : 'What would be shared with the AI'}
        </h2>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {context.rows.map((m) => (
            <li key={m.key} className="v2-chat-row">
              <span className="t-small" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                <span className="subtle num" style={m.subdued ? { color: 'var(--text-3)' } : undefined}>
                  {m.value}
                </span>
              </span>
              <ConfBadge level={m.confidence} />
            </li>
          ))}
        </ul>
        {context.phrase && <PhraseShared phrase={context.phrase} />}
        <p className="t-caption">
          {context.note}{' '}
          {live ? 'Sent only with a question, as numbers.' : 'Nothing is shared now: the assistant isn’t connected.'}
        </p>
      </section>
      <section className="well" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 className="t-small" style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="device" size={16} />
          Never shared
        </h2>
        <p className="t-small muted">
          Video, images, keypoints, your notes, session titles, file names, your name or email. Mika can’t see you dance — only the numbers above.
        </p>
      </section>
      {consents.status === 'ready' && !consents.has(AI_CONSENT_SCOPE) && (
        <p className="t-caption">
          AI features are turned off for your account. You can allow “AI practice notes (metrics only)” in{' '}
          <a href={href({ name: 'settings' })}>Settings</a>.
        </p>
      )}
    </aside>
  )
}

/** Phrase: the event summary, earlier sessions and focus themes that go along with a question. */
function PhraseShared({ phrase }: { phrase: NonNullable<ChatContext['phrase']> }) {
  return (
    <ul className="t-small" style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--line)', paddingTop: 10 }} aria-label="Also shared for this phrase">
      <li>{phrase.events}</li>
      <li>
        <span style={{ fontWeight: 500 }}>Progress:</span> {phrase.progress}
      </li>
      <li>
        <span style={{ fontWeight: 500 }}>Focus:</span> {phrase.focus}
      </li>
    </ul>
  )
}

/** The phone's collapsible "N metrics shared" strip under the header. */
function MobileContext({ context, live }: { context: ChatContext; live: boolean }) {
  const [open, setOpen] = useState(false)
  const n = context.valueCount
  return (
    <>
      <button type="button" className="v2-chat-ctx" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="chat-ctx-body">
        <Icon name="device" size={16} />
        <span className="t-small" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>
            {n} {context.phrase ? (n === 1 ? 'theme' : 'themes') : n === 1 ? 'metric' : 'metrics'} {live ? 'shared with a question' : 'would be shared'}
          </span>{' '}
          · never video
        </span>
        <Icon name="chevron-down" size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="v2-chat-ctx-body" id="chat-ctx-body">
          {context.rows.map((m) => (
            <div key={m.key} className="v2-chat-row">
              <span className="t-small" style={{ minWidth: 0 }}>
                {m.label} <span className="num subtle">{m.value}</span>
              </span>
              <ConfBadge level={m.confidence} />
            </div>
          ))}
          {context.phrase && <PhraseShared phrase={context.phrase} />}
          <p className="t-caption">
            Never shared: video, images, keypoints, name or email. {live ? 'Values are sent only with a question.' : 'Nothing is shared now.'}
          </p>
        </div>
      )}
    </>
  )
}

interface ConversationProps {
  attempt: AttemptView
  scope: ChatScope
  /** The attempt before this one in its session, sent so Mika can describe change. */
  compareAttemptId: string | null
  questions: readonly string[]
  narrow?: boolean
  connection: Connection
  aiAllowed: boolean
  consentsLoading: boolean
  onNotConnected(): void
}

interface Turn extends ChatMessage {
  id: number
}

function Conversation({ attempt, scope, compareAttemptId, questions, narrow, connection, aiAllowed, consentsLoading, onNotConnected }: ConversationProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MikaError | null>(null)
  const seq = useRef(0)
  const nextId = useRef(1)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [turns, pending, error])

  // Why sending is off, if it is (described by the matching note in the log).
  const blockedBy =
    connection === 'not_connected' ? NOT_CONNECTED_ID : connection === 'checking' ? CHECKING_ID : !aiAllowed ? AI_OFF_ID : null
  const tooLong = draft.trim().length > MAX_QUESTION_CHARS
  const canAsk = blockedBy === null && !pending

  const send = async (text: string) => {
    const question = text.trim()
    if (!canAsk || question.length === 0 || question.length > MAX_QUESTION_CHARS) return
    const mine = ++seq.current
    const asked: Turn = { id: nextId.current++, role: 'user', content: question }
    const history = [...turns, asked]
    setTurns(history)
    setDraft('')
    setError(null)
    setPending(true)
    try {
      const reply = await askMika(client(), {
        attemptId: attempt.id,
        compareAttemptId: scope === 'attempt' ? compareAttemptId : null,
        scope,
        messages: history.map(({ role, content }) => ({ role, content })),
      })
      if (mine !== seq.current) return
      setTurns((t) => [...t, { id: nextId.current++, role: 'assistant', content: reply }])
    } catch (e) {
      if (mine !== seq.current) return
      // The question goes back in the box, so nothing typed is lost.
      setTurns((t) => t.filter((x) => x.id !== asked.id))
      setDraft(question)
      if (isNotConnected(e)) onNotConnected()
      else setError(e instanceof MikaError ? e : new MikaError(0, 'internal', 'Something went wrong while asking Mika.', 'Try again in a moment.'))
    } finally {
      if (mine === seq.current) setPending(false)
    }
  }

  const reset = () => {
    seq.current++
    setTurns([])
    setPending(false)
    setError(null)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(draft)
    }
  }

  const describedBy = blockedBy ?? undefined
  const inputProps = {
    id: 'chat-in',
    className: 'input',
    placeholder: 'Ask about your measurements…',
    value: draft,
    maxLength: MAX_QUESTION_CHARS + 200,
    disabled: blockedBy !== null,
    'aria-describedby': describedBy ?? (tooLong ? 'chat-too-long' : undefined),
    'aria-invalid': tooLong || undefined,
  }
  const sendDisabled = !canAsk || draft.trim().length === 0 || tooLong
  const empty = turns.length === 0 && !pending

  return (
    <section className="card v2-chat-card" aria-labelledby="chat-h" aria-busy={pending}>
      {!narrow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <h2 className="t-h3" id="chat-h" style={{ flex: 1 }}>
            Ask Mika
          </h2>
          <span className="tag">Metrics only</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={reset} disabled={turns.length === 0 && !pending && !error}>
            New conversation
          </button>
        </div>
      )}
      {narrow && (
        <h2 className="v2-sr" id="chat-h">
          Conversation
        </h2>
      )}

      <div className="v2-chat-log" role="log" aria-label="Conversation" ref={logRef}>
        {empty && (
          <div className="v2-chat-intro" style={{ padding: narrow ? '16px 0' : '40px 0' }}>
            <div className="well" style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16 }}>
              <Icon name="mika" size={24} />
            </div>
            <h3 className="t-h3">Ask about this attempt’s measurements</h3>
            <p className="t-small muted">
              Answers describe your metrics and say which ones they used. Mika won’t grade your technique or give medical advice.
            </p>
            <BlockedNote blockedBy={blockedBy} attemptId={attempt.id} consentsLoading={consentsLoading} />
          </div>
        )}

        {turns.map((t) =>
          t.role === 'user' ? (
            <div key={t.id} className="v2-chat-msg v2-chat-msg-user">
              <span className="v2-sr">You asked: </span>
              {t.content}
            </div>
          ) : (
            <div key={t.id} className="v2-chat-msg v2-chat-msg-mika">
              <span className="v2-chat-who" aria-hidden="true">
                Mika
              </span>
              <span className="v2-sr">Mika answered: </span>
              {t.content}
            </div>
          ),
        )}

        {pending && (
          <div className="v2-chat-msg v2-chat-msg-mika v2-chat-typing" role="status">
            <Spinner />
            Mika is writing…
          </div>
        )}

        {error && (
          <Alert
            title={error.message}
            actions={
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void send(draft)} disabled={!canAsk || !draft.trim()}>
                Send again
              </button>
            }
          >
            {error.recovery} Your question is back in the box.
          </Alert>
        )}

        {!empty && blockedBy && <BlockedNote blockedBy={blockedBy} attemptId={attempt.id} consentsLoading={consentsLoading} />}
      </div>

      <form className="v2-chat-composer" onSubmit={submit}>
        {turns.length === 0 && (
          <div className="v2-chat-chips" role="group" aria-label="Suggested questions">
            {questions.map((q) => (
              <button key={q} className="chip" type="button" disabled={!canAsk} aria-describedby={describedBy} onClick={() => void send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label htmlFor="chat-in" className="v2-sr">
            Ask a question about your measurements
          </label>
          {narrow ? (
            <input {...inputProps} style={{ height: 48, flex: 1 }} enterKeyHint="send" onChange={(e) => setDraft(e.target.value)} />
          ) : (
            <textarea
              {...inputProps}
              rows={2}
              style={{ height: 'auto', minHeight: 48, padding: 12, resize: 'none', flex: 1 }}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
          )}
          {narrow ? (
            <button className="btn btn-primary btn-icon btn-lg" type="submit" aria-label="Send" disabled={sendDisabled} aria-describedby={describedBy}>
              {pending ? <Spinner size={18} /> : <Icon name="arrow-right" style={{ width: 18, height: 18 }} />}
            </button>
          ) : (
            <button className="btn btn-primary" type="submit" style={{ height: 48 }} disabled={sendDisabled} aria-describedby={describedBy}>
              {pending ? <Spinner /> : null}
              Send
            </button>
          )}
        </div>
        {tooLong && (
          <p className="t-caption" id="chat-too-long" role="status">
            Questions can be up to {MAX_QUESTION_CHARS} characters. This one has {draft.trim().length}.
          </p>
        )}
        {narrow ? (
          <p className="t-caption" style={{ textAlign: 'center' }}>
            Not medical advice · metrics only{connection === 'not_connected' ? ' · Mika isn’t connected' : ''}
          </p>
        ) : (
          <p className="disclaimer">
            <Icon name="info" />
            Not medical advice. Answers use your metrics only and can be wrong.
            {connection === 'not_connected' ? ' Sending is off: Mika isn’t connected.' : ' Enter sends, Shift+Enter adds a line.'}
          </p>
        )}
      </form>
    </section>
  )
}

/** Why the composer is off: not connected, still checking, or AI turned off in Settings. */
function BlockedNote({ blockedBy, attemptId, consentsLoading }: { blockedBy: string | null; attemptId: string; consentsLoading: boolean }) {
  if (blockedBy === NOT_CONNECTED_ID) {
    return (
      <div id={NOT_CONNECTED_ID} className="v2-chat-note">
        <NoteBox title="Mika isn’t connected yet.">
          The AI service hasn’t been set up for this app, so questions can’t be sent and nothing is shared. Practice notes, review and compare use
          the same measurements. <a href={href({ name: 'notes', attemptId })}>Open practice notes for this attempt</a>
        </NoteBox>
      </div>
    )
  }
  if (blockedBy === CHECKING_ID || (blockedBy === AI_OFF_ID && consentsLoading)) {
    return (
      <p className="t-caption" id={blockedBy} role="status" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Spinner /> Checking whether Mika is available…
      </p>
    )
  }
  if (blockedBy === AI_OFF_ID) {
    return (
      <div id={AI_OFF_ID} className="v2-chat-note">
        <NoteBox title="AI features are turned off for your account.">
          Mika needs “AI practice notes (metrics only)”, which you can allow in <a href={href({ name: 'settings' })}>Settings</a>. Only metric
          values are ever shared.
        </NoteBox>
      </div>
    )
  }
  return null
}
