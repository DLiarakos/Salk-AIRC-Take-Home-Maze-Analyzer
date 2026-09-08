import type {
  BodyTrack,
  BodyTrackPoint,
  HoleGeometry,
  HoleInvestigationEvidence,
  HoleInvestigationEvent,
  HoleInvestigationResult,
  HoleInvestigationSettings,
  TrialWindow,
} from '../models/tracking';

function pointSeconds(point: BodyTrackPoint): number {
  return point.pts.ticks / point.pts.timescale;
}

function ptsKey(point: BodyTrackPoint): string {
  return `${point.pts.ticks}/${point.pts.timescale}`;
}

function orientationScore(point: BodyTrackPoint): number {
  if (point.noseX === null || point.noseY === null) return -1;
  return point.orientationConfidence ?? 0;
}

function uniqueTrialPoints(
  track: BodyTrack,
  trialWindow: TrialWindow,
): {
  points: BodyTrackPoint[];
  sourceCount: number;
  duplicateCount: number;
} {
  const endIndex =
    trialWindow.endPresentationIndex ??
    Number.POSITIVE_INFINITY;

  const source = track.points.filter(
    (point) =>
      point.presentationIndex >=
        trialWindow.startPresentationIndex &&
      point.presentationIndex <= endIndex,
  );

  const byPts =
    new Map<string,BodyTrackPoint>();

  for (const point of source) {
    const key = ptsKey(point);
    const existing = byPts.get(key);

    if (
      !existing ||
      orientationScore(point) >
        orientationScore(existing)
    ) {
      byPts.set(key,point);
    }
  }

  const points =
    [...byPts.values()].sort(
      (a,b) =>
        pointSeconds(a) - pointSeconds(b) ||
        a.presentationIndex -
          b.presentationIndex,
    );

  return {
    points,
    sourceCount: source.length,
    duplicateCount:
      source.length - points.length,
  };
}

function classifyEvidence(
  point: BodyTrackPoint,
  geometry: HoleGeometry,
  settings: HoleInvestigationSettings,
): HoleInvestigationEvidence {
  const timeSeconds =
    pointSeconds(point);

  if (
    point.x === null ||
    point.y === null ||
    point.noseX === null ||
    point.noseY === null
  ) {
    return {
      presentationIndex:
        point.presentationIndex,

      timeSeconds,

      noseX: null,
      noseY: null,

      state: 'unknown',
      holeIndex: null,
      distancePixels: null,
      headHoleAlignment: null,
    };
  }

  let bestHoleIndex:
    number | null = null;

  let bestDistance =
    Number.POSITIVE_INFINITY;

  let bestNormalizedDistance =
    Number.POSITIVE_INFINITY;

  let bestAlignment: number | null = null;

const headX =
  point.noseX - point.x;

const headY =
  point.noseY - point.y;

const headLength =
  Math.hypot(headX,headY);

for (const hole of geometry.holes) {
  const effectiveRadius =
    hole.radiusPixels +
    settings.investigationMarginPixels;

  const noseDistance =
    Math.hypot(
      point.noseX - hole.centerX,
      point.noseY - hole.centerY,
    );

  if (noseDistance > effectiveRadius) {
    continue;
  }

  const holeX =
    hole.centerX - point.x;

  const holeY =
    hole.centerY - point.y;

  const holeLength =
    Math.hypot(holeX,holeY);

  if (
    headLength === 0 ||
    holeLength === 0
  ) {
    continue;
  }

  const alignment =
    Math.max(
      -1,
      Math.min(
        1,
        (
          headX * holeX +
          headY * holeY
        ) /
        (headLength * holeLength),
      ),
    );

  if (
    alignment <
    settings.minimumHeadHoleAlignment
  ) {
    continue;
  }

  const normalizedDistance =
    noseDistance / effectiveRadius;

  if (
    normalizedDistance <
    bestNormalizedDistance
  ) {
    bestHoleIndex = hole.index;
    bestDistance = noseDistance;
    bestNormalizedDistance =
      normalizedDistance;
    bestAlignment = alignment;
  }
}

  if (bestHoleIndex === null) {
    return {
      presentationIndex:
        point.presentationIndex,

      timeSeconds,

      noseX: point.noseX,
      noseY: point.noseY,

      state: 'outside',
      holeIndex: null,
      distancePixels: null,
      headHoleAlignment: null,
    };
  }

  return {
    presentationIndex:
      point.presentationIndex,

    timeSeconds,

    noseX: point.noseX,
    noseY: point.noseY,

    state: 'investigating',
    holeIndex: bestHoleIndex,
    distancePixels: bestDistance,
    headHoleAlignment: bestAlignment,
  };
}

interface CandidateEvent {
  holeIndex: number;

  first:
    HoleInvestigationEvidence;

  lastPositive:
    HoleInvestigationEvidence;

  positiveObservationCount: number;

  minimumDistancePixels: number;
  closestNoseX: number;
  closestNoseY: number;
}

