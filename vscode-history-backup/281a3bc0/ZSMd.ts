/// <reference lib="webworker" />
import * as MP4Box from 'mp4box';
import type { FrameTiming, RationalTime, VideoMetadata } from '../models/media';
import type { DecoderRequest, DecoderResponse } from '../video/messages';
import { timeToWebCodecsMicroseconds } from '../video/time';
import {processRepresentativeFrame,} from '../tracking/frameProcessor';
import type {BackgroundSample,BodyTrack, BodyTrackPoint} from '../models/tracking';
import {copyGrayscale,} from '../tracking/grayscale';
import {buildTemporalMedianBackground,} from '../tracking/segmentation';
import {createArenaMask,} from '../tracking/arenaMask';
import {trackBodyFrame,} from '../tracking/bodyTracker';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const FILE_CHUNK_BYTES = 1 * 1024 * 1024;
const EXTRACTION_BATCH_SAMPLES = 64;
const MAX_DECODE_QUEUE = 64;
const TIMING_BATCH_SIZE = 250;
const DEBUG_DECODER = false;

function debugDecoder(
  message: string,
  data?: unknown,
): void {
  if (!DEBUG_DECODER) return;

  if (data !== undefined) {
    console.log(
      `[Barnes decoder] ${message}`,
      data,
    );
  } else {
    console.log(
      `[Barnes decoder] ${message}`,
    );
  }
}
interface Mp4ArrayBuffer extends ArrayBuffer {
  fileStart: number;
}

interface Mp4VideoTrack {
  id: number;
  codec: string;
  timescale: number;
  duration: number;
  nb_samples: number;
  video: { width: number; height: number };
}

interface Mp4Info {
  duration: number;
  timescale: number;
  tracks: Array<{ id: number; type?: string; codec?: string }>;
  videoTracks: Mp4VideoTrack[];
  audioTracks: unknown[];
}

interface Mp4Sample {
  number?: number;
  is_sync?: boolean;
  is_rap?: boolean;
  cts: number;
  dts: number;
  duration: number;
  timescale: number;
  data: Uint8Array;
}

interface OpenReviewFileRequest {
  type:
    'open-review-file';

  file: File;
}

interface DecodeReviewFrameRequest {
  type:
    'decode-review-frame';

  requestId:
    number;

  targetPresentationIndex:
    number;

  targetSampleIndex:
    number;
}

type ExtendedDecoderRequest =
  | DecoderRequest
  | OpenReviewFileRequest
  | DecodeReviewFrameRequest;

interface ReviewFileReadyResponse {
  type:
    'review-file-ready';

  sampleCount:
    number;

  width:
    number;

  height:
    number;
}

interface ReviewFrameResponse {
  type:
    'review-frame';

  requestId:
    number;

  presentationIndex:
    number;

  sampleIndex:
    number;

  pts:
    RationalTime;

  width:
    number;

  height:
    number;

  bitmap:
    ImageBitmap;
}

interface ReviewErrorResponse {
  type:
    'review-error';

  requestId:
    number | null;

  message:
    string;
}

type ExtendedDecoderResponse =
  | DecoderResponse
  | ReviewFileReadyResponse
  | ReviewFrameResponse
  | ReviewErrorResponse;

interface CachedReviewSample {
  sampleIndex:
    number;

  pts:
    RationalTime;

  duration:
    RationalTime;

  /*
   * Original source PTS converted to
   * WebCodecs units. Retained only as
   * source timing metadata.
   */
  timestampUs:
    number;

  /*
   * Unique review-decoder identity.
   *
   * This is deliberately NOT scientific
   * time. It prevents duplicate source PTS
   * from collapsing onto the same
   * WebCodecs timestamp.
   */
  decoderTimestampUs:
    number;

  isKeyFrame:
    boolean;

  data:
    Uint8Array;
}

let cancelled = false;

let reviewSamples:
  CachedReviewSample[] = [];

let reviewDecoderConfig:
  VideoDecoderConfig |
  null = null;

let reviewWidth =
  0;

let reviewHeight =
  0;

let latestReviewRequestId =
  0;

let reviewDecodeChain =
  Promise.resolve();

function post(
  message: ExtendedDecoderResponse,
  transfer: Transferable[] = [],
): void {
  ctx.postMessage(
    message,
    transfer,
  );
}

function asRational(ticks: number, timescale: number): RationalTime {
  if (!Number.isSafeInteger(ticks) || !Number.isSafeInteger(timescale)) {
    throw new Error(`Unsafe MP4 timestamp ${ticks}/${timescale}.`);
  }
  return { ticks, timescale };
}

function mp4SampleIsKey(sample: Mp4Sample): boolean {
  return Boolean(sample.is_sync ?? sample.is_rap);
}

/**
 * WebCodecs needs AVCDecoderConfigurationRecord bytes (the payload of avcC),
 * not the MP4 box header. This follows the W3C WebCodecs MP4 sample pattern.
 */
function getCodecDescription(mp4File: any, trackId: number): Uint8Array {
  const track = mp4File.getTrackById(trackId);
  const entries = track?.mdia?.minf?.stbl?.stsd?.entries ?? [];

  for (const entry of entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (!box) continue;

    const DataStream = (MP4Box as any).DataStream;
    const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
    box.write(stream);

    // First 8 bytes are the ordinary MP4 box size/type header.
    return new Uint8Array(stream.buffer, 8);
  }

  throw new Error('No supported codec configuration box (avcC/hvcC/vpcC/av1C) found.');
}

