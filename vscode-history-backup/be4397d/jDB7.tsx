import { useEffect,useMemo,useRef } from 'react';
import type { ProcessedTrajectory,AnalysisTrajectoryPoint,BackgroundModel } from '../models/tracking';


interface Props {
  processedTrajectory: ProcessedTrajectory;
  backgroundImageUrl: string;
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

function drawTrajectoryCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  points: AnalysisTrajectoryPoint[],
  title: string,
) {
  const context = canvas.getContext('2d');
  if (!context) return;

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  context.clearRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0);

  const path = new Path2D();
  let previous: AnalysisTrajectoryPoint | null = null;

  for (const point of points) {
    if (!previous) {
      path.moveTo(point.x,point.y);
      previous = point;
      continue;
    }

    const dt = point.timeSeconds - previous.timeSeconds;

    if (dt <= 0 || point.segmentId !== previous.segmentId) {
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

  context.strokeStyle = 'black';
  context.fillStyle = 'white';

  if (first) {
    context.beginPath();
    context.arc(first.x,first.y,6,0,Math.PI * 2);
    context.fill();
    context.stroke();
  }

  if (last) {
    const size = 12;
    context.strokeRect(last.x - size / 2,last.y - size / 2,size,size);
  }

  context.fillStyle = 'rgba(255,255,255,0.9)';
  context.fillRect(12,12,180,28);
  context.fillStyle = 'black';
  context.font = '16px sans-serif';
  context.fillText(title,20,31);
}

export default function TrajectoryComparisonView({ processedTrajectory,backgroundImageUrl }: Props) {
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
    const image = new Image();

    image.onload = () => {
      if (rawCanvasRef.current) {
        drawTrajectoryCanvas(rawCanvasRef.current,image,rawDisplayPoints,'Raw trajectory');
      }

      if (smoothedCanvasRef.current) {
        drawTrajectoryCanvas(smoothedCanvasRef.current,image,smoothedDisplayPoints,'Smoothed trajectory');
      }
    };

    image.src = backgroundImageUrl;
  }, [backgroundImageUrl,rawDisplayPoints,smoothedDisplayPoints]);

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