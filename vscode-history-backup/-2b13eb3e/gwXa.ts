import type {
  BodyTrack,
  BodyTrackPoint,
} from '../models/tracking';

export interface MissingRun {
  startIndex: number;
  endIndex: number;

  startPoint: BodyTrackPoint;
  endPoint: BodyTrackPoint;

  frameCount: number;

  /**
   * Exact elapsed time between the first
   * and last missing-frame PTS.
   */
  durationSeconds: number;
}

export interface TrackQcSummary {
  totalFrames: number;

  detectedFrames: number;
  missingFrames: number;

  visibleFrames: number;
  partialFrames: number;

  detectionRate: number;

  missingRuns: MissingRun[];

  medianDetectedAreaPixels:
    number | null;

  medianDominance:
    number | null;
}

function median(
  values: number[],
): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [
    ...values,
  ].sort(
    (a, b) =>
      a - b,
  );

  const middle =
    Math.floor(
      sorted.length / 2,
    );

  if (
    sorted.length % 2 === 1
  ) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}

function elapsedSeconds(
  first: BodyTrackPoint,
  last: BodyTrackPoint,
): number {
  const firstSeconds =
    first.pts.ticks /
    first.pts.timescale;

  const lastSeconds =
    last.pts.ticks /
    last.pts.timescale;

  return Math.max(
    0,
    lastSeconds -
      firstSeconds,
  );
}

export function analyzeBodyTrack(
  track: BodyTrack,
): TrackQcSummary {
  const missingRuns:
    MissingRun[] = [];

  let currentRunStart:
    number | null = null;

  for (
    let i = 0;
    i < track.points.length;
    i += 1
  ) {
    const point =
      track.points[i];

    const missing =
      point.x === null ||
      point.y === null;

    if (
      missing &&
      currentRunStart === null
    ) {
      currentRunStart =
        i;
    }

    const isLastPoint =
      i ===
      track.points.length - 1;

    if (
      currentRunStart !== null &&
      (
        !missing ||
        isLastPoint
      )
    ) {
      const endIndex =
        missing
          ? i
          : i - 1;

      const startPoint =
        track.points[
          currentRunStart
        ];

      const endPoint =
        track.points[
          endIndex
        ];

      missingRuns.push({
        startIndex:
          currentRunStart,

        endIndex,

        startPoint,
        endPoint,

        frameCount:
          endIndex -
          currentRunStart +
          1,

        durationSeconds:
          elapsedSeconds(
            startPoint,
            endPoint,
          ),
      });

      currentRunStart =
        null;
    }
  }

  const detected =
    track.points.filter(
      (point) =>
        point.x !== null &&
        point.y !== null,
    );

  const areas =
    detected
      .map(
        (point) =>
          point.areaPixels,
      )
      .filter(
        (
          value,
        ): value is number =>
          value !== null,
      );

  const dominances =
    detected
      .map(
        (point) =>
          point.dominance,
      )
      .filter(
        (
          value,
        ): value is number =>
          value !== null,
      );

  const visibleFrames =
    track.points.filter(
      (point) =>
        point.visibility ===
        'visible',
    ).length;

  const partialFrames =
    track.points.filter(
      (point) =>
        point.visibility ===
        'partial',
    ).length;

  return {
    totalFrames:
      track.points.length,

    detectedFrames:
      track.detectedFrameCount,

    missingFrames:
      track.missingFrameCount,

    visibleFrames,
    partialFrames,

    detectionRate:
      track.points.length > 0
        ? track.detectedFrameCount /
          track.points.length
        : 0,

    missingRuns,

    medianDetectedAreaPixels:
      median(areas),

    medianDominance:
      median(dominances),
  };
}