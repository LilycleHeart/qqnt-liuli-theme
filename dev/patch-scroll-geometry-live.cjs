'use strict';

// Development-only bridge for already loaded geometry-reading closures.
// New renderer code keeps these reads out of its per-message scroll path.
function installCompatibility() {
  window.__liuliScrollGeometryCompatibility?.dispose();
  const selector = '.chat-msg-area,.chat-msg-area__vlist';
  const guards = new Map();
  let disposed = false;

  function unusedStickyGeometry() {
    const settings = window.__liuliSettingsCache;
    const avatar = settings?.avatarPosition || document.body?.dataset.liuliAvatarPosition;
    const style = settings?.chatStyle || document.body?.dataset.liuliChatStyle;
    return avatar === 'top' || style === 'classic';
  }

  function restore(area, state) {
    guards.delete(area);
    resize.unobserve(area);
    if (Object.getOwnPropertyDescriptor(area, 'getBoundingClientRect')?.value === state.replacement) {
      if (state.descriptor) Object.defineProperty(area, 'getBoundingClientRect', state.descriptor);
      else delete area.getBoundingClientRect;
    }
    if (state.widthReplacement && Object.getOwnPropertyDescriptor(area, 'clientWidth')?.get === state.widthReplacement) {
      if (state.widthDescriptor) Object.defineProperty(area, 'clientWidth', state.widthDescriptor);
      else delete area.clientWidth;
    }
  }

  function bind(area) {
    if (guards.has(area) || !area.isConnected) return;
    const descriptor = Object.getOwnPropertyDescriptor(area, 'getBoundingClientRect');
    if (descriptor && !descriptor.configurable && (!('value' in descriptor) || !descriptor.writable)) return;
    const original = area.getBoundingClientRect;
    if (typeof original !== 'function') return;
    const state = { descriptor, original, rect: original.call(area), replacement: null };
    const replacement = function (...args) {
      if (this === area && unusedStickyGeometry() && /\bstickAvatars\b/.test(new Error().stack || '')) return state.rect;
      return original.apply(this, args);
    };
    state.replacement = replacement;
    Object.defineProperty(area, 'getBoundingClientRect', {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? false,
      writable: true,
      value: replacement
    });
    // Only the old syncBubbleWidth closure reads this cached width. Native QQ
    // consumers, borrowed getters and all other callers use the original getter.
    if (area.matches('.chat-msg-area')) {
      const widthDescriptor = Object.getOwnPropertyDescriptor(area, 'clientWidth');
      let owner = area, effective;
      while (owner && !(effective = Object.getOwnPropertyDescriptor(owner, 'clientWidth'))) owner = Object.getPrototypeOf(owner);
      if ((!widthDescriptor || widthDescriptor.configurable) && typeof effective?.get === 'function') {
        state.widthDescriptor = widthDescriptor;
        state.widthOriginal = effective.get;
        state.width = state.widthOriginal.call(area);
        state.widthReplacement = function () {
          if (this === area && /\bsyncBubbleWidth\b/.test(new Error().stack || '')) return state.width;
          return state.widthOriginal.call(this);
        };
        Object.defineProperty(area, 'clientWidth', {
          configurable: true,
          enumerable: widthDescriptor?.enumerable ?? false,
          get: state.widthReplacement,
          set: widthDescriptor?.set
        });
      }
    }
    guards.set(area, state);
    resize.observe(area);
  }

  const resize = new ResizeObserver(entries => {
    // ResizeObserver runs after native layout. This refresh never runs from
    // the old scroll callback, and uses the original instance method directly.
    for (const entry of entries) {
      const state = guards.get(entry.target);
      if (state && entry.target.isConnected) {
        state.rect = state.original.call(entry.target);
        if (state.widthOriginal) state.width = state.widthOriginal.call(entry.target);
      }
    }
  });
  function discover(node) {
    if (node.nodeType !== 1 || !node.isConnected) return;
    if (node.matches(selector)) {
      bind(node);
      for (const area of node.querySelectorAll(selector)) bind(area);
      return;
    }
    // Native message/row mounts do not change these stable viewport instances.
    if (node.closest('.ml-item,.viewport-list__measure,' + selector)) return;
    for (const area of node.querySelectorAll(selector)) bind(area);
  }
  for (const area of document.querySelectorAll(selector)) bind(area);
  const observer = new MutationObserver(records => {
    let removed = false;
    for (const record of records) {
      for (const node of record.addedNodes) discover(node);
      if (record.removedNodes.length) removed = true;
    }
    if (removed) for (const [area, state] of guards) if (!area.isConnected) restore(area, state);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const api = {
    get guardedAreas() { return guards.size; },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      for (const [area, state] of guards) restore(area, state);
      resize.disconnect();
      if (window.__liuliScrollGeometryCompatibility === api) delete window.__liuliScrollGeometryCompatibility;
    }
  };
  window.__liuliScrollGeometryCompatibility = api;
}

function generate() { return '(' + installCompatibility.toString() + ')();\n'; }
module.exports = generate;
if (require.main === module) process.stdout.write(generate());
