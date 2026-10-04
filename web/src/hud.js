// Small overlay: Arduino connection, live sensor readings, fetch-game state.
const GAME_TEXT = {
  idle: "ball: press button to get it ready",
  ready: "ball: ready, press again to throw",
  flying: "ball: thrown",
  fetching: "dog: fetching",
  returning: "dog: bringing it back",
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

  let lastDraw = 0;
  return {
    setGame(state) { gameEl.textContent = GAME_TEXT[state] ?? state; },
    // Throttled to ~10 Hz; call every frame.
    update() {
      const now = performance.now();
      if (now - lastDraw < 100) return;
      lastDraw = now;
      const { touch, button, distance, distanceAt } = input.state;
      const fresh = distance !== null && now - distanceAt < 1000;
      readingsEl.textContent =
        `touch ${touch ? "●" : "○"}  button ${button ? "●" : "○"}  distance ${fresh ? `${Math.round(distance)} cm` : "–"}`;
    },
  };
}
