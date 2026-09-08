/**
 * Time-weighted spatial occupancy visualization for the analyzed trial.
 *
 * Inputs:
 * - Smoothed ProcessedTrajectory, BackgroundModel, ArenaCalibration,
 *   and HoleGeometry.
 *
 * Outputs:
 * - Canvas heat map showing where the animal spent observed trial time.
 *
 * Main component:
 * - OccupancyHeatMap bins connected trajectory intervals spatially and
 *   weights each bin by elapsed source time rather than observation count.
 * - Missing-data gaps and disconnected trajectory segments contribute no
 *   inferred occupancy.
 */
import { useEffect, useMemo, useRef } from 'react';
import type {
  AnalysisTrajectoryPoint, ArenaCalibration, BackgroundModel, HoleGeometry, ProcessedTrajectory,
} from '../models/tracking';

interface Props {
  processedTrajectory: ProcessedTrajectory;
  background: BackgroundModel;
  calibration: ArenaCalibration;
  holeGeometry: HoleGeometry;
  targetDefined: boolean;
}

interface OccupancyGrid {
  values: Float64Array;
  columns: number;
  rows: number;
  totalObservedSeconds: number;
  occupiedBinCount: number;
  maximumBinSeconds: number;
  displayMaximumSeconds: number;
}

const GRID_COLUMNS = 48;
const GRID_ROWS = 48;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );

  return sorted[index];
}

function drawGrayscale(
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
    const destination = i * 4;

    rgba[destination] = value;
    rgba[destination + 1] = value;
    rgba[destination + 2] = value;
    rgba[destination + 3] = 255;
  }

  context.putImageData(
    new ImageData(rgba, background.width, background.height),
    0,
    0,
  );
}

/*
 * Piecewise Viridis-like sequential palette.
 *
 * Increasing occupancy also generally increases perceived brightness,
 * allowing relative intensity to remain useful when converted to grayscale.
 */
function heatColor(
  normalized: number,
): { r: number; g: number; b: number; a: number } {
  const value = clamp(normalized, 0, 1);

  const anchors = [
    { t: 0.00, r: 68, g: 1, b: 84 },
    { t: 0.25, r: 59, g: 82, b: 139 },
    { t: 0.50, r: 33, g: 145, b: 140 },
    { t: 0.75, r: 94, g: 201, b: 98 },
    { t: 1.00, r: 253, g: 231, b: 37 },
  ];

  let lower = anchors[0];
  let upper = anchors.at(-1) ?? anchors[0];

  for (let i = 1; i < anchors.length; i += 1) {
    if (value <= anchors[i].t) {
      lower = anchors[i - 1];
      upper = anchors[i];
      break;
    }
  }

  const span = Math.max(1e-9, upper.t - lower.t);
  const local = (value - lower.t) / span;

  return {
    r: Math.round(lower.r + (upper.r - lower.r) * local),
    g: Math.round(lower.g + (upper.g - lower.g) * local),
    b: Math.round(lower.b + (upper.b - lower.b) * local),
    a: Math.round(75 + value * 170),
  };
}

function buildOccupancyGrid(
  points: AnalysisTrajectoryPoint[],
  width: number,
  height: number,
): OccupancyGrid {
  const values = new Float64Array(GRID_COLUMNS * GRID_ROWS);
  let totalObservedSeconds = 0;

  /*
   * Each connected trajectory interval contributes its actual elapsed
   * source time to the bin containing the interval midpoint.
   */
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (
      current.segmentId !== previous.segmentId ||
      current.timeSeconds <= previous.timeSeconds
    ) {
      continue;
    }

    const dt = current.timeSeconds - previous.timeSeconds;
    const midpointX = (previous.x + current.x) / 2;
    const midpointY = (previous.y + current.y) / 2;

    const column = clamp(
      Math.floor(midpointX / width * GRID_COLUMNS),
      0,
      GRID_COLUMNS - 1,
    );

    const row = clamp(
      Math.floor(midpointY / height * GRID_ROWS),
      0,
      GRID_ROWS - 1,
    );

    values[row * GRID_COLUMNS + column] += dt;
    totalObservedSeconds += dt;
  }

  const occupiedValues = Array.from(values).filter((value) => value > 0);
  const maximumBinSeconds = occupiedValues.length
    ? Math.max(...occupiedValues)
    : 0;

  /*
   * The 95th percentile limits domination by a single stationary bin.
   * This affects display scaling only, never the accumulated occupancy.
   */
  const displayMaximumSeconds = percentile(occupiedValues, 0.95);

  return {
    values,
    columns: GRID_COLUMNS,
    rows: GRID_ROWS,
    totalObservedSeconds,
    occupiedBinCount: occupiedValues.length,
    maximumBinSeconds,
    displayMaximumSeconds,
  };
}

