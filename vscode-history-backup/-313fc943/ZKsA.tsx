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
        if (hole.manuallyAdjusted) {
            /*
            * Show where the automatic prediction originally was.
            */
            context.save();

            context.setLineDash([3,3]);

            context.beginPath();
            context.moveTo(
                hole.automaticCenterX,
                hole.automaticCenterY,
            );

            context.lineTo(
                hole.centerX,
                hole.centerY,
            );

            context.stroke();

            context.setLineDash([]);

            /*
            * Small cross marks the original automatic center.
            */
            const markerSize = 3;

            context.beginPath();

            context.moveTo(
                hole.automaticCenterX - markerSize,
                hole.automaticCenterY,
            );

            context.lineTo(
                hole.automaticCenterX + markerSize,
                hole.automaticCenterY,
            );

            context.moveTo(
                hole.automaticCenterX,
                hole.automaticCenterY - markerSize,
            );

            context.lineTo(
                hole.automaticCenterX,
                hole.automaticCenterY + markerSize,
            );

            context.stroke();

            context.restore();
            }
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

function handlePointerDown(
  event: ReactPointerEvent<HTMLCanvasElement>,
) {
  const point = canvasCoordinates(event);

  /*
   * Calibration stage:
   * collect the four homography anchors.
   */
  if (anchors.length < 4) {
    const quarter = holeCount / 4;

    if (!Number.isInteger(quarter)) return;

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

    return;
  }

  /*
   * Manual-adjustment stage:
   * find the ROI closest to the pointer.
   */
  if (!geometry) return;

  let closestHole = geometry.holes[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const hole of geometry.holes) {
    const distance = Math.hypot(
      point.x - hole.centerX,
      point.y - hole.centerY,
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      closestHole = hole;
    }
  }

  /*
   * Require the click to be reasonably close to the ROI.
   */
  const selectionRadius =
    closestHole.radiusPixels + 8;

  if (closestDistance > selectionRadius) return;

  setDraggedHoleIndex(closestHole.index);

  dragOffsetRef.current = {
    x: point.x - closestHole.centerX,
    y: point.y - closestHole.centerY,
  };

  event.currentTarget.setPointerCapture(
    event.pointerId,
  );
}
function handlePointerMove(
  event: ReactPointerEvent<HTMLCanvasElement>,
) {
  if (
    draggedHoleIndex === null ||
    !geometry
  ) {
    return;
  }

  const point =
    canvasCoordinates(event);

  const nextX =
    point.x - dragOffsetRef.current.x;

  const nextY =
    point.y - dragOffsetRef.current.y;

  onGeometryChange({
    ...geometry,

    holes: geometry.holes.map((hole) =>
      hole.index === draggedHoleIndex
        ? {
            ...hole,
            centerX: nextX,
            centerY: nextY,
            manuallyAdjusted: true,
          }
        : hole,
    ),
  });
}
function handlePointerUp(
  event: ReactPointerEvent<HTMLCanvasElement>,
) {
  if (draggedHoleIndex === null) return;

  setDraggedHoleIndex(null);

  if (
    event.currentTarget.hasPointerCapture(
      event.pointerId,
    )
  ) {
    event.currentTarget.releasePointerCapture(
      event.pointerId,
    );
  }
}
function handlePointerCancel() {
  setDraggedHoleIndex(null);
}
function updateHoleRadius(value: number) {
  setHoleRadiusPixels(value);

  if (!geometry) return;

  onGeometryChange({
    ...geometry,
    holeRadiusPixels: value,

    holes: geometry.holes.map((hole) => ({
      ...hole,
      radiusPixels: value,
    })),
  });
}
function restoreHole(index: number) {
  if (!geometry) return;

  onGeometryChange({
    ...geometry,

    holes: geometry.holes.map((hole) =>
      hole.index === index
        ? {
            ...hole,
            centerX: hole.automaticCenterX,
            centerY: hole.automaticCenterY,
            manuallyAdjusted: false,
          }
        : hole,
    ),
  });
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
    min="4"
    step="1"
    value={holeCount}
    onChange={(event) => {
      const value = Number(event.target.value);

      setHoleCount(value);
      setAnchors([]);
      setDraggedHoleIndex(null);
      onGeometryChange(null);
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
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  onPointerCancel={handlePointerCancel}

  style={{
    touchAction: 'none',
    cursor:
      draggedHoleIndex !== null
        ? 'grabbing'
        : geometry
          ? 'grab'
          : 'crosshair',
  }}

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
{geometry && (
  <p>
    <strong>Manually adjusted ROIs:</strong>{' '}
    {
      geometry.holes.filter(
        (hole) => hole.manuallyAdjusted,
      ).length
    }
    {' / '}
    {geometry.holes.length}
  </p>
)}
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