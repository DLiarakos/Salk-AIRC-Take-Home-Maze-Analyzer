import {
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  PointerEvent as ReactPointerEvent,
} from 'react';

import type {
  ArenaCalibration,
  RepresentativeFrame,
} from '../models/tracking';

import {
  createArenaCalibration,
} from '../calibration/arena';

interface Props {
  frame: RepresentativeFrame;

  calibration:
    ArenaCalibration | null;

  onCalibrationChange:
    (
      calibration:
        ArenaCalibration | null,
    ) => void;
}

function canvasCoordinates(
  event: ReactPointerEvent<HTMLCanvasElement>,
): {
  x: number;
  y: number;
} {
  const canvas =
    event.currentTarget;

  const rect =
    canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left) *
      (canvas.width / rect.width),

    y:
      (event.clientY - rect.top) *
      (canvas.height / rect.height),
  };
}

export default function ArenaCalibrationView({
  frame,
  calibration,
  onCalibrationChange,
}: Props) {
  /*
   * Hooks belong here:
   * top level of the React component.
   */
  const canvasRef =
    useRef<HTMLCanvasElement>(null);

  const [
    centerPoint,
    setCenterPoint,
  ] = useState<{
    x: number;
    y: number;
  } | null>(null);

  /*
   * First click = center.
   * Second click = platform edge.
   */
  function handleCanvasPointerDown(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    /*
     * Once calibration exists, require Reset before
     * starting another calibration.
     */
    if (calibration !== null) {
      return;
    }

    const point =
      canvasCoordinates(event);

    // First click: maze center.
    if (centerPoint === null) {
      setCenterPoint(point);
      return;
    }

    // Second click: platform edge.
    const newCalibration =
      createArenaCalibration(
        frame.width,
        frame.height,
        centerPoint,
        point,
        {
          trackingMarginPixels: 12,
          platformDiameterCm: null,
        },
      );

    onCalibrationChange(
      newCalibration,
    );
  }

  /*
   * Also at the top level of the component —
   * NOT inside the pointer handler.
   */
  useEffect(() => {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    canvas.width =
      frame.width;

    canvas.height =
      frame.height;

    const context =
      canvas.getContext('2d');

    if (!context) {
      return;
    }

    /*
     * Convert grayscale pixels to RGBA
     * for canvas display.
     */
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
      const value =
        frame.pixels[i];

      const destination =
        i * 4;

      rgba[destination] =
        value;

      rgba[destination + 1] =
        value;

      rgba[destination + 2] =
        value;

      rgba[destination + 3] =
        255;
    }

    const imageData =
      new ImageData(
        rgba,
        frame.width,
        frame.height,
      );

    context.putImageData(
      imageData,
      0,
      0,
    );

    /*
     * Draw temporary center marker after
     * the user's first click.
     */
    if (centerPoint) {
      context.save();

      context.lineWidth = 3;

      context.beginPath();

      context.arc(
        centerPoint.x,
        centerPoint.y,
        5,
        0,
        Math.PI * 2,
      );

      context.stroke();

      /*
       * Crosshair makes the center clearer
       * without depending on color.
       */
      context.beginPath();

      context.moveTo(
        centerPoint.x - 10,
        centerPoint.y,
      );

      context.lineTo(
        centerPoint.x + 10,
        centerPoint.y,
      );

      context.moveTo(
        centerPoint.x,
        centerPoint.y - 10,
      );

      context.lineTo(
        centerPoint.x,
        centerPoint.y + 10,
      );

      context.stroke();

      context.restore();
    }

    /*
     * Draw completed calibration.
     */
    if (calibration) {
      // Physical platform boundary.
      context.save();

      context.lineWidth = 3;
      context.setLineDash([]);

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
       * Tracking boundary.
       */
      context.setLineDash([
        8,
        6,
      ]);

      context.lineWidth = 2;

      context.beginPath();

      context.arc(
        calibration.centerX,
        calibration.centerY,
        calibration.platformRadiusPixels +
          calibration.trackingMarginPixels,
        0,
        Math.PI * 2,
      );

      context.stroke();

      /*
       * Calibration center crosshair.
       */
      context.setLineDash([]);

      context.beginPath();

      context.moveTo(
        calibration.centerX - 10,
        calibration.centerY,
      );

      context.lineTo(
        calibration.centerX + 10,
        calibration.centerY,
      );

      context.moveTo(
        calibration.centerX,
        calibration.centerY - 10,
      );

      context.lineTo(
        calibration.centerX,
        calibration.centerY + 10,
      );

      context.stroke();

      context.restore();
    }
  }, [
    frame,
    calibration,
    centerPoint,
  ]);

  function handleReset() {
    setCenterPoint(null);
    onCalibrationChange(null);
  }

  return (
    <section
      className="card"
      aria-labelledby="arena-calibration-heading"
    >
      <h2 id="arena-calibration-heading">
        Arena calibration
      </h2>

      {!centerPoint &&
        !calibration && (
          <p>
            Select the center of the Barnes
            maze.
          </p>
        )}

      {centerPoint &&
        !calibration && (
          <p>
            Now select a point on the outer
            edge of the circular platform.
          </p>
        )}

      {calibration && (
        <p>
          Arena calibration created.
        </p>
      )}

      <canvas
        ref={canvasRef}
        onPointerDown={
          handleCanvasPointerDown
        }
        aria-label="Barnes maze arena calibration"
        className="calibration-canvas"
      />

      <div className="actions">
        <button
          type="button"
          onClick={handleReset}
          disabled={
            calibration === null &&
            centerPoint === null
          }
        >
          Reset calibration
        </button>
      </div>

      {calibration && (
        <dl className="metadata-grid">
          <div>
            <dt>Center X</dt>
            <dd>
              {calibration.centerX.toFixed(1)} px
            </dd>
          </div>

          <div>
            <dt>Center Y</dt>
            <dd>
              {calibration.centerY.toFixed(1)} px
            </dd>
          </div>

          <div>
            <dt>Platform radius</dt>
            <dd>
              {calibration.platformRadiusPixels.toFixed(
                1,
              )}{' '}
              px
            </dd>
          </div>

          <div>
            <dt>Tracking margin</dt>
            <dd>
              {calibration.trackingMarginPixels.toFixed(
                1,
              )}{' '}
              px
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}