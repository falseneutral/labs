// Strde: automation lane generator for Ableton Live (Max for Live, jsui).
// Map knobs by clicking them in Live, generate evolving curves, and Strde moves
// every mapped knob in time with the song.
//
// Written for Max's classic JavaScript engine (ES5): no let/const/arrow functions.

autowatch = 1;
inlets = 1;
outlets = 3;
setinletassist(0, "control messages");
setoutletassist(0, "lane value ramp-ms (to line~ / live.remote~)");
setoutletassist(1, "lane parameter-id (to live.remote~ id inlet)");
setoutletassist(2, "set <state> (to pattr, saved with the Live set)");

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

// ---------------------------------------------------------------- constants
var MAX_LANES = 16;
var PPB = 32;            // curve points per bar (32nd notes in 4/4)
var TICK_MS = 20;        // must match the metro interval in the patch
var HEADER = 15;         // header strip height (px)
var LABEL_W = 120;       // lane label column width (px)
var GEN_NAMES = ["Mix", "Smooth", "Steps", "Chaos", "Mirror", "Shapes"];
var COLORS = [
    [0.33, 0.80, 0.75], [0.62, 0.85, 0.35], [0.66, 0.55, 0.95], [0.98, 0.50, 0.45],
    [0.40, 0.65, 0.98], [0.95, 0.78, 0.30], [0.90, 0.45, 0.80], [0.55, 0.90, 0.60]
];

// ---------------------------------------------------------------- state
var lanes = [];
var settings = { bars: 8, gen: 0, smooth: 0, depth: 100, curve: 0, floor: 0, ceiling: 100 };
var mapOn = false;
var runOn = true;
var apiReady = false;
var selObs = null;
var sigObs = null;
var thisDevicePath = "";
var ignoreSelId = -1;
var beatsPerBar = 4;
var posPts = 0;
var selected = -1;
var pendingRestore = null;
var pendingAdds = [];
var statusText = "";
var lastPaint = 0;
var drawState = null;

var saveTask = new Task(doSave, this);
var addTask = new Task(flushAdds, this);

// ---------------------------------------------------------------- helpers
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function num(v) { var x = parseFloat([].concat(v)[0]); return isNaN(x) ? 0 : x; }
function str(v) { return [].concat(v).join(" "); }
function laneLen() { return settings.bars * PPB; }
function setStatus(s) { statusText = s; redraw(); }
function redraw() { mgraphics.redraw(); }

// ---------------------------------------------------------------- generators
// Each returns { pts: [n values 0..1], hold: bool }. Curves loop seamlessly
// where the maths allows (n is always a multiple of 32).

function valueNoise(n, k) {
    var m = Math.ceil(n / k) + 1, c = [], out = [], i;
    for (i = 0; i < m; i++) c.push(Math.random());
    if (n % k === 0) c[m - 1] = c[0];
    for (i = 0; i < n; i++) {
        var p = i / k, j = Math.floor(p), f = p - j;
        var t = (1 - Math.cos(f * Math.PI)) / 2;
        out.push(c[j] * (1 - t) + c[j + 1] * t);
    }
    return out;
}

function genSmooth(n) {
    var k = pick([4, 8, 16, 32]);
    var coarse = valueNoise(n, k);
    var fine = valueNoise(n, Math.max(2, k / 4));
    var mix = rnd(0, 0.35), out = [], i;
    for (i = 0; i < n; i++) out.push(clamp01(coarse[i] * (1 - mix) + fine[i] * mix));
    return { pts: out, hold: false };
}

function genSteps(n) {
    var lens = pick([[4, 8], [8, 16], [4, 8, 16], [8, 16, 32]]);
    var out = [], i = 0, v = Math.random();
    while (i < n) {
        var L = pick(lens);
        if (Math.random() < 0.85) v = Math.random();
        for (var j = 0; j < L && i < n; j++, i++) out.push(v);
    }
    return { pts: out, hold: true };
}

