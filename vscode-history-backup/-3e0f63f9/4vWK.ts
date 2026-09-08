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
  /*
   * Convert this observation's exact source PTS
   * into seconds once for all possible return paths.
   */
  const timeSeconds =
    pointSeconds(point);

  /*
   * We cannot evaluate head-to-hole direction unless
   * we have both the body centroid and resolved nose.
   *
   * This is UNKNOWN evidence, not evidence that the
   * mouse was outside an investigation ROI.
   */
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

  /*
   * Everything below this point is guaranteed to have:
   *
   * point.x       number
   * point.y       number
   * point.noseX   number
   * point.noseY   number
   *
   * These variables belong in classifyEvidence()
   * and are recreated separately for each frame.
   */

  /*
   * Track the closest hole whose effective
   * investigation ROI contains the nose.
   */
  let nearestHoleIndex:
    number | null = null;

  let nearestDistance =
    Number.POSITIVE_INFINITY;

  let nearestAlignment:
    number | null = null;

  /*
   * Vector from body centroid toward estimated nose.
   *
   * This represents the current head direction.
   */
  const headX =
    point.noseX - point.x;

  const headY =
    point.noseY - point.y;

  const headLength =
    Math.hypot(
      headX,
      headY,
    );

  /*
   * Check every calibrated hole.
   */
  for (const hole of geometry.holes) {
    /*
     * Physical/calibrated hole radius
     * plus the user-visible behavioral margin.
     */
    const effectiveRadius =
      hole.radiusPixels +
      settings.investigationMarginPixels;

    /*
     * Distance from estimated nose to this
     * hole's reviewed center.
     */
    const noseDistance =
      Math.hypot(
        point.noseX - hole.centerX,
        point.noseY - hole.centerY,
      );

    /*
     * If the nose is not even geometrically near
     * this hole, it cannot be an investigation
     * candidate for this frame.
     */
    if (
      noseDistance >
      effectiveRadius
    ) {
      continue;
    }

    /*
     * Vector from body centroid toward the hole.
     */
    const holeX =
      hole.centerX - point.x;

    const holeY =
      hole.centerY - point.y;

    const holeLength =
      Math.hypot(
        holeX,
        holeY,
      );

    /*
     * Degenerate vectors cannot produce a meaningful
     * direction comparison.
     */
    if (
      headLength === 0 ||
      holeLength === 0
    ) {
      continue;
    }

    /*
     * Cosine similarity between:
     *
     * body → nose
     *
     * and
     *
     * body → hole
     *
     *  1.0 = directly facing hole
     *  0.0 = perpendicular
     * -1.0 = facing directly away
     */
    const alignment =
      Math.max(
        -1,
        Math.min(
          1,
          (
            headX * holeX +
            headY * holeY
          ) /
          (
            headLength *
            holeLength
          ),
        ),
      );

    /*
     * If more than one effective ROI happened to
     * contain the nose, retain the geometrically
     * closest hole.
     */
    if (
      noseDistance <
      nearestDistance
    ) {
      nearestHoleIndex =
        hole.index;

      nearestDistance =
        noseDistance;

      nearestAlignment =
        alignment;
    }
  }

  /*
   * CASE 1:
   *
   * The nose did not fall inside the effective
   * investigation ROI of any hole.
   */
  if (
    nearestHoleIndex === null
  ) {
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

  /*
   * CASE 2:
   *
   * The nose IS near a hole, but the animal is not
   * pointing sufficiently toward it.
   *
   * We preserve the hole, distance, and alignment
   * because this is useful QC evidence.
   */
  if (
    nearestAlignment === null ||
    nearestAlignment <
      settings.minimumHeadHoleAlignment
  ) {
    return {
      presentationIndex:
        point.presentationIndex,

      timeSeconds,

      noseX: point.noseX,
      noseY: point.noseY,

      state:
        'near-but-misaligned',

      holeIndex:
        nearestHoleIndex,

      distancePixels:
        nearestDistance,

      headHoleAlignment:
        nearestAlignment,
    };
  }

  /*
   * CASE 3:
   *
   * Nose is within the effective ROI
   * AND
   * head direction passes the alignment threshold.
   */
  return {
    presentationIndex:
      point.presentationIndex,

    timeSeconds,

    noseX: point.noseX,
    noseY: point.noseY,

    state: 'investigating',

    holeIndex:
      nearestHoleIndex,

    distancePixels:
      nearestDistance,

    headHoleAlignment:
      nearestAlignment,
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
const proximityPositiveObservations =
  evidence.filter(
    (item) =>
      item.state ===
        'investigating' ||
      item.state ===
        'near-but-misaligned',
  ).length;

const alignmentRejectedObservations =
  evidence.filter(
    (item) =>
      item.state ===
        'near-but-misaligned',
  ).length;
    
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