# AI Notes

## Tools and models used

AI assistance for this project was limited to:

- **ChatGPT (GPT-5.6 Sol)** — used interactively during development for design discussion, implementation suggestions, debugging, code review, UI/refactoring ideas, documentation, and help reasoning through the scientific analysis workflow.
- **GitHub Copilot(in VSCode)** — used occasionally for brief error-handling and code-completion suggestions(usually issues of scope).

I did not use Claude, repo-level autonomous coding agents, or other AI development platforms for this project.

No special AI configuration was added to the repository. In particular, I did not create or use:

- `CLAUDE.md`
- a `.claude/` directory
- subagents
- hooks
- custom slash commands
- MCP servers
- custom agent skills or prompt configuration

ChatGPT was used through normal conversational sessions rather than as an autonomous repository agent and suggestions were applied selectively to the codebase rather than accepted as authoritative output.


## Times I disagreed with the model

- There were several points at which the conversation would lag, lose connection, hallucinate code blocks, and generally receive or output faulty information. These were caught relatively quickly, as my use of AI for mostly design, implementation, and debugging meant I was the one actually adding code to my repository for the entire development, and therefore would notice very quickly when something broke. 

- There were also some issues with its recommendations for how to deploy the live URL, recommending a Node install (explicitly verboten) or using some sort of deployed website(not good for task 1, all files need to remain local. ) 

-What I will say is that the model was actually quite helpful with recommendations as to what kind of data should be immediately presented and how, in a way that doesnt create confusion. For example, I wanted to try to create a frame interpolation effect for video decoding at one point, and the model recommended that would be a bad idea given that the model relies so much on frame associated data.

## What I checked before considering changes successful

AI-generated suggestions were not treated as correct until they were tested against the running application and the supplied Barnes maze videos.

Checks performed during development included:

- Running the application after code changes and resolving TypeScript/runtime errors.
- Testing tracking on the supplied recordings, especially `test50` and `test53`, and visually confirming that the trajectory followed the mouse.
- Checking trial-start handling and tracking coverage so pre-trial frames did not distort reported trial tracking quality.
- Comparing raw and smoothed trajectories and checking that missing tracking gaps were not silently interpolated.
- Inspecting automatic hole investigations against source frames and testing manual confirmation, rejection, editing, and addition of missed events.
- Testing exact-frame review, manual tracking-point correction, trial-start overrides, and persistence of review state.
- Inspecting the trajectory, occupancy heat map, and hole-visit raster for consistency with the reviewed trial.
- Checking that behavioral metrics were derived from the reviewed analysis state rather than overwriting or discarding the automatic results.
- Testing CSV/XLSX export and saved workspace/settings workflows as they were added.
- Re-testing changes on multiple sample videos rather than assuming that behavior observed on one recording generalized to the others.

The remaining known limitations and reproducible issues are documented separately in `KNOWN_ISSUES.md`, including the false non-mouse object tracked briefly at the beginning of `test51`.

AI assistance was therefore used as a development aid, while acceptance of a change depended on direct testing, visual inspection, and consistency with the intended Barnes maze analysis workflow.
