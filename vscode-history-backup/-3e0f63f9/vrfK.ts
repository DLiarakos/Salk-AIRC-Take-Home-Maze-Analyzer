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
  const timeSeconds = pointSeconds(point);

  if (
    point.x === null ||
    point.y === null ||
    point.noseX === null ||
    point.noseY === null
  ) {
    return {
      presentationIndex: point.presentationIndex,
      timeSeconds,
      noseX: null,
      noseY: null,
      state: 'unknown',
      holeIndex: null,
      distancePixels: null,
      headHoleAlignment: null,
      noseLeadPixels: null,
      withinEntryRadius: false,
      withinSustainRadius: false,
    };
  }

  let nearestHoleIndex: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestAlignment: number | null = null;
  let nearestNoseLead: number | null = null;
  let nearestWithinEntryRadius = false;

  const headX = point.noseX - point.x;
  const headY = point.noseY - point.y;
  const headLength = Math.hypot(headX,headY);

  for (const hole of geometry.holes) {
    const entryRadius =
      hole.radiusPixels +
      settings.entryMarginPixels;

    /*
     * Defensive Math.max ensures the outer radius
     * can never accidentally become smaller than
     * the inner trigger radius.
     */
    const sustainRadius =
      hole.radiusPixels +
      Math.max(
        settings.sustainMarginPixels,
        settings.entryMarginPixels,
      );

    const noseDistance =
      Math.hypot(
        point.noseX - hole.centerX,
        point.noseY - hole.centerY,
      );

    /*
     * Outside the outer radius:
     * this hole is irrelevant for this observation.
     */
    if (noseDistance > sustainRadius) {
      continue;
    }

    const holeX = hole.centerX - point.x;
    const holeY = hole.centerY - point.y;
    const holeLength = Math.hypot(holeX,holeY);
    const bodyDistance =
    Math.hypot(
        point.x - hole.centerX,
        point.y - hole.centerY,
    );

    const noseLead =
    bodyDistance - noseDistance;
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
          (
            headLength *
            holeLength
          ),
        ),
      );

    /*
     * If more than one sustain ROI contains the nose,
     * keep the nearest hole.
     */
    if (noseDistance < nearestDistance) {
      nearestHoleIndex = hole.index;
      nearestDistance = noseDistance;
      nearestAlignment = alignment;
      nearestNoseLead = noseLead;
      nearestWithinEntryRadius =
        noseDistance <= entryRadius;
    }
  }

  /*
   * Nose is outside every sustain ROI.
   */
  if (nearestHoleIndex === null) {
    return {
      presentationIndex: point.presentationIndex,
      timeSeconds,
      noseX: point.noseX,
      noseY: point.noseY,
      state: 'outside',
      holeIndex: null,
      distancePixels: null,
      headHoleAlignment: null,
      noseLeadPixels: null,
      withinEntryRadius: false,
      withinSustainRadius: false,
    };
  }

  /*
   * Nose is spatially near a hole but head direction
   * does not pass the investigation criterion.
   */
  if (
    nearestAlignment === null ||
    nearestAlignment <
      settings.minimumHeadHoleAlignment
  ) {
    return {
      presentationIndex: point.presentationIndex,
      timeSeconds,
      noseX: point.noseX,
      noseY: point.noseY,
      state: 'near-but-misaligned',
      holeIndex: nearestHoleIndex,
      distancePixels: nearestDistance,
      headHoleAlignment: nearestAlignment,
      noseLeadPixels: null,
      withinEntryRadius:
        nearestWithinEntryRadius,
      withinSustainRadius: true,
    };
  }

  /*
   * Aligned and inside the outer sustain ROI.
   *
   * withinEntryRadius tells the event state machine
   * whether this observation may START an event.
   */
  return {
    presentationIndex: point.presentationIndex,
    timeSeconds,
    noseX: point.noseX,
    noseY: point.noseY,
    state: 'investigating',
    holeIndex: nearestHoleIndex,
    distancePixels: nearestDistance,
    headHoleAlignment: nearestAlignment,
    noseLeadPixels: nearestNoseLead,
    withinEntryRadius:
      nearestWithinEntryRadius,
    withinSustainRadius: true,
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
const entryTriggerObservations =
  evidence.filter(
    (item) =>
      item.state === 'investigating' &&
      item.withinEntryRadius,
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
    !observation.withinEntryRadius ||
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
  const isPositive =
    observation.state === 'investigating' &&
    observation.holeIndex !== null;

  /*
   * NO ACTIVE EVENT:
   * entering only the outer sustain zone cannot
   * start an investigation.
   */
  if (candidate === null) {
    if (
      isPositive &&
      observation.withinEntryRadius
    ) {
      candidate =
        createCandidate(observation);
    }

    continue;
  }

  /*
   * ACTIVE EVENT, SAME HOLE:
   * once triggered, aligned observations anywhere
   * inside the sustain radius may keep it alive.
   */
  if (
    isPositive &&
    observation.holeIndex ===
      candidate.holeIndex
  ) {
    const gap =
      observation.timeSeconds -
      candidate.lastPositive.timeSeconds;

    if (
      gap >
      settings.maximumInterruptionSeconds +
        epsilon
    ) {
      finishCandidate(candidate);
      candidate = null;

      if (observation.withinEntryRadius) {
        candidate =
          createCandidate(observation);
      }

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
   * ACTIVE EVENT, DIFFERENT HOLE:
   * the new hole takes over only after its inner
   * entry radius has been reached.
   */
  if (
    isPositive &&
    observation.holeIndex !==
      candidate.holeIndex &&
    observation.withinEntryRadius
  ) {
    finishCandidate(candidate);

    candidate =
      createCandidate(observation);

    continue;
  }

  /*
   * Outside, unknown, misaligned, or sustain-only
   * evidence at another hole counts as interruption.
   */
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

/*
 * Flush one event that remains active at trial end.
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
      proximityPositiveObservations,
      alignmentRejectedObservations,
      entryTriggerObservations,

      candidateEventCount,
      acceptedEventCount:
        events.length,

      rejectedShortEventCount,
    },

    settings,
  };
}