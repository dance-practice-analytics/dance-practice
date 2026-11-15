// Browser-side encoder for the synthetic test clips (WebCodecs H.264 + MP4 mux).
// Loaded by scripts/make-test-clips.mjs inside headless Chrome; the app never imports it.

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { buildPoseTrack, FPS as fps } from './syntheticSession'
import { cameraPoses, drawFootageFrame } from './footage'
import { CLIP_SIZE } from './clips'

export async function encodeClip(seed: number, variation: number): Promise<Uint8Array> {
  const track = buildPoseTrack({ seed, variation })
  const poses = cameraPoses(track.pose)
  const { width, height } = CLIP_SIZE
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' })
  let failure: unknown = null
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) })
  encoder.configure({ codec: 'avc1.42001f', width, height, bitrate: 450_000, framerate: fps, avc: { format: 'avc' } })

  const frameUs = 1e6 / fps
  for (let i = 0; i < poses.length; i++) {
    const t = i / fps
    drawFootageFrame(ctx, width, height, poses[i], t, i)
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) })
    // Short keyframe interval: the workspace seeks the clip a lot (scrubbing, phase-matched compare).
    encoder.encode(frame, { keyFrame: i % 10 === 0 })
    frame.close()
    if (encoder.encodeQueueSize > 30) await new Promise((r) => setTimeout(r, 0))
    if (failure) throw failure
  }
  await encoder.flush()
  muxer.finalize()
  return new Uint8Array(muxer.target.buffer)
}
