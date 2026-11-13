'use strict';
// Development-only adapter for an already running, pre-TIM-layout renderer.
// Generation never connects to QQ, changes its settings, or reinjects index.js.
const fs = require('node:fs');
const path = require('node:path');
function installTimLayoutCompatibility() {
  window.__liuliTimLayoutCompatibility?.dispose();
  window.__liuliTimGroupingCompatibility?.dispose();
  const KEY = 'liuli-dsh-settings';
  const PANEL = '#liuli-settings-dialog,#liuli-embedded,.liuli-embedded';
  let llModeCfg = {};
  let frame = 0, stickFrame = 0, disposed = false, applying = false, passes = 0, blocked = 0;
  const areas = new Map(), guards = new Map(), createdControls = new Set();
  /* GROUP_WRITE_GUARD */
  const groupWrites = createTimGroupingWriteGuard(() => applying);
  /* PRODUCTION_HELPERS */
  function readSettings() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) {}
    const cfg = { ...(window.__liuliSettingsCache || {}), ...stored };
    cfg.chatStyle = ['tg', 'tim', 'classic'].includes(cfg.chatStyle) ? cfg.chatStyle : document.body.dataset.liuliChatStyle || 'tg';
    cfg.avatarPosition = cfg.avatarPosition === 'top' ? 'top' : 'bottom';
    cfg.timSenderPosition = cfg.timSenderPosition === 'inside' ? 'inside' : 'outside';
    return cfg;
  }
  function savePlacement(value) {
    const latest = { ...readSettings(), timSenderPosition: value === 'inside' ? 'inside' : 'outside' };
    const serialized = JSON.stringify(latest);
    localStorage.setItem(KEY, serialized);
    // The existing renderer must compare its previous model before replacing
    // the cache; never mutate __liuliSettingsCache before this event.
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: serialized, storageArea: localStorage, url: location.href }));
    schedule();
  }
  function shouldBlock(target, node) {
    if (applying || llModeCfg.chatStyle !== 'tim' || llModeCfg.timSenderPosition !== 'inside' ||
        !node?.matches?.('.user-name') || node.parentElement?.closest('.message-container') !== target ||
        !node.parentElement?.matches('.msg-content-container')) return false;
    // A native renderer is free to reparent or replace its nodes. Only the old
    // theme helper's return-to-native-grid call conflicts with the new option.
    return /\bmoveSenderIntoBubble\b/.test(new Error().stack || '');
  }
  function guardRow(row) {
    groupWrites.capture(row);
    if (guards.has(row)) return;
    const descriptors = new Map();
    for (const method of ['appendChild', 'insertBefore']) {
      const descriptor = Object.getOwnPropertyDescriptor(row, method);
      const original = row[method];
      const wrapper = function (node, ...rest) {
        if (shouldBlock(this, node)) { blocked++; return node; }
        return original.call(this, node, ...rest);
      };
      descriptors.set(method, { descriptor, wrapper });
      Object.defineProperty(row, method, { configurable: true, writable: true, value: wrapper });
    }
    guards.set(row, descriptors);
  }
  function restoreGuard(row, descriptors) {
    for (const [method, { descriptor, wrapper }] of descriptors) {
      if (row[method] !== wrapper) continue;
      if (descriptor) Object.defineProperty(row, method, descriptor);
      else delete row[method];
    }
    guards.delete(row);
  }
  function syncControls() {
    for (const panel of document.querySelectorAll(PANEL)) {
      for (const avatar of panel.querySelectorAll('[data-liuli-setting="avatarPosition"]')) {
        const label = avatar.querySelector(':scope > span');
        if (label) label.textContent = '头像位置（TG / TIM）';
        let row = avatar.parentElement.querySelector('[data-liuli-setting="timSenderPosition"]');
        if (!row) {
          row = document.createElement('div');
          row.className = 'liuli-wp-fit liuli-mode-row';
          row.dataset.liuliSetting = 'timSenderPosition';
          row.dataset.liuliTimLayoutCompat = '';
          const caption = document.createElement('span'); caption.textContent = '名称与标签位置（TIM）';
          const segment = document.createElement('div'); segment.className = 'liuli-seg';
          for (const [value, text] of [['inside', '气泡内（TG）'], ['outside', '气泡外（原版）']]) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'liuli-seg__item'; button.dataset.settingValue = value;
            button.textContent = text;
            button.addEventListener('click', () => savePlacement(value));
            segment.appendChild(button);
          }
          row.append(caption, segment); avatar.after(row); createdControls.add(row);
        }
      }
    }
    for (const [key, enabled, reason] of [
      ['avatarPosition', ['tg', 'tim'].includes(llModeCfg.chatStyle), '仅 TG 和 TIM 气泡使用此设置，已保存的头像位置会保留。'],
      ['timSenderPosition', llModeCfg.chatStyle === 'tim', '仅 TIM 气泡使用此设置，已保存的名称与标签位置会保留。']
    ]) for (const row of document.querySelectorAll(PANEL + '')) {
      for (const control of row.querySelectorAll('[data-liuli-setting="' + key + '"]')) {
        control.hidden = false;
        control.classList.toggle('is-dependent-disabled', !enabled);
        control.setAttribute('aria-disabled', String(!enabled));
        control.title = enabled ? '' : reason;
        for (const button of control.querySelectorAll('button')) {
          button.disabled = !enabled;
          button.classList.toggle('is-active', button.dataset.settingValue === llModeCfg[key]);
        }
      }
    }
  }
  function flush() {
    frame = 0;
    if (disposed || document.hidden) return;
    llModeCfg = readSettings();
    document.body.dataset.liuliTimSenderPosition = llModeCfg.timSenderPosition;
    document.body.dataset.liuliAvatarPosition = llModeCfg.avatarPosition;
    for (const [area, observer] of areas) if (!area.isConnected) { observer.disconnect(); areas.delete(area); }
    for (const [row, descriptors] of guards) if (!row.isConnected) restoreGuard(row, descriptors);
    groupWrites.prune();
    prepare([document]);
    syncControls();
    discovery.takeRecords(); modeObserver.takeRecords();
  }
  function prepare(roots) {
    if (disposed || document.hidden) return;
    for (const [row, descriptors] of guards) if (!row.isConnected) restoreGuard(row, descriptors);
    groupWrites.prune();
    applying = true;
    try {
      for (const root of roots) {
        for (const row of elementsWithin(root, '.message-container')) guardRow(row);
        syncPictureRatios(root);
        moveSenderIntoBubble(root);
      }
      groupMessages();
      scheduleStick();
      passes++;
    } finally {
      applying = false;
      // Discard exactly this adapter's synchronous writes. Later old-closure
      // grouping, media replacement, and avatar reset writes remain visible.
      for (const observer of areas.values()) observer.takeRecords();
    }
  }
  function schedule() { if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(flush); }
  function scheduleStick() {
    if (disposed || stickFrame || document.hidden) return;
    if (llModeCfg.avatarPosition === 'top' || !['tg', 'tim'].includes(llModeCfg.chatStyle)) {
      if (document.querySelector('.chat-msg-area .avatar-span[data-liuli-ty]')) stickAvatars();
      return;
    }
    stickFrame = requestAnimationFrame(() => {
      stickFrame = 0;
      stickAvatars();
      for (const observer of areas.values()) observer.takeRecords();
    });
  }
  function attach(area) {
    if (areas.has(area)) return false;
    const observer = new MutationObserver(records => {
      let content = false, avatarStyle = false;
      const roots = new Set();
      for (const record of records) {
        if (record.type === 'attributes' && record.attributeName === 'style') {
          if (record.target.matches('.avatar-span') && llModeCfg.chatStyle === 'tim' && llModeCfg.avatarPosition === 'bottom') avatarStyle = true;
        } else if (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1)) {
          content = true;
          const root = record.target.nodeType === 1 ? record.target : record.target.parentElement;
          roots.add(root.closest('.ml-item') || root);
        }
      }
      // Reconcile old-closure layout writes in this microtask, before native
      // row measurement. Settings/control rendering has its separate rAF.
      if (content) prepare(topLevelRoots([...roots])); else if (avatarStyle) scheduleStick();
    });
    // Sender placement is owned by actual reparenting and mode changes. An old
    // helper can rewrite its named marker on every pass without moving a node;
    // that marker alone must not trigger another whole-area preparation.
    observer.observe(area, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['id', 'data-index', 'data-liuli-g', 'data-liuli-avatar-g', 'style'] });
    areas.set(area, observer); return true;
  }
  function discover(node) {
    if (!(node instanceof Element) || node.closest('.recent-contact,.group-member')) return false;
    let changed = node.matches('.chat-msg-area') ? attach(node) : false;
    if (node.closest('.chat-msg-area')) return changed;
    for (const area of node.querySelectorAll('.chat-msg-area')) changed = attach(area) || changed;
    if (node.matches(PANEL) || node.closest(PANEL) || node.querySelector(PANEL)) changed = true;
    return changed;
  }
  const discovery = new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      if (record.target.closest?.('.chat-msg-area,.recent-contact,.group-member')) continue;
      for (const node of record.addedNodes) changed = discover(node) || changed;
    }
    for (const [row, descriptors] of guards) if (!row.isConnected) restoreGuard(row, descriptors);
    groupWrites.prune();
    if (changed) schedule();
  });
  const modeObserver = new MutationObserver(schedule);
  discovery.observe(document.body, { childList: true, subtree: true });
  modeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-liuli-chat-style', 'data-liuli-avatar-position', 'data-liuli-tim-sender-position'] });
  const onStorage = event => { if (event.key === KEY) schedule(); };
  const onClick = event => { if (event.target.closest?.(PANEL)?.contains(event.target) && event.target.closest('[data-liuli-setting]')) schedule(); };
  const onScroll = event => { if (event.target.closest?.('.chat-msg-area')) scheduleStick(); };
  const onVisible = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; cancelAnimationFrame(stickFrame); stickFrame = 0; } else schedule(); };
  window.addEventListener('storage', onStorage); window.addEventListener('click', onClick);
  window.addEventListener('liuli-scope', schedule); window.addEventListener('resize', scheduleStick);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisible);
  const api = {
    groupingWriteOwner: true,
    get blockedGroupWrites() { return groupWrites.blocked; },
    get passes() { return passes; }, get blocked() { return blocked; }, get areas() { return areas.size; }, get guardedRows() { return guards.size; },
    refresh: flush,
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(stickFrame);
      discovery.disconnect(); modeObserver.disconnect();
      for (const observer of areas.values()) observer.disconnect(); areas.clear();
      for (const [row, descriptors] of guards) restoreGuard(row, descriptors);
      groupWrites.dispose();
      for (const control of createdControls) control.remove(); createdControls.clear();
      window.removeEventListener('storage', onStorage); window.removeEventListener('click', onClick);
      window.removeEventListener('liuli-scope', schedule); window.removeEventListener('resize', scheduleStick);
      document.removeEventListener('scroll', onScroll, true); document.removeEventListener('visibilitychange', onVisible);
      if (window.__liuliTimLayoutCompatibility === api) delete window.__liuliTimLayoutCompatibility;
    }
  };
  window.__liuliTimLayoutCompatibility = api;
  discover(document.body); flush();
}
function generate(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
  const helpers = ['elementsWithin', 'topLevelRoots', 'syncPictureRatios', 'isImageOnlyContent', 'isVideoOnlyContent', 'moveSenderIntoBubble', 'groupMessages', 'stickAvatars'].map(name => {
    const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }', start);
    if (start < 0 || end < start) throw Error('Missing production helper ' + name);
    return source.slice(start, end + 4);
  }).join('\n');
  return '(' + installTimLayoutCompatibility.toString()
    .replace('/* GROUP_WRITE_GUARD */', require('./tim-grouping-write-guard.cjs').toString())
    .replace('/* PRODUCTION_HELPERS */', helpers) + ')();\n';
}
module.exports = generate;
if (require.main === module) {
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../output/playwright/tim-layout-options-20261113/tim-layout-compat.js'));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, generate()); console.log(output);
}
