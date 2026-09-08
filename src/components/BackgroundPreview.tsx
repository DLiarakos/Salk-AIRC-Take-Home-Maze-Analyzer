import {
  useEffect,
  useRef,
} from 'react';

import type {
  BackgroundModel,
} from '../models/tracking';

interface Props {
  background: BackgroundModel;
}

export default function BackgroundPreview({
  background,
}: Props) {
  const canvasRef =
    useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    canvas.width =
      background.width;

    canvas.height =
      background.height;

    const context =
      canvas.getContext('2d');

    if (!context) {
      return;
    }

    const rgba =
      new Uint8ClampedArray(
        background.width *
        background.height *
        4,
      );

    for (
      let i = 0;
      i < background.pixels.length;
      i += 1
    ) {
      const value =
        background.pixels[i];

      const destination =
        i * 4;

      rgba[destination] =
        value;

      rgba[destination + 1] =
        value;

      rgba[destination + 2] =
        value;

      rgba[destination + 3] =
        255;
    }

    const image =
      new ImageData(
        rgba,
        background.width,
        background.height,
      );

    context.putImageData(
      image,
      0,
      0,
    );
  }, [background]);

  return (
    <section
      className="card"
      aria-labelledby="background-preview-heading"
    >
      <h2 id="background-preview-heading">
        Temporal median background
      </h2>

      <p>
        Background estimated from{' '}
        {background.sampleCount}{' '}
        evenly distributed decoded frames.
      </p>

      <canvas
        ref={canvasRef}
        className="calibration-canvas"
        aria-label="Temporal median background image of the Barnes maze"
      />
    </section>
  );
}