function genChaos(n) {
    var out = [], v = Math.random(), vel = 0, i;
    var jumpP = rnd(0.01, 0.06), rough = rnd(0.02, 0.12);
    for (i = 0; i < n; i++) {
        if (Math.random() < jumpP) {
            v = Math.random();
        } else {
            vel = vel * 0.7 + rnd(-rough, rough);
            v += vel;
            if (v < 0) { v = -v; vel = -vel; }
            if (v > 1) { v = 2 - v; vel = -vel; }
        }
        out.push(clamp01(v));
    }
    var fade = Math.min(8, n >> 2);
    for (i = 0; i < fade; i++) {
        var t = (i + 1) / (fade + 1), idx = n - fade + i;
        out[idx] = out[idx] * (1 - t) + out[0] * t;
    }
    return { pts: out, hold: false };
}

function genMirror(n) {
    var half = Math.floor(n / 2);
    var base = (Math.random() < 0.5 ? genSmooth(half) : genChaos(half)).pts;
    var out = base.concat(base.slice().reverse());
    while (out.length < n) out.push(out[out.length - 1]);
    return { pts: out, hold: false };
}

function genShapes(n) {
    var out = [], i = 0;
    var shapes = ["up", "down", "tri", "sine", "flat"];
    while (i < n) {
        var L = pick([8, 16, 32, 64]), s = pick(shapes);
        var lo = rnd(0, 0.5), hi = rnd(0.5, 1);
        for (var j = 0; j < L && i < n; j++, i++) {
            var f = j / L, v;
            if (s === "up") v = f;
            else if (s === "down") v = 1 - f;
            else if (s === "tri") v = f < 0.5 ? f * 2 : 2 - f * 2;
            else if (s === "sine") v = 0.5 - 0.5 * Math.cos(f * 2 * Math.PI);
            else v = 0.5;
            out.push(lo + (hi - lo) * v);
        }
    }
    return { pts: out, hold: false };
}

var GENERATORS = [null, genSmooth, genSteps, genChaos, genMirror, genShapes];

function generateLane(l) {
    var g = settings.gen;
    if (g < 1 || g >= GENERATORS.length) g = 1 + Math.floor(Math.random() * (GENERATORS.length - 1));
    var r = GENERATORS[g](laneLen());
    l.pts = r.pts;
    l.hold = r.hold;
    rebuildCache(l);
}

// ---------------------------------------------------------------- shaping
function rebuildCache(l) {
    var a = l.pts, n = a.length, w = Math.round(settings.smooth / 100 * 16), i;
    if (w < 1 || n === 0) { l.cache = a.slice(); return; }
    if (2 * w + 1 > n) w = (n - 1) >> 1;
    var out = new Array(n), sum = 0;
    for (i = -w; i <= w; i++) sum += a[((i % n) + n) % n];
    for (i = 0; i < n; i++) {
        out[i] = sum / (2 * w + 1);
        sum += a[(i + w + 1) % n] - a[(((i - w) % n) + n) % n];
    }
    l.cache = out;
}

function rebuildAll() { for (var i = 0; i < lanes.length; i++) rebuildCache(lanes[i]); }

function rawAt(l, p) {
    var a = l.cache, n = a.length;
    if (!n) return 0.5;
    p = ((p % n) + n) % n;
    var i = Math.floor(p), f = p - i;
    if (l.hold && settings.smooth <= 0) return a[i];
    return a[i] * (1 - f) + a[(i + 1) % n] * f;
}

function shape(v) {
    var c = settings.curve / 100;
    if (c !== 0) v = Math.pow(clamp01(v), Math.pow(4, -c));
    v = 0.5 + (v - 0.5) * (settings.depth / 100);
    var lo = settings.floor / 100, hi = settings.ceiling / 100;
    return clamp01(lo + (hi - lo) * v);
}

function nativeVal(l, v) {
    var x = l.min + (l.max - l.min) * v;
    return l.quant ? Math.round(x) : x;
}

// ---------------------------------------------------------------- output
function output(force) {
    if (!runOn) return;
    for (var i = 0; i < lanes.length; i++) {
        var l = lanes[i];
        if (l.missing || !l.id) continue;
        var v = shape(rawAt(l, posPts));
        if (force || Math.abs(v - l.last) > 0.0005) {
            l.last = v;
            outlet(0, i, nativeVal(l, v), TICK_MS);
        }
    }
}