const RESUME_DECODE_QUEUE = 32;
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  return Promise.race([
    promise,

    new Promise<T>((_, reject) => {
      ctx.setTimeout(() => {
        reject(
          new Error(
            `${description} timed out after ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);
    }),
  ]);
}
function waitForDecodeQueue(
  decoder: VideoDecoder,
): Promise<void> {
  if (decoder.state === 'closed') {
    return Promise.reject(
      new Error('VideoDecoder closed unexpectedly.'),
    );
  }

  if (
    decoder.decodeQueueSize <
    MAX_DECODE_QUEUE
  ) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (decoder.state === 'closed') {
        cleanup();

        reject(
          new Error(
            'VideoDecoder closed while waiting for decode capacity.',
          ),
        );

        return;
      }

      if (
        decoder.decodeQueueSize <=
        RESUME_DECODE_QUEUE
      ) {
        cleanup();
        resolve();
      }
    };
    
    const timer =
      ctx.setInterval(check, 10);

    const cleanup = () => {
      decoder.removeEventListener(
        'dequeue',
        check,
      );

      ctx.clearInterval(timer);
    };

    decoder.addEventListener(
      'dequeue',
      check,
    );

    // Recheck after installing the listener.
    check();
  });
}
function evenlySpacedIndices(
  frameCount: number,
  requestedCount: number,
): number[] {
  if (
    frameCount <= 0 ||
    requestedCount <= 0
  ) {
    return [];
  }

  const count =
    Math.min(
      frameCount,
      requestedCount,
    );

  if (count === 1) {
    return [0];
  }

  const lastIndex =
    frameCount - 1;

  const indices =
    new Set<number>();

  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    indices.add(
      Math.round(
        (i * lastIndex) /
        (count - 1),
      ),
    );
  }

  return [
    ...indices,
  ];
}

async function openReviewFile(
  file: File,
): Promise<void> {
  cancelled =
    false;

  reviewSamples =
    [];

  reviewDecoderConfig =
    null;

  reviewWidth =
    0;

  reviewHeight =
    0;

  latestReviewRequestId =
    0;

  const mp4File =
    (MP4Box as any)
      .createFile(
        true,
      );

  let videoTrack:
    Mp4VideoTrack |
    null = null;

  let nextSampleIndex =
    0;

  let extractionComplete =
    false;

  let demuxReadyResolve!:
    (
      track:
        Mp4VideoTrack,
    ) => void;

  let demuxReadyReject!:
    (
      reason:
        unknown,
    ) => void;

  const demuxReady =
    new Promise<
      Mp4VideoTrack
    >(
      (
        resolve,
        reject,
      ) => {
        demuxReadyResolve =
          resolve;

        demuxReadyReject =
          reject;
      },
    );

  let extractionDoneResolve!:
    () => void;

  let extractionDoneReject!:
    (
      reason:
        unknown,
    ) => void;

  const extractionDone =
    new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        extractionDoneResolve =
          resolve;

        extractionDoneReject =
          reject;
      },
    );

  mp4File.onError =
    (
      error:
        unknown,
    ) => {
      demuxReadyReject(
        error,
      );

      extractionDoneReject(
        error,
      );
    };

  mp4File.onReady =
    async (
      info:
        Mp4Info,
    ) => {
      try {
        const track =
          info.videoTracks?.[0];

        if (!track) {
          throw new Error(
            'No video track found for exact-frame review.',
          );
        }

        if (
          !track.codec.startsWith(
            'avc1',
          ) &&
          !track.codec.startsWith(
            'avc3',
          )
        ) {
          throw new Error(
            `Exact-frame review currently supports H.264/AVC MP4 only; found ${track.codec}.`,
          );
        }

        const config:
          VideoDecoderConfig = {
            codec:
              track.codec,

            codedWidth:
              track.video.width,

            codedHeight:
              track.video.height,

            description:
              getCodecDescription(
                mp4File,
                track.id,
              ),
          };

        const support =
          await VideoDecoder
            .isConfigSupported(
              config,
            );

        if (
          !support.supported
        ) {
          throw new Error(
            `Browser cannot decode exact review frames for ${track.codec}.`,
          );
        }

        videoTrack =
          track;

        reviewDecoderConfig =
          support.config ??
          config;

        reviewWidth =
          track.video.width;

        reviewHeight =
          track.video.height;

        mp4File
          .setExtractionOptions(
            track.id,
            null,
            {
              nbSamples:
                EXTRACTION_BATCH_SAMPLES,

              rapAlignement:
                false,
            },
          );

        mp4File.start();

        demuxReadyResolve(
          track,
        );
      } catch (error) {
        demuxReadyReject(
          error,
        );

        extractionDoneReject(
          error,
        );
      }
    };

  mp4File.onSamples =
    (
      trackId:
        number,

      _user:
        unknown,

      samples:
        Mp4Sample[],
    ) => {
      if (!videoTrack) {
        extractionDoneReject(
          new Error(
            'Exact-review samples arrived before track initialization.',
          ),
        );

        return;
      }

      for (
        const sample of
        samples
      ) {
        const pts =
          asRational(
            sample.cts,
            sample.timescale,
          );

        const duration =
          asRational(
            sample.duration,
            sample.timescale,
          );

       const sampleIndex =
  nextSampleIndex++;

reviewSamples.push({
  sampleIndex,

  pts,

  duration,

  timestampUs:
    timeToWebCodecsMicroseconds(
      pts,
    ),

  /*
   * One unique microsecond identity per
   * encoded MP4 sample.
   *
   * Do not interpret this as source time.
   */
  decoderTimestampUs:
    sampleIndex,

  isKeyFrame:
    mp4SampleIsKey(
      sample,
    ),

  /*
   * Own one compressed copy so
   * MP4Box buffers can be released.
   */
  data:
    sample.data.slice(),
});
      }
      const last =
        samples.at(-1);

      const deliveredAll =
        reviewSamples.length >=
        videoTrack.nb_samples;

      const deliveredFinalSample =
        last?.number !==
          undefined &&
        last.number + 1 >=
          videoTrack
            .nb_samples;

      if (
        !extractionComplete &&
        (
          deliveredAll ||
          deliveredFinalSample
        )
      ) {
        extractionComplete =
          true;

        extractionDoneResolve();
      }

      if (
        last?.number !==
        undefined
      ) {
        mp4File
          .releaseUsedSamples(
            trackId,
            last.number + 1,
          );
      }
    };

  /*
   * Read the local source once.
   *
   * Subsequent requested review frames use
   * the cached compressed samples.
   */
  let offset =
    0;

  while (
    offset <
    file.size
  ) {
    if (cancelled) {
      return;
    }

    const end =
      Math.min(
        offset +
          FILE_CHUNK_BYTES,
        file.size,
      );

    const buffer =
      (
        await file
          .slice(
            offset,
            end,
          )
          .arrayBuffer()
      ) as Mp4ArrayBuffer;

    buffer.fileStart =
      offset;

    mp4File.appendBuffer(
      buffer,
    );

    offset =
      end;
  }

  const readyTrack =
    await demuxReady;

  mp4File.flush();

  await extractionDone;

  if (
    reviewSamples.length !==
    readyTrack.nb_samples
  ) {
    throw new Error(
      `Exact-review cache contains ${reviewSamples.length} samples; expected ${readyTrack.nb_samples}.`,
    );
  }

  post({
    type:
      'review-file-ready',

    sampleCount:
      reviewSamples.length,

    width:
      reviewWidth,

    height:
      reviewHeight,
  });
}

async function decodeReviewFrame(
  request:
    DecodeReviewFrameRequest,
): Promise<void> {
  if (
    !reviewDecoderConfig ||
    reviewSamples.length ===
      0
  ) {
    throw new Error(
      'Exact-frame review file has not finished opening.',
    );
  }

  const target =
    reviewSamples[
      request
        .targetSampleIndex
    ];

  if (!target) {
    throw new Error(
      `Exact review sample ${request.targetSampleIndex} does not exist.`,
    );
  }

  /*
   * Begin decoding at the nearest preceding
   * random-access sample in DECODE order.
   */
  let startSampleIndex =
    request
      .targetSampleIndex;

  while (
    startSampleIndex >
      0 &&
    !reviewSamples[
      startSampleIndex
    ].isKeyFrame
  ) {
    startSampleIndex -=
      1;
  }

  if (
    !reviewSamples[
      startSampleIndex
    ].isKeyFrame
  ) {
    throw new Error(
      `No preceding H.264 key frame found for sample ${request.targetSampleIndex}.`,
    );
  }

const pendingByDecoderTimestamp =
  new Map<
    number,
    CachedReviewSample
  >();

let resolveBitmap!:
  (
    bitmap:
      ImageBitmap,
  ) => void;

let rejectBitmap!:
  (
    reason:
      unknown,
  ) => void;

const bitmapPromise =
  new Promise<ImageBitmap>(
    (
      resolve,
      reject,
    ) => {
      resolveBitmap =
        resolve;

      rejectBitmap =
        reject;
    },
  );

let decoderFailure:
  unknown = null;

  const decoder =
    new VideoDecoder({
      output:
        (
          frame:
            VideoFrame,
        ) => {
         const source =
  pendingByDecoderTimestamp.get(
    frame.timestamp,
  );

if (source) {
  pendingByDecoderTimestamp.delete(
    frame.timestamp,
  );
}

if (!source) {
            frame.close();

            decoderFailure =
              new Error(
                `Exact-review decoded timestamp ${frame.timestamp} µs had no matching submitted source sample.`,
              );

            return;
          }

         if (
  source.sampleIndex ===
  request
    .targetSampleIndex
) {
  /*
   * Convert the exact requested decoded
   * VideoFrame into a transferable bitmap.
   *
   * Keep the VideoFrame open until
   * createImageBitmap() has finished.
   */
  createImageBitmap(
    frame,
  )
    .then(
      (
        bitmap,
      ) => {
        resolveBitmap(
          bitmap,
        );
      },
      (
        error,
      ) => {
        rejectBitmap(
          error,
        );
      },
    )
    .finally(
      () => {
        frame.close();
      },
    );

  return;
}

          frame.close();
        },

      error:
  (
    error,
  ) => {
    decoderFailure =
      error;

    rejectBitmap(
      error,
    );
  },
    });

  decoder.configure(
    reviewDecoderConfig,
  );

  for (
    let sampleIndex =
      startSampleIndex;
    sampleIndex <=
      request
        .targetSampleIndex;
    sampleIndex += 1
  ) {
    const sample =
      reviewSamples[
        sampleIndex
      ];

 pendingByDecoderTimestamp.set(
  sample.decoderTimestampUs,
  sample,
);

decoder.decode(
  new EncodedVideoChunk({
    type:
      sample.isKeyFrame
        ? 'key'
        : 'delta',

    /*
     * Review-only identity timestamp.
     *
     * Exact scientific PTS remains in
     * sample.pts and is never replaced by
     * this value.
     */
    timestamp:
      sample.decoderTimestampUs,

        duration:
          timeToWebCodecsMicroseconds(
            sample.duration,
          ),

        data:
          sample.data,
      }),
    );
  }

  await withTimeout(
  decoder.flush(),
  10_000,
  'Exact-frame VideoDecoder.flush()',
);

if (decoderFailure) {
  decoder.close();

  throw decoderFailure;
}

/*
 * flush() guarantees that WebCodecs has
 * emitted all frames it can from the
 * submitted chunk sequence.
 *
 * The separate timeout also prevents a
 * missing target frame from leaving the
 * reviewer waiting indefinitely.
 */
const bitmap =
  await withTimeout(
    bitmapPromise,
    10_000,
    `Exact review sample ${request.targetSampleIndex}`,
  );

decoder.close();
  /*
   * If the user already selected another
   * source frame, do not send a stale image.
   */
  if (
    request.requestId !==
    latestReviewRequestId
  ) {
    bitmap.close();

    return;
  }

  post(
    {
      type:
        'review-frame',

      requestId:
        request.requestId,

      presentationIndex:
        request
          .targetPresentationIndex,

      sampleIndex:
        target.sampleIndex,

      pts:
        target.pts,

      width:
        reviewWidth,

      height:
        reviewHeight,

      bitmap,
    },
    [
      bitmap,
    ],
  );
}

async function decodeFile(file: File): Promise<void> {
  cancelled = false;

  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') {
    throw new Error(
      'This browser does not provide WebCodecs VideoDecoder. Use a current Chrome, Edge, Firefox, or Safari build.',
    );
  }

  const mp4File = (MP4Box as any).createFile(true);
  debugDecoder(
  '[Barnes decoder] discardMdatData:',
  mp4File.discardMdatData,
);

  let videoTrack: Mp4VideoTrack | null = null;
  let decoder: VideoDecoder | null = null;
  let decodedFrames = 0;
  let nextSampleIndex = 0;
  let minTimestampUs: number | null = null;
  let maxTimestampUs: number | null = null;
  let minPtsTicks: number | null = null;
  let maxPtsTicks: number | null = null;
  let timingBatch: FrameTiming[] = [];
  let submittedSampleCount = 0;
  let extractedSampleCount = 0;
  let extractionComplete = false;
  const rawSamplePts: number[] = [];
  const rawSampleDurations: number[] = [];
  let representativeIndices = new Set<number>();
  const representativePromises: Promise<void>[] = [];
  const samplesByPts = new Map<number, number[]>();
  let backgroundSampleIndices =
  new Set<number>();

const backgroundSamples:
  BackgroundSample[] = [];

const backgroundSamplePromises:
  Promise<void>[] = [];
  
  let demuxReadyResolve!: (
    track: Mp4VideoTrack
  ) => void;
  let demuxReadyReject!: (reason: unknown) => void;
  const demuxReady =
  new Promise<Mp4VideoTrack>((resolve, reject) => {
    demuxReadyResolve = resolve;
    demuxReadyReject = reject;
  });

  // WebCodecs outputs the timestamp we supplied, rounded to integer microseconds.
  // Preserve the exact source MP4 time separately and look it up here.
  const pendingTimingByTimestamp = new Map<number, FrameTiming[]>();

  const emitTiming = (timing: FrameTiming) => {
    timingBatch.push(timing);
    if (timingBatch.length >= TIMING_BATCH_SIZE) {
      post({ type: 'frame-timings', frames: timingBatch });
      timingBatch = [];
    }
  };

  const decoderOutput = (frame: VideoFrame) => {
    try {
      const queue = pendingTimingByTimestamp.get(frame.timestamp);
      const timing = queue?.shift();
      if (queue && queue.length === 0) pendingTimingByTimestamp.delete(frame.timestamp);

      if (!timing) {
        throw new Error(`Decoded frame timestamp ${frame.timestamp} µs had no matching MP4 sample.`);
      }
      const decodedIndex = decodedFrames;
      if (backgroundSampleIndices.has(decodedIndex,)) {
          const sampleFrame =
            frame.clone();

          const samplePromise =
            copyGrayscale(
              sampleFrame,
            )
              .then((grayscale) => {
                backgroundSamples.push({
                  decodedIndex,
                  pixels:
                    grayscale.pixels,
                });
              })
              .finally(() => {
                sampleFrame.close();
              });

          backgroundSamplePromises.push(
            samplePromise,
          );
        }
      if (
        representativeIndices.has(
          decodedIndex,
        )
      ) {
        const previewFrame =
          frame.clone();

        const previewPromise =
          processRepresentativeFrame(
            previewFrame,
            timing,
            decodedIndex,
          )
            .then((preview) => {
              post(
                {
                  type:
                    'representative-frame',

                  frame: preview,
                },

                [
                  preview.pixels.buffer,
                ],
              );
            })
            .finally(() => {
              previewFrame.close();
            });

        representativePromises.push(
          previewPromise,
        );
      }
      emitTiming(timing);

      decodedFrames += 1;
  if (
    minTimestampUs === null ||
    frame.timestamp < minTimestampUs
  ) {
    minTimestampUs = frame.timestamp;
  }

  if (
    maxTimestampUs === null ||
    frame.timestamp > maxTimestampUs
  ) {
    maxTimestampUs = frame.timestamp;
  }
  const ticks = timing.pts.ticks;

  if (
    minPtsTicks === null ||
    ticks < minPtsTicks
  ) {
    minPtsTicks = ticks;
  }

  if (
    maxPtsTicks === null ||
    ticks > maxPtsTicks
  ) {
    maxPtsTicks = ticks;
  }
        if (decodedFrames < 5) {
          debugDecoder(
            '[Barnes decoder] output frame',
            {
              timestampUs: frame.timestamp,
              queueSize:
                decoder?.decodeQueueSize ?? null,
            },
          );
        }
        if ( decodedFrames==1 ||
          decodedFrames % 10 === 0) {
          post({
            type: 'progress',
            phase: 'decoding',
            completed: decodedFrames,
            total: videoTrack?.nb_samples ?? null,
          });
        }
    } finally {
      // Critical for long batches: release graphics-backed frame memory now.
      frame.close();
    }
  };

  let sampleChain = Promise.resolve();
  let extractionDoneResolve!: () => void;
  let extractionDoneReject!: (reason: unknown) => void;

  const extractionDone = new Promise<void>((resolve, reject) => {
    extractionDoneResolve = resolve;
    extractionDoneReject = reject;
});

  mp4File.onError = (error: unknown) => {
    demuxReadyReject(error);
    extractionDoneReject(error);
  };

  mp4File.onReady = async (info: Mp4Info) => {
    try {
      const track = info.videoTracks?.[0];
      if (!track) throw new Error('No video track found in MP4 file.');
      if (!track.codec.startsWith('avc1') && !track.codec.startsWith('avc3')) {
        throw new Error(`Initial version supports H.264/AVC MP4 only; found codec ${track.codec}.`);
      }

      videoTrack = track;

      const config: VideoDecoderConfig = {
        codec: track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description: getCodecDescription(mp4File, track.id),
      };

      const support = await VideoDecoder.isConfigSupported(config);
      if (!support.supported) {
        throw new Error(`Browser cannot decode this H.264 configuration (${track.codec}).`);
      }

      decoder = new VideoDecoder({
        output: decoderOutput,
        error: (error) => {
          demuxReadyReject(error);
          extractionDoneReject(error);
        },
      });
      decoder.configure(support.config ?? config);

      const nominalFps =
        track.duration > 0 && 
        track.nb_samples > 1
          ? (
            track.timescale * 
            (track.nb_samples-1)
          ) / track.duration
          : null;
      const lastIndex =
        Math.max(
          0,
          track.nb_samples - 1,
        );

      representativeIndices =
  new Set(
    evenlySpacedIndices(
      track.nb_samples,
      9,
    ),
  );
        backgroundSampleIndices =
  new Set(
    evenlySpacedIndices(
      track.nb_samples,
      21,
    ),
  );
      const metadata: VideoMetadata = {
        identity: {
          name: file.name,
          sizeBytes: file.size,
          lastModifiedMs: file.lastModified,
        },
        codec: track.codec,
        width: track.video.width,
        height: track.video.height,
        frameCount: track.nb_samples,
        trackId: track.id,
        trackTimescale: track.timescale,
        trackDurationTicks: track.duration,
        movieTimescale: info.timescale,
        movieDurationTicks: info.duration,
        nominalFps,
        hasAudio: Boolean(info.audioTracks?.length),
      };
      post({ type: 'metadata', metadata });

      mp4File.setExtractionOptions(track.id, null, {
        nbSamples: EXTRACTION_BATCH_SAMPLES,
        rapAlignement: false,
      });
      post({
        type: 'progress',
        phase: 'demuxing',
        completed: 0,
        total: track.nb_samples,
      });
      mp4File.start();
      demuxReadyResolve(track);
    } catch (error) {
      demuxReadyReject(error);
    }
  };


mp4File.onSamples = (
  trackId: number,
  _user: unknown,
  samples: Mp4Sample[],
) => {

  if (!videoTrack) {
    extractionDoneReject(
      new Error(
        'MP4Box delivered samples before video track initialization.',
      ),
    );

    return;
  }
  const first = samples[0];
  const last = samples.at(-1);
  for (const sample of samples) {
  rawSamplePts.push(sample.cts);
  rawSampleDurations.push(sample.duration);

  const sampleNumbers =
    samplesByPts.get(sample.cts) ?? [];

  sampleNumbers.push(sample.number ?? -1);

  samplesByPts.set(
    sample.cts,
    sampleNumbers,
  );
}
  extractedSampleCount += samples.length;
  // MP4Box has already extracted these samples.
  // Record that immediately, before waiting on WebCodecs.
  debugDecoder(
  '[Barnes decoder] MP4Box samples',
  {
    batchSize: samples.length,
    firstSample: samples[0]?.number,
    lastSample: samples.at(-1)?.number,
    extractedSampleCount,
  },
);
post({
    type: 'progress',
    phase: 'demuxing',
    completed: extractedSampleCount,
    total: videoTrack?.nb_samples ?? null,
  });
  const deliveredAllByCount =
    extractedSampleCount >= videoTrack.nb_samples;

  const deliveredFinalSample =
    last?.number !== undefined &&
    last.number + 1 >= videoTrack.nb_samples;

  if (
    !extractionComplete &&
    (
      deliveredAllByCount ||
      deliveredFinalSample
    )
  ) {
    extractionComplete = true;

    debugDecoder(
      '[Barnes decoder] all MP4 samples extracted',
      {
        extractedSampleCount,
        finalSampleNumber: last?.number,
        expectedSamples: videoTrack.nb_samples,
      },
    );
    const sortedRawPts =
  [...rawSamplePts].sort((a, b) => a - b);

  const rawIntervals: number[] = [];

  for (
    let i = 1;
    i < sortedRawPts.length;
    i += 1
  ) {
    rawIntervals.push(
      sortedRawPts[i] -
      sortedRawPts[i - 1],
    );
  }

  const duplicateRawPts = [
    ...samplesByPts.entries(),
  ]
    .filter(
      ([, sampleNumbers]) =>
        sampleNumbers.length > 1,
    );

  debugDecoder(
    '[Barnes decoder] raw MP4 timing summary',
    {
      samples: rawSamplePts.length,

      uniquePts:
        new Set(rawSamplePts).size,

      duplicatePts:
        rawSamplePts.length -
        new Set(rawSamplePts).size,

      uniqueDurations: [
        ...new Set(rawSampleDurations),
      ].sort((a, b) => a - b),

      uniqueIntervals: [
        ...new Set(rawIntervals),
      ].sort((a, b) => a - b),

      firstPts:
        sortedRawPts.at(0),

      lastPts:
        sortedRawPts.at(-1),

      duplicateExamples:
        duplicateRawPts.slice(0, 20),
    },
  );
    extractionDoneResolve();
  }

  sampleChain = sampleChain
    .then(async () => {
      if (cancelled) return;

      if (!decoder || !videoTrack) {
        throw new Error(
          'Received samples before decoder initialization.',
        );
      }

      for (const sample of samples) {
        if (cancelled) return;

        await waitForDecodeQueue(decoder);

        const pts = asRational(
          sample.cts,
          sample.timescale,
        );

        const dts = asRational(
          sample.dts,
          sample.timescale,
        );

        const duration = asRational(
          sample.duration,
          sample.timescale,
        );

        const timestampUs =
          timeToWebCodecsMicroseconds(pts);

        const timing: FrameTiming = {
          sampleIndex: nextSampleIndex++,
          presentationIndex: null,
          pts,
          dts,
          duration,
          webCodecsTimestampUs: timestampUs,
          isKeyFrame: mp4SampleIsKey(sample),
        };

        const timestampQueue =
          pendingTimingByTimestamp.get(timestampUs) ?? [];

        timestampQueue.push(timing);

        pendingTimingByTimestamp.set(
          timestampUs,
          timestampQueue,
        );

        decoder.decode(
          
          new EncodedVideoChunk({
            type: timing.isKeyFrame
              ? 'key'
              : 'delta',
            timestamp: timestampUs,
            duration:
              timeToWebCodecsMicroseconds(duration),
            data: sample.data,
          }),
        );
        submittedSampleCount += 1;
        if (nextSampleIndex <= 5) {
          debugDecoder(
            '[Barnes decoder] submitted chunk',
            {
              sampleIndex: nextSampleIndex - 1,
              timestampUs,
              key: timing.isKeyFrame,
              queueSize: decoder.decodeQueueSize,
            },
          );
        }
      }

      const last = samples.at(-1);

      if (last?.number !== undefined) {
        mp4File.releaseUsedSamples(
          trackId,
          last.number + 1,
        );
      }
    })
    .catch((error) => {
      extractionDoneReject(error);
      throw error;
    });
};

  // Feed the local File incrementally. Do not read the whole MP4 into RAM.
  let offset = 0;
  while (offset < file.size) {
    if (cancelled) return;

    const end = Math.min(offset + FILE_CHUNK_BYTES, file.size);
    const buffer = (await file.slice(offset, end).arrayBuffer()) as Mp4ArrayBuffer;
    buffer.fileStart = offset;
    mp4File.appendBuffer(buffer);
    offset = end;

    post({ type: 'progress', phase: 'reading', completed: offset, total: file.size });
  }
  // All bytes have now been supplied to MP4Box.
  //
  // onReady() may still be finishing asynchronous WebCodecs setup,
  // so wait until extraction has actually been configured and started
  // BEFORE sending MP4Box its final flush.
  const readyTrack = await demuxReady;

  if (cancelled) return;

  mp4File.flush();
  debugDecoder(
    '[Barnes decoder] waiting for extractionDone'
  );
    // MP4Box can now emit the final extraction batch, including a batch
    // smaller than EXTRACTION_BATCH_SAMPLES.
    await extractionDone;
  debugDecoder(
    '[Barnes decoder] extractionDone',
    {
      extractedSampleCount,
      submittedSampleCount,
      decodedFrames,
    },
  );
  debugDecoder(
    '[Barnes decoder] waiting for sampleChain'
  );

  // Ensure our serialized processing chain has finished submitting all
  // extracted samples to WebCodecs.
  await sampleChain;
  debugDecoder(
  '[Barnes decoder] sampleChain complete',
  {
    extractedSampleCount,
    submittedSampleCount,
    decodedFrames,
  },
);

  if (cancelled) return;
  const activeDecoder = decoder as VideoDecoder | null;
  if (!activeDecoder) throw new Error('Decoder was not initialized.');
  debugDecoder(
  '[Barnes decoder] starting flush',
  {
    decodedFrames,
    submittedSampleCount,
    decodeQueueSize:
      activeDecoder.decodeQueueSize,
    decoderState:
      activeDecoder.state,
  },
);
  await withTimeout(
  activeDecoder.flush(),
  10_000,
  'VideoDecoder.flush()',
);

await Promise.all(
  representativePromises,
);
await Promise.all(
  backgroundSamplePromises,
);
backgroundSamples.sort(
  (a, b) =>
    a.decodedIndex -
    b.decodedIndex,
);
if (backgroundSamples.length === 0) {
  throw new Error(
    'No frames were captured for background estimation.',
  );
}
console.log(
  '[Barnes tracking] background samples',
  {
    count:
      backgroundSamples.length,

    indices:
      backgroundSamples.map(
        (sample) =>
          sample.decodedIndex,
      ),
  },
);
console.log("list", backgroundSamples.map(
        (sample) =>
          sample.decodedIndex,
      ),)
const backgroundModel =
  buildTemporalMedianBackground(
    backgroundSamples,
    readyTrack.video.width,
    readyTrack.video.height,
  );
  post(
  {
    type: 'background-model',
    background:
      backgroundModel,
  },
  [
    backgroundModel
      .pixels
      .buffer,
  ],
);
debugDecoder(
  '[Barnes decoder] flush complete',
  {
    decodedFrames,
    submittedSampleCount,
    decodeQueueSize:
      activeDecoder.decodeQueueSize,
  },
);

  post({
  type: 'progress',
  phase: 'decoding',
  completed: decodedFrames,
  total: readyTrack?.nb_samples ?? null,
  });
  activeDecoder.close();

  if (timingBatch.length > 0) {
    post({ type: 'frame-timings', frames: timingBatch });
  }

  if (pendingTimingByTimestamp.size > 0) {
    throw new Error(`${pendingTimingByTimestamp.size} decoded timestamps were not matched to output frames.`);
  }

  post({
    type: 'done',
    decodedFrames,
  firstTimestampUs: minTimestampUs,
  lastTimestampUs: maxTimestampUs,
  });
}
async function trackFile(
  request: Extract<
    DecoderRequest,
    { type: 'track-file' }
  >,
): Promise<void> {
  cancelled = false;

  const {
    file,
    background,
    calibration,
    settings,
  } = request;

  /*
   * Make sure the calibration/background
   * belong to the same image geometry.
   */
  if (
    background.width !==
      calibration.imageWidth ||
    background.height !==
      calibration.imageHeight
  ) {
    throw new Error(
      'Arena calibration dimensions do not match the background model.',
    );
  }

  const arenaMask =
    createArenaMask(
      calibration,
    );

  const mp4File =
    (MP4Box as any).createFile(
      true,
    );

  let videoTrack:
    Mp4VideoTrack | null = null;

  let decoder:
    VideoDecoder | null = null;

  let decodedFrames = 0;
  let submittedSampleCount = 0;
  let extractedSampleCount = 0;
  let nextSampleIndex = 0;

  let extractionComplete =
    false;

const trackPoints:
  BodyTrackPoint[] = [];

/*
 * BodyTrackPoint does not itself retain the
 * MP4 sample index. Keep that identity here
 * until final presentation ordering is assigned.
 */
const trackPointSampleIndex =
  new Map<
    BodyTrackPoint,
    number
  >();

/*
 * WebCodecs receives a unique synthetic
 * timestamp for tracking-frame identity.
 *
 * Exact scientific timing remains in
 * FrameTiming.pts.
 */
const pendingTimingByDecoderTimestamp =
  new Map<
    number,
    FrameTiming
  >();

  /*
   * Processing is deliberately serialized.
   *
   * We don't want multiple full 640×480
   * segmentation operations fighting for
   * CPU/memory on older laptops.
   */
  let trackingChain =
    Promise.resolve();

  let trackingFailure:
    unknown = null;

  let pendingTrackingFrames = 0;

  const MAX_TRACKING_BACKLOG = 8;
  const TRACKING_DECODE_QUEUE = 12;

  async function waitForTrackingCapacity() {
    while (
      !cancelled
    ) {
      if (!decoder) {
        throw new Error(
          'Tracking decoder was not initialized.',
        );
      }

      if (
        decoder.state === 'closed'
      ) {
        throw new Error(
          'Tracking decoder closed unexpectedly.',
        );
      }

      if (
        decoder.decodeQueueSize <
          TRACKING_DECODE_QUEUE &&
        pendingTrackingFrames <
          MAX_TRACKING_BACKLOG
      ) {
        return;
      }

      await new Promise<void>(
        (resolve) => {
          ctx.setTimeout(
            resolve,
            2,
          );
        },
      );
    }
  }

  /*
   * Decoder output is already presentation
   * ordered by WebCodecs.
   */
const decoderOutput = (
  frame: VideoFrame,
) => {
  const timing =
    pendingTimingByDecoderTimestamp.get(
      frame.timestamp,
    );

  if (timing) {
    pendingTimingByDecoderTimestamp.delete(
      frame.timestamp,
    );
  }

  if (!timing) {
      frame.close();

      trackingFailure =
        new Error(
          `Tracked frame timestamp ${frame.timestamp} µs had no matching MP4 sample.`,
        );

      return;
    }

    /*
 * This is only a temporary value needed by
 * trackBodyFrame(). Final presentation index
 * is assigned after exact PTS ordering below.
 */
const provisionalPresentationIndex =
  timing.sampleIndex;

decodedFrames += 1;
pendingTrackingFrames += 1;

    /*
     * Extend the serialized tracking chain.
     */
    trackingChain =
      trackingChain
        .then(
          async () => {
            if (
              trackingFailure
            ) {
              return;
            }

            try {
              const grayscale =
                await copyGrayscale(
                  frame,
                );

              const point =
                trackBodyFrame(
                  grayscale.pixels,
                  timing,
                  provisionalPresentationIndex,
                  background,
                  arenaMask,
                  settings,
                );
                trackPointSampleIndex.set(
                  point,
                  timing.sampleIndex,
                );
              trackPoints.push(
                point,
              );

              const completed =
                trackPoints.length;

              if (
                completed === 1 ||
                completed % 30 === 0
              ) {
                post({
                  type:
                    'tracking-progress',

                  completed,

                  total:
                    videoTrack
                      ?.nb_samples ??
                    completed,
                });
              }
            } catch (error) {
              trackingFailure =
                error;
            }
          },
        )
        .finally(() => {
          frame.close();

          pendingTrackingFrames =
            Math.max(
              0,
              pendingTrackingFrames -
                1,
            );
        });
  };

  let demuxReadyResolve!: (
    track: Mp4VideoTrack,
  ) => void;

  let demuxReadyReject!: (
    reason: unknown,
  ) => void;

  const demuxReady =
    new Promise<Mp4VideoTrack>(
      (
        resolve,
        reject,
      ) => {
        demuxReadyResolve =
          resolve;

        demuxReadyReject =
          reject;
      },
    );

  let extractionDoneResolve!:
    () => void;

  let extractionDoneReject!:
    (
      reason: unknown,
    ) => void;

  const extractionDone =
    new Promise<void>(
      (
        resolve,
        reject,
      ) => {
        extractionDoneResolve =
          resolve;

        extractionDoneReject =
          reject;
      },
    );

  let sampleChain =
    Promise.resolve();

  mp4File.onError = (
    error: unknown,
  ) => {
    demuxReadyReject(
      error,
    );

    extractionDoneReject(
      error,
    );
  };

  /*
   * Configure the second decoder.
   */
  mp4File.onReady =
    async (
      info: Mp4Info,
    ) => {
      try {
        const track =
          info.videoTracks?.[0];

        if (!track) {
          throw new Error(
            'No video track found for tracking.',
          );
        }

        if (
          !track.codec.startsWith(
            'avc1',
          ) &&
          !track.codec.startsWith(
            'avc3',
          )
        ) {
          throw new Error(
            `Tracking currently supports H.264/AVC MP4 only; found ${track.codec}.`,
          );
        }

        if (
          track.video.width !==
            background.width ||
          track.video.height !==
            background.height
        ) {
          throw new Error(
            'Tracking video dimensions do not match the background model.',
          );
        }

        videoTrack =
          track;

        const config:
          VideoDecoderConfig = {
            codec:
              track.codec,

            codedWidth:
              track.video.width,

            codedHeight:
              track.video.height,

            description:
              getCodecDescription(
                mp4File,
                track.id,
              ),
          };

        const support =
          await VideoDecoder
            .isConfigSupported(
              config,
            );

        if (
          !support.supported
        ) {
          throw new Error(
            `Browser cannot decode this H.264 configuration (${track.codec}).`,
          );
        }

        decoder =
          new VideoDecoder({
            output:
              decoderOutput,

            error:
              (
                error,
              ) => {
                demuxReadyReject(
                  error,
                );

                extractionDoneReject(
                  error,
                );
              },
          });

        decoder.configure(
          support.config ??
            config,
        );

        mp4File.setExtractionOptions(
          track.id,
          null,
          {
            nbSamples:
              EXTRACTION_BATCH_SAMPLES,

            rapAlignement:
              false,
          },
        );

        mp4File.start();

        demuxReadyResolve(
          track,
        );
      } catch (error) {
        demuxReadyReject(
          error,
        );
      }
    };

  /*
   * Feed MP4 samples to WebCodecs.
   */
  mp4File.onSamples = (
    trackId: number,
    _user: unknown,
    samples: Mp4Sample[],
  ) => {
    if (!videoTrack) {
      extractionDoneReject(
        new Error(
          'Tracking samples arrived before track initialization.',
        ),
      );

      return;
    }

    extractedSampleCount +=
      samples.length;

    const last =
      samples.at(-1);

    const deliveredAllByCount =
      extractedSampleCount >=
      videoTrack.nb_samples;

    const deliveredFinalSample =
      last?.number !==
        undefined &&
      last.number + 1 >=
        videoTrack.nb_samples;

    if (
      !extractionComplete &&
      (
        deliveredAllByCount ||
        deliveredFinalSample
      )
    ) {
      extractionComplete =
        true;

      extractionDoneResolve();
    }

    sampleChain =
      sampleChain
        .then(
          async () => {
            if (
              cancelled
            ) {
              return;
            }

            if (
              !decoder ||
              !videoTrack
            ) {
              throw new Error(
                'Tracking decoder was not initialized.',
              );
            }

            for (
              const sample of
                samples
            ) {
              if (
                cancelled
              ) {
                return;
              }

              await waitForTrackingCapacity();

              const pts =
                asRational(
                  sample.cts,
                  sample.timescale,
                );

              const dts =
                asRational(
                  sample.dts,
                  sample.timescale,
                );

              const duration =
                asRational(
                  sample.duration,
                  sample.timescale,
                );

const sampleIndex =
  nextSampleIndex++;

/*
 * Unique identity supplied to this tracking
 * VideoDecoder only.
 *
 * This is not scientific time.
 */
const decoderTimestampUs =
  sampleIndex;

const timing:
  FrameTiming = {
  sampleIndex,

  presentationIndex:
    null,

  pts,
  dts,
  duration,

  /*
   * For this decoder invocation, this is the
   * timestamp actually supplied to WebCodecs.
   * Exact source PTS remains separately in pts.
   */
  webCodecsTimestampUs:
    decoderTimestampUs,

  isKeyFrame:
    mp4SampleIsKey(
      sample,
    ),
};

pendingTimingByDecoderTimestamp.set(
  decoderTimestampUs,
  timing,
);

decoder.decode(
  new EncodedVideoChunk({
    type:
      timing.isKeyFrame
        ? 'key'
        : 'delta',

    timestamp:
      decoderTimestampUs,,

                  duration:
                    timeToWebCodecsMicroseconds(
                      duration,
                    ),

                  data:
                    sample.data,
                }),
              );

              submittedSampleCount +=
                1;
            }

            if (
              last?.number !==
              undefined
            ) {
              mp4File.releaseUsedSamples(
                trackId,
                last.number + 1,
              );
            }
          },
        )
        .catch(
          (
            error,
          ) => {
            extractionDoneReject(
              error,
            );

            throw error;
          },
        );
  };

  /*
   * Stream the same local File through MP4Box
   * again. No re-upload is involved.
   */
  let offset = 0;

  while (
    offset <
    file.size
  ) {
    if (
      cancelled
    ) {
      return;
    }

    const end =
      Math.min(
        offset +
          FILE_CHUNK_BYTES,
        file.size,
      );

    const buffer =
      (
        await file
          .slice(
            offset,
            end,
          )
          .arrayBuffer()
      ) as Mp4ArrayBuffer;

    buffer.fileStart =
      offset;

    mp4File.appendBuffer(
      buffer,
    );

    offset =
      end;
  }

  const readyTrack =
    await demuxReady;

  if (
    cancelled
  ) {
    return;
  }

  mp4File.flush();

  await extractionDone;
  await sampleChain;

  if (
    cancelled
  ) {
    return;
  }

  const activeDecoder =
    decoder as
      VideoDecoder | null;

  if (
    !activeDecoder
  ) {
    throw new Error(
      'Tracking decoder was not initialized.',
    );
  }

  /*
   * Forces WebCodecs to output all remaining
   * H.264 reordered frames.
   */
  await withTimeout(
    activeDecoder.flush(),
    10_000,
    'Tracking VideoDecoder.flush()',
  );

  /*
   * Decoder output is asynchronous relative
   * to grayscale/segmentation processing.
   */
  await trackingChain;

  activeDecoder.close();

  if (
    trackingFailure
  ) {
    throw trackingFailure;
  }

  if (
  pendingTimingByDecoderTimestamp.size >
  0
) {
  throw new Error(
    `${pendingTimingByDecoderTimestamp.size} tracking sample identities were not matched to decoded frames.`,
  );
}

  /*
   * Defensive ordering.
   */
  trackPoints.sort(
    (
      a,
      b,
    ) =>
      a.presentationIndex -
      b.presentationIndex,
  );

  const detectedFrameCount =
    trackPoints.filter(
      (
        point,
      ) =>
        point.x !== null &&
        point.y !== null,
    ).length;

  const bodyTrack:
    BodyTrack = {
      width:
        readyTrack.video.width,

      height:
        readyTrack.video.height,

      points:
        trackPoints,

      detectedFrameCount,

      missingFrameCount:
        trackPoints.length -
        detectedFrameCount,
    };

  post({
    type:
      'tracking-progress',

    completed:
      trackPoints.length,

    total:
      readyTrack.nb_samples,
  });

  post({
    type:
      'track-complete',

    track:
      bodyTrack,
  });
}
ctx.addEventListener(
  'message',
  (
    event:
      MessageEvent<ExtendedDecoderRequest>,
  ) => {
    const message =
      event.data;

    if (
      message.type === 'cancel'
    ) {
      cancelled = true;
      return;
    }
    if (
  message.type ===
  'open-review-file'
) {
  openReviewFile(
    message.file,
  ).catch(
    (
      error:
        unknown,
    ) => {
      post({
        type:
          'review-error',

        requestId:
          null,

        message:
          error instanceof
          Error
            ? error.message
            : String(
                error,
              ),
      });
    },
  );

  return;
}

if (
  message.type ===
  'decode-review-frame'
) {
  latestReviewRequestId =
    message.requestId;

  reviewDecodeChain =
    reviewDecodeChain
      .then(
        () =>
          decodeReviewFrame(
            message,
          ),
      )
      .catch(
        (
          error:
            unknown,
        ) => {
          /*
           * Only surface an error if this
           * request is still current.
           */
          if (
            message.requestId ===
            latestReviewRequestId
          ) {
            post({
              type:
                'review-error',

              requestId:
                message.requestId,

              message:
                error instanceof
                Error
                  ? error.message
                  : String(
                      error,
                    ),
            });
          }
        },
      );

  return;
}

    if (
      message.type ===
      'decode-file'
    ) {
      decodeFile(
        message.file,
      ).catch(
        (
          error: unknown,
        ) => {
          post({
            type: 'error',

            message:
              'Could not decode video.',

            detail:
              error instanceof Error
                ? error.message
                : String(error),
          });
        },
      );

      return;
    }

    if (
      message.type ===
      'track-file'
    ) {
      trackFile(
        message,
      ).catch(
        (
          error: unknown,
        ) => {
          post({
            type: 'error',

            message:
              'Could not track mouse.',

            detail:
              error instanceof Error
                ? error.message
                : String(error),
          });
        },
      );

      return;
    }
  },
);