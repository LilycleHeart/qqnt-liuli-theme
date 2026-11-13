'use strict';

// Development-only bridge for the old installSwitchMotion pointerdown closure.
// The prefix/header production implementation lives in renderer/pin-groups.js.
function installCompatibility() {
  window.__liuliPinPrefixCompatibility?.dispose();
  const selector = ':scope > .liuli-pin-heading';
  const pending = new Map();
  let disposed = false;

  function restore(row, state) {
    if (pending.get(row) !== state) return;
    pending.delete(row);
    const current = Object.getOwnPropertyDescriptor(row, 'querySelector');
    // Another owner may have replaced its own method during this event.
    if (current?.value !== state.replacement) return;
    if (state.descriptor) Object.defineProperty(row, 'querySelector', state.descriptor);
    else delete row.querySelector;
  }

  function onPointerDown(event) {
    if (disposed || event.button !== 0 || !event.target?.closest) return;
    const heading = event.target.closest('.liuli-pin-heading');
    if (heading) {
      // Also handle synthetic same-task reentrancy before the queued cleanup.
      const row = heading.closest('.recent-contact-item');
      if (pending.has(row)) restore(row, pending.get(row));
      return;
    }
    const row = event.target.closest('.recent-contact-item');
    if (!row || !row.closest('.recent-contact') || row.closest('.viewport-list__measure')) return;
    if (!['first', 'single'].includes(row.getAttribute('data-liuli-pin'))) return;
    const offset = event.clientY - row.getBoundingClientRect().top;
    if (!Number.isFinite(offset) || offset < 0 || offset > 28 || pending.has(row)) return;
    const descriptor = Object.getOwnPropertyDescriptor(row, 'querySelector');
    if (descriptor && !descriptor.configurable && (!('value' in descriptor) || !descriptor.writable)) return;
    const original = row.querySelector;
    if (typeof original !== 'function' || !original.call(row, selector)) return;
    const replacement = function (...args) {
      if (this === row && args[0] === selector) return null;
      return original.apply(this, args);
    };
    const state = { descriptor, replacement };
    Object.defineProperty(row, 'querySelector', {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? false,
      writable: true,
      value: replacement
    });
    pending.set(row, state);
    queueMicrotask(() => restore(row, state));
  }

  // Window capture runs before the already-installed document capture listener.
  window.addEventListener('pointerdown', onPointerDown, true);
  const api = {
    get pendingRows() { return pending.size; },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('pointerdown', onPointerDown, true);
      for (const [row, state] of pending) restore(row, state);
      if (window.__liuliPinPrefixCompatibility === api) delete window.__liuliPinPrefixCompatibility;
    }
  };
  window.__liuliPinPrefixCompatibility = api;
}

function generate() { return '(' + installCompatibility.toString() + ')();\n'; }
module.exports = generate;
if (require.main === module) process.stdout.write(generate());
