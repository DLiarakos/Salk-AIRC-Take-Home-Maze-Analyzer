# Development History

## Provenance

Initial development of the Barnes Maze Analyzer was performed in VS Code
before Git was initialized. The earlier commits in this repository were
reconstructed from timestamped VS Code Local History snapshots retained from
September 1 through September 7, 2026.

Commits whose titles begin with **reconstructed:** represent these recovered
source milestones. Their Git commit timestamps record when the reconstruction
was performed; they have deliberately not been backdated. The original
development time represented by each milestone is recorded in the commit
message and in the reconstruction audit.

No unavailable historical source versions were fabricated. Files that did not
have a recoverable VS Code Local History snapshot at a given milestone were
left absent until a retained version became available.

Reconstruction performed: 2026-09-07 23:26:00 -07:00

Recovered project files: 41

Recovered timestamped file versions: 423

Oldest retained snapshot: 2026-09-01 10:45:28 -07:00

Newest retained snapshot: 2026-09-07 19:57:48 -07:00

### Raw history archive integrity

Archive: vscode-history-backup.7z

SHA-256: 21D362E54C78723D1FD561707D197D87A6505A40C8FF5EF43E80AD8B7259F3A5

The raw VS Code history archive is intentionally retained outside the Git
repository. The hash above allows the archive used for reconstruction to be
identified without committing editor backup data to the project.

## Important limitations

VS Code Local History is maintained independently for each file. It does not
record synchronized project-wide snapshots in the same way Git does.
Consequently, each reconstructed milestone uses the newest retained version of
each file at or before the milestone cutoff.

Several heavily edited files contain 50 retained Local History entries. Their
earlier revisions are no longer present in the supplied history archive. The
most important example is src/App.tsx, whose retained history begins on
September 6 even though the application existed earlier.

Because those early application-level snapshots are unavailable, some early
reconstructed commits are historical development records rather than guaranteed
buildable whole-project states. Later source was not copied backward merely to
make an earlier commit compile.

Files that have no retained VS Code Local History are not assumed to have
historical versions. They first appear in the final current-state bridge commit
unless independently represented by the retained history.

VS Code Local History also does not provide a complete Git-equivalent record of
file deletion and rename operations. The reconstruction therefore reflects the
recoverable file snapshots rather than claiming perfect equivalence to a
contemporaneous Git repository.

### Files with 50 retained versions

- src\App.tsx - earliest retained: 2026-09-06 22:23:56 -07:00; latest retained: 2026-09-07 13:22:41 -07:00
- src\components\HoleEventReviewer.tsx - earliest retained: 2026-09-05 18:15:07 -07:00; latest retained: 2026-09-06 14:57:29 -07:00
- src\models\tracking.ts - earliest retained: 2026-09-01 13:21:00 -07:00; latest retained: 2026-09-05 20:25:04 -07:00
- src\workers\videoDecoder.worker.ts - earliest retained: 2026-09-02 10:22:18 -07:00; latest retained: 2026-09-06 13:55:28 -07:00

## Reconstructed development milestones