function drawTargetQuadrant(
  context: CanvasRenderingContext2D,
  calibration: ArenaCalibration,
  holeGeometry: HoleGeometry,
) {
  const targetHole = holeGeometry.holes.find((hole) => hole.isTarget);
  if (!targetHole) return;

  const targetAngle = Math.atan2(
    targetHole.centerY - calibration.centerY,
    targetHole.centerX - calibration.centerX,
  );

  const halfWidth = Math.PI / 4;

  context.save();
  context.strokeStyle = 'rgba(0, 0, 0, 0.70)';
  context.lineWidth = 1.5;
  context.setLineDash([6, 5]);

  context.beginPath();
  context.moveTo(
    calibration.centerX,
    calibration.centerY,
  );
  context.arc(
    calibration.centerX,
    calibration.centerY,
    calibration.platformRadiusPixels,
    targetAngle - halfWidth,
    targetAngle + halfWidth,
  );
  context.closePath();
  context.stroke();

  context.restore();
}

function drawHeatLayer(
  context: CanvasRenderingContext2D,
  grid: OccupancyGrid,
  width: number,
  height: number,
  calibration: ArenaCalibration,
) {
  if (grid.displayMaximumSeconds <= 0) return;

  /*
   * Render into a low-resolution offscreen canvas, then scale it to the
   * source image with interpolation. The underlying occupancy grid remains
   * discrete; interpolation is display-only.
   */
  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = grid.columns;
  heatCanvas.height = grid.rows;

  const heatContext = heatCanvas.getContext('2d');
  if (!heatContext) return;

  const image = heatContext.createImageData(
    grid.columns,
    grid.rows,
  );

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const gridIndex = row * grid.columns + column;
      const occupancySeconds = grid.values[gridIndex];

      if (occupancySeconds <= 0) continue;

      /*
       * Suppress bins whose centers lie outside the physical platform.
       */
      const centerX = (column + 0.5) / grid.columns * width;
      const centerY = (row + 0.5) / grid.rows * height;

      const dx = centerX - calibration.centerX;
      const dy = centerY - calibration.centerY;

      if (
        Math.hypot(dx, dy) >
        calibration.platformRadiusPixels
      ) {
        continue;
      }

      const normalized = Math.min(
        1,
        occupancySeconds / grid.displayMaximumSeconds,
      );

      const color = heatColor(normalized);
      const pixelIndex = gridIndex * 4;

      image.data[pixelIndex] = color.r;
      image.data[pixelIndex + 1] = color.g;
      image.data[pixelIndex + 2] = color.b;
      image.data[pixelIndex + 3] = color.a;
    }
  }

  heatContext.putImageData(image, 0, 0);

  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.drawImage(
    heatCanvas,
    0,
    0,
    width,
    height,
  );

  context.restore();
}

