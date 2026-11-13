'use strict';
// Isolated renderer logic only. No Electron, QQ, network or browser is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/index.js'), 'utf8');

function functionSource(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const end = source.indexOf('\n  }', start);
  assert(end > start, 'missing closing brace for ' + name);
  return source.slice(start, end + 4);
}
function declaration(name) {
  const start = source.indexOf('const ' + name + ' =');
  const end = source.indexOf('\n  };', start);
  assert(start >= 0 && end > start);
  return source.slice(start, end + 5);
}
function harness(initial = {}, extract = async () => '#aa3300') {
  const attrs = new Set();
  const styles = new Map();
  const writes = [];
  const derived = [];
  const listeners = new Map();
  const reflows = [];
  const panel = {};
  const context = {
    initial, panel, console, DEFAULT_SOURCE: '#1d9bf0', LL_STORAGE_KEY: 'liuli-dsh-settings',
    document: { body: { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value),
      removeProperty: key => styles.delete(key) }, toggleAttribute: (key, enabled) => enabled ? attrs.add(key) : attrs.delete(key) },
    querySelectorAll: () => [] },
    window: { __liuliPaletteApplied: false, addEventListener: (name, callback) => listeners.set(name, callback),
      LiuliMCU: { argbFromHex: seed => seed, themeFromSourceColor: seed => ({ seed }) } },
    localStorage: { setItem: (key, value) => writes.push({ key, value }) },
    extractSource: extract, llIsDark: () => false, loadRoles: () => ({ accent: 'tertiary' }),
    deriveVars: (_mcu, theme, dark, roles) => {
      derived.push({ seed: theme.seed, dark, accent: roles.accent });
      return { '--ll-brand': theme.seed, '--ll-on-glass': '#112233', '--ll-on-glass-rgb': '17,34,51' };
    },
    roleVars: (_mcu, theme) => ({ '--ll-bubble-self': theme.seed }),
    syncSelectionContrast() {}, llApplyModeSettings() {}, refreshPaletteInfo() {}, syncBubbleWidth() {},
    moveSenderIntoBubble() { reflows.push('sender'); }, groupMessages() { reflows.push('group'); },
    scheduleStick() { reflows.push('stick'); }, llApplyPinGroups() {},
    llSyncSettingDependencies() {}, llSyncColorSourceControls() {}, llRefreshVeilSegs() {}, FIELDS: []
  };
  vm.createContext(context);
  const storageStart = source.indexOf("  try {\n    window.addEventListener('storage', function (e) {\n      if (e.key !== LL_STORAGE_KEY");
  const storageEnd = source.indexOf('\n  let llVeilSegRefreshers', storageStart);
  assert(storageStart >= 0 && storageEnd > storageStart);
  vm.runInContext([
    functionSource('llNormalizeColorSeed'), declaration('DEFAULT_SETTINGS'), functionSource('llNormalizeSettings'),
    'let llModeCfg = llNormalizeSettings(initial); let llSettingsApplied = true; let llSuppressBroadcast = false;',
    'const llPanelSettings = new Set([panel]); let paletteGeneration = 0;',
    functionSource('applyDynamicPalette'), functionSource('applySettings'), source.slice(storageStart, storageEnd),
    'globalThis.api = { normalize: llNormalizeSettings, seed: llNormalizeColorSeed, apply: applySettings, palette: applyDynamicPalette, current: () => llModeCfg };'
  ].join('\n'), context);
  return { api: context.api, context, attrs, styles, writes, derived, listeners, panel, reflows };
}

test('自定义seed只接受六位十六进制，旧配置默认继续壁纸取色和显示现有名称字段', () => {
  const { api } = harness();
  assert.equal(api.seed(' #Ab90F1 '), '#ab90f1');
  for (const value of ['', '#123', '#12345678', '123456', '#GG0000', '#000000; color:red', null, 123456]) {
    assert.equal(api.seed(value), null);
  }
  const old = api.normalize({ chatStyle: 'tim', avatarPosition: 'top' });
  assert.equal(old.colorSource, 'wallpaper');
  assert.equal(old.customColor, '#1d9bf0');
  assert.equal(old.chatStyle, 'tim');
  assert.equal(old.avatarPosition, 'top');
  assert.equal(old.timSenderPosition, 'outside');
  for (const key of ['showMessageTitles', 'showMessageIdentity', 'truncateMessageNames']) assert.equal(old[key], true);
  const invalid = api.normalize({ colorSource: 'unknown', customColor: 'url(secret)' });
  assert.equal(invalid.colorSource, 'wallpaper');
  assert.equal(invalid.customColor, '#1d9bf0');
});

