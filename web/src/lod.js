import * as THREE from "three";

// Distance-based Spark LoD for the Gaussian splat background.
//
// Spark already picks a per-frame subset: screen-space size plus foveation
// toward the view centre (the orbit target is Snoopy). This module only eases
// Spark's budget knobs so far = fewer/cheaper splats and close = more detail
// on the path around the dog. A frame-time governor pulls quality back if
// the machine starts to stall — stable FPS over peak splat count.
//
// Caps stay well under Spark's defaults (lodSplatScale 1.0 was 35 fps on an
// M5 at 2560×1440). The woods scene held 60 fps at 0.35 / 2 px / maxStdDev 2.

export const SPLAT_LOD = {
  smoothingSeconds: 0.28,
  close: {
    lodSplatScale: 0.46,
    lodRenderScale: 1.5,
    coneFov0: 92,
    coneFov: 128,
    coneFoveate: 0.48,
  },
  far: {
    lodSplatScale: 0.2,
    lodRenderScale: 2.9,
    coneFov0: 52,
    coneFov: 96,
    coneFoveate: 0.3,
  },
  // Soften toward `far` when the smoothed frame time exceeds the target.
  targetFrameMs: 18,
  stressFrameMs: 28,
  maxStressDrop: 0.55,
  // Only hand Spark a new budget when quality has moved this much (0..1).
  // Every budget change makes Spark remap the woods' splats, and it won't
  // rebuild the splats (the animated dog included) while a remap waits on its
  // ~250 ms sort, so nudging the knobs each frame froze the dog at ~4 fps.
  qualityStep: 0.08,
};

const KNOBS = ["lodSplatScale", "lodRenderScale", "coneFov0", "coneFov", "coneFoveate"];

function lerpKnobs(far, close, t) {
  const out = {};
  for (const key of KNOBS) out[key] = far[key] + (close[key] - far[key]) * t;
  return out;
}

// `target` is the orbit point (Snoopy). Call update() after controls.update().
export function createSplatLod({ spark, camera, target, nearDistance, farDistance, close, far, smoothingSeconds, targetFrameMs, stressFrameMs, maxStressDrop }) {
  const near = { ...SPLAT_LOD.close, ...close };
  const distant = { ...SPLAT_LOD.far, ...far };
  const ease = smoothingSeconds ?? SPLAT_LOD.smoothingSeconds;
  const goodMs = targetFrameMs ?? SPLAT_LOD.targetFrameMs;
  const badMs = stressFrameMs ?? SPLAT_LOD.stressFrameMs;
  const drop = maxStressDrop ?? SPLAT_LOD.maxStressDrop;
  const span = Math.max(1e-4, farDistance - nearDistance);

  let proximity = null; // 1 = next to the dog, 0 = far
  let stress = 0;
  let emaDt = goodMs / 1000;
  let applied = null; // quality last handed to Spark

  const state = {
    distance: 0,
    proximity: 0,
    stress: 0,
    quality: 0,
    lodSplatScale: distant.lodSplatScale,
    lodRenderScale: distant.lodRenderScale,
  };

  return {
    state,
    update(dt) {
      const distance = camera.position.distanceTo(target);
      const want = 1 - THREE.MathUtils.clamp((distance - nearDistance) / span, 0, 1);
      if (proximity === null) proximity = want;
      else proximity += (want - proximity) * (1 - Math.exp(-dt / ease));

      // Ignore tab-switch / load hitches so one long frame doesn't collapse LoD.
      if (dt < 0.05) emaDt += (dt - emaDt) * (1 - Math.exp(-dt / 0.35));
      const wantStress = THREE.MathUtils.clamp((emaDt * 1000 - goodMs) / Math.max(1e-3, badMs - goodMs), 0, 1);
      stress += (wantStress - stress) * (1 - Math.exp(-dt / 0.45));

      const quality = proximity * (1 - drop * stress);
      if (applied === null || Math.abs(quality - applied) >= SPLAT_LOD.qualityStep) applied = quality;
      const knobs = lerpKnobs(distant, near, applied);

      spark.lodSplatScale = knobs.lodSplatScale;
      spark.lodRenderScale = knobs.lodRenderScale;
      spark.coneFov0 = knobs.coneFov0;
      spark.coneFov = knobs.coneFov;
      spark.coneFoveate = knobs.coneFoveate;

      state.distance = distance;
      state.proximity = proximity;
      state.stress = stress;
      state.quality = quality;
      state.lodSplatScale = knobs.lodSplatScale;
      state.lodRenderScale = knobs.lodRenderScale;
    },
  };
}
