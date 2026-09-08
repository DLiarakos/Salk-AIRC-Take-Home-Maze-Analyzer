/**
 * Body-axis estimation and temporal resolution of mouse nose/rear orientation.
 *
 * Inputs:
 * - ForegroundComponent geometry for shape estimation and BodyTrack plus OrientationSettings for temporal orientation.
 *
 * Outputs:
 * - BodyShapeEstimate records, an orientation-resolved BodyTrack, and OrientationQcSummary diagnostics.
 *
 * Main functions:
 * - estimateBodyShape() derives robust major-axis endpoint candidates from component pixels.
 * - resolveTrackOrientation() selects nose/rear direction using motion and continuity evidence.
 * - summarizeOrientation() reports orientation coverage/confidence QC.
 */
import type { BodyTrack, BodyTrackPoint, ForegroundComponent, OrientationSettings } from '../models/tracking';

export interface BodyShapeEstimate {
  axisX: number;
  axisY: number;
  candidateAX: number;
  candidateAY: number;
  candidateBX: number;
  candidateBY: number;
  shapeConfidence: number;
}

export interface OrientationQcSummary {
  detectedPoints: number;
  resolvedPoints: number;
  motionResolvedPoints: number;
  continuityResolvedPoints: number;
  unresolvedPoints: number;
  resolvedFraction: number;
  medianConfidence: number | null;
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0)
    return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return (sorted[lower] * (1 - weight) +
    sorted[upper] * weight);
}

export function estimateBodyShape(component: ForegroundComponent, width: number): BodyShapeEstimate | null {
  if (component.pixelIndices.length < 3) {
    return null;
  }
  const centerX = component.centroidX;
  const centerY = component.centroidY;
  let covarianceXX = 0;
  let covarianceYY = 0;
  let covarianceXY = 0;
  for (const pixelIndex of component.pixelIndices) {
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const dx = x - centerX;
    const dy = y - centerY;
    covarianceXX += dx * dx;
    covarianceYY += dy * dy;
    covarianceXY += dx * dy;
  }
  const count = component.pixelIndices.length;
  covarianceXX /= count;
  covarianceYY /= count;
  covarianceXY /= count;
  const trace = covarianceXX + covarianceYY;
  const difference = Math.sqrt((covarianceXX -
    covarianceYY) ** 2 +
    4 *
    covarianceXY *
    covarianceXY);
  const majorEigenvalue = (trace + difference) / 2;
  const minorEigenvalue = (trace - difference) / 2;
  if (majorEigenvalue <= 0) {
    return null;
  }
  const angle = 0.5 *
    Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);
  const projections: number[] = [];
  for (const pixelIndex of component.pixelIndices) {
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    projections.push((x - centerX) * axisX +
      (y - centerY) * axisY);
  }
  projections.sort((a, b) => a - b);
  /*
   * Use robust body endpoints rather than absolute
   * extremes, which can be dominated by a thin tail
   * or single segmentation pixel.
  */
  const low = quantile(projections, 0.08);
  const high = quantile(projections, 0.92);
  const denominator = majorEigenvalue +
    minorEigenvalue;
  const shapeConfidence = denominator > 0
    ? Math.max(0, Math.min(1, (majorEigenvalue -
      minorEigenvalue) / denominator))
    : 0;
  return {
    axisX,
    axisY,
    candidateAX: centerX + axisX * low,
    candidateAY: centerY + axisY * low,
    candidateBX: centerX + axisX * high,
    candidateBY: centerY + axisY * high,
    shapeConfidence,
  };
}

function seconds(point: BodyTrackPoint): number {
  return (point.pts.ticks /
    point.pts.timescale);
}

function direction(centerX: number, centerY: number, x: number, y: number) {
  const dx = x - centerX;
  const dy = y - centerY;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: dx / length,
    y: dy / length,
  };
}

