import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer } from "@sparkjsdev/spark";
import { loadDog } from "./dog.js";
import { createHud } from "./hud.js";
import { createArduinoInput } from "./input/arduino.js";
import { createBall } from "./interactions/ball.js";
import { createCameraDistance } from "./interactions/camera-distance.js";
import { createCameraStick } from "./interactions/camera-stick.js";
import { createPet } from "./interactions/pet.js";
import { createSplatLod } from "./lod.js";
import { createSidebar, hasModel } from "./sidebar.js";
import { createUploadDialog } from "./upload.js";
import { createHfAuth } from "./hf-auth.js";

// Backgrounds, picked with ?scene=<name>. The first is the default.
const SCENES = {
  woods: () => import("./scenes/woods.js"),
  office: () => import("./scenes/office.js"),
};

// Coming back from "Sign in with Hugging Face" lands on ?code=…; hf-auth
// handles it and hands back the query string we left with (e.g. ?scene=office).
const auth = createHfAuth();
let params = new URLSearchParams(location.search);
const statusEl = document.getElementById("status");
const loaderEl = document.getElementById("loader");
const loaderText = document.getElementById("loader-text");
const setStatus = (text) => {
  statusEl.textContent = text;
  if (loaderText) loaderText.textContent = text;
};
const hideLoader = () => loaderEl?.classList.add("done");

// UI first, so the profile card and "Connect Arduino" work while the
// splat scene is still loading (and even if WebGL is slow to start).
const input = createArduinoInput();
const hud = createHud(input);

// Sidebar picks -> dog model in the scene. Dogs without a model keep the
// current one (the card says "coming soon"). Swaps run one at a time and only
// the latest pick is loaded; picks before the scene is up wait for it.
let sceneDog = null;
let shownModel = null; // the splat object currently in the scene
let wantedEntry = null;
let swapQueue = Promise.resolve();
function selectDog(entry) {
  if (!hasModel(entry)) return;
  wantedEntry = entry;
  if (!sceneDog) return;
  swapQueue = swapQueue.then(async () => {
    if (entry !== wantedEntry || entry.splat === shownModel) return;
    setStatus(`Loading ${entry.name}…`);
    loaderEl?.classList.remove("done");
    try {
      await sceneDog.setModel(entry.splat);
      shownModel = entry.splat;
      interactions?.ball.reset();
      setStatus(`${entry.name} · ${sceneDog.splats.numSplats.toLocaleString()} splats`);
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't load ${entry.name}: ${err.message}`);
    } finally {
      hideLoader();
    }
  });
}
const sidebar = createSidebar({
  onSelect: selectDog,
  onUpload: () => uploadDialog.open(),
  onRename: () => uploadDialog.open({ focusName: true }),
});
const uploadDialog = createUploadDialog({
  auth,
  onDog: ({ name, photoUrl, bytes }) => sidebar.setUploaded({
    id: "upload",
    name,
    age: "—",
    breed: "—",
    gender: "—",
    photo: photoUrl,
    personality: "Generated from your photo with TRELLIS.",
    splat: { fileBytes: bytes },
    scene: null, // shows up in whichever scene is open
    animation: null,
  }),
  onRename: (name) => sidebar.renameUploaded(name),
  onTurn: () => sceneDog?.turn(Math.PI / 2),
});

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

const spark = new SparkRenderer({ renderer, accumExtSplats: true, covSplats: true, autoUpdate: false });
scene.add(spark);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false; // keep the orbit centred on the dog

// Per-frame work once the scene is up; see main().
let interactions = null;
let frameUpdate;
let splatLod = null;
let debugLod = params.has("debug");
let debugLodFrames = 0;

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
  const back = await auth.ready;
  if (back?.search) {
    history.replaceState(null, "", location.pathname + back.search);
    params = new URLSearchParams(location.search);
    debugLod = params.has("debug");
  }
  if (back?.upload) uploadDialog.open({ name: back.name ?? "" });

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

  // The dog picked in the sidebar, or the first one with a model.
  const first = wantedEntry ?? sidebar.dogs.find(hasModel);
  setStatus(`Loading ${first.name}…`);
  const dog = await loadDog(scene, {
    ...setup.dog, unitsPerMeter: setup.unitsPerMeter,
    groundHeight: point => setup.ground.at(point.x, point.z)?.y,
  }, setup.shadow, first.splat);
  shownModel = first.splat;

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
    pet: createPet(dog, input, ball.dogAtHome, camera),
    cameraStick: createCameraStick(input, camera, controls, setup.view),
    cameraDistance: createCameraDistance(input, camera, controls),
  };
  if (setup.splatLod) {
    splatLod = createSplatLod({ spark, camera, target: controls.target, ...setup.splatLod });
    splatLod.update(0);
  }
  if (debugLod) drawGroundDebug(setup.ground, setup.dog.ground, 4 * setup.unitsPerMeter); // ±4 m

  setStatus(`${name} · ${first.name} · ${dog.splats.numSplats.toLocaleString()} splats`);
  hideLoader();
  sceneDog = dog;
  if (wantedEntry && wantedEntry !== first) selectDog(wantedEntry); // picked while loading
  window.snoopy = { scene, camera, controls, dog, ball, setup, arduino: input, lod: splatLod, dogs: sidebar, upload: uploadDialog, auth }; // for console tweaking
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
    const { dog, ball, pet, cameraStick, cameraDistance } = interactions;
    dog.prepareFrame(dt);
    cameraStick.update(dt);
    cameraDistance.update(dt);
    keepCameraOutOfObstacles();
    if (splatLod) splatLod.update(dt);
    pet.update(dt);
    ball.update(dt);
    dog.update(dt);
    ball.lateUpdate();
  } else {
    keepCameraOutOfObstacles();
  }
  if (debugLod && splatLod && ++debugLodFrames % 20 === 0) {
    const s = splatLod.state;
    setStatus(`lod ${s.lodSplatScale.toFixed(2)} · ${s.lodRenderScale.toFixed(1)}px · near ${s.proximity.toFixed(2)} · stress ${s.stress.toFixed(2)}`);
  }
  hud.update();
  if (!frameUpdate) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    frameUpdate = spark.update({ scene, camera }).then(() => {
      frameUpdate = undefined;
    }, (error) => {
      renderer.setAnimationLoop(null);
      console.error(error);
      setStatus(`Animation stopped: ${error.message}. Reload to continue.`);
    });
  }
  renderer.render(scene, camera);
});

main().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`);
});
