# Strde

A Max for Live device for Ableton Live 12 Suite. Click knobs anywhere in your set to map them,
press **Generate**, and Strde moves every mapped knob along its own evolving curve, in time
with the song.

- Up to **16 lanes**, from any track or device: Live's devices and your VST/AU plugins
- **6 generators**: Mix, Smooth, Steps, Chaos, Mirror, Shapes
- Curves from **1 to 32 bars**, looping, locked to the song's position
- **Lock** lanes you like, regenerate the rest
- Shape everything at once: Smooth, Depth, Curve, Floor, Ceiling
- Draw by hand; Flip, Reverse, 2x, 1/2x
- Lanes and curves **save with your Live set**

Personal-use device. Not for sharing or sale under this name.

---

## Install

You need two files from this folder, kept **side by side**:

| File | What it is |
|---|---|
| `Strde.amxd` | The device |
| `strde.js` | Its code. The device won't work without it next to it |

1. Make a folder, for example `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/Strde/`.
2. Copy `Strde.amxd` and `strde.js` into it.
3. In Live's browser, open **User Library** and find **Strde**.

### If Strde.amxd won't load

`Strde.amxd` is built by a script, not saved from Max. If Live refuses it, rebuild it by hand
from `Strde.maxpat` (2 minutes):

1. In Live's browser: **Max for Live → Max Audio Effect**. Drag it onto a track.
2. Click the device's **Edit** button. Max opens.
3. In Max, **File → Open** `Strde.maxpat`. Press **Cmd+A**, **Cmd+C**.
4. Go to the device editor window. Press **Cmd+A**, **Delete**, then **Cmd+V**.
5. Open the Patcher Inspector (**Cmd+Shift+I** with nothing selected) and tick **Open in Presentation**.
6. **File → Save As** `Strde.amxd` in the same folder as `strde.js`. Close Max.

---

## Use it

1. Drop **Strde** on any track. A good spot is right after the instrument whose knobs you'll move.
2. Click **Map** (it lights up).
3. Click the knobs you want to move, **in Live's device view**. Each one becomes a lane.
   - Live devices: click the knob.
   - VST/AU plugins: open the plugin's panel in Live's device view, click **Configure**,
     wiggle the knob in the plugin window so it appears in Live's panel, then click it there.
4. Click **Map** again to stop adding.
5. Press **Play** in Live. Every mapped knob moves.
6. Press **Generate** for a new set of curves. Repeat until you like it.

A mapped knob is greyed out in Live while Strde controls it. That's normal.

### The controls

| Control | What it does |
|---|---|
| **Map** | While on, every knob you click in Live is added as a lane |
| **Run** | Off releases all knobs so you can move them by hand. On takes control again |
| **Generate** | New curves on every lane that isn't locked |
| **Generator** | Which curve type Generate makes (see below) |
| **Bars** | Curve length, 1 to 32 bars. Changing it repeats or trims existing curves |
| **Smooth** | Rounds off sharp corners and steps |
| **Depth** | How far knobs move. 0% parks them in the middle of Floor–Ceiling |
| **Curve** | Pushes values up (positive) or down (negative) |
| **Floor / Ceiling** | Lowest and highest point of every knob's range, as % of its full range. Floor above Ceiling inverts the motion |
| **Flip** | Upside-down |
| **Reverse** | Backwards in time |
| **2x / 1/2x** | Twice as fast (repeats twice) / half as fast (first half stretched) |
| **Clear** | Removes all lanes |

Flip, Reverse, 2x and 1/2x change the **selected lane**. With no lane selected, they change
every unlocked lane.

### The lanes

Each row is one knob: `Device > Knob name`, then its curve. The white line is the playhead.

| Click | Does |
|---|---|
| **x** (far left) | Delete the lane |
| **o / L** | Lock / unlock. Locked lanes (L, yellow) are skipped by Generate and edits |
| Lane name | Select / deselect the lane |
| **Option + click** lane name | New curve for that lane only |
| Click or drag on the curve | Draw by hand |

### Generators

| Generator | Sound |
|---|---|
| **Mix** | Picks a random generator per lane. Good default |
| **Smooth** | Slow, flowing waves |
| **Steps** | Jumps between held values on 8th to 1-bar steps |
| **Chaos** | Restless wandering with sudden jumps |
| **Mirror** | A shape, then the same shape backwards |
| **Shapes** | Chains of ramps, triangles and swells |

---

## Good to know

- **Moves only while Live plays.** When stopped, knobs stay where they are.
- **Saving:** lanes, curves and locks save with your Live set. If you move or delete a mapped
  device, that lane shows **(missing)** in red and stops moving. Delete it and map again.
- **One controller per knob:** a knob mapped in Strde can't also follow its own automation.
  Turn **Run** off to free them.
- **Your own Strde knobs can't be mapped.**
- **16 lanes max.** Lanes get thin past about 10.
- **Device off** (Live's power button) freezes all knobs where they are.
- Drawing sets the raw curve. With Curve, Depth, Floor or Ceiling changed, the line shows
  the shaped result, so it won't sit exactly under your mouse.

## Troubleshooting

| Problem | Fix |
|---|---|
| Device loads but the big panel is empty or grey | `strde.js` isn't next to `Strde.amxd`. Put them in the same folder and reload |
| Clicking knobs adds nothing | Is **Map** lit? Click knobs in **Live's** device view, not inside a plugin's own window |
| A plugin's knob can't be clicked in Live | Use **Configure** on the plugin first (see Use it, step 3) |
| Knobs don't move | Is Live playing? Is **Run** on? Is the lane red **(missing)**? |
| Lanes gone after reopening the set | Tell me. Saving is the part least testable without Live |

Errors appear in the Max Console: click the device's **Edit** button, then **Window → Max Console**.
Send me a screenshot of it.

---

## How it works

- `live.thisdevice` signals when Live is ready. `strde.js` then watches Live's **selected
  parameter**, so clicking a knob while Map is on hands Strde that knob.
- A 20 ms clock reads the song position from Max's `transport`, which follows Live.
- Each lane's value is computed from its curve at that position, shaped, and scaled to the
  knob's own range.
- 16 `live.remote~` objects move the knobs. These don't write automation or fill Live's undo
  history. A 20 ms `line~` ramp between values keeps the motion smooth.
- Lanes and curves are stored as one text value in a hidden `pattr` parameter, which Live saves
  with the set.

## Files in this folder

| File | Purpose |
|---|---|
| `Strde.amxd` | The device (generated by `dev/build_device.py`) |
| `strde.js` | All device logic and the lane display |
| `Strde.maxpat` | Same patch as a plain Max file, for the manual rebuild |
| `dev/build_device.py` | Builds `Strde.amxd` and `Strde.maxpat` |
| `dev/test_strde.js` | Offline tests with fake Live/Max: `node dev/test_strde.js` |
| `CLAUDE.md` | Maintenance rules |
