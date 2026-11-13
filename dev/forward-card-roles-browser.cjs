'use strict';
// Captured native QQ forwarded-history DOM with production CSS and MCU roles.
// Browser-only verification: this script never connects to or changes live QQ.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/forward-card-roles-20261113/browser-after'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css') + '\n' + read('dev/fixtures/qq-native-forward-layout.css');
const capturedRows = JSON.parse(read('dev/fixtures/qq-native-forward-rows.json'));
const setup = `body{margin:20px!important;background:repeating-linear-gradient(60deg,#80735f 0px,#80735f 80px,#ded6be 80px,#ded6be 160px)!important;font:14px 'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-material-opacity:.3;--ll-shadow-rgb:0,0,0;--ll-brand:#f0c043;--ll-brand-rgb:240,192,67;--bubble_guest:rgba(var(--ll-acrylic),.42);--bubble_guest_text:var(--ll-on-glass);--text_primary:var(--ll-on-glass);--text_secondary:var(--ll-on-glass-2);--text_tertiary:var(--ll-on-glass-3)}.chat-msg-area{width:900px}.avatar,.avatar-native{background-image:none!important;background:#a1a19b!important}section{margin-bottom:12px}.sample-heading{font-size:12px;color:#333}.preview-author{font-weight:500}.reference{width:max-content}.reference .msg-content-container{display:block}.pic-element{width:90px;height:50px;background:#a8a19b}`;
const reference = direction => `<div class="message-container message-container--${direction}" data-reference="${direction}"><div class="user-name">普通消息发送者</div><div class="message-content__wrapper reference"><div class="msg-content-container container--${direction}"><div class="message-content"><span class="text-element text-normal">普通消息正文</span></div></div></div></div>`;
const picture = '<div class="message-container" data-control="picture"><div class="user-name">图片发送者</div><div class="message-content__wrapper"><div class="msg-content-container container--others mix-message__container--pic" data-liuli-image-only><div class="message-content"><div class="pic-element"></div></div></div></div></div>';
function measure() {
  const pick = node => { const s = getComputedStyle(node); return { background: s.backgroundColor, color: s.color, shadow: s.boxShadow, blur: s.backdropFilter }; };
  const refs = Object.fromEntries([...document.querySelectorAll('[data-reference]')].map(row => [row.dataset.reference, pick(row.querySelector('.msg-content-container'))]));
  return {
    references: refs,
    cards: [...document.querySelectorAll('section[data-card]')].map(section => {
      const row = section.querySelector('.message-container'), card = row.querySelector('.forward-msg'), nested = !!card.closest('.msg-content-container');
      const surface = nested ? card.closest('.msg-content-container') : card;
      return { id: section.dataset.card, direction: section.dataset.direction, nested, material: pick(surface), card: pick(card),
        externalNames: [...row.querySelectorAll(':scope > .user-name, :scope > .message-content__wrapper > .msg-content-container > .user-name')].map(name => getComputedStyle(name).display),
        title: getComputedStyle(card.querySelector('.fwd-title')).color,
        preview: getComputedStyle(card.querySelector('.fwd-content')).color,
        count: getComputedStyle(card.querySelector('.count')).color,
        previewText: card.querySelector('.fwd-content').textContent,
        previewAuthorDisplay: getComputedStyle(card.querySelector('.preview-author')).display,
        handlerPreserved: card.onclick === window.nativeCardHandlers.get(card),
        padding: getComputedStyle(card).padding, radius: getComputedStyle(card).borderRadius };
    }),
    controls: { ordinaryNames: [...document.querySelectorAll('[data-reference] > .user-name')].map(node => getComputedStyle(node).display), pictureName: getComputedStyle(document.querySelector('[data-control="picture"] > .user-name')).display, picture: pick(document.querySelector('[data-control="picture"] .msg-content-container')) }
  };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Captured native QQ forwarded-history DOM, native CSS and production MCU roles; no live QQ operations', cases: [], failures: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 1080 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const mode of ['tg', 'tim', 'classic']) for (const dark of [false, true]) for (const roleSet of [{ self: 'solid', others: 'surface' }, { self: 'secondary', others: 'tertiary' }]) {
      await page.setContent(`<!doctype html><style>${native}\n${css}\n${setup}</style><body data-liuli-scope="main" data-liuli-chat-style="${mode}" data-liuli-avatar-position="top" data-liuli-tim-sender-position="inside"><div class="chat-msg-area"></div></body>`);
      await page.evaluate(captured => {
        const area = document.querySelector('.chat-msg-area');
        function add(html, id, direction, nested) {
          const section = document.createElement('section'); section.dataset.card = id; section.dataset.direction = direction === 'others' ? 'others' : 'self'; section.innerHTML = html;
          const row = section.querySelector('.message-container');
          row.classList.remove('message-container--others', 'message-container--self', 'message-container--align-right'); row.classList.add('message-container--' + direction);
          row.dataset.liuliG = 'single'; row.dataset.liuliAvatarG = 'single';
          const card = row.querySelector('.forward-msg');
          const content = card.querySelector('.fwd-content');
          const previewName = document.createElement('span'); previewName.className = 'preview-author'; previewName.textContent = '预览发送者: '; content.prepend(previewName);
          if (nested) {
            const wrapper = card.parentElement, bubble = document.createElement('div'); bubble.className = 'msg-content-container container--' + (direction === 'others' ? 'others' : 'self');
            const body = document.createElement('div'); body.className = 'message-content'; wrapper.appendChild(bubble); bubble.appendChild(body); body.appendChild(card);
            // Recreate a native sender already moved inside by a previous pass.
            bubble.prepend(row.querySelector('.user-name'));
          }
          for (const node of section.querySelectorAll('[id]')) node.removeAttribute('id');
          area.appendChild(section);
        }
        captured.forEach((row, index) => add(row.html, 'captured-' + index, 'others', false));
        for (const direction of ['others', 'self', 'align-right']) for (const nested of [false, true]) add(captured[0].html, `${direction}-${nested ? 'nested' : 'direct'}`, direction, nested);
      }, capturedRows);
      await page.locator('.chat-msg-area').evaluate((area, controls) => { area.insertAdjacentHTML('beforeend', controls); }, reference('others') + reference('self') + picture);
      await page.addScriptTag({ content: read('assets/mcu.js') });
      await page.addScriptTag({ content: read('renderer/color-roles.js') });
      await page.evaluate(({ dark, roleSet }) => {
        document.body.style.setProperty('--ll-acrylic', dark ? '50,44,29' : '240,230,210');
        document.body.style.setProperty('--ll-on-glass', dark ? '#e9e1d9' : '#242018');
        document.body.style.setProperty('--ll-on-glass-2', dark ? '#d0c5b4' : '#514d44');
        document.body.style.setProperty('--ll-on-glass-3', dark ? '#b9ad9c' : '#6d675e');
        const mcu = window.LiuliMCU, theme = mcu.themeFromSourceColor(mcu.argbFromHex('#b48c28'));
        const vars = window.LiuliRoles.roleVars(mcu, theme, dark, { accent: 'primary', selected: 'primary', ...roleSet });
        for (const [key, value] of Object.entries(vars)) if (value !== null) document.body.style.setProperty(key, value);
        window.nativeCardHandlers = new Map(); window.nativeCardClicks = 0;
        for (const card of document.querySelectorAll('.forward-msg')) { const fn = () => window.nativeCardClicks++; card.onclick = fn; window.nativeCardHandlers.set(card, fn); }
      }, { dark, roleSet });
      const values = await page.evaluate(measure);
      try {
        for (const card of values.cards) {
          const expected = values.references[card.direction];
          assert.deepEqual(card.material, expected, card.id + ' material does not match sender bubble role');
          assert(card.externalNames.length > 0 && card.externalNames.every(display => display === 'none'), card.id + ' sender metadata is visible');
          assert.equal(card.title, expected.color, card.id + ' title role');
          assert.equal(card.preview, expected.color, card.id + ' preview role');
          if (card.direction === 'self' || roleSet.others !== 'surface') assert.equal(card.count, expected.color, card.id + ' count role');
          assert(card.previewText.includes('预览发送者:'), 'Preview sender text was removed');
          assert.notEqual(card.previewAuthorDisplay, 'none', 'Preview sender name was hidden');
          assert(card.handlerPreserved, 'Native card handler changed');
          if (card.nested) { assert.equal(card.card.background, 'rgba(0, 0, 0, 0)', 'Nested card gained a second surface'); assert.equal(card.card.shadow, 'none'); }
        }
        assert.notEqual(values.controls.ordinaryNames[0], 'none', 'Ordinary sender metadata was hidden');
        assert.notEqual(values.controls.pictureName, 'none', 'Picture sender metadata was hidden');
        assert.equal(values.controls.picture.background, 'rgba(0, 0, 0, 0)', 'Picture surface changed');
        await page.locator('section[data-card]').first().locator('.forward-msg').click();
        assert.equal(await page.evaluate(() => window.nativeCardClicks), 1, 'Native card click no longer reaches handler');
        report.cases.push({ mode, dark, roleSet, values, passed: true });
      } catch (error) { report.failures.push({ mode, dark, roleSet, error: error.message, values }); }
      if (dark && roleSet.others === 'tertiary') await page.screenshot({ path: path.join(output, `${mode}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    assert.equal(report.failures.length, 0, 'Forwarded-history role/metadata regression');
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, cases: report.cases.length, failures: report.failures.length, error: report.error })); }
})();
