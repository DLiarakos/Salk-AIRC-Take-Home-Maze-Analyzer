# Barnes Maze Analyzer — decoder prototype

This first vertical slice validates the most important low-level requirement: Barnes-maze timing comes from each MP4's presentation timestamps, not an assumed frame rate.

## Current scope

- Static React + TypeScript application.
- User selects a local `.mp4`; the file is not uploaded.
- MP4Box.js demuxes the MP4 in a dedicated Web Worker.
- WebCodecs decodes H.264 frames in that worker.
- Original MP4 composition timestamps (`cts / timescale`) are preserved as the authoritative scientific time.
- WebCodecs integer-microsecond timestamps are derived only at the decoder boundary.
- Frames are closed immediately after processing to avoid retaining graphics memory.
- The UI reports metadata and the first decoded presentation timestamps.

Tracking, calibration, event detection, QC, and spreadsheet export are intentionally not implemented in this slice yet.

## Developer setup

Prerequisite for development: Node.js 20.19+ or 22.12+. This satisfies Vite 8's current Node requirement and MP4Box.js 2.4.1's lower minimum.

```bash
npm install
npm run dev
```

Before submission, commit the generated `package-lock.json` and use `npm ci` in the cold-clone instructions.

Build a static site with:

```bash
npm run build
```

The output is written to `dist/` and can be hosted by GitHub Pages, Cloudflare Pages, Vercel, or another static host.

## Browser requirements

The primary decoder uses WebCodecs `VideoDecoder`, which requires a secure context for deployed builds. `localhost` works for development. The app performs a capability check and gives a visible error rather than failing silently.

A compatibility/fallback path should be decided after testing the supplied clips on the browsers used for evaluation.

## Timing rule

Persist this:

```ts
{ ticks: sample.cts, timescale: sample.timescale }
```

Derive this only when needed:

```ts
seconds = ticks / timescale
webCodecsTimestampUs = round(ticks * 1_000_000 / timescale)
```

Do **not** derive scientific timestamps from frame number divided by nominal FPS.

## Next validation checkpoint

Run `test50.mp4`, `test51.mp4`, and `test53.mp4` and verify:

1. container frame count equals decoded frame count;
2. dimensions are 640×480;
3. `test51.mp4` reports its actual average rate near 14.985 fps, not 15;
4. PTS values are monotonic after sorting into presentation order;
5. frame durations/timestamp deltas reflect the source timebase;
6. no decoder or demux errors occur on any of the three clips.
