/**
 * Side-by-side visualization of raw and smoothed analysis trajectories.
 *
 * Inputs:
 * - ProcessedTrajectory and BackgroundModel.
 *
 * Outputs:
 * - Canvas comparisons that preserve trajectory segment breaks and mark start/end positions for QC.
 *
 * Main component:
 * - TrajectoryComparisonView samples display points and renders raw versus smoothed paths on the maze background.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { AnalysisTrajectoryPoint, BackgroundModel, ProcessedTrajectory } from '../models/tracking';

interface Props {
  processedTrajectory: ProcessedTrajectory;
  background: BackgroundModel;
}

function sampleAnalysisPoints(points: AnalysisTrajectoryPoint[], intervalSeconds = 0.1): AnalysisTrajectoryPoint[] {
  const sampled: AnalysisTrajectoryPoint[] = [];
  let lastTime: number | null = null;
  const epsilon = 1e-6;
  for (const point of points) {
    if (lastTime === null ||
      point.timeSeconds - lastTime >= intervalSeconds - epsilon) {
      sampled.push(point);
      lastTime = point.timeSeconds;
    }
  }
  return sampled;
}

function drawGrayscale(canvas: HTMLCanvasElement, background: BackgroundModel) {
  canvas.width = background.width;
  canvas.height = background.height;
  const context = canvas.getContext('2d');
  if (!context)
    return;
  const rgba = new Uint8ClampedArray(background.width * background.height * 4);
  for (let i = 0; i < background.pixels.length; i += 1) {
    const value = background.pixels[i];
    const destination = i * 4;
    rgba[destination] = value;
    rgba[destination + 1] = value;
    rgba[destination + 2] = value;
    rgba[destination + 3] = 255;
  }
  context.putImageData(new ImageData(rgba, background.width, background.height), 0, 0);
}

function drawTrajectoryCanvas(
  canvas: HTMLCanvasElement,
  background: BackgroundModel,
  points: AnalysisTrajectoryPoint[],
) {
  drawGrayscale(canvas, background);
  const context = canvas.getContext('2d');
  if (!context)
    return;
  const path = new Path2D();
  let previous: AnalysisTrajectoryPoint | null = null;
  for (const point of points) {
    if (!previous) {
      path.moveTo(point.x, point.y);
      previous = point;
      continue;
    }
    if (point.segmentId !== previous.segmentId ||
      point.timeSeconds <= previous.timeSeconds) {
      path.moveTo(point.x, point.y);
    }
    else {
      path.lineTo(point.x, point.y);
    }
    previous = point;
  }
  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = 2.5;
  context.strokeStyle = 'white';
  context.stroke(path);
  context.lineWidth = 1;
  context.strokeStyle = 'black';
  context.stroke(path);
  const first = points[0];
  const last = points.at(-1);
  if (first) {
    context.lineWidth = 3;
    context.beginPath();
    context.arc(first.x, first.y, 7, 0, Math.PI * 2);
    context.stroke();
  }
  if (last) {
    const size = 12;
    context.lineWidth = 3;
    context.strokeRect(last.x - size / 2, last.y - size / 2, size, size);
  }
  context.restore();
}
export default function TrajectoryComparisonView({ processedTrajectory, background, }: Props) {
  /*
   * ALL HOOKS ARE HERE, inside the React component
   * and before any return.
  */
  const rawCanvasRef = useRef<HTMLCanvasElement>(null);
  const smoothedCanvasRef = useRef<HTMLCanvasElement>(null);
  const rawDisplayPoints = useMemo(() => sampleAnalysisPoints(processedTrajectory.raw, 0.1), [processedTrajectory.raw]);
  const smoothedDisplayPoints = useMemo(() => sampleAnalysisPoints(processedTrajectory.smoothed, 0.1), [processedTrajectory.smoothed]);
  useEffect(() => {
    const rawCanvas = rawCanvasRef.current;
    const smoothedCanvas = smoothedCanvasRef.current;
    if (rawCanvas) {
      drawTrajectoryCanvas(rawCanvas, background, rawDisplayPoints);
    }
    if (smoothedCanvas) {
      drawTrajectoryCanvas(smoothedCanvas, background, smoothedDisplayPoints);
    }
  }, [
    background,
    rawDisplayPoints,
    smoothedDisplayPoints,
  ]);
  return (<section className="card" aria-labelledby="trajectory-comparison-heading">
    <h2 id="trajectory-comparison-heading">
      Raw vs smoothed trajectory
    </h2>

    <p>
      Both plots use the same temporal median background and
      identical display sampling. Smoothing changes spatial
      coordinates only; source timestamps are preserved.
    </p>

    <div className="trajectory-comparison-grid">
      <figure>
        <h3>Raw analysis trajectory</h3>

        <canvas ref={rawCanvasRef} className="calibration-canvas" aria-label="Raw mouse trajectory" />

        <figcaption>
          {rawDisplayPoints.length.toLocaleString()} displayed points
        </figcaption>
      </figure>

      <figure>
        <h3>Smoothed analysis trajectory</h3>

        <canvas ref={smoothedCanvasRef} className="calibration-canvas" aria-label="Smoothed mouse trajectory" />

        <figcaption>
          {smoothedDisplayPoints.length.toLocaleString()} displayed points
        </figcaption>
      </figure>
    </div>

    <dl className="metadata-grid">
      <div>
        <dt>Raw observations</dt>
        <dd>{processedTrajectory.raw.length.toLocaleString()}</dd>
      </div>

      <div>
        <dt>Smoothed observations</dt>
        <dd>{processedTrajectory.smoothed.length.toLocaleString()}</dd>
      </div>

      <div>
        <dt>Median correction</dt>
        <dd>
          {processedTrajectory.qc.medianSmoothingCorrectionPixels.toFixed(2)} px
        </dd>
      </div>

      <div>
        <dt>95th percentile correction</dt>
        <dd>
          {processedTrajectory.qc.p95SmoothingCorrectionPixels.toFixed(2)} px
        </dd>
      </div>
    </dl>
  </section>);
}
