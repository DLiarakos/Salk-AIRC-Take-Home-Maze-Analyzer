import type { HoleGeometry,HoleRoi } from '../models/tracking';

export interface HoleAnchor {
  index: number;
  x: number;
  y: number;
}

function solveLinearSystem(
  matrix: number[][],
  values: number[],
): number[] {
  const n = values.length;

  const augmented = matrix.map(
    (row,index) => [...row,values[index]],
  );

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column;

    for (let row = column + 1; row < n; row += 1) {
      if (
        Math.abs(augmented[row][column]) >
        Math.abs(augmented[pivotRow][column])
      ) {
        pivotRow = row;
      }
    }

    [augmented[column],augmented[pivotRow]] =
      [augmented[pivotRow],augmented[column]];

    const pivot = augmented[column][column];

    if (Math.abs(pivot) < 1e-12) {
      throw new Error('Hole calibration points are degenerate.');
    }

    for (let value = column; value <= n; value += 1) {
      augmented[column][value] /= pivot;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;

      const factor = augmented[row][column];

      for (let value = column; value <= n; value += 1) {
        augmented[row][value] -=
          factor * augmented[column][value];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function fitHomography(
  anchors: HoleAnchor[],
  holeCount: number,
): HoleGeometry['homography'] {
  if (anchors.length !== 4) {
    throw new Error('Exactly four hole anchors are required.');
  }

  const matrix: number[][] = [];
  const values: number[] = [];

  for (const anchor of anchors) {
    const angle =
      anchor.index * (Math.PI * 2 / holeCount);

    const u = Math.cos(angle);
    const v = Math.sin(angle);

    matrix.push([
      u,v,1,
      0,0,0,
      -u * anchor.x,
      -v * anchor.x,
    ]);

    values.push(anchor.x);

    matrix.push([
      0,0,0,
      u,v,1,
      -u * anchor.y,
      -v * anchor.y,
    ]);

    values.push(anchor.y);
  }

  const result = solveLinearSystem(matrix,values);

  return [
    result[0],result[1],result[2],
    result[3],result[4],result[5],
    result[6],result[7],
  ];
}

function projectPoint(
  u: number,
  v: number,
  homography: HoleGeometry['homography'],
) {
  const [
    h11,h12,h13,
    h21,h22,h23,
    h31,h32,
  ] = homography;

  const denominator =
    h31 * u +
    h32 * v +
    1;

  return {
    x:
      (
        h11 * u +
        h12 * v +
        h13
      ) / denominator,

    y:
      (
        h21 * u +
        h22 * v +
        h23
      ) / denominator,
  };
}

export function createHoleGeometry(
  anchors: HoleAnchor[],
  holeCount: number,
  holeRadiusPixels: number,
): HoleGeometry {
  if (holeCount < 4) {
    throw new Error('Hole count must be at least 4.');
  }

  if (holeRadiusPixels <= 0) {
    throw new Error('Hole ROI radius must be positive.');
  }

  const homography =
    fitHomography(anchors,holeCount);

  const holes: HoleRoi[] = [];

  for (let index = 0; index < holeCount; index += 1) {
    const angle =
      index * (Math.PI * 2 / holeCount);

    const projected = projectPoint(
      Math.cos(angle),
      Math.sin(angle),
      homography,
    );

    holes.push({
      index,
      centerX: projected.x,
      centerY: projected.y,
      radiusPixels: holeRadiusPixels,
      isTarget: index === 0,
    });
  }

  return {
    holeCount,
    holeRadiusPixels,
    targetHoleIndex: 0,
    homography,
    holes,
  };
}