test('TIM sender placement normalizes, broadcasts and reflows independently of avatar placement', () => {
  const h = harness({ chatStyle: 'tim' });
  assert.equal(h.api.normalize({ timSenderPosition: 'unknown' }).timSenderPosition, 'outside');
  assert.equal(h.api.normalize({ timSenderPosition: 'inside' }).timSenderPosition, 'inside');
  h.api.apply({ ...h.api.current(), timSenderPosition: 'inside' }, true);
  assert.equal(h.context.document.body.dataset.liuliTimSenderPosition, 'inside');
  assert.equal(h.context.document.body.dataset.liuliAvatarPosition, 'bottom');
  assert.deepEqual(h.reflows, ['sender', 'group', 'stick']);
  assert.equal(JSON.parse(h.writes.at(-1).value).timSenderPosition, 'inside');
  h.reflows.length = 0;
  h.api.apply({ ...h.api.current(), bubbleScale: 120 }, false);
  assert.deepEqual(h.reflows, []);
  h.api.apply({ ...h.api.current(), timSenderPosition: 'outside' }, false);
  assert.equal(h.context.document.body.dataset.liuliTimSenderPosition, 'outside');
  assert.deepEqual(h.reflows, ['sender', 'group', 'stick']);
});

test('TIM enables both layout controls; TG retains its avatar control; classic disables both without hiding saved choices', () => {
  const rows = new Map(['avatarPosition', 'timSenderPosition', 'pinColor'].map(key => {
    const row = { hidden: true, attrs: {}, disabledClass: false, buttons: [{ disabled: false }, { disabled: false }] };
    row.classList = { toggle: (_name, enabled) => { row.disabledClass = enabled; } };
    row.setAttribute = (name, value) => { row.attrs[name] = value; };
    row.querySelectorAll = () => row.buttons;
    return [key, row];
  }));
  const context = { llModeCfg: { chatStyle: 'tim', pinGroup: true }, document: {
    querySelectorAll: selector => [rows.get(selector.match(/="([^"]+)"/)[1])]
  } };
  vm.createContext(context);
  vm.runInContext(functionSource('llSyncSettingDependencies') + ';globalThis.sync=llSyncSettingDependencies;', context);
  for (const style of ['tim', 'tg', 'classic']) {
    context.llModeCfg.chatStyle = style;
    context.sync();
    for (const key of ['avatarPosition', 'timSenderPosition']) {
      const enabled = key === 'avatarPosition' ? style !== 'classic' : style === 'tim';
      const row = rows.get(key);
      assert.equal(row.hidden, false);
      assert.equal(row.disabledClass, !enabled);
      assert.equal(row.attrs['aria-disabled'], String(!enabled));
      assert(row.buttons.every(button => button.disabled === !enabled));
    }
  }
});

test('自定义颜色沿用MCU和颜色角色派生，不读取壁纸；选色保存规范化seed', async () => {
  let extractions = 0;
  const h = harness({}, async () => { extractions++; return '#aa3300'; });
  h.api.apply({ colorSource: 'custom', customColor: '#AB90F1' }, true);
  await Promise.resolve();
  assert.equal(extractions, 0);
  assert.deepEqual(h.derived, [{ seed: '#ab90f1', dark: false, accent: 'tertiary' }]);
  assert.equal(h.styles.get('--ll-brand'), '#ab90f1');
  assert.equal(h.styles.get('--ll-bubble-self'), '#ab90f1');
  assert.equal(h.context.document.body.dataset.liuliColorSource, 'custom');
  assert.equal(JSON.parse(h.writes.at(-1).value).customColor, '#ab90f1');
});

test('在旧壁纸解码未结束时切换到自定义，旧结果不能覆盖最新seed', async () => {
  let finishWallpaper;
  const h = harness({}, () => new Promise(resolve => { finishWallpaper = resolve; }));
  const old = h.api.palette();
  h.api.apply({ colorSource: 'custom', customColor: '#336699' }, true);
  finishWallpaper('#ff2200');
  await old;
  assert.deepEqual(h.derived.map(item => item.seed), ['#336699']);
  assert.equal(h.context.document.body.dataset.liuliSource, '#336699');
  assert.equal(h.styles.get('--ll-brand'), '#336699');
});

test('跨窗口设置事件更新seed和消息选项，不把收到的配置再次广播', async () => {
  const h = harness();
  h.listeners.get('storage')({ key: 'liuli-dsh-settings', newValue: JSON.stringify({
    colorSource: 'custom', customColor: '#0077AA', showMessageTitles: false, showMessageIdentity: true, truncateMessageNames: false
  }) });
  await Promise.resolve();
  assert.equal(h.styles.get('--ll-brand'), '#0077aa');
  assert.equal(h.panel.customColor, '#0077aa');
  assert.equal(h.writes.length, 0);
  assert(h.attrs.has('data-liuli-hide-message-titles'));
  assert(!h.attrs.has('data-liuli-hide-message-identity'));
  assert(h.attrs.has('data-liuli-full-message-names'));
});

test('三项消息显示开关独立生效；恢复旧默认不留下隐藏/完整名称标记', () => {
  const h = harness();
  const options = [
    ['showMessageTitles', 'data-liuli-hide-message-titles'],
    ['showMessageIdentity', 'data-liuli-hide-message-identity'],
    ['truncateMessageNames', 'data-liuli-full-message-names']
  ];
  for (const [key, attribute] of options) {
    h.api.apply({ [key]: false }, false);
    for (const [, target] of options) assert.equal(h.attrs.has(target), target === attribute);
  }
  h.api.apply({}, false);
  for (const [, target] of options) assert(!h.attrs.has(target));
});

test('bubble spacing scale defaults and clamps independently of font size and maximum width', () => {
  const h = harness();
  assert.equal(h.api.normalize({}).bubbleScale, 100);
  assert.equal(h.api.normalize({ bubbleScale: 10 }).bubbleScale, 80);
  assert.equal(h.api.normalize({ bubbleScale: 200 }).bubbleScale, 140);
  h.api.apply({ bubbleScale: 130, bubbleMaxWidth: 40, messageFontSize: 16, nameFontSize: 12, titleFontSize: 10 }, false);
  assert.equal(h.styles.get('--ll-bubble-scale'), '1.3');
  assert(h.attrs.has('data-liuli-scaled-bubbles'));
  assert.equal(h.styles.get('--ll-message-font-size'), '16px');
  assert.equal(h.styles.get('--ll-name-font-size'), '12px');
  assert.equal(h.styles.get('--ll-title-font-size'), '10px');
  h.api.apply({ ...h.api.current(), bubbleMaxWidth: 100 }, false);
  assert.equal(h.styles.get('--ll-bubble-scale'), '1.3');
  assert.equal(h.styles.get('--ll-message-font-size'), '16px');
  h.api.apply({ ...h.api.current(), bubbleScale: 100 }, false);
  assert(!h.attrs.has('data-liuli-scaled-bubbles'));
});

function mediaHarness() {
  const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, COMMENT_NODE: 8 };
  function element(classes = [], children = [], tagName = 'DIV') {
    const attrs = new Set();
    const classList = new Set(classes);
    classList.contains = name => classList.has(name);
    return { nodeType: 1, tagName, classList, childNodes: children, dataset: {},
      hasAttribute: key => attrs.has(key), removeAttribute: key => attrs.delete(key),
      toggleAttribute: (key, enabled) => enabled ? attrs.add(key) : attrs.delete(key) };
  }
  const context = { Node, elementsWithin: root => root, llModeCfg: { chatStyle: 'tg' } };
  vm.createContext(context);
  vm.runInContext([functionSource('isImageOnlyContent'), functionSource('isVideoOnlyContent'),
    functionSource('moveSenderIntoBubble'), 'globalThis.api = { video: isVideoOnlyContent, image: isImageOnlyContent, move: moveSenderIntoBubble };'].join('\n'), context);
  return { api: context.api, element, text: textContent => ({ nodeType: 3, textContent }) };
}

