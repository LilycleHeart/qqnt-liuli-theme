'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.argv[4]||path.join(root,'../../output/playwright/message-scroll-coverage-20261113/overscan-browser'));
const vuePath=process.argv[5]||require.resolve('@vue/reactivity/dist/reactivity.global.prod.js');
const source=fs.readFileSync(path.join(root,'renderer/message-overscan.js'),'utf8');
const fixture=`<!doctype html><style>body{margin:0;font:14px sans-serif;background:#34313b;color:white}.chat-msg-area{height:600px;width:600px}.ml-container{height:100%;overflow:auto;display:flex;flex-direction:column-reverse}.virtual-scroll-area{height:300000px;flex-shrink:0;display:flex;flex-direction:column-reverse}.ml-list{display:flex;flex-direction:column;position:sticky;overflow:hidden;flex-shrink:0}.ml-item{box-sizing:border-box;flex:none;padding:10px 30px}.bubble{box-sizing:border-box;height:100%;max-width:300px;border-radius:12px;background:#655d75;padding:10px}</style><body><div class="chat-msg-area"><div class="ml-area chat-msg-area__vlist"><div class="ml-container"><div class="virtual-scroll-area"><div style="height:0"></div><div class="ml-list"></div></div></div></div></div></body>`;
const setup=`(()=>{
  const {ref,computed,effect}=VueReactivity;
  const area=document.querySelector('.chat-msg-area'),vlist=document.querySelector('.chat-msg-area__vlist'),scroller=document.querySelector('.ml-container'),inner=document.querySelector('.ml-list');
  vlist.style.height='100%';
  let position=0;
  const records=Array.from({length:160},(_,i)=>{const height=i%11===0?250:i%3===0?90:39;position+=height;return Object.freeze({id:String(i),msgId:String(i),height,pos:position,data:Object.freeze({msgId:String(i),chatType:2,peerUid:'peer'})});});
  const list=ref(records),range=ref({start:70,end:90}),curList=computed(()=>list.value.slice(range.value.start,range.value.end));
  const original=curList.fn;
  const owner={props:{dataKey:'msgId'},vnode:{el:vlist},exposed:{list,curList},isUnmounted:false};
  area._vnode={component:owner};
  const rows=records.map(item=>{const row=document.createElement('div');row.className='ml-item';row.id=item.id;row.style.height=item.height+'px';row.innerHTML='<div class="bubble">Message '+item.id+'</div>';return row;});
  let renders=0;
  effect(()=>{
    const projected=curList.value,total=list.value.at(-1).pos,first=projected[0],last=projected.at(-1);
    inner.replaceChildren(...projected.map(item=>rows[Number(item.id)]));
    inner.style.paddingTop=(first.pos-first.height)+'px';inner.style.paddingBottom=(total-last.pos)+'px';inner.style.bottom=-(total-area.clientHeight)+'px';renders++;
  });
  window.move=(start,end)=>{range.value={start,end};};
  window.inspect=()=>{const projected=curList.value,first=projected[0],last=projected.at(-1),total=list.value.at(-1).pos;return{ids:projected.map(item=>item.id),rows:inner.children.length,loaded:list.value.length,total,first:{id:first.id,pos:first.pos,height:first.height},last:{id:last.id,pos:last.pos},paddingTop:parseFloat(inner.style.paddingTop),paddingBottom:parseFloat(inner.style.paddingBottom),bottom:parseFloat(inner.style.bottom),listHeight:inner.getBoundingClientRect().height,hostHeight:area.clientHeight,renders,originals:[...inner.children].every(row=>rows[Number(row.id)]===row),cacheIntact:records.every((item,i)=>item.height===(i%11===0?250:i%3===0?90:39)),projectedReferences:projected.every(item=>list.value.includes(item)),getterOriginal:curList.fn===original};};
  window.nativeOwner=owner;window.nativeOriginal=original;window.current=curList;window.nativeRange=range;
})();`;
(async()=>{
  fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});
  const report={scope:'Real Vue3.5 readonly computed and captured native reverse-list projection geometry in isolated Chromium; QQ runtime validation is separate.',samples:[],passed:false};
  try{
    const page=await browser.newPage({viewport:{width:700,height:680}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setContent(fixture);await page.addScriptTag({path:vuePath});await page.addScriptTag({content:setup});
    const before=await page.evaluate(()=>window.inspect());assert.equal(before.rows,20);
    await page.addScriptTag({content:source});
    assert.equal((await page.evaluate(()=>window.inspect())).rows,20,'Install forced a native render');
    for(const[start,end]of[[72,92],[60,80],[85,105],[0,15],[145,160],[70,90]]){
      await page.evaluate(([start,end])=>window.move(start,end),[start,end]);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const value=await page.evaluate(()=>window.inspect());report.samples.push({start,end,...value});
      assert(value.rows>end-start);assert(value.rows<=end-start+96);assert.equal(value.loaded,160);assert(value.originals&&value.cacheIntact&&value.projectedReferences);
      assert.equal(value.paddingTop,value.first.pos-value.first.height);assert.equal(value.paddingBottom,value.total-value.last.pos);assert.equal(value.bottom,-(value.total-value.hostHeight));
      assert(Math.abs(value.listHeight-value.total)<.01,'Expanded native rows no longer match their native padding geometry');
    }
    const resizeBefore=await page.evaluate(()=>window.inspect());
    await page.locator('.chat-msg-area').evaluate(node=>node.style.height='900px');await page.waitForTimeout(60);
    assert.equal((await page.evaluate(()=>window.inspect())).renders,resizeBefore.renders,'RO forced a native recomputation');
    await page.evaluate(()=>window.move(71,91));const resized=await page.evaluate(()=>window.inspect());report.resized=resized;assert(resized.rows>=resizeBefore.rows);
    const calls=await page.evaluate(()=>{window.__liuliMessageOverscan.dispose();return window.inspect();});assert(calls.getterOriginal);assert.equal(calls.rows,resized.rows,'Dispose forcibly discarded cached native projection');
    await page.evaluate(()=>window.move(72,92));const disposed=await page.evaluate(()=>window.inspect());assert.equal(disposed.rows,20);assert.equal(disposed.loaded,160);report.disposed=disposed;
    await page.addScriptTag({content:source});await page.evaluate(()=>window.move(73,93));assert((await page.evaluate(()=>window.inspect())).rows>20);
    await page.evaluate(()=>{window.current.fn=()=>{window.nativeRange.value;return window.nativeOwner.exposed.list.value.slice(1,3);};window.__liuliMessageOverscan.dispose();window.move(75,95);});
    assert.deepEqual((await page.evaluate(()=>window.inspect())).ids,['1','2'],'Dispose overwrote a later native getter');
    assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,'projection.png')});report.passed=true;
  }catch(error){report.error=error.stack;process.exitCode=1;}
  finally{await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,passed:report.passed,error:report.error}));}
})();
