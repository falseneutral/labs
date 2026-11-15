# Strde: maintenance rules

- `strde.js` runs in Max's classic JS engine: ES5 only (no let/const/arrow/template strings).
  Check: parse with acorn `ecmaVersion: 5`.
- Never hand-edit `Strde.amxd` or `Strde.maxpat`. Change `dev/build_device.py` and rerun it.
- `TICK_MS` in `strde.js` must match the metro interval in `dev/build_device.py`.
- Run `node dev/test_strde.js` after any change to `strde.js`.
- Any change to controls, behaviour or files must update README.md in the same commit.
- Nothing here has been tested inside Live by Claude. Only state behaviour the user confirmed
  or the code guarantees.
