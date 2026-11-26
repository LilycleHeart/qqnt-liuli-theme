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
const native = ['qq-native-message-layout.css', 'qq-native-forward-layout.css', 'qq-native-file.css']
  .map(name => read('dev/fixtures/' + name)).join('\n');
const setup = `
body{margin:0!important;padding:20px!important;background:#d2c9b3!important;font-family:'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#e9e1d9;--ll-on-glass-2:#d2c8bb;--ll-brand:#f0c043;--ll-brand-rgb:240,192,67;--ll-bubble-self:#f0c043;--ll-bubble-self-fg:#3e2e00;--ll-message-font-size:14px;--ll-shadow-rgb:0,0,0}
#test-area{width:1000px}.message-content{min-width:0}.avatar-native{width:32px;height:32px;background:#aaa;border-radius:50%}
.reply-element,.link-info,.ptt-element__bottom-area-text{width:180px}.pic-element img{display:block}
`;
function markup() {
  const short = ['那 r 神呢', '下班没', '行'];
  const long = '这是一条用来验证最大宽度的长消息，只有长内容应该因为上限改变而换行。'.repeat(20);
  const mixed = `<span class="text-normal">中英文 mixed content </span><a class="text-link">https://example.test/${'long-address/'.repeat(25)}</a><br><span class="text-normal" data-last-line>尾行 End</span>`;
  const caption = '<span class="text-element"><span class="text-normal" data-align-text>Caption</span></span>';
  const picture = '<div class="pic-element" style="width:180px;--ll-picture-ratio:180/50" data-keep-position><img alt="" width="180" height="50"></div>';
  const quote = '<div class="reply-element" data-keep-position><div class="reply-title"><div class="reply-info">Sender</div></div><div class="reply-content"><span class="mixed-container text-ellipsis"><span data-align-text>Quoted text</span></span></div></div>';
  const preview = '<div class="link-info" data-keep-size><div class="link-info__content"><div class="link-info__title"><span data-align-text>Preview title</span></div><div class="link-info__desc"><span data-align-text>Summary</span></div></div></div>';
  const forward = '<div class="forward-msg" data-v-425cf6c2 data-keep-size><div class="fwd-title text-ellipsis" data-v-425cf6c2 data-align-text>Forwarded messages</div><div class="fwd-content text-ellipsis" data-v-425cf6c2 data-align-text>Sender: [Image]</div><div class="count" data-v-425cf6c2>View 1 forwarded message</div></div>';
  const file = '<div class="file-message--content" data-v-0358c09e><div class="normal-file file-element" data-v-0645b5d3 data-keep-size><div class="file-header" data-v-0645b5d3><div class="file-name" data-v-0645b5d3 data-align-text>report.pdf</div><div class="file-icon" data-v-0645b5d3 data-keep-position></div></div><div class="file-info" data-v-0645b5d3>18 KB</div></div></div>';
  const markdown = '<div class="markdown-element"><pre data-keep-position>const result = calculateSeveralValues();\n<span data-align-text>short();</span></pre><table data-keep-position><tbody><tr><td>Column determines the width</td><td>Explicitly aligned column</td></tr><tr><td data-align-text>Cell</td><td style="text-align:center"><span data-keep-position>Centered</span></td></tr></tbody></table></div>';
  const special = [
    ['quote', quote + caption, 'reply-message__container', 'message-content reply-message__inner'],
    ['card', caption + preview],
    ['mixed-image', picture + picture + caption],
    ['image', picture],
    ['voice', '<div class="ptt-element"><div class="ptt-element__bottom-area-text" data-align-text>Voice transcript</div></div>', 'ptt-message__container', 'message-content'],
    ['markdown', markdown, 'markdown-message__container', 'message-content markdown-message__inner'],
    ['markdown-direct', markdown, 'markdown-message__container', 'markdown-message__inner'],
    ['forward', forward, null],
    ['file', file, null]
  ];
  function row(direction, text, i, isLong = false, isSpecial = false, bubbleClass = 'mix-message__container', innerClass = 'message-content mix-message__inner') {
    const hasTextAttr = text.includes('class="text-element"') ? ' data-liuli-has-text' : '';
    const content = bubbleClass === null ? text : `<div class="msg-content-container container--${direction} ${bubbleClass}"><div class="${innerClass}"${hasTextAttr}>${text}</div></div>`;
    return `
    <div class="ml-item"><div class="message-container message-container--mix-or-markdown ${direction === 'self' ? 'message-container--self message-container--align-right' : ''}" data-liuli-g="single" data-liuli-side="${direction}" data-liuli-msg-row${i === 'forward' ? ' data-liuli-forward' : ''}${isSpecial ? '' : ' data-liuli-tim-text'}>
      <span class="avatar-span"><div class="avatar-native"></div></span>
      <div class="message-content__wrapper" data-case="${direction}-${i}" data-long="${isLong}" data-special="${isSpecial}">${content}</div><div class="content-status"></div>
    </div></div>`;
  }
  const plain = ['others', 'self'].flatMap(direction => [...short, long].map((text, i) =>
    row(direction, `<span class="text-element"><span class="text-normal">${text}</span></span>`, i, i === short.length)));
  const events = ['self', 'others'].flatMap(direction => special.map(([kind, text, bubbleClass, innerClass]) =>
    row(direction, text, kind, false, true, bubbleClass, innerClass)));
  return `<div class="chat-msg-area" id="test-area">${plain.join('')}${row('self', `<span class="text-element">${mixed}</span>`, 'mixed', true)}${events.join('')}</div>`;
}
const measure = () => [...document.querySelectorAll('[data-case]')].map(wrapper => {
  const bubble = wrapper.firstElementChild;
  const style = getComputedStyle(bubble);
  const rect = bubble.getBoundingClientRect();
  const content = bubble.querySelector('.message-content');
  const row = bubble.closest('.message-container');
  const lastLine = bubble.querySelector('[data-last-line]');
  const inner = content?.querySelector('.text-element');
  const ranges = [...bubble.querySelectorAll('[data-align-text]')].map(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return { align: getComputedStyle(element).textAlign, x: range.getBoundingClientRect().left };
  });
  const fixed = [...bubble.querySelectorAll('[data-keep-size], [data-keep-position]')].map(element => {
    const box = element.getBoundingClientRect();
    return [box.width, box.height, ...(element.hasAttribute('data-keep-position') ? [box.left, box.top] : [])];
  });
  return { id: wrapper.dataset.case, long: wrapper.dataset.long === 'true', width: rect.width, height: rect.height, padding: style.padding,
    special: wrapper.dataset.special === 'true', right: rect.right, ranges, fixed,
    align: content ? getComputedStyle(content).textAlign : null, innerAlign: inner ? getComputedStyle(inner).textAlign : null,
    lastLineLeft: lastLine?.getBoundingClientRect().left,
    boxSizing: style.boxSizing, fontSize: inner ? getComputedStyle(inner).fontSize : null,
    minHeight: style.minHeight, wrapperHeight: bubble.parentElement.getBoundingClientRect().height,
    wrapperWidth: bubble.parentElement.getBoundingClientRect().width, grid: getComputedStyle(row).gridTemplateColumns,
    rowWidth: row.getBoundingClientRect().width };
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
          document.body.dataset.liuliSelfTextAlign = 'right';
          window.setWidth(100);
        }, scale);
        const full = await page.evaluate(measure);
        await page.evaluate(() => window.setWidth(40));
        const limited = await page.evaluate(measure);
        await page.evaluate(() => { document.body.dataset.liuliSelfTextAlign = 'left'; });
        const leftLimited = await page.evaluate(measure);
        await page.evaluate(() => window.setWidth(100));
        const leftFull = await page.evaluate(measure);
        const sample = { mode, scale, full, limited, leftFull, leftLimited };
        report.cases.push(sample);
        try {
          for (let i = 0; i < full.length; i++) {
            const before = full[i], after = limited[i];
            assert.equal(before.padding, after.padding, `${mode} ${before.id}: width setting altered padding`);
            assert.equal(before.boxSizing, after.boxSizing, `${mode} ${before.id}: width setting altered the box model`);
            assert.equal(before.fontSize, after.fontSize);
            if (before.special) continue;
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
          for (const [right, left] of [[full, leftFull], [limited, leftLimited]]) {
            for (let i = 0; i < right.length; i++) {
              const before = right[i], after = left[i];
              for (const key of ['grid', 'width', 'right', 'height', 'wrapperWidth']) {
                assert.equal(after[key], before[key], `${mode} ${before.id}: text alignment changed ${key}`);
              }
              if (before.id.startsWith('self-') && !before.special) {
                assert.equal(before.align, 'right');
                assert.equal(after.align, 'left');
                assert.equal(after.innerAlign, 'left');
                if (before.lastLineLeft !== undefined) assert(after.lastLineLeft < before.lastLineLeft - 1, 'The final short line did not move left');
              } else if (!before.id.startsWith('self-')) {
                assert.equal(after.align, before.align);
                assert.equal(after.innerAlign, before.innerAlign);
              }
              assert.deepEqual(after.fixed, before.fixed, `${mode} ${before.id}: event layout changed`);
              if (before.id.startsWith('self-')) {
                for (let j = 0; j < before.ranges.length; j++) {
                  assert.equal(before.ranges[j].align, 'right', before.id);
                  assert.equal(after.ranges[j].align, 'left', before.id);
                  assert(after.ranges[j].x < before.ranges[j].x - 1, `${mode} ${before.id}: text did not move left`);
                }
              } else assert.deepEqual(after.ranges, before.ranges, before.id);
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
