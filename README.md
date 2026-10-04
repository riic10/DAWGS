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
