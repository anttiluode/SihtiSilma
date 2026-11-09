# Sihti Silmä v2 — preregistration (written 9 Nov 2026, before any v2 run on the test photos)

Author: Claude (Opus 5.5), at Antti's invitation. v1 code, results and `PREREG.md` are left unchanged.

## Why a v2

A re-analysis of v1 on the four dev photos found:

1. **Most of the v1 gain needs no memory.** Mean PSNR after 20 looks: coarse image only 22.56 dB; coarse + 20 edge-chosen tiles, no memory at all, 26.27; P3 + edge tiles 27.50; P3 + disagreement tiles 27.91. Of the 5.35 dB over the coarse image, about 3.7 dB comes from looking where the picture is busy, 1.2 dB from the old P3 reconstruction, and 0.41 dB from memory-guided looking.
2. **v1 feedback was disconnected, not refuted.** Its error/disagreement ratio is clamped at 5, and the real ratio exceeds 5 in 358 of 384 dev tiles. Every tile then gets the same multiplier, so the ranking never changes and the result is exactly +0.00 dB. The v1 "FAIL" should read "not tested".
3. **Looking never changed the memory.** Revealed tiles were pasted in; the reconstruction elsewhere stayed the same.

## Data

- **Dev:** the four bundled photos (42049, 8023, 108082, 196073). Used for debugging only.
- **Test:** all 200 photos of the BSDS500 **test** split (P3 was trained on the train split; none of the dev photos are in test). Same 96×64 grayscale centre crop and bilinear resize as `tests/benchmark.cjs`. Run once, after this file is committed.

## What v2 adds

- **`feedback2`:** v1 feedback with the ratio made scale-free: each observed tile's error/disagreement ratio is divided by the median ratio over all observed tiles, then clamped to [0.2, 5]. It says "this neighbourhood is worse than the memory's usual miss", which is what v1 intended.
- **Look-conditioned gain (`+gain`):** P3 predicts three fine bands p2, p1, p0. On all revealed pixels, the true fine detail is t = truth − (core + r3). Fit three gains by ridge regression toward 1:
  g = (A + μI)⁻¹(b + μ·1), with A = PᵀP, b = Pᵀt, μ = 0.5·trace(A)/3, each g clamped to [0, 2].
  The unrevealed pixels become core + r3 + Σ g_b·p_b. Revealed pixels stay pasted truth. The gains are refit after every look. P3 is not rerun between bands (the correction is applied after the fact).
- **Memory-free controls:** coarse image only, with tiles chosen by edges or by visible r3 energy.

No parameter above is tuned on test. μ = 0.5 and the clamps are fixed here.

## Gates (20 looks, mean over 200 test photos; 95% bootstrap CI over photos reported for every difference)

| Gate | Pass if |
|---|---|
| G1 replication | disagreement − random ≥ +0.5 dB |
| G2 memory beats busy-ness | disagreement − edge (both on P3) ≥ +0.2 dB **and** disagreement wins on ≥ 55% of photos |
| G3 feedback, connected | feedback2 − disagreement ≥ +0.1 dB |
| G4 looks recalibrate memory | (disagreement + gain) − (disagreement, paste only) ≥ +0.2 dB |
| G5 sanity | paste-only policies never exceed the oracle at any look; gain fits are finite on every photo |

## Predictions (mine, before running)

- G1 passes; it is mostly the busy-ness effect.
- G2 is the real question. I expect it to **fail**: a small positive gain on average, under 0.2 dB.
- G3: small. I expect a fail, between 0 and +0.1 dB.
- G4: uncertain. The 5× gap between real error and expert disagreement says the experts agree with each other while all missing. It does not say their amplitude is off, so a gain could easily come out near 1 and add nothing. I'd guess +0.1 to +0.3 dB.

If G2 fails, the honest summary is that this eye looks where a picture is busy, and the memory adds little to that choice.
