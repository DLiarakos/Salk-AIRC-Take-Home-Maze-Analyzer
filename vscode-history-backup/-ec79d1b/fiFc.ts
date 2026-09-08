import type {
  BodyTrack,
  BodyTrackPoint,
  EscapeCandidate,
  EscapeDetectionSettings,
  FinalReviewedHoleInvestigationEvent,
  HoleGeometry,
} from '../models/tracking';

function pointSeconds(
  point: BodyTrackPoint,
): number {
  return (
    point.pts.ticks /
    point.pts.timescale
  );
}

function isDetected(
  point: BodyTrackPoint,
): boolean {
  return (
    point.x !== null &&
    point.y !== null
  );
}

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

function makeCandidateKey(
  kind: string,
  targetHoleIndex: number,
  escapePresentationIndex: number,
): string {
  return [
    'escape-v2',
    kind,
    targetHoleIndex,
    escapePresentationIndex,
  ].join(':');
}

export function detectEscapeCandidate(
  track: BodyTrack,

  geometry: HoleGeometry,

  events:
    FinalReviewedHoleInvestigationEvent[],

  settings:
    EscapeDetectionSettings,
): EscapeCandidate | null {
  if (
    track.points.length === 0
  ) {
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

  const points =
    [...track.points].sort(
      (a,b) =>
        a.presentationIndex -
        b.presentationIndex,
    );

  const targetEvents =
    events
      .filter(
        (event) =>
          event.isTarget,
      )
      .sort(
        (a,b) =>
          a.startPresentationIndex -
          b.startPresentationIndex,
      );

  const recordingEndPoint =
    points.at(-1)!;

  const recordingEndTime =
    pointSeconds(
      recordingEndPoint,
    );

  const escapeRadiusPixels =
    targetHole.radiusPixels +
    settings.escapeProximityMarginPixels;

  /*
   * --------------------------------------------------
   * STEP 1:
   * Find terminal disappearance independently of
   * investigation-event classification.
   * --------------------------------------------------
   */
  let lastDetectedIndex = -1;

  for (
    let index =
      points.length - 1;

    index >= 0;

    index -= 1
  ) {
    if (
      isDetected(
        points[index],
      )
    ) {
      lastDetectedIndex =
        index;

      break;
    }
  }

  const hasTerminalMissingRun =
    lastDetectedIndex >= 0 &&
    lastDetectedIndex <
      points.length - 1;

  if (hasTerminalMissingRun) {
    const lastDetected =
      points[
        lastDetectedIndex
      ];

    const firstMissing =
      points[
        lastDetectedIndex + 1
      ];

    const lastDetectedTime =
      pointSeconds(
        lastDetected,
      );

    const firstMissingTime =
      pointSeconds(
        firstMissing,
      );

    const terminalAbsenceSeconds =
      Math.max(
        0,
        recordingEndTime -
        lastDetectedTime,
      );

    if (
      terminalAbsenceSeconds >=
      settings.minimumTerminalAbsenceSeconds
    ) {
      /*
       * Examine reliable observations immediately
       * BEFORE disappearance.
       */
      const lookbackStartTime =
        firstMissingTime -
        settings.escapeLookbackSeconds;

      const lookbackPoints =
        points.filter(
          (point) => {
            const time =
              pointSeconds(point);

            return (
              time >=
                lookbackStartTime &&
              time <=
                lastDetectedTime &&
              isDetected(point)
            );
          },
        );

      let minimumNoseDistance:
        number | null = null;

      let minimumBodyDistance:
        number | null = null;

      for (
        const point of
        lookbackPoints
      ) {
        if (
          point.x !== null &&
          point.y !== null
        ) {
          const bodyDistance =
            distance(
              point.x,
              point.y,
              targetHole.centerX,
              targetHole.centerY,
            );

          if (
            minimumBodyDistance ===
              null ||
            bodyDistance <
              minimumBodyDistance
          ) {
            minimumBodyDistance =
              bodyDistance;
          }
        }

        if (
          point.noseX !== null &&
          point.noseY !== null
        ) {
          const noseDistance =
            distance(
              point.noseX,
              point.noseY,
              targetHole.centerX,
              targetHole.centerY,
            );

          if (
            minimumNoseDistance ===
              null ||
            noseDistance <
              minimumNoseDistance
          ) {
            minimumNoseDistance =
              noseDistance;
          }
        }
      }

      const spatiallyNearTarget =
        (
          minimumNoseDistance !==
            null &&
          minimumNoseDistance <=
            escapeRadiusPixels
        ) ||
        (
          minimumBodyDistance !==
            null &&
          minimumBodyDistance <=
            escapeRadiusPixels
        );

      /*
       * Find the most recent INCLUDED target
       * investigation preceding disappearance.
       */
      const precedingTargetEvent =
        [...targetEvents]
          .reverse()
          .find(
            (event) =>
              event.endTimeSeconds <=
              firstMissingTime,
          ) ?? null;

      const targetEventGap =
        precedingTargetEvent
          ? (
              firstMissingTime -
              precedingTargetEvent
                .endTimeSeconds
            )
          : null;

      /*
       * STRONG:
       *
       * Sustained terminal disappearance AND
       * reliable spatial proximity to the target.
       *
       * This does not require the strict
       * investigation detector to remain positive.
       */
      if (spatiallyNearTarget) {
        return {
          candidateKey:
            makeCandidateKey(
              'terminal-disappearance-at-target',
              targetHole.index,
              firstMissing
                .presentationIndex,
            ),

          kind:
            'terminal-disappearance-at-target',

          evidenceStrength:
            'strong',

          targetHoleIndex:
            targetHole.index,

          targetEventIndex:
            precedingTargetEvent
              ?.eventIndex ??
            null,

          targetEventStartTimeSeconds:
            precedingTargetEvent
              ?.startTimeSeconds ??
            null,

          targetEventEndTimeSeconds:
            precedingTargetEvent
              ?.endTimeSeconds ??
            null,

          escapePresentationIndex:
            firstMissing
              .presentationIndex,

          escapeTimeSeconds:
            firstMissingTime,

          lastDetectedPresentationIndex:
            lastDetected
              .presentationIndex,

          lastDetectedTimeSeconds:
            lastDetectedTime,

          firstMissingPresentationIndex:
            firstMissing
              .presentationIndex,

          firstMissingTimeSeconds:
            firstMissingTime,

          recordingEndPresentationIndex:
            recordingEndPoint
              .presentationIndex,

          recordingEndTimeSeconds:
            recordingEndTime,

          terminalAbsenceSeconds,

          secondsFromTargetEndToCandidate:
            targetEventGap,

          minimumNoseDistanceToTargetPixels:
            minimumNoseDistance,

          minimumBodyDistanceToTargetPixels:
            minimumBodyDistance,

          escapeRadiusPixels,
        };
      }

      /*
       * MODERATE:
       *
       * Sustained terminal disappearance with no
       * sufficiently close reliable final position,
       * but an accepted target investigation occurred
       * shortly before disappearance.
       *
       * This catches cases where segmentation degrades
       * while the mouse is physically entering.
       */
      if (
        precedingTargetEvent &&
        targetEventGap !== null &&
        targetEventGap >= 0 &&
        targetEventGap <=
          settings
            .maximumSecondsFromTargetEndToDisappearance
      ) {
        return {
          candidateKey:
            makeCandidateKey(
              'target-associated-terminal-disappearance',
              targetHole.index,
              firstMissing
                .presentationIndex,
            ),

          kind:
            'target-associated-terminal-disappearance',

          evidenceStrength:
            'moderate',

          targetHoleIndex:
            targetHole.index,

          targetEventIndex:
            precedingTargetEvent
              .eventIndex,

          targetEventStartTimeSeconds:
            precedingTargetEvent
              .startTimeSeconds,

          targetEventEndTimeSeconds:
            precedingTargetEvent
              .endTimeSeconds,

          escapePresentationIndex:
            firstMissing
              .presentationIndex,

          escapeTimeSeconds:
            firstMissingTime,

          lastDetectedPresentationIndex:
            lastDetected
              .presentationIndex,

          lastDetectedTimeSeconds:
            lastDetectedTime,

          firstMissingPresentationIndex:
            firstMissing
              .presentationIndex,

          firstMissingTimeSeconds:
            firstMissingTime,

          recordingEndPresentationIndex:
            recordingEndPoint
              .presentationIndex,

          recordingEndTimeSeconds:
            recordingEndTime,

          terminalAbsenceSeconds,

          secondsFromTargetEndToCandidate:
            targetEventGap,

          minimumNoseDistanceToTargetPixels:
            minimumNoseDistance,

          minimumBodyDistanceToTargetPixels:
            minimumBodyDistance,

          escapeRadiusPixels,
        };
      }
    }
  }

  /*
   * --------------------------------------------------
   * STEP 2:
   * Weak fallback for recordings that terminate
   * immediately after a target investigation.
   * --------------------------------------------------
   *
   * This does NOT claim that disappearance occurred.
   */
  const finalTargetEvent =
    targetEvents.at(-1);

  if (finalTargetEvent) {
    const gapToRecordingEnd =
      recordingEndTime -
      finalTargetEvent
        .endTimeSeconds;

    if (
      gapToRecordingEnd >= 0 &&
      gapToRecordingEnd <=
        settings
          .maximumSecondsFromTargetEndToRecordingEnd
    ) {
      return {
        candidateKey:
          makeCandidateKey(
            'target-near-recording-end',
            targetHole.index,
            finalTargetEvent
              .endPresentationIndex,
          ),

        kind:
          'target-near-recording-end',

        evidenceStrength:
          'weak',

        targetHoleIndex:
          targetHole.index,

        targetEventIndex:
          finalTargetEvent
            .eventIndex,

        targetEventStartTimeSeconds:
          finalTargetEvent
            .startTimeSeconds,

        targetEventEndTimeSeconds:
          finalTargetEvent
            .endTimeSeconds,

        escapePresentationIndex:
          finalTargetEvent
            .endPresentationIndex,

        escapeTimeSeconds:
          finalTargetEvent
            .endTimeSeconds,

        lastDetectedPresentationIndex:
          null,

        lastDetectedTimeSeconds:
          null,

        firstMissingPresentationIndex:
          null,

        firstMissingTimeSeconds:
          null,

        recordingEndPresentationIndex:
          recordingEndPoint
            .presentationIndex,

        recordingEndTimeSeconds:
          recordingEndTime,

        terminalAbsenceSeconds:
          0,

        secondsFromTargetEndToCandidate:
          0,

        minimumNoseDistanceToTargetPixels:
          null,

        minimumBodyDistanceToTargetPixels:
          null,

        escapeRadiusPixels,
      };
    }
  }

  return null;
}