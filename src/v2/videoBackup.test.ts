import { describe, expect, it } from 'vitest'
import { backupProblem, formatStorage, STORAGE_BUDGET_BYTES, videoBackupPath, videoKind, VIDEO_MAX_BYTES } from './videoBackup'

const MB = 1024 * 1024
const clip = (name: string, size: number, type = 'video/mp4') => ({ name, size, type })

describe('video backup helpers', () => {
  it('maps a file to an accepted extension and type', () => {
    expect(videoKind(clip('D01_att3_d.MP4', 1))).toEqual({ ext: 'mp4', contentType: 'video/mp4' })
    expect(videoKind(clip('take.mov', 1, ''))).toEqual({ ext: 'mov', contentType: 'video/quicktime' })
    expect(videoKind(clip('noext', 1, 'video/webm'))).toEqual({ ext: 'webm', contentType: 'video/webm' })
    expect(videoKind(clip('clip.avi', 1, 'video/x-msvideo'))).toBeNull()
  })

  it('puts the object in the owner folder, named by attempt', () => {
    expect(videoBackupPath('u1', 'a1', 'mp4')).toBe('u1/a1.mp4')
  })

  it('accepts a batch that fits', () => {
    const usage = { videoFiles: 0, videoBytes: 0, keypointBytes: 5 * MB }
    expect(backupProblem(Array.from({ length: 15 }, (_, i) => clip(`c${i}.mp4`, 16 * MB)), usage)).toBeNull()
  })

  it('refuses a file over the per-file cap', () => {
    const p = backupProblem([clip('big.mp4', VIDEO_MAX_BYTES + 1)], null)
    expect(p?.title).toMatch(/too large/)
    expect(p?.detail).toMatch(/big\.mp4/)
  })

  it('refuses a type the bucket does not accept', () => {
    expect(backupProblem([clip('x.avi', MB, 'video/x-msvideo')], null)?.title).toMatch(/type/)
  })

  it('refuses a batch that would pass the storage budget, and says the numbers', () => {
    const usage = { videoFiles: 50, videoBytes: STORAGE_BUDGET_BYTES - 20 * MB, keypointBytes: 5 * MB }
    const p = backupProblem([clip('a.mp4', 16 * MB)], usage)
    expect(p?.title).toMatch(/storage/)
    expect(p?.detail).toMatch(/1\.0 GB/)
  })

  it('formats storage in GB above a gigabyte', () => {
    expect(formatStorage(STORAGE_BUDGET_BYTES)).toBe('1.0 GB')
    expect(formatStorage(16 * MB)).toBe('16.0 MB')
  })
})
