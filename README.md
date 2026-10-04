# SnoopyGS
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
| Touch | The dog hops and wiggles while you pet it |
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
