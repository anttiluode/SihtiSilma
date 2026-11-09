# Sihti Eye v2 — results on 200 fresh photos

Gates and predictions were committed in [PREREG_V2.md](PREREG_V2.md) before this run. Test set: all 200 photos of the BSDS500 **test** split (P3 was trained on the train split, and none of the four dev photos are in it). 96×64 grayscale, 8×8 tiles, 20 looks (20.8% of pixels), seed 17. One run, no tuning on test. Reproduce with `node tests/benchmark_v2.cjs test`; full per-photo numbers are in [`results/v2_test.json`](results/v2_test.json).

## Mean PSNR after 20 looks

| Setup | dB |
|---|---:|
| Coarse image only (core + r3) | 19.88 |
| Coarse + random tiles (no memory) | 20.86 |
| Coarse + edge-chosen tiles (no memory) | 22.19 |
| P3, no looks | 21.52 |
| P3 + random tiles | 22.53 |
| P3 + edge-chosen tiles | 23.49 |
| P3 + visible-r3-energy tiles | 23.22 |
| **P3 + memory-disagreement tiles** | **24.06** |
| P3 + feedback v1 | 24.06 (identical, see below) |
| **P3 + feedback v2 (scale-free)** | **24.18** |
| P3 + feedback v2 + look-conditioned gain | 24.21 |
| Oracle tile choice (uses hidden truth; ceiling) | 25.03 |

## Gates

| Gate | Result | Verdict | My prediction |
|---|---|---|---|
| G1 disagreement − random ≥ +0.5 dB | +1.53 dB, CI [1.39, 1.69], wins 100% | **PASS** | pass |
| G2 disagreement − edge ≥ +0.2 dB and wins ≥ 55% | **+0.57 dB, CI [0.49, 0.66], wins 89%** | **PASS** | fail (wrong) |
| G3 feedback v2 − disagreement ≥ +0.1 dB | +0.12 dB, CI [0.09, 0.15], wins 65% | **PASS** (narrowly) | fail (wrong) |
| G4 gain-conditioned − paste-only ≥ +0.2 dB | +0.03 dB, CI [0.03, 0.04], wins 91% | **FAIL** | +0.1 to +0.3 (too high) |
| G5 oracle bound, finite gains | held on all 200 photos | **PASS** | |

## What it means

**Where the 4.30 dB over the coarse image comes from** (one way to split it, edge looks as the memory-free reference):

| Part | dB | Share |
|---|---:|---:|
| Looking where the picture is busy (coarse + edge tiles) | 2.31 | 54% |
| Old Sihti: P3 reconstruction of the unlooked parts | 1.30 | 30% |
| **New: the memory decides where to look** | **0.57** | 13% |
| **New: feedback from what the looks found** | **0.12** | 3% |

So SihtiSilma v1 was mostly old Sihti plus "look where it's busy", and on the four dev photos the memory's share looked negligible. On 200 fresh photos the memory's own contribution to choosing looks is **real and consistent**: it beats edges on 89% of photos. It closes 37% of the gap between edge-chosen looks and the oracle; adding feedback v2 closes 45%.

**Feedback v1 was never tested.** Its error/disagreement ratio was clamped at 5, and the real ratio exceeds 5 almost everywhere (358 of 384 dev tiles), so every tile got the same multiplier. Dividing by the median observed ratio connects it, and it then adds a small but reliable gain.

**Recalibrating the memory barely helps.** The fitted gains say P3 under-predicts its fine bands (mean final gains 1.07, 1.12, 1.26 for r2, r1, r0). Amplifying them helps on 91% of photos, but only by 0.03 dB. The memory's misses are mostly *where* and *what* detail goes, not *how much*. A gain can't fix that; it would take re-querying the memory with the observed pixels as evidence.

## Limits

- One crop size, one tile size, one budget, grayscale only.
- "Disagreement" is the spread of three nearby experts weighted by distance, not a calibrated posterior. Its absolute size is about 5× too small; only its ordering is used.
- Revealed tiles are pasted; P3 is not rerun around them. The gain correction is applied after the fact rather than inside P3's coarse-to-fine chain.
- The four dev photos were used for debugging only. The v2 code was not changed after the test run.
