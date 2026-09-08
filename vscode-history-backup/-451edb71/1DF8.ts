import type {
  ArenaMask,
} from './arenaMask';

import type {
  BackgroundModel,
  BackgroundSample,
  SegmentationResult,
  SegmentationSettings,
  ComponentAnalysis,
  ForegroundComponent
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
export function segmentDarkForeground(
  currentPixels: Uint8Array,
  background: BackgroundModel,
  arenaMask: ArenaMask,
  settings: SegmentationSettings,
): SegmentationResult {
  const pixelCount =
    background.width *
    background.height;

  if (
    currentPixels.length !==
    pixelCount
  ) {
    throw new Error(
      'Current frame dimensions do not match background model.',
    );
  }

  if (
    arenaMask.data.length !==
    pixelCount
  ) {
    throw new Error(
      'Arena mask dimensions do not match background model.',
    );
  }

  const difference =
    new Uint8Array(
      pixelCount,
    );

  const foregroundMask =
    new Uint8Array(
      pixelCount,
    );

  let foregroundPixelCount = 0;

  for (
    let i = 0;
    i < pixelCount;
    i += 1
  ) {
    /*
     * Pixels outside the calibrated arena never
     * participate in segmentation.
     */
    if (
      arenaMask.data[i] === 0
    ) {
      continue;
    }

    /*
     * One-sided difference.
     *
     * Positive means the current frame became
     * darker than the static background.
     */
    const delta =
      background.pixels[i] -
      currentPixels[i];

    const darkDifference =
      Math.max(
        0,
        delta,
      );

    difference[i] =
      darkDifference;

    if (
      darkDifference >=
      settings.differenceThreshold
    ) {
      foregroundMask[i] = 1;
      foregroundPixelCount += 1;
    }
  }

  return {
    width: background.width,
    height: background.height,
    difference,
    foregroundMask,
    foregroundPixelCount,
  };
}
export function findForegroundComponents(
  foregroundMask: Uint8Array,
  width: number,
  height: number,
  minimumAreaPixels: number,
): ComponentAnalysis {
  const pixelCount =
    width * height;

  if (
    foregroundMask.length !==
    pixelCount
  ) {
    throw new Error(
      'Foreground mask dimensions do not match.',
    );
  }

  const visited =
    new Uint8Array(pixelCount);

  const components:
    ForegroundComponent[] = [];

  let componentId = 0;

  /*
   * 8-connectivity:
   *
   * A foreground pixel can connect horizontally,
   * vertically, or diagonally.
   */
  const neighborOffsets = [
    [-1, -1],
    [0, -1],
    [1, -1],

    [-1, 0],
    [1, 0],

    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  for (
    let startIndex = 0;
    startIndex < pixelCount;
    startIndex += 1
  ) {
    if (
      foregroundMask[startIndex] === 0 ||
      visited[startIndex] === 1
    ) {
      continue;
    }

    const stack: number[] = [
      startIndex,
    ];

    visited[startIndex] = 1;

    const componentPixels:
      number[] = [];

    let sumX = 0;
    let sumY = 0;

    let minX = width;
    let minY = height;

    let maxX = 0;
    let maxY = 0;

    while (
      stack.length > 0
    ) {
      const index =
        stack.pop();

      if (
        index === undefined
      ) {
        break;
      }

      componentPixels.push(
        index,
      );

      const y =
        Math.floor(
          index / width,
        );

      const x =
        index -
        y * width;

      sumX += x;
      sumY += y;

      minX =
        Math.min(
          minX,
          x,
        );

      minY =
        Math.min(
          minY,
          y,
        );

      maxX =
        Math.max(
          maxX,
          x,
        );

      maxY =
        Math.max(
          maxY,
          y,
        );

      for (
        const [
          dx,
          dy,
        ] of neighborOffsets
      ) {
        const nx =
          x + dx;

        const ny =
          y + dy;

        if (
          nx < 0 ||
          nx >= width ||
          ny < 0 ||
          ny >= height
        ) {
          continue;
        }

        const neighborIndex =
          ny * width + nx;

        if (
          foregroundMask[
            neighborIndex
          ] === 0 ||
          visited[
            neighborIndex
          ] === 1
        ) {
          continue;
        }

        visited[
          neighborIndex
        ] = 1;

        stack.push(
          neighborIndex,
        );
      }
    }

    const areaPixels =
      componentPixels.length;

    components.push({
      id: componentId,
      areaPixels,

      centroidX:
        sumX / areaPixels,

      centroidY:
        sumY / areaPixels,

      minX,
      minY,
      maxX,
      maxY,

      pixelIndices:
        componentPixels,
    });

    componentId += 1;
  }

  const retainedComponents =
    components
      .filter(
        (component) =>
          component.areaPixels >=
          minimumAreaPixels,
      )
      .sort(
        (a, b) =>
          b.areaPixels -
          a.areaPixels,
      );

  return {
    components,

    retainedComponents,

    largestComponent:
      retainedComponents[0] ??
      null,
  };
}