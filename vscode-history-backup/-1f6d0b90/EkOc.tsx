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
      calibration: ArenaCalibration,
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
}

  return (
    <section>
      <h2>Arena calibration</h2>

      {/* Canvas and calibration controls go here */}
    </section>
  );
  
}