| Commit | Historical cutoff | Files changed | Milestone |
| --- | --- | ---: | --- |
| [main (root-commit) b104392] reconstructed: establish video timing and decoder validation  3 files changed, 342 insertions(+)  create mode 100644 src/video/decoderClient.ts  create mode 100644 src/video/timingValidation.test.ts  create mode 100644 src/video/timingValidation.ts b1043923b5c3 | 2026-09-01 11:05:00 Pacific | 3 | reconstructed: establish video timing and decoder validation |
| [main acfa80d] reconstructed: add grayscale processing and arena calibration  12 files changed, 1754 insertions(+), 18 deletions(-)  create mode 100644 src/calibration/arena.ts  create mode 100644 src/components/ArenaCalibrationView.tsx  create mode 100644 src/components/ArenaMaskPreview.tsx  create mode 100644 src/components/GrayscalePreview.tsx  create mode 100644 src/models/tracking.ts  create mode 100644 src/styles.css  create mode 100644 src/tracking/arenaMask.ts  create mode 100644 src/tracking/frameProcessor.ts  create mode 100644 src/tracking/grayscale.ts  create mode 100644 src/video/messages.ts acfa80d7ed9a | 2026-09-01 16:05:00 Pacific | 12 | reconstructed: add grayscale processing and arena calibration |
| [main a0d09d3] reconstructed: implement segmentation and body tracking  9 files changed, 3249 insertions(+), 9 deletions(-)  create mode 100644 src/components/BackgroundPreview.tsx  create mode 100644 src/components/SegmentationPreview.tsx  create mode 100644 src/tracking/bodyTracker.ts  create mode 100644 src/tracking/segmentation.ts  create mode 100644 src/video/trackingClient.ts  create mode 100644 src/workers/videoDecoder.worker.ts a0d09d398233 | 2026-09-02 15:30:00 Pacific | 9 | reconstructed: implement segmentation and body tracking |
| [main ec08739] reconstructed: add trial-start detection and tracking QC  4 files changed, 445 insertions(+), 34 deletions(-)  create mode 100644 src/tracking/trackAnalysis.ts  create mode 100644 src/tracking/trialWindow.ts ec0873962f7f | 2026-09-02 16:25:00 Pacific | 4 | reconstructed: add trial-start detection and tracking QC |
| [main d609657] reconstructed: add trajectory processing smoothing and QC  4 files changed, 864 insertions(+)  create mode 100644 src/components/TrajectoryComparisonView.tsx  create mode 100644 src/components/TrajectoryPreview.tsx  create mode 100644 src/tracking/trajectoryProcessing.ts d609657dff84 | 2026-09-02 17:50:00 Pacific | 4 | reconstructed: add trajectory processing smoothing and QC |
| [main ecae6e3] reconstructed: add trajectory metrics and automatic hole calibration  5 files changed, 861 insertions(+), 26 deletions(-)  create mode 100644 src/calibration/holes.ts  create mode 100644 src/components/HoleCalibrationView.tsx  create mode 100644 src/tracking/trajectoryMetrics.ts ecae6e372897 | 2026-09-03 11:50:00 Pacific | 5 | reconstructed: add trajectory metrics and automatic hole calibration |
| [main af22cab] reconstructed: add orientation and hole-investigation detection  8 files changed, 1871 insertions(+), 11 deletions(-)  create mode 100644 .vscode/extensions.json  create mode 100644 src/components/HoleInvestigationPreview.tsx  create mode 100644 src/components/OrientationPreview.tsx  create mode 100644 src/tracking/holeInvestigation.ts  create mode 100644 src/tracking/orientation.ts af22cabde72e | 2026-09-04 16:30:00 Pacific | 8 | reconstructed: add orientation and hole-investigation detection |
| [main 157cf30] reconstructed: compute behavioral metrics and escape detection  3 files changed, 1502 insertions(+)  create mode 100644 src/tracking/behavioralMetrics.ts  create mode 100644 src/tracking/escapeDetection.ts 157cf3068289 | 2026-09-05 11:50:00 Pacific | 3 | reconstructed: compute behavioral metrics and escape detection |
| [main 46ac822] reconstructed: add target-quadrant metrics and search strategy  3 files changed, 1295 insertions(+)  create mode 100644 src/tracking/searchStrategy.ts  create mode 100644 src/tracking/targetQuadrant.ts 46ac822273fb | 2026-09-05 15:00:00 Pacific | 3 | reconstructed: add target-quadrant metrics and search strategy |
| [main a350663] reconstructed: add frame-accurate manual review and corrections  4 files changed, 5465 insertions(+), 203 deletions(-)  create mode 100644 src/components/HoleEventReviewer.tsx a350663096b4 | 2026-09-06 15:05:00 Pacific | 4 | reconstructed: add frame-accurate manual review and corrections |
| [main dd8ec00] reconstructed: recover retained application orchestration and batch workflow  1 file changed, 11051 insertions(+)  create mode 100644 src/App.tsx dd8ec004e3c0 | 2026-09-06 22:30:00 Pacific | 1 | reconstructed: recover retained application orchestration and batch workflow |
| [main 469595d] reconstructed: add XLSX workbook export  1 file changed, 915 insertions(+), 15 deletions(-) 469595d3b883 | 2026-09-07 11:00:00 Pacific | 1 | reconstructed: add XLSX workbook export |
| [main 7fcc9b5] reconstructed: add reloadable workspace persistence  1 file changed, 1764 insertions(+), 68 deletions(-) 7fcc9b5a8d15 | 2026-09-07 13:30:00 Pacific | 1 | reconstructed: add reloadable workspace persistence |
| [main 578e0c9] reconstructed: add portable Windows launcher and server  3 files changed, 265 insertions(+)  create mode 100644 portable-windows/Start Barnes Maze Analyzer.bat  create mode 100644 portable-windows/server.cjs  create mode 100644 src/vite-env.d.ts 578e0c990d06 | 2026-09-07 20:05:00 Pacific | 4 | reconstructed: add portable Windows launcher and server |

## Detailed audit

RECONSTRUCTION_AUDIT.csv records the exact VS Code Local History entry used
for each file change, its retained source timestamp, and a SHA-256 hash of the
snapshot contents.

VS_CODE_HISTORY_SUMMARY.csv records the number and date range of retained
snapshots for every Barnes Maze project file recovered from the supplied
history.

## Transition to native Git development

The Git tag **reconstructed-history-end** marks the end of reconstructed VS
Code history. Commits after that tag are ordinary Git commits created during
ongoing development and should not use the reconstructed: prefix.

