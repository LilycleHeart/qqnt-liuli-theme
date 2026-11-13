'use strict';
// Captured QQ grid/voice DOM plus production grouping and CSS. Isolated browser
// only: this runner never attaches to QQ, changes settings, or deploys files.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwrightPath = process.argv[2] || process.env.LIULI_PLAYWRIGHT_PATH || 'playwright';
const { chromium } = require(playwrightPath);
const executablePath = process.argv[3] || process.env.LIULI_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/message-spacing-20261114'));
const beforePath = path.resolve(process.argv[5] || path.join(output, 'before/bubbles.css'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('renderer/index.js');
const native = read('dev/fixtures/qq-native-message-layout.css');
const voiceFixture = read('dev/fixtures/qq-native-voice.html');
const cssFiles = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]).filter(file => fs.existsSync(path.join(root, 'assets', file)));
function combinedCss(baseline) {
  return cssFiles.map(file => baseline && file === 'bubbles.css' ? fs.readFileSync(beforePath, 'utf8') : read('assets/' + file)).join('\n');
}
function helper(name) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  }', start);
  assert(start >= 0 && end > start, 'Missing production helper: ' + name);
  return source.slice(start, end + 4);
}
const helpers = ['elementsWithin', 'isImageOnlyContent', 'isVideoOnlyContent', 'moveSenderIntoBubble', 'groupMessages', 'stickAvatars'].map(helper).join('\n');
const setup = `body{margin:0!important;padding:16px!important;background:#cec3aa!important;font:14px 'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#f2e8dc;--ll-on-glass-2:#dfd0b9;--ll-brand:#eec252;--ll-brand-rgb:238,194,82;--ll-bubble-self:#f0c043;--ll-bubble-self-fg:#3e2e00;--ll-primary-container:#644b12;--ll-on-primary-container:#ffe2a0;--ll-secondary-container:#4b5a42;--ll-on-secondary-container:#e1efd4;--ll-tertiary-container:#715344;--ll-on-tertiary-container:#ffdbca;--ll-surface-high:#4c4b3e;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-shadow-rgb:0,0,0}.chat-msg-area{width:720px;max-width:100%}.text-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.message-content{min-width:0}.avatar-native,.message-container__avatar{background:#969b8b;border-radius:50%;width:32px;height:32px}.pic-element{width:90px;height:55px;background:#9c8d70}.q-tag{display:inline-flex;align-items:center}`;
// This outer-shell rule was separately captured from QQ on 2026-11-14. The
// older native-layout fixture captures mc rules, but omits its message parent.
const nativeShell = '.ml-item .message{padding-bottom:8px}';
const samples = [
  ['text-0', 'text'], ['text-1', 'text'], ['voice-0', 'voice'], ['voice-1', 'voice'],
  ['image-0', 'image'], ['voice-2', 'voice'], ['translated', 'voice'], ['voice-3', 'voice'],
  ['text-2', 'text'], ['text-3', 'text'], ['boundary', 'text', 'other-sender']
].map(([id, kind, sender = 'sender']) => ({ id, kind, sender }));
function shell(baseline) {
  return `<!doctype html><meta charset="utf-8"><style>${native}\n${nativeShell}\n${combinedCss(baseline)}\n${setup}</style><body window-name="MainWindow" data-liuli-scope="main" data-liuli-chat-style="tim" data-liuli-avatar-position="bottom" data-liuli-tim-sender-position="outside"><div class="chat-msg-area"></div></body>`;
}
function runtime() {
  return `(()=>{let llModeCfg={chatStyle:'tim',avatarPosition:'bottom',timSenderPosition:'outside'};${helpers}
  window.LiuliQQ={messageRecord:mc=>({msgId:mc.dataset.sample,chatType:2,peerUid:'spacing-test',senderUid:mc.dataset.sender,msgTime:Number(mc.dataset.time)})};
  window.relayout=cfg=>{Object.assign(llModeCfg,cfg);document.body.dataset.liuliChatStyle=llModeCfg.chatStyle;document.body.dataset.liuliAvatarPosition=llModeCfg.avatarPosition;document.body.dataset.liuliTimSenderPosition=llModeCfg.timSenderPosition;document.body.style.setProperty('--ll-bubble-scale',String(llModeCfg.scale/100));document.body.toggleAttribute('data-liuli-scaled-bubbles',llModeCfg.scale!==100);moveSenderIntoBubble(document);groupMessages();stickAvatars();};})();`;
}
async function populate(page) {
  await page.evaluate(({ voiceFixture, samples }) => {
    const area = document.querySelector('.chat-msg-area');
    samples.forEach(({ id, kind, sender }, index) => {
      const item = document.createElement('div'); item.className = 'ml-item'; item.dataset.sample = id;
      const message = document.createElement('div'); message.className = 'message'; item.append(message);
      let mc;
      if (kind === 'voice') {
        const template = document.createElement('template'); template.innerHTML = voiceFixture;
        mc = template.content.firstElementChild;
        mc.removeAttribute('data-liuli-g'); mc.querySelector('.avatar-span').removeAttribute('data-liuli-ty');
        mc.querySelector('.ptt-element__duration span').textContent = '3″';
        message.append(mc); // Actual QQ voice bypasses message-native.
      } else {
        const messageNative = document.createElement('div'); messageNative.className = 'message-native'; message.append(messageNative);
        mc = document.createElement('div'); mc.className = 'message-container message-container--mix-or-markdown message-container--others';
        const content = kind === 'image' ? '<div class="image pic-element"><img alt="" width="90" height="55"></div>' : '<span class="text-element"><span class="text-normal">Short message</span></span>';
        mc.innerHTML = '<span class="avatar-span"><div class="avatar-native"></div></span><div class="message-extra-top"></div><div class="message-content__wrapper"><div class="msg-content-container container--others mix-message__container"><div class="message-content mix-message__inner">' + content + '</div></div></div><div class="message-tips"></div>';
        messageNative.append(mc);
      }
      const name = document.createElement('div'); name.className = 'user-name';
      name.innerHTML = '<span class="group-member-label q-tag">管理员</span><span class="text-ellipsis">Native sender</span><span class="user-label">群头衔</span>';
      mc.insertBefore(name, mc.querySelector('.message-content__wrapper'));
      mc.dataset.sample = id; mc.dataset.sender = sender; mc.dataset.time = String(1000 + index);
      mc.querySelector('.avatar-span').setAttribute('aria-label', sender);
      area.append(item);
    });
  }, { voiceFixture, samples });
  await page.addScriptTag({ content: runtime() });
}
const measure = () => [...document.querySelectorAll('.ml-item')].map(item => {
  const mc = item.querySelector('.message-container'), wrapper = mc.querySelector('.message-content__wrapper');
  const bubble = mc.querySelector('.msg-content-container'), avatar = mc.querySelector('.avatar-span');
  const name = mc.querySelector('.user-name'), extra = mc.querySelector('.message-extra-top');
  const rect = node => node.getBoundingClientRect().toJSON();
  const cs = getComputedStyle(mc), bs = getComputedStyle(bubble);
  return { id: item.dataset.sample, item: rect(item), row: rect(mc), bubble: rect(bubble), wrapper: rect(wrapper), avatar: rect(avatar), avatarChild: rect(avatar.firstElementChild), avatarVisible: getComputedStyle(avatar).display !== 'none', nameVisible: getComputedStyle(name).display !== 'none', group: mc.dataset.liuliG, avatarGroup: mc.dataset.liuliAvatarG, timText: mc.hasAttribute('data-liuli-tim-text'), rowPadding: [cs.paddingTop, cs.paddingBottom], marginTop: cs.marginTop, wrapperMinHeight: getComputedStyle(wrapper).minHeight, shellPadding: getComputedStyle(item.querySelector('.message')).paddingBottom, extraMargin: getComputedStyle(extra).marginBottom, radius: [bs.borderTopLeftRadius, bs.borderTopRightRadius, bs.borderBottomRightRadius, bs.borderBottomLeftRadius] };
});
const close = (value, expected, label, tolerance = .3) => assert(Math.abs(value - expected) <= tolerance, `${label}: got ${value}, expected ${expected} ± ${tolerance}`);
function assertSpacing(values, cfg) {
  const byId = Object.fromEntries(values.map(value => [value.id, value]));
  const mediaPairs = [['voice-0', 'voice-1'], ['voice-1', 'image-0'], ['image-0', 'voice-2'], ['voice-2', 'translated'], ['translated', 'voice-3']];
  const gaps = mediaPairs.map(([a, b]) => ({ from: a, to: b, gap: byId[b].bubble.top - byId[a].bubble.bottom }));
  for (const gap of gaps) close(gap.gap, 2, `${cfg.chatStyle}/${cfg.scale}/${gap.from}→${gap.to}`);
  for (const value of values) {
    assert.equal(value.shellPadding, '0px', value.id + ' outer padding remains');
    assert.equal(value.extraMargin, '0px', value.id + ' empty extension retains spacing');
    assert.equal(value.wrapperMinHeight, '0px', value.id + ' native 38px wrapper remains');
    assert.deepEqual(value.rowPadding, ['1px', '1px']);
    if (value.avatarVisible) { close(value.avatarChild.width, 32, 'Natural avatar width'); close(value.avatarChild.height, 32, 'Natural avatar height'); }
  }
  if (cfg.chatStyle === 'tim') {
    assert.deepEqual(values.slice(0, -1).map(value => value.group), ['first', 'last', 'single', 'single', 'single', 'single', 'single', 'single', 'first', 'last']);
    assert.deepEqual(values.slice(0, -1).map(value => value.avatarGroup), ['first', ...Array(8).fill('mid'), 'last']);
    assert(values.filter(value => ['voice', 'image', 'translated'].some(prefix => value.id.startsWith(prefix))).every(value => !value.timText), 'Media acquired text corner classification');
  }
  assert.deepEqual(values.slice(0, -1).map(value => value.avatarVisible), cfg.avatarPosition === 'top' ? [true, ...Array(9).fill(false)] : [...Array(9).fill(false), true]);
  close(byId.boundary.row.top - byId['text-3'].row.bottom, 8, 'Sender boundary margin');
  close(byId.boundary.row.top - byId['text-3'].row.bottom + parseFloat(byId['text-3'].rowPadding[1]) + parseFloat(byId.boundary.rowPadding[0]), 10, 'Sender boundary including content padding');
  if (cfg.scale === 80) {
    assert(byId['voice-0'].bubble.height < 38, 'Small voice must fit below former wrapper floor');
    close(byId['voice-0'].row.height, byId['voice-0'].bubble.height + 2, 'Small voice row natural height');
  }
  return gaps;
}
function classicGeometry(values) {
  return values.map(value => ({ id: value.id, row: value.row, bubble: value.bubble, wrapper: value.wrapper, avatar: value.avatar, rowPadding: value.rowPadding, shellPadding: value.shellPadding, extraMargin: value.extraMargin, radius: value.radius }));
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  assert(fs.existsSync(beforePath), 'Supply original bubbles.css as argument 5 for classic geometry comparison: ' + beforePath);
  const browser = await chromium.launch({ headless: true, executablePath });
  const report = { scope: 'Captured QQ CSS/voice DOM, both real message wrappers, production helpers and full theme CSS order; no live QQ operations', beforePath, variants: [], errors: [], pageErrors: [] };
  const pages = await Promise.all([false, true].map(async baseline => {
    const page = await browser.newPage({ viewport: { width: 780, height: 2400 } });
    page.on('pageerror', error => report.pageErrors.push(error.stack));
    await page.setContent(shell(baseline)); await populate(page); return page;
  }));
  try {
    for (const chatStyle of ['tim', 'tg', 'classic']) for (const avatarPosition of (chatStyle === 'classic' ? ['bottom'] : ['top', 'bottom'])) for (const timSenderPosition of (chatStyle === 'tim' ? ['inside', 'outside'] : ['inside'])) for (const scale of [80, 100, 120]) {
      const cfg = { chatStyle, avatarPosition, timSenderPosition, scale };
      for (const page of pages) await page.evaluate(cfg => window.relayout(cfg), cfg);
      const [values, beforeValues] = await Promise.all(pages.map(page => page.evaluate(measure)));
      const variant = { ...cfg, values }; report.variants.push(variant);
      try {
        if (chatStyle === 'classic') assert.deepEqual(classicGeometry(values), classicGeometry(beforeValues), 'Classic geometry changed');
        else {
          variant.gaps = assertSpacing(values, cfg);
          assert.deepEqual(values.map(value => value.radius), beforeValues.map(value => value.radius), 'Text/media corner shapes changed');
          const normal = Object.fromEntries(values.map(value => [value.id, value]));
          await pages[0].evaluate(() => { const bottom = document.querySelector('[data-sample="translated"] .ptt-element__bottom-area'); bottom.style.display = ''; bottom.querySelector('.ptt-element__bottom-area-text').textContent = 'A short transcription.'; });
          const expanded = await pages[0].evaluate(measure);
          const expandedById = Object.fromEntries(expanded.map(value => [value.id, value]));
          assert(expandedById.translated.bubble.height > normal.translated.bubble.height + 10, 'Translation failed to expand naturally');
          close(expandedById['voice-3'].bubble.top - expandedById.translated.bubble.bottom, 2, 'Expanded translation next gap');
          variant.translation = { beforeHeight: normal.translated.bubble.height, afterHeight: expandedById.translated.bubble.height, nextGap: expandedById['voice-3'].bubble.top - expandedById.translated.bubble.bottom };
          await pages[0].evaluate(() => { document.querySelector('[data-sample="translated"] .ptt-element__bottom-area').style.display = 'none'; });
        }
        variant.passed = true;
        if (chatStyle === 'tim' && timSenderPosition === 'outside' && scale === 100) await pages[0].screenshot({ path: path.join(output, `message-spacing-${avatarPosition}.png`), fullPage: true });
      } catch (error) { variant.error = error.stack; report.errors.push({ cfg, error: error.message }); }
    }
    assert.deepEqual(report.pageErrors, [], 'Browser errors');
    report.passed = report.errors.length === 0;
    if (!report.passed) process.exitCode = 1;
  } catch (error) { report.errors.push({ error: error.stack }); report.passed = false; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'message-spacing-browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, passed: report.passed, variants: report.variants.length, passedVariants: report.variants.filter(value => value.passed).length, errors: report.errors }));
  }
})();
