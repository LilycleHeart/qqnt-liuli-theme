'use strict';
// Native QQ CSS/voice structure are read-only captures, including the native
// content-box sizing, grid minimum height and inner voice padding.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/classic-readability-20261113'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
fs.mkdirSync(output, { recursive: true });
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const voice = read('dev/fixtures/qq-native-voice.html');
const nickname = role => `<div class="user-name no-copy text-ellipsis"><div class="group-member-label q-tag ${role === 'default' ? '' : 'q-tag--' + role}"><span class="level">${['grey', 'purple', 'default'].includes(role) ? 'LV100' : role === 'orange' ? '群主' : '管理员'}</span>${['grey', 'purple', 'default'].includes(role) ? '<span>女装加那</span>' : ''}</div><span class="text-ellipsis" style="white-space:pre">示例名称</span><span class="user-label">自定义头衔</span></div>`;
function markup() {
  const names = ['grey', 'blue', 'orange', 'purple', 'default'].map(role => `<div class="message-container" data-role="${role}"><span class="avatar-span"></span>${nickname(role)}<div class="message-content__wrapper"><div class="msg-content-container container--others mix-message__container"><div class="message-content mix-message__inner"><span class="text-element text-element--other"><span class="text-normal">短消息</span></span></div></div></div></div>`).join('');
  return names + voice + voice.replaceAll('container--others', 'container--self').replace('message-container--self', 'message-container--self message-container--align-right');
}
function sample() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((n, i) => i === 3 ? n / 255 : n); };
  const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
  const luminance = c => c.slice(0, 3).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  const contrast = (fg, bg) => { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  return {
    names: [...document.querySelectorAll('.message-container > .user-name')].map(name => {
      const s = getComputedStyle(name), nr = name.getBoundingClientRect();
      const nickname = getComputedStyle(name.querySelector(':scope > .text-ellipsis'));
      return { width: nr.width, height: nr.height, containerWidth: name.parentElement.getBoundingClientRect().width, padding: s.padding, background: s.backgroundColor, backgroundAlpha: rgb(s.backgroundColor)[3], borderWidth: s.borderWidth, borderRadius: s.borderRadius, boxShadow: s.boxShadow,
        nicknameColor: nickname.color, nicknameRGB: rgb(nickname.color), textShadow: nickname.textShadow,
        labels: [...name.querySelectorAll('.q-tag,.user-label')].map(label => {
          const ls = getComputedStyle(label), lr = label.getBoundingClientRect();
          return { class: label.className, fontSize: ls.fontSize, color: ls.color, rect: lr.toJSON(), backgroundAlpha: rgb(ls.backgroundColor)[3], borderWidth: ls.borderWidth, borderRadius: ls.borderRadius, boxShadow: ls.boxShadow, padding: ls.padding, textShadow: ls.textShadow, contrast: [0, 255].map(wall => contrast(rgb(ls.color), over(rgb(ls.backgroundColor), [wall, wall, wall]))), childColor: [...label.children].map(child => getComputedStyle(child).color) };
        }) };
    }),
    voices: [...document.querySelectorAll('.message-content__wrapper > .ptt-message__container')].map(bubble => {
      const s = getComputedStyle(bubble), r = bubble.getBoundingClientRect(), top = bubble.querySelector('.ptt-element__top-area');
      return { width: r.width, height: r.height, paddingTop: parseFloat(s.paddingTop), paddingBottom: parseFloat(s.paddingBottom), paddingLeft: parseFloat(s.paddingLeft), background: s.backgroundColor, backgroundAlpha: rgb(s.backgroundColor)[3],
        controls: [...top.children].map(child => child.getBoundingClientRect().toJSON()), bounds: r.toJSON(), translateParent: bubble.querySelector('.ptt-translate-btn')?.parentElement.className || null };
    })
  };
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Native QQ CSS and captured voice DOM + production CSS/MCU semantic roles; no QQ state changes', cases: [], failures: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    for (const dark of [false, true]) for (const others of ['surface', 'primary', 'tertiary']) for (const size of [10, 16]) for (const full of [false, true]) {
      await page.setContent(`<!doctype html><style>${native}\n${css}\nbody{margin:20px!important;background:repeating-linear-gradient(90deg,#000 0px,#000 70px,#fff 70px,#fff 140px)!important;font-family:'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_3:14px;--font_size_main_2:14px;--ll-acrylic:${dark ? '50,44,29' : '240,230,210'};--ll-on-glass:${dark ? '#e9e1d9' : '#242018'};--ll-on-glass-2:${dark ? '#d0c5b4' : '#514d44'};--ll-on-glass-3:#aaa;--ll-message-font-size:14px;--ll-name-font-size:14px;--ll-title-font-size:${size}px;--ll-shadow-rgb:0,0,0;--ll-material-opacity:.3;--ll-brand-rgb:240,192,67;--ll-brand:#f0c043;--ll-bubble-scale:1;--on_bg_text:#ccc;--tag_blue_bg:#fff0;--tag_blue_text:#eee;--tag_orange_bg:#fff0;--tag_orange_text:#eee;--tag_gray_bg:#fff0;--tag_gray_text:#eee}#app{width:850px}.chat-msg-area{width:100%}.message-container{width:100%;box-sizing:border-box}.text-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><body data-liuli-scope="main" data-liuli-chat-style="classic" ${full ? 'data-liuli-full-message-names' : ''}><div id="app"><div class="chat-msg-area">${markup()}</div></div></body>`);
      await page.addScriptTag({ content: read('assets/mcu.js') });
      await page.addScriptTag({ content: read('renderer/color-roles.js') });
      await page.addScriptTag({ content: read('renderer/voice-layout.js') });
      await page.evaluate(({ dark, others }) => {
        for (const el of document.querySelectorAll('.ptt-message')) el.setAttribute('data-v-3c5afce1', '');
        for (const el of document.querySelectorAll('[class^="ptt-element__bottom-area"]')) el.setAttribute('data-v-2c51e444', '');
        document.querySelectorAll('.ptt-element__duration > span').forEach(el => el.textContent = '7″');
        document.querySelectorAll('.ptt-translate-btn').forEach(el => el.textContent = '转文字');
        const mcu = window.LiuliMCU, theme = mcu.themeFromSourceColor(mcu.argbFromHex('#b48c28'));
        const vars = window.LiuliRoles.roleVars(mcu, theme, dark, { accent: 'primary', selected: 'primary', self: 'primary', others });
        for (const [key, value] of Object.entries(vars)) if (value !== null) document.body.style.setProperty(key, value);
        // Also use actual scheme container/on-container pairs for native labels.
        const scheme = dark ? theme.schemes.dark : theme.schemes.light;
        for (const key of ['primary', 'secondary', 'tertiary', 'primaryContainer', 'onPrimaryContainer', 'secondaryContainer', 'onSecondaryContainer', 'tertiaryContainer', 'onTertiaryContainer']) document.body.style.setProperty('--ll-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), mcu.hexFromArgb(scheme[key]));
        document.body.style.setProperty('--ll-surface-high', mcu.hexFromArgb(theme.palettes.neutral.tone(dark ? 17 : 92)));
        window.__liuliVoiceLayout.refresh();
      }, { dark, others });
      const values = await page.evaluate(sample);
      const caseName = { dark, others, size, full };
      try {
        for (const name of values.names) {
          assert(name.width < name.containerWidth * .7, 'Nickname expanded across the row');
          assert.equal(name.backgroundAlpha, 0, 'An unwanted nickname backing returned');
          assert.equal(name.borderWidth, '0px');
          assert.equal(name.borderRadius, '0px');
          assert.equal(name.boxShadow, 'none');
          assert.equal(name.padding, '0px');
          assert(name.nicknameRGB.slice(0, 3).every(n => n >= 240), 'Nickname lost its light neutral lettering');
          assert.notEqual(name.textShadow, 'none', 'Wallpaper lettering lost its glyph shadow');
          for (const label of name.labels) {
            assert.equal(label.fontSize, size + 'px');
            assert.equal(label.backgroundAlpha, 1, 'Metadata variants disagree on opacity');
            assert.equal(label.borderWidth, '0px');
            assert.equal(label.borderRadius, '4px');
            assert.equal(label.boxShadow, 'none');
            assert.equal(label.padding, '0px 5px');
            assert.equal(label.textShadow, 'none');
            assert(label.contrast.every(n => n >= 4.5), 'Native metadata surface lost its matching foreground');
            assert(label.childColor.every(color => color === label.color), 'Native label descendants override their semantic foreground');
            assert(label.rect.height >= size * 1.35, 'Metadata line clipped');
          }
        }
        for (const voice of values.voices) {
          assert(voice.paddingTop >= 7.9 && voice.paddingBottom >= 7.9, 'Classic voice surface lost vertical padding');
          assert(voice.height >= 36.9, 'Voice collapsed to the bare control height');
          assert(voice.backgroundAlpha >= .85, 'Native transparent voice background overrode the shared surface');
          for (const control of voice.controls) assert(control.top >= voice.bounds.top + 7.8 && control.bottom <= voice.bounds.bottom - 7.8, 'Voice controls touch or escape the bubble edges');
        }
        report.cases.push({ ...caseName, passed: true, values });
      } catch (error) { report.failures.push({ ...caseName, error: error.message, values }); }
      if (size === 10 && full && others === 'surface') await page.screenshot({ path: path.join(output, dark ? 'classic-dark.png' : 'classic-light.png'), fullPage: true });
    }
    assert.equal(report.failures.length, 0, 'Classic readability/native voice regression');
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, cases: report.cases.length, failures: report.failures.length, error: report.error })); }
})();
