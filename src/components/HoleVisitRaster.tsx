/**
 * Raster visualization of the final reviewed hole-investigation sequence.
 *
 * Inputs:
 * - Final reviewed investigation events.
 * - Calibrated hole geometry and trial timing.
 * - Recording end and optional confirmed escape time.
 *
 * Outputs:
 * - SVG raster showing investigation timing, duration, hole identity,
 *   target-hole visits, and review provenance.
 *
 * Main component:
 * - HoleVisitRaster() plots one row per hole and one marker per included
 *   investigation using grayscale-safe marker shapes.
 */
import type {
  FinalReviewedHoleInvestigationEvent, HoleGeometry, TrialWindow,
} from '../models/tracking';
import { timeToSeconds } from '../video/time';

interface HoleVisitRasterProps {
  events: FinalReviewedHoleInvestigationEvent[];
  geometry: HoleGeometry;
  trialWindow: TrialWindow;
  recordingEndTimeSeconds: number;
  confirmedEscapeTimeSeconds: number | null;
  targetDefined: boolean;
}

const SVG_WIDTH = 1000;
const LEFT_MARGIN = 95;
const RIGHT_MARGIN = 30;
const TOP_MARGIN = 45;
const BOTTOM_MARGIN = 60;
const ROW_HEIGHT = 25;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatTick(value: number, durationSeconds: number): string {
  if (durationSeconds >= 60) return value.toFixed(0);
  if (durationSeconds >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function reviewLabel(event: FinalReviewedHoleInvestigationEvent): string {
  if (event.reviewStatus === 'manual-added') return 'Manually added';
  if (event.reviewStatus === 'edited') return 'Manually edited';
  if (event.reviewStatus === 'confirmed') return 'Manually confirmed';
  return 'Automatic, unreviewed';
}

function EventMarker({
  event,
  x,
  y,
}: {
  event: FinalReviewedHoleInvestigationEvent;
  x: number;
  y: number;
}) {
  if (event.reviewStatus === 'manual-added') {
    return (<polygon
      points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`}
      fill="#111"
      stroke="#111"
      strokeWidth="1.5"
    />);
  }

  if (event.reviewStatus === 'edited') {
    return (<rect
      x={x - 5}
      y={y - 5}
      width="10"
      height="10"
      fill="#111"
      stroke="#111"
      strokeWidth="1.5"
    />);
  }

  if (event.reviewStatus === 'confirmed') {
    return (<circle
      cx={x}
      cy={y}
      r="5"
      fill="#111"
      stroke="#111"
      strokeWidth="1.5"
    />);
  }

  return (<circle
    cx={x}
    cy={y}
    r="5"
    fill="white"
    stroke="#111"
    strokeWidth="1.5"
    strokeDasharray="2 2"
  />);
}

export default function HoleVisitRaster({
  events,
  geometry,
  trialWindow,
  recordingEndTimeSeconds,
  confirmedEscapeTimeSeconds,
  targetDefined,
}: HoleVisitRasterProps) {
  const trialStartTimeSeconds = timeToSeconds(trialWindow.startPts);

  /*
   * A confirmed escape defines the behavioral endpoint.
   * Otherwise the raster extends through recording end.
   */
  const displayEndTimeSeconds = Math.max(
    trialStartTimeSeconds,
    confirmedEscapeTimeSeconds ?? recordingEndTimeSeconds,
  );
  const trialDurationSeconds = Math.max(
    0.001,
    displayEndTimeSeconds - trialStartTimeSeconds,
  );

  const holes = [...geometry.holes].sort((a, b) => a.index - b.index);
  const plotWidth = SVG_WIDTH - LEFT_MARGIN - RIGHT_MARGIN;
  const plotHeight = holes.length * ROW_HEIGHT;
  const plotBottom = TOP_MARGIN + plotHeight;
  const svgHeight = plotBottom + BOTTOM_MARGIN;

  /*
   * Clipping is display-only. The final reviewed event set remains
   * unchanged for downstream metrics and export.
   */
  const visibleEvents = events.filter((event) =>
    event.endTimeSeconds >= trialStartTimeSeconds &&
    event.startTimeSeconds <= displayEndTimeSeconds);

    const firstTargetEvent = targetDefined
    ? visibleEvents
        .filter((event) => event.isTarget)
        .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)[0] ?? null
    : null;

  const xForTime = (absoluteTimeSeconds: number) => {
    const elapsedSeconds = clamp(
      absoluteTimeSeconds - trialStartTimeSeconds,
      0,
      trialDurationSeconds,
    );

    return LEFT_MARGIN +
      elapsedSeconds / trialDurationSeconds * plotWidth;
  };

  const tickCount = 5;
  const ticks = Array.from(
    { length: tickCount + 1 },
    (_, index) => trialDurationSeconds * index / tickCount,
  );

  return (<section className="card" aria-labelledby="hole-visit-raster-heading">
    <h2 id="hole-visit-raster-heading">
      Hole-visit raster
    </h2>

    <p>
      Final included investigations are plotted by hole and elapsed
      time from trial start. Horizontal segments show investigation
      duration and marker shape shows review provenance.
    </p>

    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
        role="img"
        aria-labelledby="hole-visit-raster-title hole-visit-raster-description"
        style={{
          display: 'block',
          width: '100%',
          minWidth: '760px',
          height: 'auto',
        }}
      >
        <title id="hole-visit-raster-title">
          Hole-visit raster
        </title>

        <desc id="hole-visit-raster-description">
          Barnes maze hole-investigation events plotted by hole and
          elapsed time from trial start.
        </desc>

        <text
          x={LEFT_MARGIN}
          y="20"
          fontSize="13"
          fontWeight="600"
        >
          {visibleEvents.length} included investigation
          {visibleEvents.length === 1 ? '' : 's'}
        </text>

        <text
          x={SVG_WIDTH - RIGHT_MARGIN}
          y="20"
          textAnchor="end"
          fontSize="12"
        >
          {confirmedEscapeTimeSeconds !== null
            ? 'Endpoint: confirmed escape'
            : 'Endpoint: recording end'}
        </text>

        {holes.map((hole, rowIndex) => {
          const rowTop = TOP_MARGIN + rowIndex * ROW_HEIGHT;
          const rowCenter = rowTop + ROW_HEIGHT / 2;
          const isTarget = targetDefined && hole.isTarget;

          return (<g key={hole.index}>
            {isTarget && (<rect
              x={LEFT_MARGIN}
              y={rowTop}
              width={plotWidth}
              height={ROW_HEIGHT}
              fill="#eceff2"
            />)}

            <line
              x1={LEFT_MARGIN}
              y1={rowCenter}
              x2={SVG_WIDTH - RIGHT_MARGIN}
              y2={rowCenter}
              stroke="#d3d7dc"
              strokeWidth="1"
            />

            <text
              x={LEFT_MARGIN - 10}
              y={rowCenter + 4}
              textAnchor="end"
              fontSize="12"
              fontWeight={isTarget ? '700' : '400'}
            >
              {`Hole ${hole.index}${isTarget ? ' · T' : ''}`}
            </text>
          </g>);
        })}

        {ticks.map((tick, index) => {
          const x = LEFT_MARGIN +
            tick / trialDurationSeconds * plotWidth;

          return (<g key={index}>
            <line
              x1={x}
              y1={TOP_MARGIN}
              x2={x}
              y2={plotBottom}
              stroke="#b8bec5"
              strokeWidth="1"
              strokeDasharray="3 4"
            />

            <text
              x={x}
              y={plotBottom + 22}
              textAnchor="middle"
              fontSize="12"
            >
              {formatTick(tick, trialDurationSeconds)}
            </text>
          </g>);
        })}
        {firstTargetEvent && (() => {
  const x = xForTime(firstTargetEvent.startTimeSeconds);
  const latencySeconds =
    firstTargetEvent.startTimeSeconds - trialStartTimeSeconds;

  return (<g>
    <line
      x1={x}
      y1={TOP_MARGIN}
      x2={x}
      y2={plotBottom}
      stroke="#111"
      strokeWidth="1.5"
      strokeDasharray="6 4"
    />

    <text
      x={x + 5}
      y={TOP_MARGIN - 8}
      fontSize="11"
      fontWeight="600"
    >
      {`First target · ${latencySeconds.toFixed(1)} s`}
    </text>
  </g>);
})()}
        {visibleEvents.map((event) => {
          const rowIndex = holes.findIndex((hole) =>
            hole.index === event.holeIndex);

          if (rowIndex < 0) return null;

          const y = TOP_MARGIN +
            rowIndex * ROW_HEIGHT +
            ROW_HEIGHT / 2;
          const startX = xForTime(event.startTimeSeconds);
          const endX = xForTime(event.endTimeSeconds);
          const elapsedStart = Math.max(
            0,
            event.startTimeSeconds - trialStartTimeSeconds,
          );

          return (<g key={event.finalEventKey}>
            <title>
              {[
                `Hole ${event.holeIndex}`,
                `${elapsedStart.toFixed(3)} s from trial start`,
                `${event.durationSeconds.toFixed(3)} s duration`,
                reviewLabel(event),
              ].join(' · ')}
            </title>

            <line
              x1={startX}
              y1={y}
              x2={Math.max(startX + 1, endX)}
              y2={y}
              stroke="#111"
              strokeWidth="3"
              strokeLinecap="round"
            />

            <EventMarker
              event={event}
              x={startX}
              y={y}
            />

            {targetDefined && event.isTarget && (<circle
              cx={startX}
              cy={y}
              r="8"
              fill="none"
              stroke="#111"
              strokeWidth="1"
            />)}
          </g>);
        })}

        <line
          x1={LEFT_MARGIN}
          y1={plotBottom}
          x2={SVG_WIDTH - RIGHT_MARGIN}
          y2={plotBottom}
          stroke="#111"
          strokeWidth="1.5"
        />

        <text
          x={LEFT_MARGIN + plotWidth / 2}
          y={plotBottom + 48}
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
        >
          Time from trial start (s)
        </text>

        {visibleEvents.length === 0 && (<text
          x={LEFT_MARGIN + plotWidth / 2}
          y={TOP_MARGIN + plotHeight / 2}
          textAnchor="middle"
          fontSize="14"
          fontWeight="600"
        >
          No included investigation events
        </text>)}
      </svg>
    </div>

    <p>
      <strong>Marker key:</strong>{' '}
      filled circle = manually confirmed · hollow circle = unreviewed
      automatic · square = manually edited · diamond = manually added.
      {targetDefined
        ? ' The target-hole row is shaded and target visits have an outer ring.'
        : ' No target-hole styling is shown because target identity is not defined.'}
    </p>
  </section>);
}