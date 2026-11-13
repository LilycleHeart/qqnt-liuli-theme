'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/scroll-time-perf-20261113'));
const before = process.argv[5] || path.join(output, 'before/renderer/scroll-time.js');
const css = fs.readFileSync(path.join(root, 'assets/scroll-time.css'), 'utf8');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Measured layout API calls in identical isolated Chromium workloads; not a QQ FPS benchmark' };
  try {
    async function measure(script) {
      const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
      await page.setContent(`<style>body{margin:0}.chat-msg-area{position:absolute;left:200px;top:80px;width:600px;height:300px}.q-scroll-view{height:300px;overflow:auto}.message{height:60px;box-sizing:border-box;padding:10px}.side{position:absolute;left:0;top:0;width:180px}</style><aside class="side"></aside><main class="chat-msg-area"><div class="chat-msg-area__vlist"><div class="q-scroll-view">${Array.from({ length: 100 }, (_, i) => `<div class="message" data-time="${1780000000 + 60 * i}"><div class="msg-content-container">Message ${i}</div></div>`).join('')}</div></div></main>`);
      await page.addStyleTag({ content: css });
      await page.evaluate(() => {
        window.LiuliQQ = { messageRecord: row => ({ msgTime: row.dataset.time, peerUid: 'one', chatType: 2 }) };
        window.work = { rect: { area: 0, scroller: 0, row: 0, other: 0 }, visibility: 0 };
        const originalRect = Element.prototype.getBoundingClientRect;
        const originalVisibility = Element.prototype.checkVisibility;
        Element.prototype.getBoundingClientRect = function () {
          const key = this.matches('.chat-msg-area') ? 'area' : this.matches('.q-scroll-view') ? 'scroller' : this.matches('.message') ? 'row' : 'other';
          window.work.rect[key]++;
          return originalRect.call(this);
        };
        if (originalVisibility) Element.prototype.checkVisibility = function (...args) { window.work.visibility++; return originalVisibility.apply(this, args); };
        window.resetWork = () => { const result = JSON.parse(JSON.stringify(window.work)); for (const key of Object.keys(window.work.rect)) window.work.rect[key] = 0; window.work.visibility = 0; return result; };
      });
      await page.addScriptTag({ content: script });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const startup = await page.evaluate(() => window.resetWork());
      await page.evaluate(async () => {
        for (let i = 0; i < 20; i++) await new Promise(resolve => requestAnimationFrame(() => { const node = document.createElement('span'); node.textContent = i; document.querySelector('.side').replaceChildren(node); resolve(); }));
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
      const unrelatedIdle = await page.evaluate(() => window.resetWork());
      await page.evaluate(() => {
        const scroller = document.querySelector('.q-scroll-view');
        scroller.scrollTop = 120;
        for (let i = 0; i < 24; i++) scroller.dispatchEvent(new Event('scroll'));
      });
      await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.classList.contains('is-active'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const burstScroll = await page.evaluate(() => ({ ...window.resetWork(), time: document.querySelector('#liuli-scroll-time')?.dataset.time }));
      await page.evaluate(async () => {
        for (let i = 0; i < 20; i++) await new Promise(resolve => requestAnimationFrame(() => { const node = document.createElement('span'); node.textContent = i; document.querySelector('.side').replaceChildren(node); resolve(); }));
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
      const unrelatedActive = await page.evaluate(() => window.resetWork());
      await page.evaluate(() => window.__liuliScrollTime.dispose());
      await page.close();
      return { startup, unrelatedIdle, burstScroll, unrelatedActive };
    }
    report.before = await measure(fs.readFileSync(before, 'utf8'));
    report.after = await measure(fs.readFileSync(path.join(root, 'renderer/scroll-time.js'), 'utf8'));
    if (!process.argv.includes('--measure-only')) {
      const total = sample => Object.values(sample.rect).reduce((sum, value) => sum + value, 0);
      assert.equal(total(report.after.unrelatedIdle), 0, 'Unrelated idle DOM changes measured message layout');
      assert.equal(total(report.after.unrelatedActive), 0, 'Unrelated active DOM changes measured message layout');
      assert(total(report.after.startup) < total(report.before.startup) * 0.5, 'Initial virtual rows still repeat viewport/row geometry reads');
      assert(total(report.after.burstScroll) < total(report.before.burstScroll) * 0.5, 'Scroll burst did not coalesce redundant geometry reads');
      assert.equal(report.after.burstScroll.time, report.before.burstScroll.time, 'Bottom visible row time changed during optimization');
    }
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
