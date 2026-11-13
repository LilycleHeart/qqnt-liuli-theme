const require = process.getBuiltinModule('module').createRequire(snowlora.script);
const path = require('node:path');
const loadResources = require('./resources.cjs');
const { randomUUID } = require('node:crypto');
const { BrowserWindow, app, shell } = require('electron');

const root = path.dirname(snowlora.script);
// One registry per QQ process. SnowLora runs this script once per matching
// HWND, and QQ pre-creates windows (#/blank) that only route in-page later,
// so window state has to outlive a single execution.
const windows = (globalThis.__snowloraLiuliWindows ??= new Map());
let diagnostics = globalThis.__snowloraLiuliDiagnostics ?? null;
const profiles = (globalThis.__snowloraLiuliProfiles ??= require('./standalone-profile.cjs')({
  log: entry => diagnostics?.log(entry)
}));

// Only QQ's main renderer document, and only its UI routes, receive the theme:
// hiddenWindow.html / screenshot.html / newLogin.html, about: shells, the
// screen-share surfaces and the "#/blank" holding page stay untouched.
// Standalone declaration so the porting tests can eval it in isolation.
function eligible(url) {
  if (typeof url !== 'string' || url === '') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'app:') return false;
  if (!parsed.pathname.endsWith('/renderer/index.html')) return false;
  const hash = parsed.hash;
  if (hash === '' || hash === '#' || hash === '#/') return false;
  // Deliberately inspects the raw hash: auxiliary windows carry percent-encoded
  // JSON in their route, and decoding would let quoted message text trip the
  // screen/share filter below. chatPoolWin=1 lives in the query, so it is not
  // treated as a reason to skip.
  const route = hash.slice(1).toLowerCase();
  if (route.includes('screen') || route.includes('share')) return false;
  if (/^\/(?:blank|tray-menu|av)(?:[/?]|$)/.test(route)) return false;
  return true;
}

function initDiagnostics() {
  if (!diagnostics) {
    diagnostics = globalThis.__snowloraLiuliDiagnostics = require('./diagnostics.cjs')(root, () =>
      // Only themed documents take part in a diagnostic export, as before.
      [...windows.values()].filter(state => state.applied).map(state => state.wc)
    );
    require('./window-state.cjs')(diagnostics.log);
  }
  return diagnostics;
}

function stateUrl(state) {
  try {
    return state.wc.isDestroyed() ? '' : state.wc.getURL();
  } catch {
    return '';
  }
}

function logSkip(state, url) {
  if (!diagnostics || !url) return;
  state.skipped ??= new Set();
  if (state.skipped.has(url)) return;
  state.skipped.add(url);
  diagnostics.log({ event: 'theme-skip', window: state.wc.id, url: url.slice(0, 240) });
}

function createMethods(state) {
  const wc = state.wc;
  return {
    selfUid: () => wc.executeJavaScript('window.LiuliQQ.selfUid()'),
    async openExternal(value) {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP/HTTPS 外链');
      await shell.openExternal(url.href);
      return true;
    },
    diagLog: entry => diagnostics.log(entry),
    diagExport: payload => diagnostics.exportReport(payload),
    diagOpenPath: file => diagnostics.openPath(file)
  };
}

// A scoped console channel reaches the host without adding a QQ preload or IPC hook.
async function onConsole(state, details) {
  const wc = state.wc;
  const message = details.message;
  if (!state.token || typeof message !== 'string' || !message.startsWith(state.token)) return;
  if (wc.isDestroyed() || details.frame !== wc.mainFrame || message.length > 4 * 1024 * 1024)
    return;
  const token = state.token;
  const methods = (state.methods ??= createMethods(state));
  let request;
  try {
    request = JSON.parse(message.slice(token.length));
    if (!Number.isSafeInteger(request.id) || !Object.hasOwn(methods, request.method)) return;
  } catch {
    return;
  }
  let result, error;
  try {
    result = await methods[request.method](request.argument);
  } catch (cause) {
    error = cause.message;
    diagnostics.log({ method: request.method, error });
  }
  if (request.id && !wc.isDestroyed() && state.token === token) {
    await wc
      .executeJavaScript(
        `window.LiuliHost.reply(${request.id},${JSON.stringify(result ?? null)},${JSON.stringify(error ?? null)})`
      )
      .catch(() => {});
  }
}

