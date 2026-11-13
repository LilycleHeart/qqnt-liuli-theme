'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/message-scroll-coverage-20261113/background-batching'));
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'renderer/background-performance.js'), 'utf8');
const before = fs.readFileSync(path.join(output, '../background-performance.js.before'), 'utf8');
const gif = Buffer.from('R0lGODlhCAAIAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADAAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBDAABACwAAAAACAAIAIEAAP8AAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7', 'base64');
const fixture = `<!doctype html><style>
body{margin:0}.chat-msg-area{width:600px}.ml-item{min-height:24px}img{width:32px;height:32px}
@keyframes finite{from{opacity:0}to{opacity:1}}@keyframes infinite{to{transform:rotate(1turn)}}
.finite{animation:finite .35s linear both}.infinite{animation:infinite 2s linear infinite}
.pseudo::before{content:'x';animation:infinite 3s linear infinite}
</style><body><div class="chat-msg-area"><div id="rows"></div><div id="media"></div></div><div id="decoration" class="infinite"></div><div id="entry" class="finite">entry</div></body>`;

async function setup(browser, script) {
  const page = await browser.newPage();
  await page.route('http://fixture.test/**', route => route.fulfill({ contentType: 'image/gif', body: gif }));
  await page.setContent(fixture);
  await page.evaluate(() => {
    window.testHidden = false; window.testFocus = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => testHidden });
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => testFocus });
    window.focusState = value => { testFocus = value; window.dispatchEvent(new Event(value ? 'focus' : 'blur')); };
    window.counts = { animations: 0, subtree: 0, styles: 0, rects: 0, order: [] };
    const animations = Element.prototype.getAnimations, style = window.getComputedStyle, rect = Element.prototype.getBoundingClientRect, before = Element.prototype.before;
    Element.prototype.getAnimations = function(options) { counts.animations++; if (options?.subtree) counts.subtree++; return animations.call(this, options); };
    window.getComputedStyle = function(element, pseudo) { counts.styles++; if (element instanceof HTMLImageElement) counts.order.push('read-style'); return style.call(this, element, pseudo); };
    Element.prototype.getBoundingClientRect = function() { counts.rects++; if (this instanceof HTMLImageElement) counts.order.push('read-rect'); return rect.call(this); };
    Element.prototype.before = function(...nodes) { if (this instanceof HTMLImageElement && nodes.some(node => node instanceof HTMLCanvasElement)) counts.order.push('write-frame'); return before.apply(this, nodes); };
    window.reset = () => { for (const name of ['animations', 'subtree', 'styles', 'rects']) counts[name] = 0; counts.order.length = 0; };
  });
  await page.addScriptTag({ content: script });
  await page.evaluate(() => focusState(false));
  await page.waitForTimeout(150);
  await page.evaluate(() => reset());
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Isolated Chromium API-call/DOM-order evidence; no live QQ, frame-rate, CPU or decoder claims.', cases: [], passed: false };
  try {
    const results = {};
    for (const [name, script] of [['before', before], ['after', source]]) {
      const page = await setup(browser, script);
      await page.evaluate(async () => {
        for (let batch = 0; batch < 8; batch++) {
          document.querySelector('#rows').insertAdjacentHTML('beforeend', Array.from({ length: 25 }, (_, index) => `<div class="ml-item">Message ${batch * 25 + index}</div>`).join(''));
          await new Promise(resolve => setTimeout(resolve, 8));
        }
      });
      await page.waitForTimeout(120);
      results[name] = await page.evaluate(() => ({ ...counts }));
      await page.close();
    }
    assert(results.before.animations > 0, 'Negative control did not reproduce per-mount animation scans');
    assert.equal(results.after.animations, 0);
    assert.equal(results.after.styles, 0);
    assert.equal(results.after.rects, 0);
    report.textMounts = results;
    report.cases.push('200 plain virtual rows across eight tasks cause zero animation/style/geometry queries after suspension; old code rescans mounts');

    const page = await setup(browser, source);
    await page.evaluate(() => {
      document.querySelector('#media').innerHTML = Array.from({ length: 6 }, (_, index) => `<span class="market-face-element"><img src="http://fixture.test/${index}.gif"></span>`).join('');
    });
    await page.waitForFunction(() => window.__liuliBackgroundPerformance.frozenImages === 6);
    const media = await page.evaluate(() => ({ ...counts }));
    assert.equal(media.animations, 0, 'Media mounts queried animation subtrees');
    assert.equal(media.styles, 6);
    assert.equal(media.rects, 6);
    const firstWrite = media.order.indexOf('write-frame');
    assert.equal(firstWrite, 12);
    assert(media.order.slice(firstWrite).every(item => item === 'write-frame'), 'Image geometry reads followed connected frame writes');
    report.mediaBatch = media;
    report.cases.push('Six animated images freeze in one batch with every style/geometry read before all connected canvas writes');

    await page.evaluate(() => {
      reset();
      document.querySelector('#rows').innerHTML = '<div id="late-infinite" class="infinite">spin</div><div id="late-finite" class="finite">entry</div><div id="late-pseudo" class="pseudo"></div>';
    });
    await page.waitForTimeout(160);
    const newAnimations = await page.evaluate(() => ({ counts: { ...counts },
      infinite: document.querySelector('#late-infinite').getAnimations()[0]?.playState,
      finite: document.querySelector('#late-finite').getAnimations()[0]?.playState,
      pseudo: document.querySelector('#late-pseudo').getAnimations({ subtree: true })[0]?.playState }));
    assert.equal(newAnimations.infinite, 'paused');
    assert.equal(newAnimations.pseudo, 'paused');
    assert.equal(newAnimations.finite, 'running');
    assert.equal(newAnimations.counts.subtree, 1, 'Only a pseudo-element start may need the targeted subtree animation query');
    await page.waitForTimeout(260);
    assert.equal(await page.locator('#late-finite').evaluate(node => getComputedStyle(node).opacity), '1');
    report.newAnimations = newAnimations;
    report.cases.push('New CSS and pseudo infinite decorations pause through animationstart; finite entry completes and only a pseudo start queries its target subtree');

    await page.evaluate(() => focusState(true));
    assert.equal(await page.locator('[data-liuli-static-frame]').count(), 0);
    assert.equal(await page.locator('#late-infinite').evaluate(node => node.getAnimations()[0].playState), 'running');
    assert.equal(await page.locator('#late-pseudo').evaluate(node => node.getAnimations({ subtree: true })[0].playState), 'running');
    await page.evaluate(() => { focusState(false); document.querySelector('#media').insertAdjacentHTML('beforeend', '<span class="market-face-element"><img src="http://fixture.test/pending.gif"></span>'); window.__liuliBackgroundPerformance.dispose(); });
    await page.waitForTimeout(140);
    assert.equal(await page.locator('[data-liuli-static-frame],#liuli-background-performance-style,body[data-liuli-background-idle]').count(), 0);
    assert.equal(await page.evaluate(() => [...document.images].every(image => image.style.display === '')), true);
    report.cases.push('Focus resumes owned media/decoration, and dispose clears pending batches with no later frame insertion');
    await page.close();
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
