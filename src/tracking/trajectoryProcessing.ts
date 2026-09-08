/**
 * Preparation and smoothing of raw body tracking into a gap-aware analysis trajectory.
 *
 * Inputs:
 * - BodyTrack, TrialWindow, and TrajectorySmoothingSettings.
 *
 * Outputs:
 * - ProcessedTrajectory containing deduplicated raw analysis points, smoothed points, segment IDs, and smoothing/timing QC.
 *
 * Main function:
 * - processTrajectory() restricts observations to the trial, preserves discontinuities, collapses duplicate PTS, and applies median/mean smoothing.
 */
import type {
  AnalysisTrajectoryPoint, BodyTrack, ProcessedTrajectory, TrajectorySmoothingSettings, TrialWindow,
} from '../models/tracking';

function median(values: number[]): number {
  if (values.length === 0)
    return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0)
    return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * fraction);
  return sorted[index];
}

function ptsSeconds(ticks: number, timescale: number): number {
  return ticks / timescale;
}

function prepareAnalysisTrajectory(
  track: BodyTrack,
  trialWindow: TrialWindow,
  maxGapSeconds: number,
): {
  points: AnalysisTrajectoryPoint[];
  sourceObservationCount: number;
  missingObservationCount: number;
  duplicatePtsCollapsed: number;
  nonIncreasingTimestampCount: number;
} {
  const endIndex = trialWindow.endPresentationIndex ?? Number.POSITIVE_INFINITY;
  const groups: {
    pts: AnalysisTrajectoryPoint['pts'];
    timeSeconds: number;
    segmentId: number;
    xs: number[];
    ys: number[];
  }[] = [];
  let segmentId = 0;
  let lastValidTime: number | null = null;
  let inMissingRun = false;
  let sourceObservationCount = 0;
  let missingObservationCount = 0;
  let validSourceObservationCount = 0;
  let nonIncreasingTimestampCount = 0;
  for (const point of track.points) {
    if (point.presentationIndex < trialWindow.startPresentationIndex ||
      point.presentationIndex > endIndex) {
      continue;
    }
    sourceObservationCount += 1;
    if (point.x === null || point.y === null) {
      missingObservationCount += 1;
      if (!inMissingRun) {
        segmentId += 1;
        inMissingRun = true;
      }
      lastValidTime = null;
      continue;
    }
    validSourceObservationCount += 1;
    inMissingRun = false;
    const timeSeconds = ptsSeconds(point.pts.ticks, point.pts.timescale);
    if (lastValidTime !== null) {
      const dt = timeSeconds - lastValidTime;
      if (dt < 0) {
        nonIncreasingTimestampCount += 1;
        segmentId += 1;
      }
      else if (dt > maxGapSeconds) {
        segmentId += 1;
      }
    }
    lastValidTime = timeSeconds;
    const previous = groups.at(-1);
    /*
     * Collapse observations sharing the exact source PTS.
     * We don't invent a timestamp between them.
    */
    if (previous &&
      previous.segmentId === segmentId &&
      previous.pts.ticks === point.pts.ticks &&
      previous.pts.timescale === point.pts.timescale) {
      previous.xs.push(point.x);
      previous.ys.push(point.y);
      continue;
    }
    groups.push({
      pts: point.pts,
      timeSeconds,
      segmentId,
      xs: [point.x],
      ys: [point.y],
    });
  }
  const points: AnalysisTrajectoryPoint[] = groups.map((group) => ({
    pts: group.pts,
    timeSeconds: group.timeSeconds,
    x: median(group.xs),
    y: median(group.ys),
    segmentId: group.segmentId,
    sourceObservationCount: group.xs.length,
  }));
  return {
    points,
    sourceObservationCount,
    missingObservationCount,
    duplicatePtsCollapsed: validSourceObservationCount - points.length,
    nonIncreasingTimestampCount,
  };
}

function medianSmooth(points: AnalysisTrajectoryPoint[], windowSeconds: number): AnalysisTrajectoryPoint[] {
  const halfWindow = windowSeconds / 2;
  return points.map((point, index) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = index; i >= 0; i -= 1) {
      const candidate = points[i];
      if (candidate.segmentId !== point.segmentId ||
        point.timeSeconds - candidate.timeSeconds > halfWindow) {
        break;
      }
      xs.push(candidate.x);
      ys.push(candidate.y);
    }
    for (let i = index + 1; i < points.length; i += 1) {
      const candidate = points[i];
      if (candidate.segmentId !== point.segmentId ||
        candidate.timeSeconds - point.timeSeconds > halfWindow) {
        break;
      }
      xs.push(candidate.x);
      ys.push(candidate.y);
    }
    return {
      ...point,
      x: median(xs),
      y: median(ys),
    };
  });
}

function meanSmooth(points: AnalysisTrajectoryPoint[], windowSeconds: number): AnalysisTrajectoryPoint[] {
  const halfWindow = windowSeconds / 2;
  return points.map((point, index) => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let i = index; i >= 0; i -= 1) {
      const candidate = points[i];
      if (candidate.segmentId !== point.segmentId ||
        point.timeSeconds - candidate.timeSeconds > halfWindow) {
        break;
      }
      sumX += candidate.x;
      sumY += candidate.y;
      count += 1;
    }
    for (let i = index + 1; i < points.length; i += 1) {
      const candidate = points[i];
      if (candidate.segmentId !== point.segmentId ||
        candidate.timeSeconds - point.timeSeconds > halfWindow) {
        break;
      }
      sumX += candidate.x;
      sumY += candidate.y;
      count += 1;
    }
    return {
      ...point,
      x: count > 0 ? sumX / count : point.x,
      y: count > 0 ? sumY / count : point.y,
    };
  });
}

export function processTrajectory(
  track: BodyTrack,
  trialWindow: TrialWindow,
  settings: TrajectorySmoothingSettings,
): ProcessedTrajectory {
  const prepared = prepareAnalysisTrajectory(track, trialWindow, settings.maxGapSeconds);
  const medianFiltered = medianSmooth(prepared.points, settings.medianWindowSeconds);
  const smoothed = meanSmooth(medianFiltered, settings.meanWindowSeconds);
  const corrections = prepared.points.map((raw, index) => {
    const smooth = smoothed[index];
    return Math.hypot(smooth.x - raw.x, smooth.y - raw.y);
  });
  return {
    raw: prepared.points,
    smoothed,
    qc: {
      sourceObservationCount: prepared.sourceObservationCount,
      analysisObservationCount: prepared.points.length,
      missingObservationCount: prepared.missingObservationCount,
      duplicatePtsCollapsed: prepared.duplicatePtsCollapsed,
      nonIncreasingTimestampCount: prepared.nonIncreasingTimestampCount,
      segmentCount: new Set(prepared.points.map((point) => point.segmentId)).size,
      medianSmoothingCorrectionPixels: median(corrections),
      p95SmoothingCorrectionPixels: percentile(corrections, 0.95),
      maximumSmoothingCorrectionPixels: corrections.length > 0 ? Math.max(...corrections) : 0,
    },
    settings,
  };
}
