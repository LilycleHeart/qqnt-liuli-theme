'use strict';
// Independent local Edge fixture; never connects to QQ or a debugging port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const { formatDate } = require('../renderer/scroll-time.js');
const script = fs.readFileSync(path.join(__dirname, '../renderer/scroll-time.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../assets/scroll-time.css'), 'utf8');
const artifactDir = path.resolve(__dirname, '../../../output/playwright/scroll-time');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.setDefaultTimeout(5000);
    const base = new Date();
    base.setHours(8, 0, 0, 0);
    const timestamps = Array.from({ length: 8 }, (_, i) => base.getTime() / 1000 + i * 60);
    timestamps[4] -= 86400;
    await page.setContent(`<style>
      body { margin:0; font-family:Arial; background:#ded7e8; --ll-popup-bg:#f6efff; --ll-on-glass:#302a39; }
      .chat-msg-area { position:absolute; left:100px; top:80px; width:500px; height:240px; background:#e8e1f1; }
      .q-scroll-view { height:240px; overflow:auto; }
      .message { box-sizing:border-box; height:100px; padding:25px; border-bottom:1px solid #bbb; }
      .old { position:absolute; top:-9000px; }
      .recent-contact { position:absolute; top:10px; left:10px; }
    </style><button class="recent-contact">另一个会话</button><main class="chat-msg-area"><div class="chat-msg-area__vlist"><div class="q-scroll-view">
      <div class="message old" data-peer="old" data-time="${timestamps[0] + 999999}">旧虚拟行</div>
      ${timestamps.map((time, i) => `<div class="message" data-peer="one" data-time="${time}" data-row="${i}">消息 ${i}</div>`).join('')}
    </div></div></main>`);
    await page.addStyleTag({ content: css });
    await page.evaluate(() => {
      window.readCount = 0;
      window.LiuliQQ = { messageRecord(row) {
        window.readCount++;
        return { msgTime: row.dataset.time, chatType: 2, peerUid: row.dataset.peer };
      } };
    });
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => !!window.__liuliScrollTime);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#liuli-scroll-time').count(), 0);
    const scroll = value => page.evaluate(top => { const scroller = document.querySelector('.q-scroll-view'); scroller.scrollTop = top; scroller.dispatchEvent(new Event('scroll')); }, value);
    const label = '#liuli-scroll-time';
    await scroll(50);
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.classList.contains('is-active'));
    assert.equal(await page.locator(label).textContent(), formatDate(new Date(timestamps[2] * 1000)));
    assert.equal(await page.locator(label).evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await scroll(200);
    await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.textContent === expected, formatDate(new Date(timestamps[4] * 1000)));
    await page.screenshot({ path: path.join(artifactDir, 'active-cross-day.png') });
    // Vue virtual rows can change their record without replacing the DOM node.
    const reusedTime = timestamps[4] - 86400;
    await page.evaluate(time => { const row = document.querySelector('[data-row="4"]'); row.dataset.time = time; row.id = 'reused'; }, reusedTime);
    await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.textContent === expected, formatDate(new Date(reusedTime * 1000)));
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.textContent === '', { timeout: 3000 });
    const reads = await page.evaluate(() => window.readCount);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.readCount), reads);
    assert.equal(await page.locator(label).evaluate(el => getComputedStyle(el).opacity), '0');
    // A chat selection immediately removes the outgoing chat's text.
    await scroll(100);
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.classList.contains('is-active'));
    await page.locator('.recent-contact').dispatchEvent('pointerdown');
    assert.equal(await page.locator(label).textContent(), '');
    // A same-DOM keyboard/programmatic peer change is rejected on first sample.
    await page.evaluate(() => document.querySelectorAll('.message:not(.old)').forEach(row => row.dataset.peer = 'two'));
    await scroll(150);
    await page.waitForTimeout(80);
    assert.equal(await page.locator(label).textContent(), '');
    await scroll(160);
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.classList.contains('is-active'));
    // Native labels are used verbatim only when msgTime is unavailable.
    await page.evaluate(() => {
      const row = document.querySelector('[data-row="4"]');
      delete row.dataset.time;
      row.innerHTML = '<div class="message__timestamp"><span class="babble">2025年11月11日 23:16</span></div>';
    });
    await scroll(200);
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.textContent === '2025年11月11日 23:16');
    const native = page.locator('[data-row="4"] .message__timestamp');
    assert.equal(await native.count(), 1);
    assert.equal(await native.evaluate(el => getComputedStyle(el).display), 'none');
    assert.equal(await native.locator('.babble').textContent(), '2025年11月11日 23:16');
    assert.equal(await page.locator(label).getAttribute('aria-hidden'), 'false');
    await page.screenshot({ path: path.join(artifactDir, 'native-hidden-fallback.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator(label).evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.evaluate(() => { document.querySelector('.chat-msg-area').style.display = 'none'; });
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.textContent === '');
    await page.evaluate(() => { document.querySelector('.chat-msg-area').style.display = ''; window.dispatchEvent(new Event('liuli-route')); });
    await page.waitForTimeout(50);
    await scroll(220);
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.classList.contains('is-active'));
    // Reinjection disposes the old controller and overlay, with one new listener.
    await page.addScriptTag({ content: script });
    assert.equal(await page.locator(label).count(), 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await scroll(230);
    await page.waitForFunction(() => document.querySelector('#liuli-scroll-time')?.classList.contains('is-active'));
    assert.equal(await page.locator(label).count(), 1);
    await page.evaluate(() => window.__liuliScrollTime.dispose());
    await scroll(240);
    await page.waitForTimeout(50);
    assert.equal(await page.locator(label).count(), 0);
    assert.equal(await page.evaluate(() => typeof window.__liuliScrollTime), 'undefined');
    console.log('PASS local Edge: bottom visible row, old virtual rows excluded, live reused msgTime, cross-day, idle/no polling, chat switch, native timestamp hidden with readable fallback, reduced motion, hidden/reinject/dispose');
    const report = { passed: true, checks: ['bottom-visible-row', 'exclude-old-virtual-rows', 'reused-msgTime',
      'cross-day-date', 'scroll-idle', 'no-idle-polling', 'chat-switch', 'native-timestamp-hidden',
      'native-fallback-readable', 'reduced-motion', 'hidden-cleanup', 'reinjection', 'dispose'],
      sha256: Object.fromEntries(['renderer/scroll-time.js', 'assets/scroll-time.css'].map(file => [file,
        require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')])) };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log('Artifacts: ' + artifactDir);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
