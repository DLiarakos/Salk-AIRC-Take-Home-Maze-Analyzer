/**
 * Arena-mask construction and masked-image diagnostics.
 *
 * Inputs:
 * - ArenaCalibration plus grayscale pixel arrays.
 *
 * Outputs:
 * - Binary ArenaMask, masked intensity statistics, and preview pixels with the outside region replaced.
 *
 * Main functions:
 * - createArenaMask() rasterizes the calibrated tracking boundary.
 * - calculateMaskedIntensityStats() summarizes pixels inside the mask.
 * - applyArenaMaskForPreview() produces a display copy without altering source pixels.
 */
import type { ArenaCalibration } from '../models/tracking';
import { getTrackingRadius } from '../calibration/arena';

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

export interface MaskedIntensityStats {
  minimum: number;
  maximum: number;
  mean: number;
  standardDeviation: number;
}

export function calculateMaskedIntensityStats(pixels: Uint8Array, mask: ArenaMask): MaskedIntensityStats {
  if (pixels.length !==
    mask.data.length) {
    throw new Error('Image and arena mask dimensions do not match.');
  }
  let count = 0;
  let sum = 0;
  let minimum = 255;
  let maximum = 0;
  for (let i = 0; i < pixels.length; i += 1) {
    if (mask.data[i] === 0) {
      continue;
    }
    const value = pixels[i];
    minimum =
      Math.min(minimum, value);
    maximum =
      Math.max(maximum, value);
    sum += value;
    count += 1;
  }
  if (count === 0) {
    return {
      minimum: 0,
      maximum: 0,
      mean: 0,
      standardDeviation: 0,
    };
  }
  const mean = sum / count;
  let varianceSum = 0;
  for (let i = 0; i < pixels.length; i += 1) {
    if (mask.data[i] === 0) {
      continue;
    }
    const difference = pixels[i] - mean;
    varianceSum +=
      difference * difference;
  }
  return {
    minimum,
    maximum,
    mean,
    standardDeviation: Math.sqrt(varianceSum / count),
  };
}

export function createArenaMask(calibration: ArenaCalibration): ArenaMask {
  const { imageWidth: width, imageHeight: height, centerX, centerY, } = calibration;
  const radius = getTrackingRadius(calibration);
  const radiusSquared = radius * radius;
  const data = new Uint8Array(width * height);
  let insidePixelCount = 0;
  for (let y = 0; y < height; y += 1) {
    const dy = y - centerY;
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const distanceSquared = dx * dx +
        dy * dy;
      if (distanceSquared <=
        radiusSquared) {
        data[y * width + x] = 1;
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

export function applyArenaMaskForPreview(grayscale: Uint8Array, mask: ArenaMask, outsideValue = 0): Uint8Array {
  if (grayscale.length !==
    mask.data.length) {
    throw new Error('Grayscale image and arena mask have different dimensions.');
  }
  const result = new Uint8Array(grayscale.length);
  for (let i = 0; i < grayscale.length; i += 1) {
    result[i] =
      mask.data[i] === 1
        ? grayscale[i]
        : outsideValue;
  }
  return result;
}
