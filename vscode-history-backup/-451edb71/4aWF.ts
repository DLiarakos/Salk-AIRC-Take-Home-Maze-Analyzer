import type {
  ArenaMask,
} from './arenaMask';

import type {
  BackgroundModel,
  BackgroundSample,
  SegmentationResult,
  SegmentationSettings,
} from '../models/tracking';

export function buildTemporalMedianBackground(
  samples: BackgroundSample[],
  width: number,
  height: number,
): BackgroundModel {
  if (samples.length === 0) {
    throw new Error(
      'Cannot create a background model without sample frames.',
    );
  }

  const pixelCount =
    width * height;

  for (const sample of samples) {
    if (
      sample.pixels.length !==
      pixelCount
    ) {
      throw new Error(
        'Background sample dimensions do not match.',
      );
    }
  }

  const background =
    new Uint8Array(pixelCount);

  /*
   * Reuse one small array rather than allocating
   * a new array for every image pixel.
   */
  const values =
    new Uint8Array(
      samples.length,
    );

  const medianIndex =
    Math.floor(
      samples.length / 2,
    );

  for (
    let pixelIndex = 0;
    pixelIndex < pixelCount;
    pixelIndex += 1
  ) {
    for (
      let sampleIndex = 0;
      sampleIndex < samples.length;
      sampleIndex += 1
    ) {
      values[sampleIndex] =
        samples[
          sampleIndex
        ].pixels[pixelIndex];
    }

    /*
     * samples.length is deliberately small
     * (~21), so sorting this tiny buffer is
     * acceptable for the prototype.
     */
    values.sort();

    background[pixelIndex] =
      values[medianIndex];
  }

  return {
    width,
    height,
    pixels: background,
    sampleCount: samples.length,
  };
}