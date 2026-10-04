// "Upload your dog" dialog: photo -> TRELLIS -> splat, plus naming the dog.
// Scene work happens through the callbacks; Space work lives in trellis.js.
import { generateDogSplat } from "./trellis.js";

export const NAME = { maxLength: 24, fallback: "Your dog" };

export const cleanName = (raw) => (raw ?? "").trim().slice(0, NAME.maxLength) || NAME.fallback;

// "Mr. Waffles" -> "mr-waffles"; nothing usable left -> "your-dog".
export function nameToFilename(name) {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
  return `${slug || "your-dog"}.ply`;
}

const PHASE_TEXT = {
  connecting: "Connecting to TRELLIS…",
  queued: "Waiting in the queue…",
  preparing: "Preparing your photo…",
  generating: "Building your 3D dog (about 30 s)…",
  extracting: "Extracting the splat…",
  downloading: "Downloading…",
};

// The TRELLIS Space can't decode some formats (HEIC, the iPhone/Mac default,
// fails with a bare "An error occurred"), so every photo is decoded here and
// re-encoded as a JPEG, longest side at most PHOTO.maxSide. TRELLIS works at
// ~518 px anyway, so this only makes uploads smaller.
export const PHOTO = { maxSide: 1536, quality: 0.92 };

export async function normalizePhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? "");
    throw new Error(heic
      ? "This photo is HEIC (the iPhone/Mac default), which can't be read here. Export it as JPEG (in Photos: File → Export) or take a screenshot of it, then pick that."
      : "Couldn't read that image. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, PHOTO.maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent areas become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO.quality));
  if (!blob) throw new Error("Couldn't prepare that image. Try a JPEG or PNG.");
  const base = (file.name ?? "photo").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

const formatElapsed = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// onDog({ name, photoUrl, bytes }): a new dog is ready.
// onRename(name): the uploaded dog was renamed. onTurn(): ↻ turn.
// auth: from hf-auth.js; signed-in generations use the user's own GPU quota.
export function createUploadDialog({ onDog, onRename, onTurn, auth }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("upload");
  const fileInput = $("upload-file");
  const preview = $("upload-preview");
  const nameInput = $("upload-name");
  const saveName = $("upload-save-name");
  const generate = $("upload-generate");
  const statusEl = $("upload-status");
  const errorBox = $("upload-error");
  const errorText = $("upload-error-text");
  const retry = $("upload-retry");
  const doneBox = $("upload-done");
  const doneText = $("upload-done-text");
  const download = $("upload-download");
  const turn = $("upload-turn");
  const signedOut = $("hf-signed-out");
  const signedIn = $("hf-signed-in");
  const notConfigured = $("hf-not-configured");
  const signInBtn = $("hf-sign-in");
  const signOutBtn = $("hf-sign-out");
  const avatar = $("hf-avatar");
  const username = $("hf-username");
  const pro = $("hf-pro");

  nameInput.maxLength = NAME.maxLength;
  nameInput.placeholder = NAME.fallback;

  let file = null;
  let previewUrl = null;
  let running = false;
  let ready = null; // { name, bytes } of the dog last delivered
  let ticker = null;
  let lastStatus = null;
  let startedAt = 0;

  function showStatus() {
    if (!running || !lastStatus) return;
    const { phase, queuePosition, progress } = lastStatus;
    let text = PHASE_TEXT[phase] ?? phase;
    if (phase === "queued" && queuePosition != null) text = `Waiting in the queue (position ${queuePosition + 1})…`;
    if (phase === "downloading" && progress != null) text = `Downloading… ${Math.round(progress * 100)}%`;
    statusEl.textContent = `${text} · ${formatElapsed((performance.now() - startedAt) / 1000)}`;
  }

  function setRunning(on) {
    running = on;
    generate.disabled = on || !file;
    fileInput.disabled = on;
    clearInterval(ticker);
    if (on) ticker = setInterval(showStatus, 1000);
  }

  function renderAccount() {
    const user = auth.user;
    notConfigured.hidden = auth.configured || Boolean(user);
    signedOut.hidden = !auth.configured || Boolean(user);
    signedIn.hidden = !user;
    if (user) {
      avatar.src = user.avatar ?? "";
      username.textContent = user.username;
      pro.hidden = !user.isPro;
    }
  }

  function showError(message) {
    statusEl.textContent = "";
    errorText.textContent = message;
    errorBox.hidden = false;
  }

  function showDone() {
    doneBox.hidden = false;
    saveName.hidden = false;
    doneText.textContent = `${ready.name} is in the scene and on the last card in the sidebar.`;
  }

  async function run() {
    if (!file || running) return;
    errorBox.hidden = true;
    doneBox.hidden = true;
    startedAt = performance.now();
    lastStatus = { phase: "connecting" };
    setRunning(true);
    showStatus();
    try {
      const { bytes } = await generateDogSplat(file, {
        token: auth.token, // null when signed out or expired
        onStatus: (s) => { lastStatus = s; showStatus(); },
      });
      const name = cleanName(nameInput.value); // whatever is typed when the dog arrives
      ready = { name, bytes };
      statusEl.textContent = "";
      // The sidebar entry takes over the photo URL (it revokes it on replace).
      onDog({ name, photoUrl: previewUrl, bytes }); // adds the card and swaps the dog in
      previewUrl = URL.createObjectURL(file); // keep the dialog preview alive
      preview.src = previewUrl;
      showDone();
      if (dialog.open) dialog.close(); // get out of the way: the new dog is in the scene
    } catch (err) {
      console.error(err, "\nSpace said:", err.cause?.message ?? err.cause);
      let message = err.message ?? String(err);
      if (err.kind === "auth") auth.signOut(); // show the sign-in button again
      if (err.kind === "quota" && !auth.user && auth.configured) {
        message += " Or sign in with Hugging Face above to use your own allowance.";
      }
      showError(message);
    } finally {
      setRunning(false);
    }
  }

  fileInput.addEventListener("change", async () => {
    const picked = fileInput.files?.[0];
    if (!picked) return;
    file = null;
    generate.disabled = true;
    preview.hidden = true;
    errorBox.hidden = true;
    if (picked.type && !picked.type.startsWith("image/")) {
      showError("That file isn't an image. Pick a photo of your dog.");
      return;
    }
    statusEl.textContent = "Reading photo…";
    try {
      file = await normalizePhoto(picked);
    } catch (err) {
      showError(err.message);
      return;
    }
    statusEl.textContent = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
    errorBox.hidden = true;
    generate.disabled = running;
  });

  generate.addEventListener("click", run);
  retry.addEventListener("click", run);

  // Sign-in leaves the page; come back to this dialog with the name kept.
  // (The photo has to be picked again: files can't survive the trip.)
  signInBtn.addEventListener("click", async () => {
    try {
      await auth.signIn({ upload: true, name: nameInput.value, search: location.search });
    } catch (err) {
      showError(err.message ?? String(err));
    }
  });
  signOutBtn.addEventListener("click", () => auth.signOut());
  auth.onChange(renderAccount);
  renderAccount();

  saveName.addEventListener("click", () => {
    if (!ready) return;
    ready.name = cleanName(nameInput.value);
    nameInput.value = ready.name === NAME.fallback ? "" : ready.name;
    onRename(ready.name);
    showDone();
  });

  // Build the file only when asked, so only the raw bytes stay in memory.
  download.addEventListener("click", (e) => {
    e.preventDefault();
    if (!ready) return;
    const url = URL.createObjectURL(new Blob([ready.bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nameToFilename(ready.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  turn.addEventListener("click", () => onTurn());

  return {
    open({ focusName = false, name } = {}) {
      if (name !== undefined) nameInput.value = name;
      if (!dialog.open) dialog.showModal();
      const signInError = auth.takeError();
      if (signInError) showError(`Hugging Face sign-in didn't finish: ${signInError}`);
      if (focusName) nameInput.focus();
    },
    get running() { return running; },
  };
}
