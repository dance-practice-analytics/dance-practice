// Helpers for a clip the user picked from the device (FR-3.2.1, FR-3.2.4).
// Everything here runs locally: the bytes are read to hash them and the browser
// reads the header for duration and size. Nothing in this file talks to a server.

import { ApiError } from '../api/errors'
import { SUBJECT_CODE_RE, type MovementType } from './schema'

// ---------- file name ----------

/** The file name without any folder part. For what is stored, use `deidentifiedClipName`. */
export function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, '').trim()
}

export interface ParsedClipName {
  subjectCode: string | null
  movement: MovementType | null
  take: number | null
}

const MOVEMENT_WORDS: Record<string, MovementType> = {
  releve: 'releve_balance',
  balance: 'releve_balance',
  pirouette: 'pirouette',
  pirouettes: 'pirouette',
  phrase: 'phrase',
}
const TAKE_JOINED = /^(?:take|clip|attempt|trial|att|t)(\d{1,3})$/
const TAKE_WORDS = new Set(['take', 'clip', 'attempt', 'trial'])

/**
 * Reads a subject code, movement and take number from names such as
 * `S03_releve_take2.mp4` or `S11-pirouette-07.mov`. Each field is null unless the
 * name states it once and unambiguously; the import screen then asks the user.
 */
export function parseClipName(name: string): ParsedClipName {
  const stem = baseName(name)
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  const tokens = stem.split(/[\s_\-.,()[\]]+/).filter(Boolean)

  const subjects = new Set<string>()
  const movements = new Set<MovementType>()
  const labelled: number[] = []
  const bare: number[] = []

  tokens.forEach((tok, i) => {
    const code = tok.toUpperCase()
    if (SUBJECT_CODE_RE.test(code)) return void subjects.add(code)
    const movement = MOVEMENT_WORDS[tok]
    if (movement) return void movements.add(movement)
    const joined = TAKE_JOINED.exec(tok)
    if (joined) return void labelled.push(Number(joined[1]))
    if (/^\d{1,3}$/.test(tok)) {
      if (TAKE_WORDS.has(tokens[i - 1])) labelled.push(Number(tok))
      else bare.push(Number(tok))
    }
  })

  // A bare number only counts when it is the only one, closes the name and the name
  // already follows the study pattern; dates and camera counters (VID_123) are left alone.
  const patterned = subjects.size === 1 || movements.size === 1
  const closesName = /^\d{1,3}$/.test(tokens[tokens.length - 1] ?? '')
  // Take 0 counts only when labelled (`att0`, `take 0`); a bare `00` is not a take.
  let take: number | null = null
  if (labelled.length === 1) take = labelled[0]
  else if (labelled.length === 0 && bare.length === 1 && patterned && closesName && bare[0] > 0) take = bare[0]

  return {
    subjectCode: subjects.size === 1 ? [...subjects][0] : null,
    movement: movements.size === 1 ? [...movements][0] : null,
    take,
  }
}

// ---------- de-identified name (FR-3.2.5, NFR-2) ----------

/** Extensions kept on a stored clip name; anything else is dropped, so no free text survives. */
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', '3gp', 'mpg', 'mpeg', 'ogv', 'wmv'])

/**
 * A clip number the database accepts (attempts.clip_number, 0–999), or null. 0 is a
 * real take: the phrase study numbers its takes from att0.
 */
export function clipNumberOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 999 ? n : null
}

/**
 * The only clip name that is ever stored or exported. A local file name can hold a
 * dancer's name ("Maria_S03_07.mp4", "C:\Users\maria\…"), so it is rebuilt from what
 * was recognised in it: `S03_att07.mp4` when the name follows the dataset pattern
 * (subject code + attempt number), otherwise the neutral `clip 7.mp4` / `clip.mp4`.
 * `clipNumber` is used when the name itself has no attempt number. Never returns any
 * other part of the original name.
 */
export function deidentifiedClipName(name: string, clipNumber?: number | null): string {
  const base = baseName(name ?? '')
  const ext = /\.([a-z0-9]{2,4})$/i.exec(base)?.[1]?.toLowerCase()
  const suffix = ext && VIDEO_EXTENSIONS.has(ext) ? `.${ext}` : ''
  const parsed = parseClipName(base)
  const number = clipNumberOrNull(parsed.take) ?? clipNumberOrNull(clipNumber)
  if (parsed.subjectCode && number !== null) return `${parsed.subjectCode}_att${String(number).padStart(2, '0')}${suffix}`
  return number !== null ? `clip ${number}${suffix}` : `clip${suffix}`
}

/** True when a stored name has the shape `deidentifiedClipName` produces. */
export function isDeidentifiedClipName(name: string): boolean {
  return /^(S\d{2}_att\d{2,3}|clip(?: \d{1,3})?)(\.[a-z0-9]{2,4})?$/.test(name)
}

/**
 * For reading rows saved before names were de-identified: a stored name that isn't in
 * the de-identified shape is rebuilt the same way before it is shown in an export.
 */
