import type {
  BodyDetection,
  ComponentAnalysis,
} from '../models/tracking';
import type { FrameTiming,RationalTime } from '../models/media';
import type {
  BackgroundModel,
  BodyTrackPoint,

  SegmentationSettings,
} from '../models/tracking';

import {
  findForegroundComponents,
  segmentDarkForeground,
} from './segmentation';

export function detectBody(
  analysis: ComponentAnalysis,
): BodyDetection | null {
  const candidate =
    analysis.largestComponent;

  if (!candidate) {
    return null;
  }

  const totalRetainedArea =
    analysis.retainedComponents.reduce(
      (sum, component) =>
        sum + component.areaPixels,
      0,
    );

  const dominance =
    totalRetainedArea > 0
      ? candidate.areaPixels /
        totalRetainedArea
      : 0;

  return {
    x: candidate.centroidX,
    y: candidate.centroidY,

    areaPixels:
      candidate.areaPixels,

    minX: candidate.minX,
    minY: candidate.minY,
    maxX: candidate.maxX,
    maxY: candidate.maxY,

    visibility: 'visible',

    dominance,
  };
}