{/**Thu Sep 3	Hole-event state machine + latency/errors
Fri Sep 4	Path length, speed, quadrant metrics
Sat Sep 5	Search-strategy features/classifier
Sun Sep 6	Batch GUI + video review
Mon Sep 7	Excel export, packaging, validation
Tue Sep 8	Final test/demo  
→ escape visual reviewer → batch workflow → export → final validation/accessibility/packaging.
*/}
import { useMemo, useRef, useState,useEffect, } from 'react';
import type { ChangeEvent } from 'react';
import type { FrameTiming } from './models/media';
import type { DecodeResult,ExactFrameReviewSession,ExactReviewFrame,} from './video/decoderClient';
import { decodeVideoFile, decoderCapabilities,createExactFrameReviewSession } from './video/decoderClient';
import { timeToSeconds } from './video/time';
import GrayscalePreview from './components/GrayscalePreview';
import BackgroundPreview from './components/BackgroundPreview';
import ArenaCalibrationView from './components/ArenaCalibrationView';
import type { ArenaCalibration,BodyTrack,SegmentationSettings,TrajectorySmoothingSettings,
              HoleGeometry, OrientationSettings,HoleInvestigationSettings,
              FinalReviewedHoleInvestigationEvent,EscapeDetectionSettings,
              EscapeReviewDecision,EscapeReviewStatus,SearchStrategySettings,
              SearchStrategyOverride,ManualHoleEventAddition,TrialStartOverride,
              ManualTrackPointCorrectionMap,TrajectoryOutlierSettings,BodyTrackPoint} from './models/tracking';

import SegmentationPreview from './components/SegmentationPreview';
import ArenaMaskPreview from './components/ArenaMaskPreview';
import {trackVideoFile,} from './video/trackingClient';
import {analyzeBodyTrack,detectionRateFromTrialStart} from './tracking/trackAnalysis';
import {detectTrialStart,} from './tracking/trialWindow';
import TrajectoryPreview from './components/TrajectoryPreview';
import { processTrajectory } from './tracking/trajectoryProcessing';
import TrajectoryComparisonView from './components/TrajectoryComparisonView';
import { computeTrajectoryMetrics } from './tracking/trajectoryMetrics';
import HoleCalibrationView from './components/HoleCalibrationView';
import {resolveTrackOrientation,summarizeOrientation,} from './tracking/orientation';
import OrientationPreview from './components/OrientationPreview';
import {detectHoleInvestigations,} from './tracking/holeInvestigation';
import HoleInvestigationPreview from './components/HoleInvestigationPreview';
import HoleEventReviewer,{holeEventReviewKey,type HoleEventReviewDecisionMap, } from './components/HoleEventReviewer';
import {computeBarnesPrimaryMetrics,computeBarnesEscapeMetrics} from './tracking/behavioralMetrics';
import {detectEscapeCandidate,} from './tracking/escapeDetection';
import {computeTargetQuadrantMetrics,} from './tracking/targetQuadrant';

import {classifySearchStrategy,} from './tracking/searchStrategy';

const SESSION_SCHEMA_VERSION = 1;

const BATCH_SNAPSHOT_SCHEMA_VERSION =
  2;

const TOOL_VERSION =
  '0.9';

const DEFAULT_SEGMENTATION_SETTINGS:
  SegmentationSettings = {
    differenceThreshold: 20,
    minimumComponentAreaPixels: 30,
  };

const DEFAULT_TRAJECTORY_SETTINGS:
  TrajectorySmoothingSettings = {
    medianWindowSeconds: 0.15,
    meanWindowSeconds: 0.10,
    maxGapSeconds: 0.25,
  };

const DEFAULT_TRAJECTORY_OUTLIER_SETTINGS:
  TrajectoryOutlierSettings = {
    enabled: true,

    /*
     * Deliberately conservative default.
     * This is intended to catch implausible
     * single-frame teleports rather than
     * impose a biological speed limit.
     */
    maximumJumpSpeedPixelsPerSecond:
      1200,
  };

const DEFAULT_ORIENTATION_SETTINGS:
  OrientationSettings = {
    motionLookbackSeconds: 0.12,
    minimumDirectionalSpeedPixelsPerSecond: 10,
    minimumMotionAlignment: 0.35,
    maximumContinuityGapSeconds: 0.25,
    minimumContinuityAlignment: 0.50,
    minimumShapeConfidence: 0.15,
  };

const DEFAULT_HOLE_INVESTIGATION_SETTINGS:
  HoleInvestigationSettings = {
    entryMarginPixels: 4,
    sustainMarginPixels: 8,
    minimumDwellSeconds: 0.20,
    maximumInterruptionSeconds: 0.10,
    minimumHeadHoleAlignment: 0.50,
  };
  const DEFAULT_ESCAPE_DETECTION_SETTINGS:
  EscapeDetectionSettings = {

    minimumTerminalAbsenceSeconds:
      0.20,

    escapeLookbackSeconds:
      1.00,

    escapeProximityMarginPixels:
      12,
    maximumTerminalBodyAreaFraction:
    0.65,

    minimumTerminalCollapseSeconds:
    0.30,
    maximumSecondsFromTargetEndToDisappearance:
      1.00,

    maximumSecondsFromTargetEndToRecordingEnd:
      0.75,
  };
  const DEFAULT_SEARCH_STRATEGY_SETTINGS:
  SearchStrategySettings = {

   maxDirectPrimaryErrors:
  2,

  maxDirectUniqueIncorrectHoles:
    1,

  maxDirectIncorrectHoleDistance:
    1,

  minimumDirectPathEfficiency:
    0.55,

    minimumSerialAdjacentTransitionFraction:
      0.60,

    minimumSerialDirectionalConsistency:
      0.60,

    maximumSerialDirectionReversalFraction:
      0.20,

    minimumSerialPerimeterTimeFraction:
      0.50,

    perimeterRadiusFraction:
      0.65,

    minimumTransitionsForSerial:
      3,
  };
interface SavedBarnesSession {
  schemaVersion: 1;

  fileIdentity: {
    name: string;
    size: number;
    lastModified: number;
  };
  videoWidth: number;
  videoHeight: number;

  arenaCalibration:
    ArenaCalibration | null;

  holeGeometry:
    HoleGeometry | null;

  segmentationSettings:
    SegmentationSettings;

  trajectorySmoothingSettings:
    TrajectorySmoothingSettings;

  trajectoryOutlierSettings?:
  TrajectoryOutlierSettings;

  orientationSettings:
    OrientationSettings;

  holeInvestigationSettings:
    HoleInvestigationSettings;
   escapeDetectionSettings?:
    EscapeDetectionSettings;
    searchStrategySettings?:
  SearchStrategySettings;

searchStrategyOverride?:
  SearchStrategyOverride | null;

  escapeReviewDecision?:
    EscapeReviewDecision | null;
  
  eventReviews:
    HoleEventReviewDecisionMap;
  manualHoleEventAdditions?:
  ManualHoleEventAddition[];
trialStartOverride?:
  TrialStartOverride | null;
  manualTrackPointCorrections?:
  ManualTrackPointCorrectionMap;
  savedAtIso: string;
}

function savedSessionKey(
  file: File,
): string {
  return [
    'barnes-analysis-session',
    `v${SESSION_SCHEMA_VERSION}`,
    file.name,
    file.size,
    file.lastModified,
  ].join(':');
}

