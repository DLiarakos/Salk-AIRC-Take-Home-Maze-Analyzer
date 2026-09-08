import type {
  ArenaCalibration,
} from '../models/tracking';

import {
  getTrackingRadius,
} from '../calibration/arena';

export interface ArenaMask {
  width: number;
  height: number;

  /**
   * 1 = inside arena
   * 0 = outside arena
   */
  data: Uint8Array;

  insidePixelCount: number;
}

export function createArenaMask(
  calibration: ArenaCalibration,
): ArenaMask {
  const {
    imageWidth: width,
    imageHeight: height,
    centerX,
    centerY,
  } = calibration;

  const radius =
    getTrackingRadius(calibration);

  const radiusSquared =
    radius * radius;

  const data =
    new Uint8Array(
      width * height,
    );

  let insidePixelCount = 0;

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const dy =
      y - centerY;

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const dx =
        x - centerX;

      const distanceSquared =
        dx * dx +
        dy * dy;

      if (
        distanceSquared <=
        radiusSquared
      ) {
        data[
          y * width + x
        ] = 1;

        insidePixelCount += 1;
      }
    }
  }

  return {
    width,
    height,
    data,
    insidePixelCount,
  };
}
export function applyArenaMaskForPreview(
  grayscale: Uint8Array,
  mask: ArenaMask,
  outsideValue = 0,
): Uint8Array {
  if (
    grayscale.length !==
    mask.data.length
  ) {
    throw new Error(
      'Grayscale image and arena mask have different dimensions.',
    );
  }

  const result =
    new Uint8Array(
      grayscale.length,
    );

  for (
    let i = 0;
    i < grayscale.length;
    i += 1
  ) {
    result[i] =
      mask.data[i] === 1
        ? grayscale[i]
        : outsideValue;
  }

  return result;
}