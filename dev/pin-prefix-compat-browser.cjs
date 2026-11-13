'use strict';
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const generate = require('./patch-pin-prefix-live.cjs');

const fixture = `<!doctype html><style>
.recent-contact{position:relative;padding-top:28px;width:280px}
.recent-contact-item{position:relative;height:64px}
.liuli-pin-heading{position:absolute;top:-28px;height:28px;left:12px;right:12px}
.viewport-list__measure{position:absolute;left:400px;top:28px}
</style><div class="recent-contact">
<div class="recent-contact-item" data-liuli-pin="first" id="first"><div class="liuli-pin-heading">Pinned</div><div class="content">First</div></div>
<div class="recent-contact-item" id="ordinary"><div class="content">Ordinary</div></div>
<div class="recent-contact-item" data-liuli-pin="single" id="single"><div class="liuli-pin-heading">Single</div><div class="content">Single</div></div>
<div class="viewport-list__measure"><div class="recent-contact-item" data-liuli-pin="first" id="measure"><div class="liuli-pin-heading">Measure</div><div class="content">Measure</div></div></div>
</div>`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Development adapter against the exact old pointerdown guard in isolated Chromium; no QQ operations.', cases: [], passed: false };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(fixture);
    await page.evaluate(() => {
      window.starts = []; window.native = []; window.probes = [];
      window.prototypeQuery = Element.prototype.querySelector;
      window.rows = [...document.querySelectorAll('.recent-contact-item')];
      window.initialRows = rows.slice();
      for (const row of rows) {
        row.addEventListener('pointerdown', event => native.push({ type: event.type, id: row.id, y: event.clientY, real: event instanceof PointerEvent }));
        row.addEventListener('click', event => native.push({ type: event.type, id: row.id, real: event instanceof MouseEvent }));
      }
      // This is the old production guard, including its incorrect <= 28 range.
      document.addEventListener('pointerdown', e => {
        if (e.button !== 0 || document.hidden) return;
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return;
        const item = t.closest('.recent-contact-item');
        if (!item) return;
        const pinHeading = item.querySelector(':scope > .liuli-pin-heading');
        if (pinHeading && e.clientY - item.getBoundingClientRect().top <= 28) return;
        if (item.closest('.viewport-list__measure')) return;
        if (item.classList.contains('recent-contact-item--selected')) return;
        starts.push(item.id);
      }, true);
      window.point = (id, offset = 12, heading = false, button = 0) => {
        const row = document.getElementById(id);
        const target = row.querySelector(heading ? '.liuli-pin-heading' : '.content');
        const y = row.getBoundingClientRect().top + offset;
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button, clientY: y }));
        return { own: Object.hasOwn(row, 'querySelector'), y, pending: window.__liuliPinPrefixCompatibility?.pendingRows || 0 };
      };
    });
    await page.evaluate(() => { point('first'); point('first', -12, true); });
    assert.deepEqual(await page.evaluate(() => starts), []);
    report.cases.push('Exact unpatched guard blocks the ordinary upper first-row click');

    await page.addScriptTag({ content: generate() });
    await page.evaluate(() => {
      window.addEventListener('pointerdown', event => {
        const row = event.target.closest('.recent-contact-item');
        if (row?.id === 'first' && !event.target.closest('.liuli-pin-heading')) probes.push({
          masked: row.querySelector(':scope > .liuli-pin-heading') === null,
          otherSelector: !!row.querySelector('.content'),
          documentSelector: !!document.querySelector('#first > .liuli-pin-heading'),
          real: event instanceof PointerEvent,
          y: event.clientY
        });
      }, true);
    });
    const during = await page.evaluate(() => point('first'));
    assert(during.own && during.pending === 1);
    assert.deepEqual(await page.evaluate(() => starts), ['first']);
    assert.equal(await page.evaluate(() => Object.hasOwn(document.getElementById('first'), 'querySelector')), false);
    const probe = await page.evaluate(() => probes[0]);
    assert(probe.masked && probe.otherSelector && probe.documentSelector && probe.real && probe.y === during.y);
    report.cases.push('Window capture masks only the exact per-row selector until microtask cleanup, preserving the native event');

    await page.evaluate(() => { point('first', -12, true); point('first', 40); point('ordinary'); point('measure'); point('single'); });
    assert.deepEqual(await page.evaluate(() => starts), ['first', 'first', 'ordinary', 'single']);
    assert.equal(await page.evaluate(() => rows.some(row => Object.hasOwn(row, 'querySelector'))), false);
    report.cases.push('Real headers, lower row, ordinary rows and measurement rows keep their original decisions');

    await page.evaluate(() => { starts.length = 0; point('first'); point('first', -12, true); });
    assert.deepEqual(await page.evaluate(() => starts), ['first']);
    assert.equal(await page.evaluate(() => Object.hasOwn(document.getElementById('first'), 'querySelector')), false);
    report.cases.push('Same-task real header reentrancy restores the pending mask before the old guard');

    await page.evaluate(() => {
      const row = document.getElementById('single');
      window.ownMethod = function (...args) { return Element.prototype.querySelector.apply(this, args); };
      Object.defineProperty(row, 'querySelector', { configurable: true, enumerable: true, writable: false, value: ownMethod });
      window.ownBefore = Object.getOwnPropertyDescriptor(row, 'querySelector');
      point('single');
    });
    assert(await page.evaluate(() => {
      const after = Object.getOwnPropertyDescriptor(document.getElementById('single'), 'querySelector');
      return ['value', 'writable', 'enumerable', 'configurable'].every(key => after[key] === ownBefore[key]);
    }));
    report.cases.push('An existing own method is restored with its complete property descriptor');

    const replacement = await page.evaluate(script => {
      point('first');
      const previous = __liuliPinPrefixCompatibility;
      (0, eval)(script);
      const clean = !Object.hasOwn(document.getElementById('first'), 'querySelector') && __liuliPinPrefixCompatibility !== previous;
      starts.length = 0;
      point('first');
      const once = starts.join(',');
      __liuliPinPrefixCompatibility.dispose();
      return { clean, once, restored: !Object.hasOwn(document.getElementById('first'), 'querySelector'), removed: !window.__liuliPinPrefixCompatibility };
    }, generate());
    assert.deepEqual(replacement, { clean: true, once: 'first', restored: true, removed: true });
    await page.evaluate(() => { starts.length = 0; point('first'); document.querySelector('#first .content').click(); });
    assert.deepEqual(await page.evaluate(() => starts), []);
    assert(await page.evaluate(() => native.some(event => event.type === 'click' && event.id === 'first')));
    assert(await page.evaluate(() => native.every(event => event.real) && Element.prototype.querySelector === prototypeQuery && rows.every((row, index) => row === initialRows[index])));
    report.cases.push('Repeated installation and disposal restore pending properties, remove the listener and preserve native click handling and nodes');
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); console.log(JSON.stringify(report, null, 2)); }
})();
