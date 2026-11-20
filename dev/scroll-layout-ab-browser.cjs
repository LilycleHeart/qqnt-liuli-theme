'use strict';
// Same sanitized rows and native CSS in every variant; no live QQ connection.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.join(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const baseline = file => execFileSync('git', ['show', 'v1.3.5+snowlora.2:' + file], { cwd: root, encoding: 'utf8' });
const baselineFiles = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', 'v1.3.5+snowlora.2', '--', 'assets'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/));
function style(get, includeCompact) {
  const source = get('renderer/index.js');
  return [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)]
    .map(match => match[1]).filter(name => includeCompact || name !== 'avatar-compact.css')
    .map(name => 'assets/' + name).filter(file => get === baseline ? baselineFiles.has(file) : existsSync(path.join(root, file)))
    .map(get).join('\n');
}
const native = read('dev/fixtures/qq-native-message-layout.css');
const compact = read('renderer/avatar-compact.js');
const shell = '<!doctype html><body window-name="MainWindow" data-liuli-scope="main"><div class="chat-msg-area"><div id="ml-root" class="chat-msg-area__vlist"><div class="ml-list"></div></div></div>';
const setup = 'body{margin:0;font:14px sans-serif;--avatar_size_2:32px;--font_size_2:14px;--line_height_2:20px;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-bubble-scale:1}#ml-root{height:220px;width:620px;overflow:auto;overflow-anchor:none}.ml-list{overflow:hidden}.message-container{box-sizing:border-box}.message-container__avatar{background:#888}';

function fixture({ old, mode, mediaHeight }) {
  if (!old) Object.assign(document.body.dataset, { liuliChatStyle: mode, liuliAvatarPosition: 'bottom', liuliTimSenderPosition: 'inside' });
  const list = document.querySelector('.ml-list');
  const make = (id, group) => {
    const row = document.createElement('div');
    row.className = 'ml-item'; row.id = id;
    row.innerHTML = '<div class="message"><div class="message-native"><div class="message-container message-container--mix-or-markdown">' +
      '<span class="avatar-span"><span class="avatar message-container__avatar"></span></span><div class="message-extra-top"></div>' +
      '<div class="message-content__wrapper"><div class="msg-content-container container--others mix-message__container--pic">' +
      '<div class="message-content"><div class="pic-element" style="width:72px;height:' + mediaHeight + 'px"></div></div></div></div></div></div></div>';
    if (group) {
      const host = row.querySelector('.message-container');
      host.dataset.liuliG = group;
      if (!old && mode === 'tim') host.dataset.liuliAvatarG = group;
    }
    return row;
  };
  const spacer = document.createElement('div'); spacer.style.height = '400px';
  list.replaceChildren(make('first', 'first'), make('tail'), make('next', 'single'), spacer);
  window.measureRows = () => {
    const host = document.querySelector('#tail .message-container');
    const row = host.closest('.ml-item');
    return { height: row.offsetHeight, next: row.nextElementSibling.offsetTop,
      avatar: host.querySelector('.avatar-span').offsetHeight, track: host.hasAttribute('data-ll-compact-host') };
  };
  window.tagTail = group => {
    const data = document.querySelector('#tail .message-container').dataset;
    data.liuliG = group;
    if (!old && mode === 'tim') data.liuliAvatarG = group;
  };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.argv[3] || undefined });
  const report = [];
  try {
    for (const mode of ['tg', 'tim']) for (const mediaHeight of [14, 44]) {
      const variants = {};
      for (const variant of mode === 'tg' ? ['dot2', 'without', 'with'] : ['without', 'with']) {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent(shell);
        const old = variant === 'dot2', active = variant === 'with';
        await page.addStyleTag({ content: [native, style(old ? baseline : read, active), setup].join('\n') });
        await page.evaluate(fixture, { old, mode, mediaHeight });
        const initial = await page.evaluate(() => window.measureRows());
        await page.evaluate(() => window.tagTail('last'));
        const grouped = await page.evaluate(() => window.measureRows());
        if (active) {
          await page.addScriptTag({ content: compact });
          await page.waitForFunction(() => window.measureRows().track);
        }
        const tracked = await page.evaluate(() => window.measureRows());
        await page.evaluate(() => { document.querySelector('#first').remove(); window.tagTail('single'); });
        if (active) await page.waitForFunction(() => !window.measureRows().track);
        const recycled = await page.evaluate(() => window.measureRows());
        variants[variant] = { initial, grouped, tracked, recycled };
        assert.deepEqual(errors, [], variant);
        await page.close();
      }
      report.push({ mode, mediaHeight, variants });
      const { initial, grouped, tracked, recycled } = variants.with;
      assert.equal(initial.height, grouped.height, mode + ': assigning the group changed the row height');
      assert.equal(initial.next, grouped.next, mode + ': assigning the group moved the next row');
      assert.equal(grouped.height, tracked.height, mode + ': attaching the avatar track changed the row height');
      assert.equal(grouped.next, tracked.next, mode + ': attaching the avatar track moved the next row');
      assert.equal(tracked.height, recycled.height, mode + ': turning a group tail into a single row changed its height');
      assert.equal(tracked.track, true, mode + ': Compact did not attach the group track');
      assert.equal(recycled.track, false, mode + ': Compact retained a stale group track');
    }
  } finally {
    await browser.close();
    console.log(JSON.stringify(report));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
