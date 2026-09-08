import type {
  GrayscaleStats,
} from '../models/tracking';

export interface GrayscalePixels {
  width: number;
  height: number;
  pixels: Uint8Array;
  stats: GrayscaleStats;
}

function calculateStats(
  pixels: Uint8Array,
): GrayscaleStats {
  if (pixels.length === 0) {
    return {
      minimum: 0,
      maximum: 0,
      mean: 0,
      standardDeviation: 0,
    };
  }

  let minimum = 255;
  let maximum = 0;
  let sum = 0;

  for (const value of pixels) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    sum += value;
  }

  const mean = sum / pixels.length;

  let varianceSum = 0;

  for (const value of pixels) {
    const difference = value - mean;
    varianceSum += difference * difference;
  }

  return {
    minimum,
    maximum,
    mean,

    standardDeviation: Math.sqrt(
      varianceSum / pixels.length,
    ),
  };
}

/**
 * Extract the luminance plane from a decoded VideoFrame.
 *
 * Barnes maze source videos are grayscale encoded as YUV420,
 * so the Y plane already contains the image information we need.
 */
async function copyI420Luma(
  frame: VideoFrame,
): Promise<GrayscalePixels> {
  const width = frame.codedWidth;
  const height = frame.codedHeight;

  const options: VideoFrameCopyToOptions = {
    format: 'I420',
  };

  const allocationSize =
    frame.allocationSize(options);

  const source =
    new Uint8Array(allocationSize);

  const layouts =
    await frame.copyTo(
      source,
      options,
    );

  const yPlane = layouts[0];

  if (!yPlane) {
    throw new Error(
      'WebCodecs did not provide an I420 luminance plane.',
    );
  }

  const pixels =
    new Uint8Array(width * height);

  /*
   * Do not assume plane stride === image width.
   *
   * Browsers are allowed to pad rows internally.
   */
  for (
    let row = 0;
    row < height;
    row += 1
  ) {
    const sourceStart =
      yPlane.offset +
      row * yPlane.stride;

    const sourceEnd =
      sourceStart + width;

    const destinationStart =
      row * width;

    pixels.set(
      source.subarray(
        sourceStart,
        sourceEnd,
      ),
      destinationStart,
    );
  }

  return {
    width,
    height,
    pixels,
    stats: calculateStats(pixels),
  };
}

/**
 * RGB fallback for browsers/devices that cannot request I420
 * output from VideoFrame.copyTo().
 */
async function copyRgbaAsGrayscale(
  frame: VideoFrame,
): Promise<GrayscalePixels> {
  const width = frame.codedWidth;
  const height = frame.codedHeight;

  const options: VideoFrameCopyToOptions = {
    format: 'RGBA',
  };

  const allocationSize =
    frame.allocationSize(options);

  const rgba =
    new Uint8Array(allocationSize);

  const layouts =
    await frame.copyTo(
      rgba,
      options,
    );

  const layout = layouts[0];

  if (!layout) {
    throw new Error(
      'WebCodecs did not provide an RGBA plane.',
    );
  }

  const pixels =
    new Uint8Array(width * height);

  for (
    let y = 0;
    y < height;
    y += 1
  ) {
    const rowStart =
      layout.offset +
      y * layout.stride;

    for (
      let x = 0;
      x < width;
      x += 1
    ) {
      const sourceIndex =
        rowStart + x * 4;

      const r = rgba[sourceIndex];
      const g = rgba[sourceIndex + 1];
      const b = rgba[sourceIndex + 2];

      /*
       * Integer approximation of Rec.601 luminance:
       *
       * 0.299 R + 0.587 G + 0.114 B
       */
      pixels[
        y * width + x
      ] =
        (
          77 * r +
          150 * g +
          29 * b
        ) >> 8;
    }
  }

  return {
    width,
    height,
    pixels,
    stats: calculateStats(pixels),
  };
}

export async function copyGrayscale(
  frame: VideoFrame,
): Promise<GrayscalePixels> {
  try {
    return await copyI420Luma(frame);
  } catch (error) {
    console.warn(
      '[Barnes tracking] I420 extraction failed; using RGBA fallback.',
      error,
    );

    return copyRgbaAsGrayscale(frame);
  }
}