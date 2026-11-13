'use strict';
// Compare stable geometry with the pre-fix production helper, then exercise an
// exact historical closure as a negative control. No QQ connection/deployment.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/invisible-overhead-fix-20261114/grouping-stability'));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('renderer/index.js');
const before = fs.readFileSync(process.argv[5] || path.join(root, '../../output/playwright/invisible-overhead-fix-20261114/before/renderer/index.js'), 'utf8');
const legacy = fs.readFileSync(process.argv[6] || path.join(root, '../../output/playwright/tim-layout-options-20261113/index.js.before'), 'utf8');
function helper(text, name) {
  const start = text.indexOf('  function ' + name + '('), end = text.indexOf('\n  }', start);
  assert(start >= 0 && end > start, 'Missing helper ' + name);
  return text.slice(start, end + 4);
}
const cssFiles = [...source.slice(source.indexOf('  const FILES = ['), source.indexOf('  const STYLE_ID')).matchAll(/'([^']+\.css)'/g)].map(match => match[1]);
const css = read('dev/fixtures/qq-native-message-layout.css') + '\n' + read('dev/fixtures/qq-native-file.css') + '\n' +
  cssFiles.filter(name => fs.existsSync(path.join(root, 'assets', name))).map(name => read('assets/' + name)).join('\n');
const setup = `body{margin:0!important;font:14px sans-serif;--avatar_size_2:32px;--font_size_1:12px;--line_height_1:16px;--font_size_2:14px;--line_height_2:20px;--font_size_main_2:14px;--line_height_main_2:22px;--ll-acrylic:50,44,29;--ll-on-glass:#eee;--ll-brand:#eec252;--ll-brand-rgb:238,194,82;--ll-message-font-size:14px;--ll-name-font-size:12px;--ll-title-font-size:10px;--ll-bubble-scale:1}.chat-msg-area{width:720px}.chat-msg-area__vlist{height:230px;overflow:auto}.avatar-native{width:32px;height:32px;background:#aaa}.pic-element{width:80px;height:50px}.text-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.message-content{min-width:0}`;
function row(id, kind = 'text', sender = 'same') {
  const body = kind === 'image' ? '<div class="pic-element"><img width="80" height="50"></div>' :
    kind === 'voice' ? '<div class="ptt-element"><div class="ptt-element__top-area"><div class="ptt-element__button"></div><div class="ptt-element__progress"></div><span>7″</span></div></div>' :
    kind === 'empty' ? '' : '<span class="text-element">A normal message with native sender metadata</span>';
  return `<div class="ml-item" id="${id}"><div class="message"><div class="message-native"><div class="message-container message-container--mix-or-markdown" data-sender="${sender}" data-kind="${kind}"><span class="avatar-span" aria-label="${sender}"><span class="avatar-native"></span></span><div class="user-name"><span class="group-member-label">管理员</span><span class="text-ellipsis">${sender ? 'Native name' : ''}</span><span class="user-label">头衔</span></div><div class="message-content__wrapper"><div class="msg-content-container container--others ${kind === 'voice' ? 'ptt-message__container' : 'mix-message__container'}"><div class="message-content mix-message__inner">${body}</div></div></div></div></div></div></div>`;
}
const markup = row('a') + '<div class="ml-item"><div class="message"><div class="message__timestamp">hidden native time</div></div></div>' +
  row('b') + row('c') + row('voice', 'voice') + row('image', 'image') + row('d') + row('e') + row('unknown', 'empty', '');
