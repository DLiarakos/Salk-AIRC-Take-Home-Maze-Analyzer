/**
 * Preview of the calibrated arena mask used to restrict image analysis to the maze region.
 *
 * Inputs:
 * - RepresentativeFrame and ArenaCalibration.
 *
 * Outputs:
 * - Masked grayscale canvas plus basic intensity and mask-coverage diagnostics.
 *
 * Main component:
 * - ArenaMaskPreview builds the mask, applies it for display, and reports masked intensity statistics.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { ArenaCalibration, RepresentativeFrame } from '../models/tracking';
import { applyArenaMaskForPreview, calculateMaskedIntensityStats, createArenaMask } from '../tracking/arenaMask';

interface Props {
  frame: RepresentativeFrame;
  calibration: ArenaCalibration;
}
export default function ArenaMaskPreview({ frame, calibration, }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * The mask only needs to be rebuilt when
   * calibration changes.
  */
  const mask = useMemo(() => createArenaMask(calibration), [calibration]);
  const maskedPixels = useMemo(() => applyArenaMaskForPreview(frame.pixels, mask, 0), [
    frame.pixels,
    mask,
  ]);
  const stats = useMemo(() => calculateMaskedIntensityStats(frame.pixels, mask), [
    frame.pixels,
    mask,
  ]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width =
      frame.width;
    canvas.height =
      frame.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const rgba = new Uint8ClampedArray(frame.width *
      frame.height *
      4);
    for (let i = 0; i < maskedPixels.length; i += 1) {
      const value = maskedPixels[i];
      const destination = i * 4;
      rgba[destination] =
        value;
      rgba[destination + 1] =
        value;
      rgba[destination + 2] =
        value;
      rgba[destination + 3] =
        255;
    }
    context.putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
  }, [
    frame.width,
    frame.height,
    maskedPixels,
  ]);
  return (<section aria-labelledby="arena-mask-heading">
    <h3 id="arena-mask-heading">
      Arena mask preview
    </h3>

    <p>
      Pixels outside the tracking
      boundary are excluded from later
      image analysis.
    </p>

    <canvas
      ref={canvasRef}
      className="calibration-canvas"
      aria-label="Preview of the calibrated Barnes maze tracking area"
    />

    <dl className="metadata-grid">
      <div>
        <dt>Pixels inside mask</dt>
        <dd>
          {mask.insidePixelCount.toLocaleString()}
        </dd>
      </div>

      <div>
        <dt>Arena intensity mean</dt>
        <dd>
          {stats.mean.toFixed(1)}
        </dd>
      </div>

      <div>
        <dt>Arena intensity SD</dt>
        <dd>
          {stats.standardDeviation.toFixed(1)}
        </dd>
      </div>

      <div>
        <dt>Arena intensity range</dt>
        <dd>
          {stats.minimum}–
          {stats.maximum}
        </dd>
      </div>
    </dl>
  </section>);
}
