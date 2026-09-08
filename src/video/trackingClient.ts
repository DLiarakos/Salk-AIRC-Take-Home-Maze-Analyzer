/**
 * Main-thread client for running full-file mouse tracking in the video worker.
 *
 * Inputs:
 * - Source File, BackgroundModel, ArenaCalibration, SegmentationSettings, and optional progress callback.
 *
 * Outputs:
 * - Cancellable Promise resolving to the automatic BodyTrack plus incremental TrackingProgress updates.
 *
 * Main function:
 * - trackVideoFile() sends tracking inputs to the worker and resolves only the tracking-specific worker responses.
 */
import type { ArenaCalibration, BackgroundModel, BodyTrack, SegmentationSettings } from '../models/tracking';
import type { DecoderRequest, DecoderResponse } from './messages';

export interface TrackingProgress {
  completed: number;
  total: number;
}

export function trackVideoFile(
  file: File,
  background: BackgroundModel,
  calibration: ArenaCalibration,
  settings: SegmentationSettings,
  onProgress?: (progress: TrackingProgress) => void,
): {
  promise: Promise<BodyTrack>;
  cancel: () => void;
} {
  const worker = new Worker(new URL('../workers/videoDecoder.worker.ts', import.meta.url), {
    type: 'module',
    name: 'barnes-body-tracker',
  });
  let rejectTask: (reason?: unknown) => void = () => { };
  const promise = new Promise<BodyTrack>((resolve, reject) => {
    rejectTask =
      reject;
    worker.addEventListener('message', (event: MessageEvent<DecoderResponse>) => {
      const message = event.data;
      switch (message.type) {
        case 'tracking-progress':
          onProgress?.({
            completed: message.completed,
            total: message.total,
          });
          break;
        case 'track-complete':
          resolve(message.track);
          worker.terminate();
          break;
        case 'error':
          reject(new Error(message.detail
            ? `${message.message}: ${message.detail}`
            : message.message));
          worker.terminate();
          break;
        default:
          /*
           * capabilities and decode-pass
           * messages are irrelevant here.
          */
          break;
      }
    });
    worker.addEventListener('error', (event) => {
      reject(new Error(event.message ||
        'Mouse tracking worker crashed.'));
      worker.terminate();
    });
    const request: DecoderRequest = {
      type: 'track-file',
      file,
      /*
       * Do NOT transfer background.pixels.
       *
       * We still need the background on the
       * main thread for preview/QC.
       * Structured clone of ~307 KB is fine.
      */
      background,
      calibration,
      settings,
    };
    worker.postMessage(request);
  });
  return {
    promise,
    cancel: () => {
      const request: DecoderRequest = {
        type: 'cancel',
      };
      worker.postMessage(request);
      worker.terminate();
      rejectTask(new DOMException('Mouse tracking was cancelled.', 'AbortError'));
    },
  };
}
