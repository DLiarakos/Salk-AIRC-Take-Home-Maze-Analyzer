import type {
  BodyTrack,
  BodyTrackPoint,
  EscapeCandidate,
  EscapeDetectionSettings,
  FinalReviewedHoleInvestigationEvent,
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

function candidateKey(
  event:
    FinalReviewedHoleInvestigationEvent,

  kind: string,
): string {
  return [
    'escape',
    kind,
    event.holeIndex,
    event.startPresentationIndex,
    event.endPresentationIndex,
  ].join(':');
}

export function detectEscapeCandidate(
  track: BodyTrack,

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

  /*
   * Escape should be associated with the
   * last included target encounter, not the
   * first target encounter used for primary
   * latency.
   */
  const targetEvent =
    targetEvents.at(-1);

  if (!targetEvent) {
    return null;
  }

  const recordingEndPoint =
    points.at(-1)!;

  const recordingEndTime =
    pointSeconds(
      recordingEndPoint,
    );

  /*
   * Find the final frame in which the mouse
   * was successfully tracked.
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

  /*
   * CASE 1:
   *
   * Mouse becomes untracked after the final
   * target investigation and never appears
   * again before recording termination.
   */
  if (
    lastDetectedIndex >= 0 &&
    lastDetectedIndex <
      points.length - 1
  ) {
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

    const disappearanceTime =
      pointSeconds(
        firstMissing,
      );

    const terminalAbsenceSeconds =
      Math.max(
        0,

        recordingEndTime -
        lastDetectedTime,
      );

    const secondsFromTargetEnd =
      disappearanceTime -
      targetEvent
        .endTimeSeconds;

    if (
      terminalAbsenceSeconds >=
        settings
          .minimumTerminalAbsenceSeconds &&

      secondsFromTargetEnd >= 0 &&

      secondsFromTargetEnd <=
        settings
          .maximumSecondsFromTargetEndToDisappearance
    ) {
      return {
        candidateKey:
          candidateKey(
            targetEvent,
            'terminal-disappearance',
          ),

        kind:
          'terminal-disappearance',

        targetEventIndex:
          targetEvent.eventIndex,

        targetHoleIndex:
          targetEvent.holeIndex,

        targetEventStartTimeSeconds:
          targetEvent.startTimeSeconds,

        targetEventEndTimeSeconds:
          targetEvent.endTimeSeconds,

        /*
         * Operational escape time is the
         * first source timestamp at which
         * terminal disappearance begins.
         */
        escapePresentationIndex:
          firstMissing
            .presentationIndex,

        escapeTimeSeconds:
          disappearanceTime,

        recordingEndPresentationIndex:
          recordingEndPoint
            .presentationIndex,

        recordingEndTimeSeconds:
          recordingEndTime,

        terminalAbsenceSeconds,

        secondsFromTargetEndToCandidate:
          secondsFromTargetEnd,
      };
    }
  }

  /*
   * CASE 2:
   *
   * Some recordings terminate essentially
   * immediately after the final target
   * investigation. There is not enough
   * post-event footage to prove disappearance.
   *
   * This is deliberately only a candidate.
   */
  const targetToRecordingEndSeconds =
    recordingEndTime -
    targetEvent.endTimeSeconds;

  if (
    targetToRecordingEndSeconds >= 0 &&
    targetToRecordingEndSeconds <=
      settings
        .maximumSecondsFromTargetEndToRecordingEnd
  ) {
    return {
      candidateKey:
        candidateKey(
          targetEvent,
          'target-near-recording-end',
        ),

      kind:
        'target-near-recording-end',

      targetEventIndex:
        targetEvent.eventIndex,

      targetHoleIndex:
        targetEvent.holeIndex,

      targetEventStartTimeSeconds:
        targetEvent.startTimeSeconds,

      targetEventEndTimeSeconds:
        targetEvent.endTimeSeconds,

      /*
       * With no visible terminal disappearance,
       * the best operational timestamp is the
       * end of the reviewed target event.
       */
      escapePresentationIndex:
        targetEvent
          .endPresentationIndex,

      escapeTimeSeconds:
        targetEvent
          .endTimeSeconds,

      recordingEndPresentationIndex:
        recordingEndPoint
          .presentationIndex,

      recordingEndTimeSeconds:
        recordingEndTime,

      terminalAbsenceSeconds: 0,

      secondsFromTargetEndToCandidate:
        0,
    };
  }

  return null;
}