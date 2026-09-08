/**
 * Per-frame mouse-body detection using foreground segmentation and component geometry.
 *
 * Inputs:
 * - Grayscale frame pixels/timing, temporal background, arena mask, segmentation settings, and presentation index.
 *
 * Outputs:
 * - BodyTrackPoint observations containing centroid, body shape/orientation candidates, visibility, and segmentation QC.
 *
 * Main functions:
 * - trackBodyFrame() runs segmentation and converts the selected foreground component into one track point.
 * - detectBody() selects the dominant retained foreground component as the body candidate.
 */
import type { BodyDetection, ComponentAnalysis } from '../models/tracking';
import type { FrameTiming } from '../models/media';
import type { BackgroundModel, BodyTrackPoint, SegmentationSettings } from '../models/tracking';
import type { ArenaMask } from './arenaMask';
import { findForegroundComponents, segmentDarkForeground } from './segmentation';
import { estimateBodyShape } from './orientation';

export function trackBodyFrame(
  pixels: Uint8Array,
  timing: FrameTiming,
  presentationIndex: number,
  background: BackgroundModel,
  arenaMask: ArenaMask,
  settings: SegmentationSettings,
): BodyTrackPoint {
  const segmentation = segmentDarkForeground(pixels, background, arenaMask, settings);
  const components = findForegroundComponents(segmentation.foregroundMask, segmentation.width, segmentation.height, settings.minimumComponentAreaPixels);
  const body = detectBody(components);
  const shape = components.largestComponent
    ? estimateBodyShape(components.largestComponent, segmentation.width)
    : null;
  if (!body) {
    return {
      presentationIndex,
      pts: timing.pts,
      x: null,
      y: null,
      axisX: null,
      axisY: null,
      candidateAX: null,
      candidateAY: null,
      candidateBX: null,
      candidateBY: null,
      shapeConfidence: null,
      noseX: null,
      noseY: null,
      rearX: null,
      rearY: null,
      orientationConfidence: null,
      orientationMethod: 'not-detected',
      areaPixels: null,
      dominance: null,
      visibility: 'not-detected',
      foregroundPixelCount: segmentation.foregroundPixelCount,
      retainedComponentCount: components.retainedComponents.length,
    };
  }
  return {
    presentationIndex,
    pts: timing.pts,
    x: body.x,
    y: body.y,
    axisX: shape?.axisX ?? null,
    axisY: shape?.axisY ?? null,
    candidateAX: shape?.candidateAX ?? null,
    candidateAY: shape?.candidateAY ?? null,
    candidateBX: shape?.candidateBX ?? null,
    candidateBY: shape?.candidateBY ?? null,
    shapeConfidence: shape?.shapeConfidence ?? null,
    noseX: null,
    noseY: null,
    rearX: null,
    rearY: null,
    orientationConfidence: 0,
    orientationMethod: 'unresolved',
    areaPixels: body.areaPixels,
    dominance: body.dominance,
    visibility: body.visibility,
    foregroundPixelCount: segmentation.foregroundPixelCount,
    retainedComponentCount: components.retainedComponents.length,
  };
}

export function detectBody(analysis: ComponentAnalysis): BodyDetection | null {
  const candidate = analysis.largestComponent;
  if (!candidate) {
    return null;
  }
  const totalRetainedArea = analysis.retainedComponents.reduce((sum, component) => sum + component.areaPixels, 0);
  const dominance = totalRetainedArea > 0
    ? candidate.areaPixels /
    totalRetainedArea
    : 0;
  let visibility: BodyDetection['visibility'] = 'visible';
  if (dominance < 0.6) {
    visibility = 'partial';
  }
  return {
    x: candidate.centroidX,
    y: candidate.centroidY,
    areaPixels: candidate.areaPixels,
    minX: candidate.minX,
    minY: candidate.minY,
    maxX: candidate.maxX,
    maxY: candidate.maxY,
    visibility,
    dominance,
  };
}
