"""Real-ESRGAN image upscaler with a drag-and-drop web page."""
import io
import os
import threading
import urllib.request
from pathlib import Path

import numpy as np
import torch
from flask import Flask, abort, request, send_file, send_from_directory
from PIL import Image
from spandrel import ModelLoader

BASE = Path(__file__).parent
WEIGHTS = Path(os.environ.get("WEIGHTS_DIR", BASE / "weights"))
RELEASES = "https://github.com/xinntao/Real-ESRGAN/releases/download"
MODELS = {
    "photo-x4": f"{RELEASES}/v0.1.0/RealESRGAN_x4plus.pth",
    "photo-x2": f"{RELEASES}/v0.2.1/RealESRGAN_x2plus.pth",
    "anime-x4": f"{RELEASES}/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
}
TILE = int(os.environ.get("TILE", 256))
PAD = 16
MAX_INPUT_PX = int(os.environ.get("MAX_INPUT_PX", 2048 * 2048))

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.set_num_threads(os.cpu_count() or 1)
_models, _lock = {}, threading.Lock()
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024


def load_model(name):
    with _lock:
        if name not in _models:
            url = MODELS[name]
            path = WEIGHTS / url.rsplit("/", 1)[1]
            if not path.exists():
                WEIGHTS.mkdir(parents=True, exist_ok=True)
                print(f"Downloading {path.name} ...", flush=True)
                urllib.request.urlretrieve(url, path)
            model = ModelLoader().load_from_file(str(path)).eval().to(device)
            if device.type == "cuda":
                model = model.half()
            _models[name] = model
        return _models[name]


@torch.inference_mode()
def upscale_rgb(model, rgb):
    """Run the model tile by tile so large images fit in memory."""
    scale = model.scale
    x = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).float().div(255).to(device)
    if device.type == "cuda":
        x = x.half()
    _, _, h, w = x.shape
    out = torch.zeros((1, 3, h * scale, w * scale), dtype=x.dtype, device=device)
    for y0 in range(0, h, TILE):
        for x0 in range(0, w, TILE):
            y1, x1 = min(y0 + TILE, h), min(x0 + TILE, w)
            py0, px0 = max(y0 - PAD, 0), max(x0 - PAD, 0)
            py1, px1 = min(y1 + PAD, h), min(x1 + PAD, w)
            tile = model(x[:, :, py0:py1, px0:px1])
            oy, ox = (y0 - py0) * scale, (x0 - px0) * scale
            out[:, :, y0 * scale:y1 * scale, x0 * scale:x1 * scale] = tile[
                :, :, oy:oy + (y1 - y0) * scale, ox:ox + (x1 - x0) * scale]
    out = out.clamp(0, 1).mul(255).round().byte().squeeze(0).permute(1, 2, 0)
    return out.cpu().numpy()


def upscale(img, model_name, outscale):
    model = load_model(model_name)
    alpha = img.getchannel("A") if img.mode in ("RGBA", "LA", "PA") else None
    rgb = np.asarray(img.convert("RGB"))
    result = Image.fromarray(upscale_rgb(model, rgb))
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
    result = upscale(img, model_name, outscale)
    buf = io.BytesIO()
    result.save(buf, "PNG")
    buf.seek(0)
    stem = Path(file.filename or "image").stem
    return send_file(buf, mimetype="image/png",
                     download_name=f"{stem}_x{outscale:g}.png")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    print(f"Upscaler on http://localhost:{port} ({device.type})", flush=True)
    app.run(host="0.0.0.0", port=port, threaded=True)