test('纯视频结构白名单排除正文、引用、未知附件及图片混合，不误认图片', () => {
  const { api, element: el, text } = mediaHarness();
  const video = () => el(['video-element']);
  const content = children => el(['message-content'], children);
  assert.equal(api.video(content([video()])), true);
  assert.equal(api.video(content([text(' '), el(['mix-message__inner'], [video()])])), true);
  for (const extra of [text('caption'), el(['text-element'], [text('caption')]), el(['reply-element']),
    el(['ark-view-message']), el(['file-element']), el(['pic-element']), el(['unknown-attachment'])]) {
    assert.equal(api.video(content([video(), extra])), false);
  }
  assert.equal(api.video(content([])), false);
  assert.equal(api.video(null), false);
  assert.equal(api.image(content([video()])), false);
  assert.equal(api.video(content([el(['pic-element'])])), false);
  const fileVideo = el(['msg-preview', 'msg-preview--video', 'file-element']);
  assert.equal(api.video(content([fileVideo])), true);
  assert.equal(api.video(content([el(['msg-preview', 'file-element'])])), false);
  assert.equal(api.video(content([el(['file-element'])])), false);
});

test('虚拟消息复用为混合或移除气泡时，清除纯视频标记', () => {
  const { api, element: el, text } = mediaHarness();
  let content = el(['message-content'], [el(['video-element'])]);
  const bubble = el();
  bubble.querySelector = selector => selector === '.message-content' ? content : null;
  const row = el();
  let currentBubble = bubble;
  row.querySelector = selector => selector === '.msg-content-container' ? currentBubble : null;
  api.move([row]);
  assert(row.hasAttribute('data-liuli-video-only'));
  assert(bubble.hasAttribute('data-liuli-video-only'));
  content = el(['message-content'], [el(['video-element']), text('caption')]);
  api.move([row]);
  assert(!row.hasAttribute('data-liuli-video-only'));
  assert(!bubble.hasAttribute('data-liuli-video-only'));
  content = el(['message-content'], [el(['video-element'])]);
  api.move([row]);
  currentBubble = null;
  api.move([row]);
  assert(!row.hasAttribute('data-liuli-video-only'));
});

