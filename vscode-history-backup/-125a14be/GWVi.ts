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
async function copyNativeLuma(
  frame: VideoFrame,
): Promise<GrayscalePixels> {
  const format = frame.format;

  /*
   * These are 8-bit YUV formats where plane 0 is
   * full-resolution luminance (Y), one byte per pixel.
   */
  const supportedNativeFormats = new Set([
    'I420',
    'NV12',
    'I422',
    'I444',
  ]);

  if (
    !format ||
    !supportedNativeFormats.has(format)
  ) {
    throw new Error(
      `Native frame format ${
        format ?? 'unknown'
      } does not expose a supported 8-bit Y plane.`,
    );
  }

  /*
   * copyTo() defaults to the frame's visibleRect.
   * Use those dimensions rather than assuming that
   * codedWidth/codedHeight contain no padding.
   */
  const visibleRect = frame.visibleRect;
const width =
  visibleRect?.width ?? frame.codedWidth;

const height =
  visibleRect?.height ?? frame.codedHeight;

  /*
   * IMPORTANT:
   *
   * Do NOT specify:
   *
   *   { format: frame.format }
   *
   * Chrome only supports explicit copy conversion to
   * RGB-family formats. With no format parameter,
   * WebCodecs copies the native YUV representation.
   */
  const allocationSize =
    frame.allocationSize();

  const source =
    new Uint8Array(allocationSize);

  const layouts =
    await frame.copyTo(source);

  /*
   * I420, NV12, I422 and I444 all place the
   * full-resolution Y plane first.
   */
  const yPlane = layouts[0];

  if (!yPlane) {
    throw new Error(
      `${format} frame did not provide a luminance plane.`,
    );
  }

  const pixels =
    new Uint8Array(
      width * height,
    );

  /*
   * Never assume stride === width.
   * Hardware decoders may pad each row.
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
  const format = frame.format;

  const nativeLumaFormats = new Set([
    'I420',
    'NV12',
    'I422',
    'I444',
  ]);

  if (
    format &&
    nativeLumaFormats.has(format)
  ) {
    try {
      return await copyNativeLuma(
        frame,
      );
    } catch (error) {
      console.warn(
        '[Barnes tracking] Native luma extraction failed; ' +
          'using RGBA fallback.',
        {
          format,
          error,
        },
      );
    }
  }

  return copyRgbaAsGrayscale(
    frame,
  );
}