function bindLane(i) {
    var l = lanes[i];
    if (!runOn || l.missing || !l.id) { outlet(1, i, 0); return; }
    var v = shape(rawAt(l, posPts));
    l.last = v;
    outlet(0, i, nativeVal(l, v), 0);
    outlet(1, i, l.id);
}

function rebindAll() {
    var i;
    for (i = 0; i < MAX_LANES; i++) outlet(1, i, 0);
    for (i = 0; i < lanes.length; i++) bindLane(i);
}

// ---------------------------------------------------------------- Live API
function init() {
    if (apiReady) return;
    var me = new LiveAPI("this_device");
    thisDevicePath = me.unquotedpath;
    selObs = new LiveAPI(onSelected, "live_set view");
    selObs.property = "selected_parameter";
    sigObs = new LiveAPI(onSig, "live_set");
    sigObs.property = "signature_numerator";
    apiReady = true;
    if (pendingRestore !== null) {
        applyRestore(pendingRestore);
        pendingRestore = null;
    } else {
        rebindAll();
    }
    redraw();
}

function onSig(args) {
    if (args && args[0] === "signature_numerator") {
        var n = parseInt(args[1], 10);
        if (n > 0) beatsPerBar = n;
    }
}

function idFromArgs(args) {
    if (!args) return 0;
    for (var k = 0; k < args.length - 1; k++) {
        if (args[k] === "id") return parseInt(args[k + 1], 10) || 0;
    }
    return 0;
}

function onSelected(args) {
    if (!mapOn) return;
    var id = idFromArgs(args);
    if (!id || id === ignoreSelId) return;
    ignoreSelId = id;
    pendingAdds.push(id);
    addTask.schedule(0);   // leave the notification before touching Live
}

function flushAdds() {
    while (pendingAdds.length) addLane(pendingAdds.shift());
}

function deviceName(paramPath) {
    var t = paramPath.split(" ");
    if (t.length < 3) return "?";
    var d = new LiveAPI(t.slice(0, t.length - 2).join(" "));
    return d.id == 0 ? "?" : str(d.get("name"));
}

function readParam(l) {
    var p = new LiveAPI(l.path);
    if (!p || p.id == 0) return false;
    var name = str(p.get("name"));
    if (l.name && name !== l.name) return false;
    l.id = parseInt(p.id, 10);
    l.name = name;
    l.min = num(p.get("min"));
    l.max = num(p.get("max"));
    l.quant = num(p.get("is_quantized")) === 1;
    return true;
}

function addLane(id) {
    var i;
    if (lanes.length >= MAX_LANES) { setStatus("All 16 lanes used"); return; }
    for (i = 0; i < lanes.length; i++) {
        if (lanes[i].id === id) { setStatus("Already mapped: " + lanes[i].name); return; }
    }
    var p = new LiveAPI("id " + id);
    if (!p || p.id == 0) return;
    var path = p.unquotedpath;
    if (thisDevicePath && path.indexOf(thisDevicePath + " ") === 0) {
        setStatus("Strde's own controls can't be mapped");
        return;
    }
    var l = { id: 0, path: path, name: "", dev: deviceName(path), min: 0, max: 1, quant: false,
              locked: false, hold: false, pts: [], cache: [], last: -1, missing: false };
    if (!readParam(l)) return;
    generateLane(l);
    lanes.push(l);
    bindLane(lanes.length - 1);
    setStatus("Mapped " + l.dev + " > " + l.name);
    scheduleSave();
}

function removeLane(i) {
    lanes.splice(i, 1);
    if (selected === i) selected = -1;
    else if (selected > i) selected--;
    rebindAll();
    scheduleSave();
}

// ---------------------------------------------------------------- persistence
function hex2(v) { var q = Math.round(clamp01(v) * 255); return (q < 16 ? "0" : "") + q.toString(16); }

