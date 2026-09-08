/**
 * Unit tests for exact media-time conversion helpers.
 *
 * Inputs:
 * - Known RationalTime values, including a fractional-frame-rate timestamp.
 *
 * Outputs:
 * - Assertions that seconds, WebCodecs microseconds, and elapsed-time conversions preserve expected timing behavior.
 *
 * Main coverage:
 * - Validates timeToSeconds(), timeToWebCodecsMicroseconds(), and elapsedSeconds().
 */
import { describe, expect, it } from 'vitest';
import { elapsedSeconds, timeToSeconds, timeToWebCodecsMicroseconds } from './time';

describe('media time helpers', () => {
  it('preserves the 15000/1001 timing rather than treating it as 15 fps', () => {
    // At 15000/1001 frames/s, frame 450 begins at exactly 30.03 seconds.
    const frame450 = { ticks: 450 * 1001, timescale: 15000 };
    expect(timeToSeconds(frame450)).toBeCloseTo(30.03, 12);
    expect(timeToWebCodecsMicroseconds(frame450)).toBe(30030000);
  });
  it('computes elapsed time directly in a common source timebase', () => {
    const start = { ticks: 1001, timescale: 15000 };
    const end = { ticks: 450450, timescale: 15000 };
    expect(elapsedSeconds(start, end)).toBeCloseTo((450450 - 1001) / 15000, 12);
  });
  it('rejects an invalid timescale', () => {
    expect(() => timeToSeconds({ ticks: 1, timescale: 0 })).toThrow(/timescale/i);
  });
});
