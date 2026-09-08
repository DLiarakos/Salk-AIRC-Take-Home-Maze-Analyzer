import type { FrameTiming,RationalTime } from './media';

export interface GrayscaleStats {
  minimum: number;
  maximum: number;
  mean: number;
  standardDeviation: number;
}

export interface RepresentativeFrame {
  width: number;
  height: number;

  /**
   * One byte per pixel:
   * 0 = black
   * 255 = white
   */
  pixels: Uint8Array;

  timing: FrameTiming;

  /**
   * Position in the WebCodecs output sequence.
   * This is for preview/debugging only.
   */
  decodedIndex: number;

  stats: GrayscaleStats;
}
export interface Point2D {
  x: number;
  y: number;
}

export interface ArenaCalibration {
  /**
   * Dimensions of the image this calibration belongs to.
   */
  imageWidth: number;
  imageHeight: number;

  /**
   * Maze/platform center in image pixel coordinates.
   */
  centerX: number;
  centerY: number;

  /**
   * Radius of the physical Barnes maze platform.
   */
  platformRadiusPixels: number;

  /**
   * Extra pixels outside the platform retained for tracking.
   *
   * This is useful because the mouse can partially disappear
   * into holes at the rim.
   */
  trackingMarginPixels: number;

  /**
   * Optional real-world platform diameter.
   * Later used for pixels → centimeters conversion.
   */
  platformDiameterCm: number | null;
}
export interface BackgroundSample {
  decodedIndex: number;
  pixels: Uint8Array;
}

export interface BackgroundModel {
  width: number;
  height: number;
  pixels: Uint8Array;
  sampleCount: number;
}

export interface SegmentationSettings {
  /**
   * Minimum amount by which a pixel must become
   * darker than the background to count as foreground.
   */
  differenceThreshold: number;

  /**
   * Ignore connected foreground regions smaller
   * than this many pixels.
   */
  minimumComponentAreaPixels: number;
}

export interface SegmentationResult {
  width: number;
  height: number;

  /**
   * background - current frame, clamped to 0–255.
   */
  difference: Uint8Array;

  /**
   * 0 = background
   * 1 = candidate foreground
   */
  foregroundMask: Uint8Array;

  foregroundPixelCount: number;
}
export interface ForegroundComponent {
  id: number;

  areaPixels: number;

  centroidX: number;
  centroidY: number;

  minX: number;
  minY: number;
  maxX: number;
  maxY: number;

  /**
   * Indices into the flattened width × height image.
   */
  pixelIndices: number[];
}

export interface ComponentAnalysis {
  components: ForegroundComponent[];

  /**
   * Components meeting the configured minimum area.
   */
  retainedComponents: ForegroundComponent[];

  /**
   * Largest retained component, if one exists.
   *
   * For the first prototype this is our mouse candidate.
   */
  largestComponent:
    ForegroundComponent | null;
}
export type BodyVisibility =
  | 'visible'
  | 'partial'
  | 'not-detected';

export interface BodyDetection {
  x: number;
  y: number;

  areaPixels: number;

  minX: number;
  minY: number;
  maxX: number;
  maxY: number;

  visibility: BodyVisibility;

  /**
   * Fraction of all retained foreground pixels
   * belonging to the selected body component.
   */
  dominance: number;
}
export interface BodyTrackPoint {
  /**
   * Presentation-order frame number.
   * Diagnostic only — behavioral timing uses PTS.
   */
  presentationIndex: number;

  /**
   * Exact MP4 presentation timestamp.
   */
  pts: RationalTime;

  x: number | null;
  y: number | null;
  
  axisX: number | null;
  axisY: number | null;

  candidateAX: number | null;
  candidateAY: number | null;
  candidateBX: number | null;
  candidateBY: number | null;

  shapeConfidence: number | null;

  noseX: number | null;
  noseY: number | null;
  rearX: number | null;
  rearY: number | null;

  orientationConfidence: number | null;

  orientationMethod:
  | 'motion'
  | 'continuity'
  | 'unresolved'
  | 'not-detected';

  areaPixels: number | null;
  dominance: number | null;

  visibility: BodyVisibility;

  foregroundPixelCount: number;
  retainedComponentCount: number;
}

