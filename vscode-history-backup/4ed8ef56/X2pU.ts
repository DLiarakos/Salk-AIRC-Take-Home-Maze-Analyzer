import type {
  ArenaCalibration,
  FinalReviewedHoleInvestigationEvent,
  HoleGeometry,
  ProcessedTrajectory,
  SearchStrategyResult,
  SearchStrategySettings,
} from '../models/tracking';

function distance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  return Math.hypot(
    x1 - x2,
    y1 - y2,
  );
}

function circularHoleDistance(
  a: number,
  b: number,
  holeCount: number,
): number {
  const difference =
    Math.abs(
      a - b,
    );

  return Math.min(
    difference,
    holeCount -
      difference,
  );
}

function adjacentDirection(
  a: number,
  b: number,
  holeCount: number,
): -1 | 0 | 1 {
  const clockwise =
    (
      b -
      a +
      holeCount
    ) %
    holeCount;

  const counterclockwise =
    (
      a -
      b +
      holeCount
    ) %
    holeCount;

  if (clockwise === 1) {
    return 1;
  }

  if (counterclockwise === 1) {
    return -1;
  }

  return 0;
}

export function classifySearchStrategy(
  trajectory:
    ProcessedTrajectory,

  arena:
    ArenaCalibration,

  geometry:
    HoleGeometry,

  events:
    FinalReviewedHoleInvestigationEvent[],

  settings:
    SearchStrategySettings,
): SearchStrategyResult | null {
  const targetHole =
    geometry.holes.find(
      (hole) =>
        hole.isTarget,
    );

  if (
    !targetHole ||
    trajectory.smoothed.length === 0
  ) {
    return null;
  }

  const orderedEvents =
    [...events].sort(
      (a,b) =>
        a.startPresentationIndex -
          b.startPresentationIndex ||
        a.eventIndex -
          b.eventIndex,
    );

  const firstTarget =
    orderedEvents.find(
      (event) =>
        event.isTarget,
    ) ?? null;

  const searchStartTimeSeconds =
    trajectory
      .smoothed[0]
      .timeSeconds;

  const finalTrajectoryTime =
    trajectory
      .smoothed[
        trajectory.smoothed.length - 1
      ]
      .timeSeconds;

  const searchEndTimeSeconds =
    firstTarget
      ? Math.min(
          finalTrajectoryTime,
          firstTarget
            .startTimeSeconds,
        )
      : finalTrajectoryTime;

  const searchPoints =
    trajectory.smoothed.filter(
      (point) =>
        point.timeSeconds >=
          searchStartTimeSeconds &&
        point.timeSeconds <=
          searchEndTimeSeconds,
    );

  let searchPathLengthPixels = 0;

  let observedSearchTime = 0;

  let perimeterTime = 0;

  const perimeterThreshold =
    arena.platformRadiusPixels *
    settings.perimeterRadiusFraction;

  for (
    let index = 1;
    index < searchPoints.length;
    index += 1
  ) {
    const previous =
      searchPoints[index - 1];

    const current =
      searchPoints[index];

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

    searchPathLengthPixels +=
      distance(
        previous.x,
        previous.y,
        current.x,
        current.y,
      );

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

    const radius =
      distance(
        midpointX,
        midpointY,
        arena.centerX,
        arena.centerY,
      );

    observedSearchTime +=
      deltaTime;

    if (
      radius >=
      perimeterThreshold
    ) {
      perimeterTime +=
        deltaTime;
    }
  }

  const startPoint =
  searchPoints[0] ??
  trajectory.smoothed[0];

const endPoint =
  searchPoints.at(-1) ??
  startPoint;

/*
 * Path efficiency must compare the observed
 * path with the straight-line displacement
 * between the SAME two body-centroid
 * positions.
 *
 * Start:
 * first smoothed trajectory point in search.
 *
 * End:
 * final smoothed trajectory point at or
 * immediately before first target-event onset.
 */
const straightLineDisplacementPixels =
  distance(
    startPoint.x,
    startPoint.y,
    endPoint.x,
    endPoint.y,
  );

/*
 * A trajectory split into multiple segments
 * contains an unobserved gap. In that case,
 * observed path length does not represent the
 * complete route between start and end, so a
 * geometric efficiency ratio would be
 * misleading.
 */
const searchSegmentIds =
  new Set(
    searchPoints.map(
      (point) =>
        point.segmentId,
    ),
  );

const pathEfficiency =
  searchPathLengthPixels > 0 &&
  searchSegmentIds.size === 1
    ? (
        straightLineDisplacementPixels /
        searchPathLengthPixels
      )
    : null;

  const primaryErrorEvents =
    firstTarget
      ? orderedEvents.filter(
          (event) =>
            !event.isTarget &&
            event.startPresentationIndex <
              firstTarget
                .startPresentationIndex,
        )
      : orderedEvents.filter(
          (event) =>
            !event.isTarget,
        );

  const primaryErrorCount =
    primaryErrorEvents.length;

  const uniqueIncorrectHoleCount =
    new Set(
      primaryErrorEvents.map(
        (event) =>
          event.holeIndex,
      ),
    ).size;

  /*
   * Include the first target event as the final
   * visit in the search sequence.
   */
  const searchEvents =
    orderedEvents.filter(
      (event) =>
        event.startTimeSeconds <=
        searchEndTimeSeconds +
          1e-9,
    );

  /*
   * Detector fragmentation can produce repeated
   * events at one hole. Collapse only consecutive
   * identical hole numbers for strategy features.
   */
  const investigatedHoleSequence:
    number[] = [];

  for (const event of searchEvents) {
    const last =
      investigatedHoleSequence[
        investigatedHoleSequence.length -
        1
      ];

    if (
      last !==
      event.holeIndex
    ) {
      investigatedHoleSequence.push(
        event.holeIndex,
      );
    }
  }

  let adjacentTransitionCount = 0;

let clockwiseAdjacentCount = 0;

let counterclockwiseAdjacentCount = 0;

let directionReversalCount = 0;

let directionReversalOpportunityCount = 0;

/*
 * Previous direction within the current
 * contiguous run of adjacent-hole transitions.
 *
 * A non-adjacent jump breaks the run.
 */
let previousAdjacentDirection:
  -1 | 0 | 1 = 0;

  for (
    let index = 1;
    index <
      investigatedHoleSequence.length;
    index += 1
  ) {
    const previous =
      investigatedHoleSequence[
        index - 1
      ];

    const current =
      investigatedHoleSequence[
        index
      ];

    const isAdjacent =
  circularHoleDistance(
    previous,
    current,
    geometry.holeCount,
  ) === 1;

if (!isAdjacent) {
  /*
   * A jump across non-neighboring holes
   * interrupts a serial directional run.
   */
  previousAdjacentDirection =
    0;

  continue;
}

adjacentTransitionCount += 1;

const direction =
  adjacentDirection(
    previous,
    current,
    geometry.holeCount,
  );

if (direction === 1) {
  clockwiseAdjacentCount += 1;
} else if (
  direction === -1
) {
  counterclockwiseAdjacentCount += 1;
}

/*
 * Only compare direction when two adjacent
 * transitions occur consecutively.
 *
 * Example:
 *
 * 18 → 19 → 18
 *
 * +1 followed by -1 = one reversal.
 */
if (
  direction !== 0 &&
  previousAdjacentDirection !== 0
) {
  directionReversalOpportunityCount +=
    1;

  if (
    direction !==
    previousAdjacentDirection
  ) {
    directionReversalCount += 1;
  }
}

previousAdjacentDirection =
  direction;

  const holeTransitionCount =
    Math.max(
      0,
      investigatedHoleSequence.length -
        1,
    );

  const adjacentTransitionFraction =
    holeTransitionCount > 0
      ? (
          adjacentTransitionCount /
          holeTransitionCount
        )
      : null;

  const directionalConsistency =
    adjacentTransitionCount > 0
      ? (
          Math.max(
            clockwiseAdjacentCount,
            counterclockwiseAdjacentCount,
          ) /
          adjacentTransitionCount
        )
      : null;
  const directionReversalFraction =
    directionReversalOpportunityCount >
    0
        ? (
            directionReversalCount /
            directionReversalOpportunityCount
        )
        : null;

  const perimeterTimeFraction =
    observedSearchTime > 0
      ? (
          perimeterTime /
          observedSearchTime
        )
      : null;

  const directQualified =
    firstTarget !== null &&
    primaryErrorCount <=
      settings
        .maxDirectPrimaryErrors &&
    pathEfficiency !== null &&
    pathEfficiency >=
      settings
        .minimumDirectPathEfficiency;

  const serialQualified =
  holeTransitionCount >=
    settings
      .minimumTransitionsForSerial &&

  adjacentTransitionFraction !==
    null &&

  adjacentTransitionFraction >=
    settings
      .minimumSerialAdjacentTransitionFraction &&

  directionalConsistency !==
    null &&

  directionalConsistency >=
    settings
      .minimumSerialDirectionalConsistency &&

  /*
   * If there are enough consecutive adjacent
   * transitions to evaluate reversals, require
   * a low reversal fraction.
   *
   * A null value means there was not enough
   * directional evidence to calculate one.
   */
  directionReversalFraction !==
    null &&

  directionReversalFraction <=
    settings
      .maximumSerialDirectionReversalFraction &&

  perimeterTimeFraction !==
    null &&

  perimeterTimeFraction >=
    settings
      .minimumSerialPerimeterTimeFraction;

  let automaticStrategy:
    SearchStrategyResult[
      'automaticStrategy'
    ];

  let confidence:
    SearchStrategyResult[
      'confidence'
    ];

  const reasoning:
    string[] = [];

  if (directQualified) {
    automaticStrategy =
      'direct';

    confidence =
      primaryErrorCount === 0 &&
      pathEfficiency !== null &&
      pathEfficiency >= 0.70
        ? 'high'
        : 'moderate';

    reasoning.push(
      `Primary errors ${primaryErrorCount} <= ${settings.maxDirectPrimaryErrors}.`,
    );

    reasoning.push(
      `Path efficiency ${pathEfficiency?.toFixed(2)} >= ${settings.minimumDirectPathEfficiency.toFixed(2)}.`,
    );
  } else if (
    serialQualified
  ) {
    automaticStrategy =
      'serial';

    confidence =
      (
        adjacentTransitionFraction ??
        0
      ) >= 0.75 &&
      (
        directionalConsistency ??
        0
      ) >= 0.75
        ? 'high'
        : 'moderate';

    reasoning.push(
      `${((adjacentTransitionFraction ?? 0) * 100).toFixed(1)}% of hole transitions were adjacent.`,
    );

    reasoning.push(
      `${((directionalConsistency ?? 0) * 100).toFixed(1)}% directional consistency among adjacent transitions.`,
    );
    reasoning.push(
        `${((directionReversalFraction ?? 0) * 100).toFixed(1)}% direction-reversal fraction among consecutive adjacent transitions.`,);

    reasoning.push(
      `${((perimeterTimeFraction ?? 0) * 100).toFixed(1)}% of observed search time was peripheral.`,
    );
  } else if (
    holeTransitionCount >=
      settings
        .minimumTransitionsForSerial ||
    primaryErrorCount >= 3
  ) {
    automaticStrategy =
      'random';

    confidence =
      holeTransitionCount >= 5 ||
      primaryErrorCount >= 5
        ? 'moderate'
        : 'low';

    reasoning.push(
      'Search did not satisfy the direct or serial rule set.',
    );
    if (
        directionReversalFraction !==
            null &&
        directionReversalFraction >
            settings
            .maximumSerialDirectionReversalFraction
        ) {
        reasoning.push(
            `${(
            directionReversalFraction *
            100
            ).toFixed(1)}% direction-reversal fraction exceeded the serial limit of ${(
            settings.maximumSerialDirectionReversalFraction *
            100
            ).toFixed(1)}%.`,
        );
    }
    reasoning.push(
      `${primaryErrorCount} primary errors across ${uniqueIncorrectHoleCount} unique incorrect holes.`,
    );

    reasoning.push(
      `${holeTransitionCount} distinct-hole transitions were observed.`,
    );
  } else {
    automaticStrategy =
      'uncertain';

    confidence =
      'low';

    reasoning.push(
      'Too little evidence was available for a stable direct, serial, or random classification.',
    );
  }

  const unreviewedInvestigationCount =
    searchEvents.filter(
      (event) =>
        event.reviewStatus ===
        'unreviewed',
    ).length;

  return {
    automaticStrategy,
    confidence,

    targetReached:
      firstTarget !== null,

    searchStartTimeSeconds,
    searchEndTimeSeconds,

    searchPathLengthPixels,

    straightLineDisplacementPixels,

    pathEfficiency,

    primaryErrorCount,
    uniqueIncorrectHoleCount,

    investigatedHoleSequence,

    holeTransitionCount,

    adjacentTransitionCount,

    adjacentTransitionFraction,

    directionalConsistency,

    directionReversalCount,

    directionReversalOpportunityCount,

    directionReversalFraction,

    perimeterTimeFraction,

    unreviewedInvestigationCount,

    reasoning,
  };
}