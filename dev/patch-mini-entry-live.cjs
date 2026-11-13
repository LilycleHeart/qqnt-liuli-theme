'use strict';
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(process.argv[2]);
const script = `(() => {
  window.__liuliMiniEntryCompatibility?.dispose();
  const entries = new Map();
  function protect(entry) {
    if (entries.has(entry)) return;
    const style = entry.style;
    const descriptor = Object.getOwnPropertyDescriptor(style, 'setProperty');
    const original = style.setProperty;
    Object.defineProperty(style, 'setProperty', {
      configurable: true,
      value: function (name, value, priority) {
        // The running legacy closure still hides this native entry on layout.
        // Ignore only that call; QQ's own style writes continue unchanged.
        if (name === 'display' && value === 'none' && priority === 'important' &&
            new Error().stack?.includes('mountSettingsEntry')) return;
        return original.call(this, name, value, priority);
      }
    });
    entries.set(entry, { style, descriptor });
    if (style.getPropertyValue('display') === 'none' &&
        style.getPropertyPriority('display') === 'important') style.removeProperty('display');
  }
  function refresh() {
    document.querySelectorAll('.window-control-area .mini-fishing-entry').forEach(protect);
    for (const [entry, saved] of entries) if (!entry.isConnected) {
      if (saved.descriptor) Object.defineProperty(saved.style, 'setProperty', saved.descriptor);
      else delete saved.style.setProperty;
      entries.delete(entry);
    }
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
      node.nodeType === 1 && (node.matches('.window-control-area,.mini-fishing-entry') ||
        node.querySelector('.window-control-area,.mini-fishing-entry'))))) refresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  refresh();
  window.__liuliMiniEntryCompatibility = {
    refresh,
    dispose() {
      observer.disconnect();
      for (const saved of entries.values()) {
        if (saved.descriptor) Object.defineProperty(saved.style, 'setProperty', saved.descriptor);
        else delete saved.style.setProperty;
      }
      entries.clear();
      delete window.__liuliMiniEntryCompatibility;
    }
  };
})();`;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, script + '\n');
console.log(output);
