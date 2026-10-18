# Upscaler — maintenance rules

README.md is the user's full usage guide. Keep it accurate.

Any change to `app.py`, `index.html` or `requirements.txt` must update README.md
in the same commit. Check these sections:

- New or changed UI control → "Using the web page", "Choosing settings", "Background removal"
- New CLI flag or default → "Command line" table and examples
- New env var or limit → "Configuration"
- New dependency or model download → "Requirements", "Install", the model table in "Start the app"
- Output naming change → "Output files"
- New error users can hit → "Troubleshooting"
- New endpoint or form field → "HTTP API"
- New file in this folder → "Files in this folder"

Retake `screenshot.png` / `screenshot-batch.png` when the page layout changes visibly.
Only state timings and limits that were measured or read from the code.
