# Sihti Eye — first four-photo benchmark

**Recorded 9 November 2026 from [GitHub Actions benchmark run](https://github.com/anttiluode/SihtiSilma/actions/runs/42649869626).** This uses the original BSDS500-trained P3 model, the four photographs bundled in the original SihtiImageModel web demo, a 96×64 grayscale bilinear resize/crop, observation tiles of 8×8 pixels, seed 17, and a budget of 20 non-overlapping tile reveals (1280 / 6144 pixels = 20.8%). The Node PNG resampler is an approximation to browser canvas image scaling; browser figures may differ slightly.

| Photo | P3 before | Fixed | Random | Edges | Disagreement | Feedback | Oracle |
|---|---:|---:|---:|---:|---:|---:|---:|
| 42049 | 20.67 | 20.93 | 21.29 | 23.20 | **23.30** | 23.30 | 24.57 |
| 8023 | 24.44 | 25.17 | 25.17 | 26.43 | **27.11** | 27.11 | 27.54 |
| 108082 | 21.78 | 22.45 | 22.76 | 25.12 | **25.43** | 25.43 | 26.47 |
| 196073 | 29.02 | 29.18 | 29.58 | 35.26 | **35.80** | 35.80 | 36.08 |
| **Mean** | **23.98** | **24.43** | **24.70** | **27.50** | **27.91** | **27.91** | **28.67** |

All values are PSNR (dB), after 20 looks except "P3 before".

## Preregistered verdict

- **Implementation / monotonicity:** passed in tests; revealing true pixels cannot worsen clipped-pixel PSNR.
- **Disagreement advantage over random >= +0.5 dB:** **PASS, +3.21 dB** on these four photos.
- **Feedback advantage over static disagreement >= +0.1 dB:** **FAIL, +0.00 dB**. The current local feedback heuristic effectively preserves the static tile ranking. Do **not** describe this as successful homeostatic curiosity.
- **Oracle ceiling:** passed for every intermediate look in the Node benchmark. The oracle uses forbidden knowledge intentionally and is not a deployable policy.

**The harder comparison is edges:** disagreement's advantage over a coarse-image edge scan is only **+0.41 dB**. This is small, measured on four examples only, and needs testing on independent held-out photographs before making broader claims. More importantly, all policies directly paste true pixels into the reconstructed image; the rest of the P3 reconstruction is unchanged. The metric is **where to spend a limited number of pixel observations**, not downstream restoration from those observations.

## Follow-up gate

Do not tune the proxy on these four photos and then treat them as independent confirmation. Use genuinely unseen images. Compare (a) fixed reconstruction + revealed tiles, (b) P3 conditioned on observed tiles, and (c) a spatially adaptive feedback policy whose decisions genuinely change as error is observed. The new policy must beat the simple edge and random controls under exactly equal look and compute budgets.

## Reproduce

\`\`\`bash
node tests/smoke.cjs
node tests/benchmark.cjs
\`\`\`

The benchmark writes \`results/node_benchmark.json\` locally with full per-image and mean intermediate checkpoints. GitHub Actions uploads that JSON as an artifact. Source: [tests/benchmark.cjs](tests/benchmark.cjs). Predictions were written in [PREREG.md](PREREG.md) before this benchmark.
