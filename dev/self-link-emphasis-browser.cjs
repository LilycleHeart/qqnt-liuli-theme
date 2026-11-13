'use strict';
// Exact production MCU, palette/role functions, theme cascade and captured QQ
// native layout in isolated Chromium. Never attaches to QQ or changes settings.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || process.env.LIULI_PLAYWRIGHT_PATH || 'playwright');
const executablePath = process.argv[3] || process.env.LIULI_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/self-link-emphasis-20261114'));
const beforePath = path.resolve(process.argv[5] || path.join(output, 'before/color-roles.js'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('renderer/index.js');
const cssFiles = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]).filter(file => fs.existsSync(path.join(root, 'assets', file)));
const css = cssFiles.map(file => read('assets/' + file)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const palette = source.slice(source.indexOf('  const SURFACE_TONES ='), source.indexOf('  let paletteGeneration ='));
assert(palette.includes('function deriveVars('), 'Missing production palette helpers');
assert(fs.existsSync(beforePath), 'Supply original color-roles.js as argument 5: ' + beforePath);
const seeds = ['#ebc529', '#ff0000', '#00ff00', '#0000ff', '#8e44ad', '#000000', '#ffffff'];
const selfRoles = ['primary', 'secondary', 'tertiary', 'solid', 'surface', 'inverse'];
const setup = `body{margin:16px!important;font:14px 'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-material-opacity:.3;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-bubble-scale:1}#app{width:850px}.chat-msg-area{width:100%}.message-container{width:100%;box-sizing:border-box}.text-ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.avatar-native{width:32px;height:32px;background:#888;border-radius:50%}`;
function row(direction, skin = false) {
  const sample = skin ? 'skin' : direction;
  return `<div class="ml-item"><div class="message"><div class="message-native"><div class="message-container message-container--${direction} ${direction === 'self' ? 'message-container--align-right' : ''}" data-liuli-g="single" data-liuli-avatar-g="single" data-sample="${sample}"><span class="avatar-span"><div class="avatar-native"></div></span><div class="message-extra-top"></div><div class="message-content__wrapper"><div class="msg-content-container container--${direction} mix-message__container ${skin ? 'container--personalization' : ''}"${skin ? ' style="--text_link:#345678;--on_bubble_host_text:#123456;--bubble_guest_text:#123456"' : ''}><div class="message-content mix-message__inner"><span class="text-element text-element--${direction === 'self' ? 'self' : 'other'}" data-v-06ac1ee5><span class="text-normal" data-v-06ac1ee5>正文 / Ordinary text </span><a class="text-link" data-v-06ac1ee5><span>https://example.com/one</span></a> <a class="text--link"><span>https://example.com/two</span></a><div class="link-info" data-v-06ac1ee5><div class="link-info__content" data-v-06ac1ee5><div class="link-info__title" data-v-06ac1ee5><span>Preview title</span></div><div class="link-info__desc" data-v-06ac1ee5><span>Preview description stays ordinary text</span></div></div></div></span></div></div></div><div class="message-tips"></div></div></div></div></div>`;
}
function fixture(mode, dark) {
  return `<!doctype html><meta charset="utf-8"><style>${native}\n${css}\n${setup}</style><body window-name="MainWindow" data-liuli-scope="main" data-liuli-chat-style="${mode}" data-liuli-avatar-position="top" data-liuli-tim-sender-position="inside" data-liuli-dark="${dark ? '1' : '0'}" q-theme="${dark ? 'dark' : 'light'}" is-base-theme="true"><div id="app"><div class="chat-msg-area"><div class="chat-msg-area__vlist">${row('self')}${row('others')}${row('self', true)}</div></div></div><div id="role-probe" style="position:fixed;visibility:hidden"></div></body>`;
}
const measure = () => Object.fromEntries([...document.querySelectorAll('[data-sample]')].map(row => {
  const bubble = row.querySelector('.msg-content-container');
  const color = selector => getComputedStyle(bubble.querySelector(selector)).color;
  return [row.dataset.sample, { background: getComputedStyle(bubble).backgroundColor, foreground: getComputedStyle(bubble).color, normal: color('.text-normal'), link: color('.text-link'), linkSpan: color('.text-link > span'), alternative: color('.text--link'), alternativeSpan: color('.text--link > span'), previewTitle: color('.link-info__title'), previewSummary: color('.link-info__desc'), previewSummarySpan: color('.link-info__desc > span') }];
}));
function rgb(color) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert(channels?.length === 3, 'Unsupported computed color: ' + color);
  return channels;
}
function contrast(a, b) {
  const luminance = color => rgb(color).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((value, channel, index) => value + channel * [.2126, .7152, .0722][index], 0);
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath });
  const report = { scope: 'Production MCU, palette/role functions and full theme cascade over captured QQ grid CSS; isolated Edge only, no QQ/settings/deployment operations', seeds, beforePath, cases: [], roleComparisons: [], failures: [], pageErrors: [], passed: false };
  try {
    const page = await browser.newPage({ viewport: { width: 950, height: 900 } });
    page.on('pageerror', error => report.pageErrors.push(error.stack));
    for (const mode of ['tg', 'tim', 'classic']) for (const dark of [false, true]) {
      await page.setContent(fixture(mode, dark));
      await page.addScriptTag({ content: read('assets/mcu.js') });
      await page.addScriptTag({ content: fs.readFileSync(beforePath, 'utf8') + '\nwindow.BeforeLiuliRoles=window.LiuliRoles;' });
      await page.addScriptTag({ content: read('renderer/color-roles.js') });
      await page.addScriptTag({ content: `(()=>{const {accentPalette}=LiuliRoles;${palette}window.paletteVars=deriveVars;})();` });
      for (const seed of seeds) {
        const result = { mode, dark, seed };
        try {
          const metadata = await page.evaluate(({ seed, dark, selfRoles }) => {
            const mcu = LiuliMCU, theme = mcu.themeFromSourceColor(mcu.argbFromHex(seed));
            const roleSet = { accent: 'primary', selected: 'primary', self: 'solid', others: 'surface' };
            const oldRoles = BeforeLiuliRoles.roleVars(mcu, theme, dark, roleSet);
            const newRoles = LiuliRoles.roleVars(mcu, theme, dark, roleSet);
            const baseVars = paletteVars(mcu, theme, dark, roleSet);
            window.applyRoleVars = vars => { for (const [key, value] of Object.entries({ ...baseVars, ...vars })) if (value === null) document.body.style.removeProperty(key); else document.body.style.setProperty(key, value); };
            window.oldRoles = oldRoles; window.newRoles = newRoles;
            window.applyRoleVars(oldRoles);
            const toComputed = value => { const probe = document.querySelector('#role-probe'); probe.style.color = value; return getComputedStyle(probe).color; };
            const s = dark ? theme.schemes.dark : theme.schemes.light;
            return { oldRoles, newRoles, expected: { background: toComputed(mcu.hexFromArgb(s.primary)), foreground: toComputed(mcu.hexFromArgb(s.onPrimary)), link: toComputed(newRoles['--ll-bubble-self-link']), otherLink: toComputed(baseVars['--ll-link']) }, comparisons: selfRoles.map(self => { const roles = { ...roleSet, self }; return { self, before: BeforeLiuliRoles.roleVars(mcu, theme, dark, roles), after: LiuliRoles.roleVars(mcu, theme, dark, roles) }; }) };
          }, { seed, dark, selfRoles });
          const before = await page.evaluate(measure);
          await page.evaluate(() => window.applyRoleVars(window.newRoles));
          const after = await page.evaluate(measure);
          result.before = before; result.after = after; result.expected = metadata.expected;
          assert.equal(metadata.oldRoles['--ll-bubble-self-link'], metadata.oldRoles['--ll-bubble-self-fg'], 'Before snapshot no longer reproduces solid link/foreground collision');
          assert.equal(before.self.link, before.self.normal, 'Before negative control did not reproduce rendered link collision');
          assert.notEqual(metadata.newRoles['--ll-bubble-self-link'], metadata.newRoles['--ll-bubble-self-fg'], 'Solid link still equals ordinary foreground');
          for (const { self, before: oldVars, after: newVars } of metadata.comparisons) {
            if (self === 'solid') {
              for (const key of Object.keys(oldVars).filter(key => key !== '--ll-bubble-self-link')) assert.equal(newVars[key], oldVars[key], 'Solid changed unrelated role: ' + key);
            } else assert.deepEqual(newVars, oldVars, self + ' role changed outside this fix');
          }
          assert.equal(after.self.background, metadata.expected.background, 'Actual solid bubble background diverged from MCU primary');
          for (const key of ['foreground', 'normal', 'previewTitle', 'previewSummary', 'previewSummarySpan']) {
            assert.equal(after.self[key], metadata.expected.foreground, 'Ordinary self text changed role: ' + key);
            assert.equal(after.self[key], before.self[key], 'Ordinary self text changed from baseline: ' + key);
          }
          for (const key of ['link', 'linkSpan', 'alternative', 'alternativeSpan']) assert.equal(after.self[key], metadata.expected.link, 'Link/inner plain span missed self link role: ' + key);
          result.contrast = contrast(after.self.link, after.self.background);
          assert(result.contrast >= 4.5, 'Solid self link contrast below 4.5: ' + result.contrast);
          assert.deepEqual(after.skin, before.skin, 'Personalization styling changed when the solid self link role changed');
          assert.deepEqual(after.others, before.others, 'Other-side foreground or link changed');
          assert.equal(after.others.link, metadata.expected.otherLink, 'Other link stopped following accent role');
          if (mode === 'tg') report.roleComparisons.push({ dark, seed, unchangedSelfRoles: selfRoles.filter(role => role !== 'solid'), solidChangedKeys: ['--ll-bubble-self-link'] });
          result.passed = true;
          if (seed === '#ebc529') await page.screenshot({ path: path.join(output, `${mode}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
        } catch (error) { result.error = error.stack; report.failures.push({ mode, dark, seed, error: error.message }); }
        report.cases.push(result);
      }
    }
    assert.deepEqual(report.pageErrors, [], 'Browser errors');
    report.minimumSolidContrast = Math.min(...report.cases.map(result => result.contrast).filter(Number.isFinite));
    report.passed = report.failures.length === 0;
    if (!report.passed) process.exitCode = 1;
  } catch (error) { report.failures.push({ error: error.stack }); process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'self-link-emphasis-browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, passedCases: report.cases.filter(result => result.passed).length, cases: report.cases.length, minimumSolidContrast: report.minimumSolidContrast, failures: report.failures }));
  }
})();
