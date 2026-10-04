import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer } from "@sparkjsdev/spark";
import { loadDog } from "./dog.js";
import { createHud } from "./hud.js";
import { createArduinoInput } from "./input/arduino.js";
import { createBall } from "./interactions/ball.js";
import { createCameraDistance } from "./interactions/camera-distance.js";
import { createPet } from "./interactions/pet.js";

// Backgrounds, picked with ?scene=<name>. The first is the default.
const SCENES = {
  woods: () => import("./scenes/woods.js"),
  office: () => import("./scenes/office.js"),
};

const params = new URLSearchParams(location.search);
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

// Arduino first, so "Connect Arduino" works while the scene is still loading.
const input = createArduinoInput();
const hud = createHud(input);

// Per-frame work once the scene is up; see main().
let interactions = null;

// ?debug: draw the ground the ball and dog use (green free, red blocked).
function drawGroundDebug(ground, center, half) {
  const free = [], blocked = [];
  for (let x = center.x - half; x <= center.x + half; x += 1) {
    for (let z = center.z - half; z <= center.z + half; z += 1) {
      const G = ground.at(x, z);
      if (G) (G.blocked ? blocked : free).push(x, G.y, z);
    }
  }
  for (const [pts, color] of [[free, 0x33dd55], [blocked, 0xdd3333]]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 3, sizeAttenuation: false })));
  }
}

async function main() {
  const name = params.get("scene") ?? Object.keys(SCENES)[0];
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
  const dog = await loadDog(scene, setup.dog, setup.shadow);

  const target = setup.dog.ground.clone().add(new THREE.Vector3(0, setup.dog.height * 0.5, 0));
  controls.target.copy(target);
  const { radius, phi, theta } = setup.view;
  camera.position.setFromSphericalCoords(radius, phi, theta).add(target);
  controls.update();

  const ball = createBall({ scene, camera, dog, input, world: setup, onState: hud.setGame });
  hud.setGame(ball.state);
  interactions = {
    dog,
    ball,
    pet: createPet(dog, input, ball.dogAtHome),
    cameraDistance: createCameraDistance(input, camera, controls),
  };
  if (params.has("debug")) drawGroundDebug(setup.ground, setup.dog.ground, 4 * setup.unitsPerMeter); // ±4 m

  setStatus(`${name} · dog ${dog.splats.numSplats.toLocaleString()} splats`);
  window.snoopy = { scene, camera, controls, dog, ball, setup, arduino: input }; // for console tweaking
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

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1); // no huge steps after a stall or tab switch
  controls.update();
  if (interactions) {
    const { dog, ball, pet, cameraDistance } = interactions;
    cameraDistance.update(dt);
    keepCameraOutOfObstacles();
    pet.update(dt);
    ball.update(dt);
    dog.update();
    ball.lateUpdate();
  } else {
    keepCameraOutOfObstacles();
  }
  hud.update();
  renderer.render(scene, camera);
});

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`);
});
