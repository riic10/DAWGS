import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const UP = new THREE.Vector3(0, 1, 0);

function makeMeshShadow(radius) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
}

// On a splat background a mesh can't sort against the splats, so the
// shadow is itself one flat, dark Gaussian (in its local XZ plane); its
// falloff is the soft edge.
function makeSplatShadow(radius, opacity) {
  return new SplatMesh({
    constructSplats: (splats) => {
      const sigma = radius / 1.6;
      splats.pushSplat(
        new THREE.Vector3(),
        new THREE.Vector3(sigma, sigma * 0.01, sigma),
        new THREE.Quaternion(),
        opacity,
        new THREE.Color(0, 0, 0),
      );
    },
  });
}

// A soft contact shadow. `cfg` is a scene's shadow config:
// { kind: "mesh" | "splat", lift?, opacity? }. `defaultLift` applies when the
// scene doesn't set one.
export function createShadow(scene, cfg, radius, defaultLift) {
  const object = cfg.kind === "splat"
    ? makeSplatShadow(radius, cfg.opacity ?? 0.85)
    : makeMeshShadow(radius);
  scene.add(object);
  const lift = cfg.lift ?? defaultLift;
  const baseOpacity = cfg.kind === "splat" ? 1 : object.material.opacity;

  return {
    object,
    // Lay the shadow on the ground at `point`, along the ground's `normal`.
    place(point, normal = UP) {
      object.quaternion.setFromUnitVectors(UP, normal);
      object.position.copy(point).addScaledVector(normal, lift);
    },
    // 0..1: fade and shrink, e.g. as the thing casting it rises.
    setStrength(s) {
      object.scale.setScalar(0.6 + 0.4 * s);
      if (cfg.kind === "splat") object.opacity = s;
      else object.material.opacity = baseOpacity * s;
    },
    setVisible(v) { object.visible = v; },
  };
}
