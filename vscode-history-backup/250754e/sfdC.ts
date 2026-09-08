import type { FrameTiming, VideoMetadata } from '../models/media';
import type { DecoderRequest, DecoderResponse } from './messages';
import {
  validateFrameTimings,
  type TimingValidation,
} from './timingValidation';
export interface DecodeResult {
  metadata: VideoMetadata;
  frames: FrameTiming[];
  decodedFrames: number;
}

export function decoderCapabilities(): { webCodecs: boolean } {
  return {
    webCodecs: typeof VideoDecoder !== 'undefined' && typeof VideoFrame !== 'undefined',
  };
}

export function decodeVideoFile(
  file: File,
  onProgress?: (message: Extract<DecoderResponse, { type: 'progress' }>) => void,
): { promise: Promise<DecodeResult>; cancel: () => void } {
  const worker = new Worker(new URL('../workers/videoDecoder.worker.ts', import.meta.url), {
    type: 'module',
    name: 'barnes-video-decoder',
  });

  let metadata: VideoMetadata | null = null;
  const frames: FrameTiming[] = [];

  let rejectTask: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<DecodeResult>((resolve, reject) => {
    rejectTask = reject;
    worker.addEventListener('message', (event: MessageEvent<DecoderResponse>) => {
      const message = event.data;

      switch (message.type) {
        case 'metadata':
          metadata = message.metadata;
          break;
        case 'frame-timings':
          frames.push(...message.frames);
          break;
        case 'progress':
          onProgress?.(message);
          break;
        case 'done':
          if (!metadata) {
            reject(new Error('Decoder completed without video metadata.'));
          } else {
            // Do not assume callback order. Scientific processing will consume
            // presentation order explicitly.
            frames.sort(
              (a, b) =>
                a.pts.ticks / a.pts.timescale - b.pts.ticks / b.pts.timescale ||
                a.sampleIndex - b.sampleIndex,
            );
            const presentationFrames = frames.map((frame, presentationIndex) => ({
              ...frame,
              presentationIndex,
            }));
            resolve({ metadata, frames: presentationFrames, decodedFrames: message.decodedFrames });
            
          }
          worker.terminate();
          break;
        case 'error':
          reject(new Error(message.detail ? `${message.message}: ${message.detail}` : message.message));
          worker.terminate();
          break;
        case 'capabilities':
          break;
      }
    });

    worker.addEventListener('error', (event) => {
      reject(new Error(event.message || 'Video decoder worker crashed.'));
      worker.terminate();
    });

    const request: DecoderRequest = { type: 'decode-file', file };
    worker.postMessage(request);
  });

  return {
    promise,
    cancel: () => {
      const request: DecoderRequest = { type: 'cancel' };
      worker.postMessage(request);
      worker.terminate();
      rejectTask?.(new DOMException('Video analysis was cancelled.', 'AbortError'));
      rejectTask = null;
    },
  };
}
