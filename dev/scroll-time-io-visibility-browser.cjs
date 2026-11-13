'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const { formatDate } = require('../renderer/scroll-time.js');
const root = path.resolve(__dirname, '..');
const evidence = path.resolve(root, '../../output/playwright/message-scroll-coverage-20261113');
const output = path.resolve(process.argv[4] || path.join(evidence, 'scroll-time-io-visibility'));
fs.mkdirSync(output, { recursive: true });
const before = fs.readFileSync(path.join(evidence, 'scroll-time-io-visibility.js.before'), 'utf8');
const source = fs.readFileSync(path.join(root, 'renderer/scroll-time.js'), 'utf8');
const timestamps = [1700000000, 1700003600];
const fixture = `<!doctype html><style>body{margin:0}.chat-msg-area{width:400px;height:240px}.q-scroll-view{height:240px;overflow:auto}.message{height:100px}.hidden{visibility:hidden}</style><div class="chat-msg-area"><div class="chat-msg-area__vlist"><div class="q-scroll-view"><div class="message" data-time="${timestamps[0]}"><div class="msg-content-container">First</div></div><div class="message" id="bottom" data-time="${timestamps[1]}" style="opacity:0"><div class="msg-content-container">Bottom</div></div></div></div></div>`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Real IntersectionObserver visibility lifecycle in isolated Chromium; no QQ operations.', cases: [], passed: false };
  try {
    for (const [mode, script] of [['before', before], ['after', source]]) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.setContent(fixture);
      await page.evaluate(() => {
        window.deliveries = [];
        const IO = IntersectionObserver;
        window.IntersectionObserver = class extends IO {
          constructor(callback, options) {
            super(entries => { deliveries.push(entries.map(entry => ({ id: entry.target.id,
              opacity: getComputedStyle(entry.target).opacity, intersecting: entry.isIntersecting }))); callback(entries); }, options);
          }
        };
        window.LiuliQQ = { messageRecord: row => row ? { msgTime: row.dataset.time, chatType: 2, peerUid: 'one' } : null };
        window.scroll = () => document.querySelector('.q-scroll-view').dispatchEvent(new Event('scroll'));
      });
      await page.addScriptTag({ content: script });
      await page.waitForFunction(() => deliveries.some(batch => batch.some(entry => entry.id === 'bottom' && entry.opacity === '0')));
      await page.evaluate(() => { document.querySelector('#bottom').style.opacity = '1'; scroll(); });
      await page.waitForFunction(() => !!document.querySelector('#liuli-scroll-time')?.dataset.time);
      const actual = await page.locator('#liuli-scroll-time').getAttribute('data-time');
      assert.equal(actual, formatDate(new Date(timestamps[mode === 'before' ? 0 : 1] * 1000)));
      report[mode] = { actual, deliveries: await page.evaluate(() => deliveries) };
      if (mode === 'before') report.cases.push('Negative control caches the initially transparent bottom row as invisible and incorrectly selects the preceding time');
      else {
        report.cases.push('An opacity-zero first IO snapshot still selects the true bottom message after its entry becomes visible');
        await page.evaluate(() => { document.querySelector('#bottom').style.visibility = 'hidden'; scroll(); });
        await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.dataset.time === expected, formatDate(new Date(timestamps[0] * 1000)));
        await page.evaluate(() => { document.querySelector('#bottom').style.visibility = ''; scroll(); });
        await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.dataset.time === expected, formatDate(new Date(timestamps[1] * 1000)));
        await page.evaluate(() => { document.querySelector('#bottom').classList.add('hidden'); scroll(); });
        await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.dataset.time === expected, formatDate(new Date(timestamps[0] * 1000)));
        await page.evaluate(() => { document.querySelector('#bottom').classList.remove('hidden'); scroll(); });
        await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.dataset.time === expected, formatDate(new Date(timestamps[1] * 1000)));
        await page.evaluate(() => { document.querySelector('#bottom').style.display = 'none'; scroll(); });
        await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.dataset.time === expected, formatDate(new Date(timestamps[0] * 1000)));
        await page.evaluate(() => { document.querySelector('#bottom').style.display = ''; scroll(); });
        await page.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.dataset.time === expected, formatDate(new Date(timestamps[1] * 1000)));
        report.cases.push('Actual visibility:hidden and display:none rows stay excluded, and style/class restoration refreshes delivered IO eligibility');
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    const animated = await browser.newPage();
    await animated.setContent(fixture.replace('style="opacity:0"', 'style="animation:enter .05s linear .2s both"'));
    await animated.addStyleTag({ content: '@keyframes enter{from{opacity:0}to{opacity:1}}' });
    await animated.evaluate(() => {
      window.bottomDeliveries = 0;
      const IO = IntersectionObserver;
      window.IntersectionObserver = class extends IO {
        constructor(callback, options) { super(entries => {
          bottomDeliveries += entries.filter(entry => entry.target.id === 'bottom').length;
          callback(entries);
        }, options); }
      };
      window.LiuliQQ = { messageRecord: row => row ? { msgTime: row.dataset.time, chatType: 2, peerUid: 'one' } : null };
    });
    await animated.addScriptTag({ content: source });
    await animated.waitForFunction(() => bottomDeliveries > 0);
    await animated.waitForTimeout(350);
    await animated.evaluate(() => document.querySelector('.q-scroll-view').dispatchEvent(new Event('scroll')));
    await animated.waitForFunction(expected => document.querySelector('#liuli-scroll-time')?.dataset.time === expected, formatDate(new Date(timestamps[1] * 1000)));
    assert.equal(await animated.evaluate(() => bottomDeliveries), 1, 'Animation unexpectedly redelivered IO and failed to exercise unchanged eligibility');
    report.cases.push('A delayed opacity entry completes without DOM mutations or another IO delivery, and its bottom-message time remains eligible');
    await animated.close();
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
