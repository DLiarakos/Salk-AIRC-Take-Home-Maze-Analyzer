/**
 * Typed message protocol shared by the main thread and video-decoder/tracking worker.
 *
 * Inputs:
 * - Decode, track, or cancel requests carrying source files and required analysis state.
 *
 * Outputs:
 * - Discriminated response messages for capabilities, metadata, progress, timings, background/preview data, tracks, and errors.
 *
 * Main definitions:
 * - DecoderRequest and DecoderResponse provide the compile-time contract for worker communication.
 */
import type { FrameTiming, VideoMetadata } from '../models/media';
import type {
  RepresentativeFrame, BackgroundModel, ArenaCalibration, BodyTrack, SegmentationSettings,
} from '../models/tracking';

export type DecoderRequest =
  | {
    type: 'decode-file';
    file: File;
  }
  | {
    type: 'track-file';
    file: File;
    background: BackgroundModel;
    calibration: ArenaCalibration;
    settings: SegmentationSettings;
  }
  | {
    type: 'cancel';
  };

export type DecoderResponse =
  | {
    type: 'capabilities';
    webCodecs: boolean;
  }
  | {
    type: 'metadata';
    metadata: VideoMetadata;
  }
  | {
    type: 'progress';
    phase: 'reading' | 'demuxing' | 'decoding';
    completed: number;
    total: number | null;
  }
  | {
    type: 'background-model';
    background: BackgroundModel;
  }
  | {
    type: 'representative-frame';
    frame: RepresentativeFrame;
  }
  | {
    type: 'frame-timings';
    frames: FrameTiming[];
  }
  | {
    type: 'done';
    decodedFrames: number;
    firstTimestampUs: number | null;
    lastTimestampUs: number | null;
  }
  | {
    type: 'tracking-progress';
    completed: number;
    total: number;
  }
  | {
    type: 'track-complete';
    track: BodyTrack;
  }
  | {
    type: 'error';
    message: string;
    detail?: string;
  };