function readSavedSession(
  file: File,
): SavedBarnesSession | null {
  try {
    const raw =
      localStorage.getItem(
        savedSessionKey(file),
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(
        raw,
      ) as SavedBarnesSession;

    if (
      parsed.schemaVersion !==
        SESSION_SCHEMA_VERSION ||
      parsed.fileIdentity.name !==
        file.name ||
      parsed.fileIdentity.size !==
        file.size ||
      parsed.fileIdentity.lastModified !==
        file.lastModified
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

type ProgressState = {
  phase: 'reading' | 'demuxing' | 'decoding';
  completed: number;
  total: number | null;
};
type BatchItemStatus =
  | 'queued'
  | 'decoding'
  | 'tracking'
  | 'decoded'
  | 'needs-review'
  | 'reviewed'
  | 'error';
type BatchReviewReadiness =
  | 'not-analyzed'
  | 'needs-calibration'
  | 'needs-tracking'
  | 'needs-event-review'
  | 'needs-escape-review'
  | 'no-escape-candidate'
  | 'escape-unresolved'
  | 'review-complete';
interface BatchItem {
  /*
   * Stable identity for this browser-selected
   * source file during the current app session.
   */
  id: string;

  /*
   * Keep only the File handle here.
   * We deliberately do NOT keep decoded frames,
   * tracks, or analysis arrays for every video.
   */
  file: File;

  status:
    BatchItemStatus;
  reviewReadiness:
  BatchReviewReadiness;

  error:
    string | null;

  addedAtIso:
    string;

  lastOpenedAtIso:
    string | null;
}
type BatchRunStage =
  | 'idle'
  | 'start-file'
  | 'decoding'
  | 'post-decode'
  | 'start-tracking'
  | 'tracking'
  | 'post-track'
  | 'complete';

interface BatchRunState {
  running: boolean;

  itemIds: string[];

  currentIndex: number;

  stage:
    BatchRunStage;
}
type BatchTrackingQcSnapshot =
  ReturnType<
    typeof analyzeBodyTrack
  >;

type BatchOrientationQcSnapshot =
  ReturnType<
    typeof summarizeOrientation
  >;

type BatchTrajectoryQcSnapshot =
  ReturnType<
    typeof processTrajectory
  >['qc'];

type BatchPrimaryMetricsSnapshot =
  ReturnType<
    typeof computeBarnesPrimaryMetrics
  >;

type BatchEscapeMetricsSnapshot =
  ReturnType<
    typeof computeBarnesEscapeMetrics
  >;

type BatchTrajectoryMetricsSnapshot =
  ReturnType<
    typeof computeTrajectoryMetrics
  >;

type BatchTargetQuadrantSnapshot =
  ReturnType<
    typeof computeTargetQuadrantMetrics
  >;

type BatchSearchStrategySnapshot =
  ReturnType<
    typeof classifySearchStrategy
  >;

type BatchEscapeCandidateSnapshot =
  ReturnType<
    typeof detectEscapeCandidate
  >;

type BatchAutomaticInvestigationEvents =
  ReturnType<
    typeof detectHoleInvestigations
  >['events'];

interface BatchOutlierQcSnapshot {
  rejectedCount:
    number;

  evaluatedCandidateCount:
    number;

  detectedTrialPointCountBefore:
    number;

  detectedTrialPointCountAfter:
    number;

  rejectedFraction:
    number;

  rejectedPresentationIndices:
    number[];
}
type BatchTrackingFailureLocation =
  | 'pre-trial'
  | 'within-trial'
  | 'post-trial'
  | 'crosses-trial-boundary';

interface BatchTrackingFailureRunSnapshot {
  startPresentationIndex:
    number;

  endPresentationIndex:
    number;

  startPtsTicks:
    number;

  startPtsTimescale:
    number;

  endPtsTicks:
    number;

  endPtsTimescale:
    number;

  startTimeSeconds:
    number;

  endTimeSeconds:
    number;

  /*
   * Exact first-missing to last-missing
   * presentation timestamp span.
   *
   * Frame count is exported separately so
   * a one-frame failure remains explicit
   * even though its PTS span is zero.
   */
  ptsSpanSeconds:
    number;

  frameCount:
    number;

  trialLocation:
    BatchTrackingFailureLocation;

  overlapsAnalyzedTrial:
    boolean;

  trialOverlapFrameCount:
    number;

  automaticMissingFrameCount:
    number;

  manualMissingCorrectionCount:
    number;
}

interface BatchEventReviewSummarySnapshot {
  automaticCount:
    number;

  confirmedCount:
    number;

  rejectedCount:
    number;

  unreviewedCount:
    number;

  editedCount:
    number;

  manualAddedCount:
    number;

  finalIncludedCount:
    number;

  targetCount:
    number;

  nonTargetCount:
    number;
}

interface BatchPrimaryReviewSnapshot {
  status:
    | 'provisional'
    | 'reviewed-with-edits'
    | 'reviewed';

  contributingEventCount:
    number;

  editedCount:
    number;

  confirmedCount:
    number;

  unreviewedCount:
    number;
}

interface BatchAnalysisSnapshot {
  schemaVersion:
    number;

  toolVersion:
    string;

  capturedAtIso:
    string;

  fileIdentity: {
    name:
      string;

    size:
      number;

    lastModified:
      number;
  };

  reviewReadiness:
    BatchReviewReadiness;

  video: {
    metadata:
      DecodeResult['metadata'];

    timingValidation:
      DecodeResult['timingValidation'];

    decodedFrames:
      number;
  };

  calibration: {
    arena:
      ArenaCalibration | null;

    holes:
      HoleGeometry | null;
  };

  settings: {
    segmentation:
      SegmentationSettings;

    trajectorySmoothing:
      TrajectorySmoothingSettings;

    trajectoryOutlier:
      TrajectoryOutlierSettings;

    orientation:
      OrientationSettings;

    holeInvestigation:
      HoleInvestigationSettings;

    escapeDetection:
      EscapeDetectionSettings;

    searchStrategy:
      SearchStrategySettings;
  };

  trial: {
    automaticWindow:
      ReturnType<
        typeof detectTrialStart
      >;

    effectiveWindow:
      ReturnType<
        typeof detectTrialStart
      >;

    startOverride:
      TrialStartOverride | null;

    detectionRate:
      number | null;
  };

  qc: {
    tracking:
      BatchTrackingQcSnapshot |
      null;

    trackingFailureRuns:
  BatchTrackingFailureRunSnapshot[];

    orientation:
      BatchOrientationQcSnapshot |
      null;

    trajectory:
      BatchTrajectoryQcSnapshot |
      null;

    outlier:
      BatchOutlierQcSnapshot |
      null;

    manualTrackCorrectionCount:
      number;
  };

  metrics: {
    primary:
      BatchPrimaryMetricsSnapshot |
      null;

    primaryReview:
      BatchPrimaryReviewSnapshot |
      null;

    escape:
      BatchEscapeMetricsSnapshot |
      null;

    trajectory:
      BatchTrajectoryMetricsSnapshot |
      null;

    targetQuadrant:
      BatchTargetQuadrantSnapshot |
      null;

    searchStrategy:
      BatchSearchStrategySnapshot |
      null;

    finalSearchStrategy:
      string | null;

    strategyOverridden:
      boolean;
  };

  investigations: {
    automatic:
      BatchAutomaticInvestigationEvents;

    final:
      FinalReviewedHoleInvestigationEvent[];

    reviewSummary:
      BatchEventReviewSummarySnapshot;

    reviewDecisions:
      HoleEventReviewDecisionMap;

    manualAdditions:
      ManualHoleEventAddition[];
  };

  escape: {
    candidate:
      BatchEscapeCandidateSnapshot;

    review:
      EscapeReviewDecision |
      null;
  };

  provenance: {
    trialStartManuallyOverridden:
      boolean;

    manualTrackCorrections:
      ManualTrackPointCorrectionMap;

    strategyOverride:
      SearchStrategyOverride |
      null;
  };
}

type CsvCell =
  | string
  | number
  | boolean
  | null;

type CsvRow =
  Record<
    string,
    CsvCell
  >;

const TRIAL_SUMMARY_COLUMNS = [
  'tool_version',
  'snapshot_schema_version',
  'file_name',
  'file_size_bytes',
  'file_last_modified_ms',
  'snapshot_captured_at_iso',

  'queue_processing_status',
  'queue_review_status',
  'snapshot_review_status',

  'target_hole_index_0based',
  'target_hole_number_1based',
  'platform_diameter_cm',
  'physical_scale_available',

  'automatic_trial_start_s',
  'trial_start_s',
  'trial_start_presentation_index_0based',
  'trial_start_provenance',
  'trajectory_analysis_duration_s',

  'target_investigation_reached',
  'first_target_onset_s',
  'primary_latency_s',
  'primary_errors',
  'primary_unique_incorrect_holes',
  'primary_repeated_incorrect_investigations',
  'observed_non_target_investigations',
  'primary_result_review_status',

  'escape_candidate_present',
  'escape_candidate_kind',
  'escape_evidence_strength',
  'escape_review_status',
  'escape_candidate_time_s',
  'escape_confirmed',

  'total_latency_s',
  'total_errors',
  'total_unique_incorrect_holes',
  'total_repeated_incorrect_investigations',
  'target_investigations_before_escape',
  'target_revisits_before_escape',

  'path_length_px',
  'path_length_cm',
  'mean_speed_px_s',
  'mean_speed_cm_s',
  'connected_mean_speed_px_s',
  'connected_mean_speed_cm_s',
  'median_step_speed_px_s',
  'median_step_speed_cm_s',

  'target_quadrant_time_s',
  'target_quadrant_time_fraction',
  'target_quadrant_path_fraction',
  'target_quadrant_entries',
  'trajectory_time_coverage_fraction',

  'automatic_strategy',
  'automatic_strategy_confidence',
  'final_strategy',
  'strategy_overridden',
  'path_efficiency',
  'hole_transition_count',
  'adjacent_transition_fraction',
  'directional_consistency',
  'direction_reversal_fraction',
  'perimeter_time_fraction',
  'investigated_hole_sequence_0based',
'investigated_hole_sequence_1based',

  'trial_tracking_detection_fraction',
'whole_recording_visible_frames',
'whole_recording_partial_detection_frames',
'whole_recording_missing_run_count',
'whole_recording_longest_missing_run_s',

  'orientation_resolved_fraction',

  'isolated_outliers_rejected',
  'outlier_rejected_fraction',
  'manual_track_corrections',

  'automatic_investigations',
  'confirmed_investigations',
  'edited_investigations',
  'rejected_investigations',
  'manual_added_investigations',
  'unreviewed_investigations',
  'current_included_investigations',
] as const;

const INVESTIGATION_EVENT_COLUMNS = [
  'tool_version',
  'snapshot_schema_version',
  'file_name',
  'event_id',

  'source_type',
'included_in_current_analysis',
'review_status',
'provenance',

'automatic_event_number_1based',
'automatic_hole_index_0based',
'automatic_hole_number_1based',
'automatic_is_target',
'automatic_start_presentation_index_0based',
'automatic_end_presentation_index_0based',
'automatic_start_s',
'automatic_end_s',
'automatic_duration_s',
'automatic_positive_observation_count',
'automatic_min_nose_distance_px',
'automatic_closest_nose_x_px',
'automatic_closest_nose_y_px',

'analysis_hole_index_0based',
'analysis_hole_number_1based',
'analysis_is_target',
'analysis_start_presentation_index_0based',
'analysis_end_presentation_index_0based',
'analysis_start_s',
'analysis_end_s',
'analysis_duration_s',

  'review_note',
  'reviewed_at_iso',
] as const;
const ANALYSIS_PARAMETER_COLUMNS = [
  'tool_version',
  'snapshot_schema_version',
  'file_name',
  'snapshot_captured_at_iso',

  'arena_center_x_px',
  'arena_center_y_px',
  'platform_radius_px',
  'tracking_margin_px',
  'platform_diameter_cm',

  'hole_count',
  'hole_roi_radius_px',
  'target_hole_index_0based',
  'target_hole_number_1based',
  'manually_adjusted_holes',

  'segmentation_difference_threshold',
  'segmentation_min_component_area_px',

  'trajectory_median_window_s',
  'trajectory_mean_window_s',
  'trajectory_max_gap_s',

  'outlier_rejection_enabled',
  'outlier_max_jump_speed_px_s',

  'orientation_motion_lookback_s',
  'orientation_min_directional_speed_px_s',
  'orientation_min_motion_alignment',
  'orientation_max_continuity_gap_s',
  'orientation_min_continuity_alignment',
  'orientation_min_shape_confidence',

  'investigation_entry_margin_px',
  'investigation_sustain_margin_px',
  'investigation_min_dwell_s',
  'investigation_max_interruption_s',
  'investigation_min_head_hole_alignment',

  'escape_min_terminal_absence_s',
  'escape_lookback_s',
  'escape_proximity_margin_px',
  'escape_max_terminal_body_area_fraction',
  'escape_min_terminal_collapse_s',
  'escape_max_s_from_target_end_to_disappearance',
  'escape_max_s_from_target_end_to_recording_end',

  'strategy_max_direct_primary_errors',
  'strategy_max_direct_unique_incorrect_holes',
  'strategy_max_direct_incorrect_hole_distance',
  'strategy_min_direct_path_efficiency',
  'strategy_min_serial_adjacent_transition_fraction',
  'strategy_min_serial_directional_consistency',
  'strategy_max_serial_direction_reversal_fraction',
'strategy_min_serial_perimeter_time_fraction',
'strategy_perimeter_radius_fraction',
'strategy_min_transitions_for_serial',

'trial_start_minimum_presence_s',
'target_quadrant_width_deg',
] as const;

const TRACKING_QC_COLUMNS = [
  'tool_version',
  'snapshot_schema_version',
  'file_name',

  'failure_run_number_1based',

  'start_presentation_index_0based',
  'end_presentation_index_0based',

  'start_pts_ticks',
  'start_pts_timescale',
  'end_pts_ticks',
  'end_pts_timescale',

  'start_s',
  'end_s',
  'pts_span_s',
  'frame_count',

  'trial_location',
  'overlaps_analyzed_trial',
  'trial_overlap_frame_count',

  'automatic_missing_frames',
  'manual_missing_corrections_in_run',

  'trial_tracking_detection_fraction',
  'whole_recording_missing_run_count',
  'whole_recording_visible_frames',
  'whole_recording_partial_detection_frames',
  'manual_track_corrections',
] as const;

const ROI_COLUMNS = [
  'tool_version',
  'snapshot_schema_version',
  'file_name',

  'roi_type',

  'roi_index_0based',
  'roi_number_1based',

  'position_provenance',

  'automatic_center_x_px',
  'automatic_center_y_px',

  'analysis_center_x_px',
  'analysis_center_y_px',

  'center_adjustment_distance_px',

  'radius_px',

  'is_target',
  'manually_adjusted',

  'tracking_margin_px',
  'platform_diameter_cm',
] as const;

function rationalSeconds(
  value:
    | {
        ticks: number;
        timescale: number;
      }
    | null
    | undefined,
): number | null {
  if (
    !value ||
    value.timescale === 0
  ) {
    return null;
  }

  return (
    value.ticks /
    value.timescale
  );
}

function buildTrackingFailureRuns(
  track:
    BodyTrack,

  trialWindow:
    ReturnType<
      typeof detectTrialStart
    >,

  manualCorrections:
    ManualTrackPointCorrectionMap,
):
  BatchTrackingFailureRunSnapshot[] {
  if (
    !trialWindow ||
    track.points.length === 0
  ) {
    return [];
  }

  const runs:
    BatchTrackingFailureRunSnapshot[] =
    [];

  const points =
    track.points;

  const trialStart =
    trialWindow
      .startPresentationIndex;

  const trialEnd =
    trialWindow
      .endPresentationIndex ??
    Number.POSITIVE_INFINITY;

  let runStartArrayIndex:
    number | null =
    null;

  function finishRun(
    runEndArrayIndex:
      number,
  ) {
    if (
      runStartArrayIndex ===
      null
    ) {
      return;
    }

    const first =
      points[
        runStartArrayIndex
      ];

    const last =
      points[
        runEndArrayIndex
      ];

    const startTimeSeconds =
      timeToSeconds(
        first.pts,
      );

    const endTimeSeconds =
      timeToSeconds(
        last.pts,
      );

    let trialLocation:
      BatchTrackingFailureLocation;

    if (
      last.presentationIndex <
      trialStart
    ) {
      trialLocation =
        'pre-trial';
    } else if (
      first.presentationIndex >
      trialEnd
    ) {
      trialLocation =
        'post-trial';
    } else if (
      first.presentationIndex >=
        trialStart &&
      last.presentationIndex <=
        trialEnd
    ) {
      trialLocation =
        'within-trial';
    } else {
      trialLocation =
        'crosses-trial-boundary';
    }

    let trialOverlapFrameCount =
      0;

    let manualMissingCorrectionCount =
      0;

    for (
      let index =
        runStartArrayIndex;
      index <=
        runEndArrayIndex;
      index += 1
    ) {
      const point =
        points[index];

      if (
        point.presentationIndex >=
          trialStart &&
        point.presentationIndex <=
          trialEnd
      ) {
        trialOverlapFrameCount +=
          1;
      }

      const correction =
        manualCorrections[
          String(
            point
              .presentationIndex,
          )
        ];

      if (
        correction?.kind ===
        'missing'
      ) {
        manualMissingCorrectionCount +=
          1;
      }
    }

    const frameCount =
      runEndArrayIndex -
      runStartArrayIndex +
      1;

    runs.push({
      startPresentationIndex:
        first.presentationIndex,

      endPresentationIndex:
        last.presentationIndex,

      startPtsTicks:
        first.pts.ticks,

      startPtsTimescale:
        first.pts.timescale,

      endPtsTicks:
        last.pts.ticks,

      endPtsTimescale:
        last.pts.timescale,

      startTimeSeconds,

      endTimeSeconds,

      ptsSpanSeconds:
        Math.max(
          0,
          endTimeSeconds -
            startTimeSeconds,
        ),

      frameCount,

      trialLocation,

      overlapsAnalyzedTrial:
        trialOverlapFrameCount >
        0,

      trialOverlapFrameCount,

      automaticMissingFrameCount:
        Math.max(
          0,
          frameCount -
            manualMissingCorrectionCount,
        ),

      manualMissingCorrectionCount,
    });

    runStartArrayIndex =
      null;
  }

  for (
    let index = 0;
    index <
      points.length;
    index += 1
  ) {
    const point =
      points[index];

    const missing =
      point.x === null ||
      point.y === null;

    if (missing) {
      if (
        runStartArrayIndex ===
        null
      ) {
        runStartArrayIndex =
          index;
      }

      continue;
    }

    if (
      runStartArrayIndex !==
      null
    ) {
      finishRun(
        index - 1,
      );
    }
  }

  if (
    runStartArrayIndex !==
    null
  ) {
    finishRun(
      points.length - 1,
    );
  }

  return runs;
}

function buildTrialSummaryRows(
  batchItems:
    BatchItem[],

  snapshots:
    Record<
      string,
      BatchAnalysisSnapshot
    >,
): CsvRow[] {
  const rows:
    CsvRow[] = [];

  for (const item of batchItems) {
    const snapshot =
      snapshots[
        item.id
      ];

    if (!snapshot) {
      continue;
    }

    const primary =
      snapshot.metrics
        .primary;

    const escapeMetrics =
      snapshot.metrics
        .escape;

    const trajectory =
      snapshot.metrics
        .trajectory;

    const quadrant =
      snapshot.metrics
        .targetQuadrant
        ?.analyzedTrial ??
      null;

    const strategy =
      snapshot.metrics
        .searchStrategy;

    const candidate =
      snapshot.escape
        .candidate;

    const escapeReview =
      snapshot.escape
        .review;

    const trackingQc =
      snapshot.qc
        .tracking;

    const orientationQc =
      snapshot.qc
        .orientation;

    const outlierQc =
      snapshot.qc
        .outlier;

    const eventSummary =
      snapshot
        .investigations
        .reviewSummary;

    const longestMissingRun =
      trackingQc
        ?.missingRuns
        .reduce<
          typeof trackingQc
            .missingRuns[number] |
          null
        >(
          (
            longest,
            run,
          ) =>
            !longest ||
            run.durationSeconds >
              longest.durationSeconds
              ? run
              : longest,
          null,
        ) ??
      null;

    const platformDiameterCm =
      snapshot
        .calibration
        .arena
        ?.platformDiameterCm ??
      null;

    rows.push({
      tool_version:
        snapshot.toolVersion,

      snapshot_schema_version:
        snapshot.schemaVersion,

      file_name:
        snapshot.fileIdentity
          .name,

      file_size_bytes:
        snapshot.fileIdentity
          .size,

      file_last_modified_ms:
        snapshot.fileIdentity
          .lastModified,

      snapshot_captured_at_iso:
        snapshot.capturedAtIso,

      /*
       * Queue state and snapshot state are
       * deliberately both preserved.
       *
       * Example:
       * reopening a captured video can make
       * queue_review_status = needs-tracking
       * while the last successful snapshot
       * remains available.
       */
      queue_processing_status:
        item.status,

      queue_review_status:
        item.reviewReadiness,

      snapshot_review_status:
        snapshot.reviewReadiness,

target_hole_index_0based:
  snapshot
    .calibration
    .holes
    ?.targetHoleIndex ??
  null,

target_hole_number_1based:
  snapshot
    .calibration
    .holes
    ?.targetHoleIndex !==
  undefined
    ? snapshot
        .calibration
        .holes
        .targetHoleIndex +
      1
    : null,

      platform_diameter_cm:
        platformDiameterCm,

      physical_scale_available:
        platformDiameterCm !==
        null,

      automatic_trial_start_s:
        rationalSeconds(
          snapshot.trial
            .automaticWindow
            ?.startPts,
        ),

      trial_start_s:
        rationalSeconds(
          snapshot.trial
            .effectiveWindow
            ?.startPts,
        ),

      trial_start_presentation_index_0based:
        snapshot.trial
          .effectiveWindow
          ?.startPresentationIndex ??
        null,

      trial_start_provenance:
        snapshot.provenance
          .trialStartManuallyOverridden
          ? 'manual-override'
          : 'automatic',

trajectory_analysis_duration_s:
  trajectory
    ?.trialDurationSeconds ??
  null,

      target_investigation_reached:
        primary
          ?.targetInvestigationFound ??
        false,

      first_target_onset_s:
        primary
          ?.firstTargetEvent
          ?.startTimeSeconds ??
        null,

      primary_latency_s:
        primary
          ?.primaryLatencySeconds ??
        null,

      primary_errors:
        primary
          ?.primaryErrorCount ??
        null,

      primary_unique_incorrect_holes:
        primary
          ?.uniqueIncorrectHoleCount ??
        null,

      primary_repeated_incorrect_investigations:
        primary
          ?.repeatedIncorrectInvestigationCount ??
        null,

      observed_non_target_investigations:
        primary
          ?.observedNonTargetInvestigationCount ??
        null,

      primary_result_review_status:
        snapshot.metrics
          .primaryReview
          ?.status ??
        null,

      escape_candidate_present:
        candidate !== null,

      escape_candidate_kind:
        candidate?.kind ??
        null,

      escape_evidence_strength:
        candidate
          ?.evidenceStrength ??
        null,

      escape_review_status:
        candidate
          ? (
              escapeReview
                ?.status ??
              'unreviewed'
            )
          : 'no-candidate',

      escape_candidate_time_s:
        candidate
          ?.escapeTimeSeconds ??
        null,

      escape_confirmed:
        escapeMetrics
          ?.escapeConfirmed ??
        false,

      total_latency_s:
        escapeMetrics
          ?.totalLatencySeconds ??
        null,

      total_errors:
        escapeMetrics
          ?.totalErrorCount ??
        null,

      total_unique_incorrect_holes:
        escapeMetrics
          ?.uniqueTotalIncorrectHoleCount ??
        null,

      total_repeated_incorrect_investigations:
        escapeMetrics
          ?.repeatedTotalIncorrectInvestigationCount ??
        null,

      target_investigations_before_escape:
        escapeMetrics
          ?.targetInvestigationsBeforeEscape ??
        null,

      target_revisits_before_escape:
        escapeMetrics
          ?.targetRevisitsBeforeEscape ??
        null,

      path_length_px:
        trajectory
          ?.pathLengthPixels ??
        null,

      path_length_cm:
        trajectory
          ?.pathLengthCm ??
        null,

      mean_speed_px_s:
        trajectory
          ?.meanSpeedPixelsPerSecond ??
        null,

      mean_speed_cm_s:
        trajectory
          ?.meanSpeedCmPerSecond ??
        null,

      connected_mean_speed_px_s:
        trajectory
          ?.connectedMeanSpeedPixelsPerSecond ??
        null,

      connected_mean_speed_cm_s:
        trajectory
          ?.connectedMeanSpeedCmPerSecond ??
        null,

      median_step_speed_px_s:
        trajectory
          ?.medianStepSpeedPixelsPerSecond ??
        null,

      median_step_speed_cm_s:
        trajectory
          ?.medianStepSpeedCmPerSecond ??
        null,

      target_quadrant_time_s:
        quadrant
          ?.targetQuadrantTimeSeconds ??
        null,

      target_quadrant_time_fraction:
        quadrant
          ?.targetQuadrantTimeFraction ??
        null,

      target_quadrant_path_fraction:
        quadrant
          ?.targetQuadrantPathFraction ??
        null,

      target_quadrant_entries:
        quadrant
          ?.targetQuadrantEntryCount ??
        null,

      trajectory_time_coverage_fraction:
        quadrant
          ?.observedCoverageFraction ??
        null,

      automatic_strategy:
        strategy
          ?.automaticStrategy ??
        null,

      automatic_strategy_confidence:
        strategy
          ?.confidence ??
        null,

      final_strategy:
        snapshot.metrics
          .finalSearchStrategy,

      strategy_overridden:
        snapshot.metrics
          .strategyOverridden,

      path_efficiency:
        strategy
          ?.pathEfficiency ??
        null,

      hole_transition_count:
        strategy
          ?.holeTransitionCount ??
        null,

      adjacent_transition_fraction:
        strategy
          ?.adjacentTransitionFraction ??
        null,

      directional_consistency:
        strategy
          ?.directionalConsistency ??
        null,

      direction_reversal_fraction:
        strategy
          ?.directionReversalFraction ??
        null,

      perimeter_time_fraction:
        strategy
          ?.perimeterTimeFraction ??
        null,

investigated_hole_sequence_0based:
  strategy
    ?.investigatedHoleSequence
    .join(' > ') ??
  '',

investigated_hole_sequence_1based:
  strategy
    ?.investigatedHoleSequence
    .map(
      (holeIndex) =>
        holeIndex + 1,
    )
    .join(' > ') ??
  '',

trial_tracking_detection_fraction:
  snapshot.trial
    .detectionRate,

whole_recording_visible_frames:
  trackingQc
    ?.visibleFrames ??
  null,

whole_recording_partial_detection_frames:
  trackingQc
    ?.partialFrames ??
  null,

whole_recording_missing_run_count:
  trackingQc
    ?.missingRuns
    .length ??
  null,

whole_recording_longest_missing_run_s:
  longestMissingRun
    ?.durationSeconds ??
  null,

      orientation_resolved_fraction:
        orientationQc
          ?.resolvedFraction ??
        null,

      isolated_outliers_rejected:
        outlierQc
          ?.rejectedCount ??
        0,

      outlier_rejected_fraction:
        outlierQc
          ?.rejectedFraction ??
        0,

      manual_track_corrections:
        snapshot.qc
          .manualTrackCorrectionCount,

      automatic_investigations:
        eventSummary
          .automaticCount,

      confirmed_investigations:
        eventSummary
          .confirmedCount,

      edited_investigations:
        eventSummary
          .editedCount,

      rejected_investigations:
        eventSummary
          .rejectedCount,

      manual_added_investigations:
        eventSummary
          .manualAddedCount,

      unreviewed_investigations:
        eventSummary
          .unreviewedCount,

      current_included_investigations:
        eventSummary
          .finalIncludedCount,
    });
  }

  return rows;
}

function buildInvestigationEventRows(
  batchItems:
    BatchItem[],

  snapshots:
    Record<
      string,
      BatchAnalysisSnapshot
    >,
): CsvRow[] {
  const rows:
    CsvRow[] = [];

  for (const item of batchItems) {
    const snapshot =
      snapshots[
        item.id
      ];

    if (!snapshot) {
      continue;
    }

    const automaticEvents =
      snapshot
        .investigations
        .automatic;

    const finalEvents =
      snapshot
        .investigations
        .final;

    /*
     * First export every automatic detector
     * result — including ones the reviewer
     * rejected.
     */
    for (
      const automaticEvent of
      automaticEvents
    ) {
      const reviewKey =
        holeEventReviewKey(
          automaticEvent,
        );

      const decision =
        snapshot
          .investigations
          .reviewDecisions[
          reviewKey
        ];

      const reviewStatus =
        decision?.status ??
        'unreviewed';

      const finalEvent =
        finalEvents.find(
          (candidate) =>
            candidate
              .automaticEventIndex ===
            automaticEvent
              .eventIndex,
        ) ??
        null;

      const included =
        finalEvent !==
        null;

      rows.push({
        tool_version:
          snapshot.toolVersion,

        snapshot_schema_version:
          snapshot.schemaVersion,

        file_name:
          snapshot.fileIdentity
            .name,

        event_id:
          finalEvent
            ?.finalEventKey ??
          `automatic:${reviewKey}`,

        source_type:
          'automatic',

        included_in_current_analysis:
          included,

        review_status:
          reviewStatus,

        provenance:
          reviewStatus ===
          'rejected'
            ? 'automatic-manually-rejected'
            : (
                finalEvent
                  ?.provenance ??
                'automatic-unreviewed'
              ),

        automatic_event_number_1based:
          automaticEvent
            .eventIndex +
          1,

automatic_hole_index_0based:
  automaticEvent
    .holeIndex,

automatic_hole_number_1based:
  automaticEvent
    .holeIndex +
  1,

        automatic_is_target:
          automaticEvent
            .isTarget,

        automatic_start_presentation_index_0based:
          automaticEvent
            .startPresentationIndex,

        automatic_end_presentation_index_0based:
          automaticEvent
            .endPresentationIndex,

        automatic_start_s:
          automaticEvent
            .startTimeSeconds,

        automatic_end_s:
          automaticEvent
            .endTimeSeconds,

        automatic_duration_s:
          automaticEvent
            .durationSeconds,

        automatic_positive_observation_count:
          automaticEvent
            .positiveObservationCount,

        automatic_min_nose_distance_px:
          automaticEvent
            .minimumNoseDistancePixels,

        automatic_closest_nose_x_px:
          automaticEvent
            .closestNoseX,

        automatic_closest_nose_y_px:
          automaticEvent
            .closestNoseY,

        /*
         * These are deliberately blank for a
         * rejected automatic detection.
         */
analysis_hole_index_0based:
  finalEvent
    ?.holeIndex ??
  null,

analysis_hole_number_1based:
  finalEvent
    ? finalEvent.holeIndex +
      1
    : null,

analysis_is_target:
  finalEvent
    ?.isTarget ??
  null,

analysis_start_presentation_index_0based:
  finalEvent
    ?.startPresentationIndex ??
  null,

analysis_end_presentation_index_0based:
  finalEvent
    ?.endPresentationIndex ??
  null,

analysis_start_s:
  finalEvent
    ?.startTimeSeconds ??
  null,

analysis_end_s:
  finalEvent
    ?.endTimeSeconds ??
  null,

analysis_duration_s:
  finalEvent
    ?.durationSeconds ??
  null,

        review_note:
          decision?.note ??
          finalEvent
            ?.reviewNote ??
          '',

        reviewed_at_iso:
          decision
            ?.reviewedAtIso ??
          finalEvent
            ?.reviewedAtIso ??
          null,
      });
    }

    /*
     * Manual additions do not have automatic
     * detector evidence. Export those fields as
     * blank rather than pretending the automatic
     * evidence was recomputed.
     */
    for (
      const finalEvent of
      finalEvents
    ) {
      if (
        finalEvent
          .automaticEventIndex !==
        null
      ) {
        continue;
      }

      rows.push({
        tool_version:
          snapshot.toolVersion,

        snapshot_schema_version:
          snapshot.schemaVersion,

        file_name:
          snapshot.fileIdentity
            .name,

        event_id:
          finalEvent
            .finalEventKey,

        source_type:
          'manual-added',

        included_in_current_analysis:
          true,

        review_status:
          finalEvent
            .reviewStatus,

        provenance:
          finalEvent
            .provenance,

        automatic_event_number_1based:
          null,

automatic_hole_index_0based:
  null,

automatic_hole_number_1based:
  null,

        automatic_is_target:
          null,

        automatic_start_presentation_index_0based:
          null,

        automatic_end_presentation_index_0based:
          null,

        automatic_start_s:
          null,

        automatic_end_s:
          null,

        automatic_duration_s:
          null,

        automatic_positive_observation_count:
          null,

        automatic_min_nose_distance_px:
          null,

        automatic_closest_nose_x_px:
          null,

        automatic_closest_nose_y_px:
          null,

        analysis_hole_index_0based:
  finalEvent
    .holeIndex,

analysis_hole_number_1based:
  finalEvent
    .holeIndex +
  1,

analysis_is_target:
  finalEvent
    .isTarget,

analysis_start_presentation_index_0based:
  finalEvent
    .startPresentationIndex,

analysis_end_presentation_index_0based:
  finalEvent
    .endPresentationIndex,

analysis_start_s:
  finalEvent
    .startTimeSeconds,

analysis_end_s:
  finalEvent
    .endTimeSeconds,

analysis_duration_s:
  finalEvent
    .durationSeconds,

        review_note:
          finalEvent
            .reviewNote,

        reviewed_at_iso:
          finalEvent
            .reviewedAtIso,
      });
    }
  }

  return rows;
}
function buildAnalysisParameterRows(
  batchItems: BatchItem[],
  snapshots: Record<
    string,
    BatchAnalysisSnapshot
  >,
): CsvRow[] {
  const rows: CsvRow[] = [];

  for (const item of batchItems) {
    const snapshot =
      snapshots[item.id];

    if (!snapshot) {
      continue;
    }

    const arena =
      snapshot.calibration.arena;

    const holes =
      snapshot.calibration.holes;

    const segmentation =
      snapshot.settings.segmentation;

    const smoothing =
      snapshot.settings
        .trajectorySmoothing;

    const outlier =
      snapshot.settings
        .trajectoryOutlier;

    const orientation =
      snapshot.settings.orientation;

    const investigation =
      snapshot.settings
        .holeInvestigation;

    const escape =
      snapshot.settings
        .escapeDetection;

    const strategy =
      snapshot.settings
        .searchStrategy;

    rows.push({
      tool_version:
        snapshot.toolVersion,

      snapshot_schema_version:
        snapshot.schemaVersion,

      file_name:
        snapshot.fileIdentity.name,

      snapshot_captured_at_iso:
        snapshot.capturedAtIso,

      arena_center_x_px:
        arena?.centerX ?? null,

      arena_center_y_px:
        arena?.centerY ?? null,

      platform_radius_px:
        arena
          ?.platformRadiusPixels ??
        null,

      tracking_margin_px:
        arena
          ?.trackingMarginPixels ??
        null,

      platform_diameter_cm:
        arena
          ?.platformDiameterCm ??
        null,

      hole_count:
        holes?.holeCount ??
        null,

      hole_roi_radius_px:
        holes
          ?.holeRadiusPixels ??
        null,

      target_hole_index_0based:
        holes
          ?.targetHoleIndex ??
        null,

      target_hole_number_1based:
        holes
          ? holes.targetHoleIndex + 1
          : null,

      manually_adjusted_holes:
        holes
          ? holes.holes.filter(
              (hole) =>
                hole.manuallyAdjusted,
            ).length
          : null,

      segmentation_difference_threshold:
        segmentation
          .differenceThreshold,

      segmentation_min_component_area_px:
        segmentation
          .minimumComponentAreaPixels,

      trajectory_median_window_s:
        smoothing
          .medianWindowSeconds,

      trajectory_mean_window_s:
        smoothing
          .meanWindowSeconds,

      trajectory_max_gap_s:
        smoothing
          .maxGapSeconds,

      outlier_rejection_enabled:
        outlier.enabled,

      outlier_max_jump_speed_px_s:
        outlier
          .maximumJumpSpeedPixelsPerSecond,

      orientation_motion_lookback_s:
        orientation
          .motionLookbackSeconds,

      orientation_min_directional_speed_px_s:
        orientation
          .minimumDirectionalSpeedPixelsPerSecond,

      orientation_min_motion_alignment:
        orientation
          .minimumMotionAlignment,

      orientation_max_continuity_gap_s:
        orientation
          .maximumContinuityGapSeconds,

      orientation_min_continuity_alignment:
        orientation
          .minimumContinuityAlignment,

      orientation_min_shape_confidence:
        orientation
          .minimumShapeConfidence,

      investigation_entry_margin_px:
        investigation
          .entryMarginPixels,

      investigation_sustain_margin_px:
        investigation
          .sustainMarginPixels,

      investigation_min_dwell_s:
        investigation
          .minimumDwellSeconds,

      investigation_max_interruption_s:
        investigation
          .maximumInterruptionSeconds,

      investigation_min_head_hole_alignment:
        investigation
          .minimumHeadHoleAlignment,

      escape_min_terminal_absence_s:
        escape
          .minimumTerminalAbsenceSeconds,

      escape_lookback_s:
        escape
          .escapeLookbackSeconds,

      escape_proximity_margin_px:
        escape
          .escapeProximityMarginPixels,

      escape_max_terminal_body_area_fraction:
        escape
          .maximumTerminalBodyAreaFraction,

      escape_min_terminal_collapse_s:
        escape
          .minimumTerminalCollapseSeconds,

      escape_max_s_from_target_end_to_disappearance:
        escape
          .maximumSecondsFromTargetEndToDisappearance,

      escape_max_s_from_target_end_to_recording_end:
        escape
          .maximumSecondsFromTargetEndToRecordingEnd,

      strategy_max_direct_primary_errors:
        strategy
          .maxDirectPrimaryErrors,

      strategy_max_direct_unique_incorrect_holes:
        strategy
          .maxDirectUniqueIncorrectHoles,

      strategy_max_direct_incorrect_hole_distance:
        strategy
          .maxDirectIncorrectHoleDistance,

      strategy_min_direct_path_efficiency:
        strategy
          .minimumDirectPathEfficiency,

      strategy_min_serial_adjacent_transition_fraction:
        strategy
          .minimumSerialAdjacentTransitionFraction,

      strategy_min_serial_directional_consistency:
        strategy
          .minimumSerialDirectionalConsistency,

      strategy_max_serial_direction_reversal_fraction:
        strategy
          .maximumSerialDirectionReversalFraction,

      strategy_min_serial_perimeter_time_fraction:
        strategy
          .minimumSerialPerimeterTimeFraction,

      strategy_perimeter_radius_fraction:
        strategy
          .perimeterRadiusFraction,

strategy_min_transitions_for_serial:
  strategy
    .minimumTransitionsForSerial,

/*
 * Analysis definitions that currently
 * remain fixed rather than user-configurable.
 */
trial_start_minimum_presence_s:
  0.5,

target_quadrant_width_deg:
  90,
});
  }

  return rows;
}

function buildTrackingQcRows(
  batchItems:
    BatchItem[],

  snapshots:
    Record<
      string,
      BatchAnalysisSnapshot
    >,
): CsvRow[] {
  const rows:
    CsvRow[] = [];

  for (const item of batchItems) {
    const snapshot =
      snapshots[item.id];

    if (!snapshot) {
      continue;
    }

    const tracking =
      snapshot.qc.tracking;

    const failureRuns =
      snapshot.qc
        .trackingFailureRuns;

    for (
      let index = 0;
      index <
        failureRuns.length;
      index += 1
    ) {
      const run =
        failureRuns[index];

      rows.push({
        tool_version:
          snapshot.toolVersion,

        snapshot_schema_version:
          snapshot.schemaVersion,

        file_name:
          snapshot
            .fileIdentity
            .name,

        failure_run_number_1based:
          index + 1,

        start_presentation_index_0based:
          run.startPresentationIndex,

        end_presentation_index_0based:
          run.endPresentationIndex,

        start_pts_ticks:
          run.startPtsTicks,

        start_pts_timescale:
          run.startPtsTimescale,

        end_pts_ticks:
          run.endPtsTicks,

        end_pts_timescale:
          run.endPtsTimescale,

        start_s:
          run.startTimeSeconds,

        end_s:
          run.endTimeSeconds,

        pts_span_s:
          run.ptsSpanSeconds,

        frame_count:
          run.frameCount,

        trial_location:
          run.trialLocation,

        overlaps_analyzed_trial:
          run.overlapsAnalyzedTrial,

        trial_overlap_frame_count:
          run.trialOverlapFrameCount,

        automatic_missing_frames:
          run.automaticMissingFrameCount,

        manual_missing_corrections_in_run:
          run.manualMissingCorrectionCount,

        trial_tracking_detection_fraction:
          snapshot.trial
            .detectionRate,

        whole_recording_missing_run_count:
          tracking
            ?.missingRuns
            .length ??
          null,

        whole_recording_visible_frames:
          tracking
            ?.visibleFrames ??
          null,

        whole_recording_partial_detection_frames:
          tracking
            ?.partialFrames ??
          null,

        manual_track_corrections:
          snapshot.qc
            .manualTrackCorrectionCount,
      });
    }
  }

  return rows;
}

function buildRoiRows(
  batchItems:
    BatchItem[],

  snapshots:
    Record<
      string,
      BatchAnalysisSnapshot
    >,
): CsvRow[] {
  const rows:
    CsvRow[] = [];

  for (const item of batchItems) {
    const snapshot =
      snapshots[item.id];

    if (!snapshot) {
      continue;
    }

    const arena =
      snapshot
        .calibration
        .arena;

    const geometry =
      snapshot
        .calibration
        .holes;

    /*
     * Arena itself is also an ROI because
     * tracking and physical scaling depend
     * directly on this geometry.
     */
    if (arena) {
      rows.push({
        tool_version:
          snapshot.toolVersion,

        snapshot_schema_version:
          snapshot.schemaVersion,

        file_name:
          snapshot
            .fileIdentity
            .name,

        roi_type:
          'arena',

        roi_index_0based:
          null,

        roi_number_1based:
          null,

        position_provenance:
          'arena-calibration',

        automatic_center_x_px:
          null,

        automatic_center_y_px:
          null,

        analysis_center_x_px:
          arena.centerX,

        analysis_center_y_px:
          arena.centerY,

        center_adjustment_distance_px:
          null,

        radius_px:
          arena
            .platformRadiusPixels,

        is_target:
          null,

        manually_adjusted:
          null,

        tracking_margin_px:
          arena
            .trackingMarginPixels,

        platform_diameter_cm:
          arena
            .platformDiameterCm ??
          null,
      });
    }

    if (!geometry) {
      continue;
    }

    for (
      const hole of
      geometry.holes
    ) {
      const dx =
        hole.centerX -
        hole.automaticCenterX;

      const dy =
        hole.centerY -
        hole.automaticCenterY;

      rows.push({
        tool_version:
          snapshot.toolVersion,

        snapshot_schema_version:
          snapshot.schemaVersion,

        file_name:
          snapshot
            .fileIdentity
            .name,

        roi_type:
          'hole',

        roi_index_0based:
          hole.index,

        roi_number_1based:
          hole.index + 1,

        position_provenance:
          hole.manuallyAdjusted
            ? 'manual-adjusted'
            : 'automatic',

        automatic_center_x_px:
          hole.automaticCenterX,

        automatic_center_y_px:
          hole.automaticCenterY,

        analysis_center_x_px:
          hole.centerX,

        analysis_center_y_px:
          hole.centerY,

        center_adjustment_distance_px:
          Math.hypot(
            dx,
            dy,
          ),

        radius_px:
          hole.radiusPixels,

        is_target:
          hole.isTarget,

        manually_adjusted:
          hole.manuallyAdjusted,

        tracking_margin_px:
          arena
            ?.trackingMarginPixels ??
          null,

        platform_diameter_cm:
          arena
            ?.platformDiameterCm ??
          null,
      });
    }
  }

  return rows;
}

function csvCellText(
  value:
    CsvCell,
): string {
  if (
    value === null
  ) {
    return '';
  }

  let text =
    typeof value ===
    'boolean'
      ? (
          value
            ? 'true'
            : 'false'
        )
      : String(
          value,
        );

  /*
   * Protect text opened in Excel from being
   * interpreted as a formula.
   *
   * Numeric values are not modified.
   */
  if (
    typeof value ===
      'string' &&
    /^[=+\-@]/.test(
      text,
    )
  ) {
    text =
      `'${text}`;
  }

  if (
    /[",\r\n]/.test(
      text,
    )
  ) {
    return (
      `"${text.replace(
        /"/g,
        '""',
      )}"`
    );
  }

  return text;
}

function rowsToCsv(
  columns:
    readonly string[],

  rows:
    CsvRow[],
): string {
  const lines = [
    columns
      .map(
        (column) =>
          csvCellText(
            column,
          ),
      )
      .join(','),
  ];

  for (const row of rows) {
    lines.push(
      columns
        .map(
          (column) =>
            csvCellText(
              row[column] ??
              null,
            ),
        )
        .join(','),
    );
  }

  return lines.join(
    '\r\n',
  );
}

function downloadCsv(
  filename:
    string,

  columns:
    readonly string[],

  rows:
    CsvRow[],
) {
  /*
   * UTF-8 BOM improves compatibility with
   * desktop Excel while remaining a valid CSV.
   */
  const content =
    '\uFEFF' +
    rowsToCsv(
      columns,
      rows,
    );

  const blob =
    new Blob(
      [content],
      {
        type:
          'text/csv;charset=utf-8',
      },
    );

  const url =
    URL.createObjectURL(
      blob,
    );

  const anchor =
    document.createElement(
      'a',
    );

  anchor.href =
    url;

  anchor.download =
    filename;

  anchor.style.display =
    'none';

  document.body.appendChild(
    anchor,
  );

  anchor.click();

  anchor.remove();

  window.setTimeout(
    () => {
      URL.revokeObjectURL(
        url,
      );
    },
    0,
  );
}
async function downloadAnalysisWorkbook(
  filename: string,
  trialRows: CsvRow[],
  eventRows: CsvRow[],
  parameterRows: CsvRow[],
  trackingQcRows: CsvRow[],
  roiRows: CsvRow[],
) {
  const {
    Workbook,
  } = await import(
    'exceljs'
  );

  const workbook =
    new Workbook();

  workbook.creator =
    'Barnes Maze Analyzer';

  workbook.subject =
    'Barnes maze behavioral analysis';

  workbook.title =
    'Barnes Maze Analysis Results';

  workbook.created =
    new Date();

function addDataSheet(
  name: string,
  columns: readonly string[],
  rows: CsvRow[],
  frozenColumns = 0,
) {
    const worksheet =
      workbook.addWorksheet(
        name,
        {
         views: [
  {
    state: 'frozen',
    ySplit: 1,
    xSplit:
      frozenColumns,
  },
],
        },
      );

    worksheet.columns =
      columns.map(
        (column) => ({
          header: column,
          key: column,

          width:
            Math.min(
              38,
              Math.max(
                12,
                column.length + 2,
              ),
            ),
        }),
      );

    for (const row of rows) {
      worksheet.addRow(
        row,
      );
    }
    for (
  let index = 0;
  index < columns.length;
  index += 1
) {
  const name =
    columns[index];

  const column =
    worksheet.getColumn(
      index + 1,
    );

  if (
    name ===
      'file_last_modified_ms' ||
    name.endsWith(
      '_index_0based',
    ) ||
    name.endsWith(
      '_number_1based',
    ) ||
    name.endsWith(
      '_frames',
    ) ||
    name.endsWith(
      '_count',
    )
  ) {
    column.numFmt =
      '0';
  }

  if (
    name === 'event_id' ||
    name === 'provenance' ||
    name === 'review_note' ||
    name.includes(
      'hole_sequence',
    )
  ) {
    column.width =
      28;

    column.alignment = {
      vertical: 'top',
      wrapText: true,
    };
  }
}
    worksheet.autoFilter = {
      from: {
        row: 1,
        column: 1,
      },

      to: {
        row: 1,
        column:
          columns.length,
      },
    };

    const header =
      worksheet.getRow(1);

    header.font = {
      bold: true,
    };

    header.alignment = {
      vertical: 'middle',
      wrapText: true,
    };

    header.height = 32;

    worksheet.eachRow(
      (
        row,
        rowNumber,
      ) => {
        if (
          rowNumber === 1
        ) {
          return;
        }

        row.alignment = {
          vertical: 'top',
        };
      },
    );

    for (
      let index = 0;
      index < columns.length;
      index += 1
    ) {
      const name =
        columns[index];

      const column =
        worksheet.getColumn(
          index + 1,
        );

      if (
        name.endsWith(
          '_fraction',
        ) ||
        name.endsWith(
          '_confidence',
        ) ||
        name.endsWith(
          '_efficiency',
        )
      ) {
        column.numFmt =
          '0.0000';
      } else if (
        name.endsWith('_s') ||
        name.endsWith('_cm') ||
        name.endsWith(
          '_cm_s',
        ) ||
        name.endsWith(
          '_px_s',
        )
      ) {
        column.numFmt =
          '0.000';
      }
    }

    return worksheet;
  }

addDataSheet(
  'Trial Summary',
  TRIAL_SUMMARY_COLUMNS,
  trialRows,
  3,
);

addDataSheet(
  'Investigation Events',
  INVESTIGATION_EVENT_COLUMNS,
  eventRows,
  4,
);

addDataSheet(
  'Analysis Parameters',
  ANALYSIS_PARAMETER_COLUMNS,
  parameterRows,
  3,
  
);

  const about =
    workbook.addWorksheet(
      'About',
    );

  const exportedAtIso =
    new Date().toISOString();

  const aboutRows: Array<
    [string,string]
  > = [
    [
      'Workbook',
      'Barnes Maze Analyzer results',
    ],
    [
      'Tool version',
      TOOL_VERSION,
    ],
    [
      'Exported at',
      exportedAtIso,
    ],
    [
      'Trial Summary',
      'One row per captured trial.',
    ],
    [
      'Investigation Events',
      'Automatic detections are retained even when rejected. Analysis fields describe the currently included reviewed event. Manual-added events have blank automatic-evidence fields.',
    ],
    [
      'Analysis Parameters',
      'Per-trial calibration and analysis thresholds captured with the result snapshot.',
    ],
    [
      'Hole numbering',
      'Fields ending in _index_0based are internal zero-based indices. Fields ending in _number_1based are user-facing hole numbers.',
    ],
    [
      'Blank cells',
      'Blank means unavailable or not applicable. Blank numeric cells must not be interpreted as zero.',
    ],
    [
      'Review status',
      'Check snapshot_review_status and primary_result_review_status before treating a trial as fully reviewed.',
    ],
    [
      'Trajectory analysis duration',
      'trajectory_analysis_duration_s is the duration represented by the analyzed trajectory, not necessarily the full source recording duration.',
    ],
    [
      'Source data',
      'Video processing occurs locally in the browser. This workbook contains captured analysis results, not source video frames.',
    ],
  ];

  about.addRows(
    aboutRows,
  );

  about.getColumn(1).width =
    30;

  about.getColumn(2).width =
    90;

  about.getColumn(1).font = {
    bold: true,
  };

  about.getColumn(2).alignment = {
    vertical: 'top',
    wrapText: true,
  };

  /*
   * writeBuffer() may return a Node-compatible
   * Buffer type in the package typings.
   *
   * Uint8Array.from() creates a browser-owned
   * byte array that is unambiguously safe as a
   * BlobPart.
   */
const buffer =
  await workbook.xlsx
    .writeBuffer();

/*
 * ExcelJS types writeBuffer() as Buffer,
 * while browser builds may return either a
 * Uint8Array-compatible Buffer or ArrayBuffer.
 *
 * Normalize both forms into a browser-owned
 * Uint8Array before constructing the Blob.
 */
const bytes =
  buffer instanceof Uint8Array
    ? new Uint8Array(
        buffer,
      )
    : new Uint8Array(
        buffer as unknown as ArrayBuffer,
      );

  const blob =
    new Blob(
      [bytes],
      {
        type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    );

  const url =
    URL.createObjectURL(
      blob,
    );

  const anchor =
    document.createElement(
      'a',
    );

  anchor.href =
    url;

  anchor.download =
    filename;

  anchor.style.display =
    'none';

  document.body.appendChild(
    anchor,
  );

  anchor.click();
  anchor.remove();

  window.setTimeout(
    () =>
      URL.revokeObjectURL(
        url,
      ),
    0,
  );
}
function batchItemId(
  file: File,
): string {
  return [
    file.name,
    file.size,
    file.lastModified,
  ].join(':');
}

function createBatchItem(
  file: File,
): BatchItem {
  return {
    id:
      batchItemId(
        file,
      ),

    file,

    status:
      'queued',
      reviewReadiness:
  'not-analyzed',

    error:
      null,

    addedAtIso:
      new Date()
        .toISOString(),

    lastOpenedAtIso:
      null,
  };
}
function batchStatusLabel(
  status: BatchItemStatus,
): string {
  switch (status) {
    case 'queued':
      return 'Queued';

    case 'decoding':
      return 'Decoding';

    case 'tracking':
   return 'Tracking';

    case 'decoded':
      return 'Decoded';

    case 'needs-review':
      return 'Needs review';

    case 'reviewed':
      return 'Reviewed';

    case 'error':
      return 'Error';
  }
}

function batchReadinessLabel(
  readiness:
    BatchReviewReadiness,
): string {
  switch (readiness) {
    case 'not-analyzed':
      return 'Not analyzed';

    case 'needs-calibration':
      return 'Needs calibration';

    case 'needs-tracking':
      return 'Needs tracking';

    case 'needs-event-review':
      return 'Needs event review';

    case 'needs-escape-review':
      return 'Needs escape review';

    case 'no-escape-candidate':
  return 'No escape candidate';

case 'escape-unresolved':
  return 'Escape unresolved';

    case 'review-complete':
      return 'Review complete';
  }
}

function formatSeconds(value: number): string {
  return `${value.toFixed(6)} s`;
}

type EscapeReviewCandidate =
  NonNullable<
    ReturnType<
      typeof detectEscapeCandidate
    >
  >;

type EscapeReviewIndexedFrame =
  FrameTiming & {
    presentationIndex: number;
  };

interface EscapeReviewVisualizerProps {
  file: File;

  frames: FrameTiming[];

  track: BodyTrack;

  geometry: HoleGeometry;

  candidate:
    EscapeReviewCandidate;

  associatedTargetEvent:
    FinalReviewedHoleInvestigationEvent |
    null;
}

function escapeReviewFrameSeconds(
  frame: FrameTiming,
): number {
  return (
    frame.pts.ticks /
    frame.pts.timescale
  );
}

function isEscapeReviewIndexedFrame(
  frame: FrameTiming,
): frame is EscapeReviewIndexedFrame {
  return (
    typeof frame.presentationIndex ===
    'number'
  );
}

function nearestEscapeReviewFrame(
  frames:
    EscapeReviewIndexedFrame[],

  targetSeconds:
    number,
):
  EscapeReviewIndexedFrame |
  null {
  let best:
    EscapeReviewIndexedFrame |
    null = null;

  let bestDistance =
    Number.POSITIVE_INFINITY;

  for (const frame of frames) {
    const distance =
      Math.abs(
        escapeReviewFrameSeconds(
          frame,
        ) -
        targetSeconds,
      );

    if (
      distance <
      bestDistance
    ) {
      best =
        frame;

      bestDistance =
        distance;
    }
  }

  return best;
}
function EscapeReviewVisualizer({
  file,
  frames,
  track,
  geometry,
  candidate,
  associatedTargetEvent,
}: EscapeReviewVisualizerProps) {
  const overlayRef =
  useRef<HTMLCanvasElement>(null);

const reviewSessionRef =
  useRef<
    ExactFrameReviewSession |
    null
  >(null);

const exactBitmapRef =
  useRef<ImageBitmap | null>(
    null,
  );

const exactRequestGenerationRef =
  useRef(0);


  const [
    selectedPresentationIndex,
    setSelectedPresentationIndex,
  ] =
    useState<number | null>(
      null,
    );

  
const [
  exactFrameStatus,
  setExactFrameStatus,
] =
  useState<
    | 'opening'
    | 'loading'
    | 'ready'
    | 'error'
  >('opening');

const [
  exactFrameError,
  setExactFrameError,
] =
  useState<
    string | null
  >(null);

const [
  exactFrameMetadata,
  setExactFrameMetadata,
] =
  useState<
    Omit<
      ExactReviewFrame,
      'bitmap'
    > |
    null
  >(null);

const [
  exactFrameVersion,
  setExactFrameVersion,
] =
  useState(0);



  const indexedFrames =
    useMemo(
      () =>
        frames.filter(
          isEscapeReviewIndexedFrame,
        ),
      [
        frames,
      ],
    );

  const frameByIndex =
    useMemo(() => {
      const map =
        new Map<
          number,
          EscapeReviewIndexedFrame
        >();

      for (
        const frame of
        indexedFrames
      ) {
        map.set(
          frame.presentationIndex,
          frame,
        );
      }

      return map;
    }, [
      indexedFrames,
    ]);
    useEffect(() => {
  exactRequestGenerationRef
    .current += 1;

  exactBitmapRef
    .current
    ?.close();

  exactBitmapRef.current =
    null;

  setExactFrameMetadata(
    null,
  );

  setExactFrameStatus(
    'opening',
  );

  setExactFrameError(
    null,
  );

  reviewSessionRef
    .current
    ?.close();

  const session =
    createExactFrameReviewSession(
      file,
    );

  reviewSessionRef.current =
    session;

  session.ready
    .then(() => {
      if (
        reviewSessionRef
          .current !==
        session
      ) {
        return;
      }

      /*
       * A selected-frame effect below will
       * perform the actual frame request.
       */
      setExactFrameStatus(
        'loading',
      );
    })
    .catch(
      (
        error:
          unknown,
      ) => {
        if (
          reviewSessionRef
            .current !==
          session
        ) {
          return;
        }

        setExactFrameStatus(
          'error',
        );

        setExactFrameError(
          error instanceof
          Error
            ? error.message
            : String(
                error,
              ),
        );
      },
    );

  return () => {
    exactRequestGenerationRef
      .current += 1;

    session.close();

    if (
      reviewSessionRef
        .current ===
      session
    ) {
      reviewSessionRef.current =
        null;
    }

    exactBitmapRef
      .current
      ?.close();

    exactBitmapRef.current =
      null;
  };
}, [
  file,
]);


  const pointByIndex =
    useMemo(() => {
      const map =
        new Map<
          number,
          BodyTrack['points'][number]
        >();

      for (
        const point of
        track.points
      ) {
        map.set(
          point.presentationIndex,
          point,
        );
      }

      return map;
    }, [
      track,
    ]);

  const targetHole =
    useMemo(
      () =>
        geometry.holes.find(
          (hole) =>
            hole.isTarget,
        ) ??
        geometry.holes.find(
          (hole) =>
            hole.index ===
            geometry.targetHoleIndex,
        ) ??
        null,
      [
        geometry,
      ],
    );

  const checkpoints =
    useMemo(() => {
      const definitions:
        Array<{
          label: string;
          timeSeconds:
            number | null;
        }> = [
          {
            label:
              'Target onset',

            timeSeconds:
              associatedTargetEvent
                ?.startTimeSeconds ??
              null,
          },

          {
            label:
              'Target end',

            timeSeconds:
              associatedTargetEvent
                ?.endTimeSeconds ??
              null,
          },

          {
            label:
              'Candidate escape',

            timeSeconds:
              candidate
                .escapeTimeSeconds,
          },

          {
            label:
              'Last detected',

            timeSeconds:
              candidate
                .lastDetectedTimeSeconds,
          },

          {
            label:
              'First missing',

            timeSeconds:
              candidate
                .firstMissingTimeSeconds,
          },

          {
            label:
              'Recording end',

            timeSeconds:
              candidate
                .recordingEndTimeSeconds,
          },
        ];

      return definitions
        .filter(
          (
            item,
          ): item is {
            label: string;
            timeSeconds: number;
          } =>
            item.timeSeconds !==
            null,
        )
        .map(
          (item) => {
            const frame =
              nearestEscapeReviewFrame(
                indexedFrames,
                item.timeSeconds,
              );

            return frame
              ? {
                  ...item,

                  presentationIndex:
                    frame
                      .presentationIndex,
                }
              : null;
          },
        )
        .filter(
          (
            item,
          ): item is {
            label: string;
            timeSeconds: number;
            presentationIndex: number;
          } =>
            item !== null,
        );
    }, [
      associatedTargetEvent,
      candidate,
      indexedFrames,
    ]);

  const reviewFrames =
    useMemo(() => {
      if (
        indexedFrames.length ===
        0
      ) {
        return [];
      }

      const checkpointTimes =
        checkpoints.map(
          (item) =>
            item.timeSeconds,
        );

      const minimumTime =
        checkpointTimes.length >
        0
          ? Math.max(
              0,
              Math.min(
                ...checkpointTimes,
              ) - 1,
            )
          : Math.max(
              0,
              candidate
                .escapeTimeSeconds -
                2,
            );

      const maximumTime =
        Math.min(
          candidate
            .recordingEndTimeSeconds,

          (
            checkpointTimes.length >
            0
              ? Math.max(
                  ...checkpointTimes,
                )
              : candidate
                  .escapeTimeSeconds
          ) + 1,
        );

      return indexedFrames.filter(
        (frame) => {
          const seconds =
            escapeReviewFrameSeconds(
              frame,
            );

          return (
            seconds >=
              minimumTime &&
            seconds <=
              maximumTime
          );
        },
      );
    }, [
      candidate,
      checkpoints,
      indexedFrames,
    ]);

  useEffect(() => {
    const initialFrame =
      nearestEscapeReviewFrame(
        reviewFrames.length > 0
          ? reviewFrames
          : indexedFrames,

        candidate
          .escapeTimeSeconds,
      );

    setSelectedPresentationIndex(
      initialFrame
        ?.presentationIndex ??
      null,
    );
  }, [
    candidate.candidateKey,
    indexedFrames,
    reviewFrames,
  ]);

  const selectedFrame =
    selectedPresentationIndex ===
    null
      ? null
      : (
          frameByIndex.get(
            selectedPresentationIndex,
          ) ??
          null
        );

  useEffect(() => {
  if (!selectedFrame) {
    return;
  }

  const session =
    reviewSessionRef
      .current;

  if (!session) {
    return;
  }

  const generation =
    ++exactRequestGenerationRef
      .current;

  /*
   * Do not leave the previous frame on-screen
   * while the metadata already refers to a
   * newly selected presentation index.
   */
  exactBitmapRef
    .current
    ?.close();

  exactBitmapRef.current =
    null;

  setExactFrameMetadata(
    null,
  );

  setExactFrameStatus(
    'loading',
  );

  setExactFrameError(
    null,
  );

  setExactFrameVersion(
    (value) =>
      value + 1,
  );

  const timer =
    window.setTimeout(
      () => {
        session
          .requestFrame(
            selectedFrame,
          )
          .then(
            (
              exactFrame,
            ) => {
              if (
                generation !==
                exactRequestGenerationRef
                  .current
              ) {
                exactFrame
                  .bitmap
                  .close();

                return;
              }

              exactBitmapRef
                .current
                ?.close();

              exactBitmapRef.current =
                exactFrame
                  .bitmap;

              const {
                bitmap:
                  _bitmap,

                ...metadata
              } =
                exactFrame;

              setExactFrameMetadata(
                metadata,
              );

              setExactFrameStatus(
                'ready',
              );

              setExactFrameVersion(
                (value) =>
                  value + 1,
              );
            },
          )
          .catch(
            (
              error:
                unknown,
            ) => {
              if (
                generation !==
                exactRequestGenerationRef
                  .current
              ) {
                return;
              }

              if (
                error instanceof
                  DOMException &&
                error.name ===
                  'AbortError'
              ) {
                return;
              }

              setExactFrameStatus(
                'error',
              );

              setExactFrameError(
                error instanceof
                Error
                  ? error.message
                  : String(
                      error,
                    ),
              );
            },
          );
      },
      /*
       * Avoid decoding dozens of transient
       * frames while the slider is dragged.
       */
      60,
    );

  return () => {
    window.clearTimeout(
      timer,
    );
  };
}, [
  selectedFrame,
]);

  const selectedPoint =
    selectedPresentationIndex ===
    null
      ? null
      : (
          pointByIndex.get(
            selectedPresentationIndex,
          ) ??
          null
        );

  const selectedReviewIndex =
    selectedPresentationIndex ===
    null
      ? -1
      : reviewFrames.findIndex(
          (frame) =>
            frame.presentationIndex ===
            selectedPresentationIndex,
        );

  const exactPtsGroupSize =
    selectedFrame
      ? indexedFrames.filter(
          (frame) =>
            frame.pts.ticks ===
              selectedFrame
                .pts.ticks &&
            frame.pts.timescale ===
              selectedFrame
                .pts.timescale,
        ).length
      : 0;

  const bodyDistanceToTarget =
    selectedPoint &&
    targetHole &&
    selectedPoint.x !==
      null &&
    selectedPoint.y !==
      null
      ? Math.hypot(
          selectedPoint.x -
            targetHole.centerX,

          selectedPoint.y -
            targetHole.centerY,
        )
      : null;

  const noseDistanceToTarget =
    selectedPoint &&
    targetHole &&
    selectedPoint.noseX !==
      null &&
    selectedPoint.noseY !==
      null
      ? Math.hypot(
          selectedPoint.noseX -
            targetHole.centerX,

          selectedPoint.noseY -
            targetHole.centerY,
        )
      : null;


  

  useEffect(() => {
    const canvas =
      overlayRef.current;

    if (!canvas) {
      return;
    }

    canvas.width =
      track.width;

    canvas.height =
      track.height;

    const context =
      canvas.getContext(
        '2d',
      );

    if (!context) {
      return;
    }

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );
        const bitmap =
      exactBitmapRef
        .current;

    if (bitmap) {
      context.drawImage(
        bitmap,
        0,
        0,
        track.width,
        track.height,
      );
    }

    if (targetHole) {
      /*
       * Physical target-hole ROI:
       * solid circle.
       */
      context.save();

      context.lineWidth =
        2;

      context.strokeStyle =
        'white';

      context.setLineDash(
        [],
      );

      context.beginPath();

      context.arc(
        targetHole.centerX,
        targetHole.centerY,
        targetHole
          .radiusPixels,
        0,
        Math.PI * 2,
      );

      context.stroke();

      /*
       * Escape-proximity ROI:
       * larger dashed circle.
       */
      context.lineWidth =
        2;

      context.strokeStyle =
        'yellow';

      context.setLineDash(
        [
          7,
          5,
        ],
      );

      context.beginPath();

      context.arc(
        targetHole.centerX,
        targetHole.centerY,
        candidate
          .escapeRadiusPixels,
        0,
        Math.PI * 2,
      );

      context.stroke();

      context.restore();
    }

    if (
      selectedPoint?.x !==
        null &&
      selectedPoint?.x !==
        undefined &&
      selectedPoint?.y !==
        null &&
      selectedPoint?.y !==
        undefined
    ) {
      const x =
        selectedPoint.x;

      const y =
        selectedPoint.y;

      context.save();

      /*
       * Body centroid:
       * circle + crosshair.
       */
      context.lineWidth =
        2;

      context.strokeStyle =
        'cyan';

      context.beginPath();

      context.arc(
        x,
        y,
        6,
        0,
        Math.PI * 2,
      );

      context.stroke();

      context.beginPath();

      context.moveTo(
        x - 9,
        y,
      );

      context.lineTo(
        x + 9,
        y,
      );

      context.moveTo(
        x,
        y - 9,
      );

      context.lineTo(
        x,
        y + 9,
      );

      context.stroke();

      if (
        selectedPoint.noseX !==
          null &&
        selectedPoint.noseY !==
          null
      ) {
        /*
         * Orientation / nose:
         * line from centroid + small
         * terminal circle.
         */
        context.strokeStyle =
          'magenta';

        context.beginPath();

        context.moveTo(
          x,
          y,
        );

        context.lineTo(
          selectedPoint.noseX,
          selectedPoint.noseY,
        );

        context.stroke();

        context.beginPath();

        context.arc(
          selectedPoint.noseX,
          selectedPoint.noseY,
          4,
          0,
          Math.PI * 2,
        );

        context.stroke();
      }

      context.restore();
    }
  }, [
    candidate.escapeRadiusPixels,
    selectedPoint,
    targetHole,
    track.height,
    track.width,
    exactFrameVersion,
  ]);

  function selectPresentationIndex(
    presentationIndex:
      number,
  ) {
    setSelectedPresentationIndex(
      presentationIndex,
    );
  }

  function selectCheckpoint(
    presentationIndex:
      number,
  ) {
    setSelectedPresentationIndex(
      presentationIndex,
    );
  }

  return (
    <section
      style={{
        marginTop: '1rem',
      }}
      aria-labelledby="escape-visual-review-heading"
    >
      <h3
        id="escape-visual-review-heading"
      >
        Visual escape review
      </h3>

      <p>
        Review the terminal source frames
        around the automatic escape candidate.
        The solid target circle marks the
        calibrated physical hole ROI; the
        larger dashed circle marks the
        configured escape-proximity region.
      </p>

      <div
        className="actions"
        style={{
          marginBottom:
            '0.75rem',
        }}
      >
        {checkpoints.map(
          (checkpoint) => (
            <button
              key={
                `${checkpoint.label}:${checkpoint.presentationIndex}`
              }
              type="button"

              aria-pressed={
                selectedPresentationIndex ===
                checkpoint
                  .presentationIndex
              }

              onClick={() =>
                selectCheckpoint(
                  checkpoint
                    .presentationIndex,
                )
              }
            >
              {
                checkpoint.label
              }
            </button>
          ),
        )}
      </div>

      <div
        style={{

          width:
            '100%',

          maxWidth:
            `${track.width}px`,
        }}
      >
       

        <canvas
          ref={overlayRef}

          aria-label="Exact WebCodecs source frame with escape-review overlay"

          style={{
            display:'block',

            width:
              '100%',

            height:
              '100%',

            pointerEvents:
              'none',
          }}
        />
      </div>

      <div
        className="actions"
        style={{
          marginTop:
            '0.75rem',
        }}
      >
        <button
          type="button"

          disabled={
            selectedReviewIndex <=
            0
          }

          onClick={() => {
            if (
              selectedReviewIndex <=
              0
            ) {
              return;
            }

            selectPresentationIndex(
              reviewFrames[
                selectedReviewIndex -
                1
              ]
                .presentationIndex,
            );
          }}
        >
          Previous frame
        </button>

        <button
          type="button"

          disabled={
            selectedReviewIndex <
              0 ||
            selectedReviewIndex >=
              reviewFrames.length -
                1
          }

          onClick={() => {
            if (
              selectedReviewIndex <
                0 ||
              selectedReviewIndex >=
                reviewFrames.length -
                  1
            ) {
              return;
            }

            selectPresentationIndex(
              reviewFrames[
                selectedReviewIndex +
                1
              ]
                .presentationIndex,
            );
          }}
        >
          Next frame
        </button>
      </div>

      {reviewFrames.length >
        0 && (
        <label
          style={{
            display:
              'grid',

            gap:
              '0.4rem',

            marginTop:
              '0.75rem',
          }}
        >
          <span>
            Browse escape-review frames
          </span>

          <input
            type="range"

            min="0"

            max={
              Math.max(
                0,
                reviewFrames.length -
                  1,
              )
            }

            step="1"

            value={
              Math.max(
                0,
                selectedReviewIndex,
              )
            }

            onChange={(event) => {
              const index =
                Number(
                  event.target
                    .value,
                );

              const frame =
                reviewFrames[
                  index
                ];

              if (frame) {
                selectPresentationIndex(
                  frame
                    .presentationIndex,
                );
              }
            }}
          />
        </label>
      )}

      <dl
        className="metadata-grid"
        style={{
          marginTop:
            '0.75rem',
        }}
      >
        <div>
          <dt>
            Presentation index
          </dt>

          <dd>
            {
              selectedPresentationIndex ??
              'Unavailable'
            }
          </dd>
        </div>

        <div>
          <dt>
            Exact source PTS
          </dt>

          <dd>
            {selectedFrame
              ? (
                  `${selectedFrame.pts.ticks}/${selectedFrame.pts.timescale}` +
                  ` · ${escapeReviewFrameSeconds(selectedFrame).toFixed(6)} s`
                )
              : 'Unavailable'}
          </dd>
        </div>
            <div>
  <dt>
    Exact-frame renderer
  </dt>

  <dd>
    {
      exactFrameStatus ===
        'ready'
        ? 'Ready · WebCodecs exact sample'

        : exactFrameStatus ===
          'opening'
          ? 'Opening local source…'

          : exactFrameStatus ===
            'loading'
            ? 'Decoding selected source frame…'

            : 'Error'
    }
  </dd>
</div>

<div>
  <dt>
    Source sample (decode order)
  </dt>

  <dd>
    {
      exactFrameMetadata
        ? (
            `sample ${exactFrameMetadata.sampleIndex} · ` +
            `presentation index ${exactFrameMetadata.presentationIndex}`
          )
        : 'Unavailable'
    }
  </dd>
</div>
        <div>
          <dt>
            Exact-frame identity
          </dt>

          <dd>
            {
              selectedFrame &&
              exactFrameMetadata
                ? (
                    exactFrameMetadata
                        .sampleIndex ===
                      selectedFrame
                        .sampleIndex &&
                    exactFrameMetadata
                        .presentationIndex ===
                      selectedFrame
                        .presentationIndex &&
                    exactFrameMetadata
                        .pts.ticks ===
                      selectedFrame
                        .pts.ticks &&
                    exactFrameMetadata
                        .pts.timescale ===
                      selectedFrame
                        .pts.timescale
                      ? 'Pass · rendered sample matches selected source record'
                      : 'FAILED · rendered sample identity mismatch'
                  )
                : 'Unavailable'
            }
          </dd>
        </div>
        <div>
          <dt>
            Exact-PTS group size
          </dt>

          <dd>
            {
              exactPtsGroupSize
            }
          </dd>
        </div>

        <div>
          <dt>
            Tracking state
          </dt>

          <dd>
            {
              selectedPoint
                ?.visibility ??
              'Unavailable'
            }
          </dd>
        </div>

        <div>
          <dt>
            Body centroid
          </dt>

          <dd>
            {
              selectedPoint?.x !==
                null &&
              selectedPoint?.x !==
                undefined &&
              selectedPoint?.y !==
                null &&
              selectedPoint?.y !==
                undefined
                ? (
                    `${selectedPoint.x.toFixed(2)}, ` +
                    `${selectedPoint.y.toFixed(2)} px`
                  )
                : 'Not detected'
            }
          </dd>
        </div>

        <div>
          <dt>
            Body area
          </dt>

          <dd>
            {
              selectedPoint
                ?.areaPixels !==
                null &&
              selectedPoint
                ?.areaPixels !==
                undefined
                ? `${selectedPoint.areaPixels.toFixed(1)} px²`
                : 'Unavailable'
            }
          </dd>
        </div>

        <div>
          <dt>
            Body distance to target
          </dt>

          <dd>
            {
              bodyDistanceToTarget !==
              null
                ? `${bodyDistanceToTarget.toFixed(1)} px`
                : 'Unavailable'
            }
          </dd>
        </div>

        <div>
          <dt>
            Nose distance to target
          </dt>

          <dd>
            {
              noseDistanceToTarget !==
              null
                ? `${noseDistanceToTarget.toFixed(1)} px`
                : 'Unavailable'
            }
          </dd>
        </div>

        <div>
          <dt>
            Escape proximity radius
          </dt>

          <dd>
            {
              candidate
                .escapeRadiusPixels
                .toFixed(1)
            } px
          </dd>
        </div>
      </dl>
      {exactFrameStatus ===
  'error' && (
  <p role="alert">
    Exact source frame could not be
    decoded.
    {' '}
    {
      exactFrameError ??
      'Unknown decoder error.'
    }
  </p>
)}
      
      {exactPtsGroupSize >
  1 && (
  <p role="status">
    {
      exactPtsGroupSize
    } source frames share this exact
    PTS. The WebCodecs reviewer addresses
    the selected frame by source sample
    index, so these frames remain visually
    distinguishable.
  </p>
)}
    </section>
  );
}
function rejectTrackPositionForAnalysis(
  point: BodyTrackPoint,
): BodyTrackPoint {
  return {
    ...point,

    /*
     * Reject the position itself, but retain
     * segmentation-derived area, dominance,
     * visibility, foreground counts, etc.
     *
     * Those may still be useful for escape
     * review and QC.
     */
    x: null,
    y: null,

    axisX: null,
    axisY: null,

    candidateAX: null,
    candidateAY: null,
    candidateBX: null,
    candidateBY: null,

    shapeConfidence: null,

    noseX: null,
    noseY: null,
    rearX: null,
    rearY: null,

    orientationConfidence:
      null,

    orientationMethod:
      'unresolved',
  };
}

export default function App() {
  
  const [arenaCalibration,setArenaCalibration,] = useState<ArenaCalibration | null>(null);
  const capabilities = useMemo(() => decoderCapabilities(), []);
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
const [
  segmentationSettings,
  setSegmentationSettings,
] = useState<SegmentationSettings>({
  ...DEFAULT_SEGMENTATION_SETTINGS,
});
const [
  bodyTrack,
  setBodyTrack,
] =
  useState<BodyTrack | null>(
    null,
  );

const [
  holeGeometry,
  setHoleGeometry,
] =
  useState<HoleGeometry | null>(
    null,
  );

const [
  selectedFile,
  setSelectedFile,
] =
  useState<File | null>(
    null,
  );

const [
  batchItems,
  setBatchItems,
] =
  useState<BatchItem[]>(
    [],
  );

  const [
  batchAnalysisSnapshots,
  setBatchAnalysisSnapshots,
] =
  useState<
    Record<
      string,
      BatchAnalysisSnapshot
    >
  >({});

const [
  batchRunState,
  setBatchRunState,
] =
  useState<BatchRunState>({
    running:
      false,

    itemIds:
      [],

    currentIndex:
      0,

    stage:
      'idle',
  });

const batchRunStopRequestedRef =
  useRef(false);
const [
  trackingBusy,
  setTrackingBusy,
] =
  useState(false);
const runnableBatchItems =
  useMemo(
    () =>
      batchItems.filter(
        (item) =>
          item.status ===
            'queued' ||
          item.reviewReadiness ===
            'needs-tracking',
      ),
    [
      batchItems,
    ],
  );

const activeBatchRunItem =
  useMemo(
    () => {
      if (
        !batchRunState.running
      ) {
        return null;
      }

      const id =
        batchRunState
          .itemIds[
          batchRunState
            .currentIndex
        ];

      if (!id) {
        return null;
      }

      return (
        batchItems.find(
          (item) =>
            item.id === id,
        ) ??
        null
      );
    },
    [
      batchItems,
      batchRunState,
    ],
  );
const sessionHydratedKeyRef =
  useRef<string | null>(null);

const [
  sessionNotice,
  setSessionNotice,
] = useState<string | null>(null);

const [trackingProgress, setTrackingProgress] = useState<{
  completed: number;
  total: number;
} | null>(null);
const [holeEventReviewDecisions,setHoleEventReviewDecisions,] = useState<HoleEventReviewDecisionMap>({});

const [
  manualHoleEventAdditions,
  setManualHoleEventAdditions,
] = useState<ManualHoleEventAddition[]>(
  [],
);
const [
  trialStartOverride,
  setTrialStartOverride,
] =
  useState<
    TrialStartOverride | null
  >(null);

const [
  manualTrackPointCorrections,
  setManualTrackPointCorrections,
] =
  useState<
    ManualTrackPointCorrectionMap
  >({});
const [
  trajectorySmoothingSettings,
  setTrajectorySmoothingSettings,
] = useState<TrajectorySmoothingSettings>({
  ...DEFAULT_TRAJECTORY_SETTINGS,
});

const [
  trajectoryOutlierSettings,
  setTrajectoryOutlierSettings,
] =
  useState<TrajectoryOutlierSettings>({
    ...DEFAULT_TRAJECTORY_OUTLIER_SETTINGS,
  });

const [
  orientationSettings,
  setOrientationSettings,
] = useState<OrientationSettings>({
  ...DEFAULT_ORIENTATION_SETTINGS,
});
  const [
  holeInvestigationSettings,
  setHoleInvestigationSettings,
] = useState<HoleInvestigationSettings>({
  ...DEFAULT_HOLE_INVESTIGATION_SETTINGS,
});
const [
  escapeDetectionSettings,
  setEscapeDetectionSettings,
] = useState<EscapeDetectionSettings>({
  ...DEFAULT_ESCAPE_DETECTION_SETTINGS,
});

const [
  escapeReviewDecision,
  setEscapeReviewDecision,
] = useState<EscapeReviewDecision | null>(
  null,
);
const [
  searchStrategySettings,
  setSearchStrategySettings,
] = useState<SearchStrategySettings>({
  ...DEFAULT_SEARCH_STRATEGY_SETTINGS,
});

const [
  searchStrategyOverride,
  setSearchStrategyOverride,
] = useState<SearchStrategyOverride | null>(
  null,
);
useEffect(() => {
  if (
    !selectedFile ||
    !result
  ) {
    return;
  }

  const key =
    savedSessionKey(
      selectedFile,
    );

  /*
   * Critical:
   * do not write anything until this exact
   * video's session has been hydrated.
   */
  if (
    sessionHydratedKeyRef.current !==
    key
  ) {
    return;
  }

  const session:
    SavedBarnesSession = {
      schemaVersion:
        SESSION_SCHEMA_VERSION,

      fileIdentity: {
        name:
          selectedFile.name,

        size:
          selectedFile.size,

        lastModified:
          selectedFile.lastModified,
      },

      videoWidth:
        result.metadata.width,

      videoHeight:
        result.metadata.height,

      arenaCalibration,

      holeGeometry,

      segmentationSettings,

      trajectorySmoothingSettings,

      trajectoryOutlierSettings,

      orientationSettings,

      holeInvestigationSettings,
    escapeDetectionSettings,

escapeReviewDecision,

searchStrategySettings,

searchStrategyOverride,

eventReviews:
  holeEventReviewDecisions,

manualHoleEventAdditions,

trialStartOverride,

manualTrackPointCorrections,

savedAtIso:
  new Date().toISOString(),
    };

  try {
    localStorage.setItem(
      key,
      JSON.stringify(session),
    );
  } catch (cause) {
    console.warn(
      'Could not save Barnes Maze analysis session.',
      cause,
    );
  }
}, [
  selectedFile,
  result,
  arenaCalibration,
  holeGeometry,
  segmentationSettings,
  trajectorySmoothingSettings,
  trajectoryOutlierSettings,
  orientationSettings,
  holeInvestigationSettings,
   escapeDetectionSettings,
  escapeReviewDecision,
  searchStrategySettings,

searchStrategyOverride,
  holeEventReviewDecisions,
  manualHoleEventAdditions,
  trialStartOverride,
  manualTrackPointCorrections,
]);
const effectiveBodyTrack =
  useMemo<BodyTrack | null>(
    () => {
      if (!bodyTrack) {
        return null;
      }

      const points:
        BodyTrack['points'] =
        bodyTrack.points.map(
          (point) => {
            const correction =
              manualTrackPointCorrections[
                String(
                  point.presentationIndex,
                )
              ];

            if (!correction) {
              return point;
            }

            if (
              correction.kind ===
              'missing'
            ) {
              return {
                ...point,

                x: null,
                y: null,

                axisX: null,
                axisY: null,

                candidateAX: null,
                candidateAY: null,
                candidateBX: null,
                candidateBY: null,

                shapeConfidence: null,

                noseX: null,
                noseY: null,
                rearX: null,
                rearY: null,

                orientationConfidence:
                  null,

                orientationMethod:
                  'not-detected' as const,

                areaPixels: null,
                dominance: null,

                visibility:
                  'not-detected' as const,
              };
            }

            /*
             * Clamp the manually reviewed
             * centroid to the source image.
             */
            const x =
              Math.max(
                0,
                Math.min(
                  bodyTrack.width - 1,
                  correction.x,
                ),
              );

            const y =
              Math.max(
                0,
                Math.min(
                  bodyTrack.height - 1,
                  correction.y,
                ),
              );

            return {
              ...point,

              x,
              y,

              /*
               * Do not preserve an old
               * orientation solution after
               * manually moving the centroid.
               *
               * resolveTrackOrientation()
               * will produce the reviewed
               * downstream orientation.
               */
              axisX: null,
              axisY: null,

              candidateAX: null,
              candidateAY: null,
              candidateBX: null,
              candidateBY: null,

              shapeConfidence: null,

              noseX: null,
              noseY: null,
              rearX: null,
              rearY: null,

              orientationConfidence:
                null,

              orientationMethod:
                'unresolved' as const,

              visibility:
                'visible' as const,
            };
          },
        );

      const detectedFrameCount =
        points.filter(
          (point) =>
            point.x !== null &&
            point.y !== null,
        ).length;

      return {
        ...bodyTrack,

        points,

        detectedFrameCount,

        missingFrameCount:
          points.length -
          detectedFrameCount,
      };
    },
    [
      bodyTrack,
      manualTrackPointCorrections,
    ],
  );

const trackQc = useMemo(
  () =>
    effectiveBodyTrack
      ? analyzeBodyTrack(
          effectiveBodyTrack,
        )
      : null,
  [
    effectiveBodyTrack,
  ],
);

const automaticTrialWindow = useMemo(
  () =>
    bodyTrack
      ? detectTrialStart(bodyTrack, { minimumPresenceSeconds: 0.5 })
      : null,
  [bodyTrack],
);
const trialWindow =
  useMemo(() => {
    if (
      !automaticTrialWindow ||
      !bodyTrack
    ) {
      return automaticTrialWindow;
    }

    if (!trialStartOverride) {
      return automaticTrialWindow;
    }

    const overridePoint =
      bodyTrack.points.find(
        (point) =>
          point.presentationIndex ===
          trialStartOverride
            .presentationIndex,
      );

    if (!overridePoint) {
      return automaticTrialWindow;
    }

    /*
     * Do not allow a manual start after an
     * explicit trial end, if one exists.
     */
    if (
      automaticTrialWindow
        .endPresentationIndex !==
        null &&
      overridePoint
        .presentationIndex >
        automaticTrialWindow
          .endPresentationIndex
    ) {
      return automaticTrialWindow;
    }

    return {
      ...automaticTrialWindow,

      startPresentationIndex:
        overridePoint
          .presentationIndex,

      startPts:
        overridePoint.pts,
    };
  }, [
    automaticTrialWindow,
    bodyTrack,
    trialStartOverride,
  ]);

const trackOutlierAnalysis =
  useMemo(() => {
    if (
      !effectiveBodyTrack ||
      !trialWindow
    ) {
      return null;
    }

    const points =
      effectiveBodyTrack.points;

    const rejectedIndices =
      new Set<number>();

    const threshold =
      Math.max(
        0,
        trajectoryOutlierSettings
          .maximumJumpSpeedPixelsPerSecond,
      );

    const trialStart =
      trialWindow
        .startPresentationIndex;

    const trialEnd =
      trialWindow
        .endPresentationIndex ??
      Number.POSITIVE_INFINITY;

    let evaluatedCandidateCount =
      0;

    let detectedTrialPointCount =
      0;

    for (const point of points) {
      if (
        point.presentationIndex <
          trialStart ||
        point.presentationIndex >
          trialEnd
      ) {
        continue;
      }

      if (
        point.x !== null &&
        point.y !== null
      ) {
        detectedTrialPointCount +=
          1;
      }
    }

    if (
      trajectoryOutlierSettings
        .enabled &&
      threshold > 0
    ) {
      for (
        let index = 1;
        index < points.length - 1;
        index += 1
      ) {
        const previous =
          points[index - 1];

        const current =
          points[index];

        const next =
          points[index + 1];

        if (
          current.presentationIndex <
            trialStart ||
          current.presentationIndex >
            trialEnd
        ) {
          continue;
        }

        /*
         * Manual review takes precedence.
         *
         * Protect not only the current point,
         * but also its immediate neighboring
         * comparison points.
         */
        if (
          manualTrackPointCorrections[
            String(
              previous
                .presentationIndex,
            )
          ] ||
          manualTrackPointCorrections[
            String(
              current
                .presentationIndex,
            )
          ] ||
          manualTrackPointCorrections[
            String(
              next
                .presentationIndex,
            )
          ]
        ) {
          continue;
        }

        if (
          previous.x === null ||
          previous.y === null ||
          current.x === null ||
          current.y === null ||
          next.x === null ||
          next.y === null
        ) {
          continue;
        }

        const previousTime =
          previous.pts.ticks /
          previous.pts.timescale;

        const currentTime =
          current.pts.ticks /
          current.pts.timescale;

        const nextTime =
          next.pts.ticks /
          next.pts.timescale;

        const previousDelta =
          currentTime -
          previousTime;

        const nextDelta =
          nextTime -
          currentTime;

        const bridgeDelta =
          nextTime -
          previousTime;

        /*
         * Duplicate/non-increasing PTS and
         * already-disconnected gaps are not
         * eligible for isolated-jump testing.
         */
        if (
          previousDelta <= 0 ||
          nextDelta <= 0 ||
          bridgeDelta <= 0 ||
          previousDelta >
            trajectorySmoothingSettings
              .maxGapSeconds ||
          nextDelta >
            trajectorySmoothingSettings
              .maxGapSeconds
        ) {
          continue;
        }

        evaluatedCandidateCount +=
          1;

        const incomingDistance =
          Math.hypot(
            current.x -
              previous.x,

            current.y -
              previous.y,
          );

        const outgoingDistance =
          Math.hypot(
            next.x -
              current.x,

            next.y -
              current.y,
          );

        const bridgeDistance =
          Math.hypot(
            next.x -
              previous.x,

            next.y -
              previous.y,
          );

        const incomingSpeed =
          incomingDistance /
          previousDelta;

        const outgoingSpeed =
          outgoingDistance /
          nextDelta;

        const bridgeSpeed =
          bridgeDistance /
          bridgeDelta;

        /*
         * A genuine isolated spike has:
         *
         * previous → current = implausibly fast
         * current  → next    = implausibly fast
         *
         * while:
         *
         * previous → next remains plausible.
         */
        if (
          incomingSpeed >
            threshold &&
          outgoingSpeed >
            threshold &&
          bridgeSpeed <=
            threshold
        ) {
          rejectedIndices.add(
            current
              .presentationIndex,
          );
        }
      }
    }

    const cleanedPoints =
      points.map(
        (point) =>
          rejectedIndices.has(
            point.presentationIndex,
          )
            ? rejectTrackPositionForAnalysis(
                point,
              )
            : point,
      );

    const detectedFrameCount =
      cleanedPoints.filter(
        (point) =>
          point.x !== null &&
          point.y !== null,
      ).length;

    const rejectedCount =
      rejectedIndices.size;

    return {
      track: {
        ...effectiveBodyTrack,

        points:
          cleanedPoints,

        detectedFrameCount,

        missingFrameCount:
          cleanedPoints.length -
          detectedFrameCount,
      } satisfies BodyTrack,

      rejectedCount,

      evaluatedCandidateCount,

      detectedTrialPointCountBefore:
        detectedTrialPointCount,

      detectedTrialPointCountAfter:
        Math.max(
          0,
          detectedTrialPointCount -
            rejectedCount,
        ),

      rejectedFraction:
        detectedTrialPointCount > 0
          ? (
              rejectedCount /
              detectedTrialPointCount
            )
          : 0,

      rejectedPresentationIndices:
        [...rejectedIndices].sort(
          (a,b) =>
            a - b,
        ),
    };
  }, [
    effectiveBodyTrack,
    trialWindow,
    trajectoryOutlierSettings,
    trajectorySmoothingSettings
      .maxGapSeconds,
    manualTrackPointCorrections,
  ]);

const cleanedBodyTrack =
  trackOutlierAnalysis?.track ??
  effectiveBodyTrack;

const trialDetectionRate =
  useMemo(() => {
    if (
      !cleanedBodyTrack ||
      !trialWindow
    ) {
      return null;
    }

    return detectionRateFromTrialStart(
      cleanedBodyTrack,
      trialWindow
        .startPresentationIndex,
    );
  }, [
    cleanedBodyTrack,
    trialWindow,
  ]);
const orientedTrack = useMemo(
  () =>
    cleanedBodyTrack
      ? resolveTrackOrientation(
          cleanedBodyTrack,
          orientationSettings,
        )
      : null,
  [
    cleanedBodyTrack,
    orientationSettings,
  ],
);

const orientationQc = useMemo(
  () =>
    orientedTrack
      ? summarizeOrientation(
          orientedTrack,
        )
      : null,
  [orientedTrack],
);
const holeInvestigationResult =
  useMemo(
    () =>
      orientedTrack &&
      holeGeometry &&
      trialWindow
        ? detectHoleInvestigations(
            orientedTrack,
            holeGeometry,
            trialWindow,
            holeInvestigationSettings,
          )
        : null,
    [
      orientedTrack,
      holeGeometry,
      trialWindow,
      holeInvestigationSettings,
    ],
  );
  const finalReviewedEvents =
  useMemo<
    FinalReviewedHoleInvestigationEvent[]
  >(() => {
    if (!holeInvestigationResult) {
      return [];
    }

    const finalEvents:
      FinalReviewedHoleInvestigationEvent[] =
      [];

    const timeByPresentationIndex =
      new Map<number,number>();

    for (
      const frame of
      result?.frames ?? []
    ) {
      if (
        !(
          'presentationIndex' in
          frame
        ) ||
        typeof frame
          .presentationIndex !==
          'number'
      ) {
        continue;
      }

      timeByPresentationIndex.set(
        frame.presentationIndex,

        frame.pts.ticks /
          frame.pts.timescale,
      );
    }
    for (
      const event of
      holeInvestigationResult.events
    ) {
      const key =
        holeEventReviewKey(event);

      const decision =
        holeEventReviewDecisions[key];

      const status =
        decision?.status ??
        'unreviewed';

      /*
       * Manual rejection removes the event from
       * the final analysis set, but does NOT alter
       * the immutable automatic detector result.
       */
      if (status === 'rejected') {
        continue;
      }

      if (status === 'edited') {
        const holeIndex =
          decision
            ?.manualHoleIndex ??
          event.holeIndex;

        const startPresentationIndex =
          decision
            ?.manualStartPresentationIndex ??
          event.startPresentationIndex;

        const endPresentationIndex =
          decision
            ?.manualEndPresentationIndex ??
          event.endPresentationIndex;

        const startTimeSeconds =
          timeByPresentationIndex.get(
            startPresentationIndex,
          );

        const endTimeSeconds =
          timeByPresentationIndex.get(
            endPresentationIndex,
          );

        /*
        * A reviewer can only create an edit from
        * frames actually present in this source
        * timeline. If an old edit cannot be resolved,
        * do not silently invent timing.
        */
        if (
          startTimeSeconds === undefined ||
          endTimeSeconds === undefined ||
          endPresentationIndex <
            startPresentationIndex
        ) {
          console.warn(
            'Ignoring invalid manual event edit.',
            event,
            decision,
          );

          continue;
        }

        const reviewedHole =
          holeGeometry
            ?.holes.find(
              (hole) =>
                hole.index ===
                holeIndex,
            );

        finalEvents.push({
          ...event,
          automaticEventIndex:
  event.eventIndex,

manualEventId:
  null,

finalEventKey:
  `automatic:${holeEventReviewKey(event)}`,
          holeIndex,

          isTarget:
            reviewedHole
              ?.isTarget ??
            false,

          startPresentationIndex,

          endPresentationIndex,

          startTimeSeconds,

          endTimeSeconds,

          durationSeconds:
            Math.max(
              0,
              endTimeSeconds -
                startTimeSeconds,
            ),

          reviewStatus:
            'edited',

          provenance:
            'automatic-manually-edited',

          reviewNote:
            decision?.note ?? '',

          reviewedAtIso:
            decision
              ?.reviewedAtIso ??
            null,
        });

        continue;
      }

      if (status === 'confirmed') {
        finalEvents.push({
          ...event,
        automaticEventIndex:
          event.eventIndex,

        manualEventId:
          null,

        finalEventKey:
          `automatic:${holeEventReviewKey(event)}`,

          reviewStatus:
            'confirmed',

          provenance:
            'automatic-manually-confirmed',

          reviewNote:
            decision?.note ?? '',

          reviewedAtIso:
            decision?.reviewedAtIso ??
            null,
        });

        continue;
      }

      /*
       * Unreviewed automatic events remain
       * provisionally included.
       */
      finalEvents.push({
        ...event,
      automaticEventIndex:
        event.eventIndex,

      manualEventId:
        null,

      finalEventKey:
        `automatic:${holeEventReviewKey(event)}`,
        reviewStatus:
          'unreviewed',

        provenance:
          'automatic-unreviewed',

        reviewNote:
          decision?.note ?? '',

        reviewedAtIso:
          null,
      });
    }
    for (
  const addition of
  manualHoleEventAdditions
) {
  const startTimeSeconds =
    timeByPresentationIndex.get(
      addition.startPresentationIndex,
    );

  const endTimeSeconds =
    timeByPresentationIndex.get(
      addition.endPresentationIndex,
    );

  if (
    startTimeSeconds === undefined ||
    endTimeSeconds === undefined ||
    addition.startPresentationIndex >
      addition.endPresentationIndex
  ) {
    console.warn(
      'Ignoring invalid manual investigation.',
      addition,
    );

    continue;
  }
if (
  trialWindow &&
  addition
    .startPresentationIndex <
    trialWindow
      .startPresentationIndex
) {
  continue;
}

if (
  trialWindow &&
  trialWindow
    .endPresentationIndex !==
    null &&
  addition
    .endPresentationIndex >
    trialWindow
      .endPresentationIndex
) {
  continue;
}
  const hole =
    holeGeometry
      ?.holes.find(
        (candidate) =>
          candidate.index ===
          addition.holeIndex,
      );

  if (!hole) {
    console.warn(
      'Ignoring manual investigation with unknown hole.',
      addition,
    );

    continue;
  }

  finalEvents.push({
    /*
     * Manual IDs are kept separately.
     *
     * This numerical index only keeps existing
     * downstream code compatible.
     */
    eventIndex:
      holeInvestigationResult
        .events.length +
      addition.ordinal -
      1,

    automaticEventIndex:
      null,

    manualEventId:
      addition.id,

    finalEventKey:
      `manual:${addition.id}`,

    holeIndex:
      addition.holeIndex,

    isTarget:
      hole.isTarget,

    startPresentationIndex:
      addition.startPresentationIndex,

    endPresentationIndex:
      addition.endPresentationIndex,

    startTimeSeconds,

    endTimeSeconds,

    durationSeconds:
      Math.max(
        0,
        endTimeSeconds -
          startTimeSeconds,
      ),

    positiveObservationCount:
      null,

    minimumNoseDistancePixels:
      null,

    closestNoseX:
      null,

    closestNoseY:
      null,

    reviewStatus:
      'manual-added',

    provenance:
      'manual-added',

    reviewNote:
      addition.note,

    reviewedAtIso:
      addition.updatedAtIso,
  });
}
    return finalEvents.sort(
  (a,b) =>
    a.startPresentationIndex -
      b.startPresentationIndex ||

    a.endPresentationIndex -
      b.endPresentationIndex ||

    a.eventIndex -
      b.eventIndex,
);
  }, [
    holeInvestigationResult,
    holeEventReviewDecisions,
    manualHoleEventAdditions,
    result,
    holeGeometry,
    trialWindow,
  ]);
  
  const primaryBehaviorMetrics =
  useMemo(
    () =>
      trialWindow
        ? computeBarnesPrimaryMetrics(
            finalReviewedEvents,
            trialWindow,
          )
        : null,
    [
      finalReviewedEvents,
      trialWindow,
    ],
  );

  const primaryBehaviorReviewSummary =
  useMemo(() => {
    if (!primaryBehaviorMetrics) {
      return null;
    }

    const contributingEvents = [
      ...primaryBehaviorMetrics
        .primaryErrorEvents,

      ...(
        primaryBehaviorMetrics
          .firstTargetEvent
          ? [
              primaryBehaviorMetrics
                .firstTargetEvent,
            ]
          : []
      ),
    ];

    let editedCount = 0;
    let confirmedCount = 0;
    let unreviewedCount = 0;

    for (
      const event of
      contributingEvents
    ) {
      if (
  event.reviewStatus ===
    'edited' ||
  event.reviewStatus ===
    'manual-added'
) {
  editedCount += 1;
} else if (
  event.reviewStatus ===
    'confirmed'
) {
  confirmedCount += 1;
} else {
  unreviewedCount += 1;
}
    }

const status:
  BatchPrimaryReviewSnapshot[
    'status'
  ] =
  unreviewedCount > 0
    ? 'provisional'
    : editedCount > 0
      ? 'reviewed-with-edits'
      : 'reviewed';

return {
  status,

  contributingEventCount:
    contributingEvents.length,

  editedCount,

  confirmedCount,

  unreviewedCount,
} satisfies BatchPrimaryReviewSnapshot;
  }, [
    primaryBehaviorMetrics,
  ]);

  const escapeCandidate =
  useMemo(
    () =>
      orientedTrack && holeGeometry
        ? detectEscapeCandidate(
  orientedTrack,
  holeGeometry,
  finalReviewedEvents,
  escapeDetectionSettings,
)
        : null,
    [
      orientedTrack,
      holeGeometry,
      finalReviewedEvents,
      escapeDetectionSettings,
    ],
  );

  const escapeAssociatedTargetEvent =
  useMemo(() => {
    if (!escapeCandidate) {
      return null;
    }

    /*
     * First try the event index carried by
     * the automatic escape candidate.
     */
    if (
      escapeCandidate
        .targetEventIndex !==
      null
    ) {
      const indexedMatch =
        finalReviewedEvents.find(
          (event) =>
            event.eventIndex ===
            escapeCandidate
              .targetEventIndex,
        );

      if (indexedMatch) {
        return indexedMatch;
      }
    }

    /*
     * Defensive fallback:
     * use the latest reviewed target event
     * ending no later than the candidate.
     */
    return (
      [...finalReviewedEvents]
        .filter(
          (event) =>
            event.isTarget &&
            event.endTimeSeconds <=
              escapeCandidate
                .escapeTimeSeconds,
        )
        .sort(
          (a,b) =>
            b.endTimeSeconds -
            a.endTimeSeconds,
        )[0] ??
      null
    );
  }, [
    escapeCandidate,
    finalReviewedEvents,
  ]);

  const activeEscapeReview =
  useMemo(
    () => {
      if (
        !escapeCandidate ||
        !escapeReviewDecision ||
        escapeReviewDecision
          .candidateKey !==
          escapeCandidate
            .candidateKey
      ) {
        return null;
      }

      return escapeReviewDecision;
    },
    [
      escapeCandidate,
      escapeReviewDecision,
    ],
  );
  const escapeBehaviorMetrics =
  useMemo(
    () =>
      trialWindow
        ? computeBarnesEscapeMetrics(
            finalReviewedEvents,
            trialWindow,
            escapeCandidate,
            activeEscapeReview,
          )
        : null,
    [
      finalReviewedEvents,
      trialWindow,
      escapeCandidate,
      activeEscapeReview,
    ],
  );
 const processedTrajectory =
  useMemo(
    () =>
      cleanedBodyTrack &&
      trialWindow
        ? processTrajectory(
            cleanedBodyTrack,
            trialWindow,
            trajectorySmoothingSettings,
          )
        : null,
    [
      cleanedBodyTrack,
      trialWindow,
      trajectorySmoothingSettings,
    ],
  );
  
  const targetQuadrantMetrics =
  useMemo(() => {
    if (
      !processedTrajectory ||
      !arenaCalibration ||
      !holeGeometry
    ) {
      return null;
    }

    const firstTargetTime =
      primaryBehaviorMetrics
        ?.firstTargetEvent
        ?.startTimeSeconds ??
      null;

    const confirmedEscapeTime =
      escapeCandidate &&
      activeEscapeReview
        ?.status ===
        'confirmed'
        ? escapeCandidate
            .escapeTimeSeconds
        : null;

    return computeTargetQuadrantMetrics(
      processedTrajectory,
      arenaCalibration,
      holeGeometry,
      firstTargetTime,
      confirmedEscapeTime,
    );
  }, [
    processedTrajectory,
    arenaCalibration,
    holeGeometry,
    primaryBehaviorMetrics,
    escapeCandidate,
    activeEscapeReview,
  ]);
  const searchStrategyResult =
  useMemo(
    () =>
      processedTrajectory &&
      arenaCalibration &&
      holeGeometry
        ? classifySearchStrategy(
            processedTrajectory,
            arenaCalibration,
            holeGeometry,
            finalReviewedEvents,
            searchStrategySettings,
          )
        : null,
    [
      processedTrajectory,
      arenaCalibration,
      holeGeometry,
      finalReviewedEvents,
      searchStrategySettings,
    ],
  );

const finalSearchStrategy =
  searchStrategyOverride
    ?.strategy ??
  searchStrategyResult
    ?.automaticStrategy ??
  null;
  const finalReviewedEventSummary =
  useMemo(() => {
    const automaticEvents =
      holeInvestigationResult
        ?.events ?? [];

    let confirmedCount = 0;
    let rejectedCount = 0;
    let unreviewedCount = 0;
    let editedCount = 0;
    const manualAddedCount =
  finalReviewedEvents.filter(
    (event) =>
      event.provenance ===
      'manual-added',
  ).length;

    for (
      const event of automaticEvents
    ) {
      const decision =
        holeEventReviewDecisions[
          holeEventReviewKey(event)
        ];

      const status =
        decision?.status ??
        'unreviewed';

      if (status === 'confirmed') {
        confirmedCount += 1;
      } else if (
        status === 'rejected'
      ) {
        rejectedCount += 1;
      } else if (
        status === 'edited'
      ) {
        editedCount += 1;
      }
      else {
        unreviewedCount += 1;
      }
      
    }

    const targetCount =
      finalReviewedEvents.filter(
        (event) =>
          event.isTarget,
      ).length;

    return {
      automaticCount:
        automaticEvents.length,

      confirmedCount,
      rejectedCount,
      unreviewedCount,
      editedCount,

      finalIncludedCount:
        finalReviewedEvents.length,

      targetCount,

      nonTargetCount:
        finalReviewedEvents.length -
        targetCount,
      manualAddedCount,
    };
  }, [
    holeInvestigationResult,
    holeEventReviewDecisions,
    finalReviewedEvents,
    manualHoleEventAdditions,
    
  ]);

  const activeBatchReviewReadiness =
  useMemo<BatchReviewReadiness>(
    () => {
      if (!result) {
        return 'not-analyzed';
      }

      if (
        !arenaCalibration ||
        !holeGeometry
      ) {
        return 'needs-calibration';
      }

      if (
        !bodyTrack ||
        !trialWindow ||
        !holeInvestigationResult
      ) {
        return 'needs-tracking';
      }

      if (
        finalReviewedEventSummary
          .unreviewedCount > 0
      ) {
        return 'needs-event-review';
      }

      if (!escapeCandidate) {
  return 'no-escape-candidate';
}

if (
  !activeEscapeReview ||
  activeEscapeReview.status ===
    'unreviewed'
) {
  return 'needs-escape-review';
}

if (
  activeEscapeReview.status ===
    'rejected' ||
  activeEscapeReview.status ===
    'ambiguous'
) {
  return 'escape-unresolved';
}

return 'review-complete';

    },
    [
      result,
      arenaCalibration,
      holeGeometry,
      bodyTrack,
      trialWindow,
      holeInvestigationResult,
      finalReviewedEventSummary
        .unreviewedCount,
      escapeCandidate,
      activeEscapeReview,
    ],
  );
  useEffect(() => {
  if (!selectedFile) {
    return;
  }

  const id =
    batchItemId(
      selectedFile,
    );

  setBatchItems(
    (current) =>
      current.map(
        (item) => {
          if (
            item.id !== id ||
            item.reviewReadiness ===
              activeBatchReviewReadiness
          ) {
            return item;
          }

          return {
            ...item,

            reviewReadiness:
              activeBatchReviewReadiness,

            status:
              activeBatchReviewReadiness ===
                'review-complete'
                ? 'reviewed'
                : item.status ===
                    'reviewed'
                  ? 'decoded'
                  : item.status,
          };
        },
      ),
  );
}, [
  selectedFile,
  activeBatchReviewReadiness,
]);
const longestMissingRun =
  trackQc?.missingRuns.reduce<typeof trackQc.missingRuns[number] | null>(
    (longest, run) =>
      !longest || run.durationSeconds > longest.durationSeconds
        ? run
        : longest,
    null,
  ) ?? null;


const trajectoryMetrics = useMemo(
  () =>
    processedTrajectory && arenaCalibration
      ? computeTrajectoryMetrics(processedTrajectory,arenaCalibration)
      : null,
  [processedTrajectory,arenaCalibration],
);
const activeBatchAnalysisSnapshot =
  useMemo<
    BatchAnalysisSnapshot |
    null
  >(() => {
    /*
     * A snapshot represents a completed
     * tracking/analysis pass.
     *
     * Do not replace a previous successful
     * snapshot merely because a video has
     * been reopened and its BodyTrack has
     * not yet been regenerated.
     */
    if (
      !selectedFile ||
      !result ||
      !bodyTrack ||
      !trialWindow
    ) {
      return null;
    }

    const outlierQc:
      BatchOutlierQcSnapshot |
      null =
      trackOutlierAnalysis
        ? {
            rejectedCount:
              trackOutlierAnalysis
                .rejectedCount,

            evaluatedCandidateCount:
              trackOutlierAnalysis
                .evaluatedCandidateCount,

            detectedTrialPointCountBefore:
              trackOutlierAnalysis
                .detectedTrialPointCountBefore,

            detectedTrialPointCountAfter:
              trackOutlierAnalysis
                .detectedTrialPointCountAfter,

            rejectedFraction:
              trackOutlierAnalysis
                .rejectedFraction,

            rejectedPresentationIndices:
              [
                ...trackOutlierAnalysis
                  .rejectedPresentationIndices,
              ],
          }
        : null;

    return {
      schemaVersion:
        BATCH_SNAPSHOT_SCHEMA_VERSION,

      toolVersion:
        TOOL_VERSION,

      capturedAtIso:
        new Date()
          .toISOString(),

      fileIdentity: {
        name:
          selectedFile.name,

        size:
          selectedFile.size,

        lastModified:
          selectedFile.lastModified,
      },

      reviewReadiness:
        activeBatchReviewReadiness,

      video: {
        metadata:
          result.metadata,

        timingValidation:
          result.timingValidation,

        decodedFrames:
          result.decodedFrames,
      },

      calibration: {
        arena:
          arenaCalibration,

        holes:
          holeGeometry,
      },

      settings: {
        segmentation: {
          ...segmentationSettings,
        },

        trajectorySmoothing: {
          ...trajectorySmoothingSettings,
        },

        trajectoryOutlier: {
          ...trajectoryOutlierSettings,
        },

        orientation: {
          ...orientationSettings,
        },

        holeInvestigation: {
          ...holeInvestigationSettings,
        },

        escapeDetection: {
          ...escapeDetectionSettings,
        },

        searchStrategy: {
          ...searchStrategySettings,
        },
      },

      trial: {
        automaticWindow:
          automaticTrialWindow,

        effectiveWindow:
          trialWindow,

        startOverride:
          trialStartOverride
            ? {
                ...trialStartOverride,
              }
            : null,

        detectionRate:
          trialDetectionRate,
      },

      qc: {
        tracking:
          trackQc,
        trackingFailureRuns:
  effectiveBodyTrack
    ? buildTrackingFailureRuns(
        effectiveBodyTrack,
        trialWindow,
        manualTrackPointCorrections,
      )
    : [],

        orientation:
          orientationQc,

        trajectory:
          processedTrajectory
            ? processedTrajectory.qc
            : null,

        outlier:
          outlierQc,

        manualTrackCorrectionCount:
          Object.keys(
            manualTrackPointCorrections,
          ).length,
      },

      metrics: {
        primary:
          primaryBehaviorMetrics,

        primaryReview:
          primaryBehaviorReviewSummary
            ? {
                ...primaryBehaviorReviewSummary,
              }
            : null,

        escape:
          escapeBehaviorMetrics,

        trajectory:
          trajectoryMetrics,

        targetQuadrant:
          targetQuadrantMetrics,

        searchStrategy:
          searchStrategyResult,

        finalSearchStrategy,

        strategyOverridden:
          searchStrategyOverride !==
          null,
      },

      investigations: {
        automatic:
          (
            holeInvestigationResult
              ?.events ??
            []
          ).map(
            (event) => ({
              ...event,
            }),
          ),

        final:
          finalReviewedEvents.map(
            (event) => ({
              ...event,
            }),
          ),

        reviewSummary: {
          ...finalReviewedEventSummary,
        },

        reviewDecisions: {
          ...holeEventReviewDecisions,
        },

        manualAdditions:
          manualHoleEventAdditions.map(
            (addition) => ({
              ...addition,
            }),
          ),
      },

      escape: {
        candidate:
          escapeCandidate,

        review:
          activeEscapeReview
            ? {
                ...activeEscapeReview,
              }
            : null,
      },

      provenance: {
        trialStartManuallyOverridden:
          trialStartOverride !==
          null,

        manualTrackCorrections: {
          ...manualTrackPointCorrections,
        },

        strategyOverride:
          searchStrategyOverride
            ? {
                ...searchStrategyOverride,
              }
            : null,
      },
    };
  }, [
    selectedFile,
    result,
    bodyTrack,
    effectiveBodyTrack,
    trialWindow,
    automaticTrialWindow,
    trialStartOverride,

    arenaCalibration,
    holeGeometry,

    segmentationSettings,
    trajectorySmoothingSettings,
    trajectoryOutlierSettings,
    orientationSettings,
    holeInvestigationSettings,
    escapeDetectionSettings,
    searchStrategySettings,

    trackQc,
    orientationQc,
    processedTrajectory,
    trackOutlierAnalysis,
    trialDetectionRate,

    primaryBehaviorMetrics,
    primaryBehaviorReviewSummary,
    escapeBehaviorMetrics,
    trajectoryMetrics,
    targetQuadrantMetrics,
    searchStrategyResult,
    finalSearchStrategy,
    searchStrategyOverride,

    holeInvestigationResult,
    finalReviewedEvents,
    finalReviewedEventSummary,
    holeEventReviewDecisions,
    manualHoleEventAdditions,

    escapeCandidate,
    activeEscapeReview,
    manualTrackPointCorrections,

    activeBatchReviewReadiness,
  ]);
useEffect(() => {
  if (
    !selectedFile ||
    !activeBatchAnalysisSnapshot
  ) {
    return;
  }

  const id =
    batchItemId(
      selectedFile,
    );

  setBatchAnalysisSnapshots(
    (current) => {
      if (
        current[id] ===
        activeBatchAnalysisSnapshot
      ) {
        return current;
      }

      return {
        ...current,

        [id]:
          activeBatchAnalysisSnapshot,
      };
    },
  );
}, [
  selectedFile,
  activeBatchAnalysisSnapshot,
]);
const trialSummaryRows =
  useMemo(
    () =>
      buildTrialSummaryRows(
        batchItems,
        batchAnalysisSnapshots,
      ),
    [
      batchItems,
      batchAnalysisSnapshots,
    ],
  );

const investigationEventRows =
  useMemo(
    () =>
      buildInvestigationEventRows(
        batchItems,
        batchAnalysisSnapshots,
      ),
    [
      batchItems,
      batchAnalysisSnapshots,
    ],
  );
const analysisParameterRows =
  useMemo(
    () =>
      buildAnalysisParameterRows(
        batchItems,
        batchAnalysisSnapshots,
      ),
    [
      batchItems,
      batchAnalysisSnapshots,
    ],
  );

  const trackingQcRows =
  useMemo(
    () =>
      buildTrackingQcRows(
        batchItems,
        batchAnalysisSnapshots,
      ),
    [
      batchItems,
      batchAnalysisSnapshots,
    ],
  );

const roiRows =
  useMemo(
    () =>
      buildRoiRows(
        batchItems,
        batchAnalysisSnapshots,
      ),
    [
      batchItems,
      batchAnalysisSnapshots,
    ],
  );
const capturedTrialCount =
  trialSummaryRows.length;

const capturedEventCount =
  investigationEventRows
    .length;
  
const [
  xlsxExportBusy,
  setXlsxExportBusy,
] = useState(false);

const [
  xlsxExportError,
  setXlsxExportError,
] = useState<
  string | null
>(null);
async function handleDownloadXlsx() {
  if (
    capturedTrialCount === 0 ||
    batchRunState.running ||
    xlsxExportBusy
  ) {
    return;
  }

  setXlsxExportBusy(true);
  setXlsxExportError(null);

  try {
    await downloadAnalysisWorkbook(
      'barnes_maze_analysis.xlsx',
      trialSummaryRows,
      investigationEventRows,
      analysisParameterRows,
    );
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message
        : String(cause);

    setXlsxExportError(
      message,
    );
  } finally {
    setXlsxExportBusy(false);
  }
}
function clearBatchAnalysisSnapshot(
  id: string,
) {
  setBatchAnalysisSnapshots(
    (current) => {
      if (!current[id]) {
        return current;
      }

      const next = {
        ...current,
      };

      delete next[id];

      return next;
    },
  );
}
   
  const trackingCancelRef =
  useRef<
    (() => void) |
    null
  >(null);

async function handleTrackMouse():
  Promise<boolean> {
  if (
    !selectedFile ||
    !result?.background ||
    !arenaCalibration
  ) {
    return false;
  }

  /*
   * Capture this video's inputs now.
   * Do not rely on mutable React state after
   * the asynchronous tracking task begins.
   */
const file =
  selectedFile;

/*
 * A new tracking pass invalidates the
 * previously calculated result snapshot.
 *
 * If tracking succeeds, a new snapshot
 * will be produced automatically.
 */
clearBatchAnalysisSnapshot(
  batchItemId(
    file,
  ),
);

const background =
  result.background;

  const calibration =
    arenaCalibration;

  const settings =
    segmentationSettings;

  updateBatchItem(
    file,
    'tracking',
  );

  setTrackingBusy(
    true,
  );

  setTrackingProgress(
    null,
  );

  setBodyTrack(
    null,
  );

  setError(
    null,
  );

  const task =
    trackVideoFile(
      file,
      background,
      calibration,
      settings,
      setTrackingProgress,
    );

  trackingCancelRef.current =
    task.cancel;

  try {
    const track =
      await task.promise;

    setBodyTrack(
      track,
    );

    /*
     * Tracking succeeded.
     *
     * The readiness layer may subsequently
     * promote this row to Reviewed.
     */
    updateBatchItem(
      file,
      'decoded',
    );

    return true;
  } catch (cause) {
    if (
      cause instanceof
        DOMException &&
      cause.name ===
        'AbortError'
    ) {
      /*
       * Decode remains valid even though
       * tracking was cancelled.
       */
      updateBatchItem(
        file,
        'decoded',
      );

      return false;
    }

    const message =
      cause instanceof Error
        ? cause.message
        : String(cause);

    setError(
      message,
    );

    updateBatchItem(
      file,
      'error',
      message,
    );

    return false;
  } finally {
    trackingCancelRef.current =
      null;

    setTrackingBusy(
      false,
    );
  }
}
function setEscapeReviewStatus(
  status: EscapeReviewStatus,
) {
  if (!escapeCandidate) {
    return;
  }

  setEscapeReviewDecision({
    candidateKey:
      escapeCandidate
        .candidateKey,

    status,

    note:
      activeEscapeReview
        ?.note ?? '',

    reviewedAtIso:
      status === 'unreviewed'
        ? null
        : new Date().toISOString(),
  });
}

function updateBatchItem(
  file: File,

  status:
    BatchItemStatus,

  errorMessage:
    string | null =
      null,
) {
  const id =
    batchItemId(
      file,
    );

  setBatchItems(
    (current) => {
      const existing =
        current.find(
          (item) =>
            item.id ===
            id,
        );

      const now =
        new Date()
          .toISOString();

      if (!existing) {
        return [
          ...current,

          {
            ...createBatchItem(
              file,
            ),

            status,

            error:
              errorMessage,

            lastOpenedAtIso:
              now,
          },
        ];
      }

      return current.map(
        (item) =>
          item.id === id
            ? {
                ...item,

                /*
                 * Refresh the File reference in
                 * case the user selected it again.
                 */
                file,

                status,

                error:
                  errorMessage,

                lastOpenedAtIso:
                  now,
              }
            : item,
      );
    },
  );
}
function addFilesToBatch(
  files: File[],
) {
  if (files.length === 0) {
    return;
  }

  setBatchItems(
    (current) => {
      /*
       * Preserve existing queue order and
       * analysis status when a file is
       * selected again.
       */
      const next =
        [...current];

      const indexById =
        new Map<
          string,
          number
        >();

      for (
        let index = 0;
        index < next.length;
        index += 1
      ) {
        indexById.set(
          next[index].id,
          index,
        );
      }

      for (const file of files) {
        const id =
          batchItemId(
            file,
          );

        const existingIndex =
          indexById.get(
            id,
          );

        if (
          existingIndex !==
          undefined
        ) {
          /*
           * Refresh the live File reference,
           * but do not destroy status,
           * timestamps, or an existing error.
           */
          next[
            existingIndex
          ] = {
            ...next[
              existingIndex
            ],

            file,
          };

          continue;
        }

        indexById.set(
          id,
          next.length,
        );

        next.push(
          createBatchItem(
            file,
          ),
        );
      }

      return next;
    },
  );
}
function removeBatchItem(
  id: string,
) {
  setBatchItems(
    (current) =>
      current.filter(
        (item) =>
          item.id !== id,
      ),
  );
  clearBatchAnalysisSnapshot(
  id,
);
}
function startBatchRun() {
  if (
    batchRunState.running ||
    busy ||
    trackingBusy
  ) {
    return;
  }

  const itemIds =
    runnableBatchItems.map(
      (item) =>
        item.id,
    );

  if (
    itemIds.length === 0
  ) {
    return;
  }

  batchRunStopRequestedRef
    .current = false;

  setBatchRunState({
    running:
      true,

    itemIds,

    currentIndex:
      0,

    stage:
      'start-file',
  });
}

function stopBatchRun() {
  batchRunStopRequestedRef
    .current = true;

  /*
   * Stop whichever low-level operation
   * happens to be active.
   */
  cancelRef.current?.();

  trackingCancelRef
    .current
    ?.();

  setBatchRunState(
    (current) => ({
      ...current,

      running:
        false,

      stage:
        'idle',
    }),
  );
}

function advanceBatchRun() {
  setBatchRunState(
    (current) => {
      if (
        !current.running
      ) {
        return current;
      }

      const nextIndex =
        current.currentIndex +
        1;

      if (
        nextIndex >=
        current.itemIds.length
      ) {
        return {
          ...current,

          running:
            false,

          currentIndex:
            current.itemIds.length,

          stage:
            'complete',
        };
      }

      return {
        ...current,

        currentIndex:
          nextIndex,

        stage:
          'start-file',
      };
    },
  );
}

async function handleFile(
  file: File,
): Promise<boolean> {
  updateBatchItem(
    file,
    'decoding',
  );

  sessionHydratedKeyRef.current =
    null;

  setSessionNotice(null);

  setResult(null);
  setError(null);
  setBusy(true);
  setProgress(null);

  setArenaCalibration(null);
  setHoleGeometry(null);
  setBodyTrack(null);

  setSelectedFile(file);

  setHoleEventReviewDecisions({});
  setManualHoleEventAdditions([],);
  setTrialStartOverride(null,);
  setManualTrackPointCorrections({});

  /*
   * Prevent settings from one unrelated video
   * leaking into another new video.
   */
  setSegmentationSettings({
    ...DEFAULT_SEGMENTATION_SETTINGS,
  });

  setTrajectorySmoothingSettings({
    ...DEFAULT_TRAJECTORY_SETTINGS,
  });

setTrajectoryOutlierSettings({
  ...DEFAULT_TRAJECTORY_OUTLIER_SETTINGS,
});

  setOrientationSettings({
    ...DEFAULT_ORIENTATION_SETTINGS,
  });

  setHoleInvestigationSettings({
    ...DEFAULT_HOLE_INVESTIGATION_SETTINGS,
  });
  setEscapeDetectionSettings({
  ...DEFAULT_ESCAPE_DETECTION_SETTINGS,
});
setSearchStrategySettings({
  ...DEFAULT_SEARCH_STRATEGY_SETTINGS,
});

setSearchStrategyOverride(
  null,
);

setEscapeReviewDecision(
  null,
);
  const task =
    decodeVideoFile(
      file,
      setProgress,
    );

  cancelRef.current =
    task.cancel;

    try {
      const decoded = await task.promise;
      setResult(decoded);
        const stored =
    readSavedSession(file);

  const key =
    savedSessionKey(file);

  if (
    stored &&
    stored.videoWidth ===
      decoded.metadata.width &&
    stored.videoHeight ===
      decoded.metadata.height
  ) {
    setArenaCalibration(
      stored.arenaCalibration,
    );

    setHoleGeometry(
      stored.holeGeometry,
    );

    setSegmentationSettings({
      ...stored.segmentationSettings,
    });

    setTrajectorySmoothingSettings({
      ...stored
        .trajectorySmoothingSettings,
    });

    setTrajectoryOutlierSettings({
  ...DEFAULT_TRAJECTORY_OUTLIER_SETTINGS,

  ...(
    stored.trajectoryOutlierSettings ??
    {}
  ),
});

    setOrientationSettings({
      ...stored.orientationSettings,
    });

    setHoleInvestigationSettings({
      ...stored
        .holeInvestigationSettings,
    });

    setEscapeDetectionSettings({
  ...DEFAULT_ESCAPE_DETECTION_SETTINGS,
  ...(
    stored.escapeDetectionSettings ??
    {}
  ),
});

setEscapeReviewDecision(
  stored.escapeReviewDecision ??
  null,
);
    setSearchStrategySettings({
  ...DEFAULT_SEARCH_STRATEGY_SETTINGS,

  ...(
    stored.searchStrategySettings ??
    {}
  ),
});

setSearchStrategyOverride(
  stored.searchStrategyOverride ??
  null,
);
    setHoleEventReviewDecisions(
      stored.eventReviews ?? {},
    );
    setManualHoleEventAdditions(
  stored.manualHoleEventAdditions ??
  [],
);
setTrialStartOverride(
  stored.trialStartOverride ??
  null,
);

setManualTrackPointCorrections(
  stored.manualTrackPointCorrections ??
  {},
);
    setSessionNotice(
      'Saved analysis settings and calibration restored.',
    );
  } else {
    /*
     * If file identity happened to match but
     * dimensions did not, do not trust it.
     */
    if (stored) {
      localStorage.removeItem(
        key,
      );
    }

    setSessionNotice(
      'No compatible saved analysis found. Starting from defaults.',
    );
  }

/*
 * Saving is permitted only AFTER loading
 * has completed for this file.
 */
sessionHydratedKeyRef.current =
  key;

updateBatchItem(
  file,
  'decoded',
);

return true;
} catch (cause) {
  if (
    cause instanceof
      DOMException &&
    cause.name ===
      'AbortError'
  ) {
    updateBatchItem(
      file,
      'queued',
    );

    return false;
  }

  const message =
    cause instanceof Error
      ? cause.message
      : String(cause);

  setError(
    message,
  );

  updateBatchItem(
    file,
    'error',
    message,
  );

  return false;
} finally {
      cancelRef.current = null;
      setBusy(false);
    }
  }

/*
 * Batch stage 1:
 * open/decode one source file.
 */
useEffect(() => {
  if (
    !batchRunState.running ||
    batchRunState.stage !==
      'start-file' ||
    !activeBatchRunItem
  ) {
    return;
  }

  /*
   * Change stage before starting the async
   * task so this effect cannot start the
   * same file twice.
   */
  setBatchRunState(
    (current) => ({
      ...current,

      stage:
        'decoding',
    }),
  );

  void handleFile(
    activeBatchRunItem.file,
  ).then(
    (success) => {
      if (
        batchRunStopRequestedRef
          .current
      ) {
        return;
      }

      if (!success) {
        advanceBatchRun();

        return;
      }

      setBatchRunState(
        (current) => ({
          ...current,

          stage:
            'post-decode',
        }),
      );
    },
  );
}, [
  batchRunState.running,
  batchRunState.stage,
  activeBatchRunItem,
]);
/*
 * Batch stage 2:
 * wait until handleFile()'s React state
 * updates have actually committed.
 */
useEffect(() => {
  if (
    !batchRunState.running ||
    batchRunState.stage !==
      'post-decode' ||
    !activeBatchRunItem
  ) {
    return;
  }

  if (
    busy ||
    !selectedFile ||
    batchItemId(
      selectedFile,
    ) !==
      activeBatchRunItem.id ||
    !result
  ) {
    return;
  }

  /*
   * Arena calibration is required by the
   * tracking algorithm.
   *
   * Hole calibration is NOT required to
   * compute the body track, so a video with
   * an arena but missing hole geometry can
   * still benefit from automatic tracking.
   */
  if (!arenaCalibration) {
    setBatchItems(
      (current) =>
        current.map(
          (item) =>
            item.id ===
              activeBatchRunItem.id
              ? {
                  ...item,

                  status:
                    'decoded',

                  reviewReadiness:
                    'needs-calibration',
                }
              : item,
        ),
    );

    advanceBatchRun();

    return;
  }

  setBatchRunState(
    (current) => ({
      ...current,

      stage:
        'start-tracking',
    }),
  );
}, [
  batchRunState.running,
  batchRunState.stage,
  activeBatchRunItem,
  busy,
  selectedFile,
  result,
  arenaCalibration,
]);
/*
 * Batch stage 3:
 * run one tracker only.
 */
useEffect(() => {
  if (
    !batchRunState.running ||
    batchRunState.stage !==
      'start-tracking' ||
    !activeBatchRunItem
  ) {
    return;
  }

  if (
    !selectedFile ||
    batchItemId(
      selectedFile,
    ) !==
      activeBatchRunItem.id
  ) {
    return;
  }

  setBatchRunState(
    (current) => ({
      ...current,

      stage:
        'tracking',
    }),
  );

  void handleTrackMouse()
    .then(
      (success) => {
        if (
          batchRunStopRequestedRef
            .current
        ) {
          return;
        }

        if (!success) {
          /*
           * An actual tracking failure has
           * already marked the row Error.
           * A cancellation also stops here.
           */
          advanceBatchRun();

          return;
        }

        setBatchRunState(
          (current) => ({
            ...current,

            stage:
              'post-track',
          }),
        );
      },
    );
}, [
  batchRunState.running,
  batchRunState.stage,
  activeBatchRunItem,
  selectedFile,
]);
/*
 * Batch stage 4:
 * BodyTrack has committed, so all synchronous
 * downstream useMemos can now classify the
 * current video's review state.
 */
useEffect(() => {
  if (
    !batchRunState.running ||
    batchRunState.stage !==
      'post-track' ||
    !activeBatchRunItem
  ) {
    return;
  }

if (
  trackingBusy ||
  !selectedFile ||
  batchItemId(
    selectedFile,
  ) !==
    activeBatchRunItem.id ||
  !bodyTrack ||
  !batchAnalysisSnapshots[
    activeBatchRunItem.id
  ]
) {
  return;
}

  /*
   * Snapshot the derived readiness before
   * moving to the next file.
   */
  setBatchItems(
    (current) =>
      current.map(
        (item) => {
          if (
            item.id !==
            activeBatchRunItem.id
          ) {
            return item;
          }

          return {
            ...item,

            reviewReadiness:
              activeBatchReviewReadiness,

            status:
              activeBatchReviewReadiness ===
                'review-complete'
                ? 'reviewed'
                : 'decoded',
          };
        },
      ),
  );

  advanceBatchRun();
}, [
  batchRunState.running,
  batchRunState.stage,
  activeBatchRunItem,
  selectedFile,
  trackingBusy,
  bodyTrack,
  activeBatchReviewReadiness,
  batchAnalysisSnapshots,
]);

  const first = result?.frames[0] ?? null;
  const last = result?.frames.at(-1) ?? null;
  const durationFromPresentation =
    first && last ? timeToSeconds(last.pts) - timeToSeconds(first.pts) : null;
  const calibrationFrame =
  result?.representativeFrames.length
    ? result.representativeFrames[
        Math.floor(
          result.representativeFrames.length / 2,
        )
      ]
    : null;

    
  return (
    <main className="page-shell">
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">Prototype {TOOL_VERSION}</p>
        <h1 id="page-title">Barnes Maze Analyzer</h1>
        <p className="lede">
          Initial decoder validation: choose a local Barnes maze MP4 to inspect its exact
          presentation timestamps. The video stays on this computer.
        </p>

        {!capabilities.webCodecs && (
          <div className="notice notice-error" role="alert">
            This browser does not expose WebCodecs VideoDecoder. Decoder analysis cannot run here.
          </div>
        )}

        <div className="actions">
          <label className="file-button">
            <span>Choose Barnes maze video</span>
            <input
              type="file"
              accept="video/mp4,.mp4"
              disabled={
                  !capabilities.webCodecs ||
                  busy ||
                  trackingBusy ||
                  batchRunState.running
                }
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
            <label className="file-button">
            <span>
              Add videos to batch
            </span>

            <input
              type="file"

              accept="video/mp4,.mp4"

              multiple

disabled={
  !capabilities.webCodecs ||
  batchRunState.running
}

              onChange={(
                event:
                  ChangeEvent<HTMLInputElement>,
              ) => {
                const files =
                  Array.from(
                    event.currentTarget
                      .files ??
                    [],
                  );

                if (
                  files.length > 0
                ) {
                  addFilesToBatch(
                    files,
                  );
                }

                /*
                * Allow the same source files to be
                * selected again later.
                */
                event.currentTarget.value =
                  '';
              }}
            />
          </label>

          <button
  type="button"

  disabled={
    !capabilities.webCodecs ||
    batchRunState.running ||
    busy ||
    trackingBusy ||
    runnableBatchItems.length ===
      0
  }

  onClick={
    startBatchRun
  }
>
  Run queued videos
  {
    runnableBatchItems.length >
    0
      ? ` (${runnableBatchItems.length})`
      : ''
  }
</button>
{batchRunState.running && (
  <button
    type="button"

    className="secondary-button"

    onClick={
      stopBatchRun
    }
  >
    Stop batch
  </button>
)}
          {busy && !batchRunState.running && (
            <button className="secondary-button" type="button" onClick={() => cancelRef.current?.()}>
              Cancel
            </button>
          )}
        </div>

        {batchRunState.running &&
 activeBatchRunItem && (
  <div
    role="status"
    aria-live="polite"

    style={{
      marginTop:
        '0.75rem',
    }}
  >
    <strong>
      Batch automatic processing
    </strong>

    <div>
      {
        batchRunState
          .currentIndex +
        1
      }
      {' / '}
      {
        batchRunState
          .itemIds.length
      }
      {' · '}
      {
        activeBatchRunItem
          .file.name
      }
      {' · '}
      {
        batchRunState.stage ===
          'start-file' ||
        batchRunState.stage ===
          'decoding' ||
        batchRunState.stage ===
          'post-decode'
          ? 'Decoding / restoring settings'

          : batchRunState.stage ===
              'start-tracking' ||
            batchRunState.stage ===
              'tracking' ||
            batchRunState.stage ===
              'post-track'
            ? 'Tracking / deriving analysis'

            : 'Preparing'
      }
    </div>

    <progress
      value={
        batchRunState.currentIndex
      }

      max={
        batchRunState
          .itemIds.length
      }
    />
  </div>
)}
{!batchRunState.running &&
 batchRunState.stage ===
   'complete' && (
  <p role="status">
    Automatic batch pass complete.
    Review the queue for videos that
    still require calibration or manual
    review.
  </p>
)}
        {batchItems.length > 0 && (
  <section
    aria-labelledby="batch-queue-heading"
    style={{
      marginTop:
        '1rem',
    }}
  >
    <h2
      id="batch-queue-heading"
      style={{
        fontSize:
          '1rem',

        margin:
          '0 0 0.5rem',
      }}
    >
      Batch queue
      {' · '}
      {
        batchItems.length
      }
      {
        batchItems.length ===
        1
          ? ' video'
          : ' videos'
      }
    </h2>

<div
  className="table-scroll"

  tabIndex={0}

  aria-label={
    'Batch queue table'
  }

  style={{
    overflowX:
      'auto',
  }}
>
      <table>
        <thead>
          <tr>
            <th scope="col">
              File
            </th>

            <th scope="col">
              Status
            </th>
            <th scope="col">
              Review status
            </th>
            <th scope="col">
              Saved review/settings
            </th>
            <th scope="col">
  Results
</th>
            <th scope="col">
              Current
            </th>

            <th scope="col">
              Actions
            </th>
          </tr>
        </thead>

        <tbody>
          {batchItems.map(
            (item) => {
              const isActive =
                selectedFile !==
                  null &&
                batchItemId(
                  selectedFile,
                ) ===
                  item.id;

              const hasSavedSession =
                readSavedSession(
                  item.file,
                ) !== null;
                const hasResultSnapshot =
  batchAnalysisSnapshots[
    item.id
  ] !== undefined;
              return (
                <tr
                  key={
                    item.id
                  }
                >
                  <td>
                    {
                      item.file.name
                    }
                  </td>

                  <td>
                    {
                      batchStatusLabel(
                        item.status,
                      )
                    }

                    {item.error && (
                      <>
                        <br />

                        <span>
                          {
                            item.error
                          }
                        </span>
                      </>
                    )}
                  </td>
                    <td>
                    {
                      batchReadinessLabel(
                        item.reviewReadiness,
                      )
                    }
                  </td>
                  <td>
                    {
                      hasSavedSession
                        ? 'Yes'
                        : 'No'
                    }
                  </td>
                    <td>
  {
    hasResultSnapshot
      ? 'Captured'
      : 'Pending'
  }
</td>
                  <td>
                    {
                      isActive
                        ? 'Open'
                        : '—'
                    }
                  </td>

                  <td>
                    <div
                      className="actions"
                    >
                      <button
                        type="button"

                                aria-label={
          isActive
            ? `${item.file.name} is currently open`
            : `Open ${item.file.name} for review`
        }

                        disabled={
                          batchRunState.running ||
                          busy ||
                          trackingBusy ||
                          isActive
                        }

                        onClick={() => {
                          void handleFile(
                            item.file,
                          );
                        }}
                      >
                        {
                          isActive
                            ? 'Currently open'

                            : item.status ===
                              'queued'
                              ? 'Open'

                              : 'Open / review'
                        }
                      </button>

                      <button
                        type="button"
                        aria-label={
                          `Remove ${item.file.name} from batch`
                        }
                        disabled={
                          batchRunState.running ||
                          busy ||
                          trackingBusy ||
                          isActive
                        }

                        onClick={() =>
                          removeBatchItem(
                            item.id,
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  </section>
)}

{batchItems.length > 0 && (
  <section
    aria-labelledby="results-export-heading"

    style={{
      marginTop:
        '1rem',
    }}
  >
    <h2
      id="results-export-heading"

      style={{
        fontSize:
          '1rem',

        margin:
          '0 0 0.5rem',
      }}
    >
      Results and export
    </h2>

    <p
      role="status"
      aria-live="polite"
    >
      {
        capturedTrialCount
      }
      {' of '}
      {
        batchItems.length
      }
      {
        batchItems.length ===
        1
          ? ' trial has'
          : ' trials have'
      }
      {' captured results. '}

      {
        capturedEventCount
      }
      {
        capturedEventCount ===
        1
          ? ' investigation record is'
          : ' investigation records are'
      }
      {' available for export.'}
    </p>

    <p>
      Captured results may still require
      manual review. Check each trial's
      Review status before using results
      for final analysis.
    </p>

    <div
      className="actions"
    >
      <button
        type="button"

        disabled={
          capturedTrialCount ===
            0 ||
          batchRunState.running
        }

        aria-label={
          'Download Barnes maze trial summary CSV'
        }

        onClick={() =>
          downloadCsv(
            'barnes_trial_summary.csv',
            TRIAL_SUMMARY_COLUMNS,
            trialSummaryRows,
          )
        }
      >
        Download trial summary CSV
      </button>

      <button
        type="button"

        disabled={
          capturedTrialCount ===
            0 ||
          batchRunState.running
        }

        aria-label={
          'Download Barnes maze investigation event detail CSV'
        }

        onClick={() =>
          downloadCsv(
            'barnes_investigation_events.csv',
            INVESTIGATION_EVENT_COLUMNS,
            investigationEventRows,
          )
        }
      >
        Download investigation events CSV
      </button>
      <button
  type="button"
  disabled={
    capturedTrialCount ===
      0 ||
    batchRunState.running ||
    xlsxExportBusy
  }
  aria-label={
    'Download complete Barnes maze analysis workbook in Excel XLSX format'
  }
  onClick={
    handleDownloadXlsx
  }
>
  {
    xlsxExportBusy
      ? 'Building XLSX workbook…'
      : 'Download analysis workbook XLSX'
  }
</button>
    </div>
{xlsxExportBusy && (
  <p
    role="status"
    aria-live="polite"
  >
    Building Excel workbook from
    captured analysis results.
  </p>
)}

{xlsxExportError && (
  <p role="alert">
    XLSX export failed:{' '}
    {xlsxExportError}
  </p>
)}
    {batchRunState.running && (
      <p role="status">
        CSV export is available after the
        current automatic batch pass
        finishes so that captured results
        cannot change during download.
      </p>
    )}
  </section>
)}
        {selectedFile &&
        sessionNotice && (
          <p role="status">
            {sessionNotice}
          </p>
        )}

        {progress && (
          <div className="progress-block" aria-live="polite">
            <strong>
              {progress.phase === 'reading'
                ? 'Reading video'
                : progress.phase === 'demuxing'
                  ? 'Extracting video frames'
                  : 'Decoding video frames'}
            </strong>
            <progress value={progress.completed} max={progress.total ?? undefined} />
            <span>
              {progress.total
                ? `${Math.round((100 * progress.completed) / progress.total)}%`
                : progress.completed.toLocaleString()}
            </span>
          </div>
        )}

        {error && (
          <div className="notice notice-error" role="alert">
            <strong>Analysis stopped.</strong> {error}
          </div>
        )}
      </section>

      {result && (
        <section className="card" aria-labelledby="metadata-heading">
          <h2 id="metadata-heading">Decoder check</h2>
          <dl className="metadata-grid">
            <div>
              <dt>File</dt>
              <dd>{result.metadata.identity.name}</dd>
            </div>
            <div>
              <dt>Codec</dt>
              <dd>{result.metadata.codec}</dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>
                {result.metadata.width} × {result.metadata.height}
              </dd>
            </div>
            <div>
              <dt>Track timescale</dt>
              <dd>{result.metadata.trackTimescale.toLocaleString()} ticks/s</dd>
            </div>
            <div>
              <dt>Container frame count</dt>
              <dd>{result.metadata.frameCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Decoded frame count</dt>
              <dd>{result.decodedFrames.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Container-derived average rate</dt>
              <dd>
                {result.metadata.nominalFps === null
                  ? 'Unavailable'
                  : `${result.metadata.nominalFps.toFixed(6)} fps`}
              </dd>
            </div>
            <div>
  <dt>Median PTS cadence</dt>
  <dd>
    {result.timingValidation.medianFrameIntervalTicks !== null
      ? `${(
          result.metadata.trackTimescale /
          result.timingValidation.medianFrameIntervalTicks
        ).toFixed(6)} fps`
      : 'Unavailable'}
  </dd>
</div>
            <div>
              <dt>First presentation timestamp</dt>
              <dd>{first ? formatSeconds(timeToSeconds(first.pts)) : 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Last presentation timestamp</dt>
              <dd>{last ? formatSeconds(timeToSeconds(last.pts)) : 'Unavailable'}</dd>
            </div>
            <div>
              <dt>First-to-last PTS span</dt>
              <dd>
                {durationFromPresentation === null
                  ? 'Unavailable'
                  : formatSeconds(durationFromPresentation)}
              </dd>
            </div>
          </dl>
          {result && (
  <section className="card">
    <h2>Timing integrity</h2>

    <dl className="decoder-grid">
      <div>
  <dt>Decode integrity</dt>
  <dd>
    {result.timingValidation.decodeIntegrityValid
      ? 'Pass'
      : 'Failed'}
  </dd>
</div>

<div>
  <dt>Timing regularity</dt>
  <dd>
    {result.timingValidation.timingRegular
      ? 'Regular'
      : 'Irregular — source timestamps preserved'}
  </dd>
</div>

    </dl>
  </section>
)}
{result &&
 result.representativeFrames.length > 0 && (
  <section className="card">
    <h2>
      Representative decoded frames
    </h2>

    <p>
      Grayscale luminance extracted directly
      from the decoded video frames.
    </p>

    <div className="preview-grid">
      {result.representativeFrames
        .sort(
          (a, b) =>
            a.decodedIndex -
            b.decodedIndex,
        )
        .map((frame) => (
          <GrayscalePreview
            key={
              `${frame.decodedIndex}-${frame.timing.pts.ticks}`
            }
            frame={frame}
          />
        ))}
    </div>
    {calibrationFrame && (
<ArenaCalibrationView
  frame={calibrationFrame}
  calibration={arenaCalibration}
onCalibrationChange={(calibration) => {
  const previous =
    arenaCalibration;

  /*
   * A full reset removes the geometric
   * foundation used by hole calibration,
   * tracking, events, escape detection,
   * trajectory metrics, and review.
   */
  if (
    previous !== null &&
    calibration === null
  ) {
    const confirmed =
      window.confirm(
        [
          'Reset arena calibration?',
          '',
          'Changing the arena calibration changes the foundation of this analysis.',
          '',
          'Hole calibration, tracking, behavioral events, escape detection, metrics, and manual review will need to be recomputed and reviewed.',
          '',
          'This action cannot preserve the current analyzed results.',
        ].join('\n'),
      );

    if (!confirmed) {
      return;
    }
  }
    /*
     * Hole positions depend on the arena's
     * image-space geometry:
     *
     * - image dimensions
     * - center
     * - platform radius
     *
     * Physical diameter is only a px → cm
     * scale and must NOT invalidate hole
     * calibration.
     */
    const holeGeometryChanged =
      previous === null ||
      calibration === null
        ? previous !== calibration
        : (
            previous.imageWidth !==
              calibration.imageWidth ||

            previous.imageHeight !==
              calibration.imageHeight ||

            previous.centerX !==
              calibration.centerX ||

            previous.centerY !==
              calibration.centerY ||

            previous.platformRadiusPixels !==
              calibration.platformRadiusPixels
          );

    /*
     * Tracking also depends on the tracking
     * margin. Changing only the physical
     * diameter does not alter pixel-space
     * tracking.
     */
    const trackingGeometryChanged =
      holeGeometryChanged ||
      (
        previous !== null &&
        calibration !== null &&
        previous.trackingMarginPixels !==
          calibration.trackingMarginPixels
      );

    /*
     * Physical diameter changes quantitative
     * physical-unit output, so any existing
     * result snapshot should be refreshed.
     *
     * If BodyTrack remains valid, the normal
     * snapshot effect will immediately capture
     * updated cm-based results.
     */
    const physicalScaleChanged =
      previous !== null &&
      calibration !== null &&
      previous.platformDiameterCm !==
        calibration.platformDiameterCm;

    setArenaCalibration(
      calibration,
    );

    if (
      selectedFile &&
      (
        trackingGeometryChanged ||
        physicalScaleChanged
      )
    ) {
      clearBatchAnalysisSnapshot(
        batchItemId(
          selectedFile,
        ),
      );
    }

    if (
      holeGeometryChanged
    ) {
      setHoleGeometry(
        null,
      );
    }

    if (
  trackingGeometryChanged
) {
  /*
   * Any image-space or tracking-mask change
   * invalidates the derived tracking result
   * and all review decisions based on it.
   *
   * Do not allow old annotations to silently
   * attach to a newly computed analysis.
   */
  setBodyTrack(
    null,
  );

  setTrackingProgress(
    null,
  );

  setHoleEventReviewDecisions(
    {},
  );

  setManualHoleEventAdditions(
    [],
  );

  setTrialStartOverride(
    null,
  );

  setManualTrackPointCorrections(
    {},
  );

  setEscapeReviewDecision(
    null,
  );

  setSearchStrategyOverride(
    null,
  );
}
  }}
/>
    )}
    {calibrationFrame &&
      arenaCalibration && (
        <ArenaMaskPreview
          frame={calibrationFrame}
          calibration={arenaCalibration}
        />
      )}
      {result?.background && (
  <BackgroundPreview
    background={
      result.background
    }
  />
)}
{result?.background &&
 arenaCalibration && (
  <HoleCalibrationView
    /*
     * Remount the selector whenever the
     * image-space arena geometry changes.
     *
     * This intentionally does NOT include
     * tracking margin or physical diameter,
     * because those changes do not invalidate
     * calibrated hole positions.
     */
    key={[
      arenaCalibration.imageWidth,
      arenaCalibration.imageHeight,
      arenaCalibration.centerX,
      arenaCalibration.centerY,
      arenaCalibration.platformRadiusPixels,
    ].join(':')}

    background={
      result.background
    }

    arena={
      arenaCalibration
    }

    geometry={
      holeGeometry
    }

    onGeometryChange={
      setHoleGeometry
    }
  />
)}
{calibrationFrame &&
 result?.background &&
 arenaCalibration && (
  <SegmentationPreview
  frame={calibrationFrame}
  background={result.background}
  calibration={arenaCalibration}
  settings={segmentationSettings}
  onSettingsChange={
    (newSettings) => {
      setSegmentationSettings(
        newSettings,
      );

      /*
       * Existing tracking is now stale.
       */
      setBodyTrack(null);
    }
  }
  />
)}
{selectedFile &&
 result?.background &&
 arenaCalibration && (
  <section className="card">
    <h2>
      Full-video tracking
    </h2>

    <p>
      Track the mouse through every decoded
      frame using the confirmed arena,
      background model, and segmentation
      settings.
    </p>

    <div className="actions">
      <button
        type="button"
        onClick={() => {
          void handleTrackMouse();
        }}
        disabled={
          trackingBusy
          || busy || batchRunState.running
        }
      >
        {trackingBusy
          ? 'Tracking mouse…'
          : 'Track mouse'}
      </button>

      {trackingBusy && !batchRunState.running &&(
        <button
          type="button"
          onClick={() =>
            trackingCancelRef
              .current?.()
          }
        >
          Cancel
        </button>
      )}
    </div>

    {trackingProgress && (
      <div
        className="progress-block"
        aria-live="polite"
      >
        <strong>
          Tracking mouse
        </strong>

        <progress
          value={
            trackingProgress.completed
          }
          max={
            trackingProgress.total
          }
        />

        <span>
          {Math.round(
            100 *
              trackingProgress.completed /
              trackingProgress.total,
          )}
          %
        </span>
      </div>
    )}
  </section>
)}
{bodyTrack && (
  <section className="card">
    <h2>
      Body tracking summary
    </h2>

    <dl className="metadata-grid">
      <div>
        <dt>
          Frames processed
        </dt>

        <dd>
          {bodyTrack.points.length.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>
          Body detected
        </dt>

        <dd>
          {bodyTrack.detectedFrameCount.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>
          Body not detected
        </dt>

        <dd>
          {bodyTrack.missingFrameCount.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>
          Detection rate
        </dt>

        <dd>
          {bodyTrack.points.length > 0
            ? `${(
                100 *
                bodyTrack.detectedFrameCount /
                bodyTrack.points.length
              ).toFixed(1)}%`
            : 'Unavailable'}
        </dd>
      </div>
    </dl>
  </section>
)}
{orientationQc && (
  <section className="card">
    <h2>Nose and orientation QC</h2>

    <p>
      Body orientation is estimated from the segmented
      body axis. Nose direction is resolved using movement
      when available and temporal continuity otherwise.
    </p>

    <div className="calibration-controls">
      <label>
        <span>Motion lookback</span>

        <input
          type="number"
          min="0.01"
          step="0.01"
          value={
            orientationSettings
              .motionLookbackSeconds
          }
          onChange={(event) =>
            setOrientationSettings({
              ...orientationSettings,
              motionLookbackSeconds:
                Number(event.target.value),
            })
          }
        />

        <span>s</span>
      </label>

      <label>
        <span>Minimum directional speed</span>

        <input
          type="number"
          min="0"
          step="1"
          value={
            orientationSettings
              .minimumDirectionalSpeedPixelsPerSecond
          }
          onChange={(event) =>
            setOrientationSettings({
              ...orientationSettings,
              minimumDirectionalSpeedPixelsPerSecond:
                Number(event.target.value),
            })
          }
        />

        <span>px/s</span>
      </label>

      <label>
        <span>Maximum continuity gap</span>

        <input
          type="number"
          min="0"
          step="0.05"
          value={
            orientationSettings
              .maximumContinuityGapSeconds
          }
          onChange={(event) =>
            setOrientationSettings({
              ...orientationSettings,
              maximumContinuityGapSeconds:
                Number(event.target.value),
            })
          }
        />

        <span>s</span>
      </label>

      <label>
        <span>Minimum shape confidence</span>

        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={
            orientationSettings
              .minimumShapeConfidence
          }
          onChange={(event) =>
            setOrientationSettings({
              ...orientationSettings,
              minimumShapeConfidence:
                Number(event.target.value),
            })
          }
        />
      </label>
    </div>

    <dl className="metadata-grid">
      <div>
        <dt>Detected body points</dt>
        <dd>
          {orientationQc.detectedPoints.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>Resolved orientations</dt>
        <dd>
          {orientationQc.resolvedPoints.toLocaleString()}
          {' · '}
          {(
            orientationQc.resolvedFraction *
            100
          ).toFixed(1)}
          %
        </dd>
      </div>

      <div>
        <dt>Resolved from motion</dt>
        <dd>
          {orientationQc.motionResolvedPoints.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>Resolved from continuity</dt>
        <dd>
          {orientationQc.continuityResolvedPoints.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>Unresolved</dt>
        <dd>
          {orientationQc.unresolvedPoints.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>Median orientation confidence</dt>
        <dd>
          {orientationQc.medianConfidence !== null
            ? orientationQc.medianConfidence.toFixed(2)
            : 'Unavailable'}
        </dd>
      </div>
    </dl>
  </section>
)}
{orientedTrack &&
 result?.representativeFrames.length > 0 && (
  <OrientationPreview
    frames={result.representativeFrames}
    track={orientedTrack}
  />
)}
{holeInvestigationResult && (
  <section
    className="card"
    aria-labelledby="hole-investigation-heading"
  >
    <h2 id="hole-investigation-heading">
      Hole investigation detection
    </h2>

    <p>
  A hole investigation begins only when the estimated
  nose enters the inner trigger radius and the head is
  sufficiently aligned toward that hole. Once triggered,
  the investigation may continue within the larger sustain
  radius. Minimum dwell and interruption settings determine
  whether the evidence becomes one accepted event.
</p>

    <div className="calibration-controls">
      <label>
  <span>Entry margin</span>

  <input
    type="number"
    min="0"
    step="1"
    value={
      holeInvestigationSettings
        .entryMarginPixels
    }
    onChange={(event) => {
      const value =
        Number(event.target.value);

      setHoleInvestigationSettings({
        ...holeInvestigationSettings,

        entryMarginPixels:
          value,

        /*
         * Outer margin can never be smaller
         * than the inner margin.
         */
        sustainMarginPixels:
          Math.max(
            holeInvestigationSettings
              .sustainMarginPixels,
            value,
          ),
      });
    }}
  />

  <span>
    px — must enter to start event
  </span>
</label>

<label>
  <span>Sustain margin</span>

  <input
    type="number"
    min={
      holeInvestigationSettings
        .entryMarginPixels
    }
    step="1"
    value={
      holeInvestigationSettings
        .sustainMarginPixels
    }
    onChange={(event) => {
      const value =
        Number(event.target.value);

      setHoleInvestigationSettings({
        ...holeInvestigationSettings,

        sustainMarginPixels:
          Math.max(
            value,
            holeInvestigationSettings
              .entryMarginPixels,
          ),
      });
    }}
  />

  <span>
    px — may remain here after trigger
  </span>
</label>

      <label>
        <span>Minimum dwell</span>

        <input
          type="number"
          min="0"
          step="0.05"
          value={
            holeInvestigationSettings
              .minimumDwellSeconds
          }
          onChange={(event) =>
            setHoleInvestigationSettings({
              ...holeInvestigationSettings,
              minimumDwellSeconds:
                Number(event.target.value),
            })
          }
        />

        <span>s</span>
      </label>

      <label>
        <span>Maximum interruption</span>

        <input
          type="number"
          min="0"
          step="0.05"
          value={
            holeInvestigationSettings
              .maximumInterruptionSeconds
          }
          onChange={(event) =>
            setHoleInvestigationSettings({
              ...holeInvestigationSettings,
              maximumInterruptionSeconds:
                Number(event.target.value),
            })
          }
        />

        <span>s</span>
      </label>
      <label>
  <span>Minimum head-hole alignment</span>

  <input
    type="number"
    min="0"
    max="1"
    step="0.05"
    value={
      holeInvestigationSettings
        .minimumHeadHoleAlignment
    }
    onChange={(event) =>
      setHoleInvestigationSettings({
        ...holeInvestigationSettings,
        minimumHeadHoleAlignment:
          Number(event.target.value),
      })
    }
  />

  <span>
    0 = perpendicular · 1 = directly facing hole
  </span>
</label>
    </div>

    <dl className="metadata-grid">
      <div>
        <dt>Investigation events</dt>
        <dd>
          {
            holeInvestigationResult
              .events.length
          }
        </dd>
      </div>

      <div>
        <dt>Target-hole investigations</dt>
        <dd>
          {
            holeInvestigationResult
              .events.filter(
                (event) =>
                  event.isTarget,
              ).length
          }
        </dd>
      </div>

      <div>
        <dt>Non-target investigations</dt>
        <dd>
          {
            holeInvestigationResult
              .events.filter(
                (event) =>
                  !event.isTarget,
              ).length
          }
        </dd>
      </div>

      <div>
        <dt>Positive nose observations</dt>
        <dd>
          {
            holeInvestigationResult
              .qc
              .positiveEvidenceObservations
              .toLocaleString()
          }
        </dd>
      </div>
          <div>
  <dt>Nose within effective ROI</dt>
  <dd>
    {
      holeInvestigationResult
        .qc
        .proximityPositiveObservations
        .toLocaleString()
    }
  </dd>
</div>

<div>
  <dt>Rejected by head alignment</dt>
  <dd>
    {
      holeInvestigationResult
        .qc
        .alignmentRejectedObservations
        .toLocaleString()
    }
  </dd>
</div>
<div>
  <dt>Entry-eligible observations</dt>
  <dd>
    {
      holeInvestigationResult
        .qc
        .entryTriggerObservations
        .toLocaleString()
    }
  </dd>
</div>
      <div>
        <dt>Unknown nose observations</dt>
        <dd>
          {
            holeInvestigationResult
              .qc
              .unknownNoseObservations
              .toLocaleString()
          }
        </dd>
      </div>

      <div>
        <dt>Rejected short candidates</dt>
        <dd>
          {
            holeInvestigationResult
              .qc
              .rejectedShortEventCount
          }
        </dd>
      </div>

      <div>
        <dt>Duplicate PTS collapsed</dt>
        <dd>
          {
            holeInvestigationResult
              .qc
              .duplicatePtsCollapsed
              .toLocaleString()
          }
        </dd>
      </div>
    </dl>
    {holeInvestigationResult.events.length > 0 && (
  <>
    <h3>Detected investigations</h3>

    <div
      className="table-scroll"
      tabIndex={0}
      aria-label="Detected hole investigations"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Hole</th>
            <th scope="col">Target</th>
            <th scope="col">Start</th>
            <th scope="col">End</th>
            <th scope="col">Duration</th>
            <th scope="col">Observations</th>
            <th scope="col">
              Closest nose distance
            </th>
          </tr>
        </thead>

        <tbody>
          {holeInvestigationResult.events.slice(0,500).map(
            (event) => (
              <tr key={event.eventIndex}>
                <td>
                  {event.eventIndex + 1}
                </td>

                <td>
                  Hole {event.holeIndex}
                </td>

                <td>
                  {event.isTarget
                    ? 'Yes'
                    : 'No'}
                </td>

                <td>
                  {event.startTimeSeconds.toFixed(3)} s
                </td>

                <td>
                  {event.endTimeSeconds.toFixed(3)} s
                </td>

                <td>
                  {event.durationSeconds.toFixed(3)} s
                </td>

                <td>
                  {
                    event
                      .positiveObservationCount
                  }
                </td>

                <td>
                  {
                    event
                      .minimumNoseDistancePixels
                      .toFixed(1)
                  } px
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {holeInvestigationResult.events.length > 500 && (
  <p>
    Showing the first 500 of{' '}
    {holeInvestigationResult.events.length.toLocaleString()}
    {' '}detected events.
  </p>
)}
    </div>
  </>
)}
{holeInvestigationResult &&
 holeGeometry &&
 result?.background && (
  <HoleInvestigationPreview
    background={result.background}
    geometry={holeGeometry}
    result={holeInvestigationResult}
    settings={holeInvestigationSettings}
  />
)}
{selectedFile &&
 result &&
 bodyTrack &&
 orientedTrack &&
 holeGeometry &&
 holeInvestigationResult &&
 trialWindow && automaticTrialWindow && (
  <HoleEventReviewer
    file={selectedFile}
    frames={result.frames}
    track={orientedTrack}
    geometry={holeGeometry}
    result={holeInvestigationResult}
    settings={holeInvestigationSettings}
    decisions={
      holeEventReviewDecisions
    }
    onDecisionsChange={
      setHoleEventReviewDecisions
    }
    manualAdditions={
  manualHoleEventAdditions
}

onManualAdditionsChange={
  setManualHoleEventAdditions
}

trialWindow={
  trialWindow
}
automaticTrialWindow={
  automaticTrialWindow
}

trialStartOverride={
  trialStartOverride
}

onTrialStartOverrideChange={
  setTrialStartOverride
}

automaticTrack={
  bodyTrack
}

manualTrackPointCorrections={
  manualTrackPointCorrections
}

onManualTrackPointCorrectionsChange={
  setManualTrackPointCorrections
}
/>
)}
{holeInvestigationResult && (
  <section
    className="card"
    aria-labelledby="final-reviewed-events-heading"
  >
    <h3
      id="final-reviewed-events-heading"
    >
      Final reviewed investigation set
    </h3>

    <p>
      Manual rejections are excluded from
      the final analysis set. Manually
      confirmed events and unreviewed
      automatic detections remain included.
      Automatic detector output is preserved
      unchanged for provenance.
    </p>

    <dl className="metadata-grid">
      <div>
        <dt>
          Automatic detections
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .automaticCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Manually confirmed
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .confirmedCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Manually rejected
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .rejectedCount
          }
        </dd>
      </div>
      <div>
        <dt>
          Manually edited
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .editedCount
          }
        </dd>
      </div>
      <div>
  <dt>
    Manually added
  </dt>

  <dd>
    {
      finalReviewedEventSummary
        .manualAddedCount
    }
  </dd>
</div>
      <div>
        <dt>
          Unreviewed automatic
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .unreviewedCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Final included events
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .finalIncludedCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Final target-hole investigations
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .targetCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Final non-target investigations
        </dt>

        <dd>
          {
            finalReviewedEventSummary
              .nonTargetCount
          }
        </dd>
      </div>
    </dl>

    {finalReviewedEventSummary
      .unreviewedCount > 0 && (
      <p role="status">
        Unreviewed automatic detections
        are currently included in the
        final analysis set.
      </p>
    )}

    <div
      className="table-scroll"
      tabIndex={0}
      aria-label="Final reviewed investigation events"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">
              Final #
            </th>

            <th scope="col">
              Source
            </th>

            <th scope="col">
              Hole
            </th>

            <th scope="col">
              Start
            </th>

            <th scope="col">
              End
            </th>

            <th scope="col">
              Duration
            </th>

            <th scope="col">
              Review status
            </th>

            <th scope="col">
              Provenance
            </th>

            <th scope="col">
              Review note
            </th>
          </tr>
        </thead>

        <tbody>
          {finalReviewedEvents.map(
            (event,index) => (
              <tr
                key={
                  event.finalEventKey
                }
                >
                <td>
                  {index + 1}
                </td>

                <td>
                  {
                    event.automaticEventIndex !==
                    null
                      ? `Automatic #${event.automaticEventIndex + 1}`
                      : `Manual M${
                          manualHoleEventAdditions.find(
                            (addition) =>
                              addition.id ===
                              event.manualEventId,
                          )?.ordinal ?? '?'
                        }`
                  }
                </td>

                <td>
                  {event.holeIndex}
                  {event.isTarget
                    ? ' · target'
                    : ''}
                </td>

                <td>
                  {
                    event
                      .startTimeSeconds
                      .toFixed(3)
                  } s
                </td>

                <td>
                  {
                    event
                      .endTimeSeconds
                      .toFixed(3)
                  } s
                </td>

                <td>
                  {
                    event
                      .durationSeconds
                      .toFixed(3)
                  } s
                </td>

                <td>
                  {
                    event.reviewStatus ===
                    'manual-added'
                    ? 'Manual · added'

                    : event.reviewStatus ===
                      'edited'
                      ? 'Edited'

                      : event.reviewStatus ===
                        'confirmed'
                        ? 'Confirmed'

                        : 'Unreviewed'
                  }
                </td>

                <td>
                {
                event.provenance ===
                  'manual-added'
                  ? 'Manual · added by reviewer'
                  : event.reviewStatus ===
                    'edited'
                    ? 'Automatic · manually edited'
                    : event.reviewStatus ===
                      'confirmed'
                      ? 'Automatic · manually confirmed'
                      : 'Automatic · unreviewed'
              }
            </td>

            <td>
              {
                event.reviewNote ||
                '—'
              }
            </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  </section>
)}
{primaryBehaviorMetrics &&
 trialWindow && (
  <section
    className="card"
    aria-labelledby="primary-behavior-heading"
  >
    <h2
      id="primary-behavior-heading"
    >
      Primary latency and errors
    </h2>

    <p>
      Primary latency is measured from
      detected trial start to the onset of
      the first included target-hole
      investigation. Primary errors are
      included non-target investigation
      events occurring before that target
      investigation.
    </p>

    <dl className="metadata-grid">
      <div>
        <dt>
          Target investigation reached
        </dt>

        <dd>
          {
            primaryBehaviorMetrics
              .targetInvestigationFound
              ? 'Yes'
              : 'No'
          }
        </dd>
      </div>

      <div>
        <dt>
          Primary latency
        </dt>

        <dd>
          {
            primaryBehaviorMetrics
              .primaryLatencySeconds !==
            null
              ? `${primaryBehaviorMetrics.primaryLatencySeconds.toFixed(3)} s`
              : 'Not reached during analyzed trial'
          }
        </dd>
      </div>

      <div>
        <dt>
          Primary errors
        </dt>

        <dd>
          {
            primaryBehaviorMetrics
              .primaryErrorCount !==
            null
              ? primaryBehaviorMetrics
                  .primaryErrorCount
              : 'Not defined'
          }
        </dd>
      </div>

      <div>
        <dt>
          Unique incorrect holes
        </dt>

        <dd>
          {
            primaryBehaviorMetrics
              .uniqueIncorrectHoleCount !==
            null
              ? primaryBehaviorMetrics
                  .uniqueIncorrectHoleCount
              : 'Not defined'
          }
        </dd>
      </div>

      <div>
        <dt>
          Repeated incorrect investigations
        </dt>

        <dd>
          {
            primaryBehaviorMetrics
              .repeatedIncorrectInvestigationCount !==
            null
              ? primaryBehaviorMetrics
                  .repeatedIncorrectInvestigationCount
              : 'Not defined'
          }
        </dd>
      </div>

      <div>
        <dt>
          Non-target investigations observed
        </dt>

        <dd>
          {
            primaryBehaviorMetrics
              .observedNonTargetInvestigationCount
          }
        </dd>
      </div>

      {primaryBehaviorMetrics
        .firstTargetEvent && (
        <>
          <div>
            <dt>
              First target event
            </dt>

            <dd>
            {
              primaryBehaviorMetrics
                .firstTargetEvent
                .automaticEventIndex !==
              null
                ? `Automatic #${
                    primaryBehaviorMetrics
                      .firstTargetEvent
                      .automaticEventIndex + 1
                  }`
                : `Manual M${
                    manualHoleEventAdditions.find(
                      (addition) =>
                        addition.id ===
                        primaryBehaviorMetrics
                          .firstTargetEvent
                          ?.manualEventId,
                    )?.ordinal ?? '?'
                  }`
            }
          </dd>
          </div>

          <div>
            <dt>
              First target onset
            </dt>

            <dd>
              {
                primaryBehaviorMetrics
                  .firstTargetEvent
                  .startTimeSeconds
                  .toFixed(3)
              } s source time
            </dd>
          </div>

          <div>
            <dt>
              Target-event review status
            </dt>

            <dd>
              {
  primaryBehaviorMetrics
    .firstTargetEvent
    .reviewStatus ===
  'manual-added'
    ? 'Manually added'

    : primaryBehaviorMetrics
        .firstTargetEvent
        .reviewStatus ===
      'edited'
      ? 'Manually edited'

      : primaryBehaviorMetrics
          .firstTargetEvent
          .reviewStatus ===
        'confirmed'
        ? 'Manually confirmed'

        : 'Automatic · unreviewed'
}
            </dd>
          </div>
          {primaryBehaviorReviewSummary && (
  <>
    <div>
      <dt>
        Primary-result review status
      </dt>

      <dd>
        {
          primaryBehaviorReviewSummary
            .status ===
          'provisional'
            ? 'Provisional'

            : primaryBehaviorReviewSummary
                .status ===
              'reviewed-with-edits'
              ? 'Reviewed · includes manual edits'

              : 'Reviewed'
        }
      </dd>
    </div>

    <div>
      <dt>
        Contributing manual edits
      </dt>

      <dd>
        {
          primaryBehaviorReviewSummary
            .editedCount
        }
      </dd>
    </div>
  </>
)}
        </>
      )}
    </dl>

    {primaryBehaviorReviewSummary &&
 primaryBehaviorReviewSummary
   .unreviewedCount > 0 && (
  <p role="status">
    Primary latency and error results are
    provisional because{' '}
    {
      primaryBehaviorReviewSummary
        .unreviewedCount
    } contributing investigation
    event(s) remain unreviewed.
  </p>
)}

      {primaryBehaviorMetrics
  .primaryErrorEvents.length > 0 && (
  <>
    <h3>
      Primary-error events
    </h3>

    <div
      className="table-scroll"
      tabIndex={0}
      aria-label="Primary error events"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">
              Error #
            </th>

            <th scope="col">
              Automatic event
            </th>

            <th scope="col">
              Hole
            </th>

            <th scope="col">
              Time from trial start
            </th>

            <th scope="col">
              Duration
            </th>

            <th scope="col">
              Review
            </th>
          </tr>
        </thead>

        <tbody>
          {primaryBehaviorMetrics
            .primaryErrorEvents
            .map(
              (event,index) => {
                const trialStartSeconds =
                  trialWindow
                    .startPts.ticks /
                  trialWindow
                    .startPts.timescale;

                return (
                  <tr
                      key={
                        event.finalEventKey
                      }
                    >
                    <td>
                      {index + 1}
                    </td>

                    <td>
                      {
                        event.automaticEventIndex !==
                        null
                          ? `Automatic #${
                              event.automaticEventIndex +
                              1
                            }`
                          : 'Manual addition'
                      }
                    </td>

                    <td>
                      {event.holeIndex}
                    </td>

                    <td>
                      {Math.max(
                        0,
                        event
                          .startTimeSeconds -
                        trialStartSeconds,
                      ).toFixed(3)}
                      {' s'}
                    </td>

                    <td>
                      {
                        event
                          .durationSeconds
                          .toFixed(3)
                      }
                      {' s'}
                    </td>

                    <td>
  {
  event.reviewStatus ===
    'manual-added'
    ? 'Manual · added'

    : event.reviewStatus ===
      'edited'
      ? 'Edited'

      : event.reviewStatus ===
        'confirmed'
        ? 'Confirmed'

        : 'Unreviewed'
}
                    </td>
                  </tr>
                );
              },
            )}
        </tbody>
      </table>
    </div>
  </>
)}
    {!primaryBehaviorMetrics
      .targetInvestigationFound && (
      <p role="status">
        No included target-hole
        investigation was detected. Primary
        latency and primary errors are
        treated as censored rather than
        assigning the end of the recording
        as the target time.
      </p>
    )}
  </section>
)}
{primaryBehaviorMetrics && (
  <section
    className="card"
    aria-labelledby="escape-analysis-heading"
  >
    <h2 id="escape-analysis-heading">
      Escape candidate and total performance
    </h2>

    <p>
      Escape is not inferred solely from
      target-hole investigation. The software
      identifies terminal behavior consistent
      with escape and requires manual review
      before total latency or total errors are
      reported.
    </p>

    <div className="calibration-controls">
      <label>
        <span>
          Minimum terminal absence
        </span>

        <input
          type="number"
          min="0"
          step="0.05"
          value={
            escapeDetectionSettings
              .minimumTerminalAbsenceSeconds
          }
          onChange={(event) =>
            setEscapeDetectionSettings({
              ...escapeDetectionSettings,

              minimumTerminalAbsenceSeconds:
                Number(
                  event.target.value,
                ),
            })
          }
        />

        <span>s</span>
      </label>
      <label>
  <span>
    Escape lookback
  </span>

  <input
    type="number"
    min="0"
    step="0.1"
    value={
      escapeDetectionSettings
        .escapeLookbackSeconds
    }
    onChange={(event) =>
      setEscapeDetectionSettings({
        ...escapeDetectionSettings,

        escapeLookbackSeconds:
          Number(
            event.target.value,
          ),
      })
    }
  />

  <span>s</span>
</label>

<label>
  <span>
    Escape proximity margin
  </span>

  <input
    type="number"
    min="0"
    step="1"
    value={
      escapeDetectionSettings
        .escapeProximityMarginPixels
    }
    onChange={(event) =>
      setEscapeDetectionSettings({
        ...escapeDetectionSettings,

        escapeProximityMarginPixels:
          Number(
            event.target.value,
          ),
      })
    }
  />

  <span>px</span>
</label>
<label>
  <span>
    Maximum terminal body fraction
  </span>

  <input
    type="number"
    min="0"
    max="1"
    step="0.05"
    value={
      escapeDetectionSettings
        .maximumTerminalBodyAreaFraction
    }
    onChange={(event) =>
      setEscapeDetectionSettings({
        ...escapeDetectionSettings,

        maximumTerminalBodyAreaFraction:
          Number(
            event.target.value,
          ),
      })
    }
  />
</label>

<label>
  <span>
    Minimum terminal collapse
  </span>

  <input
    type="number"
    min="0"
    step="0.05"
    value={
      escapeDetectionSettings
        .minimumTerminalCollapseSeconds
    }
    onChange={(event) =>
      setEscapeDetectionSettings({
        ...escapeDetectionSettings,

        minimumTerminalCollapseSeconds:
          Number(
            event.target.value,
          ),
      })
    }
  />

  <span>s</span>
</label>
      <label>
        <span>
          Maximum target-to-disappearance gap
        </span>

        <input
          type="number"
          min="0"
          step="0.1"
          value={
            escapeDetectionSettings
              .maximumSecondsFromTargetEndToDisappearance
          }
          onChange={(event) =>
            setEscapeDetectionSettings({
              ...escapeDetectionSettings,

              maximumSecondsFromTargetEndToDisappearance:
                Number(
                  event.target.value,
                ),
            })
          }
        />

        <span>s</span>
      </label>

      <label>
        <span>
          Maximum target-to-recording-end gap
        </span>

        <input
          type="number"
          min="0"
          step="0.1"
          value={
            escapeDetectionSettings
              .maximumSecondsFromTargetEndToRecordingEnd
          }
          onChange={(event) =>
            setEscapeDetectionSettings({
              ...escapeDetectionSettings,

              maximumSecondsFromTargetEndToRecordingEnd:
                Number(
                  event.target.value,
                ),
            })
          }
        />

        <span>s</span>
      </label>
    </div>

    {!escapeCandidate && (
      <p role="status">
        No automatic escape candidate was
        identified. Total latency and total
        errors are unavailable.
      </p>
    )}

    {escapeCandidate && (
      <>
        <dl className="metadata-grid">
          <div>
            <dt>
              Escape candidate
            </dt>

            <dd>
              Yes
            </dd>
          </div>

          <div>
  <dt>
    Evidence strength
  </dt>

  <dd>
    {
      escapeCandidate
        .evidenceStrength
    }
  </dd>
</div>

<div>
  <dt>
    Evidence
  </dt>

  <dd>
   {
  escapeCandidate.kind ===
    'terminal-disappearance-at-target'
    ? 'Terminal disappearance spatially associated with target'

    : escapeCandidate.kind ===
      'terminal-body-collapse-at-target'
      ? 'Terminal partial-body collapse at target'

    : escapeCandidate.kind ===
      'target-associated-terminal-disappearance'
      ? 'Terminal disappearance shortly after target investigation'

    : 'Target investigation near recording end'
}
  </dd>
</div>

          <div>
            <dt>
              Associated target event
            </dt>

            <dd>
               {
  escapeAssociatedTargetEvent
    ? (
        escapeAssociatedTargetEvent
          .automaticEventIndex !==
        null
          ? (
              `Automatic #${
                escapeAssociatedTargetEvent
                  .automaticEventIndex +
                1
              }`
            )
          : 'Manual addition'
      )
    : 'None required'
}
            </dd>
          </div>

          <div>
            <dt>
              Candidate escape time
            </dt>

            <dd>
              {
                escapeCandidate
                  .escapeTimeSeconds
                  .toFixed(3)
              } s
            </dd>
          </div>

          <div>
            <dt>
              Recording end
            </dt>

            <dd>
              {
                escapeCandidate
                  .recordingEndTimeSeconds
                  .toFixed(3)
              } s
            </dd>
          </div>

          <div>
            <dt>
              Terminal absence
            </dt>

            <dd>
              {
                escapeCandidate
                  .terminalAbsenceSeconds
                  .toFixed(3)
              } s
            </dd>
          </div>
          <div>
  <dt>
    Escape proximity radius
  </dt>

  <dd>
    {
      escapeCandidate
        .escapeRadiusPixels
        .toFixed(1)
    } px
  </dd>
</div>

<div>
  <dt>
    Closest nose to target
  </dt>

  <dd>
    {
      escapeCandidate
        .minimumNoseDistanceToTargetPixels !==
      null
        ? `${escapeCandidate.minimumNoseDistanceToTargetPixels.toFixed(1)} px`
        : 'Unavailable'
    }
  </dd>
</div>

<div>
  <dt>
    Closest body to target
  </dt>

  <dd>
    {
      escapeCandidate
        .minimumBodyDistanceToTargetPixels !==
      null
        ? `${escapeCandidate.minimumBodyDistanceToTargetPixels.toFixed(1)} px`
        : 'Unavailable'
    }
  </dd>
</div>

<div>
  <dt>
    Last detected time
  </dt>

  <dd>
    {
      escapeCandidate
        .lastDetectedTimeSeconds !==
      null
        ? `${escapeCandidate.lastDetectedTimeSeconds.toFixed(3)} s`
        : 'Unavailable'
    }
  </dd>
</div>

<div>
  <dt>
    First missing time
  </dt>

  <dd>
    {
      escapeCandidate
        .firstMissingTimeSeconds !==
      null
        ? `${escapeCandidate.firstMissingTimeSeconds.toFixed(3)} s`
        : 'Unavailable'
    }
  </dd>
</div>
<div>
  <dt>
    Baseline body area
  </dt>

  <dd>
    {
      escapeCandidate
        .baselineBodyAreaPixels !==
      null
        ? `${escapeCandidate.baselineBodyAreaPixels.toFixed(1)} px²`
        : 'Unavailable'
    }
  </dd>
</div>

<div>
  <dt>
    Terminal body area
  </dt>

  <dd>
    {
      escapeCandidate
        .terminalBodyAreaPixels !==
      null
        ? `${escapeCandidate.terminalBodyAreaPixels.toFixed(1)} px²`
        : 'Unavailable'
    }
  </dd>
</div>

<div>
  <dt>
    Terminal body fraction
  </dt>

  <dd>
    {
      escapeCandidate
        .terminalBodyAreaFraction !==
      null
        ? (
            escapeCandidate
              .terminalBodyAreaFraction *
            100
          ).toFixed(1) + '%'
        : 'Unavailable'
    }
  </dd>
</div>

<div>
  <dt>
    Terminal collapse duration
  </dt>

  <dd>
    {
      `${escapeCandidate.terminalCollapseSeconds.toFixed(3)} s`
    }
  </dd>
</div>
          <div>
            <dt>
              Escape review
            </dt>

            <dd>
              {
                activeEscapeReview
                  ?.status ??
                'unreviewed'
              }
            </dd>
          </div>
        </dl>

        {escapeCandidate
  .evidenceStrength ===
  'strong' && (
  <p role="status">
    Strong automatic evidence:
    sustained terminal disappearance
    occurred after reliable body or nose
    positions entered the escape-proximity
    region around the known target hole.
    Manual confirmation is still required.
  </p>
)}

{escapeCandidate
  .evidenceStrength ===
  'moderate' && (
  <p role="status">
    Moderate automatic evidence:
    terminal behavior was associated
    with the known target hole, either
    through sustained partial-body
    occlusion or disappearance following
    a target investigation. Manual review
    is required before this candidate is
    treated as escape.
  </p>
)}

{escapeCandidate
  .evidenceStrength ===
  'weak' && (
  <p role="status">
    Weak automatic evidence:
    the final target-hole investigation
    occurred immediately before recording
    termination. Post-entry footage is
    insufficient to demonstrate sustained
    disappearance, so manual confirmation
    is required.
  </p>
)}
{selectedFile &&
 result &&
 orientedTrack &&
 holeGeometry && (
  <EscapeReviewVisualizer
    file={
      selectedFile
    }

    frames={
      result.frames
    }

    track={
      orientedTrack
    }

    geometry={
      holeGeometry
    }

    candidate={
      escapeCandidate
    }

    associatedTargetEvent={
      escapeAssociatedTargetEvent
    }
  />
)}
        <fieldset>
          <legend>
            Manual escape decision
          </legend>

          <div className="actions">
            <button
              type="button"
              aria-pressed={
                activeEscapeReview
                  ?.status ===
                'confirmed'
              }
              onClick={() =>
                setEscapeReviewStatus(
                  'confirmed',
                )
              }
            >
              Confirm escape
            </button>

            <button
              type="button"
              aria-pressed={
                activeEscapeReview
                  ?.status ===
                'rejected'
              }
              onClick={() =>
                setEscapeReviewStatus(
                  'rejected',
                )
              }
            >
              Reject escape
            </button>

            <button
              type="button"
              aria-pressed={
                activeEscapeReview
                  ?.status ===
                'ambiguous'
              }
              onClick={() =>
                setEscapeReviewStatus(
                  'ambiguous',
                )
              }
            >
              Mark ambiguous
            </button>

            <button
              type="button"
              onClick={() =>
                setEscapeReviewStatus(
                  'unreviewed',
                )
              }
            >
              Reset
            </button>
          </div>

          <label
            style={{
              display: 'grid',
              gap: '0.4rem',
              marginTop: '0.75rem',
            }}
          >
            <span>
              Escape review note
            </span>

            <textarea
              rows={3}
              value={
                activeEscapeReview
                  ?.note ?? ''
              }
              onChange={(event) => {
                if (
                  !escapeCandidate
                ) {
                  return;
                }

                setEscapeReviewDecision({
                  candidateKey:
                    escapeCandidate
                      .candidateKey,

                  status:
                    activeEscapeReview
                      ?.status ??
                    'unreviewed',

                  note:
                    event.target.value,

                  reviewedAtIso:
                    activeEscapeReview
                      ?.reviewedAtIso ??
                    null,
                });
              }}
            />
          </label>
        </fieldset>
      </>
    )}

    {escapeBehaviorMetrics
      ?.escapeConfirmed && (
      <>
        <h3>
          Total performance
        </h3>

        <dl className="metadata-grid">
          <div>
            <dt>
              Total latency
            </dt>

            <dd>
              {
                escapeBehaviorMetrics
                  .totalLatencySeconds
                  ?.toFixed(3)
              } s
            </dd>
          </div>

          <div>
            <dt>
              Total errors
            </dt>

            <dd>
              {
                escapeBehaviorMetrics
                  .totalErrorCount
              }
            </dd>
          </div>

          <div>
            <dt>
              Unique incorrect holes
            </dt>

            <dd>
              {
                escapeBehaviorMetrics
                  .uniqueTotalIncorrectHoleCount
              }
            </dd>
          </div>

          <div>
            <dt>
              Repeated incorrect investigations
            </dt>

            <dd>
              {
                escapeBehaviorMetrics
                  .repeatedTotalIncorrectInvestigationCount
              }
            </dd>
          </div>

          <div>
            <dt>
              Target investigations before escape
            </dt>

            <dd>
              {
                escapeBehaviorMetrics
                  .targetInvestigationsBeforeEscape
              }
            </dd>
          </div>

          <div>
            <dt>
              Target revisits before escape
            </dt>

            <dd>
              {
                escapeBehaviorMetrics
                  .targetRevisitsBeforeEscape
              }
            </dd>
          </div>
        </dl>
      </>
    )}
  </section>
)}
{targetQuadrantMetrics && (
  <section
    className="card"
    aria-labelledby="target-quadrant-heading"
  >
    <h2 id="target-quadrant-heading">
      Target quadrant
    </h2>

    <p>
      The target quadrant is the 90-degree
      sector centered on the radial direction
      from the arena center to the reviewed
      target hole. Time is integrated from
      exact trajectory timestamps rather than
      estimated from frame counts.
    </p>

    <dl className="metadata-grid">
      <div>
        <dt>Target hole</dt>
        <dd>
          {
            targetQuadrantMetrics
              .targetHoleIndex
          }
        </dd>
      </div>

      <div>
        <dt>Quadrant width</dt>
        <dd>90°</dd>
      </div>

      <div>
        <dt>
          Analyzed target-quadrant time
        </dt>

        <dd>
          {
            targetQuadrantMetrics
              .analyzedTrial
              .targetQuadrantTimeSeconds
              .toFixed(3)
          } s
        </dd>
      </div>

      <div>
        <dt>
          Analyzed target-quadrant occupancy
        </dt>

        <dd>
          {
            targetQuadrantMetrics
              .analyzedTrial
              .targetQuadrantTimeFraction !==
            null
              ? `${(
                  targetQuadrantMetrics
                    .analyzedTrial
                    .targetQuadrantTimeFraction *
                  100
                ).toFixed(1)}%`
              : 'Unavailable'
          }
        </dd>
      </div>

      <div>
        <dt>
          Target-quadrant path fraction
        </dt>

        <dd>
          {
            targetQuadrantMetrics
              .analyzedTrial
              .targetQuadrantPathFraction !==
            null
              ? `${(
                  targetQuadrantMetrics
                    .analyzedTrial
                    .targetQuadrantPathFraction *
                  100
                ).toFixed(1)}%`
              : 'Unavailable'
          }
        </dd>
      </div>

      <div>
        <dt>
          Target-quadrant entries
        </dt>

        <dd>
          {
            targetQuadrantMetrics
              .analyzedTrial
              .targetQuadrantEntryCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Trajectory time coverage
        </dt>

        <dd>
          {
            targetQuadrantMetrics
              .analyzedTrial
              .observedCoverageFraction !==
            null
              ? `${(
                  targetQuadrantMetrics
                    .analyzedTrial
                    .observedCoverageFraction *
                  100
                ).toFixed(1)}%`
              : 'Unavailable'
          }
        </dd>
      </div>
    </dl>

    {targetQuadrantMetrics
      .preTarget && (
      <>
        <h3>
          Before first target investigation
        </h3>

        <dl className="metadata-grid">
          <div>
            <dt>
              Target-quadrant time
            </dt>

            <dd>
              {
                targetQuadrantMetrics
                  .preTarget
                  .targetQuadrantTimeSeconds
                  .toFixed(3)
              } s
            </dd>
          </div>

          <div>
            <dt>
              Target-quadrant occupancy
            </dt>

            <dd>
              {
                targetQuadrantMetrics
                  .preTarget
                  .targetQuadrantTimeFraction !==
                null
                  ? `${(
                      targetQuadrantMetrics
                        .preTarget
                        .targetQuadrantTimeFraction *
                      100
                    ).toFixed(1)}%`
                  : 'Unavailable'
              }
            </dd>
          </div>

          <div>
            <dt>
              Target-quadrant path fraction
            </dt>

            <dd>
              {
                targetQuadrantMetrics
                  .preTarget
                  .targetQuadrantPathFraction !==
                null
                  ? `${(
                      targetQuadrantMetrics
                        .preTarget
                        .targetQuadrantPathFraction *
                      100
                    ).toFixed(1)}%`
                  : 'Unavailable'
              }
            </dd>
          </div>

          <div>
            <dt>
              Target-quadrant entries
            </dt>

            <dd>
              {
                targetQuadrantMetrics
                  .preTarget
                  .targetQuadrantEntryCount
              }
            </dd>
          </div>
        </dl>
      </>
    )}
  </section>
)}
{searchStrategyResult && (
  <section
    className="card"
    aria-labelledby="search-strategy-heading"
  >
    <h2 id="search-strategy-heading">
      Search strategy
    </h2>

    <p>
      Automatic strategy classification is
      heuristic and is intended as an
      interpretable prototype. It uses search
      behavior before the first target-hole
      investigation. A scientist may override
      the automatic classification without
      altering the underlying measurements.
    </p>

    <dl className="metadata-grid">
      <div>
        <dt>
          Automatic strategy
        </dt>

        <dd>
          {
            searchStrategyResult
              .automaticStrategy
          }
        </dd>
      </div>

      <div>
        <dt>
          Automatic confidence
        </dt>

        <dd>
          {
            searchStrategyResult
              .confidence
          }
        </dd>
      </div>

      <div>
        <dt>
          Final strategy
        </dt>

        <dd>
          {
            finalSearchStrategy
          }
          {
            searchStrategyOverride
              ? ' · manual override'
              : ' · automatic'
          }
        </dd>
      </div>
      <div>
  <dt>
    Search path length
  </dt>

  <dd>
    {
      searchStrategyResult
        .searchPathLengthPixels
        .toFixed(1)
    } px
  </dd>
</div>

<div>
  <dt>
    Straight-line displacement
  </dt>

  <dd>
    {
      searchStrategyResult
        .straightLineDisplacementPixels
        .toFixed(1)
    } px
  </dd>
</div>
      <div>
        <dt>
          Path efficiency
        </dt>

        <dd>
          {
            searchStrategyResult
              .pathEfficiency !==
            null
              ? searchStrategyResult
                  .pathEfficiency
                  .toFixed(3)
              : 'Unavailable'
          }
        </dd>
      </div>

      <div>
        <dt>
          Primary errors
        </dt>

        <dd>
          {
            searchStrategyResult
              .primaryErrorCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Unique incorrect holes
        </dt>

        <dd>
          {
            searchStrategyResult
              .uniqueIncorrectHoleCount
          }
        </dd>
      </div>
      <div>
        <dt>
          Repeated primary errors
        </dt>

        <dd>
          {
            searchStrategyResult
              .repeatedPrimaryErrorCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Farthest incorrect hole
        </dt>

        <dd>
          {
            searchStrategyResult
              .maximumIncorrectHoleDistanceFromTarget !==
            null
              ? `${searchStrategyResult.maximumIncorrectHoleDistanceFromTarget} hole-step(s) from target`
              : 'No incorrect holes'
          }
        </dd>
      </div>
      <div>
        <dt>
          Hole transitions
        </dt>

        <dd>
          {
            searchStrategyResult
              .holeTransitionCount
          }
        </dd>
      </div>

      <div>
        <dt>
          Adjacent-hole transitions
        </dt>

        <dd>
          {
            searchStrategyResult
              .adjacentTransitionFraction !==
            null
              ? `${(
                  searchStrategyResult
                    .adjacentTransitionFraction *
                  100
                ).toFixed(1)}%`
              : 'Unavailable'
          }
        </dd>
      </div>

      <div>
        <dt>
          Directional consistency
        </dt>

        <dd>
          {
            searchStrategyResult
              .directionalConsistency !==
            null
              ? `${(
                  searchStrategyResult
                    .directionalConsistency *
                  100
                ).toFixed(1)}%`
              : 'Unavailable'
          }
        </dd>
      </div>
      
      <div>
  <dt>
    Direction reversals
  </dt>

  <dd>
    {
      searchStrategyResult
        .directionReversalCount
    }
    {' / '}
    {
      searchStrategyResult
        .directionReversalOpportunityCount
    }
  </dd>
</div>

<div>
  <dt>
    Direction-reversal fraction
  </dt>

  <dd>
    {
      searchStrategyResult
        .directionReversalFraction !==
      null
        ? `${(
            searchStrategyResult
              .directionReversalFraction *
            100
          ).toFixed(1)}%`
        : 'Unavailable'
    }
  </dd>
</div>

      <div>
        <dt>
          Peripheral search time
        </dt>

        <dd>
          {
            searchStrategyResult
              .perimeterTimeFraction !==
            null
              ? `${(
                  searchStrategyResult
                    .perimeterTimeFraction *
                  100
                ).toFixed(1)}%`
              : 'Unavailable'
          }
        </dd>
      </div>

      <div>
        <dt>
          Hole sequence
        </dt>

        <dd>
          {
            searchStrategyResult
              .investigatedHoleSequence
              .join(' → ') ||
            'No investigation sequence'
          }
        </dd>
      </div>
    </dl>
      {searchStrategyResult
  .pathEfficiency ===
  null && (
  <p role="status">
    Path efficiency is unavailable because
    the observed search trajectory does not
    contain one continuous measurable path
    between search start and the analysis
    endpoint.
  </p>
)}
    <h3>
      Automatic reasoning
    </h3>

    <ul>
      {
        searchStrategyResult
          .reasoning
          .map(
            (reason,index) => (
              <li key={index}>
                {reason}
              </li>
            ),
          )
      }
    </ul>

    {searchStrategyResult
      .unreviewedInvestigationCount >
      0 && (
      <p role="status">
        {
          searchStrategyResult
            .unreviewedInvestigationCount
        } investigation event(s) used by
        this strategy classification remain
        unreviewed. Treat the automatic
        classification as provisional.
      </p>
    )}

    <fieldset>
      <legend>
        Manual strategy review
      </legend>

      <label>
        <span>
          Final strategy
        </span>

        <select
          value={
            searchStrategyOverride
              ?.strategy ??
            ''
          }
          onChange={(event) => {
            const value =
              event.target.value;

            if (value === '') {
              setSearchStrategyOverride(
                null,
              );

              return;
            }

            setSearchStrategyOverride({
              strategy:
                value as
                  SearchStrategyOverride[
                    'strategy'
                  ],

              note:
                searchStrategyOverride
                  ?.note ??
                '',

              updatedAtIso:
                new Date()
                  .toISOString(),
            });
          }}
        >
          <option value="">
            Use automatic classification
          </option>

          <option value="direct">
            Direct
          </option>

          <option value="serial">
            Serial
          </option>

          <option value="random">
            Random
          </option>

          <option value="uncertain">
            Uncertain
          </option>
        </select>
      </label>

      <label
        style={{
          display: 'grid',
          gap: '0.4rem',
          marginTop: '0.75rem',
        }}
      >
        <span>
          Strategy review note
        </span>

        <textarea
          rows={3}
          value={
            searchStrategyOverride
              ?.note ??
            ''
          }
          disabled={
            searchStrategyOverride ===
            null
          }
          onChange={(event) => {
            if (
              !searchStrategyOverride
            ) {
              return;
            }

            setSearchStrategyOverride({
              ...searchStrategyOverride,

              note:
                event.target.value,

              updatedAtIso:
                new Date()
                  .toISOString(),
            });
          }}
        />
      </label>
    </fieldset>

    <details
      style={{
        marginTop: '1rem',
      }}
    >
      <summary>
        Automatic strategy thresholds
      </summary>

      <div className="calibration-controls">
        <label>
          <span>
            Direct max errors
          </span>

          <input
            type="number"
            min="0"
            step="1"
            value={
              searchStrategySettings
                .maxDirectPrimaryErrors
            }
            onChange={(event) =>
              setSearchStrategySettings({
                ...searchStrategySettings,

                maxDirectPrimaryErrors:
                  Number(
                    event.target.value,
                  ),
              })
            }
          />
        </label>
        
        <label>
  <span>
    Direct max unique wrong holes
  </span>

  <input
    type="number"
    min="0"
    step="1"
    value={
      searchStrategySettings
        .maxDirectUniqueIncorrectHoles
    }
    onChange={(event) =>
      setSearchStrategySettings({
        ...searchStrategySettings,

        maxDirectUniqueIncorrectHoles:
          Number(
            event.target.value,
          ),
      })
    }
  />
</label>

<label>
  <span>
    Direct max wrong-hole distance
  </span>

  <input
    type="number"
    min="0"
    step="1"
    value={
      searchStrategySettings
        .maxDirectIncorrectHoleDistance
    }
    onChange={(event) =>
      setSearchStrategySettings({
        ...searchStrategySettings,

        maxDirectIncorrectHoleDistance:
          Number(
            event.target.value,
          ),
      })
    }
  />

  <span>hole steps</span>
</label>

        <label>
          <span>
            Direct minimum efficiency
          </span>

          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={
              searchStrategySettings
                .minimumDirectPathEfficiency
            }
            onChange={(event) =>
              setSearchStrategySettings({
                ...searchStrategySettings,

                minimumDirectPathEfficiency:
                  Number(
                    event.target.value,
                  ),
              })
            }
          />
        </label>

        <label>
          <span>
            Serial adjacent fraction
          </span>

          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={
              searchStrategySettings
                .minimumSerialAdjacentTransitionFraction
            }
            onChange={(event) =>
              setSearchStrategySettings({
                ...searchStrategySettings,

                minimumSerialAdjacentTransitionFraction:
                  Number(
                    event.target.value,
                  ),
              })
            }
          />
        </label>

        <label>
          <span>
            Serial direction consistency
          </span>

          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={
              searchStrategySettings
                .minimumSerialDirectionalConsistency
            }
            onChange={(event) =>
              setSearchStrategySettings({
                ...searchStrategySettings,

                minimumSerialDirectionalConsistency:
                  Number(
                    event.target.value,
                  ),
              })
            }
          />
        </label>

        <label>
        <span>
          Serial maximum reversal fraction
        </span>

        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          value={
            searchStrategySettings
              .maximumSerialDirectionReversalFraction
          }
          onChange={(event) =>
            setSearchStrategySettings({
              ...searchStrategySettings,

              maximumSerialDirectionReversalFraction:
                Number(
                  event.target.value,
                ),
            })
          }
        />
      </label>

        <label>
          <span>
            Serial peripheral time
          </span>

          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={
              searchStrategySettings
                .minimumSerialPerimeterTimeFraction
            }
            onChange={(event) =>
              setSearchStrategySettings({
                ...searchStrategySettings,

                minimumSerialPerimeterTimeFraction:
                  Number(
                    event.target.value,
                  ),
              })
            }
          />
        </label>

        <label>
          <span>
            Peripheral radius fraction
          </span>

          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={
              searchStrategySettings
                .perimeterRadiusFraction
            }
            onChange={(event) =>
              setSearchStrategySettings({
                ...searchStrategySettings,

                perimeterRadiusFraction:
                  Number(
                    event.target.value,
                  ),
              })
            }
          />
        </label>

        <label>
          <span>
            Minimum serial transitions
          </span>

          <input
            type="number"
            min="1"
            step="1"
            value={
              searchStrategySettings
                .minimumTransitionsForSerial
            }
            onChange={(event) =>
              setSearchStrategySettings({
                ...searchStrategySettings,

                minimumTransitionsForSerial:
                  Number(
                    event.target.value,
                  ),
              })
            }
          />
        </label>
      </div>
    </details>
  </section>
)}
  </section>
)}
{trackQc && (
  <>
    <div>
      <dt>Visible frames</dt>
      <dd>
        {trackQc.visibleFrames.toLocaleString()}
      </dd>
    </div>

    <div>
      <dt>Partial detections</dt>
      <dd>
        {trackQc.partialFrames.toLocaleString()}
      </dd>
    </div>

    <div>
      <dt>Missing sequences</dt>
      <dd>
        {trackQc.missingRuns.length.toLocaleString()}
      </dd>
    </div>

    <div>
      <dt>Median body area</dt>
      <dd>
        {trackQc.medianDetectedAreaPixels !== null
          ? `${trackQc.medianDetectedAreaPixels.toFixed(0)} px`
          : 'Unavailable'}
      </dd>
    </div>

    <div>
      <dt>Median dominance</dt>
      <dd>
        {trackQc.medianDominance !== null
          ? `${(
              trackQc.medianDominance *
              100
            ).toFixed(1)}%`
          : 'Unavailable'}
      </dd>
    </div>
  </> 
)}
{processedTrajectory && result?.background && (
  <TrajectoryComparisonView
    processedTrajectory={processedTrajectory}
    background={result?.background}
  />
)}
{longestMissingRun && (
  <div>
    <dt>Longest missing sequence</dt>
    <dd>
      {longestMissingRun.frameCount}
      {' frames · '}
      {longestMissingRun.durationSeconds.toFixed(
        3,
      )}
      {' s'}
    </dd>
  </div>
)}
{automaticTrialWindow && (
  <div>
    <dt>
      Automatic trial start
    </dt>

    <dd>
      {(
        automaticTrialWindow
          .startPts.ticks /
        automaticTrialWindow
          .startPts.timescale
      ).toFixed(3)}
      {' s'}
    </dd>
  </div>
)}

{trialWindow && (
  <div>
    <dt>
      Effective trial start
    </dt>

    <dd>
      {(
        trialWindow
          .startPts.ticks /
        trialWindow
          .startPts.timescale
      ).toFixed(3)}
      {' s · '}
      {
        trialStartOverride
          ? 'manual'
          : 'automatic'
      }
    </dd>
  </div>
)}
<div>
  <dt>
    Manual track corrections
  </dt>

  <dd>
    {
      Object.keys(
        manualTrackPointCorrections,
      ).length
    }
  </dd>
</div>
<div>
  <dt>Detection after trial start</dt>
  <dd>
    {trialDetectionRate !== null
      ? `${(trialDetectionRate * 100).toFixed(1)}%`
      : 'Unavailable'}
  </dd>
</div>
{cleanedBodyTrack &&
 result?.background &&
 trialWindow &&
 arenaCalibration && (
  <TrajectoryPreview
    background={
      result.background
    }
    track={
      cleanedBodyTrack
    }
    trialWindow={
      trialWindow
    }
    calibration={
      arenaCalibration
    }
  />
)}
{processedTrajectory && (
  <section className="card">
    <h2>Trajectory QC</h2>

    <div className="calibration-controls">
      <label>
        <span>Median window</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={trajectorySmoothingSettings.medianWindowSeconds}
          onChange={(event) =>
            setTrajectorySmoothingSettings({
              ...trajectorySmoothingSettings,
              medianWindowSeconds: Number(event.target.value),
            })
          }
        />
        <span>s</span>
      </label>

      <label>
        <span>Mean window</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={trajectorySmoothingSettings.meanWindowSeconds}
          onChange={(event) =>
            setTrajectorySmoothingSettings({
              ...trajectorySmoothingSettings,
              meanWindowSeconds: Number(event.target.value),
            })
          }
        />
        <span>s</span>
      </label>

      <label>
        <span>Maximum connected gap</span>
        <input
          type="number"
          min="0"
          step="0.05"
          value={trajectorySmoothingSettings.maxGapSeconds}
          onChange={(event) =>
            setTrajectorySmoothingSettings({
              ...trajectorySmoothingSettings,
              maxGapSeconds: Number(event.target.value),
            })
          }
        />
        <span>s</span>
      </label>
      <label>
  <span>
    Reject isolated jump outliers
  </span>

  <input
    type="checkbox"

    checked={
      trajectoryOutlierSettings
        .enabled
    }

    onChange={(event) =>
      setTrajectoryOutlierSettings({
        ...trajectoryOutlierSettings,

        enabled:
          event.target.checked,
      })
    }
  />
</label>

<label>
  <span>
    Maximum isolated-jump speed
  </span>

  <input
    type="number"
    min="1"
    step="50"

    disabled={
      !trajectoryOutlierSettings
        .enabled
    }

    value={
      trajectoryOutlierSettings
        .maximumJumpSpeedPixelsPerSecond
    }

    onChange={(event) =>
      setTrajectoryOutlierSettings({
        ...trajectoryOutlierSettings,

        maximumJumpSpeedPixelsPerSecond:
          Math.max(
            1,
            Number(
              event.target.value,
            ),
          ),
      })
    }
  />

  <span>px/s</span>
</label>
    </div>

    <dl className="metadata-grid">
      <div>
        <dt>Source observations</dt>
        <dd>{processedTrajectory.qc.sourceObservationCount.toLocaleString()}</dd>
      </div>

      <div>
        <dt>Analysis observations</dt>
        <dd>{processedTrajectory.qc.analysisObservationCount.toLocaleString()}</dd>
      </div>

      <div>
        <dt>Duplicate PTS collapsed</dt>
        <dd>{processedTrajectory.qc.duplicatePtsCollapsed.toLocaleString()}</dd>
      </div>
<div>
  <dt>
    Isolated jump outliers rejected
  </dt>

  <dd>
    {
      trackOutlierAnalysis
        ?.rejectedCount
        .toLocaleString() ??
      '0'
    }
  </dd>
</div>

<div>
  <dt>
    Detected trial positions affected
  </dt>

  <dd>
    {
      trackOutlierAnalysis
        ? (
            `${(
              trackOutlierAnalysis
                .rejectedFraction *
              100
            ).toFixed(3)}%`
          )
        : 'Unavailable'
    }
  </dd>
</div>

<div>
  <dt>
    Outlier speed threshold
  </dt>

  <dd>
    {
      trajectoryOutlierSettings
        .enabled
        ? (
            `${trajectoryOutlierSettings.maximumJumpSpeedPixelsPerSecond.toFixed(0)} px/s`
          )
        : 'Disabled'
    }
  </dd>
</div>
      <div>
        <dt>Trajectory segments</dt>
        <dd>{processedTrajectory.qc.segmentCount}</dd>
      </div>

      <div>
        <dt>Median correction</dt>
        <dd>
          {processedTrajectory.qc.medianSmoothingCorrectionPixels.toFixed(2)} px
        </dd>
      </div>

      <div>
        <dt>95th percentile correction</dt>
        <dd>
          {processedTrajectory.qc.p95SmoothingCorrectionPixels.toFixed(2)} px
        </dd>
      </div>

      <div>
        <dt>Maximum correction</dt>
        <dd>
          {processedTrajectory.qc.maximumSmoothingCorrectionPixels.toFixed(2)} px
        </dd>
      </div>
    </dl>
    {trajectoryOutlierSettings
  .enabled &&
 trackOutlierAnalysis &&
 trackOutlierAnalysis
   .rejectedCount > 0 && (
  <p role="status">
    {
      trackOutlierAnalysis
        .rejectedCount
    } isolated position
    {' '}
    {
      trackOutlierAnalysis
        .rejectedCount === 1
        ? 'outlier was'
        : 'outliers were'
    }
    {' '}
    excluded before orientation and
    trajectory smoothing. Manual track
    corrections are protected from
    automatic outlier rejection.
  </p>
)}
  </section>
)}
{trajectoryMetrics && (
  <section className="card">
    <h2>Path length and speed</h2>

    <p>
      Metrics are calculated from the smoothed analysis trajectory
      using exact presentation timestamps. Display thinning is not
      used for quantitative analysis.
    </p>

    <dl className="metadata-grid">
      <div>
        <dt>Path length</dt>
        <dd>
          {trajectoryMetrics.pathLengthPixels.toFixed(1)} px
          {trajectoryMetrics.pathLengthCm !== null
            ? ` · ${trajectoryMetrics.pathLengthCm.toFixed(2)} cm`
            : ''}
        </dd>
      </div>

      <div>
        <dt>Trial duration</dt>
        <dd>{trajectoryMetrics.trialDurationSeconds.toFixed(3)} s</dd>
      </div>

      <div>
        <dt>Mean speed</dt>
        <dd>
          {trajectoryMetrics.meanSpeedPixelsPerSecond.toFixed(2)} px/s
          {trajectoryMetrics.meanSpeedCmPerSecond !== null
            ? ` · ${trajectoryMetrics.meanSpeedCmPerSecond.toFixed(2)} cm/s`
            : ''}
        </dd>
      </div>

      <div>
        <dt>Connected mean speed</dt>
        <dd>
          {trajectoryMetrics.connectedMeanSpeedPixelsPerSecond.toFixed(2)} px/s
          {trajectoryMetrics.connectedMeanSpeedCmPerSecond !== null
            ? ` · ${trajectoryMetrics.connectedMeanSpeedCmPerSecond.toFixed(2)} cm/s`
            : ''}
        </dd>
      </div>

      <div>
        <dt>Median step speed</dt>
        <dd>
          {trajectoryMetrics.medianStepSpeedPixelsPerSecond.toFixed(2)} px/s
          {trajectoryMetrics.medianStepSpeedCmPerSecond !== null
            ? ` · ${trajectoryMetrics.medianStepSpeedCmPerSecond.toFixed(2)} cm/s`
            : ''}
        </dd>
      </div>

      <div>
        <dt>Analysis observations</dt>
        <dd>{trajectoryMetrics.observationCount.toLocaleString()}</dd>
      </div>

      <div>
        <dt>Connected trajectory steps</dt>
        <dd>{trajectoryMetrics.connectedStepCount.toLocaleString()}</dd>
      </div>
    </dl>

    {arenaCalibration?.platformDiameterCm === null && (
      <p>
        Enter the physical platform diameter in Arena calibration
        to report path length and speed in centimeters.
      </p>
    )}
  </section>
)}
  </section>
)}
          <h3>First decoded timestamps</h3>
          <div className="table-scroll" tabIndex={0} aria-label="First decoded frame timestamps">
            <table>
              <thead>
                <tr>
                  <th scope="col">Presentation frame</th>
                  <th scope="col">PTS ticks</th>
                  <th scope="col">Timescale</th>
                  <th scope="col">PTS seconds</th>
                  <th scope="col">WebCodecs µs</th>
                  <th scope="col">Key frame</th>
                </tr>
              </thead>
              <tbody>
                {result.frames.slice(0, 12).map((frame: FrameTiming) => (
                  <tr key={`${frame.sampleIndex}-${frame.webCodecsTimestampUs}`}>
                    <td>{frame.presentationIndex ?? '—'}</td>
                    <td>{frame.pts.ticks}</td>
                    <td>{frame.pts.timescale}</td>
                    <td>{timeToSeconds(frame.pts).toFixed(9)}</td>
                    <td>{frame.webCodecsTimestampUs}</td>
                    <td>{frame.isKeyFrame ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
{/*
      <div>
        <dt>Expected frames</dt>
        <dd>
          {result.timingValidation.expectedFrameCount}
        </dd>
      </div>

      <div>
        <dt>Decoded frames</dt>
        <dd>
          {result.timingValidation.decodedFrameCount}
        </dd>
      </div>

      <div>
        <dt>Timing records</dt>
        <dd>
          {result.timingValidation.timingRecordCount}
        </dd>
      </div>

      <div>
        <dt>Unique PTS</dt>
        <dd>
          {result.timingValidation.uniquePtsCount}
        </dd>
      </div>

      <div>
        <dt>Duplicate PTS</dt>
        <dd>
          {result.timingValidation.duplicatePtsCount}
        </dd>
      </div>

      <div>
        <dt>Minimum frame interval</dt>
        <dd>
          {result.timingValidation.minimumFrameIntervalTicks !== null
            ? `${result.timingValidation.minimumFrameIntervalTicks} ticks`
            : 'Unavailable'}
        </dd>
      </div>

      <div>
        <dt>Median frame interval</dt>
        <dd>
          {result.timingValidation.medianFrameIntervalTicks !== null
            ? `${result.timingValidation.medianFrameIntervalTicks} ticks`
            : 'Unavailable'}
        </dd>
      </div>

      <div>
        <dt>Maximum frame interval</dt>
        <dd>
          {result.timingValidation.maximumFrameIntervalTicks !== null
            ? `${result.timingValidation.maximumFrameIntervalTicks} ticks`
            : 'Unavailable'}
        </dd>
      </div>

      <div>
        <dt>Timing mode</dt>
        <dd>
          {result.timingValidation.isConstantFrameRate
            ? 'Constant'
            : 'Variable'}
        </dd>
      </div>

      <div>
        <dt>Equivalent frame rate</dt>
        <dd>
          {result.timingValidation.equivalentFps !== null
            ? `${result.timingValidation.equivalentFps.toFixed(6)} fps`
            : 'Unavailable'}
        </dd>
      </div>

      <div>
        <dt>PTS uniqueness</dt>
        <dd>
          {result.timingValidation.ptsAreUnique
            ? 'All unique'
            : 'Duplicates found'}
        </dd>
      </div>  */}  