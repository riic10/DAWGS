import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

// Backgrounds, picked with ?scene=<name>. The first is the default.
const SCENES = {
  woods: () => import("./scenes/woods.js"),
  office: () => import("./scenes/office.js"),
};

const DOG = {
  url: "/dog_model.spz", // built from dog_model.ply by tools/ply-to-spz.mjs
  // Rotation applied to the raw PLY before placement (Euler XYZ, radians).
  // The PLY is Y-down (usual 3DGS/COLMAP convention), so flip it about X.
  rotation: new THREE.Euler(Math.PI, 0, 0),
};

const statusEl = document.getElementById("status");
const setStatus = (text) => { statusEl.textContent = text; };

// No MSAA: it doesn't help soft splats and multiplies the cost of blending
// overlapping ones.
const renderer = new THREE.WebGLRenderer({ antialias: false });
let maxPixelRatio = 2; // scenes can lower this; splat fill rate scales with pixel count
function resize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
resize();
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 100);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false; // keep the orbit centred on the dog

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
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
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

// Place the dog so its lowest splat centre touches `ground`, its centre is
// above it, it's `height` tall and it faces azimuth `facing` (radians from
// +Z toward +X, the same convention as OrbitControls). The dog stays upright;
// the shadow lies along the ground's `normal`.
async function loadDog({ ground, normal = new THREE.Vector3(0, 1, 0), facing, height }, shadowCfg) {
  const dog = new SplatMesh({ url: DOG.url });
  await dog.initialized;

  // The flipped model faces -X, so facing azimuth θ needs a yaw of θ + π/2.
  dog.quaternion
    .setFromEuler(DOG.rotation)
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing + Math.PI / 2));
  dog.updateMatrix();
  const box = dog.getBoundingBox(true).applyMatrix4(dog.matrix);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / size.y;
  dog.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3());
  dog.position.set(
    ground.x - center.x * scale,
    ground.y - box.min.y * scale,
    ground.z - center.z * scale,
  );
  scene.add(dog);

  const radius = Math.max(size.x, size.z) * scale * 0.55;
  const shadow = shadowCfg.kind === "splat"
    ? makeSplatShadow(radius, shadowCfg.opacity ?? 0.85)
    : makeMeshShadow(radius);
  shadow.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
  // By default lift it a hair (0.25% of the dog's height) so it sits on, not
  // in, the ground.
  shadow.position.copy(ground).addScaledVector(normal, shadowCfg.lift ?? height * 0.0025);
  scene.add(shadow);

  return dog;
}

async function main() {
  const name = new URLSearchParams(location.search).get("scene") ?? Object.keys(SCENES)[0];
  if (!SCENES[name]) throw new Error(`Unknown scene "${name}" (try: ${Object.keys(SCENES).join(", ")})`);
  setStatus(`Loading ${name}…`);
  const setup = await (await SCENES[name]()).load(scene);

  camera.near = setup.camera.near;
  camera.far = setup.camera.far;
  camera.updateProjectionMatrix();
  Object.assign(controls, setup.controls);
  Object.assign(spark, setup.spark);
  maxPixelRatio = setup.maxPixelRatio ?? maxPixelRatio;
  resize();
  obstacles = setup.obstacles;

  setStatus("Loading dog…");
  const dog = await loadDog(setup.dog, setup.shadow);

  const target = setup.dog.ground.clone().add(new THREE.Vector3(0, setup.dog.height * 0.5, 0));
  controls.target.copy(target);
  const { radius, phi, theta } = setup.view;
  camera.position.setFromSphericalCoords(radius, phi, theta).add(target);
  controls.update();

  setStatus(`${name} · dog ${dog.numSplats.toLocaleString()} splats`);
  window.snoopy = { scene, camera, controls, dog, setup }; // for console tweaking
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  resize();
});

// If the camera ends up inside an obstacle box, pull it back along the line
// to the target until it's just outside. OrbitControls re-reads the camera
// position on its next update, so obstacles act as a solid stop.
let obstacles = [];
const boomRay = new THREE.Ray();
const hit = new THREE.Vector3();
function keepCameraOutOfObstacles() {
  for (const box of obstacles) {
    if (!box.containsPoint(camera.position)) continue;
    boomRay.origin.copy(controls.target);
    boomRay.direction.subVectors(camera.position, controls.target).normalize();
    if (boomRay.intersectBox(box, hit)) {
      camera.position.copy(hit).addScaledVector(boomRay.direction, -0.01);
    }
  }
}

renderer.setAnimationLoop(() => {
  controls.update();
  keepCameraOutOfObstacles();
  renderer.render(scene, camera);
});

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`);
});
