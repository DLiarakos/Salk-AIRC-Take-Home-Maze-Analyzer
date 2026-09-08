import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { FrameTiming } from '../models/media';

import type {
  BodyTrack,
  BodyTrackPoint,
  HoleGeometry,
  HoleInvestigationEvidence,
  HoleInvestigationEvent,
  HoleInvestigationResult,
  HoleInvestigationSettings,
  TrialWindow,
  TrialStartOverride,
  ManualHoleEventAddition,
  ManualTrackPointCorrectionMap,
} from '../models/tracking';

export type HoleEventReviewStatus =
  | 'unreviewed'
  | 'confirmed'
  | 'rejected'
  | 'edited';

export interface HoleEventReviewDecision {
  eventKey: string;

  status:
    HoleEventReviewStatus;

  note: string;

  reviewedAtIso:
    string | null;

  /*
   * Optional for backward compatibility with
   * sessions saved before manual editing existed.
   */
  manualHoleIndex?:
    number | null;

  manualStartPresentationIndex?:
    number | null;

  manualEndPresentationIndex?:
    number | null;
}

export type HoleEventReviewDecisionMap =
  Record<string,HoleEventReviewDecision>;

interface Props {
  file: File;
  frames: FrameTiming[];
  track: BodyTrack;
  geometry: HoleGeometry;
  result: HoleInvestigationResult;
  settings: HoleInvestigationSettings;

  decisions: HoleEventReviewDecisionMap;

  onDecisionsChange:
    (value: HoleEventReviewDecisionMap) => void;
    manualAdditions:
    ManualHoleEventAddition[];

  onManualAdditionsChange:
    (
      additions:
        ManualHoleEventAddition[],
    ) => void;
  
  trialWindow:
    TrialWindow;
   automaticTrialWindow:
    TrialWindow;

  trialStartOverride:
    TrialStartOverride | null;

onTrialStartOverrideChange:
  (
    value:
      TrialStartOverride | null,
  ) => void;

automaticTrack:
  BodyTrack;

manualTrackPointCorrections:
  ManualTrackPointCorrectionMap;

onManualTrackPointCorrectionsChange:
  (
    value:
      ManualTrackPointCorrectionMap,
  ) => void;
}

type IndexedFrame =
  FrameTiming & {
    presentationIndex: number;
  };

const REVIEW_PADDING_SECONDS = 0.50;
const CHECKPOINT_OFFSET_SECONDS = 0.20;

function frameSeconds(
  frame: FrameTiming,
): number {
  return (
    frame.pts.ticks /
    frame.pts.timescale
  );
}

function isIndexedFrame(
  frame: FrameTiming,
): frame is IndexedFrame {
  return (
    typeof frame.presentationIndex ===
    'number'
  );
}

export function holeEventReviewKey(
  event: HoleInvestigationEvent,
): string {
  return [
    event.holeIndex,
    event.startPresentationIndex,
    event.endPresentationIndex,
  ].join(':');
}

function exactPtsKey(
  frame: FrameTiming,
): string {
  return (
    `${frame.pts.ticks}/` +
    `${frame.pts.timescale}`
  );
}