export interface BodyTrack {
  width: number;
  height: number;

  points: BodyTrackPoint[];

  detectedFrameCount: number;
  missingFrameCount: number;
}
export interface TrialWindowSettings {
  /**
   * Mouse must remain detected for at least this
   * long before presence is considered real.
   */
  minimumPresenceSeconds: number;
}

export interface TrialWindow {
  startPresentationIndex: number;
  startPts: RationalTime;

  endPresentationIndex:
    number | null;

  endPts:
    RationalTime | null;
}
export interface TrajectorySmoothingSettings {
  medianWindowSeconds: number;
  meanWindowSeconds: number;
  maxGapSeconds: number;
}

export interface AnalysisTrajectoryPoint {
  pts: RationalTime;
  timeSeconds: number;

  x: number;
  y: number;

  segmentId: number;

  /**
   * More than 1 means multiple observations
   * shared the exact same source PTS and were
   * collapsed into one temporal observation.
   */
  sourceObservationCount: number;
}

export interface TrajectoryQcSummary {
  sourceObservationCount: number;
  analysisObservationCount: number;
  missingObservationCount: number;

  duplicatePtsCollapsed: number;
  nonIncreasingTimestampCount: number;
  segmentCount: number;

  medianSmoothingCorrectionPixels: number;
  p95SmoothingCorrectionPixels: number;
  maximumSmoothingCorrectionPixels: number;
}

export interface ProcessedTrajectory {
  raw: AnalysisTrajectoryPoint[];
  smoothed: AnalysisTrajectoryPoint[];
  qc: TrajectoryQcSummary;
  settings: TrajectorySmoothingSettings;
}
export interface HoleRoi {
  index: number;

  automaticCenterX: number;
  automaticCenterY: number;

  centerX: number;
  centerY: number;

  radiusPixels: number;
  isTarget: boolean;
  manuallyAdjusted: boolean;
}

export interface HoleGeometry {
  holeCount: number;
  holeRadiusPixels: number;
  targetHoleIndex: number;

  homography: [
    number,number,number,
    number,number,number,
    number,number,
  ];

  holes: HoleRoi[];
}
export interface OrientationSettings {
  motionLookbackSeconds: number;
  minimumDirectionalSpeedPixelsPerSecond: number;
  minimumMotionAlignment: number;
  maximumContinuityGapSeconds: number;
  minimumContinuityAlignment: number;
  minimumShapeConfidence: number;
}
export interface HoleInvestigationSettings {
  entryMarginPixels: number;
  sustainMarginPixels: number;
  minimumDwellSeconds: number;
  maximumInterruptionSeconds: number;
  minimumHeadHoleAlignment: number;
  minimumNoseLeadPixels: number;
}

export type HoleEvidenceState =
  | 'investigating'
  | 'outside'
  | 'near-but-misaligned'
  | 'unknown';

export interface HoleInvestigationEvidence {
  presentationIndex: number;
  timeSeconds: number;

  noseX: number | null;
  noseY: number | null;

  state: HoleEvidenceState;
  holeIndex: number | null;
  distancePixels: number | null;
  headHoleAlignment: number | null;

  withinEntryRadius: boolean;
  withinSustainRadius: boolean;
}

export interface HoleInvestigationEvent {
  eventIndex: number;
  holeIndex: number;
  isTarget: boolean;

  startPresentationIndex: number;
  endPresentationIndex: number;

  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;

  positiveObservationCount: number;

  minimumNoseDistancePixels: number;
  closestNoseX: number;
  closestNoseY: number;
}

export interface HoleInvestigationQc {
  trialObservationCount: number;
  uniqueTimestampCount: number;
  duplicatePtsCollapsed: number;

  usableNoseObservations: number;
  unknownNoseObservations: number;
  positiveEvidenceObservations: number;
  proximityPositiveObservations: number;
  alignmentRejectedObservations: number;
  entryTriggerObservations: number;
  candidateEventCount: number;
  acceptedEventCount: number;
  rejectedShortEventCount: number;

}

export interface HoleInvestigationResult {
  evidence: HoleInvestigationEvidence[];
  events: HoleInvestigationEvent[];
  qc: HoleInvestigationQc;
  settings: HoleInvestigationSettings;
}
