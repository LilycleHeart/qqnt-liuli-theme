'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/message-scroll-coverage-20261113/group-boundary'));
const index = process.argv[5] ? fs.readFileSync(process.argv[5], 'utf8') : read('renderer/index.js');
const qq = read('renderer/qq.js');
function helper(source, name) {
  const start = source.indexOf('  function ' + name + '('), end = source.indexOf('\n  }', start);
  assert(start >= 0 && end > start, 'Missing ' + name);
  return source.slice(start, end + 4);
}
const styleNames = [...index.slice(index.indexOf('  const FILES = ['), index.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = styleNames.filter(file => fs.existsSync(path.join(root, 'assets', file))).map(file => read('assets/' + file)).join('\n');
const native = read('dev/fixtures/qq-native-message-layout.css');
const setup = `body{margin:0!important;font:14px sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_3:14px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#eee;--ll-brand:#eec252;--ll-brand-rgb:238,194,82;--ll-message-font-size:14px;--ll-name-font-size:14px;--ll-title-font-size:10px;--ll-bubble-scale:1}.chat-msg-area{width:720px}.avatar-native{width:32px;height:32px;background:#999}.text-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
const runtime = `(()=>{
  let llModeCfg={chatStyle:'tim',avatarPosition:'top',timSenderPosition:'outside'};
  const messages=new WeakMap(),messageSequenceOwners=new WeakMap();
  ${['visitComponents', 'messageRecord', 'messagePeer', 'loadedMessageSequence'].map(name => helper(qq, name)).join('\n')}
  ${helper(index, 'groupMessages')}
  const area=document.querySelector('.chat-msg-area'),list=document.querySelector('.chat-msg-area__vlist'),inner=document.querySelector('.ml-list');
  const records=Array.from({length:8},(_,i)=>({msgId:String(i),chatType:2,peerUid:'peer',senderUid:'s',msgTime:1000+i,msgType:2,elements:[{elementType:1,textElement:{content:'Short message'}}]}));
  const entries=records.map(data=>({id:data.msgId,msgId:data.msgId,data,height:39,pos:39}));
  const source={value:entries};
  area._vnode={component:{props:{dataKey:'msgId'},vnode:{el:list},exposed:{msgs:source,curMsgs:{value:[]}},isUnmounted:false}};
  const nativeRows=records.map(record=>{
    const row=document.createElement('div');row.className='ml-item';row.id=record.msgId;
    row.innerHTML='<div class="message"><div class="message-native"><div class="message-container message-container--mix-or-markdown"><span class="avatar-span"><span class="avatar-native"></span></span><div class="user-name"><span class="text-ellipsis">Sender name</span></div><div class="message-content__wrapper"><div class="msg-content-container container--others mix-message__container"><div class="message-content mix-message__inner"><span class="text-element"><span class="text-normal">Short message</span></span></div></div></div></div></div></div>';
    const message=row.querySelector('.message');message._vnode={component:{props:{msgRecord:record},vnode:{el:message},isUnmounted:false}};
    return row;
  });
  window.LiuliQQ={messageRecord,loadedMessageSequence};
  window.mount=(from,to)=>{inner.replaceChildren(...nativeRows.slice(from,to));groupMessages();};
  window.measure=id=>{const row=document.getElementById(String(id)),mc=row.querySelector('.message-container');return {height:row.getBoundingClientRect().height,group:mc.dataset.liuliG,avatarGroup:mc.dataset.liuliAvatarG,nameDisplay:getComputedStyle(mc.querySelector('.user-name')).display,original:nativeRows[Number(id)]===row};};
  window.configure=(mode,placement)=>{llModeCfg.chatStyle=mode;llModeCfg.timSenderPosition=placement;document.body.dataset.liuliChatStyle=mode;document.body.dataset.liuliTimSenderPosition=placement;
    for(const row of nativeRows){const name=row.querySelector('.user-name'),mc=row.querySelector('.message-container'),bubble=row.querySelector('.msg-content-container');if(mode==='tg'||placement==='inside')bubble.prepend(name);else mc.insertBefore(name,mc.querySelector('.message-content__wrapper'));}
  };
  window.setSource=kind=>{
    if(kind==='delete')source.value=entries.slice(3);
    else if(kind==='system'||kind==='unknown'||kind==='peer') {
      const data={...records[2],msgId:'barrier',...(kind==='system'?{msgType:5,elements:[{elementType:8,grayTipElement:{}}]}:kind==='unknown'?{elements:[{elementType:99,unknownElement:{}}]}:{peerUid:'other'})};
      source.value=[...entries.slice(0,3),{id:'barrier',msgId:'barrier',data},...entries.slice(3)];
    } else source.value=entries;
  };
  window.nativeUnchanged=()=>entries.every(entry=>entry.height===39&&entry.pos===39);
})();`;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Production grouping and native _vnode sequence helper with captured native CSS. No QQ runtime or native virtualizer methods are called.', cases: [], passed: false };
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 650 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><style>' + native + '\n' + css + '\n' + setup + '</style><body data-liuli-scope="main" data-liuli-chat-style="tim" data-liuli-avatar-position="top" data-liuli-tim-sender-position="outside"><div class="chat-msg-area"><div class="ml-area chat-msg-area__vlist"><div class="ml-list"></div></div></div></body>');
    await page.addScriptTag({ content: runtime });
    for (const [mode, placement] of [['tim', 'outside'], ['tim', 'inside'], ['tg', 'inside']]) {
      await page.evaluate(([mode, placement]) => window.configure(mode, placement), [mode, placement]);
      const samples = [];
      for (const [from, to] of [[0, 6], [2, 6], [3, 7], [1, 4], [0, 6]]) {
        await page.evaluate(([from, to]) => window.mount(from, to), [from, to]);
        const sample = await page.evaluate(() => window.measure(3));
        samples.push({ from, to, ...sample });
        assert.equal(sample.group, 'mid', 'Same native message changed group at a render-window edge');
        assert.equal(sample.height, samples[0].height, 'Virtual range replacement changed an existing message height');
        assert(sample.original, 'Grouping replaced a native row');
      }
      report.cases.push({ mode, placement, samples });
    }
    await page.evaluate(() => window.configure('tim', 'outside'));
    for (const barrier of ['delete', 'system', 'unknown', 'peer']) {
      await page.evaluate(barrier => { window.setSource(barrier);window.mount(3, 7); }, barrier);
      const sample = await page.evaluate(() => window.measure(3));
      assert.equal(sample.group, 'first', 'Native boundary did not update after ' + barrier);
      assert.notEqual(sample.nameDisplay, 'none', 'Native boundary incorrectly hid sender after ' + barrier);
      report.cases.push({ barrier, ...sample });
    }
    assert(await page.evaluate(() => window.nativeUnchanged()), 'Native geometry cache was mutated');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'boundary.png') });
    report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally { await browser.close();fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));console.log(JSON.stringify({ output, passed: report.passed, error: report.error })); }
})();
