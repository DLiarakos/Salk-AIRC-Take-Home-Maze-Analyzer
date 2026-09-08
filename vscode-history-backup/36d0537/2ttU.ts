import type {
  AnalysisTrajectoryPoint,
  BodyTrack,
  ProcessedTrajectory,
  TrajectorySmoothingSettings,
  TrialWindow,
} from '../models/tracking';

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * fraction);

  return sorted[index];
}

function ptsSeconds(ticks: number, timescale: number): number {
  return ticks / timescale;
}