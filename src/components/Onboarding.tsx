// Three cards the first time someone opens a session: what the numbers are,
// what gaps mean, and that comparisons are with their own attempts.

import { useState } from 'react'
import { track } from '../study/log'
import { Dialog } from './ui'

const KEY = 'dad-onboarded-v1'

/** Show the cards again, e.g. for the next study participant. */
export function resetOnboarding() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored
  }
}

export function seenOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // shown again next time; harmless
  }
}

const CARDS = [
  {
    title: 'Measurements describe, they don’t judge',
    body: 'Each measurement answers one question, like “Are my knees staying over my toes?”. The numbers describe your movement. There are no scores and no right answer on screen; you and your teacher decide what matters.',
    art: (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <path d="M6 50 C 30 48, 40 20, 62 24 S 96 52, 118 36 S 146 18, 154 22" className="ob-line" />
        <line x1="88" y1="6" x2="88" y2="64" className="ob-playhead" />
        <rect x="70" y="8" width="38" height="16" rx="5" className="ob-chip" />
        <text x="89" y="19" textAnchor="middle" className="ob-text">6.2%</text>
      </svg>
    ),
  },
  {
    title: 'Gaps are honest',
    body: 'When the camera loses you, the line stops instead of guessing. Hatching means tracking was unsure there, so read those values with care. If a summary can’t be calculated, it says why.',
    art: (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <path d="M6 40 C 24 36, 36 30, 56 34" className="ob-line" />
        <rect x="60" y="10" width="34" height="50" fill="url(#hatch-missing)" rx="4" />
        <path d="M98 30 C 116 26, 132 38, 154 34" className="ob-line" />
      </svg>
    ),
  },
  {
    title: 'Compare yourself with yourself',
    body: 'Pick any two of your attempts as A and B. Phases line up automatically, so a slow rise still matches a quick one. Press M to mark a moment, and Ctrl+K to find any action.',
    art: (
      <svg viewBox="0 0 160 70" aria-hidden="true">
        <path d="M6 46 C 30 44, 46 20, 70 22 S 120 40, 154 30" className="ob-line ob-a" />
        <path d="M6 50 C 34 50, 50 30, 74 32 S 124 46, 154 40" className="ob-line ob-b" />
      </svg>
    ),
  },
]

export function Onboarding({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0)
  const done = () => {
    markSeen()
    track('onboarding.closed', { step: i + 1 })
    setI(0)
    onClose()
  }
  const card = CARDS[i]
  return (
    <Dialog open={open} onClose={done} title="How to read this">
      <div className="onboarding">
        <div className="ob-art">{card.art}</div>
        <h3>{card.title}</h3>
        <p>{card.body}</p>
        <div className="ob-foot">
          <div className="ob-dots" aria-label={`Step ${i + 1} of ${CARDS.length}`}>
            {CARDS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}
          </div>
          {i < CARDS.length - 1 ? (
            <div className="seg">
              <button className="btn" onClick={done}>Skip</button>
              <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next</button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={done}>Start reviewing</button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
