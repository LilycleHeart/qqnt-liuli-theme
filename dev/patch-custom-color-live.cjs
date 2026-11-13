'use strict';
// Development-only adapter for an already-running index closure. Generating this
// script does not connect to QQ, inject the theme, or write any user settings.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'assets/panel.css'), 'utf8');
function extract(name) {
  const start = index.indexOf('  function ' + name + '(');
  const end = index.indexOf('\n  }', start);
  if (start < 0 || end <= start) throw Error('Missing helper ' + name);
  return index.slice(start, end + 4);
}
function installCustomColorCompatibility(editorCss) {
  window.__liuliCustomColorCompatibility?.dispose();
  const KEY = 'liuli-dsh-settings';
  const DEFAULT_SOURCE = '#1d9bf0';
  const PANEL = '#liuli-settings-dialog,#liuli-embedded,.liuli-embedded';
  const SOURCE = '[data-liuli-setting="colorSource"]';
  const IGNORE = '.chat-msg-area,.recent-contact,.group-member,.group-box';
  const states = new Map();
  const pending = new Set();
  let frame = 0;
  let disposed = false;
  let signature = '';
  let needsPalette = true;
  let llColorControlInstance = 10000;
  let refreshPaletteInfo = () => {};
  let llModeCfg = readLatest();
  const buildRoleControls = () => {};
  const style = document.createElement('style');
  style.id = 'liuli-custom-color-compat-style';
  style.textContent = editorCss;
  document.head.appendChild(style);

  /* __NORMALIZE__ */
  /* __SYNC__ */
  /* __BUILD__ */

  function readLatest() {
    let stored = {};
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) stored = value;
    } catch (_) {}
    const cached = window.__liuliSettingsCache;
    return { ...(cached && typeof cached === 'object' ? cached : {}), ...stored };
  }
  function colorSettings() {
    const settings = readLatest();
    settings.colorSource = settings.colorSource === 'custom' ? 'custom' : 'wallpaper';
    settings.customColor = llNormalizeColorSeed(settings.customColor) || DEFAULT_SOURCE;
    return settings;
  }
  function rememberModels() {
    llModeCfg = colorSettings();
    for (const state of states.values()) {
      Object.assign(state.model, llModeCfg);
      state.colors = { colorSource: llModeCfg.colorSource, customColor: llModeCfg.customColor };
    }
  }
  function applySettings(next) {
    const state = [...states.values()].find(value => value.model === next);
    const old = state?.colors || llModeCfg;
    const changes = {};
    if (next.colorSource !== old.colorSource)
      changes.colorSource = next.colorSource === 'custom' ? 'custom' : 'wallpaper';
    if (next.customColor !== old.customColor) {
      const seed = llNormalizeColorSeed(next.customColor);
      if (seed) changes.customColor = seed;
    }
    if (Object.keys(changes).length) {
      // Merge at the edit boundary. A newly changed blur, chat style or message
      // option must not be replaced by the color card's older settings object.
      const latest = { ...readLatest(), ...changes };
      const serialized = JSON.stringify(latest);
      localStorage.setItem(KEY, serialized);
      // The running index compares its old settings object to the incoming
      // object. Mutating its cache first would hide the color change and skip
      // MCU derivation; only its existing storage listener owns that update.
      window.dispatchEvent(new StorageEvent('storage', {
        key: KEY, newValue: serialized, storageArea: localStorage, url: location.href
      }));
    }
    rememberModels();
    llSyncColorSourceControls();
    // The old index handles MCU and the old role section. Our body-only
    // observer refreshes the preview text after those variables are applied.
    schedule(true);
  }
  function applyDynamicPalette() { schedule(true); }
  function build(row) {
    const body = row.closest('.liuli-section__body');
    if (!body || states.has(body) || body.querySelector('.liuli-palette-card')) return;
    // Refuse an unexpected host instead of deleting unrelated settings.
    if ([...body.children].some(node => node !== row &&
      !node.matches('[data-liuli-color-custom],.liuli-info'))) return;
    const model = colorSettings();
    const state = { body, model, colors: { colorSource: model.colorSource, customColor: model.customColor }, original: [...body.childNodes], nodes: [] };
    states.set(body, state);
    const temporary = document.createElement('div');
    buildColorControls(temporary, model);
    const source = temporary.querySelector(SOURCE);
    const card = temporary.querySelector('.liuli-palette-card');
    if (!source || !card) { states.delete(body); return; }
    state.nodes = [source, card];
    body.replaceChildren(source, card);
    body.setAttribute('data-liuli-color-compat', '');
    needsPalette = true;
  }
  function collect(node) {
    if (node?.nodeType !== 1 || node.closest(IGNORE)) return;
    if (node.matches(SOURCE)) pending.add(node);
    // Only added settings roots or nodes already inside those roots qualify.
    // Native list/message mutations never trigger settings subtree queries.
    if (node.matches(PANEL) || node.closest(PANEL))
      for (const row of node.querySelectorAll(SOURCE)) pending.add(row);
    else for (const panel of node.querySelectorAll(PANEL))
      for (const row of panel.querySelectorAll(SOURCE)) pending.add(row);
  }
  function paletteSignature() {
    return [document.body.dataset.liuliSource, document.body.dataset.liuliColorSource,
      document.body.dataset.liuliMode, document.body.dataset.liuliDark,
      document.body.getAttribute('style')].join('|');
  }
  function flush() {
    frame = 0;
    if (disposed) return;
    for (const [body] of states) if (!body.isConnected) states.delete(body);
    for (const row of pending) if (row.isConnected) build(row);
    pending.clear();
    const next = paletteSignature();
    if (needsPalette || next !== signature) {
      needsPalette = false;
      signature = next;
      rememberModels();
      llSyncColorSourceControls();
      refreshPaletteInfo();
    }
  }
  function schedule(palette = false) {
    needsPalette ||= palette;
    if (!disposed && !frame) frame = requestAnimationFrame(flush);
  }
  const paletteObserver = new MutationObserver(() => {
    if (paletteSignature() !== signature) schedule();
  });
  paletteObserver.observe(document.body, { attributes: true,
    attributeFilter: ['style', 'data-liuli-source', 'data-liuli-color-source', 'data-liuli-mode', 'data-liuli-dark'] });
  const discovery = new MutationObserver(records => {
    for (const record of records) {
      if (record.target.closest?.(IGNORE)) continue;
      for (const node of record.addedNodes) collect(node);
    }
    if (pending.size) schedule();
  });
  discovery.observe(document.body, { childList: true, subtree: true });
  const onStorage = event => { if (event.key === KEY) schedule(true); };
  window.addEventListener('storage', onStorage);
  const api = {
    refresh() { document.querySelectorAll(SOURCE).forEach(row => pending.add(row)); needsPalette = true; flush(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      paletteObserver.disconnect(); discovery.disconnect();
      window.removeEventListener('storage', onStorage);
      for (const state of states.values()) {
        if (state.body.hasAttribute('data-liuli-color-compat') &&
            state.nodes.every(node => node.parentElement === state.body)) {
          state.body.replaceChildren(...state.original);
          state.body.removeAttribute('data-liuli-color-compat');
        }
      }
      states.clear(); pending.clear();
      style.remove();
      if (window.__liuliCustomColorCompatibility === api) delete window.__liuliCustomColorCompatibility;
    }
  };
  window.__liuliCustomColorCompatibility = api;
  api.refresh();
  return { cards: document.querySelectorAll('[data-liuli-color-compat] .liuli-palette-card').length, wroteSettings: false };
}
const cssStart = panel.indexOf('/* 配色编辑器：');
const cssEnd = panel.indexOf('/* ── 按下效果', cssStart);
if (cssStart < 0 || cssEnd <= cssStart) throw Error('Missing editor styles');
const body = installCustomColorCompatibility.toString()
  .replace('/* __NORMALIZE__ */', extract('llNormalizeColorSeed'))
  .replace('/* __SYNC__ */', extract('llSyncColorSourceControls'))
  .replace('/* __BUILD__ */', extract('buildColorControls'));
const source = '(' + body + ')(' + JSON.stringify(panel.slice(cssStart, cssEnd)) + ');\n';
module.exports = { source };
if (require.main === module) {
  const output = path.resolve(process.argv[2] || path.join(root, '../../output/playwright/custom-color-design-20261113/custom-color-compat.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, source);
  console.log(output);
}