function encodeState() {
    var parts = ["S1"];
    for (var i = 0; i < lanes.length; i++) {
        var l = lanes[i], h = "";
        for (var j = 0; j < l.pts.length; j++) h += hex2(l.pts[j]);
        parts.push([encodeURIComponent(l.path), encodeURIComponent(l.name), encodeURIComponent(l.dev),
                    l.locked ? 1 : 0, l.hold ? 1 : 0, h].join("~"));
    }
    return parts.join("|");
}

function decodeState(s) {
    var parts = String(s).split("|"), out = [];
    if (parts[0] !== "S1") return null;
    for (var i = 1; i < parts.length; i++) {
        var f = parts[i].split("~");
        if (f.length < 6) continue;
        var pts = [];
        for (var j = 0; j + 1 < f[5].length; j += 2) pts.push(parseInt(f[5].substr(j, 2), 16) / 255);
        if (!pts.length) continue;
        out.push({ id: 0, path: decodeURIComponent(f[0]), name: decodeURIComponent(f[1]),
                   dev: decodeURIComponent(f[2]), min: 0, max: 1, quant: false,
                   locked: f[3] === "1", hold: f[4] === "1", pts: pts, cache: [], last: -1, missing: false });
    }
    return out;
}

function doSave() { outlet(2, "set", encodeState()); }
function scheduleSave() { saveTask.cancel(); saveTask.schedule(300); }

function restore(s) {
    if (s === undefined || s === 0 || s === "0" || s === "") return;
    if (!apiReady) { pendingRestore = s; return; }
    applyRestore(s);
}

function applyRestore(s) {
    var ls = decodeState(s);
    if (!ls) return;
    var missing = 0;
    for (var i = 0; i < ls.length; i++) {
        if (!readParam(ls[i])) { ls[i].missing = true; missing++; }
        resizeLane(ls[i], laneLen());
        rebuildCache(ls[i]);
    }
    lanes = ls.slice(0, MAX_LANES);
    selected = -1;
    rebindAll();
    setStatus(missing ? missing + " lane(s) lost their knob: delete and re-map" : "");
}

// ---------------------------------------------------------------- edits
function resizeLane(l, n) {
    var o = l.pts, m = o.length, out = [], i;
    if (m === n || m === 0) return;
    for (i = 0; i < n; i++) out.push(o[i % m]);
    l.pts = out;
    rebuildCache(l);
}

function targets() {
    if (selected >= 0 && selected < lanes.length) return [lanes[selected]];
    var t = [];
    for (var i = 0; i < lanes.length; i++) if (!lanes[i].locked) t.push(lanes[i]);
    return t;
}

function applyEdit(fn) {
    var t = targets();
    for (var i = 0; i < t.length; i++) { t[i].pts = fn(t[i].pts); rebuildCache(t[i]); }
    output(true);
    scheduleSave();
    redraw();
}

function pressed(a) { return !(a === 0 || a === "0"); }

// ---------------------------------------------------------------- messages from the UI
function map(v) {
    mapOn = pressed(v);
    if (mapOn && apiReady) {
        var cur = new LiveAPI("live_set view selected_parameter");
        ignoreSelId = cur ? (parseInt(cur.id, 10) || -1) : -1;
    }
    setStatus(mapOn ? "MAP ON: click knobs in Live to add lanes" : "");
}

function run(v) {
    runOn = pressed(v);
    rebindAll();
    setStatus(runOn ? "" : "Stopped: knobs are free to move by hand");
}

function clear(v) {
    if (!pressed(v)) return;
    lanes = [];
    selected = -1;
    rebindAll();
    scheduleSave();
    setStatus("All lanes cleared");
}

function generate(v) {
    if (!pressed(v)) return;
    for (var i = 0; i < lanes.length; i++) if (!lanes[i].locked) generateLane(lanes[i]);
    output(true);
    scheduleSave();
    redraw();
}

function gen(i) { settings.gen = Math.max(0, Math.min(GEN_NAMES.length - 1, Math.round(num(i)))); redraw(); }

