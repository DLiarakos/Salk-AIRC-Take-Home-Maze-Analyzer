import type { FrameTiming } from '../models/media';

export interface TimingValidation {
  expectedFrameCount: number;
  decodedFrameCount: number;
  timingRecordCount: number;

  uniquePtsCount: number;
  duplicatePtsCount: number;

  minimumPtsTicks: number | null;
  maximumPtsTicks: number | null;

  minimumFrameIntervalTicks: number | null;
  maximumFrameIntervalTicks: number | null;
  medianFrameIntervalTicks: number | null;

  uniqueFrameIntervals: number[];

  equivalentFps: number | null;

  isConstantFrameRate: boolean;
  frameCountMatches: boolean;
  timingCountMatches: boolean;
  ptsAreUnique: boolean;

  valid: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}

export function validateFrameTimings(
  frames: FrameTiming[],
  expectedFrameCount: number,
  decodedFrameCount: number,
  trackTimescale: number,
): TimingValidation {
  const presentationFrames = [...frames].sort(
    (a, b) => a.pts.ticks - b.pts.ticks,
  );

  const ptsTicks = presentationFrames.map(
    (frame) => frame.pts.ticks,
  );

  const uniquePts = new Set(ptsTicks);

  const intervals: number[] = [];

  for (
    let i = 1;
    i < presentationFrames.length;
    i += 1
  ) {
    intervals.push(
      presentationFrames[i].pts.ticks -
      presentationFrames[i - 1].pts.ticks,
    );
  }

  const uniqueFrameIntervals = [
    ...new Set(intervals),
  ].sort((a, b) => a - b);

  const medianFrameIntervalTicks =
    median(intervals);

  const minimumFrameIntervalTicks =
    intervals.length > 0
      ? Math.min(...intervals)
      : null;

  const maximumFrameIntervalTicks =
    intervals.length > 0
      ? Math.max(...intervals)
      : null;

  const equivalentFps =
    medianFrameIntervalTicks !== null &&
    medianFrameIntervalTicks > 0
      ? trackTimescale /
        medianFrameIntervalTicks
      : null;

  const frameCountMatches =
    decodedFrameCount === expectedFrameCount;

  const timingCountMatches =
    frames.length === expectedFrameCount;

  const ptsAreUnique =
    uniquePts.size === frames.length;

  const isConstantFrameRate =
    uniqueFrameIntervals.length === 1;

  return {
    expectedFrameCount,
    decodedFrameCount,
    timingRecordCount: frames.length,

    uniquePtsCount: uniquePts.size,
    duplicatePtsCount:
      frames.length - uniquePts.size,

    minimumPtsTicks:
      ptsTicks.length > 0
        ? Math.min(...ptsTicks)
        : null,

    maximumPtsTicks:
      ptsTicks.length > 0
        ? Math.max(...ptsTicks)
        : null,

    minimumFrameIntervalTicks,
    maximumFrameIntervalTicks,
    medianFrameIntervalTicks,

    uniqueFrameIntervals,

    equivalentFps,

    isConstantFrameRate,
    frameCountMatches,
    timingCountMatches,
    ptsAreUnique,

    valid:
      frameCountMatches &&
      timingCountMatches &&
      ptsAreUnique,
  };
}