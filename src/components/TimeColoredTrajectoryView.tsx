/**
 * Time-colored visualization of the analysis trajectory.
 *
 * Inputs:
 * - ProcessedTrajectory, BackgroundModel, ArenaCalibration, and HoleGeometry.
 *
 * Outputs:
 * - Canvas overlay showing the smoothed analysis trajectory with color
 *   encoding elapsed time from trial start.
 *
 * Main component:
 * - TimeColoredTrajectoryView() renders a time-colored search path while
 *   preserving trajectory segment breaks and contextual maze geometry.
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function drawGrayscale(canvas: HTMLCanvasElement, background: BackgroundModel) {
  canvas.width = background.width;
  canvas.height = background.height;

  const context = canvas.getContext('2d');
  if (!context) return;

  const rgba = new Uint8ClampedArray(background.width * background.height * 4);

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
 * Sample densely enough to preserve smooth temporal color progression,
 * while still avoiding overdraw for long trials.
 */
function sampleAnalysisPoints(
  points: AnalysisTrajectoryPoint[],
  intervalSeconds = 0.05,
): AnalysisTrajectoryPoint[] {
  const sampled: AnalysisTrajectoryPoint[] = [];
  let lastTime: number | null = null;
  let lastSegmentId: number | null = null;
  const epsilon = 1e-6;

  for (const point of points) {
    if (
      lastTime === null ||
      lastSegmentId === null ||
      point.segmentId !== lastSegmentId ||
      point.timeSeconds - lastTime >= intervalSeconds - epsilon
    ) {
      sampled.push(point);
      lastTime = point.timeSeconds;
      lastSegmentId = point.segmentId;
    }
  }

  return sampled;
}

function timeColor(normalized: number): string {
  /*
   * Early path = blue, late path = red.
   * Intermediate hues progress continuously through green/yellow.
   */
  const clamped = clamp(normalized, 0, 1);
  const hue = 220 - clamped * 220;
  return `hsl(${hue}, 85%, 50%)`;
}

function drawTargetQuadrant(
  context: CanvasRenderingContext2D,
  calibration: ArenaCalibration,
  holeGeometry: HoleGeometry,
) {
  const targetHole = holeGeometry.holes.find((hole) => hole.isTarget);
  if (!targetHole) return;

  const centerX = calibration.centerX;
  const centerY = calibration.centerY;
  const radius = calibration.platformRadiusPixels;
  const targetAngle = Math.atan2(
    targetHole.centerY - centerY,
    targetHole.centerX - centerX,
  );
  const halfWidth = Math.PI / 4;

  context.save();
  context.fillStyle = 'rgba(255, 255, 255, 0.20)';
  context.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  context.lineWidth = 1.5;
  context.setLineDash([6, 5]);

  context.beginPath();
  context.moveTo(centerX, centerY);
  context.arc(
    centerX,
    centerY,
    radius,
    targetAngle - halfWidth,
    targetAngle + halfWidth,
  );
  context.closePath();
  context.fill();
  context.stroke();

  context.restore();
}

function drawMazeGeometry(
  context: CanvasRenderingContext2D,
  calibration: ArenaCalibration,
  holeGeometry: HoleGeometry,
  targetDefined: boolean,
) {
  context.save();

  /*
   * Platform boundary.
   */
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

  /*
   * Hole outlines. The target hole is emphasized when target identity
   * is considered defined for downstream target-based metrics.
   */
  for (const hole of holeGeometry.holes) {
    context.beginPath();
    context.arc(
      hole.centerX,
      hole.centerY,
      hole.radiusPixels,
      0,
      Math.PI * 2,
    );

    if (targetDefined && hole.isTarget) {
      context.lineWidth = 2.5;
    } else {
      context.lineWidth = 1;
    }

    context.stroke();
  }

  context.restore();
}

function drawTimeColoredTrajectory(
  context: CanvasRenderingContext2D,
  points: AnalysisTrajectoryPoint[],
) {
  if (points.length === 0) return;

  const startTime = points[0].timeSeconds;
  const endTime = points.at(-1)?.timeSeconds ?? startTime;
  const duration = Math.max(0.001, endTime - startTime);

  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (
      current.segmentId !== previous.segmentId ||
      current.timeSeconds <= previous.timeSeconds
    ) {
      continue;
    }

    const midTime = (previous.timeSeconds + current.timeSeconds) / 2;
    const normalized = (midTime - startTime) / duration;

    /*
     * White halo keeps the colored line visible on both bright and
     * dark portions of the grayscale maze background.
     */
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(current.x, current.y);
    context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    context.lineWidth = 4;
    context.stroke();

    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(current.x, current.y);
    context.strokeStyle = timeColor(normalized);
    context.lineWidth = 2.25;
    context.stroke();
  }

  context.restore();
}