function drawMazeGeometry(
  context: CanvasRenderingContext2D,
  calibration: ArenaCalibration,
  holeGeometry: HoleGeometry,
  targetDefined: boolean,
) {
  context.save();
  context.strokeStyle = '#111';

  context.lineWidth = 2;
  context.beginPath();
  context.arc(
    calibration.centerX,
    calibration.centerY,
    calibration.platformRadiusPixels,
    0,
    Math.PI * 2,
  );
  context.stroke();

  for (const hole of holeGeometry.holes) {
    context.beginPath();
    context.arc(
      hole.centerX,
      hole.centerY,
      hole.radiusPixels,
      0,
      Math.PI * 2,
    );

    context.lineWidth =
      targetDefined && hole.isTarget ? 2.5 : 1;

    context.stroke();
  }

  context.restore();
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  background: BackgroundModel,
  grid: OccupancyGrid,
  calibration: ArenaCalibration,
  holeGeometry: HoleGeometry,
  targetDefined: boolean,
) {
  drawGrayscale(canvas, background);

  const context = canvas.getContext('2d');
  if (!context) return;

  drawHeatLayer(
    context,
    grid,
    background.width,
    background.height,
    calibration,
  );

  if (targetDefined) {
    drawTargetQuadrant(
      context,
      calibration,
      holeGeometry,
    );
  }

  drawMazeGeometry(
    context,
    calibration,
    holeGeometry,
    targetDefined,
  );
}

export default function OccupancyHeatMap({
  processedTrajectory,
  background,
  calibration,
  holeGeometry,
  targetDefined,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /*
   * Use the complete smoothed trajectory rather than display sampling,
   * because occupancy is calculated from source time intervals.
   */
  const occupancyGrid = useMemo(
    () => buildOccupancyGrid(
      processedTrajectory.smoothed,
      background.width,
      background.height,
    ),
    [
      processedTrajectory.smoothed,
      background.width,
      background.height,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawCanvas(
      canvas,
      background,
      occupancyGrid,
      calibration,
      holeGeometry,
      targetDefined,
    );
  }, [
    background,
    calibration,
    holeGeometry,
    occupancyGrid,
    targetDefined,
  ]);

  return (<section
    className="card"
    aria-labelledby="occupancy-heat-map-heading"
  >
    <h2 id="occupancy-heat-map-heading">
      Occupancy heat map
    </h2>

    <p>
      Spatial occupancy is weighted by observed elapsed time rather than
      frame count. Tracking gaps and disconnected trajectory segments add
      no inferred occupancy. Warmer colors indicate greater observed dwell
      time.
    </p>

    <canvas
      ref={canvasRef}
      className="calibration-canvas"
      aria-label="Time-weighted Barnes maze occupancy heat map"
    />

    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
        marginTop: '0.75rem',
      }}
    >
      <strong>Occupancy</strong>

      <span>Low</span>

      <div
        aria-hidden="true"
        style={{
          width: '240px',
          height: '12px',
          border: '1px solid #111',
          background:
            'linear-gradient(90deg, rgb(68, 1, 84), rgb(59, 82, 139), rgb(33, 145, 140), rgb(94, 201, 98), rgb(253, 231, 37))',
        }}
      />

      <span>High</span>

      {targetDefined && (
        <span>Dashed sector = target quadrant</span>
      )}
    </div>

    <dl className="metadata-grid">
      <div>
        <dt>Observed occupancy time</dt>
        <dd>
          {occupancyGrid.totalObservedSeconds.toFixed(3)} s
        </dd>
      </div>

      <div>
        <dt>Occupied spatial bins</dt>
        <dd>
          {occupancyGrid.occupiedBinCount.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>Grid resolution</dt>
        <dd>
          {occupancyGrid.columns} × {occupancyGrid.rows}
        </dd>
      </div>

      <div>
        <dt>95th percentile bin</dt>
        <dd>
          {occupancyGrid.displayMaximumSeconds.toFixed(3)} s
        </dd>
      </div>

      <div>
        <dt>Maximum bin occupancy</dt>
        <dd>
          {occupancyGrid.maximumBinSeconds.toFixed(3)} s
        </dd>
      </div>
    </dl>

    <p>
      <small>
        Display intensity is capped at the 95th percentile occupied bin
        so a single prolonged stop does not visually suppress the rest of
        the search. Underlying occupancy values are not clipped.
      </small>
    </p>
  </section>);
}