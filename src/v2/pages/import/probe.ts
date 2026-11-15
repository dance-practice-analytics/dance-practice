// Local reads of a picked file: header (length, size), SHA-256 fingerprint and a
// thumbnail drawn into a canvas. Nothing here talks to a server; the thumbnail is a
// data: URL that only ever goes into an <img> on this page.

import { useEffect, useState } from 'react'
import { ApiError } from '../../../api/errors'
import { readVideoMeta, sha256Hex, type VideoMeta } from '../../../data/clipFile'

// One file at a time: phones run out of video decoders quickly.
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

const thumbs = new WeakMap<File, Promise<string | null>>()

function drawThumb(file: File, timeoutMs = 10_000): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.onloadeddata = video.onseeked = video.onerror = null
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        // Nothing to release.
      }
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    const draw = () => {
      try {
        const w = 160
        const h = Math.max(1, Math.round((w * video.videoHeight) / Math.max(1, video.videoWidth)))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')?.drawImage(video, 0, 0, w, h)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        finish(null)
      }
    }
    video.onloadeddata = () => {
      // A little way in: the first frame is often black.
      const t = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0
      if (t <= 0) return draw()
      video.onseeked = draw
      video.currentTime = t
    }
    video.onerror = () => finish(null)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
  })
}

/** A small still of the clip, or null when the browser can't decode it. Cached per File. */
export function grabThumb(file: File): Promise<string | null> {
  let hit = thumbs.get(file)
  if (!hit) {
    hit = serial(() => drawThumb(file))
    thumbs.set(file, hit)
  }
  return hit
}

export function useThumb(file: File | null | undefined): string | null {
  const [state, setState] = useState<{ file: File; url: string | null } | null>(null)
  useEffect(() => {
    if (!file) return
    let live = true
    void grabThumb(file).then((url) => live && setState({ file, url }))
    return () => {
      live = false
    }
  }, [file])
  return file && state?.file === file ? state.url : null
}

export type ProbeResult =
  | { ok: true; meta: VideoMeta; sha: string; thumb: string | null }
  | { ok: false; message: string }

/** Header, fingerprint and thumbnail of one file. Never rejects. */
export function probeFile(file: File): Promise<ProbeResult> {
  return serial(async (): Promise<ProbeResult> => {
    if (file.size === 0) return { ok: false, message: 'This file is empty.' }
    try {
      const meta = await readVideoMeta(file)
      const sha = await sha256Hex(file)
      // Drawn here (not through grabThumb): this already runs inside the serial queue.
      const thumb = await drawThumb(file)
      thumbs.set(file, Promise.resolve(thumb))
      return { ok: true, meta, sha, thumb }
    } catch (e) {
      const message =
        e instanceof ApiError ? [e.message, e.recovery].filter(Boolean).join(' ') : 'This file couldn’t be read on this device.'
      return { ok: false, message }
    }
  })
}
