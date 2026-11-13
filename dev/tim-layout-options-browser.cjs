'use strict';
// Production helpers/CSS exercised against captured QQ grid/voice/file layout.
// Isolated Chromium only: no live QQ, settings synchronization or deployment.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/tim-layout-options-20261113'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const before = fs.readFileSync(process.argv[5] || path.join(output, 'index.js.before'), 'utf8');
function helper(name, text = source) {
  const start = text.indexOf('  function ' + name + '('), end = text.indexOf('\n  }', start);
  assert(start >= 0 && end > start, 'Missing ' + name);
  return text.slice(start, end + 4);
}
const cssFiles = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = cssFiles.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => read('assets/' + name)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css') + '\n' + read('dev/fixtures/qq-native-file.css');
const defaultsStart = source.indexOf('  const DEFAULT_SETTINGS ='), defaultsEnd = source.indexOf('\n  };', defaultsStart);
const productionHelpers = ['elementsWithin', 'isImageOnlyContent', 'isVideoOnlyContent', 'moveSenderIntoBubble', 'groupMessages', 'stickAvatars'].map(name => helper(name)).join('\n');
const setup = `body{margin:0!important;padding:18px!important;background:#cec3aa!important;font:14px 'Microsoft YaHei UI',sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#f2e8dc;--ll-on-glass-2:#dfd0b9;--ll-brand:#eec252;--ll-brand-rgb:238,194,82;--ll-bubble-self:#f0c043;--ll-bubble-self-fg:#3e2e00;--ll-primary-container:#644b12;--ll-on-primary-container:#ffe2a0;--ll-secondary-container:#4b5a42;--ll-on-secondary-container:#e1efd4;--ll-tertiary-container:#715344;--ll-on-tertiary-container:#ffdbca;--ll-surface-high:#4c4b3e;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-shadow-rgb:0,0,0}.chat-msg-area{width:720px;max-width:100%}.avatar-native{width:32px;height:32px;background:#969b8b;border:1px solid #695b3e;border-radius:50%;box-sizing:border-box}.pic-element{width:90px;height:55px;background:#9c8d70}.text-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.q-tag{display:inline-flex;align-items:center}.q-tag--blue{background:#477daa;color:#eef6ff}.user-label{background:#886b3c}.sample-heading{padding:16px 20px 6px;color:#3d3424;font-size:13px}.message-content{min-width:0}.chat-msg-area__vlist{height:170px;overflow:auto}#liuli-settings-dialog{max-width:720px;background:#2c322b;padding:16px;color:#f2e8dc}`;
function row(id, kind = 'text', direction = 'others', sender = direction, time = 1000, extra = '') {
  let body = `<div class="message-content mix-message__inner"><span class="text-element"><span class="text-normal">${id.includes('long') ? 'Long message '.repeat(17) : 'Hello message'}</span></span></div>`;
  if (kind === 'image') body = '<div class="message-content mix-message__inner"><div class="image pic-element" style="width:90px;height:55px"><img alt="" width="90" height="55"></div></div>';
  if (kind === 'video') body = '<div class="message-content mix-message__inner"><div class="video-element" style="width:100px;height:60px;background:#806d55"><video width="100" height="60"></video></div></div>';
  if (kind === 'voice') body = read('dev/fixtures/qq-native-voice.html').match(/<div class="ptt-message__inner">([\s\S]*?)<\/div><sub/)[0].replace(/<\/div><sub$/, '');
  const bubble = kind === 'file' ? '<div class="file-message--content" data-v-0358c09e><div class="normal-file file-element" data-v-0645b5d3><div class="file-header" data-v-0645b5d3><span class="file-name" data-v-0645b5d3>report.pdf</span><span class="file-icon" data-v-0645b5d3></span></div><div class="file-info" data-v-0645b5d3>18 KB</div></div></div>'
    : `<div class="msg-content-container container--${direction} ${kind === 'voice' ? 'ptt-message__container ptt-message' : 'mix-message__container'}">${body}</div>`;
  const stamp = extra.includes('data-stamp="1"') ? '<div class="message__timestamp"><span class="babble">20:04</span></div>' : '';
  return `<div class="ml-item" id="row-${id}" data-sample="${id}"><div class="message">${stamp}<div class="message-native"><div class="message-container ${kind === 'file' ? 'file-message' : 'message-container--mix-or-markdown'} ${direction === 'self' ? 'message-container--self message-container--align-right' : 'message-container--others'}" data-v-0358c09e data-direction="${direction}" data-sender="${sender}" data-time="${time}" ${extra}><span class="avatar-span" aria-label="${sender}"><div class="avatar-native"></div></span><div class="user-name"><span class="group-member-label q-tag q-tag--blue"><span>管理员</span></span><span class="text-ellipsis">${direction === 'self' ? 'Me' : 'Native sender'}</span><span class="user-label">群头衔</span></div><div class="message-content__wrapper">${bubble}</div><div class="content-status"></div></div></div></div></div>`;
}
const chain = ['text', 'text', 'voice', 'image', 'file', 'text', 'text'];
const sampleMarkup = ['others', 'self'].map(direction => `<div class="sample-heading">${direction}</div>${chain.map((kind, i) => row(direction + '-' + i, kind, direction, direction, 1000 + i)).join('')}${row(direction + '-file-single', 'file', direction, direction + '-file', 1008)}${row(direction + '-video-single', 'video', direction, direction + '-video', 1009)}`).join('');
const timeRow = (visible = false, extra = '') => `<div class="ml-item"><div class="message"><div class="message__timestamp"${visible ? ' style="display:block!important"' : ''}><span class="babble">20:04</span></div>${extra}</div></div>`;
const boundaries = [
  row('gap-a', 'text', 'others', 'gap', 1000), row('gap-b', 'text', 'others', 'gap', 2316, 'data-stamp="1"'),
  row('reverse-a', 'text', 'others', 'reverse', 1300), row('reverse-b', 'text', 'others', 'reverse', 1299),
  row('stamp-a', 'text', 'others', 'stamp', 1400), row('stamp-b', 'text', 'others', 'stamp', 1401, 'data-stamp="1"'),
  row('hidden-time-a', 'text', 'others', 'hidden-time', 1500), timeRow(), row('hidden-time-b', 'text', 'others', 'hidden-time', 1501),
  row('visible-time-a', 'text', 'others', 'visible-time', 1600), timeRow(true), row('visible-time-b', 'text', 'others', 'visible-time', 1601),
  row('divider-a', 'text', 'others', 'divider', 1700), '<div class="ml-item system-row">Native system divider</div>', row('divider-b', 'text', 'others', 'divider', 1701),
  row('hidden-system-a', 'text', 'others', 'hidden-system', 1800), '<div class="ml-item system-row" style="display:none">Native revoke/system divider</div>', row('hidden-system-b', 'text', 'others', 'hidden-system', 1801),
  row('mixed-time-a', 'text', 'others', 'mixed-time', 1900), timeRow(false, '<div class="system-row" style="display:none">recalled</div>'), row('mixed-time-b', 'text', 'others', 'mixed-time', 1901),
  row('placeholder-a', 'text', 'others', 'placeholder', 2000), '<div class="ml-item" style="height:0"></div>', row('placeholder-b', 'text', 'others', 'placeholder', 2001),
  row('peer-a', 'text', 'others', 'peer', 2100, 'data-peer="one"'), row('peer-b', 'text', 'others', 'peer', 2101, 'data-peer="two"')
].join('');
function assertTimeGroups(values, mode) {
  const byId = Object.fromEntries(values.map(value => [value.id, value]));
  for (const prefix of ['gap', 'stamp', 'hidden-time', 'reverse', 'visible-time', 'divider', 'hidden-system', 'mixed-time', 'placeholder', 'peer']) {
    const expected = ['gap', 'stamp', 'hidden-time'].includes(prefix) ? ['first', 'last'] : ['single', 'single'];
    for (const [index, letter] of ['a', 'b'].entries()) {
      const sample = byId[prefix + '-' + letter];
      assert.equal(sample.group, expected[index], mode + '/' + prefix + ' text adjacency');
      if (mode === 'tim') assert.equal(sample.avatarGroup, expected[index], mode + '/' + prefix + ' avatar adjacency');
    }
  }
}
const shell = markup => `<!doctype html><style>${native}\n${css}\n${setup}</style><body window-name="MainWindow" data-liuli-scope="main" data-liuli-chat-style="tim" data-liuli-avatar-position="bottom" data-liuli-tim-sender-position="outside">${markup}</body>`;
function layoutRuntime() {
  return `(()=>{let llModeCfg={chatStyle:'tim',avatarPosition:'bottom',timSenderPosition:'outside'};${productionHelpers}
  window.LiuliQQ={messageRecord:mc=>({chatType:2,peerUid:mc.dataset.peer||'test',senderUid:mc.dataset.sender,msgTime:Number(mc.dataset.time),showTimestamp:mc.dataset.stamp==='1'})};
  window.nativeNames=new Map();window.nativeHomes=new Map();window.nativeClicks=0;window.nativeVoiceClicks=0;
  for(const mc of document.querySelectorAll('.message-container')){const name=mc.querySelector('.user-name');window.nativeNames.set(mc,name);window.nativeHomes.set(name,{parent:name.parentNode,next:name.nextSibling});name.addEventListener('click',()=>window.nativeClicks++);const ptt=mc.querySelector('.ptt-element');ptt?.addEventListener('click',()=>window.nativeVoiceClicks++);}
  window.relayout=cfg=>{Object.assign(llModeCfg,cfg);for(const [key,value]of Object.entries({liuliChatStyle:llModeCfg.chatStyle,liuliAvatarPosition:llModeCfg.avatarPosition,liuliTimSenderPosition:llModeCfg.timSenderPosition}))document.body.dataset[key]=value;moveSenderIntoBubble(document);groupMessages();stickAvatars();};
  window.relayout({});})();`;
}
const measure = () => [...document.querySelectorAll('[data-sample]')].map(sample => {
  const mc = sample.querySelector('.message-container'), name = mc.querySelector('.user-name'), bubble = mc.querySelector('.msg-content-container'), av = mc.querySelector('.avatar-span');
  const style = node => getComputedStyle(node), rect = node => node?.getBoundingClientRect().toJSON();
  return { id: sample.dataset.sample, group: mc.dataset.liuliG, avatarGroup: mc.dataset.liuliAvatarG, timText: mc.hasAttribute('data-liuli-tim-text'), nameParent: name.parentElement.className, nameDisplay: style(name).display, nameRect: rect(name), bubbleRect: rect(bubble), contentRect: rect(bubble?.querySelector('.message-content') || mc.querySelector('.file-message--content') || mc.querySelector('.ptt-element')), avatarDisplay: style(av).display, avatarRect: rect(av), avatarTy: av.dataset.liuliTy, nameIdentity: window.nativeNames?.get(mc) === name, nameBackground: style(name).backgroundColor, titleDisplay: style(mc.querySelector('.user-label')).display, identityDisplay: style(mc.querySelector('.group-member-label')).display, videoOnly: mc.hasAttribute('data-liuli-video-only') };
});
async function productionChecks(browser, report) {
  const page = await browser.newPage({ viewport: { width: 780, height: 1080 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(shell('<div class="chat-msg-area">' + sampleMarkup + boundaries + '</div>'));
  await page.addScriptTag({ content: layoutRuntime() });
  report.variants = [];
  for (const avatarPosition of ['top', 'bottom']) for (const timSenderPosition of ['outside', 'inside']) {
    await page.evaluate(cfg => window.relayout(cfg), { chatStyle: 'tim', avatarPosition, timSenderPosition });
    const values = await page.evaluate(measure); report.variants.push({ avatarPosition, timSenderPosition, values });
    const byId = Object.fromEntries(values.map(value => [value.id, value]));
    for (const direction of ['others', 'self']) {
      assert.deepEqual(chain.map((_, i) => byId[direction + '-' + i].avatarGroup), ['first', 'mid', 'mid', 'mid', 'mid', 'mid', 'last']);
      assert.deepEqual(chain.map((_, i) => byId[direction + '-' + i].group), ['first', 'last', 'single', 'single', 'single', 'first', 'last']);
      assert.deepEqual(chain.map((_, i) => byId[direction + '-' + i].avatarDisplay !== 'none'), avatarPosition === 'top' ? [true, false, false, false, false, false, false] : [false, false, false, false, false, false, true]);
      for (let i = 0; i < chain.length; i++) {
        const sample = byId[direction + '-' + i];
        assert(sample.nameIdentity, sample.id + ' replaced native name');
        assert.equal(sample.nameParent.includes('msg-content-container'), timSenderPosition === 'inside' && chain[i] !== 'file', sample.id + ' name placement');
        if (i > 0) assert.equal(sample.nameDisplay, 'none', sample.id + ' duplicated grouped sender');
      }
      assert(byId[direction + '-file-single'].nameParent.includes('message-container'), 'Native files must keep their name outside');
      assert.notEqual(byId[direction + '-file-single'].avatarDisplay, 'none');
      assert.equal(byId[direction + '-video-single'].nameDisplay, 'none', 'Pure video exposes sender metadata');
    }
    if (timSenderPosition === 'inside') {
      const first = byId['others-0'];
      assert.notEqual(first.nameDisplay, 'none');
      assert.equal(first.nameBackground, 'rgba(0, 0, 0, 0)');
      assert(first.nameRect.top >= first.bubbleRect.top - .1, 'Inside sender escapes bubble top');
      assert(first.nameRect.bottom <= first.contentRect.top + .2, 'Inside sender overlaps body');
    }
    assertTimeGroups(values, 'tim');
    await page.screenshot({ path: path.join(output, `tim-${avatarPosition}-${timSenderPosition}.png`), fullPage: true });
  }
  report.checks.push('All four top/bottom and inside/outside combinations retain native grid, independent cross-media avatar groups, text-only corner groups, file fallback and hidden pure-video metadata.');
  await page.evaluate(() => window.relayout({ chatStyle: 'tg' }));
  assertTimeGroups(await page.evaluate(measure), 'tg');
  await page.evaluate(() => window.relayout({ chatStyle: 'tim' }));
  report.checks.push('TG and TIM retain consecutive same-sender groups across hidden embedded timestamps, hidden pure native timestamp rows and long forward time gaps; reversed time, visible timestamps, system/revoke rows (even hidden), mixed rows, virtual placeholders and peer boundaries still break groups.');
  await page.evaluate(() => { document.body.setAttribute('data-liuli-hide-message-titles', ''); document.body.setAttribute('data-liuli-hide-message-identity', ''); });
  let hidden = await page.evaluate(measure);
  assert(hidden.every(sample => sample.titleDisplay === 'none' && sample.identityDisplay === 'none'));
  await page.evaluate(() => { document.body.removeAttribute('data-liuli-hide-message-titles'); document.body.removeAttribute('data-liuli-hide-message-identity'); });
  await page.locator('[data-sample="others-0"] .user-name').dispatchEvent('click');
  await page.locator('[data-sample="others-2"] .ptt-element').dispatchEvent('click');
  assert.equal(await page.evaluate(() => window.nativeClicks), 1);
  assert.equal(await page.evaluate(() => window.nativeVoiceClicks), 1);
  await page.evaluate(() => {
    window.relayout({ chatStyle: 'tim', timSenderPosition: 'inside' });
    document.body.setAttribute('data-liuli-full-message-names', '');
    const nickname = document.querySelector('[data-sample="others-0"] .user-name > .text-ellipsis');
    window.savedNickname = nickname.textContent;
    nickname.textContent = '一个很长的完整群聊昵称用于验证关闭名称截断后的换行和布局边界';
  });
  const completeName = (await page.evaluate(measure)).find(sample => sample.id === 'others-0');
  assert(completeName.nameRect.left >= completeName.bubbleRect.left - .2 && completeName.nameRect.right <= completeName.bubbleRect.right + .2, 'Full TIM name escapes bubble width');
  assert(completeName.nameRect.bottom <= completeName.contentRect.top + .2, 'Full TIM name overlaps body');
  await page.evaluate(() => { document.body.removeAttribute('data-liuli-full-message-names'); document.querySelector('[data-sample="others-0"] .user-name > .text-ellipsis').textContent = window.savedNickname; });
  report.checks.push('Disabling name truncation wraps a long native nickname inside the TIM bubble without escaping its width or overlapping the body.');
  for (const mode of ['classic', 'tg', 'tim', 'classic']) {
    await page.evaluate(chatStyle => window.relayout({ chatStyle, timSenderPosition: 'inside' }), mode);
    const samples = await page.evaluate(measure);
    assert(samples.every(sample => sample.nameIdentity));
    assert(samples.every(sample => (sample.avatarGroup !== undefined) === (mode === 'tim')));
    if (mode === 'classic') {
      assert(samples.every(sample => sample.group === 'single'));
      assert(await page.evaluate(() => [...window.nativeHomes].every(([name, home]) => name.parentNode === home.parent && name.nextSibling === home.next)), 'Classic failed to restore original native sibling order');
    }
  }
  report.checks.push('Native sender/voice listeners survive placement changes; independent hide options apply; TIM→classic/TG removes TIM markers and classic restores the original sibling order.');
  await page.setContent(shell('<div class="chat-msg-area__vlist"><div class="chat-msg-area">' + [row('stick-first-long', 'text', 'others', 'stick', 1000), ...Array.from({ length: 5 }, (_, i) => row('stick-mid-' + i + '-long', 'text', 'others', 'stick', 1001 + i)), row('stick-last-long', 'text', 'others', 'stick', 1007)].join('') + '</div></div>'));
  await page.addScriptTag({ content: layoutRuntime() });
  await page.evaluate(() => window.relayout({ avatarPosition: 'bottom', timSenderPosition: 'inside' }));
  const stuck = (await page.evaluate(measure)).at(-1);
  assert(Number(stuck.avatarTy) < 0, 'Bottom avatar was not clamped to viewport');
  const vp = await page.locator('.chat-msg-area__vlist').boundingBox();
  assert(stuck.avatarRect.bottom <= vp.y + vp.height + .2, 'Bottom avatar escaped viewport');
  await page.evaluate(() => window.relayout({ avatarPosition: 'top' }));
  assert((await page.evaluate(measure)).every(sample => sample.avatarTy === undefined));
  report.checks.push('Bottom TIM avatar sticks inside the viewport across a long native group, and switching to top removes every old transform.');
  assert.deepEqual(errors, []); await page.close();
}
async function settingsChecks(browser, report) {
  const page = await browser.newPage();
  await page.route('http://liuli.test/**', route => route.fulfill({ contentType: 'text/html', body: shell('<div id="liuli-settings-dialog"></div>') }));
  await page.goto('http://liuli.test/');
  await page.addScriptTag({ content: `(()=>{const DEFAULT_SOURCE='#1d9bf0',LL_STORAGE_KEY='liuli-dsh-settings';${helper('llNormalizeColorSeed')}${source.slice(defaultsStart, defaultsEnd + 5)}${helper('llNormalizeSettings')}
  let llModeCfg=llNormalizeSettings({chatStyle:'tim'}),llSettingsApplied=false,llSuppressBroadcast=false;const llPanelSettings=new Set(),FIELDS=[];
  const syncSelectionContrast=()=>{},llApplyModeSettings=()=>{},syncBubbleWidth=()=>{},moveSenderIntoBubble=()=>{},groupMessages=()=>{},scheduleStick=()=>{},llApplyPinGroups=()=>{},llSyncColorSourceControls=()=>{},applyDynamicPalette=async()=>{};
  ${helper('llSyncSettingDependencies')}${helper('applySettings')}${helper('llBuildSwitchRow')}${helper('buildPinGroupSection')}
  window.writes=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){window.writes.push(args);return original.apply(this,args);};
  window.settings=llModeCfg;llPanelSettings.add(window.settings);buildPinGroupSection(document.querySelector('#liuli-settings-dialog'),window.settings);llSyncSettingDependencies();window.normalize=llNormalizeSettings;})();` });
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  assert.equal(await page.evaluate(() => window.normalize({}).timSenderPosition), 'outside');
  assert.equal(await page.locator('[data-liuli-setting="timSenderPosition"] .is-active').getAttribute('data-setting-value'), 'outside');
  const choose = (key, value) => page.locator(`[data-liuli-setting="${key}"] [data-setting-value="${value}"]`).click();
  await choose('timSenderPosition', 'inside'); await choose('avatarPosition', 'top');
  let cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('liuli-dsh-settings')));
  assert.equal(cfg.timSenderPosition, 'inside'); assert.equal(cfg.avatarPosition, 'top');
  await choose('chatStyle', 'classic');
  assert(await page.locator('[data-liuli-setting="avatarPosition"] button').first().isDisabled());
  assert(await page.locator('[data-liuli-setting="timSenderPosition"] button').first().isDisabled());
  await choose('chatStyle', 'tg');
  assert(await page.locator('[data-liuli-setting="avatarPosition"] button').first().isEnabled());
  assert(await page.locator('[data-liuli-setting="timSenderPosition"] button').first().isDisabled());
  await choose('chatStyle', 'tim');
  assert(await page.locator('[data-liuli-setting="timSenderPosition"] button').first().isEnabled());
  cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('liuli-dsh-settings')));
  assert.equal(cfg.timSenderPosition, 'inside'); assert.equal(cfg.avatarPosition, 'top');
  report.checks.push('Production settings initialize without saving, default TIM names outside, save placement independently from avatar choice, and retain both choices while correctly disabling classic/TG dependencies.');
  await page.close();
}
async function compatibilityChecks(browser, report) {
  const page = await browser.newPage({ viewport: { width: 780, height: 800 } });
  await page.route('http://liuli.test/**', route => route.fulfill({ contentType: 'text/html', body: shell('<div class="chat-msg-area__vlist"><div class="chat-msg-area">' + sampleMarkup + '</div></div><div id="liuli-settings-dialog"><div data-liuli-setting="avatarPosition"><span>头像位置（TG）</span><button data-setting-value="top">开头</button><button data-setting-value="bottom">末尾</button></div></div>') }));
  await page.goto('http://liuli.test/');
  const oldHelpers = ['elementsWithin', 'topLevelRoots', 'isImageOnlyContent', 'isVideoOnlyContent', 'moveSenderIntoBubble', 'groupMessages', 'stickAvatars', 'scheduleStick', 'liuliMessagePass', 'installPageObserver'].map(name => helper(name, before)).join('\n');
  await page.addScriptTag({ content: `(()=>{let llModeCfg={chatStyle:'tim',avatarPosition:'bottom',customColor:'#4bf11e',unrelated:23};let liuliStickRaf=0;${oldHelpers}
  window.LiuliQQ={messageRecord:mc=>({chatType:2,peerUid:'test',senderUid:mc.dataset.sender,msgTime:Number(mc.dataset.time)})};window.__liuliSettingsCache=llModeCfg;localStorage.setItem('liuli-dsh-settings',JSON.stringify(llModeCfg));window.initialConfig=localStorage.getItem('liuli-dsh-settings');
  window.writes=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){window.writes.push(args);return original.apply(this,args);};window.nativeName=document.querySelector('[data-sample="others-0"] .user-name');window.nativeClicks=0;window.nativeName.addEventListener('click',()=>window.nativeClicks++);window.oldPasses=0;
  const ownRow=document.querySelector('[data-sample="self-0"] .message-container'),nativeAppend=ownRow.appendChild;window.originalRowAppend=function(...args){return nativeAppend.apply(this,args);};Object.defineProperty(ownRow,'appendChild',{configurable:true,writable:true,value:window.originalRowAppend});
  let refreshInputGeometry=()=>{};const llMsgSeen={chat:null,max:null};const noop=()=>{};
  const syncBubbleWidth=noop,markQuoteRoots=noop,llMarkdownPass=noop,llAtPass=noop,llMotionPass=noop,llGroupMembersPass=noop,llGroupRecentPass=noop,applyOverrides=noop,fixContrast=noop,normalizeColors=noop,ensureHoverEntries=noop,llWatchContactList=noop,llApplyPinGroups=noop,mountSettingsEntry=noop,llLayoutPass=noop,keepWindowControlsVisible=noop,mountInputBar=noop,llHandleAdded=noop,llMembersArrived=noop;
  const oldMessagePass=liuliMessagePass;liuliMessagePass=roots=>{window.oldPasses++;oldMessagePass(roots);};
  function oldPass(){window.oldPasses++;moveSenderIntoBubble(document);groupMessages();scheduleStick();}
  installPageObserver();window.runOld=oldPass;window.disposeOld=()=>{window.__liuliPageObserver.dispose();cancelAnimationFrame(liuliStickRaf);};window.addEventListener('storage',event=>{if(event.key==='liuli-dsh-settings'){llModeCfg=JSON.parse(event.newValue);window.__liuliSettingsCache=llModeCfg;document.body.dataset.liuliChatStyle=llModeCfg.chatStyle;document.body.dataset.liuliAvatarPosition=llModeCfg.avatarPosition;oldPass();}});
  window.setCfg=delta=>{const next={...JSON.parse(localStorage.getItem('liuli-dsh-settings')),...delta};const value=JSON.stringify(next);localStorage.setItem('liuli-dsh-settings',value);window.dispatchEvent(new StorageEvent('storage',{key:'liuli-dsh-settings',newValue:value,storageArea:localStorage}));};})();` });
  const adapter = require('./patch-tim-layout-live.cjs')();
  await page.addScriptTag({ content: adapter });
  await page.waitForTimeout(160);
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('liuli-dsh-settings')), await page.evaluate(() => window.initialConfig));
  assert.equal(await page.locator('[data-liuli-setting="timSenderPosition"]').count(), 1);
  await page.locator('[data-liuli-setting="timSenderPosition"] [data-setting-value="inside"]').click();
  await page.waitForTimeout(180);
  assert(await page.evaluate(() => window.nativeName.parentElement.matches('.msg-content-container')));
  assert.equal(await page.evaluate(() => window.writes.length), 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('liuli-dsh-settings')).unrelated), 23);
  await page.evaluate(() => window.runOld());
  await page.waitForTimeout(140);
  const settled = await page.evaluate(() => ({ oldPasses: window.oldPasses, passes: window.__liuliTimLayoutCompatibility.passes, blocked: window.__liuliTimLayoutCompatibility.blocked, ty: document.querySelector('[data-sample="others-6"] .avatar-span').dataset.liuliTy }));
  assert(settled.blocked > 0, 'Old move helper bypassed the per-row guard');
  assert(Number(settled.ty) < 0, 'Old TIM stick reset was not repaired');
  await page.waitForTimeout(160);
  assert.deepEqual(await page.evaluate(() => ({ oldPasses: window.oldPasses, passes: window.__liuliTimLayoutCompatibility.passes, blocked: window.__liuliTimLayoutCompatibility.blocked, ty: document.querySelector('[data-sample="others-6"] .avatar-span').dataset.liuliTy })), settled, 'Old/new observers continue looping after settling');
  assert(await page.evaluate(() => document.querySelector('[data-sample="others-0"] .message-container').dataset.liuliAvatarG === 'first'));
  // Genuine native DOM work must pass through even with the same target/name.
  assert(await page.evaluate(() => { const row=window.nativeName.closest('.message-container');row.appendChild(window.nativeName);return window.nativeName.parentElement===row; }));
  await page.waitForTimeout(120);
  assert(await page.evaluate(() => window.nativeName.parentElement.matches('.msg-content-container')));
  await page.locator('[data-sample="others-0"] .user-name').dispatchEvent('click');
  assert.equal(await page.evaluate(() => window.nativeClicks), 1);
  await page.evaluate(() => { document.querySelector('.chat-msg-area').style.transform='translateY(1px)'; });
  const beforeScroll = await page.evaluate(() => window.__liuliTimLayoutCompatibility.passes);
  await page.waitForTimeout(90);
  assert.equal(await page.evaluate(() => window.__liuliTimLayoutCompatibility.passes), beforeScroll, 'Virtual area geometry caused regrouping');
  await page.evaluate(() => { const panel=document.createElement('div');panel.id='liuli-embedded';panel.innerHTML='<div data-liuli-setting="avatarPosition"><span>头像</span><button data-setting-value="top">开头</button><button data-setting-value="bottom">末尾</button></div>';document.body.append(panel); });
  await page.waitForFunction(() => document.querySelectorAll('[data-liuli-setting="timSenderPosition"]').length === 2);
  await page.evaluate(() => window.setCfg({ chatStyle:'classic' })); await page.waitForTimeout(120);
  assert(await page.evaluate(() => window.nativeName.parentElement.matches('.message-container')));
  assert(await page.locator('[data-liuli-setting="avatarPosition"] button').first().isDisabled());
  await page.evaluate(() => window.setCfg({ chatStyle:'tg' })); await page.waitForTimeout(120);
  assert(await page.evaluate(() => window.nativeName.parentElement.matches('.msg-content-container')));
  assert(await page.locator('[data-liuli-setting="avatarPosition"] button').first().isEnabled());
  assert(await page.locator('[data-liuli-setting="timSenderPosition"] button').first().isDisabled());
  await page.evaluate(() => window.setCfg({chatStyle:'tim',avatarPosition:'top'})); await page.waitForTimeout(100);
  assert(await page.evaluate(() => [...document.querySelectorAll('.avatar-span')].every(av=>!av.dataset.liuliTy)));
  await page.addScriptTag({ content: adapter }); await page.waitForTimeout(120);
  assert.equal(await page.locator('[data-liuli-setting="timSenderPosition"]').count(), 2);
  await page.evaluate(() => { const row=document.querySelector('[data-sample="self-0"] .message-container');window.removedRow=row;row.closest('.ml-item').remove(); });
  await page.waitForTimeout(90);
  assert(await page.evaluate(() => window.removedRow.appendChild===window.originalRowAppend&&!Object.hasOwn(window.removedRow,'insertBefore')));
  await page.evaluate(() => { window.disposeOld();window.__liuliTimLayoutCompatibility.dispose(); });
  assert.equal(await page.locator('[data-liuli-setting="timSenderPosition"]').count(), 0);
  assert(await page.evaluate(() => [...document.querySelectorAll('.message-container')].every(row=>!Object.hasOwn(row,'appendChild')&&!Object.hasOwn(row,'insertBefore'))));
  report.compatibility = { settled, noInitialWrites: true, preservesSettingsAndNativeHandlers: true, narrowOwnMethodGuards: true, nativeReparentAllowed: true, oldGroupingAndStickRepair: true, noObserverLoop: true, laterPanels: true, reinstallAndDispose: true };
  report.checks.push('Dev adapter uses production move/group/stick helpers; corrects old closure writes without a settled observer loop, keeps configuration and native handlers, permits native reparenting, ignores virtual geometry, discovers later settings, and restores per-row method descriptors on removal/disposal.');
  await page.close();
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});
  const report={scope:'Production TIM layout with captured native QQ CSS, isolated settings and old-closure compatibility; no live QQ operations',checks:[]};
  try{await productionChecks(browser,report);await settingsChecks(browser,report);await compatibilityChecks(browser,report);report.passed=true;}
  catch(error){report.error=error.stack;process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,passed:report.passed,error:report.error}));}
})();