function bars(n) {
    n = Math.max(1, Math.min(32, Math.round(num(n))));
    if (n === settings.bars) return;
    settings.bars = n;
    for (var i = 0; i < lanes.length; i++) resizeLane(lanes[i], laneLen());
    output(true);
    scheduleSave();
    redraw();
}

function smooth(v) { settings.smooth = num(v); rebuildAll(); output(true); redraw(); }
function depth(v) { settings.depth = num(v); output(true); redraw(); }
function curve(v) { settings.curve = num(v); output(true); redraw(); }
function floor(v) { settings.floor = num(v); output(true); redraw(); }
function ceiling(v) { settings.ceiling = num(v); output(true); redraw(); }

function flip(v) {
    if (!pressed(v)) return;
    applyEdit(function (a) { var o = []; for (var i = 0; i < a.length; i++) o.push(1 - a[i]); return o; });
}
function reverse(v) {
    if (!pressed(v)) return;
    applyEdit(function (a) { return a.slice().reverse(); });
}
function faster(v) {
    if (!pressed(v)) return;
    applyEdit(function (a) { var o = [], n = a.length; for (var i = 0; i < n; i++) o.push(a[(i * 2) % n]); return o; });
}
function slower(v) {
    if (!pressed(v)) return;
    applyEdit(function (a) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[Math.floor(i / 2)]); return o; });
}

// Transport position from [transport]: bars beats units (480 units per beat).
function pos(b, beat, units) {
    var bpb = beatsPerBar || 4;
    var beats = (num(b) - 1) * bpb + (num(beat) - 1) + num(units) / 480;
    if (beats < 0) beats = 0;
    posPts = beats / bpb * PPB;
    output(false);
    var now = new Date().getTime();
    if (now - lastPaint > 40) { lastPaint = now; redraw(); }
}

// ---------------------------------------------------------------- drawing
function dims() { var r = box.rect; return [r[2] - r[0], r[3] - r[1]]; }

function layout() {
    var d = dims(), n = Math.max(lanes.length, 4);
    return { w: d[0], h: d[1], x0: LABEL_W, cw: d[0] - LABEL_W - 4, rh: (d[1] - HEADER - 2) / n };
}

function fitText(s, maxW) {
    if (mgraphics.text_measure(s)[0] <= maxW) return s;
    while (s.length > 1 && mgraphics.text_measure(s + "..")[0] > maxW) s = s.substr(0, s.length - 1);
    return s + "..";
}

