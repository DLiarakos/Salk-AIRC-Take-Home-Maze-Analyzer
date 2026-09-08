import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  ArenaCalibration,
  BackgroundModel,
  RepresentativeFrame,
  SegmentationSettings,
} from '../models/tracking';

import {
  createArenaMask,
} from '../tracking/arenaMask';

import {
  segmentDarkForeground,
  findForegroundComponents
} from '../tracking/segmentation';

interface Props {
  frame: RepresentativeFrame;
  background: BackgroundModel;
  calibration: ArenaCalibration;
}

function drawGrayscale(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  canvas.width = width;
  canvas.height = height;

  const context =
    canvas.getContext('2d');

  if (!context) {
    return;
  }

  const rgba =
    new Uint8ClampedArray(
      width * height * 4,
    );

  for (
    let i = 0;
    i < pixels.length;
    i += 1
  ) {
    const value =
      pixels[i];

    const destination =
      i * 4;

    rgba[destination] = value;
    rgba[destination + 1] = value;
    rgba[destination + 2] = value;
    rgba[destination + 3] = 255;
  }

  context.putImageData(
    new ImageData(
      rgba,
      width,
      height,
    ),
    0,
    0,
  );
}

export default function SegmentationPreview({
  frame,
  background,
  calibration,
}: Props) {
  const differenceCanvasRef =
    useRef<HTMLCanvasElement>(null);

  const maskCanvasRef =
    useRef<HTMLCanvasElement>(null);

  const [
    differenceThreshold,
    setDifferenceThreshold,
  ] = useState(20);

  const settings =
    useMemo<SegmentationSettings>(
      () => ({
        differenceThreshold,
        minimumComponentAreaPixels: 30,
      }),
      [differenceThreshold],
    );

  const arenaMask =
    useMemo(
      () =>
        createArenaMask(
          calibration,
        ),
      [calibration],
    );

  const segmentation =
    useMemo(
      () =>
        segmentDarkForeground(
          frame.pixels,
          background,
          arenaMask,
          settings,
        ),
      [
        frame.pixels,
        background,
        arenaMask,
        settings,
      ],
    );
    const componentAnalysis =
  useMemo(
    () =>
      findForegroundComponents(
        segmentation.foregroundMask,
        segmentation.width,
        segmentation.height,
        settings.minimumComponentAreaPixels,
      ),
    [
      segmentation,
      settings.minimumComponentAreaPixels,
    ],
  );
  useEffect(() => {
    const differenceCanvas =
      differenceCanvasRef.current;

    const maskCanvas =
      maskCanvasRef.current;

    if (
      !differenceCanvas ||
      !maskCanvas
    ) {
      return;
    }

    /*
     * Difference values may be fairly small.
     * Amplify them ONLY for visualization.
     *
     * The segmentation calculation continues
     * to use the original unscaled values.
     */
    const visualDifference =
      new Uint8Array(
        segmentation.difference.length,
      );

    for (
      let i = 0;
      i < visualDifference.length;
      i += 1
    ) {
      visualDifference[i] =
        Math.min(
          255,
          segmentation.difference[i] * 4,
        );
    }

    drawGrayscale(
      differenceCanvas,
      visualDifference,
      segmentation.width,
      segmentation.height,
    );

    /*
     * Convert 0/1 mask into black/white
     * purely for display.
     */
    const maskPreview =
      new Uint8Array(
        segmentation.foregroundMask.length,
      );

    for (
      let i = 0;
      i < maskPreview.length;
      i += 1
    ) {
      maskPreview[i] =
        segmentation.foregroundMask[i]
          ? 255
          : 0;
    }

    drawGrayscale(
      maskCanvas,
      maskPreview,
      segmentation.width,
      segmentation.height,
    );
  }, [segmentation]);

  return (
    <section
      className="card"
      aria-labelledby="segmentation-heading"
    >
      <h2 id="segmentation-heading">
        Mouse segmentation preview
      </h2>

      <p>
        Pixels are considered candidate mouse
        foreground when they become darker than
        the temporal background by at least the
        selected threshold.
      </p>

      <label>
        Difference threshold

        <input
          type="number"
          min="1"
          max="255"
          step="1"
          value={
            differenceThreshold
          }
          onChange={(event) => {
            setDifferenceThreshold(
              Number(
                event.target.value,
              ),
            );
          }}
        />
      </label>

      <p>
        Candidate foreground pixels:{' '}
        <strong>
          {segmentation.foregroundPixelCount.toLocaleString()}
        </strong>
      </p>

      <div className="preview-grid">
        <figure>
          <canvas
            ref={
              differenceCanvasRef
            }
            className="calibration-canvas"
            aria-label="Background darkening difference image"
          />

          <figcaption>
            Background − current frame
            <br />
            Display amplified 4×
          </figcaption>
        </figure>

        <figure>
          <canvas
            ref={
              maskCanvasRef
            }
            className="calibration-canvas"
            aria-label="Binary candidate mouse foreground mask"
          />

          <figcaption>
            Candidate foreground mask
          </figcaption>
        </figure>
      </div>
      <p>
  Raw connected components:{' '}
  <strong>
    {componentAnalysis.components.length}
  </strong>
</p>

<p>
  Components ≥{' '}
  {settings.minimumComponentAreaPixels}{' '}
  pixels:{' '}
  <strong>
    {
      componentAnalysis
        .retainedComponents
        .length
    }
  </strong>
</p>

{componentAnalysis.largestComponent && (
  <p>
    Largest component:{' '}
    <strong>
      {
        componentAnalysis
          .largestComponent
          .areaPixels
      }{' '}
      pixels
    </strong>
    {' · '}
    centroid (
    {
      componentAnalysis
        .largestComponent
        .centroidX
        .toFixed(1)
    }
    ,{' '}
    {
      componentAnalysis
        .largestComponent
        .centroidY
        .toFixed(1)
    }
    )
  </p>
)}
    </section>
  );
}