export function detectHoleInvestigations(
  track: BodyTrack,
  geometry: HoleGeometry,
  trialWindow: TrialWindow,
  settings: HoleInvestigationSettings,
): HoleInvestigationResult {
  const unique =
    uniqueTrialPoints(
      track,
      trialWindow,
    );
    
  const evidence =
    unique.points.map(
      (point) =>
        classifyEvidence(
          point,
          geometry,
          settings,
        ),
    );
    let proximityPositiveObservations = 0;
    let alignmentRejectedObservations = 0;
  const events:
    HoleInvestigationEvent[] = [];

  let candidate:
    CandidateEvent | null = null;

  let candidateEventCount = 0;
  let rejectedShortEventCount = 0;

  const epsilon = 1e-9;

function createCandidate(
  observation: HoleInvestigationEvidence,
): CandidateEvent | null {
  if (
    observation.holeIndex === null ||
    observation.distancePixels === null ||
    observation.noseX === null ||
    observation.noseY === null
  ) {
    return null;
  }

  return {
    holeIndex: observation.holeIndex,
    first: observation,
    lastPositive: observation,
    positiveObservationCount: 1,
    minimumDistancePixels: observation.distancePixels,
    closestNoseX: observation.noseX,
    closestNoseY: observation.noseY,
  };
}
function finishCandidate(
  current: CandidateEvent | null,
) {
  if (current === null) return;

  candidateEventCount += 1;

  const durationSeconds =
    current.lastPositive.timeSeconds -
    current.first.timeSeconds;

  if (
    durationSeconds + epsilon >=
    settings.minimumDwellSeconds
  ) {
    const hole =
      geometry.holes.find(
        (item) =>
          item.index === current.holeIndex,
      );

    events.push({
      eventIndex: events.length,
      holeIndex: current.holeIndex,
      isTarget: hole?.isTarget ?? false,

      startPresentationIndex:
        current.first.presentationIndex,

      endPresentationIndex:
        current.lastPositive.presentationIndex,

      startTimeSeconds:
        current.first.timeSeconds,

      endTimeSeconds:
        current.lastPositive.timeSeconds,

      durationSeconds,

      positiveObservationCount:
        current.positiveObservationCount,

      minimumNoseDistancePixels:
        current.minimumDistancePixels,

      closestNoseX:
        current.closestNoseX,

      closestNoseY:
        current.closestNoseY,
    });
  } else {
    rejectedShortEventCount += 1;
  }
}

  for (const observation of evidence) {
  if (
    observation.state === 'investigating' &&
    observation.holeIndex !== null
  ) {
    if (candidate === null) {
      candidate =
        createCandidate(observation);

      continue;
    }

    /*
     * Moving directly from one hole ROI into another
     * ends the previous investigation.
     */
    if (
      observation.holeIndex !==
      candidate.holeIndex
    ) {
      finishCandidate(candidate);

      candidate =
        createCandidate(observation);

      continue;
    }

    const gap =
      observation.timeSeconds -
      candidate.lastPositive.timeSeconds;

    /*
     * Same hole, but the gap was too long to
     * consider this one continuous investigation.
     */
    if (
      gap >
      settings.maximumInterruptionSeconds +
        epsilon
    ) {
      finishCandidate(candidate);

      candidate =
        createCandidate(observation);

      continue;
    }

    candidate.lastPositive =
      observation;

    candidate.positiveObservationCount += 1;

    if (
      observation.distancePixels !== null &&
      observation.distancePixels <
        candidate.minimumDistancePixels
    ) {
      candidate.minimumDistancePixels =
        observation.distancePixels;

      if (
        observation.noseX !== null &&
        observation.noseY !== null
      ) {
        candidate.closestNoseX =
          observation.noseX;

        candidate.closestNoseY =
          observation.noseY;
      }
    }

    continue;
  }

  /*
   * Outside or unknown nose evidence does not
   * immediately terminate an event. It only does so
   * once the interruption exceeds the visible setting.
   */
  if (candidate !== null) {
    const interruption =
      observation.timeSeconds -
      candidate.lastPositive.timeSeconds;

    if (
      interruption >
      settings.maximumInterruptionSeconds +
        epsilon
    ) {
      finishCandidate(candidate);
      candidate = null;
    }
  }
}

/*
 * Flush an event that was still active at trial end.
 */
finishCandidate(candidate);
candidate = null;

  const usableNoseObservations =
    evidence.filter(
      (item) =>
        item.state !== 'unknown',
    ).length;

  const unknownNoseObservations =
    evidence.filter(
      (item) =>
        item.state === 'unknown',
    ).length;

  const positiveEvidenceObservations =
    evidence.filter(
      (item) =>
        item.state ===
        'investigating',
    ).length;

  return {
    evidence,
    events,

    qc: {
      trialObservationCount:
        unique.sourceCount,

      uniqueTimestampCount:
        unique.points.length,

      duplicatePtsCollapsed:
        unique.duplicateCount,

      usableNoseObservations,
      unknownNoseObservations,
      positiveEvidenceObservations,

      candidateEventCount,
      acceptedEventCount:
        events.length,

      rejectedShortEventCount,
    },

    settings,
  };
}