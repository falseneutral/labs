#!/usr/bin/env python3
"""Builds Strde.amxd (Max for Live audio effect) and Strde.maxpat from code.

Run from anywhere:  python3 dev/build_device.py
Writes both files into the Strde folder (the parent of dev/).
"""
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
LANES = 16
TICK_MS = 20          # keep in sync with TICK_MS in strde.js
DEVICE_W = 900

boxes, lines = [], []
_n = [0]


def obj(maxclass, rect, text=None, inlets=1, outlets=0, pres=None, **attrs):
    _n[0] += 1
    oid = "obj-%d" % _n[0]
    b = {"id": oid, "maxclass": maxclass, "numinlets": inlets, "numoutlets": outlets,
         "patching_rect": list(rect)}
    if text is not None:
        b["text"] = text
    if pres is not None:
        b["presentation"] = 1
        b["presentation_rect"] = list(pres)
    b.update(attrs)
    boxes.append({"box": b})
    return oid


def wire(src, dst, so=0, di=0):
    lines.append({"patchline": {"source": [src, so], "destination": [dst, di]}})


def param(longname, ptype, shortname=None, **extra):
    v = {"parameter_longname": longname, "parameter_shortname": shortname or longname,
         "parameter_type": ptype}
    v.update(extra)
    return {"valueof": v}


def newobj(text, rect, inlets=1, outlets=1, **attrs):
    return obj("newobj", rect, text=text, inlets=inlets, outlets=outlets, **attrs)


# ------------------------------------------------------------- core objects
ui = obj("jsui", [460, 40, 640, 158], inlets=1, outlets=3, pres=[244, 4, 652, 160],
         filename="strde.js", parameter_enable=0, border=0)

plugin = newobj("plugin~", [20, 20, 60, 22], inlets=2, outlets=2)
plugout = newobj("plugout~", [20, 60, 60, 22], inlets=2, outlets=0)
wire(plugin, plugout, 0, 0)
wire(plugin, plugout, 1, 1)

thisdev = newobj("live.thisdevice", [20, 110, 100, 22], inlets=1, outlets=3)
initmsg = obj("message", [20, 140, 40, 22], text="init", inlets=2, outlets=1)
wire(thisdev, initmsg)
wire(initmsg, ui)

metro = newobj("metro %d @active 1" % TICK_MS, [140, 110, 120, 22], inlets=2, outlets=1)
transport = newobj("transport", [140, 140, 100, 22], inlets=2, outlets=9)
pack = newobj("pack 0 0 0.", [140, 170, 90, 22], inlets=3, outlets=1)
prepos = newobj("prepend pos", [140, 200, 80, 22])
wire(metro, transport)
for i in range(3):
    wire(transport, pack, i, i)
wire(pack, prepos)
wire(prepos, ui)

pattr = newobj("pattr strde_state @parameter_enable 1", [300, 250, 220, 22], inlets=1, outlets=3,
               parameter_enable=1, varname="strde_state",
               saved_attribute_attributes=param("strde_state", 3, parameter_invisible=1))
prerestore = newobj("prepend restore", [300, 280, 100, 22])
wire(ui, pattr, 2, 0)
wire(pattr, prerestore, 0, 0)
wire(prerestore, ui)

routes = " ".join(str(i) for i in range(LANES))
routev = newobj("route " + routes, [460, 260, 400, 22], inlets=2, outlets=LANES + 1)
routeb = newobj("route " + routes, [460, 300, 400, 22], inlets=2, outlets=LANES + 1)
wire(ui, routev, 0, 0)
wire(ui, routeb, 1, 0)
for i in range(LANES):
    x = 460 + i * 70
    line = newobj("line~", [x, 340, 40, 22], inlets=2, outlets=2)
    pid = newobj("prepend id", [x, 370, 66, 22])
    rem = newobj("live.remote~", [x, 400, 70, 22], inlets=2, outlets=0)
    wire(routev, line, i, 0)
    wire(line, rem, 0, 0)
    wire(routeb, pid, i, 0)
    wire(pid, rem, 0, 1)

# ------------------------------------------------------------- controls
HIDDEN = 2      # parameter_invisible: 0 automatable, 1 stored only, 2 hidden
STORED = 1
ctl = [0]


