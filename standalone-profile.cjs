'use strict';

const { randomUUID } = require('node:crypto');

// Intentionally independent of the full theme/QQ bridge. Never copy arbitrary
// --ll-* properties: noise, wallpaper URLs, layout and message settings stay out.
const VARIABLES = Object.freeze([
  '--ll-brand', '--ll-brand-rgb', '--ll-brand-hover', '--ll-brand-pressed',
  '--ll-brand-tint', '--ll-brand-weak', '--ll-on-brand', '--ll-on-brand-rgb',
  '--ll-on-glass', '--ll-on-glass-rgb', '--ll-on-glass-2', '--ll-on-glass-3',
  '--ll-surface-1', '--ll-surface-2', '--ll-popup-bg', '--ll-stroke-1', '--ll-stroke-2',
  '--ll-secondary', '--ll-tertiary', '--ll-danger', '--ll-on-danger',
  '--ll-acrylic', '--ll-material-opacity', '--ll-material-blur'
]);

const SCOPE = '.standalone-mini-profile-container[data-liuli-standalone-profile="1"]';
const PROFILE_CSS = `
${SCOPE} {
  --text_primary: var(--ll-on-glass) !important;
  --text_primary_light: var(--ll-on-glass-2) !important;
  --text_secondary: var(--ll-on-glass-2) !important;
  --text_secondary_01: var(--ll-on-glass-2) !important;
  --text_secondary_02: var(--ll-on-glass-3) !important;
  --text_tertiary: var(--ll-on-glass-3) !important;
  --text_link: var(--ll-brand) !important;
  --text_black: var(--ll-on-glass) !important;
  --text_white: var(--ll-on-brand) !important;
  --text_allwhite_primary: var(--ll-on-brand) !important;
  --icon_primary: var(--ll-on-glass) !important;
  --icon_secondary: var(--ll-on-glass-2) !important;
  --icon_tertiary: var(--ll-on-glass-3) !important;
  --icon_brand: var(--ll-brand) !important;
  --icon_white: var(--ll-on-brand) !important;
  --brand_standard: var(--ll-brand) !important;
  --brand_text: var(--ll-brand) !important;
  --on_brand_primary: var(--ll-on-brand) !important;
  --on_brand_secondary: var(--ll-on-brand) !important;
  --button-primary-default: var(--ll-brand) !important;
  --button-primary-hover: var(--ll-brand-hover) !important;
  --button-primary-pressed: var(--ll-brand-pressed) !important;
  --button-primary-disable: rgba(var(--ll-brand-rgb), .32) !important;
  --button-secondary-default: rgba(var(--ll-on-glass-rgb), .1) !important;
  --button-secondary-hover: rgba(var(--ll-on-glass-rgb), .16) !important;
  --button-secondary-pressed: rgba(var(--ll-on-glass-rgb), .22) !important;
  --border_primary: var(--ll-stroke-2) !important;
  --border_standard: var(--ll-stroke-2) !important;
  --border_secondary: var(--ll-stroke-2) !important;
  --divider_standard: var(--ll-stroke-2) !important;
  --bg_white: transparent !important;
  --bg_grey_standard: transparent !important;
  --bg_bottom_standard: transparent !important;
  --bg_middle_standard: transparent !important;
  --bg_top_standard: transparent !important;
  color: var(--ll-on-glass) !important;
  background: var(--ll-popup-bg) !important;
  border-color: var(--ll-stroke-2) !important;
}
${SCOPE} .contact-mini-profile {
  color: var(--ll-on-glass) !important;
  background: rgba(var(--ll-acrylic), var(--ll-material-opacity, .85)) !important;
  backdrop-filter: var(--ll-material-blur, none) !important;
  -webkit-backdrop-filter: var(--ll-material-blur, none) !important;
  border-color: var(--ll-stroke-2) !important;
}
${SCOPE} .contact-mini-profile .buddy-profile {
  color: var(--ll-on-glass) !important;
  background: transparent !important;
  border-color: var(--ll-stroke-2) !important;
}
${SCOPE} .q-button--primary {
  color: var(--ll-on-brand) !important;
  background: var(--ll-brand) !important;
  border-color: transparent !important;
}
${SCOPE} .q-button--primary:hover:not(:disabled):not(.q-button--disabled) {
  background: var(--ll-brand-hover) !important;
}
${SCOPE} .q-button--primary:active:not(:disabled):not(.q-button--disabled) {
  background: var(--ll-brand-pressed) !important;
}
${SCOPE} .q-button--primary:is(:disabled, .q-button--disabled) {
  background: rgba(var(--ll-brand-rgb), .32) !important;
}
${SCOPE} .q-button--primary :is(span, .q-svg-icon) {
  color: inherit !important;
}
`;

