'use strict';
// A maximum-width setting must not change the native content-box/min-height
// contract. The old scale fixture supplied border-box itself and missed this.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/native-width-regression-20261113'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name)))
  .map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const setup = `
body{margin:0!important;padding:20px!important;background:#d2c9b3!important;font-family:'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#e9e1d9;--ll-on-glass-2:#d2c8bb;--ll-brand:#f0c043;--ll-brand-rgb:240,192,67;--ll-bubble-self:#f0c043;--ll-bubble-self-fg:#3e2e00;--ll-message-font-size:14px;--ll-shadow-rgb:0,0,0}
#test-area{width:1000px}.message-content{min-width:0}.avatar-native{width:32px;height:32px;background:#aaa;border-radius:50%}
`;
function markup() {
  const short = ['那 r 神呢', '下班没', '行'];
  const long = '这是一条用来验证最大宽度的长消息，只有长内容应该因为上限改变而换行。'.repeat(20);
  return `<div class="chat-msg-area" id="test-area">${['others', 'self'].map(direction => [...short, long].map((text, i) => `
    <div class="ml-item"><div class="message-container message-container--mix-or-markdown ${direction === 'self' ? 'message-container--self message-container--align-right' : ''}" data-liuli-g="single">
      <span class="avatar-span"><div class="avatar-native"></div></span>
      <div class="message-content__wrapper"><div class="msg-content-container container--${direction} mix-message__container" data-case="${direction}-${i}" data-long="${i === short.length}">
        <div class="message-content mix-message__inner"><span class="text-element"><span class="text-normal">${text}</span></span></div>
      </div></div><div class="content-status"></div>
    </div></div>`).join('')).join('')}</div>`;
}
const measure = () => [...document.querySelectorAll('[data-case]')].map(bubble => {
  const style = getComputedStyle(bubble);
  const rect = bubble.getBoundingClientRect();
  return { id: bubble.dataset.case, long: bubble.dataset.long === 'true', width: rect.width, height: rect.height, padding: style.padding,
    boxSizing: style.boxSizing, fontSize: getComputedStyle(bubble.querySelector('.text-normal')).fontSize,
    minHeight: style.minHeight, wrapperHeight: bubble.parentElement.getBoundingClientRect().height,
    rowWidth: bubble.closest('.message-container').getBoundingClientRect().width };
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Source CSS and syncBubbleWidth with captured native QQ grid/content-box/min-height rules; no live QQ writes', cases: [], failures: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1250, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const mode of ['tg', 'tim', 'classic']) {
      await page.setContent(`<!doctype html><style>${native}\n${css}\n${setup}</style><body data-liuli-scope="main" data-liuli-chat-style="${mode}" data-liuli-avatar-position="bottom">${markup()}</body>`);
      await page.addScriptTag({ content: `(()=>{const llModeCfg={bubbleMaxWidth:100};${source.slice(source.indexOf('  function syncBubbleWidth()'), source.indexOf('  function applySettings('))}window.setWidth=n=>{llModeCfg.bubbleMaxWidth=n;syncBubbleWidth();};})();` });
      for (const scale of [80, 100, 140]) {
        await page.evaluate(scale => {
          document.body.style.setProperty('--ll-bubble-scale', String(scale / 100));
          document.body.toggleAttribute('data-liuli-scaled-bubbles', scale !== 100);
          window.setWidth(100);
        }, scale);
        const full = await page.evaluate(measure);
        await page.evaluate(() => window.setWidth(40));
        const limited = await page.evaluate(measure);
        const sample = { mode, scale, full, limited };
        report.cases.push(sample);
        try {
          for (let i = 0; i < full.length; i++) {
            const before = full[i], after = limited[i];
            assert.equal(before.padding, after.padding, `${mode} ${before.id}: width setting altered padding`);
            assert.equal(before.boxSizing, after.boxSizing, `${mode} ${before.id}: width setting altered the box model`);
            assert.equal(before.fontSize, after.fontSize);
            if (!before.long) {
              assert(before.width < 400, 'Short sample unexpectedly reaches the limit');
              assert(Math.abs(before.width - after.width) < .1, `${mode} ${before.id}: unconstrained short width changed ${before.width}→${after.width}`);
              assert(Math.abs(before.height - after.height) < .1, `${mode} ${before.id}: unconstrained short height changed ${before.height}→${after.height}`);
              assert(Math.abs(before.wrapperHeight - after.wrapperHeight) < .1, `${mode} ${before.id}: short row changed height`);
            } else {
              assert(after.width <= 400.1, `${mode} long message escaped 400px maximum`);
              assert(after.width < before.width, `${mode} long message did not narrow`);
              assert(after.height > before.height, `${mode} long message did not wrap`);
            }
          }
        } catch (error) { report.failures.push({ mode, scale, message: error.message }); }
      }
      await page.screenshot({ path: path.join(output, mode + '-limited.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(report.failures, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, failures: report.failures, error: report.error }));
  }
})();
