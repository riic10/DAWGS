// Sound effects and ambience. Each sound loops while it's wanted and fades in
// and out, so short interactions don't cut off with a click.
//
// Browsers only start audio after the visitor clicks or presses a key on the
// page (Arduino input doesn't count), so sound starts with the first such
// interaction; until then `onBlocked` lets the HUD say so.
export const SOUNDS = {
  garden: { url: "/sounds/garden_sound.mp3", volume: 0.35 }, // ambience in the woods
  petting: { url: "/sounds/petting_sound.mp3", volume: 0.8 }, // while the dog is petted
  chase: { url: "/sounds/ball_chasing_sound.mp3", volume: 0.7 }, // while it fetches the ball
};
const FADE_SECONDS = 0.35;
const MUTE_KEY = "snoopygs.muted"; // remembered per browser

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

// onBlocked(blocked): audio waits for a click. onMute(muted): mute changed.
export function createSounds({ onBlocked, onMute } = {}) {
  let blocked = false;
  let muted = readMuted();
  const tracks = Object.fromEntries(Object.entries(SOUNDS).map(([name, cfg]) => {
    const audio = new Audio(cfg.url);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    audio.muted = muted;
    return [name, { cfg, audio, want: 0, level: 0, starting: false }];
  }));

  function play(track) {
    if (track.starting || blocked) return;
    track.starting = true;
    track.audio.play()
      .catch((err) => {
        if (err.name === "NotAllowedError") {
          blocked = true;
          onBlocked?.(true);
        }
      })
      .finally(() => { track.starting = false; });
  }

  // First click / key / tap on the page unlocks audio.
  const unlock = () => {
    if (!blocked) return;
    blocked = false;
    onBlocked?.(false);
    for (const t of Object.values(tracks)) if (t.want > 0) play(t);
  };
  for (const type of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(type, unlock, { capture: true });
  }

  return {
    get muted() { return muted; },
    // Silence everything (the sounds keep their place, so unmuting picks up
    // where the scene is). Remembered in this browser.
    setMuted(on) {
      muted = Boolean(on);
      for (const t of Object.values(tracks)) t.audio.muted = muted;
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* storage blocked */ }
      onMute?.(muted);
    },
    toggleMute() { this.setMuted(!muted); },
    // For the console: { name: "paused" | volume }.
    get state() {
      return Object.fromEntries(Object.entries(tracks).map(([n, t]) => [n, t.audio.paused ? "paused" : +t.audio.volume.toFixed(2)]));
    },
    // 0..1: how much of this sound is wanted (volume follows, with a fade).
    set(name, amount) {
      tracks[name].want = Math.max(0, Math.min(1, amount));
    },
    update(dt) {
      const k = 1 - Math.exp(-dt / FADE_SECONDS);
      for (const t of Object.values(tracks)) {
        t.level += (t.want - t.level) * k;
        if (t.want > 0 && t.audio.paused) play(t);
        if (t.want === 0 && t.level < 0.01 && !t.audio.paused) {
          t.audio.pause();
          t.audio.currentTime = 0; // start from the top next time
          t.level = 0;
        }
        t.audio.volume = Math.min(1, t.level * t.cfg.volume);
      }
    },
  };
}
