import type {
  FrameTiming,
} from '../models/media';

import type {
  RepresentativeFrame,
} from '../models/tracking';

import {
  copyGrayscale,
} from './grayscale';

export async function processRepresentativeFrame(
  frame: VideoFrame,
  timing: FrameTiming,
  decodedIndex: number,
): Promise<RepresentativeFrame> {
  const grayscale =
    await copyGrayscale(frame);
    console.log(
  '[Barnes tracking] native pixel format',
  {
    decodedIndex,
    format: frame.format,
    width: frame.codedWidth,
    height: frame.codedHeight,
  },
);
  return {
    width: grayscale.width,
    height: grayscale.height,
    pixels: grayscale.pixels,
    timing,
    decodedIndex,
    stats: grayscale.stats,
  };
}