export function safeStoredClipName(name: string | null | undefined, clipNumber?: number | null): string | null {
  if (name == null || name === '') return null
  return isDeidentifiedClipName(name) ? name : deidentifiedClipName(name, clipNumber)
}

// ---------- SHA-256 ----------

export interface HashOptions {
  /** Bytes read per step when hashing in chunks. */
  chunkBytes?: number
  /** Files up to this size are hashed in one WebCrypto call. */
  oneShotMaxBytes?: number
  onProgress?: (doneBytes: number, totalBytes: number) => void
}

/**
 * SHA-256 of a file as lower-case hex; it is how a repeated import is detected.
 * WebCrypto has no incremental digest, so larger files are read in slices and
 * hashed here to keep memory flat (a phone can't hold a 300 MB clip in one buffer).
 * The same path is used where `crypto.subtle` is missing (plain http on a LAN).
 */
export async function sha256Hex(file: Blob, opts: HashOptions = {}): Promise<string> {
  const chunk = Math.max(64, opts.chunkBytes ?? 4 * 1024 * 1024)
  const oneShotMax = opts.oneShotMaxBytes ?? 32 * 1024 * 1024
  const subtle = globalThis.crypto?.subtle

  if (subtle && file.size <= oneShotMax) {
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer())
    opts.onProgress?.(file.size, file.size)
    return toHex(new Uint8Array(digest))
  }

  const sha = new Sha256()
  for (let offset = 0; offset < file.size; offset += chunk) {
    sha.update(new Uint8Array(await file.slice(offset, offset + chunk).arrayBuffer()))
    opts.onProgress?.(Math.min(offset + chunk, file.size), file.size)
  }
  return sha.digest()
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

/** Incremental SHA-256 (FIPS 180-4). */
class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  private block = new Uint8Array(64)
  private filled = 0
  private bytes = 0
  private w = new Uint32Array(64)

  update(data: Uint8Array): void {
    this.bytes += data.length
    let i = 0
    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, data.length)
      this.block.set(data.subarray(0, take), this.filled)
      this.filled += take
      i = take
      if (this.filled < 64) return
      this.compress(this.block, 0)
      this.filled = 0
    }
    for (; i + 64 <= data.length; i += 64) this.compress(data, i)
    if (i < data.length) {
      this.block.set(data.subarray(i))
      this.filled = data.length - i
    }
  }

  digest(): string {
    const bytes = this.bytes
    const padLen = (this.filled < 56 ? 56 : 120) - this.filled
    const tail = new Uint8Array(padLen + 8)
    tail[0] = 0x80
    const view = new DataView(tail.buffer)
    // Message length in bits, big-endian 64-bit.
    view.setUint32(padLen, Math.floor(bytes / 0x20000000))
    view.setUint32(padLen + 4, (bytes * 8) >>> 0)
    this.update(tail)
    const out = new Uint8Array(32)
    const outView = new DataView(out.buffer)
    this.h.forEach((word, i) => outView.setUint32(i * 4, word))
    return toHex(out)
  }

  private compress(p: Uint8Array, o: number): void {
    const w = this.w
    for (let t = 0; t < 16; t++) {
      const j = o + t * 4
      w[t] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3]
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]
      const y = w[t - 2]
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[t] = w[t - 16] + s0 + w[t - 7] + s1
    }
    const H = this.h
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    H[0] += a
    H[1] += b
    H[2] += c
    H[3] += d
    H[4] += e
    H[5] += f
    H[6] += g
    H[7] += h
  }
}

// ---------- video header ----------

export interface VideoMeta {
  /** Null when the container doesn't state a duration (some WebM recordings). */
  durationS: number | null
  width: number
  height: number
}

/**
 * Duration and frame size from the clip's header, read by a `<video>` that is never
 * added to the page. The object URL is revoked on every path. The frame rate is not
 * available here; the pose step measures it while it decodes.
 */
export function readVideoMeta(file: Blob, timeoutMs = 15_000): Promise<VideoMeta> {
  const unreadable = () =>
    new ApiError(
      415,
      'clip_unreadable',
      'This file can’t be opened as a video on this device.',
      'Choose an MP4, MOV or WebM clip, or try another browser.',
    )

  return new Promise<VideoMeta>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onerror = null
      // Dropping the source lets the browser release the decoder before the URL goes.
      video.removeAttribute('src')
      try {
        video.load()
      } catch {
        // Nothing to release.
      }
      URL.revokeObjectURL(url)
      fn()
    }

    const timer = setTimeout(() => finish(() => reject(unreadable())), timeoutMs)
    video.onloadedmetadata = () => {
      const { duration, videoWidth, videoHeight } = video
      if (!videoWidth || !videoHeight) return finish(() => reject(unreadable()))
      finish(() =>
        resolve({
          durationS: Number.isFinite(duration) && duration > 0 ? duration : null,
          width: videoWidth,
          height: videoHeight,
        }),
      )
    }
    video.onerror = () => finish(() => reject(unreadable()))
    video.preload = 'metadata'
    video.muted = true
    try {
      video.src = url
    } catch {
      finish(() => reject(unreadable()))
    }
  })
}
