import type {
  ArenaCalibration,
  RepresentativeFrame,
} from '../models/tracking';

interface Props {
  frame: RepresentativeFrame;

  calibration:
    ArenaCalibration | null;

  onCalibrationChange:
    (
      calibration: ArenaCalibration,
    ) => void;
}

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
  // Component logic will go here.

  return (
    <section>
      <h2>Arena calibration</h2>

      {/* Canvas and calibration controls go here */}
    </section>
  );
  
}