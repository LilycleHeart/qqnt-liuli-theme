'use strict';
// Real native .normal-file CSS + production theme CSS. The card markup models
// that component's documented class structure; live QQ evidence is separate.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/file-tim-repair-20261113/files'));
fs.mkdirSync(output, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-file.css');
const card = `<div class="normal-file file-element" data-v-0645b5d3><div class="file-header" data-v-0645b5d3><div class="file-name" data-v-0645b5d3>项目素材与说明文件.zip</div><div class="file-icon" data-v-0645b5d3 style="background-image:linear-gradient(#7cbcff,#3da5ff)"></div></div><div class="file-info" data-v-0645b5d3><span>41.95 MB</span><span>已下载</span></div><div class="file-progress-new" data-v-0645b5d3></div></div>`;
const ordinary = `<div class="msg-content-container container--others"><div class="message-content"><span class="text-element text-normal">普通消息</span></div></div>`;
function fixture() {
  return ['others', 'self', 'align-right'].map(direction => `<section data-direction="${direction}"><div class="message-container message-container--${direction} file-message"><div class="message-content__wrapper"><div class="file-message--content" data-v-0358c09e>${card}</div></div></div><div class="message-container"><div class="message-content__wrapper">${direction === 'others' ? ordinary : ordinary.replace('container--others', 'container--self')}</div></div><div class="message-container file-message"><div class="file-message--content"><div class="msg-preview msg-preview--video file-element" data-v-8efc5ec8 style="width:120px;height:70px"><span>视频预览</span></div><div class="msg-preview msg-preview--image file-element" data-v-8efc5ec8 style="width:120px;height:70px"><span>图片预览</span></div></div></div></section>`).join('');
}
function sample() {
  return [...document.querySelectorAll('section')].map(section => {
    const card = section.querySelector('.normal-file'), reference = section.querySelector('.msg-content-container');
    const s = getComputedStyle(card), r = getComputedStyle(reference);
    const vars = { background: s.backgroundColor, color: s.color, blur: s.backdropFilter, shadow: s.boxShadow };
    const expected = { background: r.backgroundColor, color: r.color, blur: r.backdropFilter, shadow: r.boxShadow };
    return { direction: section.dataset.direction, material: vars, reference: expected,
      name: getComputedStyle(card.querySelector('.file-name')).color, secondary: getComputedStyle(card.querySelector('.file-info')).color,
      shape: { padding: s.padding, width: s.width, radius: s.borderRadius }, iconImage: getComputedStyle(card.querySelector('.file-icon')).backgroundImage,
      previews: [...section.querySelectorAll('.msg-preview')].map(preview => { const p = getComputedStyle(preview); return { background: p.backgroundColor, border: p.border, radius: p.borderRadius, width: p.width, height: p.height }; }), handler: card.onclick !== null };
  });
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Native QQ file CSS and modeled component DOM with production MCU roles; no QQ writes or file operations', cases: [], failures: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    for (const mode of ['tg', 'tim', 'classic']) for (const dark of [false, true]) for (const roleSet of [{ self: 'primary', others: 'surface' }, { self: 'secondary', others: 'tertiary' }]) {
      await page.setContent(`<!doctype html><style>${native}\n${css}\nbody{margin:20px!important;background:repeating-linear-gradient(60deg,#48381f 0px,#48381f 70px,#ded6be 70px,#ded6be 140px)!important;font:14px 'Microsoft YaHei UI',sans-serif;--ll-acrylic:${dark ? '50,44,29' : '240,230,210'};--ll-on-glass:${dark ? '#e9e1d9' : '#242018'};--ll-on-glass-2:${dark ? '#d0c5b4' : '#514d44'};--ll-on-glass-3:#aaa;--ll-material-opacity:.3;--ll-shadow-rgb:0,0,0;--ll-brand:#f0c043;--ll-brand-rgb:240,192,67;--bubble_guest:rgba(var(--ll-acrylic),.42);--bubble_guest_text:var(--ll-on-glass);--text-secondary-01:var(--ll-on-glass-2);--font_size_main_2:14px;--line_height_main_2:20px;--font_size_2:12px;--line_height_2:16px;--fill_light_primary:#c0c0c0;--border_standard:#888}#app{display:flex;gap:36px}.chat-msg-area{width:100%}section{display:inline-flex;vertical-align:top;flex-direction:column;gap:20px;width:280px}.message-container{display:block!important;padding:0!important}.message-content__wrapper{display:flex;width:max-content}.file-message--content{display:block}</style><body data-liuli-scope="main" data-liuli-chat-style="${mode}"><div id="app"><div class="chat-msg-area">${fixture()}</div></div></body>`);
      await page.addScriptTag({ content: read('assets/mcu.js') });
      await page.addScriptTag({ content: read('renderer/color-roles.js') });
      await page.evaluate(({ dark, roleSet }) => {
        const mcu = window.LiuliMCU, theme = mcu.themeFromSourceColor(mcu.argbFromHex('#b48c28'));
        const vars = window.LiuliRoles.roleVars(mcu, theme, dark, { accent: 'primary', selected: 'primary', ...roleSet });
        for (const [key, value] of Object.entries(vars)) if (value !== null) document.body.style.setProperty(key, value);
        window.__fileCardCalls = 0;
        document.querySelectorAll('.normal-file').forEach(card => { card.onclick = () => window.__fileCardCalls = (window.__fileCardCalls || 0) + 1; });
      }, { dark, roleSet });
      const values = await page.evaluate(sample);
      try {
        for (const value of values) {
          assert.deepEqual(value.material, value.reference, 'Normal file material differs from ordinary bubble');
          assert.equal(value.name, value.material.color, 'File name lost its foreground role');
          assert.equal(value.shape.padding, '10px');
          assert.equal(value.shape.width, '226px');
          assert.equal(value.shape.radius, '8px');
          assert(value.iconImage.startsWith('linear-gradient'), 'Native file icon was repainted');
          for (const preview of value.previews) assert.deepEqual(preview, { background: 'rgba(0, 0, 0, 0)', border: '0px none rgb(0, 0, 0)', radius: '0px', width: '120px', height: '70px' }, 'Normal file surface changed a video/image preview');
          assert(value.handler, 'Native card handler was replaced');
        }
        await page.locator('.normal-file').first().click();
        assert.equal(await page.evaluate(() => window.__fileCardCalls), 1);
        report.cases.push({ mode, dark, roleSet, values, passed: true });
      } catch (error) { report.failures.push({ mode, dark, roleSet, error: error.message, values }); }
      if (dark && roleSet.others === 'surface') await page.screenshot({ path: path.join(output, `${mode}.png`), fullPage: true });
    }
    assert.equal(report.failures.length, 0, 'Normal file material regression');
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, cases: report.cases.length, failures: report.failures.length, error: report.error })); }
})();
