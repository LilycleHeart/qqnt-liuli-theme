'use strict';
// Layout regression for QQ's real sender-name structure. Native rules and the
// ordinary level label were captured read-only from the running QQ stylesheet.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/identity-title-layout-20261113'));
fs.mkdirSync(output, { recursive: true });
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const native = `
.q-tag{border-radius:4px;display:inline-block;font-size:var(--font_size_1);padding:1px 4px}
.q-tag--blue{background-color:var(--tag_blue_bg);color:var(--tag_blue_text)}
.q-tag--grey{background-color:var(--tag_gray_bg);color:var(--tag_gray_text)}
.group-member-label{font-size:min(var(--font_size_1),14px)!important;line-height:min(var(--line_height_1),20px)!important}
.group-member-label .level{font-weight:500}.group-member-label span:nth-child(2){margin-left:2px}
.message-container .user-name{align-items:center;color:var(--on_bg_text);display:flex;grid-area:nickname;min-height:18px;padding:0 calc(var(--avatar_size_2) + 8px) 0 0;position:relative;top:-2px;user-select:none;font-size:var(--font_size_2)!important;line-height:var(--line_height_2)!important}
.message-container .user-name .user-label{border-radius:4px;box-sizing:border-box;color:var(--text-white);display:inline-block;font-size:10px;height:14px;line-height:15px;margin-right:4px;padding:0 4px}
.message-container .user-name .group-member-label{margin-left:0;margin-right:4px;font-size:min(var(--font_size_1),14px)!important;line-height:min(var(--line_height_1),20px)!important}
`;
const production = ['typography.css', 'bubbles.css', 'lists.css', 'markdown.css'].map(file => read('assets/' + file)).join('\n');
const sender = (label, nickname, extraAttr = '') => `<div class="user-name no-copy text-ellipsis" ${extraAttr}>${label}<span class="text-ellipsis" style="white-space:pre">${nickname}</span><span class="user-label">自定义群头衔</span></div>`;
const labels = [
  '<div class="group-member-label q-tag q-tag--grey"><span class="level">LV100</span><span>热心群友</span></div>',
  '<div class="group-member-label q-tag q-tag--blue"><span>管理员</span></div>',
  '<div class="group-member-label q-tag q-tag--orange"><span>群主</span></div>'
];
const measure = () => [...document.querySelectorAll('.user-name')].map(name => ({
  top: getComputedStyle(name).top,
  nicknameVisible: getComputedStyle(name.querySelector('.text-ellipsis')).display !== 'none',
  nicknameHeight: name.querySelector('.text-ellipsis').getBoundingClientRect().height,
  nicknameLineHeight: parseFloat(getComputedStyle(name.querySelector('.text-ellipsis')).lineHeight),
  marginBottom: getComputedStyle(name).marginBottom,
  bodyGap: name.nextElementSibling.getBoundingClientRect().top - name.getBoundingClientRect().bottom,
  label: [...name.querySelectorAll('.q-tag,.user-label')].map(label => ({
    display: getComputedStyle(label).display,
    fontSize: parseFloat(getComputedStyle(label).fontSize),
    whiteSpace: getComputedStyle(label).whiteSpace,
    rect: label.getBoundingClientRect().toJSON(),
    children: [...label.children].map(child => ({
      rect: child.getBoundingClientRect().toJSON(),
      fontSize: parseFloat(getComputedStyle(child).fontSize),
      whiteSpace: getComputedStyle(child).whiteSpace
    }))
  }))
}));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'QQ native name rules + source CSS; no runtime setting writes or conversation navigation', cases: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 500 } });
    for (const [style, inside] of [['tg', true], ['tim', true], ['tim', false], ['classic', false]]) for (const full of [false, true]) for (const size of [10, 16]) for (const width of [110, 260]) {
      const fullAttr = full ? 'data-liuli-full-message-names' : '';
      const samples = labels.map((label, i) => {
        const name = sender(label, i ? '坏心眼' : 'CpiyLie', inside ? 'data-liuli-name-before' : '');
        const bubble = `<div class="msg-content-container container--others"${inside ? ' data-liuli-name-only-content' : ''}><div class="message-content"><span class="text-element">DJmax不恶心</span></div></div>`;
        return `<div class="ml-item"><div class="message-container message-container--others" data-liuli-side="others" style="width:${width}px">${inside ? bubble.replace('<div class="message-content">', name + '<div class="message-content">') : name + bubble}</div></div>`;
      }).join('');
      await page.setContent(`<!doctype html><style>${native}\n${production}
body{margin:24px;background:#28271e;color:#e8e6dc;font-family:'Microsoft YaHei UI',sans-serif;--ll-brand:#a9cdad;--ll-brand-rgb:169,205,173;--ll-acrylic:50,44,29;--ll-material-opacity:.3;--ll-name-font-size:14px;--ll-title-font-size:${size}px;--ll-name:#a9cdad;--ll-on-glass:#e8e6dc;--ll-on-glass-2:#ddd;--ll-secondary-container:#3a4e3d;--ll-on-secondary-container:#c8e6c9;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px}
.ml-item{margin-bottom:20px}.message-container{display:flex;flex-direction:column;align-items:flex-start}.msg-content-container{box-sizing:border-box;max-width:100%;min-width:0}.text-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.message-content{padding-top:4px}.user-name{box-sizing:border-box;max-width:100%}
</style><body data-liuli-chat-style="${style}" data-liuli-tim-sender-position="${inside ? 'inside' : 'avatar'}" ${fullAttr}>${samples}</body>`);
      const values = await page.evaluate(measure);
      for (const name of values) {
        assert(name.nicknameVisible);
        if (full) assert(name.nicknameHeight <= name.nicknameLineHeight + 1, 'Short nickname squeezed into one glyph per line beside metadata');
        if (inside) {
          assert(['auto', '0px'].includes(name.top), 'Native -2px offset escaped into the bubble');
          assert.equal(name.marginBottom, '0px', 'Nickname retained a bottom margin inside the bubble');
          assert(Math.abs(name.bodyGap) < 0.1, 'Nickname and message body line boxes should meet inside the bubble');
        }
        for (const label of name.label) {
          assert.equal(label.whiteSpace, 'nowrap', 'Metadata wrapped internally');
          assert.equal(label.fontSize, size, 'Independent title font setting was overridden');
          assert(label.rect.height >= size * 1.35, 'A fixed tag height clipped larger title text');
          for (const child of label.children) {
            assert.equal(child.whiteSpace, 'nowrap');
            assert(child.rect.height <= label.rect.height + .5, 'A multiline level/title escaped its label height');
            assert(child.rect.top >= label.rect.top - .5 && child.rect.bottom <= label.rect.bottom + .5, 'Tag text was vertically cropped');
          }
        }
      }
      for (const [hideTitles, hideIdentity] of [[false, false], [true, false], [true, true], [false, true], [false, false]]) {
        const result = await page.evaluate(({ hideTitles, hideIdentity }) => {
          document.body.toggleAttribute('data-liuli-hide-message-titles', hideTitles);
          document.body.toggleAttribute('data-liuli-hide-message-identity', hideIdentity);
          const hasLayout = element => element.getClientRects().length > 0;
          return [...document.querySelectorAll('.user-name')].map(name => ({
            title: hasLayout(name.querySelector('.user-label')),
            badge: hasLayout(name.querySelector('.group-member-label')),
            grey: !!name.querySelector('.q-tag--grey'),
            greyText: [...name.querySelectorAll('.q-tag--grey > span')].map(hasLayout),
            nickname: hasLayout(name.querySelector('.text-ellipsis'))
          }));
        }, { hideTitles, hideIdentity });
        for (const name of result) {
          assert.equal(name.title, !hideTitles, 'Custom title visibility');
          assert.equal(name.badge, !(name.grey ? hideTitles : hideIdentity), 'Group badge visibility');
          if (name.grey) assert.deepEqual(name.greyText, [!hideTitles, !hideTitles], 'Grey badge level and title visibility');
          assert.equal(name.nickname, true, 'Nickname visibility');
        }
      }
      if (full && width === 110 && size === 16) await page.screenshot({ path: path.join(output, `name-${style}-${inside ? 'inside' : 'outside'}-narrow-large.png`) });
      report.cases.push({ style, inside, full, size, width, bodyGaps: values.map(name => name.bodyGap), passed: true });
    }
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'name-layout-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, error: report.error }, null, 2));
  }
})();
