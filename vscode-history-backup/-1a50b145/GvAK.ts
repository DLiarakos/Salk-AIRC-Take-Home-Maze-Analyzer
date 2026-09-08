import type { HoleGeometry,HoleRoi } from '../models/tracking';

interface Point {
  x: number;
  y: number;
}

export function createHoleGeometry(
  target: Point,
  opposite: Point,
  quarterClockwise: Point,
  holeCount: number,
  holeRadiusPixels: number,
): HoleGeometry {
  if (holeCount < 4) {
    throw new Error('Hole count must be at least 4.');
  }

  if (holeRadiusPixels <= 0) {
    throw new Error('Hole ROI radius must be positive.');
  }

  const centerX = (target.x + opposite.x) / 2;
  const centerY = (target.y + opposite.y) / 2;

  const axisUX = target.x - centerX;
  const axisUY = target.y - centerY;

  const axisVX = quarterClockwise.x - centerX;
  const axisVY = quarterClockwise.y - centerY;

  const holes: HoleRoi[] = [];

  for (let index = 0; index < holeCount; index += 1) {
    const angle = index * ((Math.PI * 2) / holeCount);

    holes.push({
      index,
      centerX:
        centerX +
        axisUX * Math.cos(angle) +
        axisVX * Math.sin(angle),

      centerY:
        centerY +
        axisUY * Math.cos(angle) +
        axisVY * Math.sin(angle),

      radiusPixels: holeRadiusPixels,
      isTarget: index === 0,
    });
  }

  return {
    holeCount,
    holeRadiusPixels,
    targetHoleIndex: 0,

    centerX,
    centerY,

    axisUX,
    axisUY,
    axisVX,
    axisVY,

    holes,
  };
}