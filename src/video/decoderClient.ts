import type { FrameTiming, VideoMetadata } from '../models/media';
import type { DecoderRequest, DecoderResponse } from './messages';
import {validateFrameTimings,type TimingValidation,} from './timingValidation';
import type {RepresentativeFrame,} from '../models/tracking';
import type {BackgroundModel,} from '../models/tracking';

export interface DecodeResult {
  metadata: VideoMetadata;
  frames: FrameTiming[];
  decodedFrames: number;
  timingValidation: TimingValidation;
  representativeFrames:
    RepresentativeFrame[];
  background:
  BackgroundModel | null;
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
  let background: BackgroundModel | null = null;
  const frames: FrameTiming[] = [];
  const representativeFrames:
  RepresentativeFrame[] = [];
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
        case 'representative-frame':
          representativeFrames.push(
            message.frame,
          );
          break;
        case 'background-model':
          
          background =
            message.background;
          
          break;
          
       case 'done':
          if (!metadata) {
            reject(
              new Error(
                'Decoder completed without video metadata.',
              ),
            );

            worker.terminate();
            break;
          }

          if (!background) {
            reject(
              new Error(
                'Decoder completed without a background model.',
              ),
            );

            worker.terminate();
            break;
            }
            {
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
            const timingValidation = validateFrameTimings(
              presentationFrames,
              metadata.frameCount,
              message.decodedFrames,
              metadata.trackTimescale,
            );
            resolve({
              metadata,frames: presentationFrames,decodedFrames:message.decodedFrames,timingValidation,representativeFrames, background,
            });
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
export interface ExactReviewFrame {
  requestId: number;

  presentationIndex: number;
  sampleIndex: number;

  pts: FrameTiming['pts'];

  width: number;
  height: number;

  bitmap: ImageBitmap;
}

export interface ExactFrameReviewReady {
  sampleCount: number;

  width: number;
  height: number;
}

interface ReviewFileReadyResponse {
  type: 'review-file-ready';

  sampleCount: number;

  width: number;
  height: number;
}

interface ReviewFrameResponse {
  type: 'review-frame';

  requestId: number;

  presentationIndex: number;
  sampleIndex: number;

  pts: FrameTiming['pts'];

  width: number;
  height: number;

  bitmap: ImageBitmap;
}

interface ReviewErrorResponse {
  type: 'review-error';

  requestId:
    number | null;

  message: string;
}

type ReviewWorkerResponse =
  | ReviewFileReadyResponse
  | ReviewFrameResponse
  | ReviewErrorResponse;

export interface ExactFrameReviewSession {
  ready:
    Promise<ExactFrameReviewReady>;

  requestFrame:
    (
      frame:
        FrameTiming,
    ) =>
      Promise<ExactReviewFrame>;

  close:
    () => void;
}

export function createExactFrameReviewSession(
  file: File,
): ExactFrameReviewSession {
  const worker =
    new Worker(
      new URL(
        '../workers/videoDecoder.worker.ts',
        import.meta.url,
      ),
      {
        type: 'module',

        name:
          'barnes-exact-frame-review',
      },
    );

  let closed =
    false;

  let nextRequestId =
    1;

  let readyResolve!:
    (
      value:
        ExactFrameReviewReady,
    ) => void;

  let readyReject!:
    (
      reason:
        unknown,
    ) => void;

  const ready =
    new Promise<
      ExactFrameReviewReady
    >(
      (
        resolve,
        reject,
      ) => {
        readyResolve =
          resolve;

        readyReject =
          reject;
      },
    );

  const pending =
    new Map<
      number,
      {
        resolve:
          (
            frame:
              ExactReviewFrame,
          ) => void;

        reject:
          (
            reason:
              unknown,
          ) => void;
      }
    >();

  function rejectPending(
    reason: unknown,
  ) {
    for (
      const request of
      pending.values()
    ) {
      request.reject(
        reason,
      );
    }

    pending.clear();
  }

  worker.addEventListener(
    'message',
    (
      event:
        MessageEvent<
          ReviewWorkerResponse |
          DecoderResponse
        >,
    ) => {
      const message =
        event.data;

      if (
        message.type ===
        'review-file-ready'
      ) {
        readyResolve({
          sampleCount:
            message.sampleCount,

          width:
            message.width,

          height:
            message.height,
        });

        return;
      }

      if (
        message.type ===
        'review-frame'
      ) {
        const request =
          pending.get(
            message.requestId,
          );

        if (!request) {
          /*
           * This response belonged to a
           * superseded UI request.
           */
          message.bitmap.close();

          return;
        }

        pending.delete(
          message.requestId,
        );

        request.resolve(
          message,
        );

        return;
      }

      if (
        message.type ===
        'review-error'
      ) {
        const error =
          new Error(
            message.message,
          );

        if (
          message.requestId ===
          null
        ) {
          readyReject(
            error,
          );

          rejectPending(
            error,
          );

          return;
        }

        const request =
          pending.get(
            message.requestId,
          );

        if (request) {
          pending.delete(
            message.requestId,
          );

          request.reject(
            error,
          );
        }
      }
    },
  );

  worker.addEventListener(
    'error',
    (event) => {
      const error =
        new Error(
          event.message ||
          'Exact-frame review worker crashed.',
        );

      readyReject(
        error,
      );

      rejectPending(
        error,
      );
    },
  );

  worker.postMessage({
    type:
      'open-review-file',

    file,
  });

  return {
    ready,

    async requestFrame(
      frame:
        FrameTiming,
    ) {
      if (closed) {
        throw new DOMException(
          'Exact-frame review session is closed.',
          'AbortError',
        );
      }

      if (
        frame.presentationIndex ===
        null
      ) {
        throw new Error(
          'Cannot review a frame without a presentation index.',
        );
      }

      await ready;

      /*
       * The UI needs only the newest
       * requested frame.
       */
      for (
        const [
          requestId,
          request,
        ] of pending
      ) {
        request.reject(
          new DOMException(
            'Superseded by a newer exact-frame request.',
            'AbortError',
          ),
        );

        pending.delete(
          requestId,
        );
      }

      const requestId =
        nextRequestId++;

      return new Promise<
        ExactReviewFrame
      >(
        (
          resolve,
          reject,
        ) => {
          pending.set(
            requestId,
            {
              resolve,
              reject,
            },
          );

          worker.postMessage({
            type:
              'decode-review-frame',

            requestId,

            targetPresentationIndex:
              frame
                .presentationIndex,

            targetSampleIndex:
              frame
                .sampleIndex,
          });
        },
      );
    },

    close() {
      if (closed) {
        return;
      }

      closed =
        true;

      rejectPending(
        new DOMException(
          'Exact-frame review session closed.',
          'AbortError',
        ),
      );

      worker.terminate();
    },
  };
}