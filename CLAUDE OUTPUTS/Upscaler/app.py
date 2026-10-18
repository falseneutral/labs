"""Real-ESRGAN image upscaler with background removal and a drag-and-drop web page."""
import argparse
import io
import logging
import os
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np
import torch
import onnxruntime as ort
from flask import Flask, abort, request, send_file, send_from_directory
from PIL import Image, ImageColor, ImageFilter
from scipy import ndimage
from spandrel import ModelLoader

BASE = Path(__file__).parent
WEIGHTS = Path(os.environ.get("WEIGHTS_DIR", BASE / "weights"))
RELEASES = "https://github.com/xinntao/Real-ESRGAN/releases/download"
MODELS = {
    "photo-x4": f"{RELEASES}/v0.1.0/RealESRGAN_x4plus.pth",
    "photo-x2": f"{RELEASES}/v0.2.1/RealESRGAN_x2plus.pth",
    "anime-x4": f"{RELEASES}/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
}
BG_MODEL = ("https://github.com/danielgatis/rembg/releases/download/v0.0.0/"
            "isnet-general-use.onnx")
TILE = int(os.environ.get("TILE", 256))
PAD = 16
MAX_INPUT_PX = int(os.environ.get("MAX_INPUT_PX", 6000 * 6000))

def pick_device():
    if os.environ.get("DEVICE"):
        return torch.device(os.environ["DEVICE"])
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


device = pick_device()
torch.set_num_threads(os.cpu_count() or 1)
_models, _lock = {}, threading.Lock()
_progress = {}
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
logging.getLogger("werkzeug").setLevel(logging.WARNING)


def fetch_weights(url):
    path = WEIGHTS / url.rsplit("/", 1)[1]
    if not path.exists():
        WEIGHTS.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {path.name} ...", flush=True)
        urllib.request.urlretrieve(url, path)
    return path


def load_model(name):
    with _lock:
        if name not in _models:
            path = fetch_weights(MODELS[name])
            model = ModelLoader().load_from_file(str(path)).eval().to(device)
            if device.type == "cuda":
                model = model.half()
            _models[name] = model
        return _models[name]


def ai_mask(img):
    """Foreground mask from the ISNet background-removal model."""
    with _lock:
        if "bg" not in _models:
            _models["bg"] = ort.InferenceSession(
                str(fetch_weights(BG_MODEL)), providers=["CPUExecutionProvider"])
        session = _models["bg"]
    x = np.asarray(img.convert("RGB").resize((1024, 1024), Image.LANCZOS), np.float32)
    x = x / max(x.max(), 1e-6) - np.array([0.485, 0.456, 0.406], np.float32)
    x = x.transpose(2, 0, 1)[None]
    pred = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
    pred = (pred - pred.min()) / max(pred.max() - pred.min(), 1e-6)
    mask = Image.fromarray((pred * 255).astype(np.uint8), "L")
    return mask.resize(img.size, Image.LANCZOS)


