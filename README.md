# SnoopyGS
Gaussian-splat beagle in the woods or office, with animated fetching, ball physics, and Arduino input. Rendered with three.js + [Spark](https://sparkjs.dev). The Dog panel can turn a photo into a new dog with TRELLIS on Hugging Face.

## Run the viewer

From the repository root:

```sh
npm install
npm --prefix web install
npm run dev        # opens http://localhost:5173 (also exposed on the LAN for phone testing)
```

Set `BROWSER=none` to skip opening a tab. Making dogs from photos also needs a Hugging Face token; see [Make a dog from a photo](#make-a-dog-from-a-photo).

Pick the background with `?scene=`:

| Scene | URL | Background |
| --- | --- | --- |
| `woods` (default) | `/` | `wooded_path_bg.spz`, 4.8M Gaussian splats, rendered with level of detail |
| `office` | `/?scene=office` | `home_office_bg.glb`, low-poly mesh with placeholder colours |

Each scene lives in `web/src/scenes/` and says where the dog stands, how the camera may move and how the shadow is drawn.

## Dog animation

The environment keeps the original ball-driven movement. Press **B** once to hold the ball and again to throw it, or use the Arduino button. After the ball lands, a sitting dog finishes standing before it runs to fetch. It brings the ball toward your current camera position, faces you, and returns to its previous sitting or standing pose after delivery.

The sample dog uses joint chains with fixed bone lengths and bend limits. It accelerates from a four-beat walk into a diagonal trot, then slows as it approaches the ball. Shoulder blades, pelvis, wrists, and hocks participate in each stride while paw contacts stay planted between steps. The neck and head turn separately to track the ball. Standing shifts its weight forward before raising its hips.

At pickup, the dog plants its feet, opens its jaw, and reaches the ball with its neck and mouth. The ball stays grounded until the upper and lower lips close around it, with the jaw angle fitted to the ball radius. It lifts and carries the ball at that grip, then lowers it and opens its jaw before releasing it into gravity. A ball too close to the chest prompts a backward approach to make room. Small inner mouth surfaces fill the opening that the original closed-mouth scan does not contain.

The return route follows camera movement until the dog starts putting the ball down. It chooses connected, unblocked ground where the dog and delivered ball remain visible, including when the camera is outside the floor. The dog stays at the delivery point, and the next throw aims around its new position. If no visible delivery spot is reachable, it holds the ball and waits for the camera to move to a clearer view.

Petting turns the head toward the viewer, lifts the chin, and leans the neck into the scratch. Holding touch keeps a slow neck response and tail wag active, with the hips steady and paws planted. It settles gradually when touch ends, and fetching takes priority.

The procedural gait timing and joint movement are informed by [Catavitello et al. (2015)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4517757/) and [Fischer's canine locomotion research](https://www.vdh.de/fileadmin/media/dog-health/abstracts/Dogs_in_motion_-_Interdependencies_of_skeleton_muscles_and_locomotion.pdf). The curves are hand tuned to this scan, not imported motion capture.

The sample and uploaded dogs share the same 20-joint animator. The sample keeps its calibrated skeleton and skin weights. Uploads get their own fitted proportions, joints, stride length, mouth size, and resting jaw opening. The woods, office, ball physics, petting, and Arduino camera controls come from the original environment viewer.

### Use another dog

Open **Dog** at the top right of either environment. Choose **Standing dog** to try `standing_dog.ply`, or choose a local Gaussian `.ply` file up to 128 MB. The upload stays in the browser tab. A standing scan starts standing; a seated scan stands before fetching. The sit/stand button changes the pose between fetches. Both use the same petting, jaw pickup, and camera-directed ball delivery. The ball gets smaller when needed to fit the dog's muzzle.

Direct links: `/?dog=standing` for the woods and `/?scene=office&dog=standing` for the office.

**Adjust dog fit** pauses the interaction and shows the skeleton over the native pose. Use **Zoom to dog**, select a joint, and adjust its forward, height, or side position as a percentage of dog height. The selected joint is yellow. Facing and original-pose corrections trigger a fresh fit; **Reset automatic fit** removes manual corrections. The upper lip, lower lip, jaw hinge, and mouth width can be adjusted separately. Closing the panel resumes the interaction. Corrections last until the model is replaced or the page reloads.

Use an isolated, full-body dog with recognizable paws and muzzle, in an upright Y-down Gaussian PLY such as a TRELLIS export. Facing, translation, and uniform export scale are fitted automatically. Cropped dogs, lying poses, heavy occlusion, arbitrary export axes, and non-dog subjects are outside the supported assumptions. Fitting is geometric, not learned anatomy recognition. Other breeds can need joint and mouth corrections; missing fur, mouth surfaces, or hidden limbs cannot be recovered from the rig alone. A failed world upload reports the problem and keeps the current dog available.

### Make a dog from a photo

In **Dog**, pick a PNG or JPEG of one whole dog (up to 3 MB) under **Dog photo**, then press **Create dog from photo**. TRELLIS on Hugging Face turns it into a Gaussian splat in a few minutes. The new dog joins the **Model** list as **Your dog 1** and gets the same automatic fit, **Adjust dog fit**, petting, and fetch as an uploaded PLY. A dog that finishes mid-fetch or while the fit panel is open waits until the ball is back and the panel is closed. The download link saves the generated PLY. Refreshing the page picks a running generation back up instead of starting another.

Generation runs on the viewer's own server (`lib/api.ts`, served at `/api` by `web/vite.config.js`), so the token never reaches the browser. Create a **Read** access token at https://huggingface.co/settings/tokens and put it in an untracked `.env.local` file at the repository root:

```text
HF_TOKEN=hf_your_token
GENERATIONS_PER_HOUR=20
```

Restart `npm run dev` after adding the token, and don't give it a `VITE_` prefix. Token, quota, and rate-limit problems show up in the panel.

All generation uses this account's shared ZeroGPU quota. Free accounts have limited GPU time and queue priority. Quota exhaustion stops generation; there is no paid fallback or automatic retry. The default limit is 20 submission attempts per hour per server process; use `0` to turn generation off. Only one job runs at a time, so concurrent submissions can't exhaust the quota.

How it works:

- The server checks the photo, strips metadata, preserves transparency, and resizes it to fit within 1024 pixels. Decoded images are limited to 16 megapixels.
- It connects to `trellis-community/TRELLIS` with `HF_TOKEN`, creates a separate Gradio session per job, and calls `start_session`, `preprocess_image`, `generate_and_extract_glb`, then `extract_gaussian`. The Space also generates a mesh and video along the way; only the Gaussian file is downloaded.
- It streams the Gaussian to a temporary file from the exact Space's file endpoint before closing the session. It rejects redirects, other hosts, non-Gaussian PLY headers, and files over 512 MB.
- A signed, expiring job link is saved in browser storage, so a refresh resumes polling. The page calls `/api` on its own server, so requests are same-origin and pass the upload origin check. `GET /api/status` reports a missing token before anything is uploaded.

Generation runs inside the `npm run dev` (or `npm run preview`) process. Jobs, Gradio sessions, deduplication, and limits live in its memory, and generated files go to the OS temporary directory, so a static host or serverless platform can't run it. A job times out after 10 minutes including queue time; cancellation is best effort, so a timed-out remote job may still use quota. Up to three recent jobs are kept for at most an hour, and restarting the server loses them. After an abrupt shutdown, leftover `snoopygs-*.ply` files may need manual cleanup from the OS temporary directory. The Hugging Face Space handles uploaded images and may keep its own cache. Keep this shared-account demo to your team; everyone using it spends the same free quota. If the dev server hits a filesystem watcher limit, run `npm run build`, then `npm run preview` (http://localhost:4173), which serves the photo API too.

Sources: [TRELLIS Space](https://huggingface.co/spaces/trellis-community/TRELLIS), [ZeroGPU quotas](https://huggingface.co/docs/hub/spaces-zerogpu), [Gradio JavaScript client](https://github.com/gradio-app/gradio/tree/main/client/js).

Build the viewer with `npm run build`; `npm run preview` serves the build.

The regression checks run from the repository root:

```sh
npm install
npm --prefix web install
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:world
```

These checks cover joint lengths and bend limits, planted paw contacts, standing before fetch movement, head tracking and pickup, returning to the original pose, rendered animation in both scenes, and simulated Arduino petting and camera distance. They also cover making a dog from a photo against a mocked API (a created dog joining the Model list, server problems, resuming after a refresh, refused photos) and the `/api` server itself. A real generation needs `HF_TOKEN` and free GPU quota. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome instead of Playwright's Chromium.

## Arduino

The page reads the Arduino directly over USB with the Web Serial API, so it needs **Chrome or Edge** (on `localhost` or https). Arduino input runs entirely in the browser.

1. Plug in the board and click **Connect Arduino** (top left), then pick its port. Chrome remembers it, so later loads and re-plugs reconnect without asking.
2. Flash `arduino/snoopy/snoopy.ino`, or use firmware that sends the same format. It prints one CSV line per sample at **9600 baud**: `X1,Y1,R3_1,X2,Y2,R3_2`, e.g. `512,509,0,530,500,0`. Joystick 1's **X1 pets** and **Y1 controls the ball**; joystick 2's **X2/Y2 control the camera**. Push Y1 up or down once to ready the ball, return to centre, then push again to throw. Holding it triggers only once. Send raw `analogRead` axis values and `1` for pressed switches (`0` released), with a newline after each sample and no header. Leave the sticks alone for the first half second after connecting: the page measures where each one rests then (press **C** to measure again), so 3.3V sticks and 12-bit boards work without changes. Change the column order, baud rate, stick dead zone or axis directions in `ARDUINO` in `web/src/input/arduino.js`.

Older firmware can still send `touch,button,distance` or `touch,button,distance,camX,camY,camPress,petX,petY,petPress`. Touch and button are `1` while active; distance is in cm. Six-column joystick messages do not update these separate sensor controls.

| Joystick | VRx | VRy | SW |
| --- | --- | --- | --- |
| 1: petting / ball | A0 | A1 | D2 |
| 2: camera | A2 | A3 | D3 |

| Sensor | Action |
| --- | --- |
| Touch | The dog leans into petting, tilts its head, and gently wags its tail |
| Button | 1st press: ball in hand. 2nd press: throw it; the dog fetches it and brings it toward the camera |
| Distance | The closer you are, the closer the camera gets to the dog (10–80 cm maps to the scene's zoom range); after 1 s without readings the mouse wheel takes over |
| Camera stick | Left/right orbits around the dog, up/down tilts the camera; speed follows how far you push. Click: ease back to the starting view |
| Joystick 1 | Horizontal: pet the dog, harder the further you push. Vertical: ready/throw the ball, returning to centre between pushes. Click: full pet, like touch |

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
cd web
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
