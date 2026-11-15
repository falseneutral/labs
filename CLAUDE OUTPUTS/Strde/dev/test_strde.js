// Offline test for strde.js: fakes the Max/Live globals and drives the device logic.
// Run: node dev/test_strde.js
var fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
var src = fs.readFileSync(path.join(__dirname, "..", "strde.js"), "utf8");

function makeWorld() {
    var outs = [], tasks = [];
    // Fake Live set: track 0 has a synth (device 0) and Strde itself (device 1).
    var objs = {
        "live_set tracks 0 devices 0": { id: 10, name: "Serum 2" },
        "live_set tracks 0 devices 0 parameters 1": { id: 11, name: "Filter Cutoff", min: 0, max: 1, q: 0 },
        "live_set tracks 0 devices 0 parameters 2": { id: 12, name: "Osc Shape", min: -64, max: 63, q: 1 },
        "live_set tracks 0 devices 1": { id: 20, name: "Strde" },
        "live_set tracks 0 devices 1 parameters 3": { id: 21, name: "Depth", min: 0, max: 100, q: 0 }
    };
    var byId = {};
    Object.keys(objs).forEach(function (p) { objs[p].path = p; byId[objs[p].id] = objs[p]; });
    var selected = 0, observers = [];

    function LiveAPI(cb, p) {
        if (typeof cb === "string") { p = cb; cb = null; }
        var o = null;
        if (p === "this_device") o = objs["live_set tracks 0 devices 1"];
        else if (p === "live_set view selected_parameter") o = byId[selected] || null;
        else if (/^id /.test(p)) o = byId[parseInt(p.substr(3), 10)] || null;
        else o = objs[p] || (p === "live_set" || p === "live_set view" ? { id: 1, path: p } : null);
        this.id = o ? String(o.id) : "0";
        this.unquotedpath = o ? o.path : "";
        this._o = o; this._cb = cb; this._p = p;
        var self = this;
        Object.defineProperty(this, "property", { set: function (v) { self._prop = v; observers.push(self);
            if (v === "signature_numerator") cb([v, 4]); } });
    }
    LiveAPI.prototype.get = function (k) {
        var o = this._o;
        if (k === "name") return [o.name];
        if (k === "min") return [o.min];
        if (k === "max") return [o.max];
        if (k === "is_quantized") return [o.q];
        return [0];
    };
    function Task(fn, ctx) { this.fn = fn; }
    Task.prototype.schedule = function () { tasks.push(this.fn); };
    Task.prototype.cancel = function () { var f = this.fn; tasks = tasks.filter(function (t) { return t !== f; }); };

    var calls = 0;
    var mg = new Proxy({}, { get: function (t, k) {
        if (k === "text_measure") return function (s) { return [String(s).length * 5, 9]; };
        if (k === "init" || typeof k === "symbol") return function () {};
        return function () { calls++; };
    }, set: function () { return true; } });

    var ctx = {
        Math: Math, Date: Date, String: String, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
        encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent, Array: Array,
        outlet: function () { outs.push(Array.prototype.slice.call(arguments)); },
        setinletassist: function () {}, setoutletassist: function () {}, post: function () {},
        mgraphics: mg, LiveAPI: LiveAPI, Task: Task, box: { rect: [0, 0, 652, 160] }
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return {
        ctx: ctx, outs: outs, objs: objs, mgCalls: function () { return calls; },
        runTasks: function () { var t = tasks; tasks = []; t.forEach(function (f) { f(); }); },
        select: function (id) { selected = id; observers.forEach(function (o) {
            if (o._prop === "selected_parameter") o._cb(["selected_parameter", "id", id]); }); },
        clearOuts: function () { outs.length = 0; }
    };
}

var w = makeWorld(), c = w.ctx;
c.init();
assert.strictEqual(c.lanes.length, 0);

// Map off: selecting does nothing.
w.select(11); w.runTasks();
assert.strictEqual(c.lanes.length, 0, "map off ignores clicks");

// Map on: currently selected (11) is ignored, new ones added.
c.map(1);
w.select(11); w.runTasks();
assert.strictEqual(c.lanes.length, 0, "already-selected knob at arm time is ignored");
w.select(12); w.runTasks();
w.select(11); w.runTasks();
assert.strictEqual(c.lanes.length, 2, "two lanes mapped");
assert.strictEqual(c.lanes[0].name, "Osc Shape");
assert.strictEqual(c.lanes[0].dev, "Serum 2");
assert.ok(c.lanes[0].quant);
w.select(21); w.runTasks();
assert.strictEqual(c.lanes.length, 2, "own controls rejected");
assert.ok(/own controls/.test(c.statusText));

// Every lane has a full-length curve in 0..1.
c.lanes.forEach(function (l) {
    assert.strictEqual(l.pts.length, 8 * 32);
    l.pts.forEach(function (v) { assert.ok(v >= 0 && v <= 1, "pts in range"); });
});

// Each generator produces valid curves for every bar length.
for (var g = 0; g < 6; g++) {
    c.gen(g);
    [1, 2, 3, 8, 32].forEach(function (b) {
        c.bars(b);
        c.generate(1);
        c.lanes.forEach(function (l) {
            assert.strictEqual(l.pts.length, b * 32, "gen " + g + " bars " + b);
            l.pts.forEach(function (v) { assert.ok(v >= 0 && v <= 1 && !isNaN(v)); });
        });
    });
}
c.bars(8);

// Transport position drives values within each parameter's native range, quantized where needed.
w.clearOuts();
for (var t = 0; t < 200; t++) c.pos(1 + Math.floor(t / 16), 1 + (t % 4), (t * 37) % 480);
var vals = w.outs.filter(function (o) { return o.length === 4 && o[0] === 0; }).map(function (o) { return o.slice(1); });
assert.ok(vals.length > 0, "values output while transport moves");
vals.forEach(function (o) {
    if (o[0] === 0) { assert.ok(o[1] >= -64 && o[1] <= 63 && o[1] === Math.round(o[1]), "quantized lane"); }
    else { assert.ok(o[1] >= 0 && o[1] <= 1, "float lane in range"); }
    assert.strictEqual(o[2], 20);
});

// Shaping: depth 0 parks every lane in the middle of floor..ceiling.
c.depth(0); c.floor(20); c.ceiling(60);
c.lanes.forEach(function (l) { assert.ok(Math.abs(c.shape(c.rawAt(l, 13.3)) - 0.4) < 1e-9); });
c.depth(100); c.floor(0); c.ceiling(100); c.curve(50); c.smooth(60);
c.lanes.forEach(function (l) { for (var p = 0; p < 256; p += 0.7) { var v = c.shape(c.rawAt(l, p)); assert.ok(v >= 0 && v <= 1); } });
c.curve(0); c.smooth(0);

// Lock: generate leaves locked lanes alone.
c.lanes[0].locked = true;
var before = c.lanes[0].pts.join(",");
c.generate(1);
assert.strictEqual(c.lanes[0].pts.join(","), before, "locked lane untouched");
c.generate(0);   // button release is ignored

// Edits on the selected lane only.
c.selected = 1;
var a = c.lanes[1].pts.slice();
c.flip(1);
assert.ok(Math.abs(c.lanes[1].pts[5] - (1 - a[5])) < 1e-12);
c.reverse(1);
c.faster(1); c.slower(1);
assert.strictEqual(c.lanes[1].pts.length, 256);
c.selected = -1;

// Save / restore round trip into a fresh device.
c.doSave();
var saved = w.outs.filter(function (o) { return o[0] === 2 && o[1] === "set"; }).pop()[2];
assert.ok(/^S1\|/.test(saved) && saved.indexOf(" ") < 0, "state is one symbol without spaces");
var w2 = makeWorld(), c2 = w2.ctx;
c2.restore(saved);           // arrives before init, like at set load
assert.strictEqual(c2.lanes.length, 0);
c2.init();
assert.strictEqual(c2.lanes.length, 2, "lanes restored");
assert.ok(c2.lanes[0].locked);
assert.strictEqual(c2.lanes[1].id, 11);
for (var i = 0; i < 256; i++) assert.ok(Math.abs(c2.lanes[1].pts[i] - c.lanes[1].pts[i]) <= 1 / 255);
var binds = w2.outs.filter(function (o) { return o.length === 3 && o[0] === 1 && o[2] !== 0; });
assert.deepStrictEqual(binds.map(function (o) { return o[2]; }).sort(), [11, 12], "restored lanes bound");

// A knob whose path now points at a different parameter is marked missing, never moved.
var w3 = makeWorld();
w3.objs["live_set tracks 0 devices 0 parameters 2"].name = "Something Else";
w3.ctx.restore(saved); w3.ctx.init();
assert.ok(w3.ctx.lanes[0].missing, "renamed knob is missing");
assert.ok(!w3.outs.some(function (o) { return o.length === 3 && o[0] === 1 && o[2] === 12; }), "missing lane not bound");

// Run off frees all knobs.
w.clearOuts();
c.run(0);
assert.ok(w.outs.length >= 16 && w.outs.every(function (o) { return o[0] === 1 && o[2] === 0; }), "all unbound");
c.run(1);

// Remove lane rebinds the rest; mouse draws; paint runs without errors.
c.paint(); assert.ok(w.mgCalls() > 50);
var L = c.layout();
var y = 15 + L.rh * 1.5;
c.onclick(L.x0 + 10, y, 1, 0, 0, 0, 0, 0);
c.ondrag(L.x0 + 200, 15 + L.rh * 1.1, 1);
c.ondrag(L.x0 + 200, 15 + L.rh * 1.1, 0);
assert.ok(c.lanes[1].pts[Math.floor(190 / L.cw * 256)] > 0.7, "drawn high");
c.onclick(5, 15 + L.rh * 0.5, 1, 0, 0, 0, 0, 0);   // x on lane 0
assert.strictEqual(c.lanes.length, 1);
assert.strictEqual(c.lanes[0].name, "Filter Cutoff");
c.clear(1);
assert.strictEqual(c.lanes.length, 0);
c.paint();

console.log("all tests passed");
