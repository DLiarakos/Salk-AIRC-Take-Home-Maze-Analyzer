import { useEffect,useRef } from 'react';

import type {
  BackgroundModel,
  HoleGeometry,
  HoleInvestigationResult,
  HoleInvestigationSettings,
} from '../models/tracking';

interface Props {
  background: BackgroundModel;
  geometry: HoleGeometry;
  result: HoleInvestigationResult;
  settings: HoleInvestigationSettings;
}

function drawGrayscale(
  canvas: HTMLCanvasElement,
  background: BackgroundModel,
) {
  canvas.width = background.width;
  canvas.height = background.height;

  const context =
    canvas.getContext('2d');

  if (!context) return;

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

    const offset = i * 4;

    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }

  context.putImageData(
    new ImageData(
      rgba,
      background.width,
      background.height,
    ),
    0,
    0,
  );
}

export default function HoleInvestigationPreview({
  background,
  geometry,
  result,
  settings,
}: Props) {
  const canvasRef =
    useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) return;

    drawGrayscale(
      canvas,
      background,
    );

    const context =
      canvas.getContext('2d');

    if (!context) return;

    context.save();

    for (const hole of geometry.holes) {
      /*
       * Physical/calibrated hole ROI.
       */
      context.lineWidth =
        hole.isTarget ? 3 : 1;

      context.setLineDash([4,3]);

      context.beginPath();

      context.arc(
        hole.centerX,
        hole.centerY,
        hole.radiusPixels,
        0,
        Math.PI * 2,
      );

      context.stroke();

    

      context.stroke();

      context.font =
        '12px sans-serif';

      context.fillText(
        hole.isTarget
          ? 'T'
          : String(hole.index),

        hole.centerX + 4,
        hole.centerY - 4,
      );
      /*
        * Inner trigger ROI.
        */
        context.setLineDash([]);
        context.lineWidth =
        hole.isTarget ? 2.5 : 1.5;

        context.beginPath();

        context.arc(
        hole.centerX,
        hole.centerY,
        hole.radiusPixels +
            settings.entryMarginPixels,
        0,
        Math.PI * 2,
        );

        context.stroke();

        /*
        * Outer sustain ROI.
        */
        context.setLineDash([7,4]);
        context.lineWidth =
        hole.isTarget ? 2 : 1;

        context.beginPath();

        context.arc(
        hole.centerX,
        hole.centerY,
        hole.radiusPixels +
            settings.sustainMarginPixels,
        0,
        Math.PI * 2,
        );

        context.stroke();

        context.setLineDash([]);
    }

    /*
     * Mark the closest nose position
     * from each accepted event.
     */
    for (const event of result.events) {
      context.beginPath();

      context.arc(
        event.closestNoseX,
        event.closestNoseY,
        4,
        0,
        Math.PI * 2,
      );

      context.fill();

      context.fillText(
        String(event.eventIndex + 1),

        event.closestNoseX + 6,
        event.closestNoseY - 5,
      );
    }

    context.restore();
  }, [
    background,
    geometry,
    result,
    settings,
  ]);

  return (
    <section className="card">
      <h2>
        Hole investigation preview
      </h2>

      <p>
        Dashed circles show calibrated hole ROIs.
        Outer circles show the effective investigation
        radius. Numbered markers indicate accepted
        investigation events.
      </p>

      <canvas
        ref={canvasRef}
        className="calibration-canvas"
        aria-label="Detected hole investigation events"
      />
    </section>
  );
}