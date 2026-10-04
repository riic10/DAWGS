import { PHOTO, GenerationError, checkGeneration, createJob, downloadJob, waitForJob } from "./generation.js";

// The job token of a generation still running, so a refresh picks it back up
// instead of paying for another one.
const JOB_KEY = "snoopygs-world-job";
const STATUS = {
  uploading: "Uploading your photo…",
  starting: "Waiting for Hugging Face…",
  processing: "Creating your 3D dog. This can take a few minutes…",
  reconnecting: "Reconnecting to your dog creation…",
  downloading: "Downloading your 3D dog…",
  waiting: "Your 3D dog is ready. It joins the scene once the ball is back and the fit panel is closed.",
  fitting: "Fitting a skeleton to your dog…",
  failed: "Dog creation stopped. Your current dog is still available.",
};

const savedJob = {
  get() { try { return localStorage.getItem(JOB_KEY); } catch { return null; } },
  set(token) { try { localStorage.setItem(JOB_KEY, token); } catch { /* it still finishes in this tab */ } },
  clear() { try { localStorage.removeItem(JOB_KEY); } catch { /* nothing was saved */ } },
};

// The Dog panel's photo -> 3D dog controls (index.html). show(file, label)
// puts a finished dog in the scene and rejects if it can't; it's only called
// while canShow() is true.
export function createPhotoDog({ canShow, show }) {
  const $ = (id) => document.getElementById(id);
  const panel = $("dog-panel"), photoInput = $("dog-photo"), preview = $("dog-photo-preview");
  const createButton = $("dog-create"), statusEl = $("dog-create-status"), errorEl = $("dog-error"), saveLink = $("dog-save");
  let photo = null, creating = false, made = 0, previewUrl = "", saveUrl = "";

  const setStatus = (text) => { statusEl.textContent = text; };
  const setError = (text) => { errorEl.textContent = text; };

  function refresh() {
    photoInput.disabled = creating;
    createButton.disabled = !photo || creating;
  }

  function fail(error) {
    console.error(error);
    setStatus(STATUS.failed);
    setError(error.message);
  }

  // The generation used GPU quota, so keep the file even if it can't be shown.
  function offerDownload(file) {
    URL.revokeObjectURL(saveUrl);
    saveUrl = URL.createObjectURL(file);
    saveLink.href = saveUrl;
    saveLink.download = file.name;
    saveLink.textContent = `Download ${file.name}`;
    saveLink.hidden = false;
  }

  async function collect(token) {
    try {
      await waitForJob(token, (state, reason) => setStatus(reason ? `${STATUS[state]} ${reason}` : STATUS[state]));
      setStatus(STATUS.downloading);
      return await downloadJob(token);
    } catch (error) {
      // Keep the token through a stopped server so a refresh can still collect the dog.
      if (!(error instanceof GenerationError && error.retry)) savedJob.clear();
      throw error;
    }
  }

  async function finish(token) {
    const bytes = await collect(token);
    savedJob.clear();
    made++;
    const file = new File([bytes], `snoopygs-dog-${made}.ply`, { type: "application/octet-stream" });
    offerDownload(file);
    if (!canShow()) {
      setStatus(STATUS.waiting);
      while (!canShow()) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    setStatus(STATUS.fitting);
    await show(file, `Your dog ${made}`);
    setStatus(`Your dog ${made} is ready. Press B to play fetch.`);
  }

  async function create() {
    if (!photo || creating) return;
    creating = true;
    refresh();
    setError("");
    setStatus(STATUS.uploading);
    try {
      const token = await createJob(photo);
      savedJob.set(token);
      await finish(token);
    } catch (error) {
      fail(error);
    } finally {
      creating = false;
      refresh();
    }
  }

  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0] ?? null;
    let problem = "";
    if (file && !PHOTO.types.includes(file.type)) problem = "Choose a PNG or JPEG image.";
    else if (file && file.size > PHOTO.maxBytes) problem = "Choose an image smaller than 3 MB.";
    if (problem) photoInput.value = "";
    photo = problem ? null : file;
    URL.revokeObjectURL(previewUrl);
    previewUrl = photo ? URL.createObjectURL(photo) : "";
    if (photo) preview.src = previewUrl;
    else preview.removeAttribute("src");
    preview.hidden = !photo;
    setError(problem);
    refresh();
    // Point out a stopped server or a missing token before the upload.
    if (photo) checkGeneration().catch((error) => { if (!creating) setError(error.message); });
  });

  createButton.addEventListener("click", create);

  const token = savedJob.get();
  if (token) {
    creating = true;
    panel.open = true;
    setStatus(STATUS.reconnecting);
    finish(token)
      .catch(fail)
      .finally(() => { creating = false; refresh(); });
  }
  refresh();
}