test('QQ独立视频文件结构被识别，普通文件和附加正文不会隐藏昵称', () => {
  const { api, element: el, text } = mediaHarness();
  const file = el(['file-message--content'], [el(['msg-preview', 'msg-preview--video', 'file-element'])]);
  const wrapper = el(['message-content__wrapper'], [file]);
  const row = el(['message-container', 'file-message']);
  let nameQueries = 0;
  row.querySelector = selector => {
    if (selector === '.file-message--content') return file;
    if (selector === ':scope > .message-content__wrapper') return wrapper;
    if (selector === '.user-name') nameQueries++;
    return null;
  };
  api.move([row]);
  assert(row.hasAttribute('data-liuli-video-only'));
  assert(file.hasAttribute('data-liuli-video-only'));
  assert.equal(nameQueries, 0);
  wrapper.childNodes.push(text('caption'));
  api.move([row]);
  assert(!row.hasAttribute('data-liuli-video-only'));
  assert(!file.hasAttribute('data-liuli-video-only'));
  wrapper.childNodes.pop();
  file.childNodes = [el(['msg-preview', 'file-element'])];
  api.move([row]);
  assert(!row.hasAttribute('data-liuli-video-only'));
  assert(!file.hasAttribute('data-liuli-video-only'));
});

test('TIM inside moves the native sender node and restores its original sibling order; standalone files stay untouched', () => {
  const Node = { ELEMENT_NODE: 1, TEXT_NODE: 3, COMMENT_NODE: 8 };
  function element(classes, children = []) {
    const attrs = new Set();
    const node = { nodeType: 1, tagName: 'DIV', classList: new Set(classes), childNodes: [], dataset: {}, parentNode: null };
    node.classList.contains = name => node.classList.has(name);
    Object.defineProperties(node, {
      parentElement: { get: () => node.parentNode },
      firstChild: { get: () => node.childNodes[0] || null },
      nextSibling: { get: () => node.parentNode?.childNodes[node.parentNode.childNodes.indexOf(node) + 1] || null }
    });
    node.contains = target => node === target || node.childNodes.some(child => child.contains?.(target));
    node.insertBefore = (child, next) => {
      if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1);
      const index = next ? node.childNodes.indexOf(next) : node.childNodes.length;
      assert(index >= 0);
      node.childNodes.splice(index, 0, child); child.parentNode = node;
    };
    node.appendChild = child => node.insertBefore(child, null);
    node.querySelector = selector => {
      const direct = selector.startsWith(':scope > ');
      const className = selector.replace(':scope > ', '').slice(1);
      const find = parent => {
        for (const child of parent.childNodes) {
          if (child.classList?.has(className)) return child;
          const nested = !direct && child.childNodes && find(child);
          if (nested) return nested;
        }
        return null;
      };
      return find(node);
    };
    // In a real DOM, assigning dataset creates its corresponding data-* attr.
    // The production helper checks that attr before clearing a recycled marker.
    node.hasAttribute = key => attrs.has(key) || (key.startsWith('data-') &&
      Object.hasOwn(node.dataset, key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())));
    node.toggleAttribute = (key, enabled) => enabled ? attrs.add(key) : attrs.delete(key);
    for (const child of children) node.appendChild(child);
    return node;
  }
  const content = element(['message-content'], [{ nodeType: 3, textContent: 'hello', parentNode: null }]);
  const bubble = element(['msg-content-container'], [content]);
  const wrapper = element(['message-content__wrapper'], [bubble]);
  const avatar = element(['avatar-span']);
  const name = element(['user-name']);
  let clicks = 0;
  name.onClick = () => clicks++;
  const status = element(['content-status']);
  const row = element(['message-container'], [avatar, name, wrapper, status]);
  const fileName = element(['user-name']);
  const file = element(['file-message--content'], [element(['file-element'])]);
  const fileWrapper = element(['message-content__wrapper'], [file]);
  const fileRow = element(['message-container'], [element(['avatar-span']), fileName, fileWrapper]);
  const fileChildren = [...fileRow.childNodes];
  const originalChildren = [...row.childNodes];
  const context = { Node, WeakMap, llModeCfg: { chatStyle: 'tim', timSenderPosition: 'outside' }, elementsWithin: root => root };
  vm.createContext(context);
  vm.runInContext([functionSource('isImageOnlyContent'), functionSource('isVideoOnlyContent'), functionSource('moveSenderIntoBubble'),
    'globalThis.move=moveSenderIntoBubble;'].join('\n'), context);
  context.move([row, fileRow]);
  assert.deepEqual(row.childNodes, originalChildren);
  for (const style of ['tim', 'tg']) {
    context.llModeCfg.chatStyle = style;
    context.llModeCfg.timSenderPosition = 'inside';
    context.move([row, fileRow]);
    assert.equal(bubble.firstChild, name);
    assert.equal(bubble.dataset.liuliNamed, '1');
    context.move([row, fileRow]);
    name.onClick();
    assert.equal(bubble.firstChild, name);
    assert.deepEqual(fileRow.childNodes, fileChildren);
    assert.equal(fileName.parentNode, fileRow);
    context.llModeCfg.chatStyle = style === 'tg' ? 'classic' : 'tim';
    context.llModeCfg.timSenderPosition = 'outside';
    context.move([row, fileRow]);
    assert.deepEqual(row.childNodes, originalChildren);
    assert.equal(name.nextSibling, wrapper);
    assert.equal(bubble.dataset.liuliNamed, undefined);
  }
  assert.equal(clicks, 2, 'Native sender event was replaced or cloned');
});

