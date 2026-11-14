'use strict';
// A native thumbnail frame and the decoded image need not share an aspect
// ratio. A maximum-width setting must preserve the native image fit below
// its limit and scale the existing frame above it, without changing its crop.
// This fixture never connects to live QQ or reads private media.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/image-width-20261114/browser-regression'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name)))
  .map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const setup = `
body{margin:0!important;padding:16px!important;background:#293638!important;font:14px sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#e9e1d9;--ll-on-glass-2:#d2c8bb;--ll-brand:#f0c043;--ll-brand-rgb:240,192,67;--ll-bubble-self:#f0c043;--ll-bubble-self-fg:#3e2e00;--ll-message-font-size:14px;--ll-shadow-rgb:0,0,0;--img-max-width:324px}
*,*::before,*::after{animation:none!important;transition:none!important}
#test-area{width:1100px}.message-container{margin-bottom:12px}.avatar-native{width:32px;height:32px;background:#abb;border-radius:50%}
.pic-element{line-height:0;overflow:hidden}.native-picture{width:100%;height:100%;object-fit:cover}
`;
function image(height) {
  // Bright edge markers and an asymmetric grid make centered letterboxing
  // and altered cropping observable in the screenshot, independent of text.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="648" height="${height}" viewBox="0 0 648 ${height}"><rect width="648" height="${height}" fill="#326992"/><rect width="48" height="${height}" fill="#ee3355"/><rect x="600" width="48" height="${height}" fill="#33ee88"/><path d="M48 8H600M48 100H600M90 0V${height}M234 0V${height}M378 0V${height}M522 0V${height}" stroke="#f7c743" stroke-width="8"/><path d="M0 0L648 ${height}M0 ${height}L648 0" stroke="#fff" stroke-width="4"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
function row(direction, kind, content) {
  const own = direction === 'self' ? 'message-container--self message-container--align-right' : 'message-container--others';
  const pic = kind !== 'text';
  return `<div class="ml-item"><div class="message-container message-container--mix-or-markdown ${own}" data-liuli-g="single"><span class="avatar-span"><div class="avatar-native"></div></span><div class="message-content__wrapper"><div class="msg-content-container container--${direction} mix-message__container${pic ? ' mix-message__container--pic' : ''}" ${pic ? 'data-liuli-image-only' : ''} data-case="${direction}-${kind}"><div class="message-content mix-message__inner">${content}</div></div></div><div class="content-status"></div></div></div>`;
}
function markup() {
  const pictures = ['others', 'self'].map(direction => [
    row(direction, 'mismatched', `<div class="pic-element" style="width:324px;height:48px"><img class="native-picture" alt="Deterministic mismatched thumbnail" src="${image(108)}"></div>`),
    row(direction, 'matching', `<div class="pic-element" style="width:324px;height:48px"><img class="native-picture" alt="Deterministic matching thumbnail" src="${image(96)}"></div>`)
  ].join('')).join('');
  // Keep wrapping controls after every image so a text reflow does not move
  // an otherwise identical image onto a different fractional pixel origin.
  const text = ['others', 'self'].map(direction => row(direction, 'text', `<span class="text-element text-normal">${'长消息超过最大宽度后应正常换行，不能影响图片的原生裁剪方式。'.repeat(14)}</span>`)).join('');
  return `<div class="chat-msg-area" id="test-area">${pictures}${text}</div>`;
}
function measure() {
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { width: r.width, height: r.height };
  };
  return [...document.querySelectorAll('[data-case]')].map(bubble => {
    const frame = bubble.querySelector('.pic-element'), img = frame?.querySelector('img');
    return { id: bubble.dataset.case, bubble: rect(bubble), wrapper: rect(bubble.parentElement),
      frame: frame && rect(frame), image: img && rect(img),
      natural: img && { width: img.naturalWidth, height: img.naturalHeight },
      objectFit: img && getComputedStyle(img).objectFit,
      frameRatio: frame && getComputedStyle(frame).aspectRatio,
      frameScrollWidth: frame?.scrollWidth,
      cap: getComputedStyle(document.querySelector('#test-area')).getPropertyValue('--ll-message-max-width') };
  });
}
async function screenshots(page, prefix) {
  const captures = new Map();
  for (const id of ['others-mismatched', 'others-matching', 'self-mismatched', 'self-matching']) {
    const bytes = await page.locator(`[data-case="${id}"] .pic-element`).screenshot({ path: path.join(output, `${prefix}-${id}.png`) });
    captures.set(id, bytes);
  }
  return captures;
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Native QQ grid fixture, production CSS and syncBubbleWidth; deterministic decoded images in native-shaped thumbnail frames; no live QQ operations', cases: [], failures: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1250, height: 1000 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    for (const mode of ['tg', 'tim', 'classic']) {
      await page.setContent(`<!doctype html><style>${native}\n${css}\n${setup}</style><body data-liuli-scope="main" data-liuli-chat-style="${mode}" data-liuli-avatar-position="bottom">${markup()}</body>`);
      await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
      await page.addScriptTag({ content: `(()=>{const llModeCfg={bubbleMaxWidth:100};${source.slice(source.indexOf('  function syncBubbleWidth()'), source.indexOf('  function applySettings('))}window.setWidth=n=>{llModeCfg.bubbleMaxWidth=n;syncBubbleWidth();};})();` });
      for (const areaWidth of [1100, 720]) {
        await page.evaluate(width => { document.querySelector('#test-area').style.width = width + 'px'; window.setWidth(100); }, areaWidth);
        const full = await page.evaluate(measure);
        const fullShots = await screenshots(page, `${mode}-${areaWidth}-100`);
        await page.evaluate(() => window.setWidth(40));
        const limited = await page.evaluate(measure);
        const limitedShots = await screenshots(page, `${mode}-${areaWidth}-40`);
        const samePixels = [...fullShots].map(([id, bytes]) => ({ id, equal: bytes.equals(limitedShots.get(id)) }));
        const sample = { mode, areaWidth, ceiling: areaWidth * .4, full, limited, samePixels };
        report.cases.push(sample);
        try {
          for (let i = 0; i < full.length; i++) {
            const before = full[i], after = limited[i];
            if (!before.frame) {
              assert(after.bubble.width <= sample.ceiling + .1, `${mode} ${before.id}: long text escaped maximum width`);
              assert(after.bubble.height > before.bubble.height, `${mode} ${before.id}: long text did not wrap`);
              continue;
            }
            assert.equal(before.objectFit, 'cover', 'Native image fit fixture lost cover');
            assert.equal(after.objectFit, before.objectFit, `${mode} ${before.id}: maximum width changed native image fit`);
            assert(Math.abs(before.frame.width - 324) < .1 && Math.abs(before.frame.height - 48) < .1, 'Native thumbnail frame fixture was already resized');
            if (areaWidth === 1100) {
              assert.deepEqual(after.frame, before.frame, `${mode} ${before.id}: below-limit frame changed`);
              assert.deepEqual(after.image, before.image, `${mode} ${before.id}: below-limit image changed`);
              assert(samePixels.find(p => p.id === before.id).equal, `${mode} ${before.id}: below-limit thumbnail pixels changed`);
            } else {
              assert(Math.abs(after.frame.width - sample.ceiling) < .1, `${mode} ${before.id}: oversized frame did not follow width limit`);
              assert(Math.abs(after.frame.height - 48 * sample.ceiling / 324) < .1, `${mode} ${before.id}: resized frame changed aspect ratio`);
              assert(Math.abs(after.image.width - after.frame.width) < .1 && Math.abs(after.image.height - after.frame.height) < .1, `${mode} ${before.id}: resized image left the thumbnail frame`);
              assert(after.frameScrollWidth <= after.frame.width + 1, `${mode} ${before.id}: thumbnail overflowed its frame`);
            }
          }
        } catch (error) { report.failures.push({ mode, areaWidth, error: error.message }); }
      }
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(report.failures, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, cases: report.cases.length, failures: report.failures, error: report.error }));
  }
})();
