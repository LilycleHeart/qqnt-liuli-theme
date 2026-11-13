'use strict';
// Dev-only compatibility for a running pre-TIM-grouping index closure.
// Generating this script never connects to QQ or changes user settings.
const fs = require('node:fs');
const path = require('node:path');
function installTimGroupingCompatibility() {
  window.__liuliTimGroupingCompatibility?.dispose();
  // The complete layout adapter already owns the same production grouping.
  // Do not add another observer/writer when that upgraded adapter is present.
  if (window.__liuliTimLayoutCompatibility?.groupingWriteOwner) {
    window.__liuliTimLayoutCompatibility.refresh();
    return;
  }
  let llModeCfg = {};
  let applying = false;
  /* GROUP_WRITE_GUARD */
  const groupWrites = createTimGroupingWriteGuard(() => applying || currentMode() !== 'tim');
  /* GROUP_FUNCTION */
  const areas = new Map();
  let frame = 0;
  let disposed = false;
  let passes = 0;
  const currentMode = () => window.__liuliSettingsCache?.chatStyle || document.body.dataset.liuliChatStyle;
  function flush() {
    frame = 0;
    if (disposed) return;
    for (const [area, observer] of areas) {
      if (!area.isConnected) { observer.disconnect(); areas.delete(area); }
    }
    groupWrites.prune();
    if (currentMode() !== 'tim') return;
    llModeCfg = { ...(window.__liuliSettingsCache || {}), chatStyle: 'tim' };
    for (const area of areas.keys()) for (const row of area.querySelectorAll('.message-container')) groupWrites.capture(row);
    applying = true;
    try { groupMessages(); } finally { applying = false; }
    passes++;
    // Our own group attributes must not schedule another frame. Native/old
    // closure mutations arriving later are still observed normally.
    for (const observer of areas.values()) observer.takeRecords();
  }
  function schedule() {
    if (!disposed && !frame && currentMode() === 'tim') frame = requestAnimationFrame(flush);
  }
  function attach(area) {
    if (areas.has(area)) return false;
    const observer = new MutationObserver(records => {
      for (const row of area.querySelectorAll('.message-container')) groupWrites.capture(row);
      groupWrites.prune();
      if (records.some(record => record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1))) schedule();
    });
    observer.observe(area, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['id', 'data-index', 'data-liuli-g'] });
    areas.set(area, observer);
    return true;
  }
  function discover(root) {
    if (!(root instanceof Element)) return false;
    if (root.matches('.chat-msg-area')) return attach(root);
    if (root.closest('.chat-msg-area,.recent-contact,.group-member,.ml-item,.message-container')) return false;
    let changed = false;
    for (const area of root.querySelectorAll('.chat-msg-area')) changed = attach(area) || changed;
    return changed;
  }
  const discovery = new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      if (record.target instanceof Element && record.target.closest('.chat-msg-area,.recent-contact,.group-member')) continue;
      for (const node of record.addedNodes) changed = discover(node) || changed;
    }
    for (const [area, observer] of areas) if (!area.isConnected) {
      observer.disconnect(); areas.delete(area);
    }
    groupWrites.prune();
    if (changed) schedule();
  });
  discovery.observe(document.body, { childList: true, subtree: true });
  const modeObserver = new MutationObserver(schedule);
  modeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-liuli-chat-style'] });
  const onStorage = event => { if (event.key === 'liuli-dsh-settings') schedule(); };
  const onVisible = () => { if (!document.hidden) schedule(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('liuli-scope', schedule);
  document.addEventListener('visibilitychange', onVisible);
  discover(document.body);
  const api = {
    get passes() { return passes; },
    get areas() { return areas.size; },
    get blockedGroupWrites() { return groupWrites.blocked; },
    refresh: flush,
    dispose(options = {}) {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame); frame = 0;
      discovery.disconnect(); modeObserver.disconnect();
      for (const observer of areas.values()) observer.disconnect();
      groupWrites.dispose();
      if (options.restoreSingle && currentMode() === 'tim') {
        for (const area of areas.keys()) for (const row of area.querySelectorAll('.message-container[data-liuli-g]')) {
          row.dataset.liuliG = 'single';
          row.removeAttribute('data-liuli-tim-text');
        }
      }
      areas.clear();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('liuli-scope', schedule);
      document.removeEventListener('visibilitychange', onVisible);
      if (window.__liuliTimGroupingCompatibility === api) delete window.__liuliTimGroupingCompatibility;
    }
  };
  window.__liuliTimGroupingCompatibility = api;
  flush();
}
function generate(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
  const start = source.indexOf('  function groupMessages()');
  const end = source.indexOf('  function stickAvatars()', start);
  if (start < 0 || end < 0) throw Error('Missing production groupMessages');
  return '(' + installTimGroupingCompatibility.toString()
    .replace('/* GROUP_WRITE_GUARD */', require('./tim-grouping-write-guard.cjs').toString())
    .replace('/* GROUP_FUNCTION */', source.slice(start, end)) + ')();\n';
}
module.exports = generate;
if (require.main === module) {
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../output/playwright/tim-shape-20261113/tim-group-compat.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, generate());
  console.log(output);
}
