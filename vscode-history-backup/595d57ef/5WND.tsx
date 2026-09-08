import { useEffect, useMemo, useRef } from 'react';
import type {
  ArenaCalibration,
  BackgroundModel,
  BodyTrack,
  BodyTrackPoint,
  TrialWindow,
} from '../models/tracking';

interface Props {
  background: BackgroundModel;
  track: BodyTrack;
  trialWindow: TrialWindow;
  calibration: ArenaCalibration;
}

function ptsSeconds(point: BodyTrackPoint): number {
  return point.pts.ticks / point.pts.timescale;
}

function drawGrayscale(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return;

  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 1) {
    const value = pixels[i];
    const destination = i * 4;

    rgba[destination] = value;
    rgba[destination + 1] = value;
    rgba[destination + 2] = value;
    rgba[destination + 3] = 255;
  }

  context.putImageData(
    new ImageData(rgba, width, height),
    0,
    0,
  );
}
function sampleForDisplay(
  points: BodyTrackPoint[],
  intervalSeconds = 0.1,
): BodyTrackPoint[] {
  const sampled: BodyTrackPoint[] = [];
  let lastTime: number | null = null;

  for (const point of points) {
    if (point.x === null || point.y === null) {
      lastTime = null;
      continue;
    }

    const time = ptsSeconds(point);

    const epsilon = 1e-6;

if (
  lastTime === null ||
  time - lastTime >= intervalSeconds - epsilon
) {
      sampled.push(point);
      lastTime = time;
    }
  }

  return sampled;
}
export default function TrajectoryPreview({
  background,
  track,
  trialWindow,
  calibration,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const trialPoints = useMemo(() => {
    const endIndex =
      trialWindow.endPresentationIndex ??
      Number.POSITIVE_INFINITY;

    return track.points.filter(
      (point) =>
        point.presentationIndex >= trialWindow.startPresentationIndex &&
        point.presentationIndex <= endIndex,
    );
  }, [track, trialWindow]);

  const validPoints = useMemo(
    () =>
      trialPoints.filter(
        (point) => point.x !== null && point.y !== null,
      ),
    [trialPoints],
  );
const displayPoints = useMemo(
  () => sampleForDisplay(validPoints, 0.1),
  [validPoints],
);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawGrayscale(
      canvas,
      background.pixels,
      background.width,
      background.height,
    );

    const context = canvas.getContext('2d');
    if (!context) return;

    /*
     * Build one trajectory path.
     *
     * Missing positions, duplicate/non-increasing PTS,
     * or unusually long time gaps break the line rather
     * than inventing movement across them.
     */
    const path = new Path2D();
    let previous: BodyTrackPoint | null = null;

    for (const point of displayPoints) {
      if (point.x === null || point.y === null) {
        previous = null;
        continue;
      }

      if (previous === null) {
        path.moveTo(point.x, point.y);
        previous = point;
        continue;
      }

      const dt = ptsSeconds(point) - ptsSeconds(previous);

      if (dt <= 0 || dt > 0.5) {
        path.moveTo(point.x, point.y);
      } else {
        path.lineTo(point.x, point.y);
      }

      previous = point;
    }

    /*
     * Double-stroke the trajectory so it remains
     * visible on both bright and dark portions of
     * the grayscale maze.
     */
    context.save();

    context.lineJoin = 'round';
    context.lineCap = 'round';

    context.lineWidth = 2.5;
    context.strokeStyle = 'white';
    context.stroke(path);

    context.lineWidth = 1;
    context.strokeStyle = 'black';
    context.stroke(path);

    /*
     * Draw physical platform boundary.
     */
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
     * Start and end markers use different shapes,
     * so they don't rely on color.
     */
    const first = validPoints[0];
    const last = validPoints.at(-1);

    if (first && first.x !== null && first.y !== null) {
        context.lineWidth = 3;
        context.beginPath();
        context.arc(first.x, first.y, 7, 0, Math.PI * 2);
        context.stroke();
    }

    if (last && last.x !== null && last.y !== null) {
  const size = 12;

  context.lineWidth = 3;
  context.strokeRect(
    last.x - size / 2,
    last.y - size / 2,
    size,
    size,
  );
}

    context.restore();
  }, [
    background,
    calibration,
    trialPoints,
    validPoints,
  ]);

  const startSeconds =
    trialWindow.startPts.ticks /
    trialWindow.startPts.timescale;

  const lastPoint = validPoints.at(-1);

  const displayedDuration =
    lastPoint
      ? Math.max(0, ptsSeconds(lastPoint) - startSeconds)
      : null;

  return (
    <section className="card" aria-labelledby="trajectory-heading">
      <h2 id="trajectory-heading">Body trajectory</h2>

      <p>
        Trajectory begins at the detected behavioral trial start.
        Missing or non-increasing timestamp intervals are not connected.
      </p>

      <canvas
        ref={canvasRef}
        className="calibration-canvas"
        aria-label="Mouse body trajectory across the Barnes maze"
      />

      <p>
        <strong>○</strong> Trial start{' '}
        <strong>□</strong> Last detected position
      </p>

      <dl className="metadata-grid">
        <div>
          <dt>Trial start PTS</dt>
          <dd>{startSeconds.toFixed(3)} s</dd>
        </div>

        <div>
          <div>
            <dt>Tracked observations</dt>
            <dd>{validPoints.length.toLocaleString()}</dd>
            </div>

            <div>
            <dt>Displayed observations</dt>
            <dd>{displayPoints.length.toLocaleString()}</dd>
        </div>
        </div>

        <div>
          <dt>Displayed duration</dt>
          <dd>
            {displayedDuration !== null
              ? `${displayedDuration.toFixed(3)} s`
              : 'Unavailable'}
          </dd>
        </div>
      </dl>
    </section>
  );
}