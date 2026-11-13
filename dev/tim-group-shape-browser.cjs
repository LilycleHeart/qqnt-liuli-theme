'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/tim-group-shape-20261113'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const files = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = files.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const compatibilitySource = require('./patch-tim-grouping-live.cjs')();
const groupSource = source.slice(source.indexOf('  function groupMessages()'), source.indexOf('  function stickAvatars()'));
const setup = `body{margin:0!important;padding:24px!important;background:#d3c9b0!important;font-family:'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#e9e1d9;--ll-on-glass-2:#d2c8bb;--ll-brand:#f0c043;--ll-brand-rgb:240,192,67;--ll-bubble-self:#f0c043;--ll-bubble-self-fg:#3e2e00;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-shadow-rgb:0,0,0}.chat-msg-area{width:720px}.avatar-native{width:32px;height:32px;background:#b9bcb9;border-radius:50%}.pic-element{width:80px;height:50px;background:#86715f}.file-element{width:100px;height:40px}.personalization-bubble{width:100px;height:25px}.q-tag--blue{background:#386049;color:#e1f4e5}.user-label{background:#586154}.sample-heading{margin:18px 20px 8px;font-size:12px;color:#42382a}.message-content{min-width:0}`;
const kinds = ['first', 'mid', 'last', 'image', 'market-face', 'lottie', 'native-video', 'native-picture', 'voice', 'file', 'skin', 'video', 'emoji-only', 'direct-emoji-only', 'mixed-emoji', 'single', 'empty', 'unknown-face'];
function row(direction, kind, index) {
  const text = kind === 'mid' ? '? ? ? ? ? ? ? ? ? ? ? ? ? ? ?' : '?';
  const body = kind === 'voice'
    ? '<div class="ptt-message__inner"><div class="ptt-element"><div class="ptt-element__top-area"><div class="ptt-element__button"></div><div class="ptt-element__progress"></div><div class="ptt-element__duration"><span>7″</span></div></div></div></div>'
    : kind === 'image' || kind === 'native-picture' ? '<div class="message-content mix-message__inner"><div class="image pic-element" style="width:80px;height:50px"><img alt="" style="width:80px;height:50px"></div></div>'
      : kind === 'market-face' ? '<div class="message-content mix-message__inner"><div class="image market-face-element" style="width:80px;height:50px"><img alt="原生商城表情" style="width:80px;height:50px"></div></div>'
        : kind === 'lottie' ? '<div class="message-content mix-message__inner"><div class="image lottie-face-element" style="width:80px;height:50px"><canvas width="80" height="50"></canvas></div></div>'
          : kind === 'native-video' ? '<div class="message-content mix-message__inner"><div class="image video-element" style="width:80px;height:50px"><video width="80" height="50"></video></div></div>'
            : kind === 'emoji-only' ? '<div class="message-content mix-message__inner"><span class="text-element"><span class="face-element"><img class="face-element__icon" data-role="qqFace" data-face-index="264" alt="表情" width="20" height="20"></span></span></div>'
              : kind === 'direct-emoji-only' ? '<div class="message-content mix-message__inner"><span class="face-element" style="width:20px;height:20px" aria-label="表情"><img class="face-element__icon" data-role="qqFace" data-face-index="111" alt="表情" width="20" height="20"></span></div>'
                : kind === 'mixed-emoji' ? '<div class="message-content mix-message__inner"><span class="text-element"><span class="text-normal">Hi </span><span class="face-element"><img class="face-element__icon" data-role="qqFace" data-face-index="264" alt="表情" width="20" height="20"></span></span></div>'
                  : kind === 'empty' ? '<div class="message-content mix-message__inner"></div>'
                    : kind === 'unknown-face' ? '<div class="message-content mix-message__inner"><span class="face-element"></span><span class="unknown-message">unknown</span></div>'
      : kind === 'file' ? '<div class="message-content"><div class="file-element">file</div></div>'
        : kind === 'skin' ? '<div class="personalization-bubble"></div><div class="message-content"><span class="text-element">skin</span></div>'
          : kind === 'video' ? '<div class="message-content"><div class="video-element">video</div></div>'
            : `<div class="message-content mix-message__inner"><span class="text-element"><span class="text-normal">${text}</span></span></div>`;
  const extra = kind === 'voice' ? 'ptt-message__container' : kind === 'image' ? 'mix-message__container--pic' : kind === 'market-face' ? 'mix-message__container mix-message__container--market-face' : kind === 'lottie' ? 'mix-message__container mix-message__container--lottie-face' : kind === 'skin' ? 'container--personalization' : 'mix-message__container';
  return `<div class="ml-item" data-sample="${direction}-${kind}"><div class="message"><div class="message-native"><div class="message-container message-container--mix-or-markdown ${direction === 'self' ? 'message-container--self message-container--align-right' : ''} ${kind === 'voice' ? 'ptt-message' : ''}" data-direction="${direction}" data-time="${1000 + index}">
    <span class="avatar-span" aria-label="${direction}"><div class="avatar-native"></div></span>
    <div class="user-name"><div class="group-member-label q-tag q-tag--blue"><span>管理员</span></div><span class="text-ellipsis">${direction === 'self' ? 'My name' : 'Sender name'}</span><span class="user-label">头衔</span></div>
    <div class="message-content__wrapper"><div class="msg-content-container container--${direction} ${extra}" ${kind === 'video' ? 'data-liuli-video-only' : ''}>${body}</div></div><div class="content-status"></div>
  </div></div></div></div>`;
}
const markup = ['others', 'self'].map(direction => `<div class="sample-heading">${direction}</div>${kinds.map((kind, index) => row(direction, kind, index)).join('')}`).join('');
const measure = () => [...document.querySelectorAll('[data-sample]')].map(sample => {
  const row = sample.querySelector('.message-container');
  const bubble = row.querySelector('.msg-content-container');
  const style = getComputedStyle(bubble);
  const rect = bubble.getBoundingClientRect();
  return { id: sample.dataset.sample, group: row.dataset.liuliG, timText: row.hasAttribute('data-liuli-tim-text'), rect: rect.toJSON(),
    radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(parseFloat),
    tail: getComputedStyle(bubble, '::before').display, padding: style.padding,
    background: style.backgroundColor, foreground: style.color,
    rowRect: row.getBoundingClientRect().toJSON(), rowPadding: getComputedStyle(row).padding,
    wrapperMinHeight: getComputedStyle(bubble.parentElement).minHeight,
    nameDisplay: getComputedStyle(row.querySelector('.user-name')).display,
    identityDisplay: getComputedStyle(row.querySelector('.group-member-label')).display,
    titleDisplay: getComputedStyle(row.querySelector('.user-label')).display };
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Production TIM CSS/groupMessages with captured QQ native layout; no live QQ/settings writes', checks: [], samples: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><style>${native}\n${css}\n${setup}</style><body data-liuli-scope="main" data-liuli-chat-style="tim">${'<div class="chat-msg-area">' + markup + '</div>'}</body>`);
    await page.addScriptTag({ content: `(()=>{const llModeCfg={chatStyle:'tim'};window.LiuliQQ={messageRecord:node=>{const row=node.closest('.message-container');return{chatType:2,peerUid:'peer',senderUid:row.dataset.direction,msgTime:Number(row.dataset.time)};}};${groupSource}window.regroup=mode=>{llModeCfg.chatStyle=mode;document.body.dataset.liuliChatStyle=mode;groupMessages();};window.regroup('tim');})();` });
    const initial = await page.evaluate(measure);
    report.samples.push({ name: 'tim', values: initial });
    const byId = Object.fromEntries(initial.map(sample => [sample.id, sample]));
    for (const direction of ['others', 'self']) {
      const group = ['first', 'mid', 'last'].map(kind => byId[direction + '-' + kind]);
      assert.deepEqual(group.map(sample => sample.group), ['first', 'mid', 'last']);
      assert.deepEqual(group.map(sample => sample.radius), direction === 'self'
        ? [[18.5, 18.5, 4, 18.5], [18.5, 4, 4, 18.5], [18.5, 4, 18.5, 18.5]]
        : [[18.5, 18.5, 18.5, 4], [4, 18.5, 18.5, 4], [4, 18.5, 18.5, 18.5]]);
      const edge = direction === 'self' ? 'right' : 'left';
      for (let i = 1; i < group.length; i++) {
        assert(Math.abs(group[i].rect[edge] - group[0].rect[edge]) < .1, 'Connected TIM edge moved');
        assert(Math.abs(group[i].rect.top - group[i - 1].rect.bottom - 2) < .1, 'TIM group gap differs from2px');
      }
      assert.equal(group[0].tail, 'none');
      assert.equal(group[1].tail, 'none');
      assert.equal(group[2].tail, 'none');
      assert.equal(byId[direction + '-mixed-emoji'].timText, true, 'Text with native inline emoji lost its text shape');
      assert.equal(byId[direction + '-single'].timText, true);
      const inlineChain = ['emoji-only', 'direct-emoji-only', 'mixed-emoji', 'single'].map(kind => byId[direction + '-' + kind]);
      assert.deepEqual(inlineChain.map(sample => sample.group), ['first', 'mid', 'mid', 'last'], 'Inline-only QQ faces split the text group');
      assert(inlineChain.every(sample => sample.timText), 'Direct/nested native QQ faces lost their text shape');
      const inlineEdge = direction === 'self' ? 'right' : 'left';
      for (let i = 1; i < inlineChain.length; i++) {
        assert(Math.abs(inlineChain[i].rect[inlineEdge] - inlineChain[0].rect[inlineEdge]) < .1, 'Inline-only TIM face edge moved');
        assert(Math.abs(inlineChain[i].rect.top - inlineChain[i - 1].rect.bottom - 2) < .1, 'Inline-only TIM face group spacing changed');
      }
      for (const kind of ['image', 'market-face', 'lottie', 'native-video', 'native-picture', 'voice', 'file', 'skin', 'video', 'empty', 'unknown-face']) {
        assert.equal(byId[direction + '-' + kind].group, 'single', 'Native media unexpectedly joined text');
        assert.equal(byId[direction + '-' + kind].timText, false, 'Native media received the ordinary-text marker');
        assert(!byId[direction + '-' + kind].radius.includes(999), 'Text capsule shape leaked onto ' + kind);
      }
      for (const kind of ['market-face', 'lottie']) {
        assert.deepEqual(byId[direction + '-' + kind].radius, [8, 8, 8, 8]);
        assert.equal(byId[direction + '-' + kind].padding, '0px');
        assert.equal(byId[direction + '-' + kind].background, 'rgba(0, 0, 0, 0)');
      }
    }
    report.checks.push('Both directions join as first/mid/last with4px inner corners, retain a shared aligned edge and2px spacing, and remove the triangular tail.');
    report.checks.push('Native QQ inline faces, whether direct message-content children or nested in text-element, share TIM text corners and2px grouping with text. Captured market-face/lottie, unflagged pictures/videos, empty content and unknown face shells remain outside text groups.');
    assert.notEqual(byId['others-first'].nameDisplay, 'none');
    assert.equal(byId['others-mid'].nameDisplay, 'none');
    assert.equal(byId['others-last'].nameDisplay, 'none');
    assert.equal(byId['others-voice'].nameDisplay, 'none');
    report.checks.push('Sender name appears once for the cross-media sender/avatar group while media retain independent text-corner groups.');
    await page.screenshot({ path: path.join(output, 'tim-groups.png'), fullPage: true });
    await page.evaluate(() => document.body.setAttribute('data-liuli-hide-message-titles', ''));
    const hiddenTitles = await page.evaluate(measure);
    assert.equal(hiddenTitles.find(sample => sample.id === 'others-first').titleDisplay, 'none');
    await page.evaluate(() => { document.body.removeAttribute('data-liuli-hide-message-titles'); document.body.setAttribute('data-liuli-hide-message-identity', ''); });
    const hiddenIdentity = await page.evaluate(measure);
    assert.equal(hiddenIdentity.find(sample => sample.id === 'others-first').identityDisplay, 'none');
    report.checks.push('Independent title and identity visibility settings still apply to TIM names.');
    await page.evaluate(() => { document.body.removeAttribute('data-liuli-hide-message-identity'); window.regroup('classic'); });
    const classic = await page.evaluate(measure);
    assert(classic.every(sample => sample.group === 'single'));
    const mediaSurfaces = [];
    for (const mode of ['classic', 'tim', 'tg']) for (const scale of [80, 100, 140]) {
      await page.evaluate(({ mode, scale }) => {
        window.regroup(mode);
        document.body.style.setProperty('--ll-bubble-scale', String(scale / 100));
        document.body.toggleAttribute('data-liuli-scaled-bubbles', scale !== 100);
      }, { mode, scale });
      const values = await page.evaluate(measure);
      for (const sample of values.filter(sample => /-(?:image|market-face|lottie)$/.test(sample.id))) {
        assert.equal(sample.padding, '0px', `${mode}/${scale} native media gained text padding`);
        assert.equal(sample.background, 'rgba(0, 0, 0, 0)', `${mode}/${scale} native media gained a bubble surface`);
        if (mode === 'tim') assert(!sample.radius.includes(999), 'Native media received TIM capsule corners');
        mediaSurfaces.push({ mode, scale, id: sample.id, padding: sample.padding, background: sample.background, radius: sample.radius });
      }
    }
    report.nativeMediaSurfaces = mediaSurfaces;
    await page.evaluate(() => { document.body.style.removeProperty('--ll-bubble-scale'); document.body.removeAttribute('data-liuli-scaled-bubbles'); });
    report.checks.push('Native pure pictures, market faces and lottie keep transparent unpadded presentation across all3styles and80/100/140% sizes.');
    await page.evaluate(() => window.regroup('tg'));
    const tg = await page.evaluate(measure);
    assert.equal(tg.find(sample => sample.id === 'others-image').group, 'mid');
    for (const direction of ['others', 'self']) {
      for (const kind of ['first', 'mid', 'last', 'single']) {
        const tim = byId[direction + '-' + kind], other = tg.find(sample => sample.id === tim.id);
        assert.equal(tim.background, other.background);
        assert.equal(tim.foreground, other.foreground);
      }
    }
    report.checks.push('Classic remains ungrouped; existing TG grouping is retained; TIM colors and material continue to use TG semantic roles.');
    const compatibilityBaseline = await page.evaluate(() => {
      window.regroup('tim');
      window.__liuliSettingsCache = { chatStyle: 'tim', customColor: '#4bf11e', bubbleMaxWidth: 60 };
      window.configWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) { window.configWrites++; return original.apply(this, args); };
      for (const row of document.querySelectorAll('.message-container')) row.dataset.liuliG = 'single';
      return JSON.stringify(window.__liuliSettingsCache);
    });
    await page.addScriptTag({ content: compatibilitySource });
    assert.equal(await page.evaluate(() => window.__liuliTimGroupingCompatibility.passes), 1);
    assert.equal(await page.evaluate(() => document.querySelector('[data-sample="others-first"] .message-container').dataset.liuliG), 'first');
    await page.evaluate(() => {
      for (let i = 0; i < 24; i++) document.querySelector('.chat-msg-area').style.transform = `translateY(${i}px)`;
    });
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => window.__liuliTimGroupingCompatibility.passes), 1, 'Scroll geometry caused an extra grouping pass');
    await page.evaluate(() => {
      for (const row of document.querySelectorAll('.message-container')) row.dataset.liuliG = 'single';
    });
    await page.waitForFunction(() => document.querySelector('[data-sample="others-first"] .message-container').dataset.liuliG === 'first');
    const correctedPasses = await page.evaluate(() => window.__liuliTimGroupingCompatibility.passes);
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => window.__liuliTimGroupingCompatibility.passes), correctedPasses, 'Compatibility observer loops on its own group writes');
    await page.evaluate(() => {
      window.__liuliSettingsCache.chatStyle = 'classic';
      document.body.dataset.liuliChatStyle = 'classic';
      for (const row of document.querySelectorAll('.message-container')) row.dataset.liuliG = 'single';
    });
    await page.waitForTimeout(60);
    assert(await page.evaluate(() => [...document.querySelectorAll('.message-container')].every(row => row.dataset.liuliG === 'single')));
    await page.evaluate(() => {
      window.__liuliSettingsCache.chatStyle = 'tim';
      document.body.dataset.liuliChatStyle = 'tim';
      const area = document.createElement('div'); area.className = 'chat-msg-area'; document.body.appendChild(area);
    });
    await page.waitForFunction(() => window.__liuliTimGroupingCompatibility.areas === 2);
    await page.addScriptTag({ content: compatibilitySource });
    assert.equal(await page.evaluate(() => window.__liuliTimGroupingCompatibility.areas), 2);
    assert.equal(await page.evaluate(() => window.configWrites), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__liuliSettingsCache)), compatibilityBaseline);
    await page.evaluate(() => window.__liuliTimGroupingCompatibility.dispose({ restoreSingle: true }));
    assert(await page.evaluate(() => !window.__liuliTimGroupingCompatibility && [...document.querySelectorAll('.message-container')].every(row => row.dataset.liuliG === 'single')));
    report.compatibility = { initializedWithoutConfigWrites: true, scrollStylePasses: 0, ownsOnlyGroupAttributes: true,
      oldClosureSingleWritesCorrected: true, ownWriteLoop: false, newAreaDiscovery: true, otherModesUntouched: true,
      reinjectionAndDispose: true };
    report.checks.push('Dev-only running-window adapter preserves config, skips scroll geometry, corrects old single writes once, discovers area replacements and disposes cleanly.');
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, error: report.error }));
  }
})();
