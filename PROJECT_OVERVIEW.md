# SnoopyGS: project overview and handoff

Snapshot as of **2026-10-04**. Sources: the code in this repo, git history, the saved plan for the upload feature, and the Claude Code sessions that built most of it. Treat anything about the working tree, quotas or branches as dated.

## What it is
SnoopyGS is a browser toy built for a hackathon. A Gaussian-splat 3D beagle ("Snoopy") stands inside a background scene. People interact with it through a physical Arduino controller (touch sensor, button, ultrasonic distance sensor, two joysticks) or with keyboard stand-ins. There are two other features:
- an "adoption profile" sidebar listing several dogs
- **Upload your dog**: turns a photo into a 3D splat dog using TRELLIS on a Hugging Face Space

There is **no backend**. Everything runs in the browser: Web Serial for the Arduino, `@gradio/client` for TRELLIS, and OAuth with PKCE for Hugging Face sign-in. The Vite dev server only serves files and resolves imports. `npm run build` produces a static `web/dist/` that any file server can host.

- **Repo:** `github.com/riic10/SnoopyGS`, default branch `main`.
- **People:** Eric Ko (`riic10`, owner), Amy (`amyli11229`, adoption sidebar, LOD and loading screen), Andrew (unmerged branch `origin/andrew/dog-attempt`).
- **Stack:** vanilla ES modules, Vite 8, three.js 0.186, `@sparkjsdev/spark` 2.3 (splat renderer), `@gradio/client` 2.7, `@huggingface/hub`. No framework, TypeScript, tests or linter.
- **Run:** `cd web && npm install && npm run dev`, then open `http://localhost:5173`. The `--host` flag also exposes the server on the LAN. Use Chrome or Edge, because Web Serial needs them and only works on `localhost` or https.
  - Run the dev server from your own terminal. Servers started by an agent as background jobs get killed after about 2 hours.

## Original intent and key decisions
- **The goal is an animated dog.** The plan was to animate it with a skeleton rig using Spark's `SplatMesh.skinning` / `SplatSkinning` (`setSplatBones`, `setRestMatrix`, `setBoneMatrix`, `updateBones`). This was the main reason for choosing **three.js + Spark** over PlayCanvas. PlayCanvas would only make sense for recorded per-frame 4D splat sequences. **The rig is not built.** It needs Blender work: rig a stand-in mesh with a four-legged skeleton, then copy its bone weights to the nearest splats. Until then the dog moves by sliding and hopping its whole body.
- **Desktop app rejected.** An Electron or Tauri wrapper would use the same WebGL and run no faster. A native engine such as Unity would mean a rewrite and lose `SplatSkinning`. The project stays in the browser. Electron is only worth it later for kiosk-style auto-connect.
- **Performance fix (measured headless on an M5 at 2560×1440, 2× density).** The woods went from 12 fps to 60 fps (display cap):
  - `antialias: false`. MSAA was the main cost.
  - Spark `lodSplatScale 0.35`, `lodRenderScale 2`, `maxStdDev 2`.
  - Woods pixel ratio capped at 1.5×.
  
  Amy's `lod.js` then varies these settings with camera distance.
- **Grass background abandoned.** `sample_grass_bg.glb` has no grass: it was generated in code and lost on export. Its two animations only move invisible helper nodes and use Blender axes. It's still in the repo but unused.
- **Arduino over Web Serial, not a server.** The cost is a one-time port-picker click; Chrome remembers the port after that. A Node `serialport` → WebSocket bridge is the fallback if that ever matters.
- **TRELLIS Space: `trellis-community/TRELLIS`.** Snoopy himself was generated with it, so its output format and axes match the placement code. `microsoft/TRELLIS` is in CONFIG_ERROR, and `microsoft/TRELLIS.2` only exports meshes.

## Repository layout
```
/                         large assets live at the root; web/public/ symlinks to them
  dog_model.ply / .spz    Snoopy: 357k splats, 24 MB ply -> 4.6 MB spz (the viewer loads the .spz)
  wooded_path_bg.spz      woods background, 4.84M splats, 76 MB; loads in ~7.5 s
  wooded_path_bg.ply      271 MB source scan: GITIGNORED (over GitHub's 100 MB limit), keep a copy somewhere shared
  wooded_path_bg.height.json  ground heightfield for ball physics and the dog's fetch run
  home_office_bg.glb      low-poly office: geometry only (no materials, normals, lights or cameras)
  sample_grass_bg.glb     unused (see above)
  Resource Links          one link: EasyEnv (github.com/TimChen1383/EasyEnv)
arduino/snoopy/snoopy.ino firmware: CSV over serial
web/
  index.html              all DOM: HUD, sidebar <aside>, upload <dialog>, loader; inline base CSS
  .env.example            VITE_HF_OAUTH_CLIENT_ID=
  src/main.js             entry: renderer, scene loading, dog swapping, animation loop
  src/dog.js              loadDog(): splat dog rig, model swap, pose, animation offsets
  src/dogs.js             DOGS roster (data only)
  src/sidebar.js/.css     adoption card UI
  src/hud.js              top-left overlay: connection, live readings, game state
  src/shadow.js           contact shadow (mesh texture or a single dark Gaussian)
  src/lod.js              distance- and frame-time-driven Spark LOD governor
  src/upload.js           Upload dialog UI
  src/trellis.js          Gradio calls to the TRELLIS Space, error classification
  src/hf-auth.js          Hugging Face OAuth (PKCE), session in localStorage
  src/input/arduino.js    Web Serial reader, CSV parser, keyboard stand-ins
  src/interactions/       ball.js (fetch game), pet.js, camera-stick.js, camera-distance.js
  src/scenes/             woods.js, office.js, heightfield.js
  tools/                  Node scripts: ply-to-spz, ground-height, heightfield, shared ply reader
```

