'use strict';
// Development-only bridge for a renderer whose old switch listener cannot be
// disposed. Generation never connects to QQ, edits settings, or reloads index.
const fs = require('node:fs');
const path = require('node:path');

function installSameNameSwitchCompatibility() {
  window.__liuliSameNameSwitchCompatibility?.dispose();
  // A normal startup owns the corrected, disposable production controller.
  if (window.__liuliSwitchMotion) return;
  const motion = window.LiuliMotion;
  if (!motion) return;
  const LL_ENTER_MAX = 14;
  /* PRODUCTION_PEER */
  /* PRODUCTION_ENTER */
  const TITLE = '.aio .chat-header .panel-header__title';
  const AREA = '.chat-msg-area';
  const IN = [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }];
  const options = { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' };
  let round = null, frame = 0, timer = 0, disposed = false;
  let blockedMarkers = 0, blockedFallbacks = 0, revealed = 0;
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const title = () => document.querySelector(TITLE);
  function matches(frames, config, entry) {
    return Array.isArray(frames) && frames.length === 2 && config?.duration === (entry ? 220 : 120) &&
      config.fill === (entry ? 'backwards' : 'forwards') &&
      Number(frames[0].opacity) === (entry ? 0 : 1) && Number(frames[1].opacity) === (entry ? 1 : 0) &&
      frames[0].transform === (entry ? 'translateY(10px)' : 'none') &&
      frames[1].transform === (entry ? 'none' : 'translateY(-6px)');
  }
  function guard(state, element) {
    if (!element || state.guards.has(element)) return;
    const methods = new Map();
    for (const method of element.matches(AREA) ? ['animate', 'setAttribute'] : ['animate']) {
      const descriptor = Object.getOwnPropertyDescriptor(element, method);
      const original = element[method];
      const wrapper = method === 'animate' ? function (frames, config) {
        if (matches(frames, config, true) && /\bswEnter\b/.test(new Error().stack || '')) {
          if (state.revealed) {
            blockedFallbacks++;
            // Give the old motion owner a real, empty Animation to release. Its
            // timeout must not replay a visible entry after the repaired entry.
            return original.call(this, [{}, {}], { duration: 0, fill: 'none' });
          }
          // An empty destination still uses the legacy timeout. Remove our
          // replacement-area hold before its ordinary fallback entry starts.
          state.fallback = true;
          cancelAnimationFrame(frame); frame = 0;
          for (const hold of state.holds.values()) hold.cancel();
          state.holds.clear();
        }
        const animation = original.call(this, frames, config);
        if (matches(frames, config, false)) state.exits.add(animation);
        return animation;
      } : function (name, value) {
        if (state.revealed && name === 'data-ll-switching' && /\bswTick\b/.test(new Error().stack || '')) {
          blockedMarkers++;
          return;
        }
        return original.call(this, name, value);
      };
      Object.defineProperty(element, method, { configurable: true, writable: true, value: wrapper });
      methods.set(method, { descriptor, original, wrapper });
    }
    state.guards.set(element, methods);
  }
  function animate(state, element, frames = IN, config = options) {
    if (!element?.isConnected) return;
    guard(state, element);
    const animation = state.guards.get(element).get('animate').original.call(element, frames, config);
    state.owned.add(animation);
    animation.finished.then(() => { state.owned.delete(animation); animation.cancel(); }, () => state.owned.delete(animation));
    return animation;
  }
  function release() {
    clearTimeout(timer); timer = 0;
    cancelAnimationFrame(frame); frame = 0;
    const state = round;
    if (!state) return;
    round = null;
    for (const animation of [...state.exits, ...state.owned, ...state.holds.values()]) {
      try { animation.cancel(); } catch (_) {}
    }
    for (const [element, methods] of state.guards) for (const [method, { descriptor, wrapper }] of methods) {
      if (element[method] !== wrapper) continue;
      if (descriptor) Object.defineProperty(element, method, descriptor);
      else delete element[method];
    }
    state.guards.clear();
  }
  function observeArea(state) {
    const area = document.querySelector(AREA);
    guard(state, area); guard(state, title());
    if (area && area !== state.oldArea && !state.revealed && !state.holds.has(area)) {
      // The native router may replace the entire area. Hold only that new area
      // before its first paint, just as the old controller holds a reused area.
      const original = state.guards.get(area).get('animate').original;
      state.holds.set(area, original.call(area, [{ opacity: 0 }, { opacity: 0 }], { duration: 0, fill: 'forwards' }));
      area.setAttribute('data-ll-switching', '');
    }
    return area;
  }
  function visible(area) {
    const bounds = area.getBoundingClientRect();
    return [...area.querySelectorAll('.ml-item')].filter(item => {
      if (item.closest('.viewport-list__measure')) return false;
      const rect = item.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2 && rect.bottom >= bounds.top && rect.top <= bounds.bottom;
    });
  }
  function tick() {
    frame = 0;
    const state = round;
    if (!state || state.revealed || state.fallback || disposed) return;
    if (window.__liuliSwitchMotion || document.hidden || motion.reduced) { release(); return; }
    const area = observeArea(state);
    const peer = llMessagePeerKey(area);
    if (!peer || peer === state.oldPeer || norm(title()?.textContent) !== state.title) {
      frame = requestAnimationFrame(tick); return;
    }
    const items = visible(area);
    const last = items.at(-1);
    if (!last) { frame = requestAnimationFrame(tick); return; }
    const id = String(last.id || '');
    const top = last.getBoundingClientRect().top;
    if (id && id === state.sampleId && Math.abs(top - state.sampleTop) < .5) state.stable++;
    else { state.sampleId = id; state.sampleTop = top; state.stable = 0; }
    if (state.stable < 2) { frame = requestAnimationFrame(tick); return; }
    state.revealed = true; revealed++;
    for (const animation of [...state.exits, ...state.holds.values()]) { try { animation.cancel(); } catch (_) {} }
    animate(state, title()); animate(state, area);
    llAnimateEnter(items);
    for (const element of state.guards.keys()) if (element.matches(AREA)) element.removeAttribute('data-ll-switching');
    window.__liuliSidePaneMotion?.messageReady();
  }
  function pointerdown(event) {
    const item = event.target.closest?.('.recent-contact-item');
    if (!item || event.button !== 0 || item.closest('.viewport-list__measure')) return;
    release();
    if (window.__liuliSwitchMotion || document.hidden || motion.reduced ||
      item.classList.contains('recent-contact-item--selected') || event.target.closest('.liuli-pin-heading')) return;
    const heading = item.querySelector(':scope > .liuli-pin-heading');
    const y = event.clientY - item.getBoundingClientRect().top;
    if (heading && y >= -28 && y < 0) return;
    const selected = [...document.querySelectorAll('.recent-contact-item--selected')].find(row => !row.closest('.viewport-list__measure'));
    if (window.LiuliQQ?.contactType(item) !== 1 || window.LiuliQQ?.contactType(selected) !== 1) return;
    const name = norm(item.querySelector('.contact-name__text, .contact-name')?.textContent);
    const currentTitle = norm(title()?.textContent);
    const oldArea = document.querySelector(AREA), oldPeer = llMessagePeerKey(oldArea);
    if (!name || name !== currentTitle || !oldPeer) return;
    const state = { title: currentTitle, oldPeer, oldArea, guards: new Map(), exits: new Set(),
      owned: new Set(), holds: new Map(), sampleId: '', sampleTop: 0, stable: 0, revealed: false };
    round = state;
    guard(state, oldArea); guard(state, title());
    // Legacy SW_MAX is 1500ms. Restore these instance methods just after its
    // final poll, even when the destination was empty and needed that fallback.
    timer = setTimeout(release, 1650);
    frame = requestAnimationFrame(tick);
  }
  const observer = new MutationObserver(() => {
    if (!round || round.revealed || round.fallback || disposed) return;
    observeArea(round);
    if (!frame) frame = requestAnimationFrame(tick);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  function visibility() { if (document.hidden) release(); }
  window.addEventListener('pointerdown', pointerdown, { capture: true, passive: true });
  document.addEventListener('visibilitychange', visibility);
  const api = { get running() { return !!round; }, get revealed() { return revealed; },
    get blockedMarkers() { return blockedMarkers; }, get blockedFallbacks() { return blockedFallbacks; },
    dispose() {
      if (disposed) return;
      disposed = true; release(); observer.disconnect();
      window.removeEventListener('pointerdown', pointerdown, true);
      document.removeEventListener('visibilitychange', visibility);
      if (window.__liuliSameNameSwitchCompatibility === api) delete window.__liuliSameNameSwitchCompatibility;
    } };
  window.__liuliSameNameSwitchCompatibility = api;
}

function generate(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
  function helper(name) {
    const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }', start);
    if (start < 0 || end < start) throw Error('Missing production helper ' + name);
    return source.slice(start, end + 4);
  }
  return '(' + installSameNameSwitchCompatibility.toString()
    .replace('/* PRODUCTION_PEER */', helper('llMessagePeerKey'))
    .replace('/* PRODUCTION_ENTER */', helper('llAnimateEnter')) + ')();\n';
}
module.exports = generate;
if (require.main === module) {
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../output/playwright/same-name-switch-20261114/same-name-switch-compat.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, generate()); console.log(output);
}