function nearestFrameByTime(
  frames: IndexedFrame[],
  targetSeconds: number,
): IndexedFrame | null {
  let best:
    IndexedFrame | null = null;

  let bestDistance =
    Number.POSITIVE_INFINITY;

  for (const frame of frames) {
    const distance =
      Math.abs(
        frameSeconds(frame) -
        targetSeconds,
      );

    if (distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }

  return best;
}

export default function HoleEventReviewer({
  file,
  frames,
  track,
  geometry,
  result,
  settings,
  decisions,
  onDecisionsChange,
  manualAdditions,
onManualAdditionsChange,
trialWindow,
automaticTrialWindow,
trialStartOverride,
onTrialStartOverrideChange,
automaticTrack,
manualTrackPointCorrections,
onManualTrackPointCorrectionsChange,
}: Props) {
  const videoRef =
    useRef<HTMLVideoElement>(null);

  const overlayRef =
    useRef<HTMLCanvasElement>(null);

  const [
    selectedEventIndex,
    setSelectedEventIndex,
  ] = useState(0);

  const [
  selectedPresentationIndex,
  setSelectedPresentationIndex,
] = useState<number | null>(
  result.events[0]
    ?.startPresentationIndex ??
  trialWindow
    .startPresentationIndex,
);

  const [
    renderedMediaTime,
    setRenderedMediaTime,
  ] = useState<number | null>(null);

  const [
    videoUrl,
    setVideoUrl,
  ] = useState('');
  const [
  manualDraftHoleIndex,
  setManualDraftHoleIndex,
] = useState<number>(
  geometry.holes[0]?.index ??
  0,
);

const [
  manualDraftStartPresentationIndex,
  setManualDraftStartPresentationIndex,
] = useState<number | null>(
  null,
);

const [
  manualDraftEndPresentationIndex,
  setManualDraftEndPresentationIndex,
] = useState<number | null>(
  null,
);

const [
  manualDraftNote,
  setManualDraftNote,
] = useState('');
const [
  trackCorrectionXInput,
  setTrackCorrectionXInput,
] = useState('');

const [
  trackCorrectionYInput,
  setTrackCorrectionYInput,
] = useState('');

const [
  trackCorrectionNote,
  setTrackCorrectionNote,
] = useState('');

const [
  trackCorrectionClickMode,
  setTrackCorrectionClickMode,
] = useState(false);
  /*
   * Associate saved manual decisions with:
   * - this source file
   * - this event detector configuration
   * - this reviewed hole geometry
   *
   * This avoids silently applying old reviews after
   * changing thresholds or hole positions.
   */
 
  /*
   * Create a local browser URL for the already
   * selected source MP4.
   *
   * Nothing is uploaded.
   */
  useEffect(() => {
    const url =
      URL.createObjectURL(file);

    setVideoUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  /*
   * Load prior review decisions.
   */
 

  /*
   * Persist only the small manual-review record.
   * Video and tracking arrays are NOT stored here.
   */

  const indexedFrames =
    useMemo(
      () =>
        frames.filter(
          isIndexedFrame,
        ),
      [frames],
    );

  const frameByIndex =
    useMemo(() => {
      const map =
        new Map<
          number,
          IndexedFrame
        >();

      for (
        const frame of indexedFrames
      ) {
        map.set(
          frame.presentationIndex,
          frame,
        );
      }

      return map;
    }, [indexedFrames]);

const sourcePresentationIndices =
  useMemo(
    () =>
      frames
        .map(
          (frame) =>
            frame.presentationIndex,
        )
        .filter(
          (
            presentationIndex,
          ): presentationIndex is number =>
            typeof presentationIndex ===
            'number',
        )
        .sort(
          (a,b) =>
            a - b,
        ),
    [
      frames,
    ],
  );

const firstSourcePresentationIndex =
  sourcePresentationIndices[0] ??
  null;

const lastSourcePresentationIndex =
  sourcePresentationIndices.at(-1) ??
  null;


  const pointByIndex =
    useMemo(() => {
      const map =
        new Map<
          number,
          BodyTrackPoint
        >();

      for (
        const point of track.points
      ) {
        map.set(
          point.presentationIndex,
          point,
        );
      }

      return map;
    }, [track]);
const automaticPointByIndex =
  useMemo(() => {
    const map =
      new Map<
        number,
        BodyTrackPoint
      >();

    for (
      const point of
      automaticTrack.points
    ) {
      map.set(
        point.presentationIndex,
        point,
      );
    }

    return map;
  }, [
    automaticTrack,
  ]);
  const evidenceByIndex =
    useMemo(() => {
      const map =
        new Map<
          number,
          HoleInvestigationEvidence
        >();

      for (
        const observation of
        result.evidence
      ) {
        map.set(
          observation.presentationIndex,
          observation,
        );
      }

      return map;
    }, [result.evidence]);

  /*
   * Count exact duplicate source PTS values.
   */
  const ptsCounts =
    useMemo(() => {
      const map =
        new Map<string,number>();

      for (
        const frame of indexedFrames
      ) {
        const key =
          exactPtsKey(frame);

        map.set(
          key,
          (map.get(key) ?? 0) + 1,
        );
      }

      return map;
    }, [indexedFrames]);
const hasAutomaticEvents =
  result.events.length > 0;

const activeEvent =
  hasAutomaticEvents
    ? (
        result.events[
          Math.min(
            selectedEventIndex,
            result.events.length - 1,
          )
        ] ?? null
      )
    : null;

  /*
   * Clamp selection if changing detector settings
   * changes the event count.
   */
  useEffect(() => {
    if (
      result.events.length === 0
    ) {
      setSelectedEventIndex(0);

      setSelectedPresentationIndex(
        trialWindow
          .startPresentationIndex,
      );

      return;
    }

    setSelectedEventIndex(
      (current) =>
        Math.min(
          current,
          result.events.length - 1,
        ),
    );
}, [
  result.events.length,
  trialWindow.startPresentationIndex,
]);
  /*
   * When selecting another event, begin review
   * at the automatic onset frame.
   */
  useEffect(() => {
    if (!activeEvent) return;

    setSelectedPresentationIndex(
      activeEvent
        .startPresentationIndex,
    );
  }, [
    activeEvent?.eventIndex,
    activeEvent?.startPresentationIndex,
  ]);

  /*
   * Frames shown by the scrubber:
   * 0.5 seconds before through 0.5 seconds after.
   */
  const reviewFrames =
    useMemo(() => {
      if (!activeEvent) return [];

      const start =
        activeEvent.startTimeSeconds -
        REVIEW_PADDING_SECONDS;

      const end =
        activeEvent.endTimeSeconds +
        REVIEW_PADDING_SECONDS;

      return indexedFrames.filter(
        (frame) => {
          const seconds =
            frameSeconds(frame);

          return (
            seconds >= start &&
            seconds <= end
          );
        },
      );
    }, [
      activeEvent,
      indexedFrames,
    ]);

  /*
   * Find the exact evidence observation with the
   * minimum nose-to-hole distance during this event.
   *
   * This means we do NOT have to change
   * holeInvestigation.ts just to support the viewer.
   */
  const closestEvidence =
    useMemo(() => {
      if (!activeEvent) {
        return null;
      }

      let best:
        HoleInvestigationEvidence | null =
        null;

      for (
        const observation of
        result.evidence
      ) {
        if (
          observation.holeIndex !==
            activeEvent.holeIndex ||
          observation.state !==
            'investigating' ||
          observation.timeSeconds <
            activeEvent.startTimeSeconds ||
          observation.timeSeconds >
            activeEvent.endTimeSeconds ||
          observation.distancePixels ===
            null
        ) {
          continue;
        }

        if (
          best === null ||
          best.distancePixels === null ||
          observation.distancePixels <
            best.distancePixels
        ) {
          best = observation;
        }
      }

      return best;
    }, [
      activeEvent,
      result.evidence,
    ]);

  const selectedFrame =
    selectedPresentationIndex === null
      ? null
      : (
          frameByIndex.get(
            selectedPresentationIndex,
          ) ?? null
        );

const selectedPoint =
  selectedPresentationIndex === null
    ? null
    : (
        pointByIndex.get(
          selectedPresentationIndex,
        ) ?? null
      );

const selectedAutomaticPoint =
  selectedPresentationIndex === null
    ? null
    : (
        automaticPointByIndex.get(
          selectedPresentationIndex,
        ) ?? null
      );

const selectedTrackCorrection =
  selectedPresentationIndex === null
    ? undefined
    : manualTrackPointCorrections[
        String(
          selectedPresentationIndex,
        )
      ];

const selectedEvidence =
    selectedPresentationIndex === null
      ? null
      : (
          evidenceByIndex.get(
            selectedPresentationIndex,
          ) ?? null
        );
useEffect(() => {
  if (
    selectedPresentationIndex ===
    null
  ) {
    setTrackCorrectionXInput('');
    setTrackCorrectionYInput('');
    setTrackCorrectionNote('');

    return;
  }

  const correction =
    manualTrackPointCorrections[
      String(
        selectedPresentationIndex,
      )
    ];

  if (
    correction?.kind ===
    'position'
  ) {
    setTrackCorrectionXInput(
      correction.x.toFixed(2),
    );

    setTrackCorrectionYInput(
      correction.y.toFixed(2),
    );
  } else {
    setTrackCorrectionXInput(
      selectedAutomaticPoint
        ?.x !== null &&
      selectedAutomaticPoint
        ?.x !== undefined
        ? selectedAutomaticPoint
            .x
            .toFixed(2)
        : '',
    );

    setTrackCorrectionYInput(
      selectedAutomaticPoint
        ?.y !== null &&
      selectedAutomaticPoint
        ?.y !== undefined
        ? selectedAutomaticPoint
            .y
            .toFixed(2)
        : '',
    );
  }

  setTrackCorrectionNote(
    correction?.note ??
    '',
  );
}, [
  selectedPresentationIndex,
  selectedAutomaticPoint,
  manualTrackPointCorrections,
]);
  const activeHole =
    activeEvent
      ? (
          geometry.holes.find(
            (hole) =>
              hole.index ===
              activeEvent.holeIndex,
          ) ?? null
        )
      : null;

  const currentReviewFrameIndex =
    useMemo(() => {
      if (
        selectedPresentationIndex ===
        null
      ) {
        return -1;
      }

      return reviewFrames.findIndex(
        (frame) =>
          frame.presentationIndex ===
          selectedPresentationIndex,
      );
    }, [
      reviewFrames,
      selectedPresentationIndex,
    ]);

  const checkpoints =
    useMemo(() => {
      if (!activeEvent) {
        return {
          pre: null,
          onset: null,
          closest: null,
          end: null,
          post: null,
        };
      }

      return {
        pre:
          nearestFrameByTime(
            reviewFrames,
            activeEvent
              .startTimeSeconds -
              CHECKPOINT_OFFSET_SECONDS,
          ),

        onset:
          frameByIndex.get(
            activeEvent
              .startPresentationIndex,
          ) ?? null,

        closest:
          closestEvidence
            ? (
                frameByIndex.get(
                  closestEvidence
                    .presentationIndex,
                ) ?? null
              )
            : null,

        end:
          frameByIndex.get(
            activeEvent
              .endPresentationIndex,
          ) ?? null,

        post:
          nearestFrameByTime(
            reviewFrames,
            activeEvent
              .endTimeSeconds +
              CHECKPOINT_OFFSET_SECONDS,
          ),
      };
    }, [
      activeEvent,
      closestEvidence,
      reviewFrames,
      frameByIndex,
    ]);

  /*
   * Seek the browser's local video element to
   * the exact source PTS represented by the
   * selected presentation index.
   */
  useEffect(() => {
    const video =
      videoRef.current;

    if (
      !video ||
      !selectedFrame
    ) {
      return;
    }

    const seconds =
      frameSeconds(
        selectedFrame,
      );

    setRenderedMediaTime(null);

    video.pause();

    /*
     * Tiny positive bias helps avoid floating-point
     * rounding to the previous frame boundary.
     */
    video.currentTime =
      Math.max(
        0,
        seconds + 0.000001,
      );

    const callbackVideo =
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (
          callback: (
            now: number,
            metadata: {
              mediaTime: number;
            },
          ) => void,
        ) => number;
      };

    callbackVideo
      .requestVideoFrameCallback?.(
        (_now,metadata) => {
          setRenderedMediaTime(
            metadata.mediaTime,
          );
        },
      );
  }, [selectedFrame]);

  /*
   * Draw overlays corresponding to the selected
   * source presentation index.
   */
  useEffect(() => {
    const canvas =
      overlayRef.current;

    if (!canvas) return;

    canvas.width =
      track.width;

    canvas.height =
      track.height;

    const context =
      canvas.getContext('2d');

    if (!context) return;

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    if (activeHole) {
      const entryRadius =
        activeHole.radiusPixels +
        settings.entryMarginPixels;

      const sustainRadius =
        activeHole.radiusPixels +
        Math.max(
          settings.sustainMarginPixels,
          settings.entryMarginPixels,
        );

      /*
       * Physical hole ROI.
       */
      context.save();

      context.strokeStyle =
        'white';

      context.lineWidth = 2;
      context.setLineDash([4,3]);

      context.beginPath();

      context.arc(
        activeHole.centerX,
        activeHole.centerY,
        activeHole.radiusPixels,
        0,
        Math.PI * 2,
      );

      context.stroke();

      /*
       * Inner trigger ROI.
       */
      context.strokeStyle =
        'gold';

      context.setLineDash([]);

      context.beginPath();

      context.arc(
        activeHole.centerX,
        activeHole.centerY,
        entryRadius,
        0,
        Math.PI * 2,
      );

      context.stroke();

      /*
       * Outer sustain ROI.
       */
      context.strokeStyle =
        'cyan';

      context.setLineDash([8,5]);

      context.beginPath();

      context.arc(
        activeHole.centerX,
        activeHole.centerY,
        sustainRadius,
        0,
        Math.PI * 2,
      );

      context.stroke();

      context.restore();
    }

    if (
      selectedPoint?.x !== null &&
      selectedPoint?.x !== undefined &&
      selectedPoint?.y !== null &&
      selectedPoint?.y !== undefined
    ) {
      /*
       * Body centroid.
       */
      context.fillStyle =
        'white';

      context.beginPath();

      context.arc(
        selectedPoint.x,
        selectedPoint.y,
        4,
        0,
        Math.PI * 2,
      );

      context.fill();

      /*
       * Centroid → estimated nose.
       */
      if (
        selectedPoint.noseX !== null &&
        selectedPoint.noseY !== null
      ) {
        context.strokeStyle =
          'magenta';

        context.lineWidth = 3;

        context.beginPath();

        context.moveTo(
          selectedPoint.x,
          selectedPoint.y,
        );

        context.lineTo(
          selectedPoint.noseX,
          selectedPoint.noseY,
        );

        context.stroke();

        context.fillStyle =
          'magenta';

        context.beginPath();

        context.arc(
          selectedPoint.noseX,
          selectedPoint.noseY,
          5,
          0,
          Math.PI * 2,
        );

        context.fill();
      }
    }
  }, [
    activeHole,
    selectedPoint,
    settings,
    track.width,
    track.height,
  ]);

  const activeKey =
  activeEvent
    ? holeEventReviewKey(
        activeEvent,
      )
    : null;

const activeDecision =
  activeKey
    ? decisions[activeKey]
    : undefined;

  const activeStatus =
    activeDecision?.status ??
    'unreviewed';

  const activeNote =
    activeDecision?.note ?? '';
const effectiveHoleIndex =
  activeEvent
    ? (
        activeStatus === 'edited'
          ? (
              activeDecision
                ?.manualHoleIndex ??
              activeEvent.holeIndex
            )
          : activeEvent.holeIndex
      )
    : (
        geometry.holes[0]?.index ??
        0
      );

const effectiveStartPresentationIndex =
  activeEvent
    ? (
        activeStatus === 'edited'
          ? (
              activeDecision
                ?.manualStartPresentationIndex ??
              activeEvent
                .startPresentationIndex
            )
          : activeEvent
              .startPresentationIndex
      )
    : trialWindow
        .startPresentationIndex;

const effectiveEndPresentationIndex =
  activeEvent
    ? (
        activeStatus === 'edited'
          ? (
              activeDecision
                ?.manualEndPresentationIndex ??
              activeEvent
                .endPresentationIndex
            )
          : activeEvent
              .endPresentationIndex
      )
    : (
        trialWindow
          .endPresentationIndex ??
        trialWindow
          .startPresentationIndex
      );

const effectiveStartFrame =
  frameByIndex.get(
    effectiveStartPresentationIndex,
  ) ?? null;

const effectiveEndFrame =
  frameByIndex.get(
    effectiveEndPresentationIndex,
  ) ?? null;

  function setDecision(
  status:
    Exclude<
      HoleEventReviewStatus,
      'edited'
    >,
) {
  if (
  !activeEvent ||
  !activeKey
) {
  return;
}
  onDecisionsChange({
    
    ...decisions,
    
    [activeKey]: {
      eventKey:
        activeKey,

      status,

      note:
        activeNote,

      reviewedAtIso:
        status === 'unreviewed'
          ? null
          : new Date()
              .toISOString(),

      /*
       * Confirm/reject/reset means the
       * automatic event itself is being used.
       */
      manualHoleIndex:
        null,

      manualStartPresentationIndex:
        null,

      manualEndPresentationIndex:
        null,
    },
    
  });
}

function applyEventEdit(
  patch: {
    manualHoleIndex?:
      number;

    manualStartPresentationIndex?:
      number;

    manualEndPresentationIndex?:
      number;
  },
) 
 {
  if (
  !activeEvent ||
  !activeKey
) {
  return;
}
  const currentHole =
    activeStatus === 'edited'
      ? (
          activeDecision
            ?.manualHoleIndex ??
          activeEvent.holeIndex
        )
      : activeEvent.holeIndex;

  const currentStart =
    activeStatus === 'edited'
      ? (
          activeDecision
            ?.manualStartPresentationIndex ??
          activeEvent
            .startPresentationIndex
        )
      : activeEvent
          .startPresentationIndex;

  const currentEnd =
    activeStatus === 'edited'
      ? (
          activeDecision
            ?.manualEndPresentationIndex ??
          activeEvent
            .endPresentationIndex
        )
      : activeEvent
          .endPresentationIndex;

  const nextHole =
    patch.manualHoleIndex ??
    currentHole;

  const nextStart =
    patch.manualStartPresentationIndex ??
    currentStart;

  const nextEnd =
    patch.manualEndPresentationIndex ??
    currentEnd;

  /*
   * Never save an invalid interval.
   */
  if (nextStart > nextEnd) {
    return;
  }

  onDecisionsChange({
    ...decisions,

    [activeKey]: {
      eventKey:
        activeKey,

      status:
        'edited',

      note:
        activeNote,

      reviewedAtIso:
        new Date()
          .toISOString(),

      manualHoleIndex:
        nextHole,

      manualStartPresentationIndex:
        nextStart,

      manualEndPresentationIndex:
        nextEnd,
    },
  });
}

  function setNote(
  note: string,
) {
  if (
  !activeEvent ||
  !activeKey
) {
  return;
}
  onDecisionsChange({
    ...decisions,

    [activeKey]: {
      eventKey:
        activeKey,

      status:
        activeStatus,

      note,

      reviewedAtIso:
        activeDecision
          ?.reviewedAtIso ??
        null,

      manualHoleIndex:
        activeDecision
          ?.manualHoleIndex ??
        null,

      manualStartPresentationIndex:
        activeDecision
          ?.manualStartPresentationIndex ??
        null,

      manualEndPresentationIndex:
        activeDecision
          ?.manualEndPresentationIndex ??
        null,
    },
  });
}

  function selectFrame(
    frame:
      IndexedFrame | null,
  ) {
    if (!frame) return;

    setSelectedPresentationIndex(
      frame.presentationIndex,
    );
  }

  function selectReviewFrame(
    index: number,
  ) {
    if (
      index < 0 ||
      index >= reviewFrames.length
    ) {
      return;
    }

    selectFrame(
      reviewFrames[index],
    );
  }

  let confirmedCount = 0;
  let rejectedCount = 0;
  let editedCount= 0;

  for (
    const event of result.events
  ) {
    const status =
      decisions[
        holeEventReviewKey(event)
      ]?.status;

    if (
      status === 'confirmed'
    ) {
      confirmedCount += 1;
    }

    if (
      status === 'rejected'
    ) {
      rejectedCount += 1;
    }

    if (
      status === 'edited'
      ) {
        editedCount += 1;
      }
        }

  const duplicatePtsCount =
    selectedFrame
      ? (
          ptsCounts.get(
            exactPtsKey(
              selectedFrame,
            ),
          ) ?? 1
        )
      : 0;
function makeManualAdditionId(): string {
  if (
    typeof crypto !==
      'undefined' &&
    typeof crypto.randomUUID ===
      'function'
  ) {
    return crypto.randomUUID();
  }

  return [
    Date.now(),
    Math.random()
      .toString(16)
      .slice(2),
  ].join('-');
}

function addManualInvestigation() {
  if (
    manualDraftStartPresentationIndex ===
      null ||
    manualDraftEndPresentationIndex ===
      null
  ) {
    return;
  }

  if (
    manualDraftStartPresentationIndex >
    manualDraftEndPresentationIndex
  ) {
    return;
  }

  const startFrame =
  frameByIndex.get(
    manualDraftStartPresentationIndex,
  );

const endFrame =
  frameByIndex.get(
    manualDraftEndPresentationIndex,
  );

if (
  !startFrame ||
  !endFrame
) {
  return;
}

if (
  manualDraftStartPresentationIndex <
    trialWindow
      .startPresentationIndex
) {
  return;
}

if (
  trialWindow
    .endPresentationIndex !==
    null &&
  manualDraftEndPresentationIndex >
    trialWindow
      .endPresentationIndex
) {
  return;
}

  const nextOrdinal =
    manualAdditions.reduce(
      (
        maximum,
        addition,
      ) =>
        Math.max(
          maximum,
          addition.ordinal,
        ),
      0,
    ) + 1;

  const now =
    new Date().toISOString();

  onManualAdditionsChange([
    ...manualAdditions,

    {
      id:
        makeManualAdditionId(),

      ordinal:
        nextOrdinal,

      holeIndex:
        manualDraftHoleIndex,

      startPresentationIndex:
        manualDraftStartPresentationIndex,

      endPresentationIndex:
        manualDraftEndPresentationIndex,

      note:
        manualDraftNote,

      createdAtIso:
        now,

      updatedAtIso:
        now,
    },
  ]);

  setManualDraftStartPresentationIndex(
    null,
  );

  setManualDraftEndPresentationIndex(
    null,
  );

  setManualDraftNote('');
}
const manualDraftOutsideTrial =
  manualDraftStartPresentationIndex !==
    null &&
  manualDraftEndPresentationIndex !==
    null &&
  (
    manualDraftStartPresentationIndex <
      trialWindow
        .startPresentationIndex ||

    (
      trialWindow
        .endPresentationIndex !==
        null &&
      manualDraftEndPresentationIndex >
        trialWindow
          .endPresentationIndex
    )
  );
function removeManualInvestigation(
  id: string,
) {
  onManualAdditionsChange(
    manualAdditions.filter(
      (addition) =>
        addition.id !== id,
    ),
  );
}
  return (
    <section className="card">
      <h3>
        Manual investigation-event reviewer
      </h3>

      <p>
        Automatic detections remain unchanged.
        Manual review is stored separately as
        confirmed, rejected, or unreviewed.
      </p>

      <dl className="metadata-grid">
        <div>
          <dt>Automatic events</dt>
          <dd>
            {result.events.length}
          </dd>
        </div>

        <div>
          <dt>Confirmed</dt>
          <dd>
            {confirmedCount}
          </dd>
        </div>

        <div>
          <dt>Rejected</dt>
          <dd>
            {rejectedCount}
          </dd>
        </div>
        <div>
       <dt>
          Edited
        </dt>

        <dd>
          {editedCount}
        </dd>
      </div>
        <div>
          <dt>Unreviewed</dt>
          <dd>
            {
              result.events.length -
              confirmedCount -
              rejectedCount -
              editedCount
            }
          </dd>
        </div>
      </dl>
{activeEvent ? (
  <>
      <div className="actions">
        <button
          type="button"
          disabled={
            selectedEventIndex === 0
          }
          onClick={() =>
            setSelectedEventIndex(
              selectedEventIndex - 1,
            )
          }
          
        >
          Previous event
        </button>

        <label>
          <span>Event</span>

          <select
            value={
              selectedEventIndex
            }
            onChange={(event) =>
              setSelectedEventIndex(
                Number(
                  event.target.value,
                ),
              )
            }
          >
            {result.events.map(
              (event,index) => (
                <option
                  key={holeEventReviewKey(event)}
                  value={index}
                >
                  {`#${event.eventIndex + 1} · Hole ${event.holeIndex}`}

                  {event.isTarget
                    ? ' · TARGET'
                    : ''}

                  {` · ${event.startTimeSeconds.toFixed(3)} s`}
                </option>
              ),
            )}
          </select>
        </label>

        <button
          type="button"
          disabled={
            selectedEventIndex >=
            result.events.length - 1
          }
          onClick={() =>
            setSelectedEventIndex(
              selectedEventIndex + 1,
            )
          }
        >
          Next event
        </button>
      </div>

      <dl className="metadata-grid">
        <div>
          <dt>Hole</dt>

          <dd>
            Hole {activeEvent.holeIndex}

            {activeEvent.isTarget
              ? ' · target'
              : ''}
          </dd>
        </div>

        <div>
          <dt>Automatic interval</dt>

          <dd>
            {activeEvent
              .startTimeSeconds
              .toFixed(3)}
            {' – '}
            {activeEvent
              .endTimeSeconds
              .toFixed(3)}
            {' s'}
          </dd>
        </div>

        <div>
          <dt>Review status</dt>

          <dd>
            {activeStatus}
          </dd>
        </div>
      </dl>
  </>
) : (
  <p role="status">
    No automatic investigation events were
    detected. You may still browse the source
    and add missed investigations manually.
  </p>
)}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '900px',
          marginTop: '1rem',
        }}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          onSeeked={(event) => {
            if (
              renderedMediaTime ===
              null
            ) {
              setRenderedMediaTime(
                event.currentTarget
                  .currentTime,
              );
            }
          }}
          style={{
            display: 'block',
            width: '100%',
          }}
        />

        <canvas
          ref={overlayRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      </div>

      <div className="actions">
        <button
          type="button"
          onClick={() =>
            selectFrame(
              checkpoints.pre,
            )
          }
        >
          Pre-event
        </button>

        <button
          type="button"
          onClick={() =>
            selectFrame(
              checkpoints.onset,
            )
          }
        >
          Onset
        </button>

        <button
          type="button"
          onClick={() =>
            selectFrame(
              checkpoints.closest,
            )
          }
        >
          Closest
        </button>

        <button
          type="button"
          onClick={() =>
            selectFrame(
              checkpoints.end,
            )
          }
        >
          End
        </button>

        <button
          type="button"
          onClick={() =>
            selectFrame(
              checkpoints.post,
            )
          }
        >
          Post-event
        </button>
      </div>

      <div className="actions">
        <button
          type="button"
          disabled={
            currentReviewFrameIndex <= 0
          }
          onClick={() =>
            selectReviewFrame(
              currentReviewFrameIndex -
              1,
            )
          }
        >
          Previous frame
        </button>

        <input
          type="range"
          aria-label="Review frame"
          min="0"
          max={Math.max(
            0,
            reviewFrames.length - 1,
          )}
          value={Math.max(
            0,
            currentReviewFrameIndex,
          )}
          onChange={(event) =>
            selectReviewFrame(
              Number(
                event.target.value,
              ),
            )
          }
        />

        <button
          type="button"
          disabled={
            currentReviewFrameIndex < 0 ||
            currentReviewFrameIndex >=
              reviewFrames.length - 1
          }
          onClick={() =>
            selectReviewFrame(
              currentReviewFrameIndex +
              1,
            )
          }
        >
          Next frame
        </button>
      </div>

      <dl className="metadata-grid">
        <div>
          <dt>Presentation index</dt>

          <dd>
            {selectedFrame
              ?.presentationIndex ??
              'Unavailable'}
          </dd>
        </div>

        <div>
          <dt>Exact source PTS</dt>

          <dd>
            {selectedFrame
              ? (
                  `${selectedFrame.pts.ticks}/` +
                  `${selectedFrame.pts.timescale}` +
                  ` = ${frameSeconds(selectedFrame).toFixed(6)} s`
                )
              : 'Unavailable'}
          </dd>
        </div>

        <div>
          <dt>Rendered media time</dt>

          <dd>
            {renderedMediaTime !== null
              ? `${renderedMediaTime.toFixed(6)} s`
              : 'Unavailable'}
          </dd>
        </div>

        <div>
          <dt>Exact-PTS group size</dt>

          <dd>
            {duplicatePtsCount}
          </dd>
        </div>

        <div>
          <dt>Evidence state</dt>

          <dd>
            {selectedEvidence
              ?.state ??
              'No unique evidence'}
          </dd>
        </div>

        <div>
          <dt>Nose distance</dt>

          <dd>
            {selectedEvidence
              ?.distancePixels !== null &&
            selectedEvidence
              ?.distancePixels !== undefined
              ? `${selectedEvidence.distancePixels.toFixed(2)} px`
              : 'Unavailable'}
          </dd>
        </div>

        <div>
          <dt>Head-hole alignment</dt>

          <dd>
            {selectedEvidence
              ?.headHoleAlignment !== null &&
            selectedEvidence
              ?.headHoleAlignment !== undefined
              ? selectedEvidence
                  .headHoleAlignment
                  .toFixed(3)
              : 'Unavailable'}
          </dd>
        </div>

        <div>
          <dt>Inside inner trigger</dt>

          <dd>
            {selectedEvidence
              ? (
                  selectedEvidence
                    .withinEntryRadius
                    ? 'Yes'
                    : 'No'
                )
              : 'Unavailable'}
          </dd>
        </div>

        <div>
          <dt>Orientation method</dt>

          <dd>
            {selectedPoint
              ?.orientationMethod ??
              'Unavailable'}
          </dd>
        </div>

        <div>
          <dt>Orientation confidence</dt>

          <dd>
            {selectedPoint
              ?.orientationConfidence !==
                null &&
            selectedPoint
              ?.orientationConfidence !==
                undefined
              ? selectedPoint
                  .orientationConfidence
                  .toFixed(3)
              : 'Unavailable'}
          </dd>
        </div>
      </dl>

      {duplicatePtsCount > 1 && (
        <p role="status">
          Warning: multiple source frames share
          this exact PTS. The selected presentation
          index remains exact, but the native video
          element cannot independently address two
          images having the same media timestamp.
        </p>
      )}
{activeEvent && (
      <fieldset>
        <legend>
          Manual event decision
        </legend>
        <div
  style={{
    display: 'grid',
    gap: '0.75rem',
    marginBottom: '1rem',
  }}
>
  <label>
    <span>
      Reviewed hole
    </span>

    <select
      value={
        effectiveHoleIndex
      }
      onChange={(event) =>
        applyEventEdit({
          manualHoleIndex:
            Number(
              event.target.value,
            ),
        })
      }
    >
      {geometry.holes.map(
        (hole) => (
          <option
            key={hole.index}
            value={hole.index}
          >
            {`Hole ${hole.index}${
              hole.isTarget
                ? ' · TARGET'
                : ''
            }`}
          </option>
        ),
      )}
    </select>
  </label>

  <dl className="metadata-grid">
    <div>
      <dt>
        Reviewed start
      </dt>

      <dd>
        {effectiveStartFrame
          ? (
              `${frameSeconds(
                effectiveStartFrame,
              ).toFixed(6)} s · ` +
              `index ${effectiveStartPresentationIndex}`
            )
          : 'Unavailable'}
      </dd>
    </div>

    <div>
      <dt>
        Reviewed end
      </dt>

      <dd>
        {effectiveEndFrame
          ? (
              `${frameSeconds(
                effectiveEndFrame,
              ).toFixed(6)} s · ` +
              `index ${effectiveEndPresentationIndex}`
            )
          : 'Unavailable'}
      </dd>
    </div>
  </dl>

  <div className="actions">
    <button
      type="button"
      disabled={
        selectedPresentationIndex ===
          null ||
        selectedPresentationIndex >
          effectiveEndPresentationIndex
      }
      onClick={() => {
        if (
          selectedPresentationIndex ===
          null
        ) {
          return;
        }

        applyEventEdit({
          manualStartPresentationIndex:
            selectedPresentationIndex,
        });
      }}
    >
      Set start to current frame
    </button>

    <button
      type="button"
      disabled={
        selectedPresentationIndex ===
          null ||
        selectedPresentationIndex <
          effectiveStartPresentationIndex
      }
      onClick={() => {
        if (
          selectedPresentationIndex ===
          null
        ) {
          return;
        }

        applyEventEdit({
          manualEndPresentationIndex:
            selectedPresentationIndex,
        });
      }}
    >
      Set end to current frame
    </button>
  </div>
</div>
        <div className="actions">
          <button
            type="button"
            aria-pressed={
              activeStatus ===
              'confirmed'
            }
            onClick={() =>
              setDecision(
                'confirmed',
              )
            }
          >
            Confirm event
          </button>

          <button
            type="button"
            aria-pressed={
              activeStatus ===
              'rejected'
            }
            onClick={() =>
              setDecision(
                'rejected',
              )
            }
          >
            Reject event
          </button>

          <button
            type="button"
            onClick={() =>
              setDecision(
                'unreviewed',
              )
            }
          >
            Reset to automatic
          </button>
        </div>

        <label
          style={{
            display: 'grid',
            gap: '0.4rem',
            marginTop: '0.75rem',
          }}
        >
          <span>Review note</span>

          <textarea
            rows={3}
            value={activeNote}
            onChange={(event) =>
              setNote(
                event.target.value,
              )
            }
            placeholder="Optional reason for this manual decision"
          />
        </label>
      </fieldset>
      )}

      <fieldset
  style={{
    marginTop: '1rem',
  }}
>
  <legend>
    Trial start review
  </legend>

  <p>
    Automatic trial start is estimated from
    sustained mouse presence. A reviewer may
    replace it with the currently displayed
    exact source frame without altering the
    automatic value.
  </p>

  <dl className="metadata-grid">
    <div>
      <dt>
        Automatic trial start
      </dt>

      <dd>
        {
          (
            automaticTrialWindow
              .startPts.ticks /
            automaticTrialWindow
              .startPts.timescale
          ).toFixed(6)
        } s
        {' · index '}
        {
          automaticTrialWindow
            .startPresentationIndex
        }
      </dd>
    </div>

    <div>
      <dt>
        Effective trial start
      </dt>

      <dd>
        {
          (
            trialWindow
              .startPts.ticks /
            trialWindow
              .startPts.timescale
          ).toFixed(6)
        } s
        {' · index '}
        {
          trialWindow
            .startPresentationIndex
        }
      </dd>
    </div>

    <div>
      <dt>
        Trial-start provenance
      </dt>

      <dd>
        {
          trialStartOverride
            ? 'Manual override'
            : 'Automatic'
        }
      </dd>
    </div>
  </dl>

  <div className="actions">
    <button
      type="button"
      disabled={
        selectedPresentationIndex ===
        null
      }
      onClick={() => {
        if (
          selectedPresentationIndex ===
          null
        ) {
          return;
        }

        onTrialStartOverrideChange({
          presentationIndex:
            selectedPresentationIndex,

          note:
            trialStartOverride
              ?.note ??
            '',

          updatedAtIso:
            new Date()
              .toISOString(),
        });
      }}
    >
      Set trial start to current frame
    </button>

    <button
      type="button"
      disabled={
        trialStartOverride ===
        null
      }
      onClick={() =>
        onTrialStartOverrideChange(
          null,
        )
      }
    >
      Use automatic trial start
    </button>
  </div>

  <label
    style={{
      display: 'grid',
      gap: '0.4rem',
      marginTop: '0.75rem',
    }}
  >
    <span>
      Trial-start review note
    </span>

    <textarea
      rows={2}
      disabled={
        trialStartOverride ===
        null
      }
      value={
        trialStartOverride
          ?.note ??
        ''
      }
      placeholder="Optional reason for changing trial start"
      onChange={(event) => {
        if (!trialStartOverride) {
          return;
        }

        onTrialStartOverrideChange({
          ...trialStartOverride,

          note:
            event.target.value,

          updatedAtIso:
            new Date()
              .toISOString(),
        });
      }}
    />
  </label>
</fieldset>
      <fieldset
  style={{
    marginTop: '1rem',
  }}
>
  
  <legend>
    Add missed investigation
  </legend>

  <p>
    Browse anywhere in the analyzed trial,
    mark the first and last frame of an
    investigation missed by the automatic
    detector, then assign the reviewed hole.
  </p>

  {firstSourcePresentationIndex !==
    null &&
   lastSourcePresentationIndex !==
    null && (
    <>
      <label
        style={{
          display: 'grid',
          gap: '0.4rem',
        }}
      >
        <span>
          Browse source frames
        </span>

        <input
          type="range"
          min={
             firstSourcePresentationIndex ?? 0
          }
          max={
             lastSourcePresentationIndex ?? 0
          }
          step="1"
          value={
            selectedPresentationIndex ??
            firstSourcePresentationIndex ?? 0
          }
          onChange={(event) =>
            setSelectedPresentationIndex(
              Number(
                event.target.value,
              ),
            )
          }
        />
      </label>

      <p>
        Current frame:{' '}
        <strong>
          {
            selectedPresentationIndex ??
            firstSourcePresentationIndex
          }
        </strong>
      </p>
    </>
  )}

  <label>
    <span>
      Manual event hole
    </span>

    <select
      value={
        manualDraftHoleIndex
      }
      onChange={(event) =>
        setManualDraftHoleIndex(
          Number(
            event.target.value,
          ),
        )
      }
    >
      {geometry.holes.map(
        (hole) => (
          <option
            key={hole.index}
            value={hole.index}
          >
            {`Hole ${hole.index}${
              hole.isTarget
                ? ' · TARGET'
                : ''
            }`}
          </option>
        ),
      )}
    </select>
  </label>

  <div
    className="actions"
    style={{
      marginTop: '0.75rem',
    }}
  >
    <button
      type="button"
      disabled={
        selectedPresentationIndex ===
        null
      }
      onClick={() => {
        if (
          selectedPresentationIndex ===
          null
        ) {
          return;
        }

        setManualDraftStartPresentationIndex(
          selectedPresentationIndex,
        );
      }}
    >
      Set manual start
    </button>

    <button
      type="button"
      disabled={
        selectedPresentationIndex ===
        null
      }
      onClick={() => {
        if (
          selectedPresentationIndex ===
          null
        ) {
          return;
        }

        setManualDraftEndPresentationIndex(
          selectedPresentationIndex,
        );
      }}
    >
      Set manual end
    </button>
  </div>

  <dl className="metadata-grid">
    <div>
      <dt>
        Manual start
      </dt>

      <dd>
        {manualDraftStartPresentationIndex !==
        null
          ? (
              `${frameSeconds(
                frameByIndex.get(
                  manualDraftStartPresentationIndex,
                )!,
              ).toFixed(6)} s · index ${manualDraftStartPresentationIndex}`
            )
          : 'Not set'}
      </dd>
    </div>

    <div>
      <dt>
        Manual end
      </dt>

      <dd>
        {manualDraftEndPresentationIndex !==
        null
          ? (
              `${frameSeconds(
                frameByIndex.get(
                  manualDraftEndPresentationIndex,
                )!,
              ).toFixed(6)} s · index ${manualDraftEndPresentationIndex}`
            )
          : 'Not set'}
      </dd>
    </div>
  </dl>

  {manualDraftStartPresentationIndex !==
    null &&
   manualDraftEndPresentationIndex !==
    null &&
   manualDraftStartPresentationIndex >
     manualDraftEndPresentationIndex && (
    <p role="alert">
      Manual event start must occur
      before or at the manual event end.
    </p>
  )}
{manualDraftOutsideTrial && (
  <p role="alert">
    A manually added investigation must
    fall within the currently reviewed
    trial window.
  </p>
)}
  <label
    style={{
      display: 'grid',
      gap: '0.4rem',
      marginTop: '0.75rem',
    }}
  >
    <span>
      Manual event note
    </span>

    <textarea
      rows={3}
      value={
        manualDraftNote
      }
      placeholder="Optional reason this event was added manually"
      onChange={(event) =>
        setManualDraftNote(
          event.target.value,
        )
      }
    />
  </label>

  <div
    className="actions"
    style={{
      marginTop: '0.75rem',
    }}
  >
    <button
      type="button"
      disabled={
  manualDraftStartPresentationIndex ===
    null ||
  manualDraftEndPresentationIndex ===
    null ||
  manualDraftStartPresentationIndex >
    manualDraftEndPresentationIndex ||
  manualDraftOutsideTrial
}
      onClick={
        addManualInvestigation
      }
    >
      Add manual investigation
    </button>

    <button
      type="button"
      onClick={() => {
        setManualDraftStartPresentationIndex(
          null,
        );

        setManualDraftEndPresentationIndex(
          null,
        );

        setManualDraftNote('');
      }}
    >
      Clear manual draft
    </button>
  </div>
</fieldset>
{manualAdditions.length > 0 && (
  <>
    <h3>
      Manually added investigations
    </h3>

    <div
      className="table-scroll"
      tabIndex={0}
      aria-label="Manually added investigation events"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">
              Manual #
            </th>

            <th scope="col">
              Hole
            </th>

            <th scope="col">
              Start
            </th>

            <th scope="col">
              End
            </th>

            <th scope="col">
              Note
            </th>

            <th scope="col">
              Action
            </th>
          </tr>
        </thead>

        <tbody>
          {manualAdditions
            .slice()
            .sort(
              (a,b) =>
                a.startPresentationIndex -
                b.startPresentationIndex,
            )
            .map(
              (addition) => {
                const startFrame =
                  frameByIndex.get(
                    addition
                      .startPresentationIndex,
                  );

                const endFrame =
                  frameByIndex.get(
                    addition
                      .endPresentationIndex,
                  );

                return (
                  <tr
                    key={
                      addition.id
                    }
                  >
                    <td>
                      M
                      {
                        addition.ordinal
                      }
                    </td>

                    <td>
                      {
                        addition
                          .holeIndex
                      }
                    </td>

                    <td>
                      {startFrame
                        ? `${frameSeconds(startFrame).toFixed(3)} s`
                        : 'Unavailable'}
                    </td>

                    <td>
                      {endFrame
                        ? `${frameSeconds(endFrame).toFixed(3)} s`
                        : 'Unavailable'}
                    </td>

                    <td>
                      {
                        addition.note ||
                        '—'
                      }
                    </td>

                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          removeManualInvestigation(
                            addition.id,
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              },
            )}
        </tbody>
      </table>
    </div>
  </>
)}
    </section>
  );
}