## Runtime architecture (`web/src/main.js`)
1. **UI first.** Arduino input, the HUD, the sidebar and the upload dialog are created before WebGL starts, so they work while the scene loads.
2. **Scene selection.** `?scene=woods` (default) or `?scene=office` dynamically imports `scenes/<name>.js`. Its `load(scene)` returns the **scene setup contract**:
   - `dog: { ground, normal?, facing, height }`
   - `shadow: { kind: "mesh"|"splat", lift?, opacity? }`
   - `view: { radius, phi, theta }`: the starting orbit, also the camera-stick reset target
   - `camera: { near, far }`, `controls` (OrbitControls limits), `spark` (SparkRenderer settings)
   - `splatLod?: { nearDistance, farDistance }`, `maxPixelRatio?`
   - `obstacles`: `Box3[]` the camera may not enter
   - `ground.at(x, z)` → `{ y, normal, blocked }`, or `null` (treated as a wall)
   - `unitsPerMeter`, `ballRadius`

   **To add a scene:** implement this contract and register it in `SCENES`.
3. **Dog load.** The first roster entry with a model is loaded with `loadDog`. The OrbitControls target is the dog's centre, and panning is disabled.
4. **Frame order.** `controls.update` → `cameraStick` → `cameraDistance` → `keepCameraOutOfObstacles` → `splatLod` → `pet` → `ball.update` → `dog.update` → `ball.lateUpdate` → `hud` → render. `dt` is capped at 0.1 s.
5. **Dog swaps.** Swaps go through a serialized promise queue (`selectDog`). Only the latest pick loads, and a swap calls `ball.reset()`.
6. **Debug hooks.** `window.snoopy` exposes scene, camera, controls, dog, ball, setup, arduino, lod, dogs, upload and auth for console tweaking. `?debug` draws the ground grid (green free, red blocked) and shows LOD stats in the status bar.

### Coordinate and model conventions (important)
- **Y-down source files.** TRELLIS and 3DGS PLYs are Y-down, so both the dog and the woods are rotated π about X. File (x, y, z) → viewer (x, −y, −z).
- **Dog rig.** `root` (position, yaw) → `body` (animation offsets) → `splats` (flip, scale, centring).
  - Every model is scaled so its height equals `setup.dog.height`, with its paws at root's origin.
  - After the flip, models face **local −X**.
- **Facing.** An azimuth from +Z toward +X, the same convention as OrbitControls. `root.rotation.y = facing + π/2`.
- **Animation.** Modules write `dog.anim.{petHop, petRoll, petYaw, runHop}`, and `dog.update()` sums and applies them.
- **Units.**
  - Woods: 10 units per metre (the capture camera sits ~16 units above the path, roughly eye height). Dog height 4.
  - Office: 2 units per metre (desk top ≈ 1.46 units). Dog height 0.8.
  - Physics constants are in metres and multiplied by `unitsPerMeter`.

## Scenes
- **woods** (`web/src/scenes/woods.js`)
  - Splat `SplatMesh` with `lod: true`.
  - **Dog spot:** fixed at (−40, −22.248, 30), measured with `tools/ground-height.mjs`. The path really does slope about 10° there; the dog stays upright and the shadow follows the slope.
  - **Shadow:** a single dark Gaussian splat, because a mesh can't depth-sort against splats. It's lifted 0.3 so the gravel splats don't bury it.
  - **Camera limits:** `maxDistance` is 45, since further out the camera ends up inside trees or outside the scan. `maxPolarAngle` is 0.42π, which keeps the camera at least 2.4 units above the ground.
  - Lights exist only for meshes (the ball). Splats carry their own lighting.
