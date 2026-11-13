'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/scroll-flash-repair-20261113'));
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
const before = fs.readFileSync(path.resolve(process.argv[5] || path.join(root,
  '../../output/playwright/scroll-flash-repair-20261113/index.js.before')), 'utf8');
function helper(name, text = source) {
  const start = text.indexOf('  function ' + name + '('), end = text.indexOf('\n  }', start);
  assert(start >= 0 && end > start, name);
  return text.slice(start, end + 4);
}
const motion = fs.readFileSync(path.join(root, 'renderer/motion.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'renderer/background-performance.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/markdown.css'), 'utf8');
const row = (id, time, seq = id, peer = 'peer') => `<div class="ml-item" id="${id}" data-time="${time}" data-seq="${seq}" data-peer="${peer}"><div class="message"><div class="message-container"><span class="avatar-span"></span><div class="message-content__wrapper">Message ${id}</div></div></div></div>`;
const now = () => Math.floor(Date.now() / 1000);
const fixture = () => `<!doctype html><style>${css}\n.chat-msg-area{height:200px;width:600px}.ml-root{height:180px;overflow:auto;display:flex;flex-direction:column-reverse}.ml-item{min-height:50px}.recent-contact{height:160px;overflow:auto}.recent-contact-item{height:50px}.recent-contact-item::before{content:'';display:block;height:4px;background:red}@keyframes decoration{to{transform:rotate(1turn)}}.decoration{animation:decoration 2s linear infinite}</style><body><div id="app"><div class="aio"><div class="chat-header"><div class="panel-header__title">peer</div></div><div class="chat-msg-area"><div class="ml-root">${[10, 9, 8, 7].map(id => row(id, now() - 100 + id)).join('')}</div></div></div><div class="recent-contact"><div class="recent-contact-item" data-contact-id="a">A</div><div class="recent-contact-item" data-contact-id="b">B</div><div class="recent-contact-item" data-contact-id="c">C</div></div><div class="decoration">decoration</div></div></body>`;
const setup = `window.testHidden=false;window.testFocus=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.testHidden});Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>window.testFocus});window.LiuliQQ={messageRecord:element=>{const message=element?.closest('.message');const row=message?.closest('.ml-item');return row?{chatType:2,peerUid:row.dataset.peer,msgId:row.id,msgTime:row.dataset.time,msgSeq:row.dataset.seq}:null;}};`;
const readProbe = `(()=>{
  window.entryReads={};window.countEntryReads=false;
  const hit=(element,key)=>{if(window.countEntryReads&&element.matches?.('.ml-item,.ml-root,.recent-contact-item'))window.entryReads[key]=(window.entryReads[key]||0)+1;};
  for(const key of ['getBoundingClientRect','getClientRects','getAnimations']){const original=Element.prototype[key];Element.prototype[key]=function(...args){hit(this,key);return Reflect.apply(original,this,args);};}
  for(const [prototype,key] of [[HTMLElement.prototype,'offsetWidth'],[Element.prototype,'scrollHeight'],[Element.prototype,'clientHeight']]){const descriptor=Object.getOwnPropertyDescriptor(prototype,key);Object.defineProperty(prototype,key,{...descriptor,get(){hit(this,key);return descriptor.get.call(this);}});}
  window.startEntryReads=()=>{window.entryReads={};window.countEntryReads=true;};window.stopEntryReads=()=>{window.countEntryReads=false;return window.entryReads;};
})();`;
const runtime = `(()=>{const motion=LiuliMotion,LL_ENTER_MAX=14;${helper('llAnimateEnter')} ${helper('installRowEntryMotion')}window.coldEnter=llAnimateEnter;installRowEntryMotion();})();`;
const legacy = `(()=>{const motion=LiuliMotion,LL_EASE='ease';let llEnterPeer='peer',llEnterUntil=0;const LL_ENTER_MAX=14;const llMsgSeen={chat:'peer',max:10n};const llChatKey=()=> 'peer',llCurrentPeer=()=> 'peer';${['llMsgId','llMotionPass','llAnimateEnter','llHandleAdded'].map(n=>helper(n,before)).join('\n')}window.oldEntry=(records)=>{llHandleAdded(records);requestAnimationFrame(()=>llMotionPass([...document.querySelectorAll('.ml-item')]));};new MutationObserver(records=>window.oldEntry(records)).observe(document.querySelector('.ml-root'),{childList:true});window.coldEnter=llAnimateEnter;})();`;
async function settled(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
  const report = { scope: 'Production insertion controller and exact pre-fix closure in isolated Chromium; no QQ state writes or FPS claims', cases: [], passed: false };
  try {
    // This is an isolated reproduction of the pre-fix decision, not evidence
    // that the same transparent frame was captured in the running QQ window.
    const control = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await control.setContent(fixture()); await control.addScriptTag({ content: setup }); await control.addScriptTag({ content: motion });
    assert.equal(await control.evaluate(() => LiuliQQ.messageRecord(document.querySelector('.ml-item'))), null);
    assert(await control.evaluate(() => !!LiuliQQ.messageRecord(document.querySelector('.message'))));
    await control.addScriptTag({ content: legacy });
    await control.evaluate(html => document.querySelector('.ml-root').insertAdjacentHTML('beforeend', html), row(9999, now() - 600, 11));
    await settled(control);
    report.negativeControl = { oldHistoryEntered: await control.locator('.ml-item.ll-enter').count(),
      wrapperAnimations: await control.locator('[id="9999"] .message-content__wrapper').evaluate(node => node.getAnimations().length) };
    assert.equal(report.negativeControl.oldHistoryEntered, 1, 'Pre-fix history-tail mistake was not reproduced');
    report.cases.push('Unpatched legacy negative control incorrectly animates old history at DOM tail');
    await control.close();
    for (const mode of ['production', 'legacy-compatibility']) {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.setContent(fixture());
      await page.evaluate(html => {
        document.body.insertAdjacentHTML('beforeend', `<div hidden><div class="chat-msg-area">${html}</div></div>`);
        document.querySelector('.ml-root').insertAdjacentHTML('beforeend', `<div class="viewport-list__measure" hidden>${html}</div>`);
      }, row(20000, now() + 1, 9999));
      await page.addScriptTag({ content: setup }); await page.addScriptTag({ content: motion });
      await page.addScriptTag({ content: readProbe });
      await page.evaluate(() => { window.originalContainsDescriptor=Object.getOwnPropertyDescriptor(DOMTokenList.prototype,'contains'); });
      if (mode === 'production') await page.addScriptTag({ content: runtime });
      else {
        await page.addScriptTag({ content: legacy });
        await page.evaluate(()=>{
          const row=document.querySelector('.recent-contact-item');
          function llRiseIn(row){row.__llRiseAt=performance.now();return row.animate([{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],{duration:460,fill:'backwards'});}
          window.preinstallEntry=llRiseIn(row);
          window.preinstallSelection=row.animate([{transform:'translateY(50px)'},{transform:'none'}],{duration:460,pseudoElement:'::before'});
          startEntryReads();
        });
        await page.addScriptTag({ content: require('./patch-row-entry-live.cjs')() });
        const installationReads=await page.evaluate(()=>stopEntryReads());
        assert.equal(installationReads.getAnimations,1,'In-flight legacy adoption should inspect only the one marked active row');
        await page.locator('.recent-contact-item').first().evaluate(node=>node.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100})));
        assert.equal(await page.evaluate(()=>preinstallEntry.playState),'idle');
        assert.notEqual(await page.evaluate(()=>preinstallSelection.playState),'idle');
        report.cases.push('Compatibility adopts an already running legacy entry once; idle rows and selection pseudo animation remain untouched');
      }
      await page.evaluate(html => {
        document.querySelectorAll('[id="20000"]').forEach(node => { node.id='20001'; });
        document.querySelectorAll('.chat-msg-area')[1].insertAdjacentHTML('beforeend', html);
      }, row(20002, now() + 1, 10000, 'hidden-peer'));
      await settled(page);
      const append = async html => { await page.evaluate(html => document.querySelector('.ml-root').insertAdjacentHTML('beforeend', html), html); await settled(page); };
      const entering = () => page.locator('.ml-item.ll-enter').count();
      await page.evaluate(() => startEntryReads());
      await append(row(9999, now() - 600, 11));
      const historyReads = await page.evaluate(() => stopEntryReads());
      assert.deepEqual(historyReads, {}, mode + ' still reads row/tail layout for historical insertion');
      assert.equal(await entering(), 0, mode + ' animated history just because it was the DOM tail');
      report.cases.push(mode + ': first observer turn of old-time history performs no rect, width, scroll extent or animation queries');
      await page.evaluate(() => document.querySelector('.ml-root').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })));
      await append(row(10000, now(), 12)); assert.equal(await entering(), 0, mode + ' animated while user scrolling');
      await page.waitForTimeout(270);
      await page.evaluate(() => { document.querySelector('.ml-root').scrollTop = -100; });
      await append(row(10001, now(), 13)); assert.equal(await entering(), 0, mode + ' animated away from reversed live tail');
      report.cases.push(mode + ': user wheel and negative reversed scroll suppress virtualization entry');
      await page.evaluate(() => { document.querySelector('.ml-root').scrollTop = 0; });
      await append(row(10002, now(), 14)); assert.equal(await entering(), 1, mode + ' failed to animate genuine live delivery');
      report.cases.push(mode + ': hidden areas and measurement copies cannot change active high-water marks during installation or later reuse');
      assert.equal(await page.locator('[id="10002"] .message-content__wrapper').evaluate(node => node.getAnimations().filter(a => a.effect.getTiming().duration > 0).length), 0, 'Second wrapper entry survived');
      await page.waitForTimeout(450); assert.equal(await entering(), 0);
      await page.evaluate(() => { const row=document.getElementById('10002');row.remove();document.querySelector('.ml-root').append(row); });
      await settled(page); assert.equal(await entering(), 0, mode + ' reinserted message replayed');
      report.cases.push(mode + ': live message enters exactly once, without delayed wrapper replay');
      await append(row(10003, now(), 15)); assert.equal(await entering(), 1);
      await page.evaluate(() => {const row=document.getElementById('10003');row.id='10004';row.dataset.seq='16';});
      await settled(page); assert.equal(await entering(), 0, 'Recycled row kept its animation');
      const contact = page.locator('.recent-contact-item').first();
      await contact.evaluate((node, mode) => {
        const frames=[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}];
        function llRiseIn(row) { row.__llRiseAt=performance.now();return row.animate(frames,{duration:460,fill:'backwards'}); }
        window.entry=mode==='production'?LiuliMotion.play(node,frames,{duration:460,rowEntry:true}):llRiseIn(node);
        window.unowned=node.animate(frames,{duration:460,fill:'backwards'});
        window.selection=node.animate([{transform:'translateY(50px)'},{transform:'none'}],{duration:460,pseudoElement:'::before'});
        node.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));
      }, mode);
      assert.equal(await page.evaluate(() => window.entry.playState), 'idle');
      assert.notEqual(await page.evaluate(() => window.unowned.playState), 'idle');
      assert.notEqual(await page.evaluate(() => window.selection.playState), 'idle');
      await contact.evaluate(node => {
        window.replacedEntry=LiuliMotion.play(node,[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],{duration:460,rowEntry:true});
        window.replacementSelection=LiuliMotion.play(node,[{transform:'translateY(50px)'},{transform:'none'}],{duration:460,pseudoElement:'::before'});
        LiuliMotion.cancelEntries(node);
      });
      assert.equal(await page.evaluate(() => window.replacedEntry.playState), 'idle');
      assert.notEqual(await page.evaluate(() => window.replacementSelection.playState), 'idle');
      report.cases.push(mode + ': scrolling cancels only contact row entry, preserving selection pseudo animation');
      await page.evaluate(() => startEntryReads());
      await contact.evaluate(node => {for(let i=0;i<16;i++)node.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:100}));});
      assert.equal((await page.evaluate(() => stopEntryReads())).getAnimations || 0, 0, mode + ' queries idle contact animations on each scroll');
      report.cases.push(mode + ': repeated wheel events do not query idle row animations');
      await page.evaluate(() => {const area=document.querySelector('.chat-msg-area');area.setAttribute('data-ll-switching','');window.coldEnter([...area.querySelectorAll('.ml-item')].slice(-2));});
      await settled(page); assert(await entering() > 0, mode + ' blocked the cold switch cascade');
      const cascade = await page.locator('.ml-item.ll-enter').evaluateAll(rows=>rows.map(row=>{
        const style=getComputedStyle(row);return {index:Number(row.style.getPropertyValue('--ll-enter-i')),duration:style.animationDuration,delay:Number.parseFloat(style.animationDelay),easing:style.animationTimingFunction};
      }));
      assert.equal(cascade.length,2);
      assert.deepEqual(cascade.map(row=>row.index).sort(),[0,1]);
      for(const row of cascade){assert.equal(row.duration,'0.26s');assert(Math.abs(row.delay-row.index*.028)<1e-6);assert.equal(row.easing,'cubic-bezier(0.22, 1, 0.36, 1)');}
      report.cases.push(mode + ': cold switch retains 260ms duration, 28ms cascade and original easing');
      await page.evaluate(() => document.querySelector('.chat-msg-area').removeAttribute('data-ll-switching'));
      if (mode === 'legacy-compatibility') {
        assert.deepEqual(await page.evaluate(() => {
          const row=document.querySelector('.ml-item'),contains=DOMTokenList.prototype.contains;
          let illegalReceiver=false;try{contains.call({});}catch(error){illegalReceiver=error instanceof TypeError;}
          return {borrowed:contains.call(row.classList,'ml-item'),extraArguments:contains.call(row.classList,'ml-item','ignored'),otherToken:contains.call(row.classList,'missing'),illegalReceiver};
        }), {borrowed:true,extraArguments:true,otherToken:false,illegalReceiver:true});
        await page.addScriptTag({ content: require('./patch-row-entry-live.cjs')() });
        await page.evaluate(() => __liuliRowEntryCompatibility.dispose());
        assert.equal(await page.evaluate(() => !!window.__liuliRowEntryMotion || !!window.__liuliRowEntryCompatibility), false);
        assert(await page.locator('.message-content__wrapper').evaluateAll(nodes => nodes.every(n => !Object.hasOwn(n, 'animate'))));
        assert(await contact.evaluate(node=>!Object.hasOwn(node,'animate')));
        assert(await page.evaluate(()=>{const d=Object.getOwnPropertyDescriptor(DOMTokenList.prototype,'contains'),o=window.originalContainsDescriptor;return d.value===o.value&&d.writable===o.writable&&d.enumerable===o.enumerable&&d.configurable===o.configurable;}));
        await page.addScriptTag({ content: require('./patch-row-entry-live.cjs')() });
        assert(await page.evaluate(()=>{const owned=DOMTokenList.prototype.contains,later=function(...args){return Reflect.apply(owned,this,args);};DOMTokenList.prototype.contains=later;__liuliRowEntryCompatibility.dispose();function llHandleAdded(){return owned.call(document.querySelector('.ml-item').classList,'ml-item');}const preserved=DOMTokenList.prototype.contains===later&&llHandleAdded();Object.defineProperty(DOMTokenList.prototype,'contains',window.originalContainsDescriptor);return preserved;}));
        report.cases.push('Compatibility guard preserves native receiver/argument semantics, descriptors, reinjection and later wrappers');
      }
      assert.deepEqual(errors, []); await page.close();
    }
    const page=await browser.newPage(); await page.setContent(fixture()); await page.addScriptTag({content:setup});await page.addScriptTag({content:background});
    await page.evaluate(()=>{window.testFocus=false;window.dispatchEvent(new Event('blur'));document.querySelector('.ml-root').lastElementChild.classList.add('ll-enter');});
    await page.waitForTimeout(80);
    const idle=await page.evaluate(()=>({finite:getComputedStyle(document.querySelector('.ll-enter')).animationPlayState,infinite:document.querySelector('.decoration').getAnimations()[0]?.playState,opacity:getComputedStyle(document.querySelector('.ll-enter')).opacity}));
    assert.equal(idle.finite,'running');assert.equal(idle.infinite,'paused');assert(Number(idle.opacity)>0);
    await page.waitForTimeout(250);assert.equal(await page.locator('.ll-enter').evaluate(node=>getComputedStyle(node).opacity),'1');
    await page.evaluate(()=>{window.testFocus=true;window.dispatchEvent(new Event('focus'));});
    assert.equal(await page.locator('.decoration').evaluate(node=>node.getAnimations()[0].playState),'running');
    report.cases.push('Unfocused visible window completes finite entry while continuous decoration pauses and resumes');
    report.background=idle;report.passed=true;await page.close();
  } catch(error) {report.error=error.stack;process.exitCode=1;}
  finally {await browser.close();fs.writeFileSync(path.join(output,'row-entry-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
