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
2. The firmware prints one CSV line per sample at **9600 baud**: `touch,button,distance`, e.g. `1,0,42`. Touch and button are 1 while active; distance is in cm (0 or over 400 means no echo). Change the column order, baud rate or valid range in `ARDUINO` in `web/src/input/arduino.js`.

| Sensor | Action |
| --- | --- |
| Touch | The dog hops and wiggles while you pet it |
| Button | 1st press: ball in hand. 2nd press: throw it; the dog fetches it and drops it back at its spot |
| Distance | The closer you are, the closer the camera gets to the dog (10–80 cm maps to the scene's zoom range); after 1 s without readings the mouse wheel takes over |

Without the board, use the keyboard: hold **T** to pet, **B** for the button, **[** / **]** for a simulated distance, **0** to stop it. In the console, `snoopy.arduino.feedLine("1,0,42")` runs a line through the same parser.

Tuning lives next to the code: `BALL` in `web/src/interactions/ball.js` (throw, bounce, fetch speed) and `CAMERA_DISTANCE` in `web/src/interactions/camera-distance.js`. `?debug` draws the ground the ball and dog use (green free, red blocked).

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