function isBlank(url) {
  return url === 'about:blank';
}

function isSource(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'app:' && parsed.pathname.endsWith('/renderer/index.html') &&
      /^#\/main(?:[/?]|$)/.test(parsed.hash);
  } catch {
    return false;
  }
}

function sanitizePalette(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const vars = {};
  for (const name of VARIABLES) {
    const value = input[name];
    if (typeof value !== 'string' || !value.trim() || value.length > 128) continue;
    // Values are data for CSSStyleDeclaration, never stylesheet source. Also
    // reject indirect references/resources so the allowlist cannot carry URLs.
    if (/[;{}<>\\]|(?:url|var|image|expression)\s*\(/i.test(value)) continue;
    vars[name] = value.trim();
  }
  return vars['--ll-brand'] && vars['--ll-on-brand'] && vars['--ll-on-glass'] &&
    vars['--ll-popup-bg'] ? vars : null;
}

// This function is serialized into the *already themed main window* only.
function watchSource(config) {
  const key = '__snowloraLiuliProfileSource';
  if (window[key]?.token === config.token) {
    window[key].refresh();
    return;
  }
  window[key]?.dispose();
  let timer;
  let last = '';
  function read() {
    clearTimeout(timer);
    timer = null;
    if (!/^#\/main(?:[/?]|$)/.test(location.hash) || !document.body) return;
    const computed = getComputedStyle(document.body);
    const vars = {};
    for (const name of config.variables) vars[name] = computed.getPropertyValue(name).trim();
    const value = JSON.stringify(vars);
    if (value === last) return;
    last = value;
    console.log(config.token + JSON.stringify({ kind: 'palette', vars }));
  }
  function schedule() {
    if (timer == null) timer = setTimeout(read, 40);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { attributes: true });
  observer.observe(document.documentElement, { attributes: true });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', schedule);
  addEventListener('liuli-route', schedule);
  function dispose() {
    observer.disconnect();
    clearTimeout(timer);
    media.removeEventListener('change', schedule);
    removeEventListener('liuli-route', schedule);
    removeEventListener('pagehide', dispose);
    delete window[key];
  }
  window[key] = { token: config.token, refresh() { last = ''; read(); }, dispose };
  addEventListener('pagehide', dispose, { once: true });
  read();
}

// This tiny controller is allowed in about:blank, but installs no styles until
// the full known DOM chain exists. Pooled shells are checked on DOM mutations,
// with no retry loop, interval, theme assets, wallpaper or message hooks.
function watchProfile(config) {
  if (location.href !== 'about:blank') return false;
  const key = '__snowloraLiuliProfile';
  if (window[key]?.token === config.token) return window[key].scan();
  window[key]?.dispose();
  const roots = new Map();
  let palette = null;
  let style = null;
  let scheduled = false;
  let reported = false;
  let disposed = false;
  function restore(root, saved) {
    for (const [name, old] of saved) {
      if (old.value) root.style.setProperty(name, old.value, old.priority);
      else root.style.removeProperty(name);
    }
    root.removeAttribute('data-liuli-standalone-profile');
  }
  function paint(root, saved) {
    for (const name of config.variables) {
      if (!saved.has(name)) saved.set(name, {
        value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name)
      });
      if (palette[name]) root.style.setProperty(name, palette[name]);
      else {
        const old = saved.get(name);
        if (old.value) root.style.setProperty(name, old.value, old.priority);
        else root.style.removeProperty(name);
      }
    }
    root.setAttribute('data-liuli-standalone-profile', '1');
  }
  function scan() {
    scheduled = false;
    if (disposed) return false;
    const found = new Set([...document.querySelectorAll('.standalone-mini-profile-container')]
      .filter(root => root.querySelector('.contact-mini-profile .buddy-profile')));
    for (const [root, saved] of roots) {
      if (found.has(root)) continue;
      restore(root, saved);
      roots.delete(root);
    }
    for (const root of found) {
      if (!roots.has(root)) roots.set(root, new Map());
      if (palette) paint(root, roots.get(root));
    }
    if (found.size && palette) {
      if (!style) {
        style = document.createElement('style');
        style.id = 'liuli-standalone-profile-style';
        style.textContent = config.css;
        (document.head || document.documentElement).appendChild(style);
      }
    } else {
      style?.remove();
      style = null;
    }
    const present = found.size > 0;
    if (present !== reported) {
      reported = present;
      console.log(config.token + JSON.stringify({ kind: 'profile', present }));
    }
    return present;
  }
  const observer = new MutationObserver(records => {
    if (scheduled || !records.some(record => record.type === 'childList' || record.type === 'attributes')) return;
    scheduled = true;
    queueMicrotask(scan);
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  function update(vars) {
    palette = vars;
    // Recheck the structure before applying updates, including reused cards.
    if (!palette) for (const [root, saved] of roots) restore(root, saved);
    return scan();
  }
  function dispose() {
    disposed = true;
    observer.disconnect();
    for (const [root, saved] of roots) restore(root, saved);
    roots.clear();
    style?.remove();
    removeEventListener('pagehide', dispose);
    delete window[key];
  }
  window[key] = { token: config.token, scan, update, dispose };
  addEventListener('pagehide', dispose, { once: true });
  return scan();
}

function createProfileSync({ log = () => {} } = {}) {
  const records = new Map();
  let currentPalette = null;
  let currentSource = null;
  function url(record) {
    try { return record.wc.isDestroyed() ? '' : record.wc.getURL(); } catch { return ''; }
  }
  async function execute(record, script) {
    try {
      if (record.wc.isDestroyed()) return null;
      return await record.wc.executeJavaScript(script);
    } catch {
      // A pooled window may navigate or be destroyed between the check and call.
      return null;
    }
  }
  function publish(record) {
    if (!record.present || !isBlank(url(record))) return;
    const signature = JSON.stringify(currentPalette);
    if (signature === record.sent) return;
    record.sent = signature;
    const token = record.token;
    // The renderer token prevents an in-flight update from reaching a new document.
    record.updates = record.updates.catch(() => {}).then(() => {
      if (record.token !== token || !record.present || !isBlank(url(record))) return;
      return execute(record, `window.__snowloraLiuliProfile?.token === ${JSON.stringify(token)} && window.__snowloraLiuliProfile.update(${signature})`);
    });
  }
  function clearSource(record) {
    if (currentSource !== record) return;
    currentSource = null;
    currentPalette = null;
    for (const target of records.values()) publish(target);
  }
  function kick(record) {
    const target = url(record);
    if (!isSource(target)) clearSource(record);
    if (!isBlank(target) && !(record.state.applied && isSource(target))) return;
    const mode = isBlank(target) ? 'profile' : 'source';
    // DOM-ready / finish / repeated attach share a single pending operation.
    if (record.pending) {
      record.again = true;
      return record.pending;
    }
    const token = record.token;
    const config = { token, variables: VARIABLES };
    const script = mode === 'profile'
      ? `(${watchProfile.toString()})(${JSON.stringify({ ...config, css: PROFILE_CSS })})`
      : `(${watchSource.toString()})(${JSON.stringify(config)})`;
    record.pending = execute(record, script).then(present => {
      if (record.token !== token || !isBlank(url(record)) || mode !== 'profile') return;
      record.present = present === true;
      if (record.present) publish(record);
    }).finally(() => {
      record.pending = null;
      if (record.again) {
        record.again = false;
        kick(record);
      }
    });
    return record.pending;
  }
  function attach(state) {
    const wc = state.wc;
    if (records.has(wc.id)) return;
    const record = { wc, state, token: '[liuli-profile:' + randomUUID() + ']', present: false,
      sent: undefined, pending: null, again: false, updates: Promise.resolve() };
    records.set(wc.id, record);
    wc.on('console-message', details => {
      if (details.frame !== wc.mainFrame || typeof details.message !== 'string' ||
          details.message.length > 16384 || !details.message.startsWith(record.token)) return;
      let message;
      try { message = JSON.parse(details.message.slice(record.token.length)); } catch { return; }
      if (message.kind === 'palette' && state.applied && isSource(url(record))) {
        const vars = sanitizePalette(message.vars);
        if (!vars) return;
        currentPalette = vars;
        currentSource = record;
        for (const target of records.values()) publish(target);
      } else if (message.kind === 'profile' && isBlank(url(record))) {
        record.present = message.present === true;
        record.sent = undefined;
        if (record.present) {
          publish(record);
          log({ event: 'profile-ready', window: wc.id });
        }
      }
    });
    wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      clearSource(record);
      record.token = '[liuli-profile:' + randomUUID() + ']';
      record.present = false;
      record.sent = undefined;
    });
    wc.on('dom-ready', () => kick(record));
    wc.on('did-finish-load', () => kick(record));
    wc.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) kick(record);
    });
    wc.once('destroyed', () => {
      records.delete(wc.id);
      clearSource(record);
    });
    if (!wc.isLoadingMainFrame()) kick(record);
  }
  function themeReady(state) {
    attach(state);
    const record = records.get(state.wc.id);
    if (record) return kick(record);
  }
  return { attach, themeReady };
}

module.exports = createProfileSync;
// Also used by local regressions: no Electron or QQ process is needed.
module.exports.testing = { VARIABLES, PROFILE_CSS, isBlank, isSource, sanitizePalette, watchSource, watchProfile };
