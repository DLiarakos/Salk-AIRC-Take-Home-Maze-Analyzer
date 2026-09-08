import type { FrameTiming, VideoMetadata } from '../models/media';
import type {RepresentativeFrame,BackgroundModel,ArenaCalibration,BodyTrack,SegmentationSettings} from '../models/tracking';


export type DecoderRequest =
  | { type: 'decode-file'; file: File }
  | {
    type: 'track-file';

    file: File;

    background:
      BackgroundModel;

    calibration:
      ArenaCalibration;

    settings:
      SegmentationSettings;
  }
  | { type: 'cancel' };

export type DecoderResponse =
  | { type: 'capabilities'; webCodecs: boolean }
  | { type: 'metadata'; metadata: VideoMetadata }
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
  | { type: 'frame-timings'; frames: FrameTiming[] }
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
  | { type: 'error'; message: string; detail?: string };
  