function drawStartEndMarkers(
  context: CanvasRenderingContext2D,
  points: AnalysisTrajectoryPoint[],
) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return;

  context.save();
  context.strokeStyle = '#111';
  context.fillStyle = 'white';
  context.lineWidth = 3;

  /*
   * Start marker.
   */
  context.beginPath();
  context.arc(first.x, first.y, 7, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  /*
   * End marker.
   */
  const size = 12;
  context.strokeRect(
    last.x - size / 2,
    last.y - size / 2,
    size,
    size,
  );

  context.restore();
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  background: BackgroundModel,
  points: AnalysisTrajectoryPoint[],
  calibration: ArenaCalibration,
  holeGeometry: HoleGeometry,
  targetDefined: boolean,
) {
  drawGrayscale(canvas, background);

  const context = canvas.getContext('2d');
  if (!context) return;

  if (targetDefined) {
    drawTargetQuadrant(context, calibration, holeGeometry);
  }

  drawTimeColoredTrajectory(context, points);
  drawMazeGeometry(context, calibration, holeGeometry, targetDefined);
  drawStartEndMarkers(context, points);
}

function formatSeconds(seconds: number | null): string {
  return seconds === null ? 'Unavailable' : `${seconds.toFixed(3)} s`;
}

export default function TimeColoredTrajectoryView({
  processedTrajectory,
  background,
  calibration,
  holeGeometry,
  targetDefined,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const displayPoints = useMemo(
    () => sampleAnalysisPoints(processedTrajectory.smoothed, 0.05),
    [processedTrajectory.smoothed],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawCanvas(
      canvas,
      background,
      displayPoints,
      calibration,
      holeGeometry,
      targetDefined,
    );
  }, [
    background,
    calibration,
    displayPoints,
    holeGeometry,
    targetDefined,
  ]);

  const firstPoint = displayPoints[0] ?? null;
  const lastPoint = displayPoints.at(-1) ?? null;
  const displayedDuration = firstPoint && lastPoint
    ? Math.max(0, lastPoint.timeSeconds - firstPoint.timeSeconds)
    : null;

  return (<section className="card" aria-labelledby="time-colored-trajectory-heading">
    <h2 id="time-colored-trajectory-heading">
      Time-colored search path
    </h2>

    <p>
      The smoothed analysis trajectory is colored by elapsed time from
      trial start. Earlier path segments are cooler, later segments are
      warmer. Segment breaks are preserved and not connected across gaps.
    </p>

    <canvas
      ref={canvasRef}
      className="calibration-canvas"
      aria-label="Time-colored Barnes maze trajectory"
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
      <strong>Time legend</strong>

      <span>Early</span>

      <div
        aria-hidden="true"
        style={{
          width: '240px',
          height: '12px',
          border: '1px solid #111',
          background: 'linear-gradient(90deg, hsl(220, 85%, 50%), hsl(160, 85%, 45%), hsl(60, 90%, 50%), hsl(0, 85%, 50%))',
        }}
      />

      <span>Late</span>
      <span><strong>○</strong> Start</span>
      <span><strong>□</strong> End</span>
      {targetDefined && <span>Dashed sector = target quadrant</span>}
    </div>

    <dl className="metadata-grid">
      <div>
        <dt>Displayed observations</dt>
        <dd>{displayPoints.length.toLocaleString()}</dd>
      </div>

      <div>
        <dt>Displayed segments</dt>
        <dd>{processedTrajectory.qc.segmentCount}</dd>
      </div>

      <div>
        <dt>Start time</dt>
        <dd>{formatSeconds(firstPoint?.timeSeconds ?? null)}</dd>
      </div>

      <div>
        <dt>End time</dt>
        <dd>{formatSeconds(lastPoint?.timeSeconds ?? null)}</dd>
      </div>

      <div>
        <dt>Displayed duration</dt>
        <dd>{formatSeconds(displayedDuration)}</dd>
      </div>
    </dl>
  </section>);
}