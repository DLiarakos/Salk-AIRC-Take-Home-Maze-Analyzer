import type {BodyDetection,ComponentAnalysis,} from '../models/tracking';
import type { FrameTiming,RationalTime } from '../models/media';
import type {BackgroundModel,BodyTrackPoint,SegmentationSettings,} from '../models/tracking';
import type {ArenaMask,} from './arenaMask';
import { findForegroundComponents,segmentDarkForeground,} from './segmentation';

export function trackBodyFrame(
  pixels: Uint8Array,
  timing: FrameTiming,
  presentationIndex: number,
  background: BackgroundModel,
  arenaMask: ArenaMask,
  settings: SegmentationSettings,
): BodyTrackPoint {
  const segmentation =
    segmentDarkForeground(
      pixels,
      background,
      arenaMask,
      settings,
    );

  const components =
    findForegroundComponents(
      segmentation.foregroundMask,
      segmentation.width,
      segmentation.height,
      settings.minimumComponentAreaPixels,
    );

  const body =
    detectBody(components);

  if (!body) {
    return {
      presentationIndex,
      pts: timing.pts,

      x: null,
      y: null,

      areaPixels: null,
      dominance: null,

      visibility: 'not-detected',

      foregroundPixelCount:
        segmentation.foregroundPixelCount,

      retainedComponentCount:
        components.retainedComponents.length,
    };
  }

  return {
    presentationIndex,
    pts: timing.pts,

    x: body.x,
    y: body.y,

    areaPixels:
      body.areaPixels,

    dominance:
      body.dominance,

    visibility:
      body.visibility,

    foregroundPixelCount:
      segmentation.foregroundPixelCount,

    retainedComponentCount:
      components.retainedComponents.length,
  };
}
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