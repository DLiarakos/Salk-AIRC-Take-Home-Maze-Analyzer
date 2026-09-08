/**
 * Arena calibration geometry and physical-scale utilities.
 *
 * Inputs:
 * - Source image dimensions, user-selected maze center/edge points, and optional physical diameter/margin settings.
 *
 * Outputs:
 * - ArenaCalibration geometry, tracking radius, pixel-to-centimeter conversions, and point-in-arena tests.
 *
 * Main functions:
 * - createArenaCalibration() builds calibrated platform geometry from two image points.
 * - getTrackingRadius(), pixelsPerCm(), and pixelsToCm() expose derived spatial measurements.
 * - isPointInsideArena() tests whether a point lies within the calibrated analysis boundary.
 */
import type { ArenaCalibration, Point2D } from '../models/tracking';

export function distanceBetween(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function createArenaCalibration(
  imageWidth: number,
  imageHeight: number,
  center: Point2D,
  edge: Point2D,
  options?: {
    trackingMarginPixels?: number;
    platformDiameterCm?: number | null;
  },
): ArenaCalibration {
  const platformRadiusPixels = distanceBetween(center, edge);
  if (!Number.isFinite(platformRadiusPixels) ||
    platformRadiusPixels <= 0) {
    throw new Error('Arena radius must be greater than zero.');
  }
  if (imageWidth <= 0 ||
    imageHeight <= 0) {
    throw new Error('Image dimensions must be positive.');
  }
  return {
    imageWidth,
    imageHeight,
    centerX: center.x,
    centerY: center.y,
    platformRadiusPixels,
    trackingMarginPixels: options?.trackingMarginPixels ?? 0,
    platformDiameterCm: options?.platformDiameterCm ?? null,
  };
}

export function getTrackingRadius(calibration: ArenaCalibration): number {
  return (calibration.platformRadiusPixels +
    calibration.trackingMarginPixels);
}

export function pixelsPerCm(calibration: ArenaCalibration): number | null {
  const diameterCm = calibration.platformDiameterCm;
  if (diameterCm === null ||
    diameterCm <= 0) {
    return null;
  }
  return (calibration.platformRadiusPixels * 2) / diameterCm;
}

export function pixelsToCm(pixels: number, calibration: ArenaCalibration): number | null {
  const scale = pixelsPerCm(calibration);
  if (scale === null) {
    return null;
  }
  return pixels / scale;
}

export function isPointInsideArena(
  x: number,
  y: number,
  calibration: ArenaCalibration,
  includeTrackingMargin = true,
): boolean {
  const radius = includeTrackingMargin
    ? getTrackingRadius(calibration)
    : calibration.platformRadiusPixels;
  const dx = x - calibration.centerX;
  const dy = y - calibration.centerY;
  return (dx * dx +
    dy * dy <=
    radius * radius);
}
