'use strict';
// Per-instance gate for old renderer color passes. No QQ connection/settings writes.
const fs = require('node:fs');
const path = require('node:path');
function installMessageColorCompatibility() {
  window.__liuliMessageColorCompatibility?.dispose();
  /* PRODUCTION_HELPERS */
  let observer = null, disposed = false;
  const scope = '.chat-msg-area,.recent-contact';
  const excluded = '#liuli-scroll-time,#liuli-settings-dialog,.liuli-pane-transition,.liuli-pane-prepared';
  const colors = createMessageColorRepair({ legacyGate: true, afterWrite: () => observer?.takeRecords() });
  observer = new MutationObserver(records => {
    const roots = new Set();
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!target || target.closest(excluded)) continue;
      if (record.type === 'childList') {
        if (target.closest(scope)) { colors.invalidate(target, false); roots.add(target); }
        for (const node of record.addedNodes) if (node.nodeType === 1 && !node.closest(excluded)) {
          if (node.closest(scope)) { colors.invalidate(node); roots.add(node); }
          else for (const area of node.querySelectorAll(scope)) roots.add(area);
        }
      } else if (target.closest(scope)) {
        if (record.type === 'attributes' && record.attributeName === 'class') {
          const native = value => (value || '').split(/\s+/).filter(name => !/^(?:ll-|liuli-)/.test(name)).sort().join(' ');
          if (native(record.oldValue) === native(target.getAttribute('class'))) continue;
        }
        colors.invalidate(target); roots.add(target);
      }
    }
    if (roots.size) colors.enqueue(topLevelRoots([...roots]));
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class', 'id'] });
  colors.enqueue([...document.querySelectorAll(scope)]);
  const api = { get stats() { return colors.stats; }, refresh() { colors.invalidate(document.body); colors.enqueue([...document.querySelectorAll(scope)]); },
    dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect(); colors.dispose();
      if (window.__liuliMessageColorCompatibility === api) delete window.__liuliMessageColorCompatibility;
    } };
  window.__liuliMessageColorCompatibility = api;
}
function generate(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
  const names = ['elementsWithin', 'topLevelRoots', 'createMessageColorRepair'];
  const helpers = names.map(name => {
    const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }', start);
    if (start < 0 || end < start) throw Error('Missing production helper ' + name);
    return source.slice(start, end + 4);
  });
  const constants = ['QQ_COLOR_MAP', 'DIM_COLORS', 'TEXT_SELECTORS'].map(name => {
    const start = source.indexOf('  const ' + name + ' = '), end = source.indexOf(';', start);
    if (start < 0 || end < start) throw Error('Missing color constant ' + name);
    return source.slice(start, end + 1);
  });
  return '(' + installMessageColorCompatibility.toString().replace('/* PRODUCTION_HELPERS */', [...constants, ...helpers].join('\n')) + ')();\n';
}
module.exports = generate;
if (require.main === module) {
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, generate()); console.log(output);
}