function paint() {
    var g = mgraphics, L = layout(), i, s;
    g.set_source_rgba(0.09, 0.10, 0.11, 1);
    g.rectangle(0, 0, L.w, L.h);
    g.fill();

    g.select_font_face("Arial");
    g.set_font_size(9.5);
    g.set_source_rgba(0.33, 0.80, 0.75, 1);
    g.move_to(6, 11);
    g.show_text("STRDE");
    g.set_source_rgba(0.75, 0.78, 0.80, 1);
    var head = lanes.length + "/16 lanes  " + settings.bars + " bars  " + GEN_NAMES[settings.gen];
    if (!runOn) head += "  STOPPED";
    g.move_to(46, 11);
    g.show_text(head);
    if (statusText) {
        g.set_source_rgba(mapOn ? 0.98 : 0.85, mapOn ? 0.78 : 0.85, mapOn ? 0.30 : 0.85, 1);
        var st = fitText(statusText, L.w - 250);
        g.move_to(L.w - 6 - g.text_measure(st)[0], 11);
        g.show_text(st);
    }

    if (!lanes.length) {
        g.set_source_rgba(0.55, 0.58, 0.60, 1);
        g.set_font_size(11);
        s = "Turn on Map, then click knobs in Live to add lanes";
        g.move_to((L.w - g.text_measure(s)[0]) / 2, L.h / 2 + 4);
        g.show_text(s);
        return;
    }

    var n = laneLen(), fs = Math.max(7, Math.min(9.5, L.rh - 2));
    g.set_font_size(fs);
    for (i = 0; i < lanes.length; i++) {
        var l = lanes[i], y0 = HEADER + i * L.rh, c = COLORS[i % COLORS.length];
        if (i === selected) {
            g.set_source_rgba(0.20, 0.24, 0.26, 1);
            g.rectangle(0, y0, L.w, L.rh);
            g.fill();
        }
        g.set_source_rgba(0.18, 0.19, 0.20, 1);
        g.move_to(0, y0);
        g.line_to(L.w, y0);
        g.set_line_width(1);
        g.stroke();

        var ty = y0 + L.rh / 2 + fs * 0.35;
        g.set_source_rgba(0.55, 0.55, 0.55, 1);
        g.move_to(4, ty);
        g.show_text("x");
        if (l.locked) g.set_source_rgba(0.98, 0.78, 0.30, 1);
        g.move_to(15, ty);
        g.show_text(l.locked ? "L" : "o");

        if (l.missing) g.set_source_rgba(0.85, 0.40, 0.40, 1);
        else g.set_source_rgba(0.85, 0.87, 0.88, 1);
        g.move_to(27, ty);
        g.show_text(fitText((l.missing ? "(missing) " : "") + l.dev + " > " + l.name, LABEL_W - 30));

        var steps = Math.max(2, Math.min(Math.floor(L.cw), 240));
        var top = y0 + 1.5, span = Math.max(1, L.rh - 3);
        g.set_source_rgba(c[0], c[1], c[2], l.missing ? 0.3 : 1);
        g.set_line_width(1.2);
        for (var k = 0; k <= steps; k++) {
            var v = shape(rawAt(l, k / steps * n));
            var x = L.x0 + k / steps * L.cw, y = top + (1 - v) * span;
            if (k === 0) g.move_to(x, y); else g.line_to(x, y);
        }
        g.stroke();
    }

    var px = L.x0 + ((posPts % n) / n) * L.cw;
    g.set_source_rgba(1, 1, 1, 0.55);
    g.set_line_width(1);
    g.move_to(px, HEADER);
    g.line_to(px, L.h);
    g.stroke();
}

// ---------------------------------------------------------------- mouse
function hitTest(x, y) {
    var L = layout();
    if (y < HEADER) return null;
    var i = Math.floor((y - HEADER) / L.rh);
    if (i < 0 || i >= lanes.length) return null;
    var zone = x < 12 ? "x" : (x < 24 ? "lock" : (x < L.x0 ? "label" : "curve"));
    return { i: i, zone: zone, L: L };
}

function drawAt(x, y) {
    var L = layout(), l = lanes[drawState.i], n = l.pts.length;
    var y0 = HEADER + drawState.i * L.rh;
    var p = Math.floor((x - L.x0) / L.cw * n);
    p = Math.max(0, Math.min(n - 1, p));
    var v = clamp01(1 - (y - y0 - 1.5) / Math.max(1, L.rh - 3));
    var a = drawState.lastP < 0 ? p : drawState.lastP;
    var av = drawState.lastP < 0 ? v : drawState.lastV;
    var lo = Math.min(a, p), hi = Math.max(a, p);
    for (var j = lo; j <= hi; j++) {
        var t = hi === lo ? 1 : (j - a) / (p - a);
        l.pts[j] = av + (v - av) * t;
    }
    drawState.lastP = p;
    drawState.lastV = v;
    rebuildCache(l);
    redraw();
}

function onclick(x, y, but, cmd, shift, capslock, option, ctrl) {
    var h = hitTest(x, y);
    if (!h) return;
    var l = lanes[h.i];
    if (h.zone === "x") {
        removeLane(h.i);
    } else if (h.zone === "lock") {
        l.locked = !l.locked;
        scheduleSave();
    } else if (h.zone === "label") {
        if (option) { generateLane(l); output(true); scheduleSave(); }
        else selected = (selected === h.i) ? -1 : h.i;
    } else {
        drawState = { i: h.i, lastP: -1, lastV: 0 };
        drawAt(x, y);
    }
    redraw();
}

function ondrag(x, y, but) {
    if (!drawState) return;
    if (!but) {
        drawState = null;
        output(true);
        scheduleSave();
        return;
    }
    drawAt(x, y);
}

function onresize() { redraw(); }
