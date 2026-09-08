# Known Issues and Limitations

This document summarizes the issues and limitations that are still relevant to the current Barnes Maze Analyzer implementation. I have separated specific observed defects from broader limitations of the current approach and from features that were intentionally left outside the scope of the project.

## Observed issue

### 1. `test51` can briefly track a non-mouse object at the beginning of the video

At the beginning of `test51`, there is a stationary object near the maze that appears similar enough to the mouse to be selected by the tracking algorithm. It is likely part of the animal handling setup, such as a clay container or temporary housing.

This creates a short stretch of incorrect tracking before the actual mouse enters the trial.

In current testing, this has had only a minor effect on the overall trajectory and has not produced false hole-investigation events. The issue occurs before the meaningful behavioral portion of the trial, so downstream behavioral measurements have not been noticeably affected.

A simple workaround is to trim that initial section from the video before analysis. That removes the false object from the tracking period entirely. The tradeoff is that timestamps in the trimmed file are then relative to the trimmed recording rather than the original source video.

A more robust future solution would be to add stronger temporal or appearance-based logic so that a stationary setup object present before animal release is less likely to become the active track.

---

## Current limitations

### 2. The tracker is based on classical image processing

The current tracker uses browser-side segmentation, connected components, geometry, motion, and temporal continuity rather than a trained pose-estimation model.

This works well on the supplied recordings, but it is more sensitive than a learned model to differences in recording conditions. Tracking quality can be affected by:

- lighting changes,
- shadows,
- low contrast between the mouse and the platform,
- motion blur,
- partial occlusion,
- the tail entering the foreground mask,
- non-animal foreground objects,
- and changes in camera position or maze appearance.

The tracking pipeline is also sensitive to arena and hole calibration. The calibrated arena defines the region used for tracking, and the calibrated hole positions define the geometry used by downstream investigation detection and target-based metrics. If the arena boundary, tracking margin, or hole positions are changed, the resulting track and downstream behavioral results can also change.

For that reason, calibration should be treated as part of the scientific analysis rather than as a cosmetic setup step. The application exposes calibration, tracking QC, missing detections, outlier rejection, and manual point correction so that these effects can be inspected rather than hidden.

---

### 3. Tracking has not been validated against a large external ground-truth dataset

Development and testing have focused primarily on the videos supplied with the take-home assignment.

The current implementation has not yet been compared against a large independently scored Barnes maze dataset with frame-level ground truth.

Before treating the software as a validated production behavioral-analysis system, I would want to compare the following against manual scoring across a larger and more varied set of recordings:

- mouse centroid tracking,
- missing-frame detection,
- orientation and nose estimation,
- hole-investigation detection,
- event start and end times,
- primary latency,
- primary errors,
- escape timing,
- and search-strategy classification.

The current project should therefore be viewed as a working and tested research-software pipeline rather than a fully validated commercial scoring system.

---

### 4. Orientation and nose estimation can be uncertain

The application estimates nose position from body shape, recent motion, and temporal continuity rather than from a trained anatomical landmark detector.

Orientation can become less reliable when the mouse is nearly stationary, turns sharply, is partially occluded, or has an ambiguous body shape in the segmentation mask.

When the evidence is weak, the pipeline can leave orientation unresolved rather than forcing an arbitrary direction. This is preferable to inventing a confident head position, but it can reduce confidence in nose-based hole-investigation evidence for those frames.

---

### 5. Arena and hole calibration still require researcher review

Arena and hole calibration are assisted, but they are not guaranteed to be correct under every camera position or recording setup.

The application can initialize the maze geometry efficiently, but the researcher is still expected to inspect the arena boundary and individual hole locations before relying on downstream behavioral measurements.

This is especially important because calibration affects more than the visual overlay. The arena geometry influences the tracking region, while hole positions are used directly for investigation detection, target assignment, quadrant analysis, and several behavioral metrics.

Manual correction is therefore an intentional part of the QC workflow.

---

### 6. Escape detection still requires review

