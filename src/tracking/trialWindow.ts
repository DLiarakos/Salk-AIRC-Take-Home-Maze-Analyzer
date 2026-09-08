/**
 * Automatic trial-start detection from sustained body visibility.
 *
 * Inputs:
 * - BodyTrack and TrialWindowSettings specifying the minimum continuous presence duration.
 *
 * Outputs:
 * - TrialWindow beginning at the first qualifying sustained detection, or null when no valid start is found.
 *
 * Main function:
 * - detectTrialStart() scans presentation-ordered observations using exact source PTS for elapsed-time validation.
 */
import type { BodyTrack, TrialWindow, TrialWindowSettings } from '../models/tracking';

function ptsSeconds(ticks: number, timescale: number): number {
  return ticks / timescale;
}

export function detectTrialStart(track: BodyTrack, settings: TrialWindowSettings): TrialWindow | null {
  const points = track.points;
  for (let startIndex = 0; startIndex < points.length; startIndex += 1) {
    const start = points[startIndex];
    if (start.x === null ||
      start.y === null) {
      continue;
    }
    const startSeconds = ptsSeconds(start.pts.ticks, start.pts.timescale);
    /*
     * Walk forward until either:
     *
     * 1. detection disappears, or
     * 2. sustained detection reaches the
     *    required amount of real time.
    */
    for (let endIndex = startIndex; endIndex <
      points.length; endIndex += 1) {
      const point = points[endIndex];
      if (point.x === null ||
        point.y === null) {
        break;
      }
      const elapsed = ptsSeconds(point.pts.ticks, point.pts.timescale) -
        startSeconds;
      if (elapsed >=
        settings.minimumPresenceSeconds) {
        return {
          startPresentationIndex: start.presentationIndex,
          startPts: start.pts,
          /*
           * Trial end/escape are determined
           * separately by downstream analysis.
          */
          endPresentationIndex: null,
          endPts: null,
        };
      }
    }
  }
  return null;
}
