'use strict';
// QQ's four native variants, unknown/default fallback, standalone group label
// and user title; sender row moves between the native and inside-bubble slots.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/tim-layout-options-20261113/tags/after'));
fs.mkdirSync(output, { recursive: true });
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const badges = [
  ...['grey', 'blue', 'orange', 'purple'].map(role => `<div data-variant="${role}" data-v-2269891b class="group-member-label q-tag q-tag--${role}"><span data-v-2269891b class="level">${role === 'blue' ? '管理员' : role === 'orange' ? '群主' : 'LV100'}</span>${['grey', 'purple'].includes(role) ? '<span data-v-2269891b class="title">女装加那</span>' : ''}</div>`),
  '<div data-variant="default" class="group-member-label q-tag"><span class="level">LV77</span><span class="title">默认头衔</span></div>',
  '<div data-variant="unknown" class="group-member-label q-tag q-tag--future"><span class="level">LV20</span><span class="title">扩展头衔</span></div>',
  '<div data-variant="group-only" class="group-member-label"><span class="level">LV10</span><span class="title">普通成员</span></div>',
  '<span data-variant="user-title" class="user-label" style="background-color:rgba(255,110,0,.2)">自定义头衔</span>'
];
function fixture(placement) {
  return badges.map(tag => {
    const name = `<div class="user-name no-copy text-ellipsis">${tag}<span class="text-ellipsis" style="white-space:pre">示例名称</span></div>`;
    const bubble = `<div class="msg-content-container container--others mix-message__container">${placement === 'inside' ? name : ''}<div class="message-content mix-message__inner"><span class="text-element"><span class="text-normal">普通消息</span></span></div></div>`;
    return `<div class="message-container message-container--others" data-liuli-g="single">${placement === 'outside' ? name : ''}<div class="message-content__wrapper">${bubble}</div></div>`;
  }).join('');
}
function sample() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map((n, i) => i === 3 ? n / 255 : n); };
  const luminance = c => c.slice(0, 3).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  return [...document.querySelectorAll('[data-variant]')].map(tag => {
    const s = getComputedStyle(tag), hs = getComputedStyle(tag.parentElement), fg = luminance(rgb(s.color)), bg = luminance(rgb(s.backgroundColor));
    const r = tag.getBoundingClientRect();
    return { variant: tag.dataset.variant, html: tag.outerHTML, background: s.backgroundColor, alpha: rgb(s.backgroundColor)[3], foreground: s.color, opacity: s.opacity,
      contrast: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), headerAlpha: rgb(hs.backgroundColor)[3],
      shape: { radius: s.borderRadius, fontSize: s.fontSize, padding: s.padding, height: r.height, width: r.width, display: s.display },
      childColors: [...tag.children].map(child => getComputedStyle(child).color) };
  });
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Captured QQ native tag CSS/DOM variants with production CSS and MCU roles; actual inside/outside DOM placement; no QQ state writes', cases: [], failures: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 850 } });
    for (const mode of ['tg', 'tim', 'classic']) for (const placement of ['inside', 'outside']) for (const dark of [false, true]) for (const size of [10, 14]) {
      await page.setContent(`<!doctype html><style>${native}\n${css}\nbody{margin:24px!important;background:repeating-linear-gradient(60deg,#413c30 0px,#413c30 70px,#e7dcc2 70px,#e7dcc2 140px)!important;font:14px 'Microsoft YaHei UI',sans-serif;--ll-acrylic:${dark ? '50,44,29' : '240,230,210'};--ll-on-glass:${dark ? '#e9e1d9' : '#242018'};--ll-on-glass-2:${dark ? '#d0c5b4' : '#514d44'};--ll-on-glass-3:#aaa;--ll-brand-rgb:240,192,67;--ll-brand:#f0c043;--ll-material-opacity:.3;--ll-shadow-rgb:0,0,0;--ll-name-font-size:14px;--ll-title-font-size:${size}px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--tag_gray_bg:rgba(255,255,255,.12);--tag_gray_text:#ddd;--tag_purple_bg:rgba(150,20,250,.12);--tag_purple_text:#ddd;--tag_blue_bg:rgba(20,90,250,.12);--tag_blue_text:#ddd;--tag_orange_bg:rgba(250,170,20,.12);--tag_orange_text:#ddd}.chat-msg-area{display:grid;grid-template-columns:repeat(2,420px);gap:14px}.message-container{display:flex!important;flex-direction:column!important;align-items:flex-start;padding:0!important}.message-content__wrapper{display:flex}.msg-content-container{box-sizing:border-box}.text-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.user-name{max-width:100%}</style><body data-liuli-scope="main" data-liuli-chat-style="${mode}" data-liuli-tim-name-position="${placement}"><div id="app"><div class="chat-msg-area">${fixture(placement)}</div></div></body>`);
      await page.addScriptTag({ content: read('assets/mcu.js') });
      await page.addScriptTag({ content: read('renderer/color-roles.js') });
      await page.evaluate(dark => {
        const mcu = window.LiuliMCU, theme = mcu.themeFromSourceColor(mcu.argbFromHex('#b48c28')), scheme = dark ? theme.schemes.dark : theme.schemes.light;
        const vars = window.LiuliRoles.roleVars(mcu, theme, dark, { accent: 'primary', selected: 'primary', self: 'primary', others: 'surface' });
        for (const [key, value] of Object.entries(vars)) if (value !== null) document.body.style.setProperty(key, value);
        for (const key of ['primaryContainer', 'onPrimaryContainer', 'secondaryContainer', 'onSecondaryContainer', 'tertiaryContainer', 'onTertiaryContainer']) document.body.style.setProperty('--ll-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), mcu.hexFromArgb(scheme[key]));
        document.body.style.setProperty('--ll-surface-high', mcu.hexFromArgb(theme.palettes.neutral.tone(dark ? 17 : 92)));
      }, dark);
      const values = await page.evaluate(sample);
      try {
        for (const tag of values) {
          assert.equal(tag.alpha, 1, `${mode}/${placement}/${tag.variant} has a translucent surface`);
          assert.equal(tag.headerAlpha, 0, 'Whole sender row gained a backing');
          assert(tag.contrast >= 4.5, `${tag.variant} lost its matching foreground`);
          assert.equal(tag.opacity, '1');
          if (tag.variant !== 'group-only') assert.equal(tag.shape.fontSize, size + 'px');
          assert(tag.childColors.every(color => color === tag.foreground), 'Native descendants override semantic foreground');
        }
        const hidden = await page.evaluate(() => {
          document.body.setAttribute('data-liuli-hide-message-titles', '');
          document.body.setAttribute('data-liuli-hide-message-identity', '');
          return { title: getComputedStyle(document.querySelector('.user-label')).display, identity: [...document.querySelectorAll('.q-tag--orange,.q-tag--blue')].map(tag => getComputedStyle(tag).display), level: getComputedStyle(document.querySelector('.q-tag--grey .level')).display };
        });
        assert.equal(hidden.title, 'none');
        assert(hidden.identity.every(display => display === 'none'));
        assert.notEqual(hidden.level, 'none');
        await page.evaluate(() => { document.body.removeAttribute('data-liuli-hide-message-titles'); document.body.removeAttribute('data-liuli-hide-message-identity'); });
        report.cases.push({ mode, placement, dark, size, values, passed: true });
      } catch (error) { report.failures.push({ mode, placement, dark, size, error: error.message, values }); }
      if (dark && size === 10) await page.screenshot({ path: path.join(output, `${mode}-${placement}.png`), fullPage: true });
    }
    assert.equal(report.failures.length, 0, 'Message tag material regression');
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, cases: report.cases.length, failures: report.failures.length, error: report.error })); }
})();
