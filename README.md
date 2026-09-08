# Barnes Maze Analyzer

**Live application:** https://dliarakos.github.io/Salk-AIRC-Take-Home-Maze-Analyzer/
**Demo video:** (https://youtu.be/FkXiFdpx4SM)  
**Take-home repository / sample videos:** https://github.com/salk-airc/rse-takehome-2026/

Barnes Maze Analyzer is a browser-based research tool for analyzing mouse Barnes maze behavior from video. It performs local video decoding, arena and hole calibration, animal tracking, trajectory quality control, hole-investigation detection, frame-accurate manual review, behavioral metric calculation, visualization, and export.

The finished application is deployed as a static webpage.

**No software installation is required to use it.**

Researchers open the hosted application in a compatible desktop browser, select Barnes maze videos from their local computer, and perform the complete analysis workflow in the browser. Source videos are not uploaded to an analysis server.

---

## Who this is for

Barnes Maze Analyzer is intended for researchers, research assistants, and core-facility staff who need to analyze Barnes maze experiments efficiently while retaining scientific oversight of automatically generated results.

A major goal of the project was to avoid treating automated tracking and behavioral classification as unquestionable outputs. Video-analysis pipelines can substantially reduce manual scoring time, but behavioral experiments often contain ambiguous frames, temporary tracking failures, or events that require researcher interpretation.

The application therefore combines automation with explicit manual review.

Automatic tracking, event detections, and classifier outputs are retained separately from manual corrections and reviewer decisions wherever possible. This allows a downstream result to remain traceable to the automatic measurement that produced it and to any subsequent human intervention.

---

# Why I chose this project

I chose the Barnes maze project because it provided a useful balance between skills I already had and areas I wanted to learn.

My background is primarily in bioinformatics and scientific pipeline development. I have experience building data-analysis workflows and React/TypeScript interfaces, so I was already comfortable thinking about problems in terms of staged processing, QC, parameterization, reproducibility, and transforming raw experimental data into biologically meaningful outputs.

Those skills transferred naturally to the Barnes maze problem.

At the same time, several of the central technical problems were new to me, including:

- Browser-side video decoding
- Exact video timestamp handling
- Working with presentation order versus decode order
- Classical computer-vision tracking
- Body-orientation estimation
- Behavioral event detection from geometric and temporal evidence
- Frame-accurate manual video review

This made the project a good opportunity to learn new technical areas while still building on skills I already use in bioinformatics and research software engineering.

I also chose this project over the mobile-application option because mobile interface design, authentication, and application-security concerns would have introduced several largely unrelated unfamiliar domains simultaneously. I preferred a project where I could take on substantial new technical challenges while still working from a strong foundation in scientific software and data analysis.

---

# Running the application

## No installation required

Open the hosted Barnes Maze Analyzer:

**[ADD LIVE URL]**

That is the normal way to use the application.

The researcher does **not** need to install:

- Node.js
- npm
- Python
- R
- a database
- a backend server
- a GPU runtime
- a desktop application
- browser extensions

After the webpage loads, the Barnes maze analysis pipeline runs locally on the researcher's computer.

A typical user workflow is:

1. Open the hosted webpage.
2. Select one or more local Barnes maze MP4 recordings.
3. Calibrate the maze.
4. Run mouse tracking.
5. Inspect tracking QC.
6. Review detected hole investigations.
7. Review escape behavior.
8. Inspect calculated behavioral metrics and visualizations.
9. Export the reviewed results.

No command line is required.

---

## Browser requirements

The application requires a modern desktop browser with WebCodecs `VideoDecoder` support.

For the submitted version, a current Chromium-based browser such as Chrome or Edge is recommended.

WebCodecs is used for exact source-frame decoding during manual behavioral review, so browser support for this API is a functional requirement rather than only a performance optimization.

The analysis pipeline does not require a dedicated GPU or workstation-class computer. It was designed to run client-side on ordinary laboratory hardware.

---

# Architecture

Barnes Maze Analyzer is intentionally implemented as a **fully client-side static web application**.

The production website serves static HTML, JavaScript, CSS, and related application assets. There is no video-analysis backend, database, or persistent application server.

The high-level analysis path is:


Local MP4
   ↓
Browser video decoding
   ↓
Arena calibration
   ↓
Hole calibration
   ↓
Mouse tracking
   ↓
Trajectory QC and smoothing
   ↓
Orientation / nose estimation
   ↓
Hole-investigation detection
   ↓
Manual behavioral review
   ↓
Escape review
   ↓
Behavioral metrics
   ↓
Visualization
   ↓
CSV / XLSX / JSON export
