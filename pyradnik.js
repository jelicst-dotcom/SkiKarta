/* SkiKarta 3.8: Python (Pyodide) u pozadinskoj niti (Web Worker). 3.8.2: preuzimanje usporedno s pokretanjem,
   prevedeni kod (ako se verzija Pythona poklapa), fontovi tek za prvi crtež.
   Stranica ostaje živa dok Python crta poster: može prikazati napredak i ne „zamrzne” se na mobitelu.
   Poruke: {type:'boot'} pokreće Python; {type:'run', id, code, vars, kind} izvrši kod; {type:'pack', name} dopuni paket. */
let py = null;
const UNPACK = `
import base64, json, os, zlib
for _p, _d in json.loads(_pack).items():
    _t = os.path.join('/home/pyodide/app', _p)
    os.makedirs(os.path.dirname(_t), exist_ok=True)
    with open(_t, 'wb') as _f:
        _f.write(zlib.decompress(base64.b64decode(_d)))
del _pack`;
const INIT = `
import sys, os
sys.path[:0] = ['/home/pyodide/app/skikarta', '/home/pyodide/app/site']
os.chdir('/home/pyodide/app/skikarta')
os.environ['SKIKARTA_WEB'] = '1'
import skikarta_mobile as M
M.set_lang(_lang)`;

function send(message, transfer) { self.postMessage(message, transfer || []); }

const getText = (name) => fetch(name).then((res) => {
  if (!res.ok) throw new Error('@@NEMA:' + name + ' (' + res.status + ')');
  return res.text();
});

async function unpack(name, text) {
  py.globals.set('_pack', text !== undefined ? await text : await getText(name));
  py.runPython(UNPACK);
}

const PKGS = ['numpy', 'pillow', 'tzdata'];

async function boot(PYODIDE, lang, packs, pycPacks) {
  const t0 = performance.now(), marks = [];
  const mark = (what) => marks.push([what, Math.round(performance.now() - t0)]);
  send({ type: 'step', key: 'loadPy', pct: 5 });
  // 3.8.2: sve što se može preuzeti kreće odmah, usporedno s pokretanjem Pythona (prije: jedno za drugim)
  const texts = packs.map((n) => { const p = getText(n); p.catch(() => {}); return p; });
  const probeP = fetch(PYODIDE + 'pyodide-lock.json');
  probeP.then((r) => r.clone().json()).then((lock) => {   // kotači numpy/pillow/tzdata u predmemoriju preglednika
    const pk = (lock && lock.packages) || {};
    PKGS.forEach((n) => { if (pk[n] && pk[n].file_name) fetch(PYODIDE + pk[n].file_name).catch(() => {}); });
  }).catch(() => {});
  if (typeof loadPyodide !== 'function') importScripts(PYODIDE + 'pyodide.js');
  mark('pyodide.js');
  send({ type: 'step', key: 'startPy', pct: 15 });
  const probe = await probeP;
  if (!probe.ok) throw new Error('@@CDN:' + probe.status);
  py = await loadPyodide({ indexURL: PYODIDE });
  mark('Pyodide');
  send({ type: 'step', key: 'loadPkgs', pct: 35 });
  // 3.8.2: kod preveden unaprijed samo ako je ista verzija Pythona (inače se ne preuzima ni ne koristi)
  const tag = String(py.runPython('import sys\nsys.implementation.cache_tag'));
  // (samo ako je već u predmemoriji – pri prvom otvaranju ga ionako sprema servis, pa se ne preuzima dvaput)
  const pyc = (pycPacks || []).find((n) => n === 'paket_pyc_' + tag + '.json');
  let pycText = null;
  try {
    const hit = pyc && self.caches ? await caches.match(pyc) : null;
    if (hit) { pycText = hit.text(); pycText.catch(() => {}); }
  } catch (_) { pycText = null; }
  await py.loadPackage(PKGS, { messageCallback: (m) => send({ type: 'hint', text: m }) });
  mark('numpy, pillow');
  for (let i = 0; i < packs.length; i++) {
    send({ type: 'step', key: 'loadMaps', pct: 60 + Math.round(35 * i / packs.length), vars: { i: i + 1, n: packs.length } });
    await unpack(packs[i], texts[i]);
    mark(packs[i]);
  }
  if (pycText) {
    try { await unpack(pyc, pycText); mark(pyc); } catch (_) { /* bez prevedenog koda radi kao prije */ }
  }
  py.globals.set('reportProgress', (p) => send({ type: 'progress', p }));
  py.globals.set('_lang', lang);
  py.runPython(INIT);
  mark('skikarta');
  const resources = (self.performance && performance.getEntriesByType)
    ? performance.getEntriesByType('resource').map((e) => e.name) : [];
  send({ type: 'ready', marks, resources });
}

self.onmessage = async (event) => {
  const m = event.data || {};
  if (m.type === 'boot') {
    try { await boot(m.pyodide, m.lang, m.packs || [], m.pyc || []); }
    catch (err) { send({ type: 'bootError', message: String((err && err.message) || err) }); }
    return;
  }
  const t0 = performance.now();
  try {
    if (m.type === 'pack') {
      await unpack(m.name);
      py.runPython('import skikarta_maps\nskikarta_maps.packs_changed()');
      send({ type: 'result', id: m.id, ok: true, value: null, ms: performance.now() - t0 });
      return;
    }
    if (m.type !== 'run') return;
    for (const [k, v] of Object.entries(m.vars || {})) py.globals.set(k, v);
    const out = py.runPython(m.code);
    if (m.kind === 'pair') {
      const name = out.get(0), bytes = out.get(1).toJs();
      if (out.destroy) out.destroy();
      send({ type: 'result', id: m.id, ok: true, value: { name, bytes }, ms: performance.now() - t0 }, [bytes.buffer]);
    } else if (m.kind === 'text') {
      send({ type: 'result', id: m.id, ok: true, value: out, ms: performance.now() - t0 });
    } else {
      if (out && out.destroy) out.destroy();
      send({ type: 'result', id: m.id, ok: true, value: null, ms: performance.now() - t0 });
    }
  } catch (err) {
    send({ type: 'result', id: m.id, ok: false, message: String((err && err.message) || err), ms: performance.now() - t0 });
  }
};
