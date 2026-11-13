'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[4] || path.join(root, '../../output/playwright/message-scroll-coverage-20261113/color-idle'));
fs.mkdirSync(output, { recursive: true });
const source = fs.readFileSync(path.join(root, 'renderer/index.js'), 'utf8');
const before = fs.readFileSync(path.join(root, '../../output/playwright/message-scroll-coverage-20261113/index-color-before.js'), 'utf8');
function helper(name, text = source) { const a=text.indexOf('  function '+name+'('),b=text.indexOf('\n  }',a);assert(a>=0&&b>a,name);return text.slice(a,b+4); }
const constants=['QQ_COLOR_MAP','DIM_COLORS','TEXT_SELECTORS'].map(name=>{const a=source.indexOf('  const '+name+' = ');return source.slice(a,source.indexOf(';',a)+1);}).join('\n');
const production=`${constants}\n${['elementsWithin','topLevelRoots','createMessageColorRepair'].map(name=>helper(name)).join('\n')}`;
const legacy=`(()=>{${constants}\n${['elementsWithin','fixContrast','normalizeColors'].map(name=>helper(name,before)).join('\n')}let frame=0;const pending=new Set();window.legacyObserver=new MutationObserver(records=>{for(const record of records){const node=record.target.nodeType===1?record.target:record.target.parentElement;if(node?.closest('.chat-msg-area,.recent-contact'))pending.add(node);}if(pending.size&&!frame)frame=requestAnimationFrame(()=>{frame=0;for(const node of pending){fixContrast(node);normalizeColors(node);}pending.clear();legacyObserver.takeRecords();});});legacyObserver.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','class','id']});})();`;
const fixture=`<!doctype html><style>body{color:rgb(33,34,35);--ll-on-glass-2:#789abc;--ll-brand:#abcdef;--ll-danger:#ff0001;--ll-success:#00ff01;--ll-warn:#ffff01;--ll-link:#123abc}.chat-msg-area,.recent-contact{height:180px;overflow:auto}.row{height:30px}.inherited{color:rgb(128,128,128)}</style><div class="chat-msg-area"><div class="ml-item" id="original"><div class="message"></div></div></div><div class="recent-contact"></div>`;
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});
  const report={scope:'Production color batch and exact pre-fix color helpers in isolated Chromium; no QQ operations or FPS claims',cases:[],passed:false};
  try {
    for(const mode of ['production','legacy-bridge']) {
      const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent(fixture);
      await page.evaluate(()=>{window.reads=0;window.events=[];const native=getComputedStyle;window.getComputedStyle=(element,...rest)=>{reads++;events.push('read');return native(element,...rest);};const set=CSSStyleDeclaration.prototype.setProperty;CSSStyleDeclaration.prototype.setProperty=function(name,...rest){if(name==='color')events.push('write');return set.call(this,name,...rest);};});
      if(mode==='legacy-bridge') {await page.addScriptTag({content:legacy});await page.addScriptTag({content:require('./patch-message-color-live.cjs')()});}
      else await page.addScriptTag({content:`(()=>{${production}let observer;const repair=window.repair=createMessageColorRepair({afterWrite:()=>observer?.takeRecords()});observer=new MutationObserver(records=>{const roots=new Set();for(const record of records){const node=record.target.nodeType===1?record.target:record.target.parentElement;if(node?.closest('.chat-msg-area,.recent-contact')){repair.invalidate(node);roots.add(node);}}if(roots.size)repair.enqueue(topLevelRoots([...roots]));});observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style','class','id']});window.disposeColor=()=>{observer.disconnect();repair.dispose();};})();`});
      await settle(page);
      await page.evaluate(()=>{reads=0;events=[];document.querySelector('.chat-msg-area').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-280}));const container=document.querySelector('.message');container.innerHTML='<span id="dim" class="text-ellipsis" style="color:rgb(128,128,128)">Name</span><span id="unknown" style="color:rgb(42,43,44)">Unknown</span><span id="link" style="color:var(--ll-link)">Link</span><span id="danger" style="color:rgb(247,76,48)">Danger</span><div class="inherited" id="parent"><span id="child">Inherited</span></div>';});
      await page.waitForTimeout(75);assert.equal(await page.evaluate(()=>reads),0,mode+' read color during scroll');
      await page.evaluate(()=>{const area=document.querySelector('.chat-msg-area');area.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-280}));const dim=document.querySelector('#dim');dim.style.color='rgb(21,209,115)';dim.firstChild.data='Changed in same turn';dim.className='text-ellipsis native-updated';});
      await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>reads),0,mode+' did not reset quiet delay');
      await page.waitForTimeout(160);
      assert.equal(await page.locator('#dim').evaluate(n=>n.style.color),'var(--ll-success)');
      assert.equal(await page.locator('#danger').evaluate(n=>n.style.color),'var(--ll-danger)');
      assert.equal(await page.locator('#child').evaluate(n=>n.style.color),'var(--ll-on-glass-2)');
      assert.equal(await page.locator('#unknown').evaluate(n=>n.style.color),'rgb(42, 43, 44)');
      assert.equal(await page.locator('#link').evaluate(n=>n.style.color),'var(--ll-link)');
      const order=await page.evaluate(()=>events.filter(e=>e==='read'||e==='write'));const firstWrite=order.indexOf('write');assert(!order.slice(firstWrite+1).includes('read'),mode+' interleaved computed reads and color writes');
      report.cases.push(mode+': scrolling performs zero computed-color reads; idle maps unknown native roles and batches all reads before writes');
      await page.evaluate(()=>{reads=0;events=[];document.querySelector('.chat-msg-area').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:280}));document.querySelector('#parent').style.color='rgb(255,179,0)';});
      await page.waitForTimeout(260);assert.equal(await page.locator('#child').evaluate(n=>n.style.color),'var(--ll-warn)');
      await page.evaluate(()=>{reads=0;events=[];const unknown=document.querySelector('#unknown');unknown.style.color='rgb(0,153,255)';unknown.firstChild.data='Native link';});
      await page.waitForTimeout(100);assert.equal(await page.locator('#unknown').evaluate(n=>n.style.color),'var(--ll-brand)');
      report.cases.push(mode+': same-task native style/text/class and inherited parent edits invalidate both positive and negative caches');
      if(mode==='production') {
        await page.evaluate(()=>{reads=0;repair.repair([document.querySelector('.chat-msg-area')]);repair.repair([document.querySelector('.chat-msg-area')]);});
        assert.equal(await page.evaluate(()=>reads),0,'Unchanged positive and negative candidates were reread');
      } else {
        await page.addScriptTag({content:require('./patch-message-color-live.cjs')()});await settle(page);
        assert(await page.evaluate(()=>!!__liuliMessageColorCompatibility));
      }
      await page.evaluate(mode=>{document.querySelector('#danger').style.color='rgb(9,8,7)';if(mode==='production')disposeColor();else __liuliMessageColorCompatibility.dispose();},mode);
      assert.equal(await page.locator('#danger').evaluate(n=>n.style.color),'rgb(9, 8, 7)','Dispose overwrote a later native color');
      assert(await page.locator('.chat-msg-area').evaluate(node=>!node.querySelector('[data-liuli-color="liuli-color-deferred"],[data-liuli-fg="liuli-color-deferred"]')));
      report.cases.push(mode+': reinjection/disposal restores only owned markers and preserves later native edits');
      assert.deepEqual(errors,[]);await page.close();
    }
    report.passed=true;
  } catch(error) {report.error=error.stack;process.exitCode=1;}
  finally {await browser.close();fs.writeFileSync(path.join(output,'color-idle-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
