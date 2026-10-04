// Arduino sensors read straight from the browser over Web Serial (Chrome and
// Edge; needs localhost or https). No server code involved.
//
// The firmware prints one CSV line per sample, e.g.
// "512,509,0,530,500,0\r\n": X1,Y1,R3_1,X2,Y2,R3_2, with X1 petting,
// Y1 ball, and X2/Y2 camera (see arduino/snoopy/snoopy.ino). The older 3-column sensor
// and 9-column sensor + joystick formats are also accepted.
export const ARDUINO = {
  baudRate: 9600, // must match Serial.begin() in arduino/snoopy/snoopy.ino
  // CSV column order the firmware prints. Stick axes are raw analogRead
  // values; stick clicks are 1 while pressed.
  columns: ["petX", "petY", "petPress", "camX", "camY", "camPress"],
  legacyColumns: ["touch", "button", "distance", "camX", "camY", "camPress", "petX", "petY", "petPress"],
  distanceValid: [2, 400], // cm; 0 or out of range means no echo (HC-SR04 timeout)
  buttonDebounceMs: 150,
  stick: {
    // Each axis's resting value is measured from the first samples after
    // connecting (leave the sticks alone while plugging in), instead of
    // assuming 512: a stick powered from 3.3V rests near 340, and a 12-bit
    // board reads up to 4095. Full deflection is taken as 0..2×rest, which is
    // what a pot across the stick's supply gives.
    calibrateSamples: 12, // ~0.5 s at 25 lines/s
    minRest: 100, // an axis resting lower isn't a stick (e.g. a 0/1 column); it reads 0
    deadZone: 0.12, // of full deflection; cheap sticks wobble around their rest
    ballPress: 0.65, // normalized Y1 deflection in either direction triggers once
    ballRelease: 0.25, // return near centre before another ball action
    // Flip an axis if pushing the stick moves things the wrong way; it depends
    // on how the module is mounted.
    invert: { camX: false, camY: false, petX: false, petY: false },
  },
};

// Keyboard stand-ins for testing without the board. Arrow keys are the camera
// stick, I/J/K/L the pet stick.
const KEYS = { touch: "t", button: "b", closer: "[", further: "]", stopDistance: "0", cameraPress: "r", calibrate: "c" };
const STICK_KEYS = {
  arrowleft: ["cam", "x", -1], arrowright: ["cam", "x", 1], arrowup: ["cam", "y", -1], arrowdown: ["cam", "y", 1],
  j: ["pet", "x", -1], l: ["pet", "x", 1], i: ["pet", "y", -1], k: ["pet", "y", 1],
};
const SIM_DISTANCE = { start: 40, step: 5, min: 5, max: 120, intervalMs: 100 };

