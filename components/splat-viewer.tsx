"use client";

import { useEffect, useRef, useState } from "react";
import { Expand, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { createDogMotion, dogPose, stepDog, type DogPose } from "@/lib/dog-motion";

type Props = {
  source: string;
  onReady: (download: string, count: number) => void;
  onLoading: () => void;
};

export default function SplatViewer({ source, onReady, onLoading }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef<() => void>(() => {});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [pose, setPose] = useState<DogPose>("Sitting");
  const [rigged, setRigged] = useState(false);
  const [rigNotice, setRigNotice] = useState("");
  const togglePose = useRef<() => void>(() => {});
  const buttonInput = useRef({ press: (_key: string) => {}, release: (_key: string) => {}, cancel: (_key: string) => {}, click: (_key: string) => {} });
  const sample = source === "/api/sample";

  useEffect(() => {
    const container = host.current!;
    const abort = new AbortController();
    let disposed = false;
    let release = () => {};
    let download = "";
    setError("");
    setLoading(true);
    setPose("Sitting");
    setRigged(false);
    setRigNotice("");
    delete container.dataset.dogPosition;
    delete container.dataset.dogStand;
    delete container.dataset.dogYaw;
    onLoading();

    async function load() {
      const [
        THREE,
        { OrbitControls },
        { SparkRenderer, SplatMesh, SplatFileType },
      ] = await Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
        import("@sparkjsdev/spark"),
      ]);
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive Gaussian model. Drag to orbit and scroll to zoom.",
      );
      renderer.domElement.setAttribute("role", "img");
      container.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = true;
      const spark = new SparkRenderer({ renderer, accumExtSplats: true, covSplats: true, autoUpdate: false, enableLod: false });
      scene.add(spark);
      let frameUpdate: Promise<void> | undefined;
      let released = false;
      let mesh: InstanceType<typeof SplatMesh> | undefined;
      let rig: { update: (motion: ReturnType<typeof createDogMotion>) => void; dispose: () => void } | undefined;
      let removeInput = () => {};
      let ground: InstanceType<typeof THREE.GridHelper> | undefined;
      const resize = new ResizeObserver(() => {
        const { width, height } = container.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      });
      resize.observe(container);
      const contextLost = (event: Event) => {
        event.preventDefault();
        setError(
          "The 3D viewer lost its graphics connection. Reload the viewer to continue.",
        );
      };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      release = () => {
        if (released) return;
        released = true;
        renderer.setAnimationLoop(null);
        resize.disconnect();
        controls.dispose();
        removeInput();
        togglePose.current = () => {};
        buttonInput.current = { press: () => {}, release: () => {}, cancel: () => {}, click: () => {} };
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          contextLost,
        );
        renderer.domElement.remove();
        const destroy = () => {
          rig?.dispose();
          ground?.dispose();
          mesh?.dispose();
          spark.dispose();
          renderer.dispose();
        };
        // Let the GPU readback and sort finish before freeing their textures and worker.
        if (frameUpdate) void frameUpdate.then(destroy, destroy);
        else destroy();
      };
      const response = await fetch(source, { signal: abort.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error ||
            "The model could not be downloaded. Please reload the viewer.",
        );
      }
      const blob = await response.blob();
      const bytes = await blob.arrayBuffer();
      if (disposed) return;
      download = URL.createObjectURL(blob);
      mesh = new SplatMesh({
        fileBytes: bytes,
        fileType: SplatFileType.PLY,
        lod: false,
        extSplats: true,
        covSplats: true,
      });
      await mesh.initialized;
      if (disposed) {
        mesh.dispose();
        return;
      }
      // TRELLIS exports in a camera coordinate system with the vertical axis inverted.
      mesh.rotation.x = Math.PI;
      const bounds = mesh.getBoundingBox(true);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3()).length();
      if (!Number.isFinite(size) || size <= 0)
        throw new Error("The file does not contain a viewable Gaussian model.");
      mesh.scale.setScalar(2 / size);
      mesh.position.copy(
        center.multiplyScalar(-2 / size).applyEuler(mesh.rotation),
      );
      const dog = new THREE.Group();
      dog.add(mesh);
      scene.add(dog);
      const motion = createDogMotion();
      const keys = new Set<string>();
      const keyTaps = new Map<string, number>();
      const buttonKeys = new Set<string>();
      let groundHeight = 0.405;
      let headingOffset = 0;
      if (sample) {
        const { createSampleDogRig } = await import("@/lib/sample-dog-rig");
        if (disposed) return;
        rig = createSampleDogRig(mesh);
      } else {
        const { createDogRig, DogRigFitError } = await import("@/lib/dog-rig");
        if (disposed) return;
        try {
          const uploadedRig = createDogRig(mesh);
          rig = uploadedRig;
          groundHeight = uploadedRig.fit.ground;
          headingOffset = -uploadedRig.fit.heading;
          motion.stand = motion.target = Number(uploadedRig.fit.startsStanding);
        } catch (cause) {
          if (!(cause instanceof DogRigFitError)) throw cause;
          setRigNotice(`${cause.message} You can still orbit and download the model.`);
        }
      }
      if (rig) {
        setRigged(true);
        setPose(dogPose(motion));
        ground = new THREE.GridHelper(20, 80, 0xc9ccbf, 0xe0e2d8);
        ground.position.y = mesh.position.y - groundHeight * mesh.scale.y;
        scene.add(ground);
        const canvas = renderer.domElement;
        canvas.tabIndex = 0;
        canvas.setAttribute("role", "application");
        canvas.setAttribute("aria-label", `${sample ? "Sample dog" : "Dog"} controls. W forward, S backward, A turn left, D turn right, C to sit or stand. Drag to orbit.`);
        const pointerClicks = new Set<string>();
        const cancel = (key: string) => {
          buttonKeys.delete(key);
          keyTaps.delete(key);
          pointerClicks.delete(key);
        };
        const clear = () => {
          keys.clear();
          keyTaps.clear();
          buttonKeys.clear();
          pointerClicks.clear();
        };
        const focus = () => canvas.focus({ preventScroll: true });
        buttonInput.current = {
          press: (key) => {
            focus();
            buttonKeys.add(key);
            pointerClicks.add(key);
            // Consume clicks in animation time so slow frames cannot discard them.
            if (motion.target === 1 && motion.stand === 1) keyTaps.set(key, 0.18);
          },
          release: (key) => {
            buttonKeys.delete(key);
          },
          cancel,
          click: (key) => {
            // A click must work on its own without duplicating an active pointer gesture.
            if (pointerClicks.delete(key) || buttonKeys.has(key)) return;
            buttonInput.current.press(key);
            buttonInput.current.release(key);
            pointerClicks.delete(key);
          },
        };
        togglePose.current = () => {
          motion.target = motion.target === 0 ? 1 : 0;
          clear();
          setPose(dogPose(motion));
        };
        const keydown = (event: KeyboardEvent) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
          const target = event.target;
          if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return;
          if (!["KeyW", "KeyA", "KeyS", "KeyD", "KeyC"].includes(event.code)) return;
          if (event.repeat && event.code !== "KeyC" && !keys.has(event.code)) return;
          event.preventDefault();
          if (event.code === "KeyC") {
            if (!event.repeat) togglePose.current();
          } else {
            keys.add(event.code);
            // Retain brief taps until animation frames have shown a visible step or turn.
            if (!event.repeat && motion.target === 1 && motion.stand === 1) keyTaps.set(event.code, 0.18);
          }
        };
        const keyup = (event: KeyboardEvent) => keys.delete(event.code);
        canvas.addEventListener("pointerdown", focus);
        window.addEventListener("keydown", keydown);
        canvas.addEventListener("blur", clear);
        document.addEventListener("focusin", clear);
        window.addEventListener("keyup", keyup);
        window.addEventListener("blur", clear);
        document.addEventListener("visibilitychange", clear);
        removeInput = () => {
          clear();
          canvas.removeEventListener("pointerdown", focus);
          window.removeEventListener("keydown", keydown);
          canvas.removeEventListener("blur", clear);
          document.removeEventListener("focusin", clear);
          window.removeEventListener("keyup", keyup);
          window.removeEventListener("blur", clear);
          document.removeEventListener("visibilitychange", clear);
        };
      }
      reset.current = () => {
        const distance = camera.aspect < 1 ? 4.6 : 3.4;
        camera.position.set(dog.position.x + distance * 0.65, distance * 0.24, dog.position.z + distance);
        controls.target.copy(dog.position);
        controls.update();
      };
      reset.current();
      controls.minDistance = 0.5;
      controls.maxDistance = 12;
      let previousTime = performance.now();
      let previousPose = dogPose(motion);
      const displacement = new THREE.Vector3();
      renderer.setAnimationLoop((time) => {
        const dt = (time - previousTime) / 1000;
        previousTime = time;
        if (rig) {
          stepDog(motion, buttonKeys.size || keyTaps.size ? new Set([...keys, ...buttonKeys, ...keyTaps.keys()]) : keys, dt);
          for (const [key, remaining] of keyTaps) {
            const next = remaining - Math.max(0, Math.min(dt, 0.05));
            if (next <= 0) keyTaps.delete(key);
            else keyTaps.set(key, next);
          }
          rig.update(motion);
          displacement.set(motion.x - dog.position.x, 0, motion.z - dog.position.z);
          dog.position.set(motion.x, 0, motion.z);
          dog.rotation.y = motion.yaw + headingOffset;
          camera.position.add(displacement);
          controls.target.add(displacement);
          const nextPose = dogPose(motion);
          if (nextPose !== previousPose) {
            previousPose = nextPose;
            setPose(nextPose);
          }
          container.dataset.dogPosition = `${motion.x.toFixed(4)},${motion.z.toFixed(4)}`;
          container.dataset.dogStand = motion.stand.toFixed(3);
          container.dataset.dogYaw = motion.yaw.toFixed(4);
        }
        controls.update();
        if (!frameUpdate) {
          scene.updateMatrixWorld(true);
          camera.updateMatrixWorld();
          frameUpdate = spark.update({ scene, camera }).then(() => {
            frameUpdate = undefined;
          }, () => {
            frameUpdate = undefined;
            if (!disposed && !released) {
              setError("The animation renderer stopped. Reload the viewer to continue.");
              release();
            }
          });
        }
        renderer.render(scene, camera);
      });
      setLoading(false);
      onReady(download, mesh.splats?.getNumSplats() ?? 0);
    }

    load().catch((cause) => {
      if (disposed) return;
      release();
      release = () => {};
      setLoading(false);
      setError(
        cause instanceof Error && !/WebGL/.test(cause.message)
          ? cause.message
          : "This browser could not start the 3D viewer. Try Chrome with graphics acceleration enabled.",
      );
    });
    return () => {
      disposed = true;
      abort.abort();
      release();
      if (download) URL.revokeObjectURL(download);
    };
  }, [source, revision, onReady, onLoading, sample]);

  const movementButton = (key: string, label: string) => (
    <button
      type="button"
      className="dog-key"
      aria-label={`${label} (${key})`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        buttonInput.current.press(`Key${key}`);
      }}
      onPointerUp={() => buttonInput.current.release(`Key${key}`)}
      onLostPointerCapture={() => buttonInput.current.release(`Key${key}`)}
      onPointerCancel={() => buttonInput.current.cancel(`Key${key}`)}
      onClick={() => buttonInput.current.click(`Key${key}`)}
    >{key}</button>
  );

  return (
    <>
      <div ref={host} className="canvas-host" />
      {rigged && !loading && !error && (
        <div className="dog-controls">
          <strong role="status">{pose}</strong>
          <span>Use WASD or the buttons to move while standing</span>
          <span>{movementButton("W", "Forward")} Forward · {movementButton("S", "Back up")} Back up</span>
          <span>{movementButton("A", "Turn left")} Turn left · {movementButton("D", "Turn right")} Turn right · <button type="button" className="dog-key" aria-label="Sit / stand (C)" onClick={() => {
            togglePose.current();
            host.current?.querySelector("canvas")?.focus({ preventScroll: true });
          }}>C</button> Sit / stand</span>
          <button className="button secondary" onClick={() => {
            togglePose.current();
            host.current?.querySelector("canvas")?.focus({ preventScroll: true });
          }}>{pose === "Sitting" || pose === "Sitting down" ? "Stand up" : "Sit down"}</button>
          <small>{pose === "Sitting" ? "Stand up to move" : sample ? "Sample dog animation prototype" : "Automatic dog animation prototype"}</small>
        </div>
      )}
      {rigNotice && !loading && !error && (
        <div className="dog-controls" role="status"><small>{rigNotice}</small></div>
      )}
      {loading && !error && (
        <div className="viewer-message">
          <LoaderCircle className="spin" size={26} />
          <strong>Loading model</strong>
        </div>
      )}
      {error && (
        <div className="viewer-message viewer-error" role="alert">
          <TriangleAlert size={26} />
          <strong>We couldn’t open the viewer</strong>
          <span>{error}</span>
          <button
            className="button secondary"
            onClick={() => setRevision((n) => n + 1)}
          >
            Reload viewer
          </button>
          <a href={source} download="snoopygs-model.ply">
            Download the PLY file
          </a>
        </div>
      )}
      <div className="viewer-tools">
        <button
          title="Reset camera"
          aria-label="Reset camera"
          onClick={() => reset.current()}
        >
          <RotateCcw size={17} />
        </button>
        <button
          title="Expand viewer"
          aria-label="Expand viewer"
          onClick={() =>
            host.current?.parentElement
              ?.requestFullscreen?.()
              .catch(() =>
                setError("Fullscreen is unavailable in this browser."),
              )
          }
        >
          <Expand size={17} />
        </button>
      </div>
      <div className="axis" aria-hidden="true">
        <span>Y</span>
        <i />
        <b>X</b>
        <em>Z</em>
      </div>
    </>
  );
}
