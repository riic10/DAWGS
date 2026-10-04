# SnoopyGS

This repository contains two apps: the scene and Arduino viewer in `web/`, and the Next.js image-to-3D app at the repository root. Each has its own setup and controls, described below.

## Scene and Arduino viewer (`web/`)

Gaussian-splat beagle composited into a background scene, rendered with three.js + [Spark](https://sparkjs.dev).

## Run the viewer

```sh
cd web
npm install
npm run dev        # http://localhost:5173 (also exposed on the LAN for phone testing)
```

Pick the background with `?scene=`:

| Scene | URL | Background |
| --- | --- | --- |
| `woods` (default) | `/` | `wooded_path_bg.ply`, 4.8M Gaussian splats, rendered with level of detail |
| `office` | `/?scene=office` | `home_office_bg.glb`, low-poly mesh with placeholder colours |

Each scene lives in `web/src/scenes/` and says where the dog stands, how the camera may move and how the shadow is drawn.

## Dog animation

The environment keeps the original ball-driven movement. Press **B** once to hold the ball and again to throw it, or use the Arduino button. After the ball lands, a sitting dog finishes standing before it runs to fetch. Its legs animate while running and turning, and it returns to its original pose after bringing the ball home.

The sample dog uses joint chains with fixed bone lengths and bend limits. It accelerates from a four-beat walk into a diagonal trot, then slows as it approaches the ball. Shoulder blades, pelvis, wrists, and hocks participate in each stride while paw contacts stay planted between steps. The neck and head turn separately to track the ball. Standing shifts its weight forward before raising its hips.

At pickup, the dog plants its feet, lowers its head, and reaches the ball with its neck and mouth. The ball stays grounded until contact, then follows a grip fitted to the lip line and ball radius. A small lower-jaw hinge opens for pickup and release. At home, the dog lowers and releases the ball into gravity before returning to its original pose. A ball too close to the chest prompts a backward approach to make room.

Petting turns the head toward the viewer, lifts the chin, and leans the neck into the scratch. Holding touch keeps a slow neck response and tail wag active, with the hips steady and paws planted. It settles gradually when touch ends, and fetching takes priority. The source scan has a closed mouth, so jaw movement stays restrained.

The procedural gait timing and joint movement are informed by [Catavitello et al. (2015)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4517757/) and [Fischer's canine locomotion research](https://www.vdh.de/fileadmin/media/dog-health/abstracts/Dogs_in_motion_-_Interdependencies_of_skeleton_muscles_and_locomotion.pdf). The curves are hand tuned to this scan, not imported motion capture.

The sample rig is shared with the studio viewer. Uploaded dogs still use the automatic rig. The woods, office, ball physics, petting, and Arduino camera controls come from the original environment viewer.

From the repository root, `npm run dev:world` also starts this viewer after installing its dependencies in `web/`. Build it with `npm run build:world`.

The environment regression checks run from the repository root:

```sh
npm install
npm test
npm run build:world
npx playwright install chromium
npm run test:world
```

These checks cover joint lengths and bend limits, planted paw contacts, standing before fetch movement, head tracking and pickup, returning to the original pose, rendered animation in both scenes, and simulated Arduino petting and camera distance. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome instead of Playwright's Chromium.

## Arduino

The page reads the Arduino directly over USB with the Web Serial API, so it needs **Chrome or Edge** (on `localhost` or https). There's no server code.

1. Plug in the board and click **Connect Arduino** (top left), then pick its port. Chrome remembers it, so later loads and re-plugs reconnect without asking.
2. Flash `arduino/snoopy/snoopy.ino`. It prints one CSV line per sample at **9600 baud**: `touch,button,distance,camX,camY,camPress,petX,petY,petPress`, e.g. `1,0,42,512,509,0,530,500,0`. Touch, button and the stick presses are 1 while active; distance is in cm (0 or over 400 means no echo); stick axes are raw `analogRead` values. Leave the sticks alone for the first half second after connecting: the page measures where each one rests then (press **C** to measure again), so 3.3V sticks and 12-bit boards work without changes. Lines with just the first three columns still work. Change the column order, baud rate, valid range, stick dead zone or axis directions in `ARDUINO` in `web/src/input/arduino.js`. The sketch's touch, button and distance readers are stubs that return 0; drop your sensor code into them.

| Joystick | VRx | VRy | SW |
| --- | --- | --- | --- |
| 1: camera | A2 | A3 | D3 |
| 2: petting | A0 | A1 | D2 |

| Sensor | Action |
| --- | --- |
| Touch | The dog leans into petting, tilts its head, and gently wags its tail |
| Button | 1st press: ball in hand. 2nd press: throw it; the dog fetches it and drops it back at its spot |
| Distance | The closer you are, the closer the camera gets to the dog (10–80 cm maps to the scene's zoom range); after 1 s without readings the mouse wheel takes over |
| Camera stick | Left/right orbits around the dog, up/down tilts the camera; speed follows how far you push. Click: ease back to the starting view |
| Pet stick | Pushing it pets the dog (harder the further you push) and the dog leans towards that side of the screen. Click: full pet, like touch |

Without the board, use the keyboard: hold **T** to pet, **B** for the button, **[** / **]** for a simulated distance, **0** to stop it, **arrow keys** for the camera stick (**R** to reset the view) and **I/J/K/L** for the pet stick. The HUD shows each stick's raw values in brackets. In the console, `snoopy.arduino.feedLine("1,0,42")` runs a line through the same parser.

Tuning lives next to the code: `BALL` in `web/src/interactions/ball.js` (throw, bounce, fetch speed) and `CAMERA_DISTANCE` in `web/src/interactions/camera-distance.js`, `CAMERA_STICK` in `web/src/interactions/camera-stick.js` (orbit/tilt speed) and `LEAN` in `web/src/interactions/pet.js`. `?debug` draws the ground the ball and dog use (green free, red blocked).

## Upload your dog

**＋ Upload your dog** in the sidebar turns a photo into a 3D dog with [TRELLIS](https://github.com/microsoft/trellis). Pick a photo, give the dog a name and press **Generate**. Progress shows while it runs (about 30 s plus a ~19 MB download). The new dog replaces the one in the scene and appears in the roster as the last card, where **✎** renames it. From the dialog you can download the `.ply` (it opens in SuperSplat) or turn the dog a quarter turn if it faces the wrong way.

- It calls the public Hugging Face Space [`trellis-community/TRELLIS`](https://huggingface.co/spaces/trellis-community/TRELLIS) straight from the browser with `@gradio/client`. There's no backend and no app token; never add an HF token to the frontend, since every visitor could read it.
- Signed-out calls share a small ZeroGPU quota: **about one generation per day per network**. After that the dialog says when to try again.
- **Sign in with Hugging Face** (top of the dialog) makes generations use the user's own daily GPU allowance instead: 5 minutes on a free account, 40 on PRO (2 signed out). The sign-in token only has the `openid profile` scopes, because it's sent to the Space with each call. If Hugging Face doesn't accept it (expired or revoked), the dialog asks the user to sign in again.

### Setting up sign-in (once)

1. Create an OAuth app at [huggingface.co/settings/applications/new](https://huggingface.co/settings/applications/new): **no client secret**, scopes `openid profile`, redirect URIs `http://localhost/` (covers every dev port) plus the deployed site's URL.
2. Copy `web/.env.example` to `web/.env` and set `VITE_HF_OAUTH_CLIENT_ID` to the app's client ID. It's public, not a secret, so it can be committed.
3. Restart `npm run dev`. Without a client ID the dialog says sign-in isn't set up and uses the shared quota.
- The Space ID, endpoint names and generation settings (seed, stage-1 steps, guidance) are in `TRELLIS` at the top of `web/src/trellis.js`, with the real endpoint list in a comment. If the Space changes its API, the dialog says so instead of failing silently.
- Only one uploaded dog is kept, and it's gone after a reload. Dogs in the roster without a 3D model yet keep the current dog in the scene.

## Assets

`web/public/` symlinks the assets at the repo root. The viewer loads compressed `.spz` copies of the splat files; regenerate them after changing a `.ply`:

```sh
npm run build:spz                                                   # dog_model.ply -> dog_model.spz
node tools/ply-to-spz.mjs ../wooded_path_bg.ply ../wooded_path_bg.spz
```

To place the dog on a splat scene, measure the ground under a point (viewer coordinates, file assumed Y-down):

```sh
node tools/ground-height.mjs ../wooded_path_bg.ply -40 30
```

The ball and the dog's fetch run use a ground heightfield of the woods (`wooded_path_bg.height.json`, kept in the repo). Rebuild it after changing the scene:

```sh
npm run build:heightfield
```

## Next.js image-to-3D app (repository root)

An image-to-3D hackathon demo. Upload a PNG or JPEG, generate a Gaussian splat through TRELLIS on Hugging Face, animate a dog in the browser, and download the `.ply`.

Next.js + TypeScript, Three.js + Spark, and the Gradio client. No Supabase, database, or paid inference fallback.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. The bundled dog model works without credentials.

## Dog movement

Press **C** to stand or sit, then use **W** to walk forward, **S** to back up, **A** to turn left, and **D** to turn right relative to the dog. Keyboard controls work without clicking the canvas first and ignore typing in form fields. Hold **W+A** or **W+D** to walk in an arc. A/D alone turn in place, and holding both cancels the turn. Brief keyboard taps produce a short step or turn. Orbiting the camera does not change the controls. You can also click the on-screen W/A/S/D buttons for a short step or turn, or hold them for continuous movement. The C and sit/stand buttons toggle the pose. Movement is blocked while sitting and throughout either pose transition. Changing focus or switching tabs releases held keys.

Uploaded dogs are fitted automatically after generation. The browser estimates facing direction, body proportions, head, feet, and sitting or standing pose from the splat geometry, then attaches a procedural skeleton. A standing dog starts standing. Spark deforms the original splats on the GPU, with a walk cycle and camera follow. The bundled sample retains its hand-fitted rig.

Use a clear full-body photo of one dog, standing or sitting, from the side or a three-quarter angle. This is a geometry-based hackathon prototype, not a learned animal rig or a 4D reconstruction. Missing or folded rear-leg geometry can stretch or distort during pose changes. Cropped dogs, lying poses, heavy occlusion, and non-dog subjects are outside the supported input assumptions. If fitting fails, the viewer explains why and keeps orbiting and downloading available.

Download saves the original static PLY, without the runtime rig or animation. Automatic fitting runs locally in the browser and uses no additional cloud GPU or inference service. `standing_dog.ply` and `dog_model.ply` are exercised through the generated-result path in browser tests.

To enable generation, create a **Read** access token at https://huggingface.co/settings/tokens and put it in an untracked `.env.local` file:

```text
HF_TOKEN=hf_your_token
GENERATIONS_PER_HOUR=20
```

Restart the server after adding the token. Never prefix it with `NEXT_PUBLIC_` or paste it into the browser. All generation uses this account's shared ZeroGPU quota. Free accounts have limited GPU time and queue priority. Quota exhaustion stops generation; there is no Replicate fallback or automatic retry.

The default local limit is 20 submission attempts per hour per process; use `0` to disable generation. Only one job can run at a time to avoid exhausting the account's quota through concurrent submissions.

If the development server hits a filesystem watcher limit, use:

```sh
npm run build
npm run start
```

## How it works

- The browser accepts one PNG/JPEG up to 3 MB.
- The backend checks the file, strips metadata, preserves transparency, and resizes it to fit within 1024 pixels. Decoded images are limited to 16 megapixels.
- The server connects to `trellis-community/TRELLIS` with `HF_TOKEN` and creates a separate Gradio session per job.
- In that same session, it calls `start_session`, `preprocess_image`, `generate_and_extract_glb`, then `extract_gaussian`. The current Space generates a mesh/video along the way even though this app only downloads the Gaussian file.
- The server streams the Gaussian to a temporary disk file from the exact Space's file endpoint before closing the session. It rejects redirects, other hosts, non-Gaussian PLY headers, and files over 512 MB.
- A signed, expiring job link is saved in browser storage. Refreshing resumes status polling without starting another generation.
- Spark renders the downloaded splats and reuses those bytes for the download button.
- The existing `dog_model.ply` remains an explicitly labeled sample. It never substitutes for a failed generation.

## Runtime and temporary results

Run this version in **one persistent Node process**, locally or on a Node server. Jobs, Gradio sessions, deduplication, and limits live in process memory; generated files use the OS temporary directory. This implementation is not suitable for Vercel/serverless or multiple server replicas. Those need a durable job store and worker.

A job times out after 10 minutes including queue time. Cancellation is best effort, so a timed-out remote job may still consume quota. The app never automatically resubmits it.

Up to three recent jobs are retained for at most one hour. Starting additional jobs evicts the oldest retained result. Restarting the server loses access to all jobs and results. Normal eviction removes temporary files; after an abrupt shutdown, leftover `snoopygs-*.ply` files may need manual cleanup from the OS temporary directory. Once a model has loaded into the browser, the current tab can still download it until closed or replaced. Download anything you want to keep.

The original upload is not persisted across refreshes. The Hugging Face Space handles uploaded images and may have its own cache retention. Keep this shared-account hackathon demo restricted to your team; everyone using it consumes the same free quota.

## Verify

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npx playwright test
```

Unit tests cover generation, job access, automatic fitting across export scales and headings, preservation of the native geometry, normalized skin weights, foot contact, pose transitions, and opposite A/D turns and cancellation. Browser tests render both real dog files with mocked job responses and check movement, pose controls, model switching, and refresh recovery. A real generation requires `HF_TOKEN` and available free GPU quota.

Sources: [TRELLIS Space](https://huggingface.co/spaces/trellis-community/TRELLIS), [ZeroGPU quotas](https://huggingface.co/docs/hub/spaces-zerogpu), [Gradio JavaScript client](https://github.com/gradio-app/gradio/tree/main/client/js), [Spark](https://sparkjs.dev/docs/).
