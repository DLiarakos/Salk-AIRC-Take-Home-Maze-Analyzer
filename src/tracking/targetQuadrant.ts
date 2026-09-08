import type {
  AnalysisTrajectoryPoint,
  ArenaCalibration,
  HoleGeometry,
  ProcessedTrajectory,
  QuadrantWindowMetrics,
  TargetQuadrantMetrics,
} from '../models/tracking';

const QUADRANT_HALF_WIDTH =
  Math.PI / 4;

function angularDifference(
  a: number,
  b: number,
): number {
  let difference =
    a - b;

  while (difference > Math.PI) {
    difference -=
      Math.PI * 2;
  }

  while (difference < -Math.PI) {
    difference +=
      Math.PI * 2;
  }

  return difference;
}

function isInsideTargetQuadrant(
  x: number,
  y: number,
  arena: ArenaCalibration,
  targetAngle: number,
): boolean {
  const pointAngle =
    Math.atan2(
      y - arena.centerY,
      x - arena.centerX,
    );

  return (
    Math.abs(
      angularDifference(
        pointAngle,
        targetAngle,
      ),
    ) <=
    QUADRANT_HALF_WIDTH
  );
}

function computeWindow(
  allPoints:
    AnalysisTrajectoryPoint[],

  startTimeSeconds: number,
  endTimeSeconds: number,

  arena:
    ArenaCalibration,

  targetAngle: number,
): QuadrantWindowMetrics {
  const points =
    allPoints.filter(
      (point) =>
        point.timeSeconds >=
          startTimeSeconds &&
        point.timeSeconds <=
          endTimeSeconds,
    );

  const windowDurationSeconds =
    Math.max(
      0,
      endTimeSeconds -
      startTimeSeconds,
    );

  if (points.length === 0) {
    return {
      startTimeSeconds,
      endTimeSeconds,
      windowDurationSeconds,

      observedDurationSeconds: 0,
      observedCoverageFraction: null,

      targetQuadrantTimeSeconds: 0,
      targetQuadrantTimeFraction: null,

      totalPathPixels: 0,
      targetQuadrantPathPixels: 0,
      targetQuadrantPathFraction: null,

      targetQuadrantEntryCount: 0,

      initiallyInsideTargetQuadrant:
        false,

      observationCount: 0,
    };
  }

  const initiallyInsideTargetQuadrant =
    isInsideTargetQuadrant(
      points[0].x,
      points[0].y,
      arena,
      targetAngle,
    );

  let observedDurationSeconds = 0;

  let targetQuadrantTimeSeconds = 0;

  let totalPathPixels = 0;

  let targetQuadrantPathPixels = 0;

  let targetQuadrantEntryCount = 0;

  for (
    let index = 1;
    index < points.length;
    index += 1
  ) {
    const previous =
      points[index - 1];

    const current =
      points[index];

    /*
     * Never bridge trajectory gaps.
     */
    if (
      previous.segmentId !==
      current.segmentId
    ) {
      continue;
    }

    const deltaTime =
      current.timeSeconds -
      previous.timeSeconds;

    if (deltaTime <= 0) {
      continue;
    }

    const previousInside =
      isInsideTargetQuadrant(
        previous.x,
        previous.y,
        arena,
        targetAngle,
      );

    const currentInside =
      isInsideTargetQuadrant(
        current.x,
        current.y,
        arena,
        targetAngle,
      );

    if (
      !previousInside &&
      currentInside
    ) {
      targetQuadrantEntryCount += 1;
    }

    const midpointX =
      (
        previous.x +
        current.x
      ) / 2;

    const midpointY =
      (
        previous.y +
        current.y
      ) / 2;

    const midpointInside =
      isInsideTargetQuadrant(
        midpointX,
        midpointY,
        arena,
        targetAngle,
      );

    const stepDistance =
      Math.hypot(
        current.x -
          previous.x,

        current.y -
          previous.y,
      );

    observedDurationSeconds +=
      deltaTime;

    totalPathPixels +=
      stepDistance;

    if (midpointInside) {
      targetQuadrantTimeSeconds +=
        deltaTime;

      targetQuadrantPathPixels +=
        stepDistance;
    }
  }

  return {
    startTimeSeconds,
    endTimeSeconds,
    windowDurationSeconds,

    observedDurationSeconds,

    observedCoverageFraction:
      windowDurationSeconds > 0
        ? Math.min(
            1,
            observedDurationSeconds /
              windowDurationSeconds,
          )
        : null,

    targetQuadrantTimeSeconds,

    targetQuadrantTimeFraction:
      observedDurationSeconds > 0
        ? (
            targetQuadrantTimeSeconds /
            observedDurationSeconds
          )
        : null,

    totalPathPixels,

    targetQuadrantPathPixels,

    targetQuadrantPathFraction:
      totalPathPixels > 0
        ? (
            targetQuadrantPathPixels /
            totalPathPixels
          )
        : null,

    targetQuadrantEntryCount,

    initiallyInsideTargetQuadrant,

    observationCount:
      points.length,
  };
}

export function computeTargetQuadrantMetrics(
  trajectory:
    ProcessedTrajectory,

  arena:
    ArenaCalibration,

  geometry:
    HoleGeometry,

  firstTargetTimeSeconds:
    number | null,

  requestedEndTimeSeconds:
    number | null,
): TargetQuadrantMetrics | null {
  const points =
    trajectory.smoothed;

  if (points.length === 0) {
    return null;
  }

  const targetHole =
    geometry.holes.find(
      (hole) =>
        hole.isTarget,
    );

  if (!targetHole) {
    return null;
  }

  const targetAngle =
    Math.atan2(
      targetHole.centerY -
        arena.centerY,

      targetHole.centerX -
        arena.centerX,
    );

  const startTimeSeconds =
    points[0].timeSeconds;

  const finalAvailableTime =
    points[
      points.length - 1
    ].timeSeconds;

  const endTimeSeconds =
    requestedEndTimeSeconds !== null
      ? Math.min(
          finalAvailableTime,
          Math.max(
            startTimeSeconds,
            requestedEndTimeSeconds,
          ),
        )
      : finalAvailableTime;

  const analyzedTrial =
    computeWindow(
      points,
      startTimeSeconds,
      endTimeSeconds,
      arena,
      targetAngle,
    );

  const preTarget =
    firstTargetTimeSeconds !== null &&
    firstTargetTimeSeconds >
      startTimeSeconds
      ? computeWindow(
          points,
          startTimeSeconds,

          Math.min(
            endTimeSeconds,
            firstTargetTimeSeconds,
          ),

          arena,
          targetAngle,
        )
      : null;

  return {
    targetHoleIndex:
      targetHole.index,

    targetAngleRadians:
      targetAngle,

    quadrantHalfWidthRadians:
      QUADRANT_HALF_WIDTH,

    analyzedTrial,
    preTarget,
  };
}