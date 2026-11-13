'use strict';
// Isolated production source + development compatibility validation; no QQ.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/mini-entry-restore-20261113'));
const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
const start = source.indexOf('  function mountSettingsEntry()');
const end = source.indexOf('\n  const themeEntry', start);
assert(start >= 0 && end > start);
const mount = source.slice(start, end);
const compat = fs.readFileSync(path.join(out, 'mini-entry-compat.js'), 'utf8');
const markup = '<!doctype html><style>.mini-fishing-entry{display:inline-flex;width:28px;height:28px}.window-control-area{display:flex}</style><body><div class="window-title-bar"><div class="window-control-area"><button class="mini-fishing-entry" aria-label="迷你窗">mini</button></div></div><main class="chat-msg-area"></main></body>';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Production mountSettingsEntry and generated compatibility script in isolated Chromium; no QQ operation', checks: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    await page.setContent(markup);
    await page.evaluate('(() => {' + mount + ';window.productionMount=mountSettingsEntry;})();');
    const result = await page.evaluate(() => {
      const entry = document.querySelector('.mini-fishing-entry');
      let clicks = 0;
      entry.addEventListener('click', () => clicks++);
      window.nativeEntry = entry;
      entry.style.setProperty('display', 'none', 'important');
      window.productionMount();
      const restored = entry.style.getPropertyValue('display');
      entry.click();
      for (let i = 0; i < 15; i++) window.productionMount();
      const unchangedNode = entry === document.querySelector('.mini-fishing-entry');
      const displays = [];
      for (const [value, priority] of [['none', ''], ['flex', 'important'], ['inline-grid', '']]) {
        entry.style.setProperty('display', value, priority);
        window.productionMount();
        displays.push([entry.style.getPropertyValue('display'), entry.style.getPropertyPriority('display')]);
      }
      return { restored, unchangedNode, clicks, displays };
    });
    assert.equal(result.restored, ''); assert.equal(result.unchangedNode, true); assert.equal(result.clicks, 1);
    assert.deepEqual(result.displays, [['none', ''], ['flex', 'important'], ['inline-grid', '']]);
    report.checks.push('Production mount restores only stale none!important; repeated layouts retain native nodes, handlers and all other display values.');
    await page.evaluate(() => {
      const NativeMO = window.MutationObserver;
      window.miniObserverMetrics = { callbacks: 0, records: 0, active: 0 };
      window.MutationObserver = class extends NativeMO {
        constructor(callback) { super((records, observer) => { window.miniObserverMetrics.callbacks++; window.miniObserverMetrics.records += records.length; callback(records, observer); }); this.active = false; }
        observe(...args) { if (!this.active) { this.active = true; window.miniObserverMetrics.active++; } return super.observe(...args); }
        disconnect() { if (this.active) { this.active = false; window.miniObserverMetrics.active--; } return super.disconnect(); }
      };
      window.legacyHide = function mountSettingsEntry() { document.querySelectorAll('.window-control-area .mini-fishing-entry').forEach(entry => entry.style.setProperty('display', 'none', 'important')); };
      document.querySelector('.mini-fishing-entry').style.setProperty('display', 'none', 'important');
    });
    await page.evaluate(compat);
    const initial = await page.evaluate(() => { const entry = document.querySelector('.mini-fishing-entry'); window.legacyHide(); return { display: entry.style.getPropertyValue('display'), own: Object.hasOwn(entry.style, 'setProperty'), active: window.miniObserverMetrics.active }; });
    assert.equal(initial.display, ''); assert.equal(initial.own, true); assert.equal(initial.active, 1);
    report.checks.push('Compatibility restores the existing entry and blocks the old mount closure from rehiding it.');
    const nonTheme = await page.evaluate(() => {
      const entry = document.querySelector('.mini-fishing-entry');
      entry.style.setProperty('display', 'none', 'important');
      const nativeHidden = entry.style.getPropertyValue('display');
      entry.style.setProperty('display', 'flex', 'important');
      entry.style.setProperty('opacity', '.4', 'important');
      window.legacyHide();
      return { nativeHidden, display: entry.style.getPropertyValue('display'), opacity: entry.style.getPropertyValue('opacity') };
    });
    assert.deepEqual(nonTheme, { nativeHidden: 'none', display: 'flex', opacity: '0.4' });
    await page.evaluate(compat);
    assert.equal(await page.evaluate(() => window.miniObserverMetrics.active), 1);
    report.checks.push('Non-theme display/opacity writes remain effective and reinjection leaves one observer.');
    await page.evaluate(() => {
      const old = document.querySelector('.mini-fishing-entry');
      window.oldEntry = old;
      const replacement = document.createElement('button');
      replacement.className = 'mini-fishing-entry';
      replacement.textContent = 'rebuilt';
      replacement.style.setProperty('display', 'none', 'important');
      old.replaceWith(replacement);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const replacement = await page.evaluate(() => { const entry = document.querySelector('.mini-fishing-entry'); window.legacyHide(); return { oldHook: Object.hasOwn(window.oldEntry.style, 'setProperty'), newHook: Object.hasOwn(entry.style, 'setProperty'), display: entry.style.getPropertyValue('display') }; });
    assert.deepEqual(replacement, { oldHook: false, newHook: true, display: '' });
    await page.evaluate(() => {
      window.oldContainerEntry = document.querySelector('.mini-fishing-entry');
      document.querySelector('.window-control-area').outerHTML = '<div class="window-control-area"><button class="mini-fishing-entry" style="display:none!important">new container</button></div>';
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const containerReplacement = await page.evaluate(() => { const entry = document.querySelector('.mini-fishing-entry'); window.legacyHide(); return { oldHook: Object.hasOwn(window.oldContainerEntry.style, 'setProperty'), newHook: Object.hasOwn(entry.style, 'setProperty'), display: entry.style.getPropertyValue('display') }; });
    assert.deepEqual(containerReplacement, { oldHook: false, newHook: true, display: '' });
    report.checks.push('Button and control-container rebuilds protect new entries and remove hooks from disconnected old nodes.');
    const callbacks = await page.evaluate(() => window.miniObserverMetrics.callbacks);
    await page.evaluate(() => { for (let i = 0; i < 100; i++) { window.legacyHide(); document.querySelector('.mini-fishing-entry').style.setProperty('opacity', String(i / 100)); } });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.miniObserverMetrics.callbacks), callbacks);
    report.checks.push('Repeated old hide calls and style updates produce no mutation-observer callbacks or feedback loop.');
    await page.evaluate(() => window.__liuliMiniEntryCompatibility.dispose());
    const disposal = await page.evaluate(() => { const entry = document.querySelector('.mini-fishing-entry'); window.legacyHide(); return { active: window.miniObserverMetrics.active, own: Object.hasOwn(entry.style, 'setProperty'), hidden: entry.style.getPropertyValue('display'), api: !!window.__liuliMiniEntryCompatibility }; });
    assert.deepEqual(disposal, { active: 0, own: false, hidden: 'none', api: false });
    report.checks.push('Disposal removes the observer and instance hook; the original native method and old caller work again.');
    report.details = { production: result, initial, nonTheme, replacement, containerReplacement, disposal, observerCallbacks: callbacks };
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, passed: report.passed, error: report.error })); }
})();