function groupingHarness(specs) {
  const area = { getBoundingClientRect: () => ({ width: 600, height: 100, top: 0, bottom: 100 }) };
  const rows = specs.map((spec, index) => {
    const attrs = new Set();
    const ml = { nextElementSibling: null };
    const content = {
      querySelectorAll: () => spec.media || spec.empty || spec.unknown || spec.inlineFace ? [] : [{ textContent: 'hello' }],
      querySelector: selector => selector.startsWith('.face-element ') && spec.inlineFace ? {} : null
    };
    const bubble = { querySelector: () => content, matches: () => !!spec.media };
    const row = { dataset: {}, record: spec.sender ? { chatType: 2, peerUid: spec.peer || 'peer', senderUid: spec.sender,
      msgTime: spec.time ?? 1000 + index, showTimestamp: !!spec.showTimestamp } : null,
      closest: selector => selector === '.ml-item' ? ml : area,
      querySelector: selector => selector === '.msg-content-container' ? bubble :
        selector === ':scope > .message-content__wrapper' ? { getBoundingClientRect: () => ({ top: 10 + index * 40, bottom: 80 + index * 40, height: 70 }) } :
          selector === ':scope > .avatar-span' ? row.avatar : null,
      toggleAttribute: (key, enabled) => enabled ? attrs.add(key) : attrs.delete(key),
      hasAttribute: key => key === 'data-liuli-avatar-g' ? row.dataset.liuliAvatarG !== undefined : attrs.has(key),
      removeAttribute: key => key === 'data-liuli-avatar-g' ? delete row.dataset.liuliAvatarG : attrs.delete(key), ml };
    row.avatar = { dataset: {}, style: { transform: '' }, offsetHeight: 32, closest: () => row, getAttribute: () => null };
    return row;
  });
  rows.forEach((row, index) => {
    const next = rows[index + 1]?.ml || null;
    const separator = specs[index].separatorAfter;
    if (!separator) { row.ml.nextElementSibling = next; return; }
    const stamp = { nodeType: 1, style: { display: separator === 'visible-time' ? 'block' : '' } };
    const wrapper = { nodeType: 1, matches: selector => selector === '.message', childNodes: [stamp] };
    const hiddenSystem = { nodeType: 1, matches: () => false, childNodes: [], display: 'none' };
    row.ml.nextElementSibling = { nodeType: 1, matches: selector => selector === '.ml-item',
      childNodes: ['hidden-time', 'visible-time'].includes(separator) ? [wrapper] : [hiddenSystem],
      querySelectorAll: () => ['hidden-time', 'visible-time', 'mixed-time-system'].includes(separator) ? [stamp] : [],
      nextElementSibling: next };
    if (separator === 'mixed-time-system') row.ml.nextElementSibling.childNodes = [wrapper, hiddenSystem];
  });
  area.querySelectorAll = selector => selector === '.message-container' ? rows :
    rows.map(row => row.avatar).filter(avatar => avatar.dataset.liuliTy !== undefined);
  const context = { llModeCfg: { chatStyle: 'tim', avatarPosition: 'bottom' }, window: { LiuliQQ: { messageRecord: row => row.record } },
    getComputedStyle: node => ({ display: node.display }),
    document: { querySelectorAll: selector => selector === '.chat-msg-area .message-container' ? rows :
      selector === '.chat-msg-area .avatar-span[data-liuli-ty]' ? area.querySelectorAll('.avatar-span[data-liuli-ty]') : [area] } };
  vm.createContext(context);
  vm.runInContext(functionSource('groupMessages') + '\n' + functionSource('stickAvatars') +
    ';globalThis.group=groupMessages;globalThis.stick=stickAvatars;', context);
  return { context, rows, group: context.group, stick: context.stick };
}

