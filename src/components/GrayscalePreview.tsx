/**
 * Display component for representative decoded grayscale video frames.
 *
 * Inputs:
 * - RepresentativeFrame containing grayscale pixels, source timing, and intensity statistics.
 *
 * Outputs:
 * - Canvas image with frame timing and intensity summary metadata.
 *
 * Main component:
 * - GrayscalePreview renders one representative frame without modifying its source pixel data.
 */
import { useEffect, useRef } from 'react';
import type { RepresentativeFrame } from '../models/tracking';

interface Props {
  frame: RepresentativeFrame;
}
export default function GrayscalePreview({ frame, }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas)
      return;
    canvas.width =
      frame.width;
    canvas.height =
      frame.height;
    const context = canvas.getContext('2d');
    if (!context)
      return;
    const rgba = new Uint8ClampedArray(frame.width *
      frame.height *
      4);
    for (let sourceIndex = 0; sourceIndex <
      frame.pixels.length; sourceIndex += 1) {
      const value = frame.pixels[sourceIndex];
      const destinationIndex = sourceIndex * 4;
      rgba[destinationIndex] =
        value;
      rgba[destinationIndex + 1] = value;
      rgba[destinationIndex + 2] = value;
      rgba[destinationIndex + 3] = 255;
    }
    const image = new ImageData(rgba, frame.width, frame.height);
    context.putImageData(image, 0, 0);
  }, [frame]);
  return (<figure className="frame-preview">
    <canvas ref={canvasRef} aria-label={`Decoded grayscale frame ${frame.decodedIndex}`} />

    <figcaption>
      <strong>
        Frame {frame.decodedIndex}
      </strong>

      {' · '}

      PTS{' '}
      {(frame.timing.pts.ticks /
        frame.timing.pts.timescale).toFixed(3)}
      {' s'}

      <br />

      Intensity mean:{' '}
      {frame.stats.mean.toFixed(1)}

      {' · '}

      range:{' '}
      {frame.stats.minimum}
      –
      {frame.stats.maximum}
    </figcaption>
  </figure>);
}