def color_mask(img, color, tolerance, edges_only):
    """Mask out pixels close to `color`; optionally only regions touching the border."""
    rgb = np.asarray(img.convert("RGB"), np.float32)
    dist = np.linalg.norm(rgb - np.array(color, np.float32), axis=2) / np.sqrt(3 * 255 ** 2)
    tol = tolerance / 100
    feather = max(tol * 0.5, 0.02)
    # 0 = background colour, 1 = keep; soft ramp between tol and tol + feather.
    alpha = np.clip((dist - tol) / feather, 0, 1)
    if edges_only:
        labels, _ = ndimage.label(alpha < 1)
        border = np.unique(np.concatenate(
            [labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
        bg = np.isin(labels, border[border > 0])
        alpha = np.where(bg, alpha, 1)
    mask = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    # Slight blur hides the stair-stepping on hard edges.
    return mask.filter(ImageFilter.GaussianBlur(0.6))


def remove_background(img, form):
    mode = form.get("bg", "none")
    if mode == "ai":
        mask = ai_mask(img)
    elif mode == "color":
        try:
            color = ImageColor.getrgb(form.get("bg_color", "#ffffff"))[:3]
            tolerance = float(form.get("tolerance", 10))
        except ValueError:
            abort(400, "Bad colour or tolerance.")
        mask = color_mask(img, color, tolerance, form.get("edges_only") == "1")
    else:
        return img
    if img.mode in ("RGBA", "LA", "PA"):
        mask = Image.fromarray(np.minimum(np.asarray(mask), np.asarray(img.getchannel("A"))))
    img = img.convert("RGB")
    img.putalpha(mask)
    return img


@torch.inference_mode()
def upscale_rgb(model, rgb, job=None):
    """Run the model tile by tile so large images fit in memory."""
    scale = model.scale
    x = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).float().div(255).to(device)
    if device.type == "cuda":
        x = x.half()
    _, _, h, w = x.shape
    # Assemble on CPU as uint8 so huge outputs don't exhaust GPU memory.
    out = torch.zeros((3, h * scale, w * scale), dtype=torch.uint8)
    total = -(-h // TILE) * -(-w // TILE)
    done, start = 0, time.time()
    for y0 in range(0, h, TILE):
        for x0 in range(0, w, TILE):
            y1, x1 = min(y0 + TILE, h), min(x0 + TILE, w)
            py0, px0 = max(y0 - PAD, 0), max(x0 - PAD, 0)
            py1, px1 = min(y1 + PAD, h), min(x1 + PAD, w)
            tile = model(x[:, :, py0:py1, px0:px1])
            oy, ox = (y0 - py0) * scale, (x0 - px0) * scale
            tile = tile[0, :, oy:oy + (y1 - y0) * scale, ox:ox + (x1 - x0) * scale]
            out[:, y0 * scale:y1 * scale, x0 * scale:x1 * scale] = (
                tile.clamp(0, 1).mul(255).round().byte().cpu())
            done += 1
            eta = (time.time() - start) / done * (total - done)
            if job:
                _progress[job] = {"done": done, "total": total, "eta": round(eta)}
            print(f"\r  tile {done}/{total} · ~{eta:.0f}s left   ", end="", flush=True)
    print()
    return out.permute(1, 2, 0).numpy()


def upscale(img, model_name, outscale, job=None):
    if outscale == 1:
        return img
    if job and model_name not in _models:
        _progress[job] = {"stage": "loading model"}
    model = load_model(model_name)
    alpha = img.getchannel("A") if img.mode in ("RGBA", "LA", "PA") else None
    rgb = np.array(img.convert("RGB"))
    result = Image.fromarray(upscale_rgb(model, rgb, job))
    target = (round(img.width * outscale), round(img.height * outscale))
    if result.size != target:
        result = result.resize(target, Image.LANCZOS)
    if alpha is not None:
        result.putalpha(alpha.resize(target, Image.LANCZOS))
    return result


@app.get("/")
def index():
    return send_from_directory(BASE, "index.html")


@app.get("/api/info")
def info():
    return {"device": device.type, "models": list(MODELS)}


@app.get("/api/progress/<job>")
def progress(job):
    return _progress.get(job, {})


@app.post("/api/upscale")
def api_upscale():
    file = request.files.get("image")
    model_name = request.form.get("model", "photo-x4")
    if not file or model_name not in MODELS:
        abort(400, "Need an image and a valid model.")
    try:
        outscale = float(request.form.get("scale", 4))
    except ValueError:
        abort(400, "Bad scale.")
    if not 1 <= outscale <= 8:
        abort(400, "Scale must be between 1 and 8.")
    try:
        img = Image.open(file.stream)
        img.load()
    except Exception:
        abort(400, "Could not read image.")
    if img.width * img.height > MAX_INPUT_PX:
        abort(413, f"Image too large (max {MAX_INPUT_PX:,} pixels).")
    job = request.form.get("job")
    print(f"Upscaling {file.filename} {img.width}x{img.height} "
          f"with {model_name} to x{outscale:g}", flush=True)
    try:
        if request.form.get("bg", "none") != "none":
            if job:
                _progress[job] = {"stage": "removing background"}
            print("  removing background ...", flush=True)
            img = remove_background(img, request.form)
        result = upscale(img, model_name, outscale, job)
    finally:
        _progress.pop(job, None)
    buf = io.BytesIO()
    result.save(buf, "PNG")
    buf.seek(0)
    stem = Path(file.filename or "image").stem
    suffix = "_transparent" if request.form.get("bg", "none") != "none" else ""
    return send_file(buf, mimetype="image/png",
                     download_name=f"{stem}_x{outscale:g}{suffix}.png")


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}


def run_batch(args):
    """Upscale every image under args.batch into args.out, keeping subfolders."""
    src = Path(args.batch).expanduser().resolve()
    out = Path(args.out).expanduser().resolve() if args.out else src.with_name(src.name + "_upscaled")
    images = sorted(p for p in src.rglob("*")
                    if p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
                    and out not in p.parents)
    if not images:
        raise SystemExit(f"No images found in {src}")
    form = {"bg": args.bg, "bg_color": args.bg_color, "tolerance": args.tolerance,
            "edges_only": "0" if args.all_colour else "1"}
    suffix = "_transparent" if args.bg != "none" else ""
    print(f"{len(images)} images · {args.model} · x{args.scale:g} · background: {args.bg}")
    print(f"Output: {out}")
    start, failed, skipped = time.time(), 0, 0
    for i, path in enumerate(images, 1):
        dest = out / path.relative_to(src).parent / f"{path.stem}_x{args.scale:g}{suffix}.png"
        if dest.exists() and not args.overwrite:
            print(f"[{i}/{len(images)}] skip (exists) {path.relative_to(src)}")
            skipped += 1
            continue
        print(f"[{i}/{len(images)}] {path.relative_to(src)}", flush=True)
        try:
            img = Image.open(path)
            img.load()
            if args.bg != "none":
                img = remove_background(img, form)
            result = upscale(img, args.model, args.scale)
            dest.parent.mkdir(parents=True, exist_ok=True)
            result.save(dest, "PNG")
        except Exception as e:
            failed += 1
            print(f"  failed: {e}")
    done = len(images) - failed - skipped
    print(f"Done in {time.time() - start:.0f}s · {done} upscaled · {skipped} skipped · {failed} failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real-ESRGAN upscaler. No arguments starts the web page.")
    parser.add_argument("--batch", metavar="FOLDER", help="upscale every image in FOLDER (and subfolders)")
    parser.add_argument("--out", metavar="FOLDER", help="output folder (default: FOLDER_upscaled)")
    parser.add_argument("--model", choices=list(MODELS), default="photo-x4")
    parser.add_argument("--scale", type=float, default=4, help="output scale 1-8 (default 4)")
    parser.add_argument("--bg", choices=["none", "ai", "color"], default="none",
                        help="remove background (default none)")
    parser.add_argument("--bg-color", default="#ffffff", help="colour to remove with --bg color")
    parser.add_argument("--tolerance", type=float, default=10, help="colour tolerance 0-60")
    parser.add_argument("--all-colour", action="store_true",
                        help="remove the colour everywhere, not just from the edges")
    parser.add_argument("--overwrite", action="store_true", help="redo images already in the output folder")
    args = parser.parse_args()
    if args.batch:
        if not 1 <= args.scale <= 8:
            parser.error("--scale must be between 1 and 8")
        run_batch(args)
    else:
        port = int(os.environ.get("PORT", 7860))
        print(f"Upscaler on http://localhost:{port} ({device.type})", flush=True)
        app.run(host="0.0.0.0", port=port, threaded=True)