// Returns { state, on(type, fn), feedLine(line), connect() }.
// state.cam / state.pet: { x, y } in -1..1 (right / down positive, dead zone
// removed), `pressed`, and `raw` ([x, y] as the firmware sent them).
// Events: "touchstart", "touchend", "buttonpress", "distance" (detail: cm),
// "camerapress", "petpress", "connection" (detail: true/false).
export function createArduinoInput() {
  const events = new EventTarget();
  const state = {
    connected: false, touch: false, button: false, distance: null, distanceAt: -Infinity,
    ballAxis: 0, // normalized Y1 in the six-column format
    cam: { x: 0, y: 0, pressed: false, raw: null },
    pet: { x: 0, y: 0, pressed: false, raw: null },
    rest: null, // { camX, camY, petX, petY } once calibrated
    // What's coming over the wire, so the HUD can say why nothing registers:
    // when the last good and last unreadable line arrived, and that line.
    serial: { goodAt: -Infinity, badAt: -Infinity, lastBad: "" },
  };
  let badLogged = 0;
  let lastPressAt = -Infinity;
  let ballAxisHeld = false;

  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

  function setTouch(on) {
    if (on === state.touch) return;
    state.touch = on;
    emit(on ? "touchstart" : "touchend");
  }

  function setButton(down) {
    if (down && !state.button) {
      const now = performance.now();
      if (now - lastPressAt >= ARDUINO.buttonDebounceMs) emit("buttonpress");
      lastPressAt = now;
    }
    state.button = down;
  }

  // Resting values: the median of the first few samples, per axis.
  const AXES = ["camX", "camY", "petX", "petY"];
  let calibrationRows = [];
  function calibrate() {
    state.rest = null;
    calibrationRows = [];
    setBallAxis(0);
  }
  function learnRest(row) {
    calibrationRows.push(row);
    if (calibrationRows.length < ARDUINO.stick.calibrateSamples) return;
    state.rest = Object.fromEntries(AXES.map((axis) => {
      const values = calibrationRows.map((r) => r[axis]).sort((a, b) => a - b);
      return [axis, values[values.length >> 1]];
    }));
    calibrationRows = [];
    console.info("Arduino stick rest values:", state.rest);
  }

  // Raw reading -> -1..1 with the dead zone cut out and the rest rescaled, so
  // the value starts from 0 just past the dead zone.
  function stickAxis(row, axis) {
    const raw = row[axis];
    const rest = state.rest?.[axis];
    if (raw === undefined || rest === undefined || rest < ARDUINO.stick.minRest) return 0;
    const { deadZone, invert } = ARDUINO.stick;
    let v = (raw - rest) / rest;
    v = Math.max(-1, Math.min(1, invert[axis] ? -v : v));
    const mag = Math.max(0, Math.abs(v) - deadZone) / (1 - deadZone);
    return Math.sign(v) * mag;
  }

  function setStick(name, x, y, pressed, raw = null) {
    const stick = state[name];
    stick.raw = raw;
    stick.x = x;
    stick.y = y;
    if (pressed && !stick.pressed) emit(`${name === "cam" ? "camera" : "pet"}press`);
    stick.pressed = pressed;
  }

  function setDistance(cm) {
    const [lo, hi] = ARDUINO.distanceValid;
    if (!(cm >= lo && cm <= hi)) return;
    state.distance = cm;
    state.distanceAt = performance.now();
    emit("distance", cm);
  }

  // One vertical push is one ball-button action, even while held or jittering.
  // First push readies the ball; centre the stick, then push again to throw.
  function setBallAxis(value) {
    state.ballAxis = value;
    const magnitude = Math.abs(value);
    if (magnitude <= ARDUINO.stick.ballRelease) ballAxisHeld = false;
    else if (!ballAxisHeld && magnitude >= ARDUINO.stick.ballPress) {
      ballAxisHeld = true;
      emit("buttonpress");
    }
  }

  // Parse one CSV line from the firmware. Returns false (and changes nothing)
  // for anything malformed: wrong column count, non-numbers, boot chatter.
  function feedLine(line) {
    const parts = line.trim().split(",");
    const columns = parts.length === ARDUINO.columns.length ? ARDUINO.columns
      : parts.length === 3 || parts.length === ARDUINO.legacyColumns.length ? ARDUINO.legacyColumns : null;
    if (!columns) return false;
    const values = parts.map((p) => (p.trim() === "" ? NaN : Number(p)));
    if (values.some((v) => !Number.isFinite(v))) return false;
    const row = Object.fromEntries(values.map((v, i) => [columns[i], v]));
    if (row.touch !== undefined) setTouch(row.touch !== 0);
    if (row.button !== undefined) setButton(row.button !== 0);
    if (row.distance !== undefined) setDistance(row.distance);
    if (!state.rest && AXES.every(axis => row[axis] !== undefined)) learnRest(row); // sticks read 0 until this finishes
    const raw = (x, y) => (x === undefined ? null : [x, y]);
    const joystickOnly = columns === ARDUINO.columns;
    const firstY = stickAxis(row, "petY");
    setStick("cam", stickAxis(row, "camX"), stickAxis(row, "camY"), Boolean(row.camPress), raw(row.camX, row.camY));
    setStick("pet", stickAxis(row, "petX"), joystickOnly ? 0 : firstY, Boolean(row.petPress), raw(row.petX, row.petY));
    setBallAxis(joystickOnly ? firstY : 0);
    return true;
  }

  // --- Web Serial -----------------------------------------------------------
  let port = null;
  let reader = null;
  let pipeDone = null;

  async function open(p) {
    if (port) return;
    port = p;
    badLogged = 0;
    calibrate();
    try {
      await port.open({ baudRate: ARDUINO.baudRate });
    } catch (err) {
      console.warn("Couldn't open serial port:", err);
      port = null;
      return;
    }
    state.connected = true;
    emit("connection", true);
    readLoop(port);
  }

  async function readLoop(p) {
    let pending = "";
    try {
      const decoder = new TextDecoderStream();
      pipeDone = p.readable.pipeTo(decoder.writable).catch(() => {});
      reader = decoder.readable.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        const lines = pending.split("\n");
        pending = lines.pop(); // partial line, completed by the next chunk
        for (const line of lines) noteLine(line, feedLine(line));
        if (pending.length > 1024) { // no newline at all: wrong baud rate?
          noteLine(pending.slice(0, 40), false);
          pending = "";
        }
      }
    } catch (err) {
      // Unplugged or the device errored; handled below.
    } finally {
      reader?.releaseLock();
      reader = null;
      await close();
    }
  }

  function noteLine(line, ok) {
    const now = performance.now();
    if (ok) { state.serial.goodAt = now; return; }
    if (!line.trim()) return;
    state.serial.badAt = now;
    state.serial.lastBad = line.trim();
    if (badLogged++ < 5) console.warn(`Arduino line not understood (expects ${ARDUINO.columns.join(",")} at ${ARDUINO.baudRate} baud):`, JSON.stringify(line));
  }

  async function close() {
    if (!port) return;
    const p = port;
    port = null;
    await pipeDone;
    try { await p.close(); } catch { /* already gone */ }
    state.connected = false;
    setTouch(false);
    setButton(false);
    setBallAxis(0);
    setStick("cam", 0, 0, false);
    setStick("pet", 0, 0, false);
    emit("connection", false);
  }

  // Must run from a user gesture (a click) the first time; Chrome remembers
  // the choice, so later loads reconnect through getPorts() without a prompt.
  async function connect() {
    if (!navigator.serial) return;
    try {
      open(await navigator.serial.requestPort());
    } catch {
      // User closed the picker.
    }
  }

  if (navigator.serial) {
    navigator.serial.getPorts().then((ports) => { if (ports[0]) open(ports[0]); });
    navigator.serial.addEventListener("connect", (e) => open(e.target));
    navigator.serial.addEventListener("disconnect", (e) => {
      if (e.target === port && reader) reader.cancel().catch(() => {});
    });
  }

  // --- Keyboard stand-ins -----------------------------------------------------
  let simDistance = null;
  let simTimer = null;
  function simulateDistance(cm) {
    simDistance = cm;
    clearInterval(simTimer);
    simTimer = null;
    if (cm === null) return;
    setDistance(cm);
    simTimer = setInterval(() => setDistance(simDistance), SIM_DISTANCE.intervalMs);
  }
  // Held stick keys, e.g. "cam,x,-1". Opposite keys cancel out.
  const heldStickKeys = new Set();
  function applyStickKeys() {
    for (const name of ["cam", "pet"]) {
      let x = 0, y = 0;
      for (const key of heldStickKeys) {
        const [stick, axis, dir] = STICK_KEYS[key];
        if (stick !== name) continue;
        if (axis === "x") x += dir; else y += dir;
      }
      setStick(name, x, y, state[name].pressed);
    }
  }
  const typing = (e) => e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest("input, select, textarea"));
  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    const key = e.key.toLowerCase();
    if (STICK_KEYS[key]) {
      heldStickKeys.add(key);
      applyStickKeys();
      e.preventDefault(); // arrows would scroll the sidebar
    } else if (key === KEYS.cameraPress) emit("camerapress");
    else if (key === KEYS.calibrate) calibrate();
    else if (key === KEYS.touch) setTouch(true);
    else if (key === KEYS.button) setButton(true);
    else if (key === KEYS.closer || key === KEYS.further) {
      const cm = (simDistance ?? state.distance ?? SIM_DISTANCE.start)
        + (key === KEYS.closer ? -SIM_DISTANCE.step : SIM_DISTANCE.step);
      simulateDistance(Math.min(SIM_DISTANCE.max, Math.max(SIM_DISTANCE.min, cm)));
    } else if (key === KEYS.stopDistance) simulateDistance(null);
  });
  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (heldStickKeys.delete(key)) applyStickKeys();
    else if (key === KEYS.touch) setTouch(false);
    else if (key === KEYS.button) setButton(false);
  });
  window.addEventListener("blur", () => {
    setTouch(false);
    setButton(false);
    if (heldStickKeys.size) { heldStickKeys.clear(); applyStickKeys(); }
  });

  return {
    state,
    supported: Boolean(navigator.serial),
    on: (type, fn) => {
      const listener = e => fn(e.detail);
      events.addEventListener(type, listener);
      return () => events.removeEventListener(type, listener);
    },
    feedLine,
    connect,
    calibrate, // re-measure the sticks' resting values from the next samples
  };
}
