// Small overlay: Arduino connection, live sensor readings, fetch-game state.
const GAME_TEXT = {
  idle: "ball: press button to get it ready",
  ready: "ball: ready, press again to throw",
  flying: "ball: thrown",
  standing: "dog: standing up",
  collecting: "dog: picking up ball",
  fetching: "dog: fetching",
  returning: "dog: bringing it back",
  dropping: "dog: putting the ball down",
};

export function createHud(input) {
  const connectBtn = document.getElementById("connect");
  const serialEl = document.getElementById("serial");
  const readingsEl = document.getElementById("readings");
  const gameEl = document.getElementById("game");

  function showConnection(connected) {
    if (!input.supported) {
      connectBtn.hidden = true;
      serialEl.textContent = "Arduino needs Chrome or Edge (Web Serial)";
      return;
    }
    connectBtn.hidden = connected;
    serialEl.textContent = connected ? "Arduino connected" : "Arduino not connected";
  }
  connectBtn.addEventListener("click", () => input.connect());
  input.on("connection", showConnection);
  showConnection(input.state.connected);

  // "connected" alone hides the usual failure: data arriving at the wrong baud
  // rate or in another format, which the parser drops line by line.
  function linkText(now) {
    if (!input.state.connected) return null;
    const { goodAt, badAt, lastBad } = input.state.serial;
    if (now - goodAt < 1000) return "Arduino connected";
    if (now - badAt < 1000) {
      const sample = lastBad.length > 40 ? `${lastBad.slice(0, 40)}…` : lastBad;
      return `Arduino connected, but its lines aren't understood: "${sample}". Flash arduino/snoopy/snoopy.ino (9600 baud)`;
    }
    return "Arduino connected, but no data is arriving";
  }

  let lastDraw = 0;
  return {
    setGame(state) { gameEl.textContent = GAME_TEXT[state] ?? state; },
    // Throttled to ~10 Hz; call every frame.
    update() {
      const now = performance.now();
      if (now - lastDraw < 100) return;
      lastDraw = now;
      const link = linkText(now);
      if (link !== null) serialEl.textContent = link;
      const { touch, button, distance, distanceAt, cam, pet } = input.state;
      const fresh = distance !== null && now - distanceAt < 1000;
      const stick = ({ x, y, pressed, raw }) =>
        `${x.toFixed(1)},${y.toFixed(1)}${raw ? ` (${raw.join(",")})` : ""}${pressed ? " ●" : ""}`;
      readingsEl.textContent =
        `touch ${touch ? "●" : "○"}  button ${button ? "●" : "○"}  distance ${fresh ? `${Math.round(distance)} cm` : "–"}` +
        `  camera ${stick(cam)}  pet ${stick(pet)}`;
    },
  };
}
