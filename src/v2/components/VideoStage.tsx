// The video stage (VideoStage.dc.html): a dark box that plays a LOCAL clip and draws
// the tracked skeleton over it. The skeleton is only ever what the pose data says:
//   frame = PoseFrame with landmarks → drawn; weakly seen segments dashed and dimmed
//   frame = null, or a frame whose `image` is null → nothing drawn + a "No tracking" pill
//   frame = undefined → no overlay requested (plain video)
// There is no fallback pose. `src` must be a blob: URL from clips.ts; this component
// never fetches or uploads anything.

import type { CSSProperties, ReactNode, Ref, VideoHTMLAttributes } from 'react'
import { LM, type Landmark, type PoseFrame } from '../../pose/types'
import { PrivacyPill } from './primitives'

/** Below this visibility a landmark counts as weakly seen (same threshold as the metrics engine). */
export const LOW_VISIBILITY = 0.6

// Body segments (MediaPipe indices). The face is reduced to a head circle. AttemptThumb draws the same ones.
export const SEGMENTS: readonly (readonly [number, number])[] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftFootIndex],
  [LM.leftAnkle, LM.leftFootIndex],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightFootIndex],
  [LM.rightAnkle, LM.rightFootIndex],
]

const JOINTS: readonly number[] = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftFootIndex,
  LM.rightFootIndex,
]

// Stage colours come from the .app tokens (studio.css); the fallbacks are the same values.
const BONE = 'var(--bone, #F5F7FB)'
const STAGE_ACCENT = 'var(--stage-accent, #C8F54A)'
const GHOST = 'var(--stage-ghost, #8A96B8)'
const PILL: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 10px',
  background: 'var(--stage-pill, rgba(7,14,36,.72))',
  fontSize: 12,
  fontWeight: 500,
  color: BONE,
}

export interface VideoStageProps {
  /** blob: URL of the local clip (clips.ts). Without it the skeleton is drawn alone on the stage. */
  src?: string | null
  /**
   * The pose at the current time (`frameAt(series, t)`). `null`, or a frame without
   * landmarks, shows the "No tracking" pill and no skeleton. `undefined` = no overlay.
   */
  frame?: PoseFrame | null
  /** A second pose drawn dashed in neutral grey (attempt A behind B in Compare); never the trunk lime. */
  ghostFrame?: PoseFrame | null
  /** Source size in pixels (`series.width/height`); sets the aspect ratio and the overlay scale. Default 16:9. */
  width?: number
  height?: number
  /** Ref to the `<video>` so the page drives playback (play, pause, currentTime). */
  videoRef?: Ref<HTMLVideoElement>
  /** Extra `<video>` props: onTimeUpdate, onLoadedMetadata, loop, … (muted and playsInline are always set). */
  videoProps?: VideoHTMLAttributes<HTMLVideoElement>
  /** Hide the skeleton without unmounting (overlay toggle). */
  showSkeleton?: boolean
  /** Top-left pill, e.g. 'A · Attempt 2'. */
  label?: string
  /** Top-right pill, e.g. 'Side view'. */
  view?: string
  /** Bottom-left mono pill, e.g. '00:03.48 / 00:08.40' (`formatTimecode`). */
  timecode?: string
  /** Bottom-right pill, e.g. 'Hold'. */
  phase?: string
  /** Privacy pill text; `false` hides it. Default 'On this device · not uploaded'. */
  privacy?: string | false
  /** Set false to hide all pills (thumbnails). The "No tracking" pill still shows. */
  chrome?: boolean
  /** Draw `frame` in the dashed ghost style instead of the bone skeleton (A's layer in Compare's overlay). */
  tone?: 'main' | 'ghost'
  /** No stage background or studio floor: a layer stacked over another stage. */
  transparent?: boolean
  /** Opacity of the video only (the skeleton stays fully drawn). Default 1. */
  videoOpacity?: number
  /** False hides the picture but keeps the video playing (it may be keeping time); the studio floor shows instead. */
  showVideo?: boolean
  /** Drawn over the video and under this stage's skeleton (A's layer in Compare's overlay). */
  underlay?: ReactNode
  /** Drawn over the skeleton, under the pills (the angle guides). */
  overlay?: ReactNode
  /** Text for the missing-tracking pill. */
  noTrackingLabel?: string
  /** Accessible description of the overlay. */
  ariaLabel?: string
  /** Shown centred when there is neither a video nor a pose (e.g. a "Choose the file again" button). */
  placeholder?: ReactNode
  /** Extra absolutely-positioned content on the stage. */
  children?: ReactNode
  style?: CSSProperties
}

