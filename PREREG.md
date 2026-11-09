# Sihti Silmä — first-gate predictions (written before evaluating the new browser benchmark)

## Experimental protocol
- Fixed original SihtiImageModel P3 BSDS500 export (512 local rules per band).
- Four photos that are validation images in the parent project, resized and center-cropped to 96×64 grayscale. These four are *not* fresh blind test data for later revisions of the eye.
- Start with only r3+core visible; complete r2, r1 and r0 with the fixed P3 memory.
- Each policy reveals the exact same number of non-overlapping 8×8 tiles, up to 20 steps (20 × 64 = 1280 pixels, 20.83% of the image).
- Policies: raster, random seed 17, coarse-edge magnitude, three-expert r0 disagreement, local feedback from observed errors, and an oracle ceiling.
- Metric: PSNR after 0, 1, 2, 5, 10, 20 looks; mean over four images and per-image curves.
- The actual hidden image cannot influence policy selection except for oracle and for already observed tile errors in feedback.

## Predictions and kill conditions
1. **Sensing should help**: all policies must improve or retain PSNR when given direct correct-pixel observations. Violation = implementation bug.
2. **Uncertainty gate**: disagreement should beat seeded random at 20 looks by **at least +0.5 dB mean PSNR across the four photos**. If not, the expert-variance proxy failed as an active-sensing score on this small benchmark.
3. **Feedback gate**: feedback should beat the static disagreement policy by **at least +0.1 dB mean PSNR across four photos**. If not, the spatial-feedback heuristic did not add value.
4. **Oracle upper bound**: oracle should perform at least as well as every policy at every observation count (allow 1e-6 numerical tolerance); violation = implementation bug.
5. The P3 decoding/sieve must pass exact-shape, finite-value, and telescoping checks; unauthorized truth access must be caught by a test.

## Limitations pre-committed
- Four scenes are too few for a broad statistical generalization. Do not adjust thresholds or the policy after viewing their outcomes and then call these four independent confirmation data.
- An observed tile is directly replaced with truth. This measures *where to spend the observation budget*, not whether local P3 can assimilate observations into neighbouring missing regions.
- The three expert votes are not a calibrated posterior, and choosing a variance-maximizing tile can miss shared, systematic errors.
- If the active policy wins, it has demonstrated a classical active-measurement advantage **on this task**, not a new cognitive architecture.
