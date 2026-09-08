/**
 * Distance and speed metrics from the smoothed, gap-aware analysis trajectory.
 *
 * Inputs:
 * - ProcessedTrajectory and ArenaCalibration, including optional physical platform diameter for unit conversion.
 *
 * Outputs:
 * - TrajectoryMetrics in pixels and, when calibrated, centimeters/centimeters per second.
 *
 * Main function:
 * - computeTrajectoryMetrics() accumulates only connected trajectory steps and reports path length, durations, and speed summaries.
 */
import type { ArenaCalibration, ProcessedTrajectory } from '../models/tracking';

export interface TrajectoryMetrics {
  observationCount: number;
  connectedStepCount: number;
  pathLengthPixels: number;
  pathLengthCm: number | null;
  trialDurationSeconds: number;
  connectedDurationSeconds: number;
  meanSpeedPixelsPerSecond: number;
  meanSpeedCmPerSecond: number | null;
  connectedMeanSpeedPixelsPerSecond: number;
  connectedMeanSpeedCmPerSecond: number | null;
  medianStepSpeedPixelsPerSecond: number;
  medianStepSpeedCmPerSecond: number | null;
}

function median(values: number[]): number {
  if (values.length === 0)
    return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pixelsPerCm(calibration: ArenaCalibration): number | null {
  const diameterCm = calibration.platformDiameterCm;
  if (diameterCm === null || diameterCm <= 0)
    return null;
  return (calibration.platformRadiusPixels * 2) / diameterCm;
}

export function computeTrajectoryMetrics(
  trajectory: ProcessedTrajectory,
  calibration: ArenaCalibration,
): TrajectoryMetrics {
  const points = trajectory.smoothed;
  const scale = pixelsPerCm(calibration);
  let pathLengthPixels = 0;
  let connectedDurationSeconds = 0;
  let connectedStepCount = 0;
  const stepSpeeds: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    // Never bridge separately identified trajectory segments.
    if (previous.segmentId !== current.segmentId)
      continue;
    const dt = current.timeSeconds - previous.timeSeconds;
    // Duplicate/non-increasing PTS cannot define a velocity.
    if (dt <= 0)
      continue;
    const distancePixels = Math.hypot(current.x - previous.x, current.y - previous.y);
    pathLengthPixels += distancePixels;
    connectedDurationSeconds += dt;
    connectedStepCount += 1;
    stepSpeeds.push(distancePixels / dt);
  }
  const first = points[0];
  const last = points.at(-1);
  const trialDurationSeconds = first && last
    ? Math.max(0, last.timeSeconds - first.timeSeconds)
    : 0;
  const pathLengthCm = scale !== null
    ? pathLengthPixels / scale
    : null;
  const meanSpeedPixelsPerSecond = trialDurationSeconds > 0
    ? pathLengthPixels / trialDurationSeconds
    : 0;
  const connectedMeanSpeedPixelsPerSecond = connectedDurationSeconds > 0
    ? pathLengthPixels / connectedDurationSeconds
    : 0;
  const medianStepSpeedPixelsPerSecond = median(stepSpeeds);
  return {
    observationCount: points.length,
    connectedStepCount,
    pathLengthPixels,
    pathLengthCm,
    trialDurationSeconds,
    connectedDurationSeconds,
    meanSpeedPixelsPerSecond,
    meanSpeedCmPerSecond: pathLengthCm !== null && trialDurationSeconds > 0
      ? pathLengthCm / trialDurationSeconds
      : null,
    connectedMeanSpeedPixelsPerSecond,
    connectedMeanSpeedCmPerSecond: pathLengthCm !== null && connectedDurationSeconds > 0
      ? pathLengthCm / connectedDurationSeconds
      : null,
    medianStepSpeedPixelsPerSecond,
    medianStepSpeedCmPerSecond: scale !== null
      ? medianStepSpeedPixelsPerSecond / scale
      : null,
  };
}