export function VideoStage(props: VideoStageProps) {
  const {
    src,
    frame,
    ghostFrame,
    videoRef,
    videoProps,
    showSkeleton = true,
    label,
    view,
    timecode,
    phase,
    privacy,
    chrome = true,
    tone = 'main',
    transparent = false,
    videoOpacity = 1,
    showVideo = true,
    underlay,
    overlay,
    noTrackingLabel = 'No tracking',
    ariaLabel,
    placeholder,
    children,
    style,
  } = props
  const w = props.width && props.width > 0 ? props.width : 1280
  const h = props.height && props.height > 0 ? props.height : 720
  const pose = frame?.image ?? null
  const ghost = ghostFrame?.image ?? null
  const overlayWanted = frame !== undefined
  const noTracking = overlayWanted && pose === null

  return (
    <div
      className="v2-stage"
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${w} / ${h}`,
        background: transparent ? 'transparent' : 'var(--stage, #070E24)',
        borderRadius: 12,
        overflow: 'hidden',
        color: BONE,
        ...style,
      }}
    >
      {src && (
        <video
          {...videoProps}
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="auto"
          aria-hidden={showVideo ? undefined : true}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: transparent ? 'transparent' : 'var(--stage, #070E24)',
            opacity: videoOpacity,
            // Hidden, not removed: a hidden lead video still keeps the clock's time.
            visibility: showVideo ? undefined : 'hidden',
          }}
        />
      )}
      {(!src || !showVideo) && !transparent && (
        // The studio floor of the design, behind a skeleton shown without its video.
        <>
          <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '24%', background: 'var(--stage-2, #101B3F)' }} />
          <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: '47%', height: 3, background: 'var(--stage-line, #22316A)' }} />
        </>
      )}

      {underlay}

      {showSkeleton && (pose || ghost) && (
        <svg
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={ariaLabel ?? (ghost ? 'Pose skeleton overlay, with the other attempt dashed' : 'Pose skeleton overlay')}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {ghost && <Skeleton landmarks={ghost} w={w} h={h} ghost />}
          {pose && <Skeleton landmarks={pose} w={w} h={h} ghost={tone === 'ghost'} />}
        </svg>
      )}

      {overlay}

      {!src && !pose && !ghost && placeholder && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center' }}>
          {placeholder}
        </div>
      )}

      {children}

      {chrome && (
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', pointerEvents: 'none' }}>
          {label && <span style={{ ...PILL, borderRadius: 999, fontWeight: 600 }}>{label}</span>}
          {privacy !== false && <PrivacyPill onStage>{privacy ?? 'On this device · not uploaded'}</PrivacyPill>}
          <span style={{ flex: 1 }} />
          {view && <span style={{ ...PILL, borderRadius: 999 }}>{view}</span>}
        </div>
      )}
      {(chrome || noTracking) && (
        <div className="v2-stage-foot" style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', pointerEvents: 'none' }}>
          {chrome && timecode && (
            <span className="mono" style={{ ...PILL, borderRadius: 6, fontWeight: 400 }}>
              {timecode}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {noTracking && (
            <span role="status" style={{ ...PILL, borderRadius: 6, border: '1px dashed rgba(245,247,251,.6)' }}>
              {noTrackingLabel}
            </span>
          )}
          {chrome && phase && <span style={{ ...PILL, borderRadius: 6 }}>{phase}</span>}
        </div>
      )}
    </div>
  )
}

interface SkeletonProps {
  landmarks: Landmark[]
  w: number
  h: number
  ghost?: boolean
}

/** One pose in source-pixel coordinates. Strokes keep their screen width at any size. */
function Skeleton({ landmarks, w, h, ghost }: SkeletonProps) {
  const pt = (i: number) => ({ x: landmarks[i].x * w, y: landmarks[i].y * h, v: landmarks[i].visibility })
  const weak = (...idx: number[]) => idx.some((i) => landmarks[i].visibility < LOW_VISIBILITY)
  const fixed = { vectorEffect: 'non-scaling-stroke' } as const
  const r = Math.max(w, h) * 0.006

  const ls = pt(LM.leftShoulder)
  const rs = pt(LM.rightShoulder)
  const lh = pt(LM.leftHip)
  const rh = pt(LM.rightHip)
  const neck = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const pelvis = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
  const trunkWeak = weak(LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip)

  // Head: a circle around the nose sized from the ears, or from the shoulders when the ears are weak.
  const nose = pt(LM.nose)
  const le = pt(LM.leftEar)
  const re = pt(LM.rightEar)
  const earSpan = Math.hypot(le.x - re.x, le.y - re.y)
  const shoulderSpan = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const headR = Math.max(earSpan * 0.6, shoulderSpan * 0.22, r * 2)
  const headWeak = weak(LM.nose)

  if (ghost) {
    return (
      <g fill="none" stroke={GHOST} strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" strokeLinejoin="round" opacity={0.9}>
        <circle cx={nose.x} cy={nose.y} r={headR} {...fixed} />
        <line x1={neck.x} y1={neck.y} x2={pelvis.x} y2={pelvis.y} {...fixed} />
        {SEGMENTS.map(([a, b]) => {
          const p = pt(a)
          const q = pt(b)
          return <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} opacity={weak(a, b) ? 0.45 : 1} {...fixed} />
        })}
      </g>
    )
  }

  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle
        cx={nose.x}
        cy={nose.y}
        r={headR}
        stroke={BONE}
        strokeWidth={2.25}
        strokeDasharray={headWeak ? '3 4' : undefined}
        opacity={headWeak ? 0.55 : 1}
        {...fixed}
      />
      {SEGMENTS.map(([a, b]) => {
        const p = pt(a)
        const q = pt(b)
        const low = weak(a, b)
        return (
          <line
            key={`${a}-${b}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke={BONE}
            strokeWidth={2.25}
            strokeDasharray={low ? '3 4' : undefined}
            opacity={low ? 0.55 : 1}
            {...fixed}
          />
        )
      })}
      {/* The trunk line the inclination is measured on, in the stage accent. */}
      <line
        x1={neck.x}
        y1={neck.y}
        x2={pelvis.x}
        y2={pelvis.y}
        stroke={STAGE_ACCENT}
        strokeWidth={3.5}
        strokeDasharray={trunkWeak ? '3 4' : undefined}
        opacity={trunkWeak ? 0.55 : 1}
        {...fixed}
      />
      {JOINTS.map((i) => {
        const p = pt(i)
        // A weakly seen joint is a hollow ring, not a solid dot.
        return p.v < LOW_VISIBILITY ? (
          <circle key={i} cx={p.x} cy={p.y} r={r} stroke={BONE} strokeWidth={1.25} opacity={0.7} {...fixed} />
        ) : (
          <circle key={i} cx={p.x} cy={p.y} r={r} fill={BONE} />
        )
      })}
    </g>
  )
}