def control(maxclass, msg, pres, longname, valueof, outlets=2, **attrs):
    x, y = 20 + (ctl[0] % 8) * 120, 500 + (ctl[0] // 8) * 110
    ctl[0] += 1
    c = obj(maxclass, [x, y, pres[2], pres[3]], inlets=1,
            outlets=outlets, pres=pres, parameter_enable=1, varname=longname,
            saved_attribute_attributes={"valueof": valueof}, **attrs)
    p = newobj("prepend " + msg, [x, y + 70, 90, 22])
    wire(c, p, 0, 0)
    wire(p, ui)
    return c


def vo(longname, ptype, short=None, **extra):
    return param(longname, ptype, short, **extra)["valueof"]


def text_button(msg, label, pres, longname):
    return control("live.text", msg, pres, longname,
                   vo(longname, 2, label, parameter_enum=["off", "on"], parameter_mmax=1,
                      parameter_invisible=HIDDEN),
                   text=label, texton=label, mode=0)


def text_toggle(msg, label, pres, longname, initial, invisible):
    return control("live.text", msg, pres, longname,
                   vo(longname, 2, label, parameter_enum=["off", "on"], parameter_mmax=1,
                      parameter_initial=[initial], parameter_initial_enable=1,
                      parameter_invisible=invisible),
                   text=label, texton=label, mode=1)


text_toggle("map", "Map", [4, 4, 56, 18], "Strde Map", 0, HIDDEN)
text_toggle("run", "Run", [64, 4, 56, 18], "Strde Run", 1, STORED)
text_button("generate", "Generate", [124, 4, 112, 18], "Strde Generate")

control("live.menu", "gen", [4, 27, 116, 18], "Strde Generator",
        vo("Strde Generator", 2, "Generator",
           parameter_enum=["Mix", "Smooth", "Steps", "Chaos", "Mirror", "Shapes"],
           parameter_mmax=5, parameter_initial=[0], parameter_initial_enable=1),
        outlets=3)
control("live.numbox", "bars", [124, 27, 48, 18], "Strde Bars",
        vo("Strde Bars", 1, "Bars", parameter_mmin=1, parameter_mmax=32,
           parameter_initial=[8], parameter_initial_enable=1, parameter_unitstyle=0))
obj("comment", [700, 20, 40, 20], text="bars", inlets=1, outlets=0, pres=[174, 27, 40, 18])

dials = [("smooth", "Smooth", 0, 100, 0), ("depth", "Depth", 0, 100, 100),
         ("curve", "Curve", -100, 100, 0), ("floor", "Floor", 0, 100, 0),
         ("ceiling", "Ceiling", 0, 100, 100)]
for k, (msg, label, lo, hi, init) in enumerate(dials):
    control("live.dial", msg, [4 + k * 47, 50, 44, 48], "Strde " + label,
            vo("Strde " + label, 0, label, parameter_mmin=float(lo), parameter_mmax=float(hi),
               parameter_initial=[float(init)], parameter_initial_enable=1,
               parameter_unitstyle=5))

text_button("flip", "Flip", [4, 104, 56, 18], "Strde Flip")
text_button("reverse", "Reverse", [62, 104, 56, 18], "Strde Reverse")
text_button("faster", "2x", [120, 104, 56, 18], "Strde 2x")
text_button("slower", "1/2x", [178, 104, 58, 18], "Strde Half")
text_button("clear", "Clear", [4, 127, 56, 18], "Strde Clear")
obj("comment", [700, 60, 180, 40], text="Opt-click a lane name: new curve for that lane",
    inlets=1, outlets=0, pres=[64, 125, 176, 34], fontsize=9.0, linecount=2)

patch = {
    "patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 0, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [80, 80, 1600, 800],
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontface": 0,
        "default_fontname": "Arial Bold",
        "gridonopen": 1,
        "gridsize": [8.0, 8.0],
        "gridsnaponopen": 1,
        "objectsnaponopen": 1,
        "statusbarvisible": 2,
        "toolbarvisible": 1,
        "boxanimatetime": 500,
        "enablehscroll": 1,
        "enablevscroll": 1,
        "devicewidth": float(DEVICE_W),
        "description": "Strde: map knobs, generate evolving automation curves, move them in time.",
        "digest": "",
        "tags": "",
        "style": "",
        "subpatcher_template": "",
        "assistshowspatchername": 0,
        "boxes": boxes,
        "lines": lines,
        "dependency_cache": [{"name": "strde.js", "bootpath": ".", "type": "TEXT", "implicit": 1}],
        "latency": 0,
        "is_mpe": 0,
        "minimum_live_version": "",
        "minimum_max_version": "",
        "platform_compatibility": 0,
        "autosave": 0,
    }
}

text = json.dumps(patch, indent=1)
with open(os.path.join(OUT, "Strde.maxpat"), "w") as f:
    f.write(text)

# .amxd = small binary header + patcher JSON. 'aaaa' marks an audio effect.
body = text.encode("utf-8") + b"\n\x00"
header = (b"ampf" + struct.pack("<I", 4) + b"aaaa" +
          b"meta" + struct.pack("<I", 4) + b"\x00\x00\x00\x00" +
          b"ptch" + struct.pack("<I", len(body)))
with open(os.path.join(OUT, "Strde.amxd"), "wb") as f:
    f.write(header + body)

print("wrote Strde.amxd and Strde.maxpat: %d boxes, %d lines" % (len(boxes), len(lines)))
