"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ImagePlus,
  LoaderCircle,
  MousePointer2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

const Viewer = dynamic(() => import("@/components/splat-viewer"), {
  ssr: false,
});
type Phase =
  "idle" | "uploading" | "starting" | "processing" | "succeeded" | "failed";
const STORAGE_KEY = "snoopygs-hf-job";
const labels: Record<Phase, string> = {
  idle: "Ready when you are",
  uploading: "Uploading your image",
  starting: "Waiting for Hugging Face",
  processing: "Generating your model",
  succeeded: "Your model is ready",
  failed: "Generation stopped",
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [download, setDownload] = useState("");
  const [count, setCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const busy = ["uploading", "starting", "processing"].includes(phase);
  const source = result ? `/api/jobs/${result}/file` : "/api/sample";
  const onReady = useCallback((url: string, splats: number) => {
    setDownload(url);
    setCount(splats);
  }, []);
  const onLoading = useCallback(() => {
    setDownload("");
    setCount(0);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setJob(saved);
        setPhase("starting");
      }
    } catch {
      setNotice(
        "Browser storage is unavailable. Keep this tab open until your model is ready.",
      );
    }
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!job) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let failures = 0;
    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${job}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (stopped) return;
        if (!response.ok) {
          if (response.status >= 500 || response.status === 429)
            throw new Error(body.error);
          setError(body.error || "This job is no longer available.");
          setPhase("failed");
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* The job can still finish without browser storage. */
          }
          return;
        }
        failures = 0;
        setNotice("");
        if (body.status === "succeeded") {
          setPhase("succeeded");
          setResult(job);
          return;
        }
        if (body.status === "failed") {
          setPhase("failed");
          setError(body.error);
          return;
        }
        setPhase(body.status === "processing" ? "processing" : "starting");
        timer = setTimeout(poll, 2500);
      } catch {
        if (stopped) return;
        failures++;
        setNotice(
          "Connection interrupted. Reconnecting to your existing job...",
        );
        timer = setTimeout(poll, Math.min(2000 * failures, 15_000));
      }
    }
    poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [job]);

  function choose(next?: File) {
    if (!next || busy) return;
    if (!["image/png", "image/jpeg"].includes(next.type)) {
      setError("Choose a PNG or JPEG image.");
      return;
    }
    if (next.size > 3 * 1024 * 1024) {
      setError("Choose an image smaller than 3 MB.");
      return;
    }
    setFile(next);
    setError("");
    setPhase("idle");
  }

  async function generate() {
    if (!file || busy || submitting.current) return;
    submitting.current = true;
    setError("");
    setNotice("");
    setPhase("uploading");
    setJob("");
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Your image could not be read."));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, requestId: crypto.randomUUID() }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Generation could not start.");
      setJob(body.token);
      setPhase("starting");
      try {
        localStorage.setItem(STORAGE_KEY, body.token);
      } catch {
        setNotice(
          "Keep this tab open. Your browser could not save this job for refresh recovery.",
        );
      }
    } catch (cause) {
      setPhase("failed");
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect. Check your connection before retrying.",
      );
    } finally {
      submitting.current = false;
    }
  }

  function sample() {
    setResult("");
    setJob("");
    setPhase("idle");
    setError("");
    setNotice("");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* The sample does not require persistence. */
    }
  }

  return (
    <main>
      <section className="workspace" aria-label="Image to 3D studio">
        <aside className="input-panel">
          <h1>Upload an image</h1>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            className="visually-hidden"
            aria-label="Upload an image"
            disabled={busy}
            onChange={(event) => {
              choose(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            className={`dropzone ${dragging ? "dragging" : ""} ${preview ? "has-preview" : ""}`}
            disabled={busy}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(event.dataTransfer.files[0]);
            }}
            aria-label={
              preview ? "Change uploaded image" : "Choose or drop an image"
            }
          >
            {preview ? (
              <>
                <img src={preview} alt="Your uploaded image" />
                <span className="change-image">
                  <Upload size={13} /> Change image
                </span>
              </>
            ) : (
              <>
                <span className="upload-illustration">
                  <ImagePlus size={31} strokeWidth={1.4} />
                </span>
                <strong>Drop an image here</strong>
                <span>
                  or <u>browse your files</u>
                </span>
                <small>PNG or JPG · Up to 3 MB</small>
              </>
            )}
          </button>
          {file && (
            <div className="file-row">
              <span>{file.name}</span>
              <button
                aria-label="Remove image"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setError("");
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <button
            className="button generate"
            disabled={!file || busy}
            onClick={generate}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Sparkles size={17} />
            )}
            {busy ? "Creating your model" : "Make it 3D"}
            {!busy && <ArrowRight size={17} />}
          </button>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice-box" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="progress-card" role="status">
              <div>
                <span className="status-dot" />
                {labels[phase]}
              </div>
              <div className="progress-track">
                <i />
              </div>
            </div>
          )}
          {result && (
            <button
              className="button sample-button"
              onClick={sample}
              disabled={busy}
            >
              Show sample dog
            </button>
          )}
        </aside>

        <div className="output-panel">
          <div className="output-heading">
            <h2>{result ? "Your model" : "Dog"}</h2>
            <span className="model-badge">
              <span />
              {result ? "YOUR CREATION" : "SAMPLE MODEL"}
            </span>
          </div>
          <div className="viewer-stage">
            <Viewer source={source} onReady={onReady} onLoading={onLoading} />
            <div className="viewer-caption">
              <MousePointer2 size={13} />
              <span>
                Drag to orbit <b>·</b> Scroll to zoom
              </span>
            </div>
          </div>
          <div className="output-footer">
            <div>
              <span>
                {count
                  ? `${count.toLocaleString()} Gaussian splats`
                  : "Loading model"}
              </span>
            </div>
            <a
              className={`button download ${download ? "" : "disabled"}`}
              href={download || undefined}
              download={result ? "snoopygs-model.ply" : "snoopygs-sample.ply"}
              aria-disabled={!download}
              tabIndex={download ? 0 : -1}
            >
              <ArrowDownToLine size={16} /> Download .ply
            </a>
          </div>
          {result && (
            <div className="expiry-note">
              <Check size={14} /> Download to keep your model. Results are
              temporary and are lost when the server restarts.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