test('native loaded neighbors keep virtual edge groups stable and reflect real deletion immediately', () => {
  const h = groupingHarness(Array.from({ length: 8 }, () => ({ sender: 'a' })));
  let native = h.rows.map((row, index) => Object.assign(row.record, {
    msgId: String(index), msgType: 2, elements: [{ elementType: 1, textElement: { content: 'hello' } }]
  }));
  let reads = 0;
  h.context.window.LiuliQQ.loadedMessageSequence = () => {
    reads++;
    const snapshot = [...native];
    return { neighbors(record) {
      const index = snapshot.indexOf(record);
      return index < 0 ? null : { previous: snapshot[index - 1] || null, next: snapshot[index + 1] || null };
    } };
  };
  const mount = (from, to) => {
    const rows = h.rows.slice(from, to);
    rows.forEach((row, index) => {
      row.ml.previousElementSibling = rows[index - 1]?.ml || null;
      row.ml.nextElementSibling = rows[index + 1]?.ml || null;
    });
    h.context.document.querySelectorAll = selector => selector === '.chat-msg-area .message-container' ? rows : [];
    h.group();
    return rows.map(row => row.dataset.liuliG);
  };
  assert.deepEqual(mount(0, 5), ['first', 'mid', 'mid', 'mid', 'mid']);
  assert.deepEqual(mount(2, 6), ['mid', 'mid', 'mid', 'mid']);
  assert.deepEqual(mount(2, 8), ['mid', 'mid', 'mid', 'mid', 'mid', 'last']);
  assert.equal(reads, 3, 'Native sequence was scanned once per row instead of once per message area');
  native = native.slice(2);
  assert.deepEqual(mount(2, 6), ['first', 'mid', 'mid', 'mid'], 'A deleted native predecessor survived in a stale adjacency cache');
});

