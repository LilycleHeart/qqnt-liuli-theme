'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/file-tim-repair-20261113/tim/after'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => name === 'bubbles.css' && process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const setup = `body{margin:0!important;padding:24px!important;background:#d3c9b0!important;font-family:'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#e9e1d9;--ll-on-glass-2:#d2c8bb;--ll-brand:#f0c043;--ll-brand-rgb:240,192,67;--ll-bubble-self:#f0c043;--ll-bubble-self-fg:#3e2e00;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-shadow-rgb:0,0,0}.chat-msg-area{width:720px}.avatar-native{width:32px;height:32px;background:#b9bcb9;border-radius:50%}.message-content{min-width:0}.sample-heading{font-size:12px;color:#42382a;margin:8px 20px}`;
const texts = {
  short: '<span class="text-normal">中文 English123</span>',
  long: '<span class="text-normal">这是一条包含中文和 English 的多行消息，文字应该从同一条左边线开始排列，第一行和最后一行都应完整落在气泡的圆角里面。\n后续内容保持相同的字号和行距，气泡高度增加时四角不能越变越大。测试链接：</span><a class="text-link">https://example.invalid/path/to/a-long-page?source=message</a>',
  explicit: '<span class="text-normal">第一行左对齐\nA second line remains aligned\n最后一行也要完整可读。</span>'
};
function markup() {
  return ['others', 'self'].map(direction => `<div class="sample-heading">${direction}</div>${['single', 'first', 'mid', 'last'].map((group, i) => `<div class="ml-item"><div class="message"><div class="message-native"><div class="message-container message-container--mix-or-markdown ${direction === 'self' ? 'message-container--self message-container--align-right' : ''}" data-liuli-g="${group}" data-liuli-tim-text data-sample="${direction}-${group}">
    <span class="avatar-span"><div class="avatar-native"></div></span><div class="message-content__wrapper"><div class="msg-content-container container--${direction} mix-message__container"><div class="message-content mix-message__inner"><span class="text-element">${texts[i === 1 ? 'short' : i === 2 ? 'explicit' : 'long']}</span></div></div></div><div class="content-status"></div>
    </div></div></div></div>`).join('')}`).join('');
}
function measure() {
  const results = [];
  for (const row of document.querySelectorAll('[data-sample]')) {
    const bubble = row.querySelector('.msg-content-container');
    const content = bubble.querySelector('.message-content');
    const rect = bubble.getBoundingClientRect();
    const style = getComputedStyle(bubble);
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(parseFloat);
    const factor = Math.min(1, rect.width / (radii[0] + radii[1] || 1), rect.width / (radii[2] + radii[3] || 1), rect.height / (radii[0] + radii[3] || 1), rect.height / (radii[1] + radii[2] || 1));
    const effective = radii.map(radius => radius * factor);
    const inside = (x, y) => {
      const points = [[effective[0], effective[0], x < effective[0] && y < effective[0]], [rect.width - effective[1], effective[1], x > rect.width - effective[1] && y < effective[1]], [rect.width - effective[2], rect.height - effective[2], x > rect.width - effective[2] && y > rect.height - effective[2]], [effective[3], rect.height - effective[3], x < effective[3] && y > rect.height - effective[3]]];
      return points.every(([cx, cy, inCorner], i) => !inCorner || Math.hypot(x - cx, y - cy) <= effective[i] + 1);
    };
    const lines = [];
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const line of range.getClientRects()) if (line.width && line.height) lines.push({ left: line.left - rect.left, top: line.top - rect.top, right: line.right - rect.left, bottom: line.bottom - rect.top });
    }
    const escaped = lines.filter(line => [[line.left, line.top], [line.right, line.top], [line.left, line.bottom], [line.right, line.bottom]].some(([x, y]) => !inside(x, y)));
    results.push({ id: row.dataset.sample, group: row.dataset.liuliG, rect: rect.toJSON(), radii, effective, textAlign: getComputedStyle(content).textAlign, font: getComputedStyle(content).fontSize, padding: style.padding, lines, escaped });
  }
  return results;
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'TIM production CSS with captured native grid/text rules; line boxes checked inside effective rounded outline; no QQ interaction', cases: [], failures: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><style>${native}\n${css}\n${setup}</style><body data-liuli-scope="main" data-liuli-chat-style="tim"><div class="chat-msg-area">${markup()}</div></body>`);
    for (const width of [240, 360, 600]) for (const scale of [80, 100, 140]) {
      await page.evaluate(({ width, scale }) => {
        document.querySelector('.chat-msg-area').style.width = width + 132 + 'px';
        document.body.setAttribute('data-liuli-limit-bubbles', '');
        document.querySelector('.chat-msg-area').style.setProperty('--ll-message-max-width', width + 'px');
        document.body.style.setProperty('--ll-bubble-scale', String(scale / 100));
        document.body.toggleAttribute('data-liuli-scaled-bubbles', scale !== 100);
      }, { width, scale });
      const samples = await page.evaluate(measure);
      report.cases.push({ width, scale, samples });
      for (const sample of samples) {
        try {
          assert(['left', 'start'].includes(sample.textAlign), `${sample.id} multi-line text is not left aligned`);
          assert(sample.radii.every(radius => radius <= 22), `${sample.id} corners grow with multi-line height`);
          if (sample.group !== 'single') {
            const inner = 4 * scale / 100;
            const corners = sample.id.startsWith('self-')
              ? sample.group === 'first' ? [2] : sample.group === 'mid' ? [1, 2] : [1]
              : sample.group === 'first' ? [3] : sample.group === 'mid' ? [0, 3] : [0];
            assert(corners.every(index => Math.abs(sample.radii[index] - inner) < .01), `${sample.id} inner corners do not follow the independent bubble scale`);
          }
          assert.equal(sample.escaped.length, 0, `${sample.id} line boxes escape the rounded background`);
          assert(sample.rect.width <= width + .1, 'Text exceeds maximum width');
        } catch (error) { report.failures.push({ width, scale, id: sample.id, message: error.message }); }
      }
      if (scale === 100) await page.screenshot({ path: path.join(output, `tim-${width}px.png`), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(report.failures, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, failures: report.failures.slice(0, 6), error: report.error }));
  }
})();
