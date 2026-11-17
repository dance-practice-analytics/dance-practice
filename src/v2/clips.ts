// Videos picked in this tab, by attempt. Unless the user turned on backup at Import
// (videoBackup.ts), the file only exists here: after a reload the registry is empty
// while keypoints and metrics are still in Supabase, and the user re-picks the file
// (`relink`) to see the video. Nothing in this module talks to a server.

import { useSyncExternalStore } from 'react'
import { sha256Hex } from '../data/clipFile'

export interface ClipEntry {
  file: File
  /** blob: URL for `<video src>`; revoked when the clip is released. */
  objectUrl: string
}

const clips = new Map<string, ClipEntry>()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Remembers the local file of an attempt. Replaces (and revokes) an earlier one. */
export function registerClip(attemptId: string, file: File): ClipEntry {
  const before = clips.get(attemptId)
  if (before?.file === file) return before
  if (before) URL.revokeObjectURL(before.objectUrl)
  const entry = { file, objectUrl: URL.createObjectURL(file) }
  clips.set(attemptId, entry)
  notify()
  return entry
}

export function getClip(attemptId: string | null | undefined): ClipEntry | null {
  return (attemptId && clips.get(attemptId)) || null
}

export function hasClip(attemptId: string): boolean {
  return clips.has(attemptId)
}

/** Forgets one clip and revokes its URL (e.g. after the attempt is deleted). */
export function releaseClip(attemptId: string): void {
  const entry = clips.get(attemptId)
  if (!entry) return
  URL.revokeObjectURL(entry.objectUrl)
  clips.delete(attemptId)
  notify()
}

/** Forgets every clip; called on sign-out so the next account never sees them. */
export function releaseAllClips(): void {
  if (clips.size === 0) return
  for (const entry of clips.values()) URL.revokeObjectURL(entry.objectUrl)
  clips.clear()
  notify()
}

/**
 * Matches a re-picked file to one of `attempts` by SHA-256 and registers it.
 * Returns the attempt id, or null when the file is not one of them.
 */
export async function relink(
  file: File,
  attempts: readonly { id: string; video_sha256: string | null }[],
): Promise<string | null> {
  const sha = await sha256Hex(file)
  const match = attempts.find((a) => a.video_sha256 === sha)
  if (!match) return null
  registerClip(match.id, file)
  return match.id
}

/** The clip of an attempt in this tab, or null (not picked here, or the page was reloaded). */
export function useClip(attemptId: string | null | undefined): ClipEntry | null {
  return useSyncExternalStore(subscribe, () => getClip(attemptId))
}

// Tabs can stay open for hours; drop the URLs when the page goes away.
if (typeof window !== 'undefined') window.addEventListener('pagehide', (e) => !e.persisted && releaseAllClips())