async function apply(state, generation = state.generation) {
  const wc = state.wc;
  if (wc.isDestroyed() || generation !== state.generation) return false;
  const url = stateUrl(state);
  if (!eligible(url)) return false;
  const { assets, wallpaper, source } = await loadResources(root);
  if (wc.isDestroyed() || wc.isLoadingMainFrame() || state.generation !== generation) return false;
  if (state.applied || !eligible(stateUrl(state))) return false;
  state.token = '[theme-host:' + randomUUID() + ']';
  const bootstrap = {
    token: state.token,
    assets,
    wallpaper,
    info: {
      present: true,
      host: 'native',
      versions: { ...process.versions, qqnt: app.getVersion() }
    }
  };
  try {
    await wc.executeJavaScript(
      `(async () => {\nconst bootstrap = ${JSON.stringify(bootstrap)};\n${source}\nawait window.SnowLoraLiuli.ready;\n})()`
    );
  } catch (error) {
    diagnostics.log({
      event: 'theme-failed',
      window: wc.id,
      url: url.slice(0, 120),
      error: error?.message ?? String(error)
    });
    console.error('[theme]', error);
    return false;
  }
  state.applied = true;
  await profiles.themeReady(state);
  diagnostics.log({ event: 'theme-ready', window: wc.id, url: url.slice(0, 120) });
  return true;
}

// Queue one injection per webContents: apply calls never overlap, and the
// queued task re-checks "already applied" so one document is never themed twice.
function enqueue(state, generation) {
  state.ready = state.ready.catch(() => {}).then(() => {
    if (state.applied) return false;
    return apply(state, generation);
  });
  // Never let a failure escape as a rejection: SnowLora awaits this execution.
  state.ready = state.ready.catch(error => {
    const url = stateUrl(state);
    diagnostics?.log({
      event: 'theme-failed',
      window: state.wc.id,
      url: url.slice(0, 120),
      error: error?.message ?? String(error)
    });
    console.error('[theme]', error);
  });
  return state.ready;
}

function onLoad(state) {
  if (state.wc.isDestroyed()) return;
  // A fresh document: any previous injection is gone.
  const generation = ++state.generation;
  state.applied = false;
  const url = stateUrl(state);
  if (!eligible(url)) {
    logSkip(state, url);
    return;
  }
  enqueue(state, generation);
}

function onRoute(state, _event, url, isMainFrame) {
  if (!isMainFrame || state.wc.isDestroyed()) return;
  const target = typeof url === 'string' && url ? url : stateUrl(state);
  if (!state.applied) {
    // The usual case for pre-created windows: attach saw "#/blank", and the
    // real route was entered without a reload.
    if (eligible(target)) enqueue(state, state.generation);
    else logSkip(state, target);
    return;
  }
  // Same document, only the hash changed: let the renderer re-sync in place.
  state.wc.executeJavaScript("window.dispatchEvent(new Event('liuli-route'))").catch(() => {});
}

function attach(browserWindow) {
  let wc;
  try {
    if (!browserWindow || browserWindow.isDestroyed()) return null;
    wc = browserWindow.webContents;
  } catch {
    return null;
  }
  if (!wc || wc.isDestroyed()) return null;
  const existing = windows.get(wc.id);
  if (existing) {
    profiles.attach(existing);
    if (existing.managed) return existing;
    // Adopt a state left by an older load.js: it already injected this document
    // and already owns its listeners, so neither re-attach nor re-inject.
    existing.managed = true;
    existing.applied = true;
    existing.ready ??= Promise.resolve();
    return existing;
  }
  const state = {
    wc,
    ready: Promise.resolve(),
    token: '',
    generation: 0,
    applied: false,
    managed: true,
    skipped: new Set()
  };
  windows.set(wc.id, state);
  wc.on('console-message', details => onConsole(state, details));
  wc.on('did-finish-load', () => onLoad(state));
  wc.on('did-navigate-in-page', (event, url, isMainFrame) =>
    onRoute(state, event, url, isMainFrame)
  );
  wc.once('destroyed', () => windows.delete(wc.id));
  profiles.attach(state);
  const url = stateUrl(state);
  if (eligible(url)) {
    // Already past the load event (windows that existed before this injection,
    // or a window whose load finished between creation and attach).
    if (!wc.isLoadingMainFrame()) enqueue(state, state.generation);
  } else if (url) {
    logSkip(state, url);
  }
  return state;
}

function createManager() {
  initDiagnostics();
  const instance = { windows, diagnostics, eligible, attach };
  // One listener registration per process, on purpose.
  app.on('browser-window-created', (_event, browserWindow) => attach(browserWindow));
  for (const browserWindow of BrowserWindow.getAllWindows()) attach(browserWindow);
  return instance;
}

// Repeated executions reuse the manager; only the per-call hand-off below runs.
const manager = (globalThis.__snowloraLiuliManager ??= createManager());

// SnowLora invokes this file once per window it matched by title. The manager
// now decides globally what to theme, so this call only waits for its window
// and never throws.
const snowloraWindow = BrowserWindow.getAllWindows().find(browserWindow => {
  try {
    return (
      !browserWindow.isDestroyed() &&
      browserWindow.getNativeWindowHandle().readBigUInt64LE().toString(16) === snowlora.window
    );
  } catch {
    return false;
  }
});
if (!snowloraWindow) return;
const targetState = manager.attach(snowloraWindow);
if (!targetState || !eligible(stateUrl(targetState))) return;
await targetState.ready;
