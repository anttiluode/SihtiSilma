# Sihti Silmä — Sihti Eye

**An eye that decides where to look next.** A zero-server browser laboratory for *active sensing* over the original [SihtiImageModel](https://github.com/anttiluode/SihtiImageModel) BSDS500-trained patch memory.

**[Open the Pages laboratory](https://anttiluode.github.io/SihtiSilma/)** · [Experiment plan](PREREG.md) · [Source](eye.js)

> Question: if a memory can reconstruct an image but remains uncertain about its missing details, can it choose the most useful small spatial measurement without looking at the hidden original?

## What is actually running

- The **original 512-code P3 patch memory** exported from [SihtiImageModel/web/patch_bsds.json](https://github.com/anttiluode/SihtiImageModel/blob/main/web/patch_bsds.json): learned on the BSDS500 **train split** (200 photos), not trained here.
- The original Sihti **five-stage diffusion sieve** (time steps 0, 1, 4, 16, 64, reflecting boundaries, dt=0.25). Every input decomposes exactly into \`r0+r1+r2+r3+core\`.
- The eye receives only **core+r3**, then P3 predicts r2, r1 and r0 using its 5×5 coarse windows, a 512-expert codebook and local 26×16 linear maps. The nearest expert supplies the reconstruction, exactly as in the parent's P3 rule.
- A fixed **96×64 grayscale** test image is split into 96 disjoint **8×8 tiles**. Each observation gives the eye the **true pixels from one chosen tile**, at a cost of 64 pixels. All observers have equal budgets.
- The spatial **disagreement score** is a proxy: weighted variance across the *three closest local P3 experts' predicted r0 patches*, averaged over each tile. The model's nearest expert remains the actual reconstruction. The weights depend on feature distance; they are **not calibrated posterior probabilities**.

## Six comparison policies

| Policy | What it can use |
|---|---|
| Fixed raster | Tile index only |
| Seeded random | Tile index and random seed |
| Coarse edges | Gradient magnitude in already visible core+r3 |
| Expert disagreement | Predictions from trained local P3 experts using available reconstructed coarse input |
| Feedback | Disagreement score reweighted using **errors seen in previously revealed tiles**, smoothed across nearby locations |
| Oracle (ceiling only) | Actual full-image squared error — **not** an allowed observer |

**No true pixel values are consulted by the first five policies until the tile is revealed.** The scoring harness does compute ground-truth errors for scoring and for the deliberately disallowed oracle; the policy code path does not read them for unseen tiles. Tests use forbidden getters to check this distinction.

At each step the selected tile replaces P3's estimate with the observed pixel values. The other regions stay fixed. The *feedback* policy updates its location-selection score using observed errors, but **P3 is not rerun after the observation** and its experts are not modified. This is a controlled first experiment in selecting measurements, **not yet** a fully recurrent active reconstruction architecture.

## Run

1. Open \`index.html\` directly in Chrome / Firefox / Edge (no server).
2. Select one of four included BSDS500 held-out pictures or upload your own.
3. Pick a policy; press **Look once** or **Play 20 looks**. The same image and observation budget are used for every policy.
4. Compare PSNR curves, tiles visited, and the baselines.
5. Press **Run all 4 held-out photos** to compare the four included images with a deterministic seed, then download the benchmark JSON.

The trained \`data/patch_bsds.js\` is embedded as JavaScript for local \`file://\` use; the photos are local PNGs. The page loads no libraries, fonts, analytics, or remote assets. The optional upload is read in memory only.

### Repeatable checks

\`\`\`bash
node --check eye.js
node tests/smoke.cjs
\`\`\`

Node 22+ is recommended; no \`npm install\` or Python dependencies. GitHub Actions runs the same checks on pushes.

## Research honesty

- The original [SihtiImageModel BSDS500 result](https://github.com/anttiluode/SihtiImageModel) (25.12 dB P3 vs 24.87 dB linear, averaged across its 300 held-out half-sized photos) is **not a result from this experiment**.
- These four photos come from the original repo's demonstration files. They were validation images relative to the original P3 train split. The eye resizes/crops them to 96×64 grayscale for speed, so you cannot compare its dB values to the parent's full-resolution results.
- This experiment is not trained on the four photos; however, tuning the policy against these four scenes would make them development data rather than a fresh hold-out.
- Disagreement need not correlate with true uncertainty. Expert variance can miss shared systematic errors. The feedback update is a simple spatial heuristic, not a learned model of error and not Bayesian posterior updating.
- **Oracle beats the others by design** because revealing disjoint tiles makes pixel-wise error additive. It is a ceiling, not a competitor that can operate without seeing the original.
- Future gate: run P3 completion *again* after the newly observed tile, with the same sensing budget and an independent held-out set. That requires conditioning patch predictions on observed information; merely pasting true pixels into the image does not provide this.

## Reproducibility and lineage

\`\`\`text
index.html                   offline instrument page
style.css                    interface
eye.js                       Sihti sieve, fixed P3, observer policies, measurement and PSNR
data/patch_bsds.js           original trained P3 BSDS500 model, verbatim export wrapped in JS
data/photo_*.png             four photos from SihtiImageModel web demo
tests/smoke.cjs              deterministic functionality and information-boundary checks
.github/workflows/check.yml  Node test workflow
.github/workflows/static.yml existing GitHub Pages deployment (unchanged)
PREREG.md                    predictions / kill criteria
\`\`\`

The original code and exported model derive from **[anttiluode/SihtiImageModel](https://github.com/anttiluode/SihtiImageModel)**. Dataset photographs are from its published BSDS500 demonstration; check the original dataset's terms separately from the software license. No claims of new Hopfield networks, new Bayesian experimental design, or new biological neuron mechanisms are made.

### The continuing question

*Can a memory system learn the geometry of what it does not know — and use that geometry to decide where to look?*

This is the small active-eye test motivated by the PerceptionLab ECG feedback reduction, Sihti's multiscale residues, and OneTinyTransformer's experiments comparing frozen exploration, statistical queries, and learned next-observation policies.
