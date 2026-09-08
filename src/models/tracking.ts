import type { FrameTiming } from './media';

export interface GrayscaleStats {
  minimum: number;
  maximum: number;
  mean: number;
  standardDeviation: number;
}

export interface RepresentativeFrame {
  width: number;
  height: number;

  /**
   * One byte per pixel:
   * 0 = black
   * 255 = white
   */
  pixels: Uint8Array;

  timing: FrameTiming;

  /**
   * Position in the WebCodecs output sequence.
   * This is for preview/debugging only.
   */
  decodedIndex: number;

  stats: GrayscaleStats;
}
export interface Point2D {
  x: number;
  y: number;
}

export interface ArenaCalibration {
  /**
   * Dimensions of the image this calibration belongs to.
   */
  imageWidth: number;
  imageHeight: number;

  /**
   * Maze/platform center in image pixel coordinates.
   */
  centerX: number;
  centerY: number;

  /**
   * Radius of the physical Barnes maze platform.
   */
  platformRadiusPixels: number;

  /**
   * Extra pixels outside the platform retained for tracking.
   *
   * This is useful because the mouse can partially disappear
   * into holes at the rim.
   */
  trackingMarginPixels: number;

  /**
   * Optional real-world platform diameter.
   * Later used for pixels → centimeters conversion.
   */
  platformDiameterCm: number | null;
}