const shell = '<!doctype html><style>' + css + '\n' + setup + '</style><body data-liuli-scope="main" data-liuli-chat-style="tim" data-liuli-avatar-position="top" data-liuli-tim-sender-position="outside"><div class="chat-msg-area__vlist"><div class="chat-msg-area">' + markup + '</div></div></body>';
function runtime(text) {
  return `(()=>{
    let llModeCfg={chatStyle:'tim',avatarPosition:'top',timSenderPosition:'outside'};
    ${['elementsWithin','isImageOnlyContent','isVideoOnlyContent','moveSenderIntoBubble','groupMessages','stickAvatars'].map(name => helper(text, name)).join('\n')}
    const rows=[...document.querySelectorAll('.message-container')];
    const records=new WeakMap(rows.map((row,i)=>[row,{msgId:row.closest('.ml-item').id,chatType:2,peerUid:'p',senderUid:row.dataset.sender,msgTime:1000+i*600,showTimestamp:i===1,msgType:2,elements:[{elementType:1,textElement:{content:'text'}}]}]));
    window.LiuliQQ={messageRecord:row=>records.get(row)};
    window.nativeNames=rows.map(row=>row.querySelector('.user-name'));
    window.addNativeRow=()=>{const original=document.querySelector('#c'),row=original.cloneNode(true),mc=row.querySelector('.message-container');row.id='new-native-row';records.set(mc,{...records.get(original.querySelector('.message-container')),msgId:'new-native-row',msgTime:9000});document.querySelector('.chat-msg-area').insertBefore(row,document.querySelector('#voice'));};
    window.configure=cfg=>{Object.assign(llModeCfg,cfg);window.__liuliSettingsCache={...llModeCfg};Object.assign(document.body.dataset,{liuliChatStyle:llModeCfg.chatStyle,liuliAvatarPosition:llModeCfg.avatarPosition,liuliTimSenderPosition:llModeCfg.timSenderPosition});moveSenderIntoBubble(document);groupMessages();stickAvatars();};
    window.repeatGroups=()=>{const observer=new MutationObserver(()=>{});observer.observe(document.querySelector('.chat-msg-area'),{subtree:true,attributes:true,attributeFilter:['data-liuli-g','data-liuli-avatar-g','data-liuli-tim-text','data-liuli-named']});for(let i=0;i<20;i++){moveSenderIntoBubble(document);groupMessages();}const count=observer.takeRecords().length;observer.disconnect();return count;};
    window.configure(llModeCfg);
  })();`;
}
function savedAdapter(kind) {
  const filename=path.join(root,'../../output/playwright/invisible-overhead-fix-20261114/before/dev/patch-tim-'+kind+'-live.cjs');
  const fixture=path.join(output,'before-adapter-fixture');
  fs.mkdirSync(path.join(fixture,'renderer'),{recursive:true});fs.writeFileSync(path.join(fixture,'renderer/index.js'),before);
  const module={exports:{}};
  new Function('require','module','__dirname',fs.readFileSync(filename,'utf8'))(require,module,path.dirname(filename));
  return module.exports(fixture);
}
const measure = () => [...document.querySelectorAll('.message-container')].map((row, index) => {
  const name = row.querySelector('.user-name'), avatar = row.querySelector('.avatar-span'), bubble = row.querySelector('.msg-content-container');
  const rect = element => { const r=element.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(v=>Math.round(v*1000)/1000); };
  // Attribute insertion order can differ between rAFs without changing DOM
  // semantics. Preserve child order/content while comparing attribute values.
  const clone=row.cloneNode(true);
  for(const element of [clone,...clone.querySelectorAll('*')]){const attrs=[...element.attributes].map(attr=>[attr.name,attr.value]).sort(([a],[b])=>a.localeCompare(b));for(const attr of [...element.attributes])element.removeAttribute(attr.name);for(const [key,value] of attrs)element.setAttribute(key,value);}
  return {id:row.closest('.ml-item').id,group:row.dataset.liuliG,avatarGroup:row.dataset.liuliAvatarG,timText:row.hasAttribute('data-liuli-tim-text'),
    rowRect:rect(row),bubbleRect:rect(bubble),avatarRect:rect(avatar),avatarDisplay:getComputedStyle(avatar).display,avatarTransform:avatar.style.transform,
    nameIdentity:window.nativeNames[index]===name,nameParent:name.parentElement===row?'outside':'inside',nameDisplay:getComputedStyle(name).display,nameRect:rect(name),html:clone.innerHTML};
});
const variants = [
  ...['top','bottom'].flatMap(avatarPosition=>['outside','inside'].map(timSenderPosition=>({chatStyle:'tim',avatarPosition,timSenderPosition}))),
  ...['tg','classic'].flatMap(chatStyle=>['top','bottom'].map(avatarPosition=>({chatStyle,avatarPosition,timSenderPosition:'inside'}))),
  {chatStyle:'tim',avatarPosition:'top',timSenderPosition:'outside'}
];
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});
  const report={scope:'Isolated native DOM/CSS and exact saved historical grouping closure; no live QQ/settings/deployment',checks:[],passed:false};
  try {
    const versions=[];
    for(const [label,text] of [['before',before],['after',source]]) {
      const page=await browser.newPage({viewport:{width:800,height:650}});
      await page.setContent(shell);await page.addScriptTag({content:runtime(text)});
      const snapshots=[];
      for(const cfg of variants){await page.evaluate(cfg=>window.configure(cfg),cfg);snapshots.push({cfg,rows:await page.evaluate(measure),repeatMutations:await page.evaluate(()=>window.repeatGroups())});}
      versions.push({label,snapshots});await page.close();
    }
    for(let i=0;i<variants.length;i++) {
      assert.deepEqual(versions[1].snapshots[i].rows,versions[0].snapshots[i].rows,'Stable DOM/geometry changed for '+JSON.stringify(variants[i]));
      assert.equal(versions[1].snapshots[i].repeatMutations,0,'Repeated production grouping emitted mutations');
    }
    assert(versions[0].snapshots.some(sample=>sample.repeatMutations>0),'Negative control did not exercise no-sender writes');
    report.variants=versions;
    report.checks.push('All 9 mode/position transitions retain exact stable sender DOM, grouping, avatar geometry, bubble geometry and row height; 20 repeated production move/group passes emit zero grouping or named mutations, including a senderless row.');
    report.adapters=[];
    for(const kind of ['grouping','layout']) {
      const beforePage=await browser.newPage({viewport:{width:800,height:650}});
      await beforePage.route('http://liuli.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:shell}));await beforePage.goto('http://liuli.test/');
      await beforePage.addScriptTag({content:runtime(source)});await beforePage.addScriptTag({content:savedAdapter(kind)});await beforePage.waitForTimeout(50);
      const hotSnapshots=[];
      for(const cfg of variants){await beforePage.evaluate(cfg=>window.configure(cfg),cfg);await beforePage.waitForTimeout(60);hotSnapshots.push(await beforePage.evaluate(measure));}
      await beforePage.close();
      const page=await browser.newPage({viewport:{width:800,height:650}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('http://liuli.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:shell}));await page.goto('http://liuli.test/');
      await page.addScriptTag({content:runtime(source)});
      await page.addScriptTag({content:`(()=>{let llModeCfg={chatStyle:'tim'};${helper(legacy,'groupMessages')}window.runLegacy=groupMessages;})();`});
      const baseline=await page.evaluate(measure);
      const negative=await page.evaluate(()=>{const area=document.querySelector('.chat-msg-area'),observer=new MutationObserver(()=>{});observer.observe(area,{attributes:true,subtree:true,attributeFilter:['data-liuli-g']});window.runLegacy();const count=observer.takeRecords().length;observer.disconnect();window.configure({chatStyle:'tim'});return count;});
      assert(negative>=3,'Historical closure did not regress current grouping');
      const adapter=require('./patch-tim-'+kind+'-live.cjs')();
      await page.addScriptTag({content:adapter});await page.waitForTimeout(50);
      assert.equal(await page.evaluate(()=>{const NativeError=window.Error;let checks=0;window.Error=new Proxy(NativeError,{construct(target,args,newTarget){checks++;return Reflect.construct(target,args,newTarget);}});try{const row=document.querySelector('.message-container');for(let i=0;i<1000;i++){void row.dataset.liuliG;void row.dataset.sender;row.dataset.nativeProbe=String(i);row.setAttribute('data-native-probe',String(i));}return checks;}finally{window.Error=NativeError;delete document.querySelector('.message-container').dataset.nativeProbe;document.querySelector('.message-container').removeAttribute('data-native-probe');}}),0,'Dataset reads or unrelated writes collected stacks');
      await page.evaluate(()=>{window.groupRecords=[];window.groupObserver=new MutationObserver(records=>window.groupRecords.push(...records));window.groupObserver.observe(document.querySelector('.chat-msg-area'),{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['data-liuli-g','data-liuli-avatar-g','data-liuli-tim-text']});for(let i=0;i<10;i++)window.runLegacy();});
      await page.waitForTimeout(60);
      const stats=await page.evaluate(kind=>({blocked:window[kind==='layout'?'__liuliTimLayoutCompatibility':'__liuliTimGroupingCompatibility'].blockedGroupWrites,changes:window.groupRecords.length}),kind);
      assert(stats.blocked>0,'No historical group write was intercepted');
      assert.equal(stats.changes,0,'Historical closure still changed grouping attributes');
      assert.deepEqual(await page.evaluate(measure),baseline,'Adapter changed stable appearance');
      for(let i=0;i<variants.length;i++) {
        await page.evaluate(cfg=>window.configure(cfg),variants[i]);await page.waitForTimeout(60);
        assert.deepEqual(await page.evaluate(measure),hotSnapshots[i],'Adapter changed stable mode/position layout: '+kind+' '+JSON.stringify(variants[i]));
      }
      let named;
      if(kind==='layout') {
        await page.evaluate(()=>window.configure({chatStyle:'tg',avatarPosition:'top'}));await page.waitForTimeout(60);
        await page.addScriptTag({content:`(()=>{let llModeCfg={chatStyle:'tg'};${['elementsWithin','isImageOnlyContent','isVideoOnlyContent','moveSenderIntoBubble'].map(name=>helper(before,name)).join('\n')}window.runLegacySender=()=>moveSenderIntoBubble(document);})();`});
        named=await page.evaluate(()=>{window.namedRecords=[];window.namedObserver=new MutationObserver(records=>window.namedRecords.push(...records));window.namedObserver.observe(document.querySelector('.chat-msg-area'),{subtree:true,attributes:true,attributeFilter:['data-liuli-named']});const passes=window.__liuliTimLayoutCompatibility.passes;for(let i=0;i<10;i++)window.runLegacySender();return{passes};});
        await page.waitForTimeout(60);
        Object.assign(named,await page.evaluate(()=>({notifications:window.namedRecords.length,passesAfter:window.__liuliTimLayoutCompatibility.passes})));
        assert(named.notifications>0,'Named negative control did not exercise the old unconditional writer');
        assert.equal(named.passesAfter,named.passes,'Old named-only writes triggered an adapter prepare');
        assert(await page.evaluate(()=>{const row=document.querySelector('#a .message-container'),bubble=row.querySelector('.msg-content-container');bubble.dataset.liuliNamed='native-marker';const written=bubble.dataset.liuliNamed==='native-marker';row.appendChild(row.querySelector('.user-name'));return written&&row.querySelector('.user-name').parentNode===row;}),'Native marker write or sender reparent was blocked');
        await page.waitForTimeout(60);
        assert(await page.evaluate(()=>{const row=document.querySelector('#a .message-container'),name=row.querySelector('.user-name');return name===window.nativeNames[0]&&name.parentElement.matches('.msg-content-container')&&name.parentElement.dataset.liuliNamed==='1';}),'Actual native sender reparent was not reconciled');
        await page.evaluate(()=>{window.namedObserver.disconnect();window.configure({chatStyle:'tim',avatarPosition:'top',timSenderPosition:'outside'});});await page.waitForTimeout(60);
      }
      assert(await page.evaluate(()=>{const row=document.querySelector('.message-container');row.dataset.nativeProbe='native';row.dataset.liuliG='native-dataset';const a=row.dataset.liuliG==='native-dataset';row.setAttribute('data-liuli-g','native-attribute');const b=row.dataset.liuliG==='native-attribute';row.removeAttribute('data-liuli-g');const c=!row.hasAttribute('data-liuli-g');return a&&b&&c&&row.dataset.nativeProbe==='native';}),'Native or unrelated writes were blocked');
      await page.waitForTimeout(60);
      await page.addScriptTag({content:adapter});await page.waitForTimeout(50);
      if(kind==='layout') {await page.addScriptTag({content:require('./patch-tim-grouping-live.cjs')()});assert(await page.evaluate(()=>!window.__liuliTimGroupingCompatibility&&window.__liuliTimLayoutCompatibility.groupingWriteOwner),'Second grouping owner was installed');}
      await page.evaluate(()=>window.addNativeRow());await page.waitForTimeout(60);
      assert(await page.evaluate(()=>Object.hasOwn(document.querySelector('#new-native-row .message-container'),'dataset')),'New native row was not guarded');
      assert.equal(await page.evaluate(()=>{const observer=new MutationObserver(()=>{});observer.observe(document.querySelector('.chat-msg-area'),{attributes:true,subtree:true,attributeFilter:['data-liuli-g']});window.runLegacy();const count=observer.takeRecords().length;observer.disconnect();return count;}),0,'Old closure changed a newly mounted native row');
      await page.evaluate(()=>{window.removedGroupingRow=document.querySelector('#unknown .message-container');window.removedGroupingRow.closest('.ml-item').remove();});await page.waitForTimeout(60);
      assert(await page.evaluate(()=>['dataset','setAttribute','removeAttribute','toggleAttribute'].every(key=>!Object.hasOwn(window.removedGroupingRow,key))),'Removed row retained instance guards');
      await page.evaluate(kind=>window[kind==='layout'?'__liuliTimLayoutCompatibility':'__liuliTimGroupingCompatibility'].dispose(),kind);
      assert(await page.evaluate(()=>[...document.querySelectorAll('.message-container')].every(row=>['dataset','setAttribute','removeAttribute','toggleAttribute'].every(key=>!Object.hasOwn(row,key)))),'Instance descriptors survived disposal');
      assert.deepEqual(errors,[]);report.adapters.push({kind,negativeGroupWrites:negative,...stats,named,nativeWritesAllowed:true,unrelatedStackChecks:0,stableAppearance:true,stableModeTransitions:variants.length,newRowsGuarded:true,removedRowsRestored:true,reinstallAndDispose:true});await page.close();
    }
    report.checks.push('Exact saved old closure changes current grouping without the bridge; both bridges block all 10 repeated old passes before mutation, preserve stable geometry, allow native/unrelated writes, and restore instance descriptors on disposal.');
    report.passed=true;
  } catch(error){report.error=error.stack;process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,passed:report.passed,error:report.error}));}
})();
