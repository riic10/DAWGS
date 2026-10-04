import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Low-poly home office (mesh). Scene units: the desk top is ~1.46 above the
// floor, so 1 unit ≈ 0.5 m.
const UNITS_PER_METER = 2;

// The GLB ships geometry only (no materials, normals or textures), so each
// object gets a flat colour by name. Plane.NNN ranges were identified from
// their bounds in the file. GLTFLoader strips "." from node names, so
// "Plane.017" arrives as "Plane017".
const COLORS = {
  wall: 0xe9e4da,
  floor: 0xb98a5e,
  rug: 0x5b7c99,
  furniture: 0xd8c3a5, // desk, shelving
  chair: 0x2f3b4c,
  keys: 0xf0f0f0,
  keyboard: 0x4a4d55,
  screen: 0x22252b,
  speaker: 0x3a3d44,
  mouse: 0xd9d9d9,
  leaf: 0x4f8a4b,
  stem: 0x3d5c2e,
  pot: 0xb5653f,
  picture: 0x6d9dc5,
  lamp: 0xf2d27a,
  trashcan: 0x7a8a99,
  decor: 0xc9a96e,
};
const BOOK_COLORS = [0xb04a3c, 0x3f6e8c, 0xd1a23b, 0x5c8a4f, 0x7b5a8f, 0xe0dccf];

// Floor-standing objects the camera must not enter. Each group becomes one
// box, so the camera can't slip between a plant's leaves.
// seq("Plane", 41, 45) -> ["Plane041", …, "Plane045"]
const seq = (prefix, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => prefix + String(from + i).padStart(3, "0"));
const OBSTACLES = [
  ["Plane039", "Plane040"], // chair
  ["Base002", "Hoja", ...seq("Hoja", 1, 10)], // plant, -Z corner
  ["Base003", "Plane037", "Plane038", ...seq("Plane", 41, 45)], // plant, +Z corner
  ["Trashcan"],
  ["Plane017", ...seq("Plane", 28, 36)], // desk and shelving
];

function colorFor(name) {
  const fixed = {
    Room: "wall", Floor: "floor", Rug: "rug", Screen: "screen", SpeakerA: "speaker",
    Mouse: "mouse", Picture: "picture", Lamp: "lamp", Trashcan: "trashcan",
    Base: "keyboard", Base001: "pot", Base002: "pot", Base003: "pot",
    Base004: "pot", Cylinder001: "stem", Cylinder002: "stem",
  }[name];
  if (fixed) return COLORS[fixed];
  if (name.startsWith("Hoja")) return COLORS.leaf;
  let m = name.match(/^Cube(\d+)$/);
  if (m) return BOOK_COLORS[Number(m[1]) % BOOK_COLORS.length];
  m = name.match(/^Plane(\d*)$/);
  if (m) {
    const n = Number(m[1] || 0);
    if (n <= 16) return COLORS.keys;
    if (n === 17 || (n >= 28 && n <= 36)) return COLORS.furniture;
    if (n === 39 || n === 40) return COLORS.chair;
    if (n === 56) return COLORS.decor;
    return COLORS.leaf; // 18–27 and 46–55 desk plants, 37–38 and 41–45 floor plant
  }
  return null;
}

export async function load(scene) {
  scene.background = new THREE.Color(0xdcd6cc);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9a58c, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1e0, 1.6);
  sun.position.set(6, 9, 5); // light comes in through the open side
  scene.add(sun);

  const gltf = await new GLTFLoader().loadAsync("/home_office_bg.glb");
  const unknown = [];
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const color = colorFor(obj.name);
    if (color === null) unknown.push(obj.name);
    // No normal attribute in the file: flat shading derives normals per
    // face. DoubleSide because leaves, rug, screen etc. are single planes.
    obj.material = new THREE.MeshStandardMaterial({
      color: color ?? 0x999999,
      roughness: 0.85,
      flatShading: true,
      side: THREE.DoubleSide,
    });
  });
  if (unknown.length) console.warn("No colour assigned for:", unknown);
  scene.add(gltf.scene);

  const rug = new THREE.Box3().setFromObject(gltf.scene.getObjectByName("Rug"));
  const floor = new THREE.Box3().setFromObject(gltf.scene.getObjectByName("Floor"));
  const furniture = OBSTACLES.map((names) => {
    const box = new THREE.Box3();
    for (const name of names) {
      const obj = gltf.scene.getObjectByName(name);
      if (!obj) throw new Error(`Obstacle mesh "${name}" not found in GLB`);
      box.expandByObject(obj);
    }
    return box;
  });
  // The camera keeps a 0.15 margin from furniture.
  const obstacles = furniture.map((box) => box.clone().expandByScalar(0.15));

  // Flat floor; the rug sits 0.0035 higher. Off the floor's edge counts as a
  // wall (the walls on -X/-Z, an invisible one on the open sides), and the
  // floor-standing furniture blocks the ball like a solid column.
  const UP = new THREE.Vector3(0, 1, 0);
  const ground = {
    at(x, z) {
      if (x < floor.min.x || x > floor.max.x || z < floor.min.z || z > floor.max.z) return null;
      const onRug = x >= rug.min.x && x <= rug.max.x && z >= rug.min.z && z <= rug.max.z;
      const blocked = furniture.some((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z);
      return { y: onRug ? rug.max.y : floor.max.y, normal: UP, blocked };
    },
  };

  return {
    // On the rug, clear of the chair, facing the room's open (+X, +Z) corner.
    dog: {
      ground: new THREE.Vector3(0.5, rug.max.y, -0.3),
      facing: Math.PI / 4,
      height: 0.8, // ≈ 0.4 m, a sitting beagle puppy
    },
    shadow: { kind: "mesh" },
    // Start high in the open corner, looking over the plant at the dog and desk.
    view: { radius: 6, phi: 0.95, theta: 0.75 },
    camera: { near: 0.05, far: 100 },
    // The room is a diorama corner: floor plus walls on -X and -Z, open on
    // +X and +Z, no ceiling. Keep the camera on the open side.
    controls: {
      minAzimuthAngle: -0.35,
      maxAzimuthAngle: Math.PI / 2 + 0.35,
      minPolarAngle: 0.15,
      maxPolarAngle: Math.PI * 0.47,
      minDistance: 1,
      maxDistance: 7,
    },
    obstacles,
    ground,
    unitsPerMeter: UNITS_PER_METER,
    ballRadius: 0.0335 * UNITS_PER_METER, // tennis ball
  };
}
