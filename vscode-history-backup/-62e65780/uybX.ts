import { describe, expect, it } from 'vitest';

import type { FrameTiming } from '../models/media';

import {
  validateFrameTimings,
} from './timingValidation';

describe('validateFrameTimings', () => {
  it('recognizes 15000/1001 timing', () => {
    const frames: FrameTiming[] =
      Array.from(
        { length: 741 },
        (_, index) => ({
          sampleIndex: index,
          presentationIndex: index,

          pts: {
            ticks: 2002 + index * 1001,
            timescale: 15000,
          },

          dts: {
            ticks: index * 1001,
            timescale: 15000,
          },

          duration: {
            ticks: 1001,
            timescale: 15000,
          },

          webCodecsTimestampUs:
            Math.round(
              (
                (2002 + index * 1001) *
                1_000_000
              ) /
                15000,
            ),

          isKeyFrame: index === 0,
        }),
      );

    const result =
      validateFrameTimings(
        frames,
        741,
        741,
        15000,
      );

    expect(result.valid).toBe(true);

    expect(
      result.uniquePtsCount,
    ).toBe(741);

    expect(
      result.duplicatePtsCount,
    ).toBe(0);

    expect(
      result.medianFrameIntervalTicks,
    ).toBe(1001);

    expect(
      result.minimumFrameIntervalTicks,
    ).toBe(1001);

    expect(
      result.maximumFrameIntervalTicks,
    ).toBe(1001);

    expect(
      result.isConstantFrameRate,
    ).toBe(true);

    expect(
      result.equivalentFps,
    ).toBeCloseTo(
      15000 / 1001,
      10,
    );
  });
});