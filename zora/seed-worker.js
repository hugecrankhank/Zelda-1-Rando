// Seed generator: ZORA (https://github.com/tetraly/zora, MIT) running in
// Pyodide inside a Web Worker, so the page stays responsive while it works.
// Adapted from ZORA's own web/zora-worker.js.
//
// Messages in  (each with an `id`):
//   init     {pyodideVersion, wheelUrl}
//   identify {bytes}                       → {identity}
//   state    {flags, zoraFlags}             → {state}
//   change   {previous, values, zoraFlags}  → {state}
//   zoraChange {flags, zoraValues}          → {state}
//   generate {bytes, seed, flags, zoraFlags}→ {rom, flags, zoraFlags, seed, code}
//   report   {bytes, seed, flags, zoraFlags}→ {report: {json, spoiler, spoilerName}}
// Messages out: {type:'ready', metadata, tabs, version} | {type:'result', id, ...} | {type:'error', id, message}

const GLUE = `
import json, sys
from zora_web.api import flag_form, generate_rom, identify_rom, player_settings_from_page, seed_report

def identify(data):
    return json.dumps(identify_rom(bytes(data.to_py())))

def form_metadata():
    return json.dumps(flag_form.metadata())

def form_state(flag_string, zora_flag_string):
    return json.dumps(flag_form.form_state(flag_string, zora_flag_string))

def form_change(previous, values, zora_flag_string):
    return json.dumps(flag_form.form_change(previous, json.loads(values), zora_flag_string))

def zora_form_change(flag_string, zora_values):
    return json.dumps(flag_form.zora_form_change(flag_string, json.loads(zora_values)))

LAST_RESULT = "{}"

def generate(data, seed, flag_string, zora_flag_string):
    global LAST_RESULT
    settings = player_settings_from_page({})
    result = generate_rom(flag_string, int(seed), bytes(data.to_py()), settings, zora_flag_string)
    LAST_RESULT = json.dumps({"flags": result.flag_string, "zoraFlags": result.zora_flag_string,
                              "seed": str(result.seed), "code": [str(n) for n in result.code]})
    return result.rom

def report(data, seed, flag_string, zora_flag_string):
    return json.dumps(seed_report(bytes(data.to_py()), flag_string, int(seed), zora_flag_string))
`;

let pyodide = null;
const call = (name, ...args) => pyodide.globals.get(name)(...args);
const json = (name, ...args) => JSON.parse(call(name, ...args));

async function init({ pyodideVersion, wheelUrl, tabsUrl }) {
  const t0 = performance.now();
  const base = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
  const { loadPyodide } = await import(`${base}pyodide.mjs`);
  const [py, wheel, tabs] = await Promise.all([
    loadPyodide(),
    fetch(wheelUrl).then((r) => { if (!r.ok) throw new Error('wheel ' + r.status); return r.arrayBuffer(); }),
    fetch(tabsUrl).then((r) => r.json()).catch(() => ({})),
  ]);
  pyodide = py;
  // ZORA has no dependencies, so unpacking the wheel installs it.
  pyodide.unpackArchive(wheel, 'wheel');
  pyodide.runPython(GLUE);
  postMessage({ type: 'ready', ms: performance.now() - t0, metadata: json('form_metadata'), tabs });
}

const handlers = {
  identify: ({ bytes }) => ({ identity: json('identify', bytes) }),
  state: ({ flags, zoraFlags }) => ({ state: json('form_state', flags, zoraFlags || '') }),
  change: ({ previous, values, zoraFlags }) =>
    ({ state: json('form_change', previous, JSON.stringify(values), zoraFlags || '') }),
  zoraChange: ({ flags, zoraValues }) =>
    ({ state: json('zora_form_change', flags, JSON.stringify(zoraValues)) }),
  report: ({ bytes, seed, flags, zoraFlags }) =>
    ({ report: json('report', bytes, String(seed), flags, zoraFlags || '') }),
};

function generate({ id, bytes, seed, flags, zoraFlags }) {
  const t0 = performance.now();
  const out = call('generate', bytes, String(seed), flags, zoraFlags || '');
  const rom = out.toJs();
  out.destroy();
  const info = JSON.parse(pyodide.globals.get('LAST_RESULT'));
  postMessage({ type: 'result', id, rom, ms: performance.now() - t0, ...info }, [rom.buffer]);
}

self.onmessage = async (event) => {
  const m = event.data;
  try {
    if (m.type === 'init') await init(m);
    else if (m.type === 'generate') generate(m);
    else if (handlers[m.type]) postMessage({ type: 'result', id: m.id, ...handlers[m.type](m) });
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
