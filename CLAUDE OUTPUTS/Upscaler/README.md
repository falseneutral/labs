# Image Upscaler

Local web page for AI upscaling with Real-ESRGAN.

## Run

```bash
pip install -r requirements.txt
python app.py
```

Open http://localhost:7860. Model weights download to `weights/` on first use.

## Models

| Option | Use for |
|---|---|
| Photo x4 | Photos, general images |
| Photo x2 | Light enlargement, faster |
| Anime x4 | Illustrations, line art, anime |

Output scale 2/3/4: model runs at native scale, then resizes to target.

## Settings (env vars)

- `PORT` (default 7860)
- `TILE` tile size in px (default 256; lower = less memory)
- `MAX_INPUT_PX` max input pixels (default 6000×6000)
- `DEVICE` force `cpu`, `mps` or `cuda`
- `WEIGHTS_DIR` where weights live

Uses NVIDIA GPU (CUDA) or Apple Silicon GPU (MPS) automatically. CPU works, slower.
