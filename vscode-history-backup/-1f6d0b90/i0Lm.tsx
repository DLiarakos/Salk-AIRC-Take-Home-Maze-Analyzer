import {
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  ArenaCalibration,
  RepresentativeFrame,
} from '../models/tracking';
import {
  createArenaCalibration,
} from '../calibration/arena';

interface Props {
  frame: RepresentativeFrame;

  calibration:
    ArenaCalibration | null;

  onCalibrationChange:
    (
      calibration: ArenaCalibration | null,
    ) => void;
}
const canvasRef =
  useRef<HTMLCanvasElement>(null);

const [
  centerPoint,
  setCenterPoint,
] = useState<{
  x: number;
  y: number;
} | null>(null);
function canvasCoordinates(
  event: React.PointerEvent<HTMLCanvasElement>,
): {
  x: number;
  y: number;
} {
  const canvas =
    event.currentTarget;

  const rect =
    canvas.getBoundingClientRect();

  return {
    x:
      (
        event.clientX -
        rect.left
      ) *
      (
        canvas.width /
        rect.width
      ),

    y:
      (
        event.clientY -
        rect.top
      ) *
      (
        canvas.height /
        rect.height
      ),
  };
}


export default function ArenaCalibrationView({
  frame,
  calibration,
  onCalibrationChange,
}: Props) {
  function handleCanvasPointerDown(
  event: React.PointerEvent<HTMLCanvasElement>,
) {
    const canvasRef =
  useRef<HTMLCanvasElement>(null);

const [
  centerPoint,
  setCenterPoint,
] = useState<{
  x: number;
  y: number;
} | null>(null);
  const point =
    canvasCoordinates(event);

  // First click: maze center.
  if (centerPoint === null) {
    setCenterPoint(point);
    return;
  }

  // Second click: platform edge.
  const newCalibration =
    createArenaCalibration(
      frame.width,
      frame.height,
      centerPoint,
      point,
      {
        trackingMarginPixels: 12,
        platformDiameterCm: null,
      },
    );

  onCalibrationChange(
    newCalibration,
  );
  useEffect(() => {
  const canvas =
    canvasRef.current;

  if (!canvas) return;

  canvas.width =
    frame.width;

  canvas.height =
    frame.height;

  const context =
    canvas.getContext('2d');

  if (!context) return;

  // Convert grayscale pixels to RGBA for display.
  const rgba =
    new Uint8ClampedArray(
      frame.width *
      frame.height *
      4,
    );

  for (
    let i = 0;
    i < frame.pixels.length;
    i += 1
  ) {
    const value =
      frame.pixels[i];

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

  const imageData =
    new ImageData(
      rgba,
      frame.width,
      frame.height,
    );

  context.putImageData(
    imageData,
    0,
    0,
  );

  // Draw center while waiting for second click.
  if (centerPoint) {
    context.beginPath();

    context.arc(
      centerPoint.x,
      centerPoint.y,
      5,
      0,
      Math.PI * 2,
    );

    context.stroke();
  }

  if (calibration) {
    // Physical platform boundary.
    context.beginPath();

    context.arc(
      calibration.centerX,
      calibration.centerY,
      calibration.platformRadiusPixels,
      0,
      Math.PI * 2,
    );

    context.lineWidth = 3;
    context.stroke();

    // Tracking boundary.
    context.save();

    context.setLineDash([
      8,
      6,
    ]);

    context.beginPath();

    context.arc(
      calibration.centerX,
      calibration.centerY,
      calibration.platformRadiusPixels +
        calibration.trackingMarginPixels,
      0,
      Math.PI * 2,
    );

    context.lineWidth = 2;
    context.stroke();

    context.restore();
  }
}, [
  frame,
  calibration,
  centerPoint,
]);
}

return (
  <section className="card">
    <h2>Arena calibration</h2>

    {!centerPoint && !calibration && (
      <p>
        Select the center of the Barnes maze.
      </p>
    )}

    {centerPoint && !calibration && (
      <p>
        Now select a point on the outer edge
        of the circular platform.
      </p>
    )}

    {calibration && (
      <p>
        Arena calibration created. Adjust the
        values below if needed.
      </p>
    )}

    <canvas
      ref={canvasRef}
      onPointerDown={
        handleCanvasPointerDown
      }
      aria-label="Barnes maze arena calibration"
      className="calibration-canvas"
    />
    <button
  type="button"
  onClick={() => {
    setCenterPoint(null);
    onCalibrationChange(null);
  }}
  disabled={
    calibration === null &&
    centerPoint === null
  }
>
  Reset calibration
</button>
  </section>
);
  
}