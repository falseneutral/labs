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
Output scale 1 skips upscaling (background removal only).

## Background removal (for print)

| Option | Use for |
|---|---|
| Remove (AI) | Photos, any background. ISNet model, 170 MB, downloads on first use |
| Remove colour | Logos, scans, flat backgrounds. Pick colour + tolerance |

"Only from edges" keeps matching colour inside the subject (e.g. white in a logo).
Output is a transparent PNG (`*_transparent.png`).

## Batch (whole folder)

**Web page:** drop several images or a folder, or click "Choose a whole folder".
Images run one at a time with progress, each gets a Download link, then
"Download all (ZIP)" (subfolders kept). "Stop after this image" ends early.
Browser holds results in memory, so for hundreds of big images use the command line.

**Command line:** writes straight to disk, keeps subfolders, skips images already done.

```bash
python app.py --batch ~/Pictures/shoot                     # -> ~/Pictures/shoot_upscaled
python app.py --batch ~/Pictures/shoot --model photo-x2 --scale 2 --out ~/Desktop/big
python app.py --batch ./logos --scale 1 --bg color --bg-color "#ffffff"
python app.py --batch ./products --bg ai
```

Options: `--model`, `--scale`, `--bg none|ai|color`, `--bg-color`, `--tolerance`,
`--all-colour`, `--overwrite`. `python app.py --help` lists all.

## Settings (env vars)

- `PORT` (default 7860)
- `TILE` tile size in px (default 256; lower = less memory)
- `MAX_INPUT_PX` max input pixels (default 6000×6000)
- `DEVICE` force `cpu`, `mps` or `cuda`
- `WEIGHTS_DIR` where weights live

Uses NVIDIA GPU (CUDA) or Apple Silicon GPU (MPS) automatically. CPU works, slower.