- **office** (`web/src/scenes/office.js`)
  - The GLB has no materials, so colours are assigned by node name. GLTFLoader strips dots from names: `Plane.017` becomes `Plane017`.
  - Ground: an analytic flat floor plus the rug.
  - Floor furniture forms the camera obstacle boxes (0.15 margin) and the ball's blocked cells.
  - The room is an open corner (walls on −X and −Z, no ceiling), so the orbit is limited to the open side.

## Interactions
- **Pet** (`web/src/interactions/pet.js`)
  - Touch, a pet-stick click, or pushing the pet stick → hop and wiggle with an eased envelope.
  - Pushing the stick also leans the dog toward that side of the screen, whichever way the dog faces.
  - Vetoed unless the ball game is `idle` or `ready`.
- **Ball / fetch** (`web/src/interactions/ball.js`)
  - State machine: `idle → ready → flying → fetching → returning → idle`, advanced by button presses.
  - The throw solves for a launch speed that lands the ball near the dog.
  - Physics run at a fixed 120 Hz against `ground.at`: bounce, rolling resistance, walls at blocked cells.
  - The dog hop-glides to the ball, carries it at its mouth (computed from its current size, so it survives model swaps) and drops it at home.
  - Tuning is in `BALL`.
  - **Tested:** 26 throws in the woods and 10 in the office all completed in 3–7.5 s.
- **Camera stick** (`web/src/interactions/camera-stick.js`): orbit and tilt with smoothed velocity. A click eases back to `setup.view`. Tuning is in `CAMERA_STICK`.
- **Camera distance** (`web/src/interactions/camera-distance.js`): ultrasonic 10–80 cm → `minDistance`–`maxDistance`. After 1 s without a valid reading the mouse wheel takes over again.
- **LOD** (`web/src/lod.js`): interpolates the Spark knobs between the `far` and `close` presets by camera-to-dog distance. A frame-time governor lowers quality when frames run over 18–28 ms.

## Arduino / input
Files: `web/src/input/arduino.js`, `arduino/snoopy/snoopy.ino`.

- **Wire format:** 115200 baud at 50 Hz, CSV `touch,button,distance,camX,camY,camPress,petX,petY,petPress`.
  - 3-column lines are also accepted (old format). The sticks then stay centred.
  - **The baud rate changed from 9600 to 115200.** Firmware still at 9600 won't connect.
- **Pins:** camera stick VRx A2, VRy A3, SW D3. Pet stick VRx A0, VRy A1, SW D2. Switches use `INPUT_PULLUP` and read active LOW.
- **The firmware's `readTouch`, `readButton` and `readDistanceCm` are stubs that return 0.** The real sensor code still has to go in.
- **Parser** (config in `ARDUINO`):
  - Rejects malformed lines.
  - Sticks are normalized to −1..1, with a dead zone of 0.12 and per-axis `invert`.
  - The button is debounced at 150 ms.
  - Distances outside 2–400 cm are ignored.
  - Events: `touchstart`, `touchend`, `buttonpress`, `distance`, `camerapress`, `petpress`, `connection`.
  - Chrome remembers the port, so the page auto-reconnects through `getPorts()` and on hot-plug.
- **Keyboard stand-ins** (ignored while typing in an input):

  | Key | Does |
  | --- | --- |
  | T (hold) | Pet |
  | B | Button |
  | `[` / `]` | Simulated distance |
  | `0` | Stop simulated distance |
  | Arrow keys | Camera stick |
  | R | Reset the view |
  | I / J / K / L | Pet stick |

  A connected board that is streaming data overrides them. From the console: `snoopy.arduino.feedLine("1,0,42")`.
- **Status:** tested only with keyboard and simulated CSV input, **never with real hardware.**

## Sidebar / roster
Files: `web/src/dogs.js`, `web/src/sidebar.js`.
- **Roster:** `DOGS` has Snoopy (with a model), plus Woodie, Daisy and Pepper with `splat.url: null`. Those three show "3D model coming soon" and keep the current dog in the scene.
- **Unused fields:** `scene` and `animation` on each entry aren't read yet. They're placeholders for per-dog backgrounds and animations.
- **Uploaded dog:** id `"upload"`, at most one. `splat` is `{ fileBytes }`, held in memory only and lost on reload. It can be renamed with ✎.
- **Rule:** user-supplied text always goes into the DOM through `textContent`. Keep it that way.

## Upload your dog (TRELLIS)
- **Pipeline** (`web/src/trellis.js`):
  1. `Client.connect("trellis-community/TRELLIS")`
  2. `/start_session`
  3. `/preprocess_image` (background removal)
  4. `/generate_and_extract_glb`
  5. `/extract_gaussian`
  6. A streamed download of the `.ply`

  Notes:
  - All calls go through one Client, because the Space keeps state per session.
  - The client is created with `events: ["data", "status"]`. Without `status` you get no queue position and no error messages.
  - `checkApi()` checks the endpoint and parameter names against `view_api()`.
  - `classify()` maps errors to the kinds `quota | auth | unavailable | network | endpoint | generation`.
  - Settings are in `TRELLIS.settings`. `ss_sampling_steps` is 25 (default 12) to reduce extra-ear errors.
