/**
 * Exact rational-time validation and conversion helpers for source video timestamps.
 *
 * Inputs:
 * - RationalTime values expressed as integer ticks and timescale.
 *
 * Outputs:
 * - Validated seconds/microsecond conversions and elapsed-time values without replacing authoritative source timing.
 *
 * Main functions:
 * - assertValidTime(), timeToSeconds(), timeToWebCodecsMicroseconds(), and elapsedSeconds().
 */
import type { RationalTime } from '../models/media';

const MICROSECONDS_PER_SECOND = 1000000;
export function assertValidTime(time: RationalTime): void {
  if (!Number.isSafeInteger(time.ticks)) {
    throw new Error(`Media timestamp is not a safe integer: ${time.ticks}`);
  }
  if (!Number.isSafeInteger(time.timescale) || time.timescale <= 0) {
    throw new Error(`Invalid media timescale: ${time.timescale}`);
  }
}

export function timeToSeconds(time: RationalTime): number {
  assertValidTime(time);
  return time.ticks / time.timescale;
}
/**
 * WebCodecs timestamps are integer microseconds. We round only at the WebCodecs
 * boundary; the original integer track timestamp remains authoritative.
*/
export function timeToWebCodecsMicroseconds(time: RationalTime): number {
  assertValidTime(time);
  return Math.round((time.ticks * MICROSECONDS_PER_SECOND) / time.timescale);
}

export function elapsedSeconds(start: RationalTime, end: RationalTime): number {
  assertValidTime(start);
  assertValidTime(end);
  if (start.timescale === end.timescale) {
    return (end.ticks - start.ticks) / start.timescale;
  }
  return timeToSeconds(end) - timeToSeconds(start);
}
