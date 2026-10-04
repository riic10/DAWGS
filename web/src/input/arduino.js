// Arduino sensors read straight from the browser over Web Serial (Chrome and
// Edge; needs localhost or https). No server code involved.
//
// The firmware prints one CSV line per sample, e.g. "1,0,42\r\n".
export const ARDUINO = {
  baudRate: 9600,
  columns: ["touch", "button", "distance"], // CSV column order the firmware prints
  distanceValid: [2, 400], // cm; 0 or out of range means no echo (HC-SR04 timeout)
  buttonDebounceMs: 150,
};

// Keyboard stand-ins for testing without the board.
const KEYS = { touch: "t", button: "b", closer: "[", further: "]", stopDistance: "0" };
const SIM_DISTANCE = { start: 40, step: 5, min: 5, max: 120, intervalMs: 100 };

// Returns { state, on(type, fn), feedLine(line), connect() }.
// Events: "touchstart", "touchend", "buttonpress", "distance" (detail: cm),
// "connection" (detail: true/false).
export function createArduinoInput() {
  const events = new EventTarget();
  const state = { connected: false, touch: false, button: false, distance: null, distanceAt: -Infinity };
  let lastPressAt = -Infinity;

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

  function setDistance(cm) {
    const [lo, hi] = ARDUINO.distanceValid;
    if (!(cm >= lo && cm <= hi)) return;
    state.distance = cm;
    state.distanceAt = performance.now();
    emit("distance", cm);
  }

  // Parse one CSV line from the firmware. Returns false (and changes nothing)
  // for anything malformed: wrong column count, non-numbers, boot chatter.
  function feedLine(line) {
    const parts = line.trim().split(",");
    if (parts.length !== ARDUINO.columns.length) return false;
    const values = parts.map((p) => (p.trim() === "" ? NaN : Number(p)));
    if (values.some((v) => !Number.isFinite(v))) return false;
    const row = Object.fromEntries(ARDUINO.columns.map((name, i) => [name, values[i]]));
    setTouch(row.touch !== 0);
    setButton(row.button !== 0);
    setDistance(row.distance);
    return true;
  }

  // --- Web Serial -----------------------------------------------------------
  let port = null;
  let reader = null;
  let pipeDone = null;

  async function open(p) {
    if (port) return;
    port = p;
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
        for (const line of lines) feedLine(line);
        if (pending.length > 1024) pending = ""; // no newline at all: wrong baud rate?
      }
    } catch (err) {
      // Unplugged or the device errored; handled below.
    } finally {
      reader?.releaseLock();
      reader = null;
      await close();
    }
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
  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === KEYS.touch) setTouch(true);
    else if (key === KEYS.button) setButton(true);
    else if (key === KEYS.closer || key === KEYS.further) {
      const cm = (simDistance ?? state.distance ?? SIM_DISTANCE.start)
        + (key === KEYS.closer ? -SIM_DISTANCE.step : SIM_DISTANCE.step);
      simulateDistance(Math.min(SIM_DISTANCE.max, Math.max(SIM_DISTANCE.min, cm)));
    } else if (key === KEYS.stopDistance) simulateDistance(null);
  });
  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (key === KEYS.touch) setTouch(false);
    else if (key === KEYS.button) setButton(false);
  });
  window.addEventListener("blur", () => { setTouch(false); setButton(false); });

  return {
    state,
    supported: Boolean(navigator.serial),
    on: (type, fn) => events.addEventListener(type, (e) => fn(e.detail)),
    feedLine,
    connect,
  };
}
