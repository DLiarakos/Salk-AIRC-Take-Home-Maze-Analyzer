import type {
  FinalReviewedHoleInvestigationEvent,
  TrialWindow,
} from '../models/tracking';

export interface BarnesPrimaryMetrics {
  targetInvestigationFound: boolean;

  primaryLatencySeconds:
    number | null;

  primaryErrorCount:
    number | null;

  uniqueIncorrectHoleCount:
    number | null;

  repeatedIncorrectInvestigationCount:
    number | null;

  observedNonTargetInvestigationCount:
    number;
  primaryErrorEvents:
    FinalReviewedHoleInvestigationEvent[];
  firstTargetEvent:
    FinalReviewedHoleInvestigationEvent | null;
}

function trialStartSeconds(
  trialWindow: TrialWindow,
): number {
  return (
    trialWindow.startPts.ticks /
    trialWindow.startPts.timescale
  );
}

export function computeBarnesPrimaryMetrics(
  events:
    FinalReviewedHoleInvestigationEvent[],

  trialWindow: TrialWindow,
): BarnesPrimaryMetrics {
  /*
   * Do not assume the incoming array is already
   * perfectly ordered. Preserve the original array
   * and sort a copy by scientific source ordering.
   */
  const orderedEvents =
    [...events].sort(
      (a,b) =>
        a.startPresentationIndex -
          b.startPresentationIndex ||
        a.eventIndex -
          b.eventIndex,
    );

  const firstTargetEvent =
    orderedEvents.find(
      (event) =>
        event.isTarget,
    ) ?? null;

  const observedNonTargetInvestigationCount =
    orderedEvents.filter(
      (event) =>
        !event.isTarget,
    ).length;

  /*
   * If the target was never investigated,
   * primary latency/errors are right-censored
   * rather than silently assigning the end of
   * the video as the behavioral endpoint.
   */
  if (!firstTargetEvent) {
    return {
      targetInvestigationFound:
        false,

      primaryLatencySeconds:
        null,

      primaryErrorCount:
        null,

      uniqueIncorrectHoleCount:
        null,

      repeatedIncorrectInvestigationCount:
        null,

      observedNonTargetInvestigationCount,
      primaryErrorEvents: [],

      firstTargetEvent:
        null,
    };
  }

  const startSeconds =
    trialStartSeconds(
      trialWindow,
    );

  const primaryLatencySeconds =
    Math.max(
      0,

      firstTargetEvent
        .startTimeSeconds -
        startSeconds,
    );

  /*
   * Only incorrect-hole events whose onset
   * precedes the first included target-hole
   * investigation count as primary errors.
   */
  const errorsBeforeTarget =
    orderedEvents.filter(
      (event) =>
        !event.isTarget &&
        event.startPresentationIndex <
          firstTargetEvent
            .startPresentationIndex,
    );

  const uniqueIncorrectHoles =
    new Set(
      errorsBeforeTarget.map(
        (event) =>
          event.holeIndex,
      ),
    );

  const primaryErrorCount =
    errorsBeforeTarget.length;

  const uniqueIncorrectHoleCount =
    uniqueIncorrectHoles.size;

  return {
    targetInvestigationFound:
      true,

    primaryLatencySeconds,

    primaryErrorCount,

    uniqueIncorrectHoleCount,

    repeatedIncorrectInvestigationCount:
      primaryErrorCount -
      uniqueIncorrectHoleCount,

    observedNonTargetInvestigationCount,
    primaryErrorEvents:
  errorsBeforeTarget,

    firstTargetEvent,
  };
}