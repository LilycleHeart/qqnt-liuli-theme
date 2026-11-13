'use strict';
// Local only: node --test dev/standalone-profile.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const createSync = require('../standalone-profile.cjs');
const { VARIABLES, PROFILE_CSS, isBlank, isSource, sanitizePalette } = createSync.testing;
const palette = { '--ll-brand': '#683a92', '--ll-on-brand': '#ffffff', '--ll-on-glass': '#221b26', '--ll-popup-bg': '#eee0f7' };

function mock(id, url) {
  const wc = new EventEmitter();
  Object.assign(wc, { id, url, mainFrame: {}, calls: [], isDestroyed: () => false,
    getURL: () => wc.url, isLoadingMainFrame: () => false,
    executeJavaScript: async script => { wc.calls.push(script); return false; } });
  return { wc, applied: true };
}
function message(state, payload, frame = state.wc.mainFrame) {
  const install = state.wc.calls.find(script => script.includes('"token":'));
  const token = JSON.parse(install.slice(install.lastIndexOf(')(') + 2, -1)).token;
  state.wc.emit('console-message', { frame, message: token + JSON.stringify(payload) });
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('about:blank 精确白名单；通话、共享及其他路由不会成为主窗源', () => {
  assert.equal(isBlank('about:blank'), true);
  for (const url of ['about:blank#x', 'about:srcdoc', 'app://./renderer/index.html#/blank', '', 'file:///blank']) assert.equal(isBlank(url), false);
  assert.equal(isSource('app://./renderer/index.html#/main/message'), true);
  for (const url of ['app://./renderer/index.html#/av', 'app://./renderer/index.html#/share', 'app://./renderer/index.html#/mainly', 'https://qq/renderer/index.html#/main']) assert.equal(isSource(url), false);
});

test('只传颜色/材质白名单，拒绝URL与变量引用', () => {
  const vars = sanitizePalette({ ...palette, '--ll-wallpaper': 'url(secret)', '--ll-noise': 'url(secret)', '--ll-acrylic': '1, 2, 3', '--ll-material-blur': 'blur(12px) saturate(1.6)', '--ll-brand-hover': 'url(https://invalid)', '--ll-brand-pressed': 'var(--secret)', '--ll-stroke-1': '#000; color:red' });
  assert.equal(vars['--ll-brand'], palette['--ll-brand']);
  assert.equal(vars['--ll-material-blur'], 'blur(12px) saturate(1.6)');
  for (const name of ['--ll-wallpaper', '--ll-noise', '--ll-brand-hover', '--ll-brand-pressed', '--ll-stroke-1']) assert.equal(vars[name], undefined);
  assert.equal(sanitizePalette({}), null);
  assert(!VARIABLES.some(name => /wallpaper|noise|bubble|layout/.test(name)));
  assert(!/url\(|position:|width:|height:|transform:|font-size:/.test(PROFILE_CSS));
  for (const selector of PROFILE_CSS.split('}').filter(value => value.trim()).map(value => value.split('{')[0].trim())) assert(selector.startsWith('.standalone-mini-profile-container[data-liuli-standalone-profile="1"]'));
});

test('load.js eligible 保持跳过 about:blank，独立通道单独挂接', () => {
  const load = fs.readFileSync(path.join(__dirname, '../load.js'), 'utf8');
  const fn = load.slice(load.indexOf('function eligible('), load.indexOf('\nfunction initDiagnostics'));
  const eligible = new Function(fn + '; return eligible;')();
  assert.equal(eligible('about:blank'), false);
  assert.equal(eligible('app://./renderer/index.html#/av'), false);
  assert.equal(eligible('app://./renderer/index.html#/main'), true);
  assert(load.includes('profiles.attach(state)'));
  assert(load.includes('await profiles.themeReady(state)'));
});

test('重复attach不重复监听；空壳只装DOM检测；其他页面完全跳过', async () => {
  const sync = createSync();
  const blank = mock(20, 'about:blank');
  const call = mock(21, 'app://./renderer/index.html#/av');
  const share = mock(22, 'app://./renderer/index.html#/screen-share');
  sync.attach(blank); sync.attach(blank); sync.attach(call); sync.attach(share);
  await settle();
  assert.equal(blank.wc.listenerCount('dom-ready'), 1);
  assert.equal(blank.wc.listenerCount('console-message'), 1);
  assert.equal(blank.wc.calls.length, 1);
  assert.equal(call.wc.calls.length, 0);
  assert.equal(share.wc.calls.length, 0);
  assert(blank.wc.calls[0].includes('MutationObserver'));
  assert(!blank.wc.calls[0].includes('setInterval'));
});

test('主窗换色只更新命中卡片；子frame消息、导航后旧token无效', async () => {
  const sync = createSync();
  const source = mock(3, 'app://./renderer/index.html#/main');
  const card = mock(20, 'about:blank');
  const shell = mock(23, 'about:blank');
  sync.attach(source); sync.attach(card); sync.attach(shell);
  await settle();
  message(card, { kind: 'profile', present: true });
  message(source, { kind: 'palette', vars: palette }, {});
  await settle();
  assert(!card.wc.calls.some(script => script.includes('683a92')));
  message(source, { kind: 'palette', vars: palette });
  await settle();
  assert(card.wc.calls.some(script => script.includes('683a92')));
  assert(!shell.wc.calls.some(script => script.includes('683a92')));
  message(source, { kind: 'palette', vars: { ...palette, '--ll-brand': '#00aa77' } });
  await settle();
  assert(card.wc.calls.some(script => script.includes('00aa77')));
  const before = card.wc.calls.length;
  card.wc.emit('did-start-navigation', {}, 'about:blank', false, true);
  message(card, { kind: 'profile', present: true });
  message(source, { kind: 'palette', vars: { ...palette, '--ll-brand': '#aa0000' } });
  await settle();
  assert.equal(card.wc.calls.length, before);
  source.wc.emit('destroyed');
  shell.wc.emit('destroyed'); card.wc.emit('destroyed');
});

test('主窗尚未完成主题时不读取；就绪后挂接，来源离开/销毁撤销卡片配色', async () => {
  const sync = createSync();
  const source = mock(3, 'app://./renderer/index.html#/main');
  source.applied = false;
  const card = mock(20, 'about:blank');
  sync.attach(source); sync.attach(card);
  await settle();
  assert.equal(source.wc.calls.length, 0);
  source.applied = true;
  await sync.themeReady(source);
  message(card, { kind: 'profile', present: true });
  message(source, { kind: 'palette', vars: palette });
  await settle();
  assert(card.wc.calls.at(-1).includes('683a92'));
  source.wc.url = 'app://./renderer/index.html#/blank';
  source.wc.emit('did-navigate-in-page', {}, source.wc.url, true);
  await settle();
  assert(card.wc.calls.at(-1).includes('.update(null)'));
  source.wc.url = 'app://./renderer/index.html#/main';
  source.wc.emit('did-navigate-in-page', {}, source.wc.url, true);
  await settle();
  message(source, { kind: 'palette', vars: palette });
  await settle();
  assert(card.wc.calls.at(-1).includes('683a92'));
  source.wc.emit('destroyed');
  await settle();
  assert(card.wc.calls.at(-1).includes('.update(null)'));
});
