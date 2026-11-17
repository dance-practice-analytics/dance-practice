// Everything a page needs from the shared components, in one import:
//   import { PageHeader, EmptyState, MetricCard, VideoStage, Icon } from '../components'

export { AttemptThumb, type AttemptThumbProps } from './AttemptThumb'
export { CompactGap, type CompactGapProps } from './CompactGap'
export { Icon, Logo, ICON_NAMES, type IconName, type IconProps } from './Icon'
export { MetricCard, metricCardProps, type MetricCardProps } from './MetricCard'
export { VideoStage, LOW_VISIBILITY, type VideoStageProps } from './VideoStage'
export {
  Alert,
  ConfBadge,
  EmptyState,
  ErrorAlert,
  NoteBox,
  PageHeader,
  PrivacyPill,
  Skeleton,
  SkeletonList,
  SkeletonWorkspace,
  Spinner,
  StatusPill,
  type AlertProps,
  type ConfBadgeProps,
  type Confidence,
  type EmptyStateProps,
  type NoteBoxProps,
  type PageHeaderProps,
  type PrivacyPillProps,
  type SkeletonProps,
  type Status,
  type StatusPillProps,
} from './primitives'