export function resolveTrackOrientation(track: BodyTrack, settings: OrientationSettings): BodyTrack {
  const history: BodyTrackPoint[] = [];
  let previousOrientation: {
    x: number;
    y: number;
    time: number;
  } | null = null;
  const points = track.points.map((point) => {
    const base: BodyTrackPoint = {
      ...point,
      noseX: null,
      noseY: null,
      rearX: null,
      rearY: null,
      orientationConfidence: point.x === null ? null : 0,
      orientationMethod: point.x === null
        ? 'not-detected'
        : 'unresolved',
    };
    if (point.x === null ||
      point.y === null ||
      point.candidateAX === null ||
      point.candidateAY === null ||
      point.candidateBX === null ||
      point.candidateBY === null ||
      point.shapeConfidence === null ||
      point.shapeConfidence <
      settings.minimumShapeConfidence) {
      return base;
    }
    const time = seconds(point);
    const directionA = direction(point.x, point.y, point.candidateAX, point.candidateAY);
    const directionB = direction(point.x, point.y, point.candidateBX, point.candidateBY);
    let useA: boolean | null = null;
    let confidence = 0;
    let method: BodyTrackPoint['orientationMethod'] = 'unresolved';
    /*
     * Prefer movement over roughly 0.1 s rather
     * than frame-to-frame displacement.
    */
    let motionReference: BodyTrackPoint | null = null;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const candidate = history[index];
      const dt = time -
        seconds(candidate);
      if (dt >=
        settings.motionLookbackSeconds) {
        motionReference =
          candidate;
        break;
      }
    }
    if (motionReference &&
      motionReference.x !== null &&
      motionReference.y !== null) {
      const dt = time -
        seconds(motionReference);
      if (dt > 0 &&
        dt <=
        settings.maximumContinuityGapSeconds) {
        const dx = point.x -
          motionReference.x;
        const dy = point.y -
          motionReference.y;
        const distance = Math.hypot(dx, dy);
        const speed = distance / dt;
        if (distance > 0 &&
          speed >=
          settings
            .minimumDirectionalSpeedPixelsPerSecond) {
          const velocityX = dx / distance;
          const velocityY = dy / distance;
          const alignmentA = directionA.x *
            velocityX +
            directionA.y *
            velocityY;
          const alignmentB = directionB.x *
            velocityX +
            directionB.y *
            velocityY;
          const alignment = Math.abs(alignmentA);
          if (alignment >=
            settings.minimumMotionAlignment) {
            useA =
              alignmentA >=
              alignmentB;
            confidence =
              point.shapeConfidence *
              alignment;
            method =
              'motion';
          }
        }
      }
    }
    /*
     * If movement is too small or sideways,
     * preserve orientation from the previous
     * confident frame.
    */
    if (useA === null &&
      previousOrientation) {
      const gap = time -
        previousOrientation.time;
      if (gap >= 0 &&
        gap <=
        settings.maximumContinuityGapSeconds) {
        const alignmentA = directionA.x *
          previousOrientation.x +
          directionA.y *
          previousOrientation.y;
        const alignmentB = directionB.x *
          previousOrientation.x +
          directionB.y *
          previousOrientation.y;
        const alignment = Math.abs(alignmentA);
        if (alignment >=
          settings.minimumContinuityAlignment) {
          useA =
            alignmentA >=
            alignmentB;
          confidence =
            point.shapeConfidence *
            alignment;
          method =
            'continuity';
        }
      }
    }
    let result = base;
    if (useA !== null) {
      const noseX = useA
        ? point.candidateAX
        : point.candidateBX;
      const noseY = useA
        ? point.candidateAY
        : point.candidateBY;
      const rearX = useA
        ? point.candidateBX
        : point.candidateAX;
      const rearY = useA
        ? point.candidateBY
        : point.candidateAY;
      const noseDirection = direction(point.x, point.y, noseX, noseY);
      previousOrientation = {
        x: noseDirection.x,
        y: noseDirection.y,
        time,
      };
      result = {
        ...base,
        noseX,
        noseY,
        rearX,
        rearY,
        orientationConfidence: confidence,
        orientationMethod: method,
      };
    }
    history.push(point);
    /*
     * Don't let history grow indefinitely.
    */
    while (history.length > 0 &&
      time -
      seconds(history[0]) >
      settings.maximumContinuityGapSeconds) {
      history.shift();
    }
    return result;
  });
  return {
    ...track,
    points,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] +
      sorted[middle]) / 2;
}

export function summarizeOrientation(track: BodyTrack): OrientationQcSummary {
  const detected = track.points.filter((point) => point.x !== null &&
    point.y !== null);
  const motion = detected.filter((point) => point.orientationMethod ===
    'motion');
  const continuity = detected.filter((point) => point.orientationMethod ===
    'continuity');
  const resolved = [
    ...motion,
    ...continuity,
  ];
  const confidences = resolved.flatMap((point) => point.orientationConfidence !==
    null
    ? [
      point.orientationConfidence,
    ]
    : []);
  return {
    detectedPoints: detected.length,
    resolvedPoints: resolved.length,
    motionResolvedPoints: motion.length,
    continuityResolvedPoints: continuity.length,
    unresolvedPoints: detected.length -
      resolved.length,
    resolvedFraction: detected.length > 0
      ? resolved.length /
      detected.length
      : 0,
    medianConfidence: median(confidences),
  };
}
