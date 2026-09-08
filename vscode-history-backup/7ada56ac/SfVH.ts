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

  return {
    width: grayscale.width,
    height: grayscale.height,
    pixels: grayscale.pixels,
    timing,
    decodedIndex,
    stats: grayscale.stats,
  };
}