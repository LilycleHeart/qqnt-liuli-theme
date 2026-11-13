'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/scroll-time-perf-20261113'));
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Production scroll time hover/flip/lifecycle in isolated Chromium; no real QQ input', checks: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const times = [[0, 48], [1, 5], [2, 20], [3, 30]].map(([hours, minutes]) => { const date = new Date(); date.setHours(hours, minutes, 0, 0); return date.getTime() / 1000; });
    await page.setContent(`<style>body{margin:0}.chat-msg-area{position:absolute;left:100px;top:80px;width:500px;height:240px}.q-scroll-view{height:240px;overflow:auto}.message{height:100px;box-sizing:border-box;padding:15px}.msg-content-container{height:50px;background:#ddd}</style><main class="chat-msg-area"><div class="chat-msg-area__vlist"><div class="q-scroll-view">${times.map((time, i) => `<div class="message" data-row="${i}" data-time="${time}"><div class="msg-content-container">Message ${i}</div></div>`).join('')}</div></div></main>`);
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'assets/scroll-time.css'), 'utf8') });
    await page.evaluate(() => { window.LiuliQQ = { messageRecord: row => ({ msgTime: row.dataset.time, chatType: 2, peerUid: 'one' }) }; });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'renderer/scroll-time.js'), 'utf8') });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const active = () => page.evaluate(() => !!document.querySelector('#liuli-scroll-time')?.classList.contains('is-active'));
    await page.locator('[data-row="0"] .msg-content-container').hover();
    await page.waitForTimeout(220);
    assert.equal(await active(), false);
    await page.mouse.move(20, 20);
    await page.waitForTimeout(360);
    assert.equal(await active(), false);
    report.checks.push('Brief hover and leaving before 500ms never show a delayed pill.');
    await page.locator('[data-row="0"] .msg-content-container').hover();
    await page.waitForTimeout(240);
    assert.equal(await active(), false);
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.dataset.time === '00:48');
    await page.locator('[data-row="1"] .msg-content-container').hover();
    await page.waitForTimeout(240);
    assert.equal(await page.locator('#liuli-scroll-time').getAttribute('data-time'), '00:48');
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.dataset.time === '01:05');
    const flip = await page.evaluate(() => {
      const pill = document.querySelector('#liuli-scroll-time');
      return { orders: [...pill.querySelectorAll('.liuli-time-char.is-flipping')].map(node => Number(node.dataset.flipOrder)),
        delays: pill.getAnimations({ subtree: true }).map(animation => animation.effect.getTiming().delay),
        pillAnimations: pill.getAnimations().length, transform: getComputedStyle(pill).transform };
    });
    assert.deepEqual(flip.orders, [1, 2, 3]);
    assert.deepEqual(flip.delays.sort((a, b) => a - b), [0, 90, 180, 270, 360, 450]);
    assert.equal(flip.pillAnimations, 0);
    report.flip = flip;
    report.checks.push('Moving to another message keeps the old time during its own 500ms hover gate; only changed glyphs flip sequentially.');
    await page.mouse.move(20, 20);
    await page.waitForTimeout(500);
    assert.equal(await active(), true);
    await page.waitForTimeout(800);
    assert.equal(await active(), false);
    assert.equal(await page.locator('#liuli-scroll-time').textContent(), '');
    report.checks.push('Pointer leave retains the time for 1000ms before its existing fade and cleanup.');
    await page.locator('[data-row="0"] .msg-content-container').hover();
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.dataset.time === '00:48');
    await page.evaluate(() => { const node = document.querySelector('.q-scroll-view'); node.scrollTop = 50; node.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.dataset.time === '02:20');
    report.checks.push('Scrolling overrides hover and still picks the bottom partially visible message.');
    await page.evaluate(() => { const node = document.querySelector('.q-scroll-view'); node.replaceWith(node.cloneNode(true)); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { const node = document.querySelector('.q-scroll-view'); node.scrollTop = 150; node.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.dataset.time === '03:30');
    await page.evaluate(() => { const node = document.querySelector('.chat-msg-area'); node.replaceWith(node.cloneNode(true)); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { const node = document.querySelector('.q-scroll-view'); node.scrollTop = 50; node.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.dataset.time === '02:20');
    report.checks.push('Scoped observers rediscover replaced nested scrollers and whole message areas.');
    await page.evaluate(() => window.__liuliScrollTime.dispose());
    assert.equal(await page.locator('#liuli-scroll-time').count(), 0);
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'hover-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
