import { useEffect,useRef,useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type {
  ArenaCalibration,
  BackgroundModel,
  HoleGeometry,
} from '../models/tracking';

import { createHoleGeometry } from '../calibration/holes';

interface Props {
  background: BackgroundModel;
  arena: ArenaCalibration;
  geometry: HoleGeometry | null;
  onGeometryChange: (geometry: HoleGeometry | null) => void;
}

function canvasCoordinates(
  event: ReactPointerEvent<HTMLCanvasElement>,
) {
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function drawBackground(
  canvas: HTMLCanvasElement,
  background: BackgroundModel,
) {
  canvas.width = background.width;
  canvas.height = background.height;

  const context = canvas.getContext('2d');
  if (!context) return;

  const rgba = new Uint8ClampedArray(
    background.width * background.height * 4,
  );

  for (let i = 0; i < background.pixels.length; i += 1) {
    const value = background.pixels[i];
    const offset = i * 4;

    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }

  context.putImageData(
    new ImageData(rgba,background.width,background.height),
    0,
    0,
  );
}

export default function HoleCalibrationView({
  background,
  arena,
  geometry,
  onGeometryChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

const [holeCount,setHoleCount] = useState(20);
const [holeRadiusPixels,setHoleRadiusPixels] = useState(12);

const [anchors,setAnchors] =
  useState<Array<{index:number;x:number;y:number}>>([]);
  
const [draggedHoleIndex,setDraggedHoleIndex] =
  useState<number | null>(null);

const dragOffsetRef = useRef({
  x: 0,
  y: 0,
});
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawBackground(canvas,background);

    const context = canvas.getContext('2d');
    if (!context) return;

    context.save();

    if (geometry) {
      for (const hole of geometry.holes) {
        context.lineWidth = hole.isTarget ? 4 : 2;

        if (!hole.isTarget) {
          context.setLineDash([5,4]);
        } else {
          context.setLineDash([]);
        }

        context.beginPath();
        context.arc(
          hole.centerX,
          hole.centerY,
          hole.radiusPixels,
          0,
          Math.PI * 2,
        );
        context.stroke();

        context.setLineDash([]);
        context.font = '14px sans-serif';
        context.fillText(
          hole.isTarget ? 'T' : String(hole.index),
          hole.centerX + hole.radiusPixels + 3,
          hole.centerY,
        );
      }
    }

    context.restore();
  }, [background,geometry]);
useEffect(() => {
  if (anchors.length !== 4) return;

  onGeometryChange(
    createHoleGeometry(
      anchors,
      holeCount,
      holeRadiusPixels,
    ),
  );
}, [
  anchors,
  holeCount,
  holeRadiusPixels,
  onGeometryChange,
]);
function handlePointerDown(
  event: ReactPointerEvent<HTMLCanvasElement>,
) {
  if (anchors.length >= 4) return;

  const point = canvasCoordinates(event);

  const quarter = holeCount / 4;

  if (!Number.isInteger(quarter)) {
    return;
  }

  const anchorIndices = [
    0,
    quarter,
    quarter * 2,
    quarter * 3,
  ];

  const nextAnchors = [
    ...anchors,
    {
      index: anchorIndices[anchors.length],
      x: point.x,
      y: point.y,
    },
  ];

  setAnchors(nextAnchors);

  if (nextAnchors.length === 4) {
    onGeometryChange(
      createHoleGeometry(
        nextAnchors,
        holeCount,
        holeRadiusPixels,
      ),
    );
  }
}

  function updateHoleRadius(value: number) {
  setHoleRadiusPixels(value);
}

  return (
    <section className="card">
      <h2>Hole geometry</h2>

{anchors.length === 0 && (
  <p>
    Step 1 of 4: Select the center of the target hole
    (Hole 0).
  </p>
)}

{anchors.length === 1 && (
  <p>
    Step 2 of 4: Select the hole one quarter-turn
    clockwise from the target (Hole 5 on a 20-hole maze).
  </p>
)}

{anchors.length === 2 && (
  <p>
    Step 3 of 4: Select the hole directly opposite
    the target (Hole 10 on a 20-hole maze).
  </p>
)}

{anchors.length === 3 && (
  <p>
    Step 4 of 4: Select the hole three quarters of
    a turn clockwise from the target
    (Hole 15 on a 20-hole maze).
  </p>
)}

{anchors.length === 4 && geometry && (
  <p>
    Hole geometry created. Verify that every ROI is
    centered over its corresponding physical hole.
  </p>
)}


      <div className="calibration-controls">
        <label>
          <span>Number of holes</span>
          <input
            type="number"
            min="1"
            step="1"
            value={holeCount}
             onChange={(event) => {
            setHoleCount(Number(event.target.value));
            }}
          />
        </label>

        <label>
          <span>Hole ROI radius</span>
          <input
            type="number"
            min="1"
            step="1"
            value={holeRadiusPixels}
            onChange={(event) =>
              updateHoleRadius(Number(event.target.value))
            }
          />
          <span>px</span>
        </label>
      </div>

      <canvas
        ref={canvasRef}
        className="calibration-canvas"
        onPointerDown={handlePointerDown}
        aria-label="Barnes maze hole and target calibration"
      />

      {geometry && (
        <>
           <p>
    <strong>Target hole:</strong> Hole 0
    {' · '}
    <strong>Hole count:</strong>{' '}
    {geometry.holes.length}
    {' · '}
    <strong>Hole ROI radius:</strong>{' '}
    {geometry.holeRadiusPixels.toFixed(1)} px
  </p>

         <button
  type="button"
  onClick={() => {
    setAnchors([]);
    onGeometryChange(null);
  }}
>
  Reset hole calibration
</button>
        </>
      )}
    </section>
  );
}