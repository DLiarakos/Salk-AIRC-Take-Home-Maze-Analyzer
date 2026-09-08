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
export interface BackgroundSample {
  decodedIndex: number;
  pixels: Uint8Array;
}

export interface BackgroundModel {
  width: number;
  height: number;
  pixels: Uint8Array;
  sampleCount: number;
}

export interface SegmentationSettings {
  /**
   * Minimum amount by which a pixel must become
   * darker than the background to count as foreground.
   */
  differenceThreshold: number;

  /**
   * Ignore connected foreground regions smaller
   * than this many pixels.
   */
  minimumComponentAreaPixels: number;
}

export interface SegmentationResult {
  width: number;
  height: number;

  /**
   * background - current frame, clamped to 0–255.
   */
  difference: Uint8Array;

  /**
   * 0 = background
   * 1 = candidate foreground
   */
  foregroundMask: Uint8Array;

  foregroundPixelCount: number;
}
export interface ForegroundComponent {
  id: number;

  areaPixels: number;

  centroidX: number;
  centroidY: number;

  minX: number;
  minY: number;
  maxX: number;
  maxY: number;

  /**
   * Indices into the flattened width × height image.
   */
  pixelIndices: number[];
}

export interface ComponentAnalysis {
  components: ForegroundComponent[];

  /**
   * Components meeting the configured minimum area.
   */
  retainedComponents: ForegroundComponent[];

  /**
   * Largest retained component, if one exists.
   *
   * For the first prototype this is our mouse candidate.
   */
  largestComponent:
    ForegroundComponent | null;
}
export type BodyVisibility =
  | 'visible'
  | 'partial'
  | 'not-detected';

export interface BodyDetection {
  x: number;
  y: number;

  areaPixels: number;

  minX: number;
  minY: number;
  maxX: number;
  maxY: number;

  visibility: BodyVisibility;

  /**
   * Fraction of all retained foreground pixels
   * belonging to the selected body component.
   */
  dominance: number;
}