The application can identify an automatic escape candidate, but the candidate is not treated as an unquestionable final result.

The mouse disappearing near the target may represent a true escape, but similar evidence can also result from occlusion, tracking loss, partial visibility, or the recording ending.

The software therefore allows the researcher to confirm or reject the automatic candidate and, when necessary, select a different exact frame for the effective escape time.

This is an intentional scientific safeguard, but it means final escape scoring is not completely unsupervised.

---

### 7. Search-strategy classification is heuristic

Search strategy is classified using interpretable rules based on behavioral features such as:

- primary errors,
- number of distinct incorrect holes,
- distance from incorrect holes to the target,
- path efficiency,
- adjacent-hole transitions,
- directional consistency,
- direction reversals,
- and perimeter occupancy.

These rules have not been trained or validated against a large expert-labeled strategy dataset.

Different laboratories may also use somewhat different definitions of direct, serial, and mixed search behavior. For that reason, the automatic strategy is intended as an interpretable aid rather than a definitive label.

The application preserves the automatic result and underlying measurements and allows the researcher to override the final classification when appropriate.

---

### 8. Browser compatibility depends on WebCodecs

Exact-frame review depends on the browser's WebCodecs `VideoDecoder` implementation.

The submitted workflow is intended for a compatible modern desktop browser, with current Chromium-based browsers such as Chrome or Edge as the recommended environment.

WebCodecs support and behavior are not identical across all browser engines, so the complete workflow has not been validated equally across browsers.

This limitation applies only to browser media capabilities. The deployed application itself is still a static client-side application and does not require Node.js, npm, Python, or another runtime to be installed by the researcher.

---

### 9. Video-format support has only been tested on the supplied workflow

Development has focused on the supplied Barnes maze MP4 recordings.

The application preserves exact presentation timestamps and does not assume a fixed frame rate, but it has not been tested against every possible codec, container format, variable-frame-rate pattern, or unusual timestamp layout.

Broader media compatibility would require additional validation.

---

## Deliberately deferred scope

### 10. Experimental metadata are not modeled directly

The current application does not include a formal schema for:

- animal ID,
- genotype,
- sex,
- treatment group,
- cohort,
- training day,
- or trial number.

These values are intentionally not inferred from filenames or batch order because doing so could introduce unsupported assumptions into the analysis.

As a result, the application does not currently generate cohort-level learning curves, treatment-group comparisons, or repeated-measures summaries.

Trial-level results can be exported and joined to experimental metadata downstream.

---

### 11. Batch input does not support folder import or drag-and-drop

The batch workflow supports selecting multiple videos through the browser file picker.

Dedicated folder ingestion and drag-and-drop batch loading have not been implemented.

This is a workflow convenience limitation and does not affect the underlying analysis.

---

### 12. Publication-quality figure export is not yet implemented

The application includes research visualizations such as:

- trajectory plots,
- time-colored trajectories,
- occupancy heat maps,
- and hole-investigation rasters.

However, there is not yet a dedicated publication-figure export workflow with configurable physical dimensions, DPI, vector output, grayscale-safe formatting, or journal-specific styling.

The figures are useful for analysis and QC within the application, but publication-ready figure generation should be done separately

---

### 13. No deep-learning pose-estimation model is included

The current project intentionally avoids requiring:

- Python,
- CUDA,
- GPU drivers,
- downloaded pose-estimation models,
- or a remote inference service.

A learned pose-estimation model could improve robustness under difficult lighting, occlusion, or clutter, but it would substantially change the deployment model and dependency requirements of the project.

For this implementation, I prioritized a self-contained browser-based analysis pipeline.

---

## Reporting additional issues

If additional reproducible problems are found, they should ideally be documented with:

1. the affected source video,
2. the browser and version,
3. the analysis settings used,
4. the stage where the problem occurs,
5. expected behavior,
6. observed behavior,
7. whether the issue changes scientific outputs or only presentation,
8. and any known workaround.

Where possible, sample-specific defects should be documented by name (for example, `test51`) rather than summarized only as general robustness concerns.
