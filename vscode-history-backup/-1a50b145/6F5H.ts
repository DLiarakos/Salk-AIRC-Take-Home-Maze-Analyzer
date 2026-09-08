import type {
  ArenaCalibration,
  HoleGeometry,
  HoleRoi,
} from '../models/tracking';

export function createHoleGeometry(
  arena: ArenaCalibration,
  targetX: number,
  targetY: number,
  holeCount: number,
  holeRadiusPixels: number,
): HoleGeometry {
  if (holeCount < 1) throw new Error('Hole count must be at least 1.');
  if (holeRadiusPixels <= 0) throw new Error('Hole radius must be positive.');

  const dx = targetX - arena.centerX;
  const dy = targetY - arena.centerY;

  const ringRadiusPixels = Math.hypot(dx,dy);
  const rotationRadians = Math.atan2(dy,dx);

  const holes: HoleRoi[] = [];

  for (let index = 0; index < holeCount; index += 1) {
    const angle =
      rotationRadians +
      index * ((Math.PI * 2) / holeCount);

    holes.push({
      index,
      centerX: arena.centerX + Math.cos(angle) * ringRadiusPixels,
      centerY: arena.centerY + Math.sin(angle) * ringRadiusPixels,
      radiusPixels: holeRadiusPixels,
      isTarget: index === 0,
    });
  }

  return {
    holeCount,
    ringRadiusPixels,
    holeRadiusPixels,
    targetHoleIndex: 0,
    rotationRadians,
    holes,
  };
}