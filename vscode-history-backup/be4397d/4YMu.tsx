import { useEffect,useMemo,useRef } from 'react';
import type { ProcessedTrajectory,AnalysisTrajectoryPoint,BackgroundModel } from '../models/tracking';


interface Props {
  processedTrajectory: ProcessedTrajectory;
  background: BackgroundModel;
}

function sampleAnalysisPoints(points: AnalysisTrajectoryPoint[],intervalSeconds=0.1): AnalysisTrajectoryPoint[] {
  const sampled: AnalysisTrajectoryPoint[] = [];
  let lastTime: number | null = null;
  const epsilon = 1e-6;

  for (const point of points) {
    if (lastTime === null || point.timeSeconds - lastTime >= intervalSeconds - epsilon) {
      sampled.push(point);
      lastTime = point.timeSeconds;
    }
  }

  return sampled;
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
    new ImageData(rgba,width,height),
    0,
    0,
  );
}
function drawTrajectoryCanvas(
  canvas: HTMLCanvasElement,
  background: BackgroundModel,
  points: AnalysisTrajectoryPoint[],
  title: string,
) {
  drawGrayscale(
    canvas,
    background.pixels,
    background.width,
    background.height,
  );

  const context = canvas.getContext('2d');
  if (!context) return;

  const path = new Path2D();
  let previous: AnalysisTrajectoryPoint | null = null;

  for (const point of points) {
    if (!previous) {
      path.moveTo(point.x,point.y);
      previous = point;
      continue;
    }

    if (
      point.segmentId !== previous.segmentId ||
      point.timeSeconds <= previous.timeSeconds
    ) {
      path.moveTo(point.x,point.y);
    } else {
      path.lineTo(point.x,point.y);
    }

    previous = point;
  }

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
    context.beginPath();
    context.arc(first.x,first.y,6,0,Math.PI * 2);
    context.stroke();
  }

  if (last) {
    const size = 12;
    context.strokeRect(
      last.x - size / 2,
      last.y - size / 2,
      size,
      size,
    );
  }
}

export default function TrajectoryComparisonView({ processedTrajectory,background }: Props) {
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const rawDisplayPoints = useMemo(
    () => sampleAnalysisPoints(processedTrajectory.raw,0.1),
    [processedTrajectory],
  );

  const smoothedDisplayPoints = useMemo(
    () => sampleAnalysisPoints(processedTrajectory.smoothed,0.1),
    [processedTrajectory],
  );

  useEffect(() => {
useEffect(() => {
  if (rawCanvasRef.current) {
    drawTrajectoryCanvas(
      rawCanvasRef.current,
      background,
      rawDisplayPoints,
      'Raw trajectory',
    );
  }

  if (smoothedCanvasRef.current) {
    drawTrajectoryCanvas(
      smoothedCanvasRef.current,
      background,
      smoothedDisplayPoints,
      'Smoothed trajectory',
    );
  }
}, [
  background,
  rawDisplayPoints,
  smoothedDisplayPoints,
]);
  }, [background,rawDisplayPoints,smoothedDisplayPoints]);

  return (
    <section className="card">
      <h2>Trajectory comparison</h2>
      <p>Side-by-side comparison of the raw analysis trajectory and the smoothed trajectory, using identical display sampling and the same background frame.</p>

      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:'1rem' }}>
        <div>
          <canvas ref={rawCanvasRef} style={{ width:'100%',border:'1px solid #c8d0da',borderRadius:'8px' }} />
          <p><strong>Displayed points:</strong> {rawDisplayPoints.length.toLocaleString()}</p>
        </div>

        <div>
          <canvas ref={smoothedCanvasRef} style={{ width:'100%',border:'1px solid #c8d0da',borderRadius:'8px' }} />
          <p><strong>Displayed points:</strong> {smoothedDisplayPoints.length.toLocaleString()}</p>
        </div>
      </div>

      <dl className="metadata-grid">
        <div>
          <dt>Raw analysis observations</dt>
          <dd>{processedTrajectory.raw.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Smoothed observations</dt>
          <dd>{processedTrajectory.smoothed.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Median smoothing correction</dt>
          <dd>{processedTrajectory.qc.medianSmoothingCorrectionPixels.toFixed(2)} px</dd>
        </div>
        <div>
          <dt>95th percentile correction</dt>
          <dd>{processedTrajectory.qc.p95SmoothingCorrectionPixels.toFixed(2)} px</dd>
        </div>
      </dl>
    </section>
  );
}