test('native edge extension rejects system, unknown media, peer and reverse-time records; mounted barriers remain authoritative', () => {
  const previous = { chatType: 2, peerUid: 'peer', senderUid: 'a', msgTime: 900, msgId: 'old', msgType: 2,
    elements: [{ elementType: 1, textElement: { content: 'previous' } }] };
  for (const override of [
    { msgType: 5, elements: [{ elementType: 8, grayTipElement: {} }] },
    { elements: [{ elementType: 99, unknownElement: {} }] },
    { elements: [{ elementType: 2, picElement: {} }] },
    { elements: [{ elementType: 7, replyElement: {} }, { elementType: 1, textElement: { content: 'reply' } }] },
    { peerUid: 'other' }, { chatType: 1 }, { senderUid: 'b' }, { msgTime: 2000 }, { recallTime: 1 }
  ]) {
    const h = groupingHarness([{ sender: 'a' }]);
    h.rows[0].record.msgId = 'current';
    h.context.window.LiuliQQ.loadedMessageSequence = () => ({ neighbors: () => ({ previous: { ...previous, ...override }, next: null }) });
    h.group();
    assert.equal(h.rows[0].dataset.liuliG, 'single', JSON.stringify(override));
    assert.equal(h.rows[0].dataset.liuliAvatarG, 'single', JSON.stringify(override));
  }
  for (const elements of [[{ elementType: 1, textElement: { content: 'ordinary' } }], [{ elementType: 6, faceElement: { faceIndex: 1 } }]]) {
    const h = groupingHarness([{ sender: 'a' }]); h.rows[0].record.msgId = 'current';
    h.context.window.LiuliQQ.loadedMessageSequence = () => ({ neighbors: () => ({ previous: { ...previous, elements }, next: null }) });
    h.group();
    assert.equal(h.rows[0].dataset.liuliG, 'last'); assert.equal(h.rows[0].dataset.liuliAvatarG, 'last');
  }
  const h = groupingHarness([{ sender: 'a', separatorAfter: 'hidden-system' }, { sender: 'a' }]);
  h.rows[0].record.msgId = 'a'; h.rows[1].record.msgId = 'b';
  h.rows[1].ml.previousElementSibling = h.rows[0].ml.nextElementSibling;
  h.context.window.LiuliQQ.loadedMessageSequence = () => ({ neighbors: record => record === h.rows[0].record ?
    { previous: null, next: h.rows[1].record } : { previous: h.rows[0].record, next: null } });
  h.group();
  assert.deepEqual(h.rows.map(row => row.dataset.liuliG), ['single', 'single']);
});

test('TIM avatar groups include media while text shapes remain isolated; TG and classic keep their grouping contract', () => {
  const h = groupingHarness([{ sender: 'a' }, { sender: 'a', media: 'voice' }, { sender: 'a', media: 'file' },
    { sender: 'a', media: 'image' }, { sender: 'a' }]);
  h.group();
  assert.deepEqual(h.rows.map(row => row.dataset.liuliAvatarG), ['first', 'mid', 'mid', 'mid', 'last']);
  assert.deepEqual(h.rows.map(row => row.dataset.liuliG), ['single', 'single', 'single', 'single', 'single']);
  assert.deepEqual(h.rows.map(row => row.hasAttribute('data-liuli-tim-text')), [true, false, false, false, true]);
  h.context.llModeCfg.chatStyle = 'tg'; h.group();
  assert.deepEqual(h.rows.map(row => row.dataset.liuliG), ['first', 'mid', 'mid', 'mid', 'last']);
  assert(h.rows.every(row => row.dataset.liuliAvatarG === undefined));
  h.context.llModeCfg.chatStyle = 'classic'; h.group();
  assert(h.rows.every(row => row.dataset.liuliG === 'single'));
});

