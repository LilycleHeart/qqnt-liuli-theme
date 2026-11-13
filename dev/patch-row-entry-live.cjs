'use strict';
// Disposable, per-instance adapter for the already running pre-fix closure.
const fs = require('node:fs');
const path = require('node:path');
function installCompatibility() {
  window.__liuliRowEntryCompatibility?.dispose();
  const motion = window.LiuliMotion;
  const LL_ENTER_MAX = 14;
  let applying = false, disposed = false, entry = null;
  const guards = new Map();
  /* HELPERS */
  const animateRows = llAnimateEnter;
  llAnimateEnter = rows => {
    applying = true;
    try { return animateRows(rows); } finally { applying = false; }
  };
  function guard(object, key, wrapper) {
    if (guards.get(object)?.has(key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(object, key), original = object[key];
    if (typeof original !== 'function') return;
    if (!guards.has(object)) guards.set(object, new Map());
    const replacement = wrapper(original);
    Object.defineProperty(object, key, { configurable: true, writable: true, value: replacement });
    guards.get(object).set(key, { descriptor, replacement });
  }
  // The old observer runs before an adapter can discover a newly mounted row.
  // Stop its obsolete tail-is-new classification before it sorts/reads layout,
  // rather than faking a rect or blocking the later CSS class write. Preserve
  // native argument/receiver validation, and affect only its direct call site.
  guard(DOMTokenList.prototype, 'contains', original => function (token) {
    const result = Reflect.apply(original, this, arguments);
    if (!disposed && !applying && result && token === 'ml-item' && arguments.length === 1) {
      const caller = (new Error().stack || '').split('\n')[2] || '';
      if (/^\s*at llHandleAdded(?: \(|$)/.test(caller)) return false;
    }
    return result;
  });
  function isLegacyEntry(frames, options) {
    return Number(options?.duration) === 460 && !options?.pseudoElement && Array.isArray(frames) &&
      frames.length === 2 && Number(frames[0].opacity) === 0 && frames[0].transform === 'translateY(14px)' &&
      Number(frames[1].opacity) === 1 && frames[1].transform === 'none';
  }
  function legacyAnimation(animation, row) {
    const effect = animation.effect;
    return effect?.target === row && !effect.pseudoElement &&
      isLegacyEntry(effect.getKeyframes(), effect.getTiming());
  }
  function discover(node, initial = false) {
    if (node.nodeType !== 1) return;
    const selector = '.ml-item,.recent-contact-item,.group-user';
    const rows = node.matches(selector) ? [node] : [...node.querySelectorAll(selector)];
    for (const row of rows) {
      if (!row.closest('.chat-msg-area,.recent-contact,.group-member')) continue;
      if (initial && row.matches('.ml-item') && !row.closest('[data-ll-switching]')) {
        clearTimeout(row.__llEnterT);
        if (row.classList.contains('ll-enter')) row.classList.remove('ll-enter');
      }
      for (const target of row.querySelectorAll('.message-content__wrapper,.avatar-span')) guard(target, 'animate', original => function (frames, options) {
        if (!disposed && !applying && /\bllMotionPass\b/.test(new Error().stack || '')) return original.call(this, [{}, {}], { duration: 0 });
        return Reflect.apply(original, this, arguments);
      });
      if (!row.matches('.recent-contact-item,.group-user') || guards.get(row)?.has('animate')) continue;
      // Register only owned 460ms llRiseIn animations. New production entries
      // are already tracked by LiuliMotion; pre-upgrade ones need this bridge.
      guard(row, 'animate', original => function (frames, options) {
        const animation = Reflect.apply(original, this, arguments);
        if (!disposed && isLegacyEntry(frames, options) && /\bllRiseIn\b/.test(new Error().stack || ''))
          entry?.trackLegacyEntry(this, animation);
        return animation;
      });
      // A single adoption check is needed only for a rise already in flight at
      // installation. Idle rows never call getAnimations, including on scroll.
      if (row.__llRiseAt && performance.now() - row.__llRiseAt < 1400)
        for (const animation of row.getAnimations?.() || [])
          if (legacyAnimation(animation, row)) entry?.trackLegacyEntry(row, animation);
    }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) discover(node);
    for (const [object, entries] of guards) {
      if ('isConnected' in object && !object.isConnected) restore(object, entries);
    }
  });
  function restore(object, entries) {
    for (const [key, { descriptor, replacement }] of entries) if (object[key] === replacement) {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else delete object[key];
    }
    guards.delete(object);
  }
  entry = installRowEntryMotion();
  discover(document.body, true);
  observer.observe(document.body, { childList: true, subtree: true });
  const api = { refresh: entry.refresh, get guardedObjects() { return guards.size; }, dispose() {
    if (disposed) return;
    disposed = true; observer.disconnect(); entry.dispose();
    for (const [object, entries] of guards) restore(object, entries);
    if (window.__liuliRowEntryCompatibility === api) delete window.__liuliRowEntryCompatibility;
  } };
  window.__liuliRowEntryCompatibility = api;
}
function generate(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
  const helpers = ['llAnimateEnter', 'installRowEntryMotion'].map(name => {
    const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }', start);
    if (start < 0 || end < start) throw Error('Missing ' + name);
    return source.slice(start, end + 4);
  }).join('\n');
  return '(' + installCompatibility.toString().replace('/* HELPERS */', helpers) + ')();\n';
}
module.exports = generate;
if (require.main === module) {
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, generate()); console.log(output);
}
