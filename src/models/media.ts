/**
 * Shared media-timing and generic Barnes maze data contracts.
 *
 * Inputs:
 * - No runtime inputs; this file defines source-video timing, calibration, observation, scoring, and QC shapes.
 *
 * Outputs:
 * - Exported TypeScript interfaces/types used to preserve exact MP4 timing and exchange media-level scientific data.
 *
 * Main definitions:
 * - RationalTime and FrameTiming preserve authoritative integer source timestamps.
 * - VideoMetadata/VideoIdentity describe source files, while observation/scoring types define reusable analysis records.
 */
/**
 * Exact media time in the source track's integer timebase.
 *
 * `ticks` and `timescale` are authoritative. `seconds` and WebCodecs
 * microseconds are derived convenience values and must never replace them
 * in persisted scientific data.
*/
export interface RationalTime {
  ticks: number;
  timescale: number;
}

export interface VideoIdentity {
  name: string;
  sizeBytes: number;
  lastModifiedMs: number;
}

export interface VideoMetadata {
  identity: VideoIdentity;
  codec: string;
  width: number;
  height: number;
  frameCount: number;
  trackId: number;
  trackTimescale: number;
  trackDurationTicks: number;
  movieTimescale: number;
  movieDurationTicks: number;
  nominalFps: number | null;
  hasAudio: boolean;
}
/** Timing attached to one compressed MP4 video sample / decoded frame. */
export interface FrameTiming {
  /** Order in which the compressed sample was extracted from the MP4 track. */
  sampleIndex: number;
  /** Assigned after sorting decoded frames into presentation-time order. */
  presentationIndex: number | null;
  /** Composition timestamp: the presentation time used for behavioral timing. */
  pts: RationalTime;
  /** Decode timestamp retained for timing diagnostics and reproducibility. */
  dts: RationalTime;
  duration: RationalTime;
  /** Timestamp supplied to WebCodecs. Integer microseconds. */
  webCodecsTimestampUs: number;
  isKeyFrame: boolean;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface TrackingPoint extends Point2D {
  confidence: number;
}

export type VisibilityState = 'visible' | 'hole-entry-candidate' | 'in-hole' | 'reappeared' | 'missing-unknown';
/**
 * Tracker-level observation data. Decoding supplies frame pixels and exact
 * FrameTiming separately from these behavioral observation fields.
*/
export interface FrameObservation {
  timing: FrameTiming;
  bodyCenter: TrackingPoint | null;
  nose: TrackingPoint | null;
  visibleBodyAreaPx: number | null;
  visibility: VisibilityState;
}

export interface HoleCalibration {
  holeNumber: number;
  centerPx: Point2D;
  radiusPx: number;
  isTarget: boolean;
}

export interface MazeCalibration {
  sourceVideoName: string;
  arenaCenterPx: Point2D;
  arenaRadiusPx: number;
  physicalDiameterCm: number;
  holes: HoleCalibration[];
}

export interface InvestigationRule {
  detectionPoint: 'nose';
  enterRadiusCm: number;
  exitRadiusCm: number;
  minimumDwellSeconds: number;
  repeatAwaySeconds: number;
  minimumNoseConfidence: number;
  maximumSpeedCmPerSecond: number | null;
}

export interface EscapeRule {
  minimumAbsenceSeconds: number;
  minimumBodyConfidence: number;
}

export interface ScoringSettings {
  investigation: InvestigationRule;
  escape: EscapeRule;
}

export type SearchStrategy = 'spatial' | 'serial' | 'random' | 'unclassified';
export interface HoleInvestigationEvent {
  holeNumber: number;
  isTarget: boolean;
  start: RationalTime;
  end: RationalTime;
  countedAsError: boolean;
  confidence: number;
}

export interface HoleEntryEvent {
  holeNumber: number;
  isTarget: boolean;
  /** Retrospectively assigned onset. */
  start: RationalTime;
  /** Time at which enough evidence existed to confirm the entry. */
  confirmedAt: RationalTime;
  confidence: number;
}

export interface QcFlag {
  code: string;
  severity: 'info' | 'review' | 'invalid';
  message: string;
  at?: RationalTime;
}

export interface TrialMetrics {
  primaryLatencySeconds: number | null;
  totalLatencySeconds: number | null;
  primaryErrors: number | null;
  totalErrors: number | null;
  pathLengthCm: number | null;
  meanSpeedCmPerSecond: number | null;
  targetQuadrantSeconds: number | null;
  strategyAuto: SearchStrategy;
  strategyFinal: SearchStrategy;
}