- **One real end-to-end run** (2026-10-04, `beagle puppy.jpg`): about 28 s to generate plus 10 s to download, producing an 18.6 MB `.ply` with 274k splats. The dog came out facing sideways, which is why **↻ turn** (`dog.turn(π/2)`) exists. The rest of the UI was tested by feeding that file back in, because of the quota.
- **Quota:** signed out, a network shares about one generation per day. That allowance was used on 2026-10-04 and resets about 24 hours later. Signed in, a free account gets 5 GPU minutes a day and PRO gets 40.
- **Auth** (`web/src/hf-auth.js`):
  - OAuth with PKCE, scopes `openid profile` only, because the token is sent to the Space.
  - The client ID comes from `VITE_HF_OAUTH_CLIENT_ID`. It's public, not a secret.
  - The sign-in round trip saves `{ upload, name, search }` in OAuth `state`, so `main.js` restores the query string and reopens the dialog. The photo has to be picked again.
  - The session is stored in localStorage under `snoopygs.hf-session`.
  - **Gotcha:** an expired or bad token isn't rejected. The call silently runs anonymously, and the quota error then says "Authenticate with a Hugging Face token". The app treats that as an `auth` error and signs the user out.
  - **Never** put a Hugging Face write or app token in the frontend.
- **Status:** sign-in has **never been tested with a real account**.
  - **Setup still needed:** create the OAuth app at huggingface.co/settings/applications/new with no secret, scopes `openid profile`, and redirect URI `http://localhost/` plus the deployed URL. Then put the client ID in `web/.env` and restart the dev server.
  - **Check once set up:** a signed-in user's quota error should *not* contain the "Authenticate…" sentence.

## Tooling
Run these from `web/`.
- `npm run build:spz`: converts `dog_model.ply` to `.spz` with Spark's encoder. For other files: `node tools/ply-to-spz.mjs in.ply out.spz`.
- `node tools/ground-height.mjs <ply> <x> <z> [r]`: fits a ground plane under a viewer-space point. This is how the dog's spot on a splat scene is chosen.
- `npm run build:heightfield`: rebuilds the woods heightfield (bounds −100..20 × −30..90, 1-unit cells). It **needs the gitignored 271 MB `wooded_path_bg.ply`** on disk.

## Current state (2026-10-04)
- **Git:**
  - On `main`, at Amy's `33ff3eb` (adoption sidebar, LOD, loading screen).
  - `ek/test_combine_dog_bg` is fully merged into `main` and has nothing new.
  - `origin/andrew/dog-attempt` ("checkpoint v3 dog petting and ball handling") is **unmerged** and may overlap with `pet.js` and `ball.js`.
  - Pull with `git checkout main && git pull`, then branch from it.
- **Large uncommitted working tree, written by two Claude sessions at the same time:**
  - **Session 1:** Upload / TRELLIS (`upload.js`, `trellis.js`, new npm dependencies), Hugging Face auth (`hf-auth.js`, `.env.example`), dog-model swapping (`dog.setModel`, `selectDog`, `ball.reset`), sidebar rename and upload, README sections.
  - **Session 2:** both joysticks (`camera-stick.js`, the `pet.js` lean, the 9-column parser, the HUD readout), `arduino/snoopy/snoopy.ino`, the 115200 baud change, keyboard keys ignored while typing.
  
  Create a feature branch before committing. Consider two commits along these lines.
- **Known gaps and TODOs:**
  - Skeleton rig and leg animation (the original goal).
  - The firmware's touch, button and distance readers are stubs.
  - Nothing has been tested on real Arduino hardware.
  - Hugging Face OAuth app not created, sign-in untested.
  - Woodie, Daisy and Pepper have no models.
  - Roster `scene` and `animation` fields are unused.
  - Uploaded dogs don't persist.
  - The dog glides straight through bushes, and through the chair in the office.
  - A few blurry lawn patches in the woods heightfield are wrongly marked as obstacles, so the ball can bounce off something invisible.
  - Phone performance hasn't been measured.
  - No automated tests.
  - The office has only placeholder colours; a textured source would allow real materials.
  - The `web/src/hf-auth.js` comment says `.env.local` but the README says `.env`. Vite reads both.
- **Code style to match:**
  - Small factory functions (`createX(...)` returning `{ update(dt), ... }`).
  - Tuning constants as exported UPPER_CASE objects at the top of each module.
  - Comments that explain *why* and record measured numbers.
  - No classes except `TrellisError`.
  - Frame-rate-independent smoothing: `1 - Math.exp(-dt / tau)`.
