import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

// Wooded path (Gaussian splats, 4.84M). The file is Y-down (3DGS/COLMAP
// axes), so it's flipped about X like the dog. Viewer coordinates below are
// after that flip: (x, y, z) in the file -> (x, -y, -z).
//
// Scale: the capture origin sits ~16 units above the path, which matches eye
// height if 1 unit ≈ 0.1 m.

// Measured with: node tools/ground-height.mjs ../wooded_path_bg.ply -40 30
// -> ground -22.248, up [-0.1536, 0.9851, -0.0778] (rms 0.2 over 13.6k splats).
// The path really slopes ~10° here (trees and horizon are level).
const DOG_GROUND = new THREE.Vector3(-40, -22.248, 30);
const GROUND_UP = new THREE.Vector3(-0.1536, 0.9851, -0.0778).normalize();

export async function load(scene) {
  scene.background = new THREE.Color(0xc9d6df);

  const woods = new SplatMesh({
    url: "/wooded_path_bg.spz", // built from wooded_path_bg.ply by tools/ply-to-spz.mjs
    lod: true, // 4.8M splats: let Spark pick a per-frame subset for the budget
  });
  woods.rotation.x = Math.PI;
  scene.add(woods);
  await woods.initialized;

  // Face back toward the capture origin, where the camera starts.
  const toOrigin = Math.atan2(-DOG_GROUND.x, -DOG_GROUND.z);

  return {
    dog: { ground: DOG_GROUND.clone(), normal: GROUND_UP, facing: toOrigin - 0.4, height: 4 },
    // Lifted ~1.5× the gravel layer's rms above the fitted plane, or the
    // gravel splats bury it.
    shadow: { kind: "splat", lift: 0.3, opacity: 0.85 },
    view: { radius: 26, phi: 1.3, theta: toOrigin },
    camera: { near: 0.1, far: 2000 },
    // Orbiting at 2560x1440 (2× pixel density) on an M5, MSAA off: 35 fps with
    // Spark defaults, 60 fps (display cap) with these; the image looks nearly
    // the same.
    // - lodSplatScale 0.35: 35% of Spark's LoD budget (2.5M desktop, 1.5M
    //   iOS, 1M Android).
    // - lodRenderScale 2: skip LoD splats smaller than 2 px.
    // - maxStdDev 2: draw each splat out to 2σ instead of √8σ; the cost is
    //   mostly blending big overlapping splats, so this is the biggest win.
    spark: { lodSplatScale: 0.35, lodRenderScale: 2, maxStdDev: 2 },
    maxPixelRatio: 1.5, // headroom for slower machines; 2 also held 60 fps
    controls: {
      minDistance: 6,
      // Further out the camera ends up inside the trees lining the path.
      maxDistance: 45,
      minPolarAngle: 0.2,
      // The ground slopes ~10° here; 0.42π keeps the camera ≥2.4 units above
      // it all the way round (checked with tools/ground-height.mjs).
      maxPolarAngle: Math.PI * 0.42,
    },
    obstacles: [],
  };
}