test('TG and TIM group consecutive senders across hidden time presentation while retaining real boundaries', () => {
  for (const mode of ['tg', 'tim']) for (const [name, specs, expected] of [
    ['unknown', [{ sender: 'a' }, {}, { sender: 'a' }], ['single', '', 'single']],
    ['peer', [{ sender: 'a' }, { sender: 'a', peer: 'other' }], ['single', 'single']],
    ['system', [{ sender: 'a', separatorAfter: true }, { sender: 'a' }], ['single', 'single']],
    ['timestamp', [{ sender: 'a' }, { sender: 'a', showTimestamp: true }], ['first', 'last']],
    ['hidden-time', [{ sender: 'a', separatorAfter: 'hidden-time' }, { sender: 'a' }], ['first', 'last']],
    ['visible-time', [{ sender: 'a', separatorAfter: 'visible-time' }, { sender: 'a' }], ['single', 'single']],
    ['hidden-system', [{ sender: 'a', separatorAfter: 'hidden-system' }, { sender: 'a' }], ['single', 'single']],
    ['mixed-time-system', [{ sender: 'a', separatorAfter: 'mixed-time-system' }, { sender: 'a' }], ['single', 'single']],
    ['exact300', [{ sender: 'a', time: 1000 }, { sender: 'a', time: 1300 }], ['first', 'last']],
    ['over300', [{ sender: 'a', time: 1000 }, { sender: 'a', time: 2316, showTimestamp: true }], ['first', 'last']],
    ['reverse', [{ sender: 'a', time: 1000 }, { sender: 'a', time: 999 }], ['single', 'single']]
  ]) {
    const h = groupingHarness(specs); h.context.llModeCfg.chatStyle = mode; h.group();
    assert.deepEqual(h.rows.map(row => mode === 'tim' ? row.dataset.liuliAvatarG : row.dataset.liuliG), expected, mode + '/' + name);
  }
});

test('TIM inline-face-only messages retain text shapes and grouping; empty, unknown and media content remain excluded', () => {
  const h = groupingHarness([{ sender: 'a' }, { sender: 'a', inlineFace: true }, { sender: 'a' },
    { sender: 'a', empty: true }, { sender: 'a', unknown: true },
    ...['market-face', 'lottie', 'image', 'voice', 'file', 'video', 'skin'].map(media => ({ sender: 'a', media, inlineFace: true }))]);
  h.group();
  assert.deepEqual(h.rows.slice(0, 3).map(row => row.dataset.liuliG), ['first', 'mid', 'last']);
  assert.deepEqual(h.rows.map(row => row.hasAttribute('data-liuli-tim-text')),
    [true, true, true, false, false, false, false, false, false, false, false, false]);
  assert(h.rows.slice(3).every(row => row.dataset.liuliG === 'single'));
  assert.deepEqual(h.rows.map(row => row.dataset.liuliAvatarG),
    ['first', ...Array(h.rows.length - 2).fill('mid'), 'last'], 'Shape classification must not split sender/avatar groups');
});

test('TIM bottom avatars stick by avatar groups; top placement and recycled middle avatars clear old transforms', () => {
  const h = groupingHarness([{ sender: 'a' }, { sender: 'a', media: 'voice' }, { sender: 'a', media: 'file' }]);
  h.group();
  h.rows[1].avatar.dataset.liuliTy = '-10'; h.rows[1].avatar.style.transform = 'translateY(-10px)';
  h.stick();
  assert.equal(h.rows[1].avatar.dataset.liuliTy, undefined, 'A recycled middle row kept its old terminal offset');
  assert.equal(h.rows[1].avatar.style.transform, '');
  assert.equal(h.rows[2].avatar.dataset.liuliTy, '-64');
  assert.equal(h.rows[2].avatar.style.transform, 'translateY(-64px)');
  h.context.llModeCfg.avatarPosition = 'top'; h.stick();
  assert(h.rows.every(row => row.avatar.dataset.liuliTy === undefined && row.avatar.style.transform === ''));
});
