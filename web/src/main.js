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
import { createDogCalibrationPanel } from "../../lib/dog-calibration-panel.ts";

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
let replaceSceneDog = null;
const sourceForEntry = entry => entry.splat.fileBytes
  ? { file: new File([entry.splat.fileBytes], `${entry.name}.ply`), sample: false }
  : { ...entry.splat, sample: entry.splat.url === "/dog_model.spz" || entry.splat.url === "/dog_model.ply" };
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
      await replaceSceneDog(sourceForEntry(entry));
      shownModel = entry.splat;
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
  onTurn: () => {
    if (!sceneDog) return;
    sceneDog.home.facing += Math.PI / 2;
    sceneDog.setPose(sceneDog.root.position, sceneDog.facing + Math.PI / 2);
  },
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
let swapping = false, inspecting = false, loadingDog = false;
const dogOptions = document.getElementById("dog-options");
const dogModel = document.getElementById("dog-model");
const dogUpload = document.getElementById("dog-upload");
const dogPoseButton = document.getElementById("dog-pose");
const dogError = document.getElementById("dog-error");
document.getElementById("dog-panel").addEventListener("toggle", event => {
  if (!event.target.open) {
    const fitPanel = document.querySelector("#dog-calibration details");
    if (fitPanel) fitPanel.open = false;
  }
});
const dogSources = {
  sample: { url: "/dog_model.spz", sample: true },
  standing: { url: "/standing_dog.ply", sample: false },
};

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

  const target = setup.dog.ground.clone().add(new THREE.Vector3(0, setup.dog.height * 0.5, 0));
  controls.target.copy(target);
  const { radius, phi, theta } = setup.view;
  camera.position.setFromSphericalCoords(radius, phi, theta).add(target);
  controls.update();

  const first = wantedEntry ?? sidebar.dogs.find(hasModel);
  let currentSource = dogSources[params.get("dog")] ?? (first ? sourceForEntry(first) : dogSources.sample);
  const cameraStick = createCameraStick(input, camera, controls, setup.view);
  if (setup.splatLod) {
    splatLod = createSplatLod({ spark, camera, target: controls.target, ...setup.splatLod });
    splatLod.update(0);
  }
  dogModel.value = currentSource === dogSources.standing ? "standing" : "sample";
  let calibrationPanel, inspectionReturnPose = 0;
  const setInspection = (visible, landmark) => {
    const dog = interactions.dog;
    if (visible && !inspecting) {
      inspectionReturnPose = dog.motion.target;
      dog.motion.stand = dog.motion.target = Number(dog.profile.startsStanding);
      dog.anim.pet = 0;
      dog.lookAt(null);
      dog.joints.feet.forEach(foot => { foot.initialized = false; });
    } else if (!visible && inspecting) dog.motion.target = inspectionReturnPose;
    inspecting = visible;
    dog.inspect(visible, landmark);
  };
  async function replaceDog(source, calibration = {}, keepPosition = false) {
    if (loadingDog) throw new Error("Wait for the dog to finish loading.");
    loadingDog = true;
    dogOptions.disabled = true;
    dogError.textContent = "";
    setStatus("Loading dog…");
    try {
      const old = interactions;
      const dog = await loadDog(scene, {
        ...setup.dog,
        ...(keepPosition && old ? { ground: old.dog.root.position.clone(), facing: old.dog.facing, normal: old.dog.groundNormal.clone() } : {}),
        unitsPerMeter: setup.unitsPerMeter, groundHeight: point => setup.ground.at(point.x, point.z)?.y,
      }, setup.shadow, source, calibration);
      swapping = true;
      if (frameUpdate) await frameUpdate;
      if (!keepPosition) {
        calibrationPanel?.dispose();
        calibrationPanel = undefined;
        inspecting = false;
      }
      old?.ball.dispose();
      old?.dog.dispose();
      const world = { ...setup, ballRadius: Math.min(setup.ballRadius, dog.maxBallRadius) };
      const gameInput = { on: (type, callback) => input.on(type, value => { if (!inspecting && !dogOptions.disabled) callback(value); }) };
      const ball = createBall({ scene, camera, dog, input: gameInput, world, onState: hud.setGame });
      dog.update(0);
      hud.setGame(ball.state);
      interactions = { dog, ball, pet: createPet(dog, input, ball.dogAtHome, camera.position),
        cameraStick, cameraDistance: createCameraDistance(input, camera, controls) };
      sceneDog = dog;
      shownModel = null;
      currentSource = source;
      dogModel.querySelector('option[value="upload"]')?.remove();
      if (source.file) {
        dogModel.add(new Option(source.file.name, "upload"));
        dogModel.value = "upload";
      } else dogModel.value = source.sample ? "sample" : "standing";
      window.snoopy = { scene, camera, controls, dog, ball, setup: world, arduino: input, lod: splatLod, dogs: sidebar, upload: uploadDialog, auth };
      if (!keepPosition) {
        if (!source.sample) calibrationPanel = createDogCalibrationPanel(document.getElementById("dog-calibration"), {
          profile: dog.profile, onApply: next => replaceDog(currentSource, next, true), onPreview: setInspection,
          onFocus: () => {
            const dog = interactions.dog;
            const direction = camera.position.clone().sub(controls.target).normalize();
            controls.target.copy(dog.root.position).y += dog.height * 0.5;
            camera.position.copy(controls.target).addScaledVector(direction, Math.max(controls.minDistance, dog.height * 2.4));
            controls.update();
          },
        });
      }
      setStatus(`${name} · dog ${dog.splats.numSplats.toLocaleString()} splats`);
      return dog.profile;
    } catch (error) {
      dogError.textContent = error.message;
      setStatus(interactions ? `${name} · current dog kept` : "Choose another dog to continue.");
      throw error;
    } finally { swapping = false; loadingDog = false; dogOptions.disabled = false; hideLoader(); }
  }
  dogModel.onchange = () => { void replaceDog(dogSources[dogModel.value] ?? currentSource).catch(() => {
    dogModel.value = currentSource.file ? "upload" : currentSource.sample ? "sample" : "standing";
  }); };
  dogUpload.onchange = async () => {
    const file = dogUpload.files[0];
    if (!file) return;
    if (!/\.ply$/i.test(file.name) || !file.size || file.size > 128 * 1024 * 1024) {
      dogError.textContent = "Choose a Gaussian PLY file smaller than 128 MB.";
      dogUpload.value = "";
      return;
    }
    try {
      await replaceDog({ file, sample: false });
    } catch { /* The loader leaves the current dog available and displays the error. */ }
    dogUpload.value = "";
  };
  dogPoseButton.onclick = () => {
    if (interactions && !inspecting) interactions.dog.motion.target = 1 - interactions.dog.motion.target;
  };
  replaceSceneDog = replaceDog;
  await replaceDog(currentSource).then(() => {
    if (!params.has("dog")) shownModel = first?.splat;
  }).catch(() => {});
  if (wantedEntry && wantedEntry !== first) selectDog(wantedEntry);
  if (params.has("debug")) drawGroundDebug(setup.ground, setup.dog.ground, 4 * setup.unitsPerMeter); // ±4 m
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
    dogOptions.disabled = loadingDog || !ball.dogAtHome();
    dogPoseButton.disabled = inspecting;
    dogPoseButton.textContent = dog.motion.target ? "Sit down" : "Stand up";
    if (!inspecting) dog.prepareFrame(dt);
    if (!inspecting) cameraStick.update(dt);
    if (!inspecting) cameraDistance.update(dt);
    keepCameraOutOfObstacles();
    if (splatLod) splatLod.update(dt);
    if (!inspecting) {
      pet.update(dt);
      ball.update(dt);
    }
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
  if (!frameUpdate && !swapping) {
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
