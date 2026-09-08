import { useEffect,useMemo,useRef } from 'react';
import type {
  BodyTrack,
  BodyTrackPoint,
  RepresentativeFrame,
} from '../models/tracking';

interface Props {
  frames: RepresentativeFrame[];
  track: BodyTrack;
}

interface FramePreviewProps {
  frame: RepresentativeFrame;
  point: BodyTrackPoint | null;
}

function drawGrayscale(
  canvas: HTMLCanvasElement,
  frame: RepresentativeFrame,
) {
  canvas.width = frame.width;
  canvas.height = frame.height;

  const context = canvas.getContext('2d');
  if (!context) return;

  const rgba =
    new Uint8ClampedArray(
      frame.width *
      frame.height *
      4,
    );

  for (
    let i = 0;
    i < frame.pixels.length;
    i += 1
  ) {
    const value = frame.pixels[i];
    const offset = i * 4;

    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }

  context.putImageData(
    new ImageData(
      rgba,
      frame.width,
      frame.height,
    ),
    0,
    0,
  );
}

function drawCross(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size = 4,
) {
  context.beginPath();
  context.moveTo(x - size,y);
  context.lineTo(x + size,y);
  context.moveTo(x,y - size);
  context.lineTo(x,y + size);
  context.stroke();
}

function FramePreview({
  frame,
  point,
}: FramePreviewProps) {
  const canvasRef =
    useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawGrayscale(canvas,frame);

    if (
      !point ||
      point.x === null ||
      point.y === null
    ) {
      return;
    }

    const context =
      canvas.getContext('2d');

    if (!context) return;

    context.save();
    context.lineWidth = 2;

    /*
     * Body centroid.
     */
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      5,
      0,
      Math.PI * 2,
    );
    context.stroke();

    /*
     * Raw PCA endpoint candidates.
     */
    if (
      point.candidateAX !== null &&
      point.candidateAY !== null
    ) {
      drawCross(
        context,
        point.candidateAX,
        point.candidateAY,
      );
    }

    if (
      point.candidateBX !== null &&
      point.candidateBY !== null
    ) {
      drawCross(
        context,
        point.candidateBX,
        point.candidateBY,
      );
    }

    /*
     * Selected body axis / orientation.
     */
    if (
      point.noseX !== null &&
      point.noseY !== null &&
      point.rearX !== null &&
      point.rearY !== null
    ) {
      context.beginPath();
      context.moveTo(
        point.rearX,
        point.rearY,
      );
      context.lineTo(
        point.noseX,
        point.noseY,
      );
      context.stroke();

      /*
       * Nose = larger circle + N label.
       */
      context.beginPath();
      context.arc(
        point.noseX,
        point.noseY,
        7,
        0,
        Math.PI * 2,
      );
      context.stroke();

      context.font = 'bold 14px sans-serif';
      context.fillText(
        'N',
        point.noseX + 8,
        point.noseY - 6,
      );

      /*
       * Rear = square.
       */
      const size = 9;

      context.strokeRect(
        point.rearX - size / 2,
        point.rearY - size / 2,
        size,
        size,
      );
    }

    context.restore();
  }, [frame,point]);

const seconds =
  point !== null
    ? point.pts.ticks / point.pts.timescale
    : null;

  return (
    <figure>
      <canvas
  ref={canvasRef}
  className="calibration-canvas"
  aria-label={
    seconds !== null
      ? `Orientation estimate at ${seconds.toFixed(3)} seconds`
      : `Orientation estimate for decoded frame ${frame.decodedIndex}`
  }
/>

      <figcaption>
  <strong>
    {seconds !== null
      ? `${seconds.toFixed(3)} s`
      : `Frame ${frame.decodedIndex}`}
  </strong>

  {' · '}

  {point
    ? point.orientationMethod
    : 'No matching observation'}

  {point?.orientationConfidence !== null &&
  point?.orientationConfidence !== undefined
    ? ` · confidence ${point.orientationConfidence.toFixed(2)}`
    : ''}
</figcaption>
    </figure>
  );
}

export default function OrientationPreview({
  frames,
  track,
}: Props) {
  const previews = useMemo(
    () =>
      [...frames]
        .sort(
          (a,b) =>
            a.decodedIndex -
            b.decodedIndex,
        )
        .map((frame) => ({
          frame,

          point:
            track.points.find(
              (point) =>
                point.presentationIndex ===
                frame.decodedIndex,
            ) ?? null,
        })),
    [frames,track],
  );

  return (
    <section
      className="card"
      aria-labelledby="orientation-preview-heading"
    >
      <h2 id="orientation-preview-heading">
        Nose and orientation preview
      </h2>

      <p>
        ○ Body centroid · × Body-axis candidates ·
        N Estimated nose · □ Rear endpoint
      </p>

      <div className="preview-grid">
        {previews.map(
          ({ frame,point }) => (
            <FramePreview
              key={frame.decodedIndex}
              frame={frame}
              point={point}
            />
          ),
        )}
      </div>
    </section>
  );
}