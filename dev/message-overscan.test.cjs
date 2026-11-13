'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vue = require(process.argv[2] || '@vue/reactivity');
const source = fs.readFileSync(path.join(__dirname, '../renderer/message-overscan.js'), 'utf8');
const record = (index, height = 100, peer = 'peer') => Object.freeze({ id: String(index), msgId: String(index),
  data: Object.freeze({ msgId: String(index), chatType: 2, peerUid: peer }), height, pos: (index + 1) * 100 });
function harness({ heights = Array(200).fill(100), height = 800, start = 80, end = 90, unsupported = false } = {}) {
  const records = heights.map((value, i) => record(i, value));
  const loaded = vue.ref(records), range = vue.ref({ start, end });
  let calls = 0, scans = 0;
  const current = vue.computed(() => { calls++;return loaded.value.slice(range.value.start, range.value.end); });
  const original = current.fn;
  if (unsupported) Object.defineProperty(current, 'fn', { value: original, writable: false });
  const area = { clientHeight: height, parentElement: null };
  const list = { nodeType: 1, isConnected: true, parentElement: area, closest: () => area };
  const owner = { props: { dataKey: 'msgId' }, vnode: { el: list }, exposed: { list: loaded, curList: current }, isUnmounted: false };
  Object.defineProperty(area, '_vnode', { get() { scans++;return { component: owner }; }, configurable: true });
  let nodes = [list], resized, mutated;
  const raf = new Map(), listeners = new Map();let nextFrame = 1;
  const document = { hidden: false, body: {}, querySelectorAll: () => nodes,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const context = { document, console, requestAnimationFrame: fn => { const id=nextFrame++;raf.set(id,fn);return id; }, cancelAnimationFrame: id => raf.delete(id),
    ResizeObserver: class { constructor(fn) { resized=fn; } observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(fn) { mutated=fn; } observe() {} disconnect() {} } };
  context.window = { addEventListener: (name, fn) => listeners.set(name,fn), removeEventListener: name => listeners.delete(name) };
  vm.createContext(context);
  const install = () => vm.runInContext(source, context);
  const flush = () => { for(const [id,fn]of [...raf]){raf.delete(id);fn();} };
  const rerange = (start, end) => { range.value = { start, end };return current.value; };
  return { context, document, area, list, owner, current, original, records, loaded, range, install, flush, rerange,
    calls: () => calls, scans: () => scans, resized: value => resized([{ target: area, contentRect: { height: value } }]),
    mutate: records => mutated(records), pending: () => raf.size, replace: replacement => { nodes=[replacement]; } };
}
test('real Vue computed keeps its cache until native dependency changes, then expands original entries both ways', () => {
  const h=harness(), before=h.current.value, saved=h.records.map(item=>({...item}));
  h.install();
  assert.equal(h.current.value,before,'Installation forced a native computed invalidation');
  const projected=h.rerange(81,91);
  assert.equal(projected[0],h.loaded.value[69]);assert.equal(projected.at(-1),h.loaded.value[102]);
  assert.equal(projected.length,34);assert.equal(h.calls(),2,'Wrapper called native getter more than once');
  assert.equal(h.loaded.value.length,200);assert.deepEqual(h.records,saved);
});
test('pixel target follows cached viewport limits without layout reads or forced recomputations', () => {
  const h=harness({height:100});h.install();const scans=h.scans();
  Object.defineProperty(h.area,'clientHeight',{get(){throw Error('Layout read during native projection');}});
  assert.equal(h.rerange(80,90).length,26,'Minimum768 reserve should add8 measured100px entries per side');
  h.resized(2000);
  assert.equal(h.current.value.length,26,'RO invalidated native computed');
  assert.equal(h.rerange(81,91).length,46,'Maximum1800 reserve should add18 entries per side');
  assert.equal(h.scans(),scans,'Projection performed another Vue tree scan');
});
test('different heights reserve enough pixels in each direction, with finite per-side caps for unknown heights', () => {
  const heights=Array.from({length:200},(_,i)=>i%3===0?240:40),h=harness({heights});h.install();
  const projected=h.rerange(80,90),first=h.loaded.value.indexOf(projected[0]),last=h.loaded.value.indexOf(projected.at(-1));
  const top=heights.slice(first,80).reduce((a,b)=>a+b,0),bottom=heights.slice(90,last+1).reduce((a,b)=>a+b,0);
  assert(top>=1200&&bottom>=1200);assert(top-heights[first]<1200);assert(bottom-heights[last]<1200);
  const unknown=harness({heights:Array(200).fill(NaN)});unknown.install();
  const capped=unknown.rerange(80,90);assert.equal(capped.length,106);assert.equal(capped[0],unknown.loaded.value[32]);assert.equal(capped.at(-1),unknown.loaded.value[137]);
});
test('scope guards reject noncontiguous native projections and stop at foreign peer entries', () => {
  const disjoint=harness();
  disjoint.current.fn=()=>{disjoint.range.value;return [disjoint.loaded.value[80],disjoint.loaded.value[82]];};
  disjoint.install();
  const untouched=disjoint.rerange(81,91);assert.equal(untouched.length,2);assert.equal(untouched[0],disjoint.loaded.value[80]);assert.equal(untouched[1],disjoint.loaded.value[82]);
  const h=harness();h.install();
  h.loaded.value=[...h.records.slice(0,79),record(79,100,'foreign'),...h.records.slice(80,91),record(91,100,'foreign'),...h.records.slice(92)];
  assert.equal(h.rerange(80,90).length,11,'Projection crossed a peer boundary');
  const native=h.current.fn;h.owner.exposed.curList=h.current;
  h.current.fn=function(){return [h.loaded.value[80],h.loaded.value[82]];};
  h.context.window.__liuliMessageOverscan.dispose();assert.notEqual(h.current.fn,native,'Disposal overwrote a newer native getter');
});
test('unsupported refs noop; hidden projection stays native; disposal and reentry preserve the host getter', () => {
  const unsupported=harness({unsupported:true});unsupported.install();assert.equal(unsupported.current.fn,unsupported.original);assert.equal(unsupported.rerange(81,91).length,10);
  const h=harness();h.install();const wrapper=h.current.fn;h.install();assert.notEqual(h.current.fn,wrapper);
  h.document.hidden=true;assert.equal(h.rerange(81,91).length,10);
  h.document.hidden=false;assert.equal(h.rerange(82,92).length,34);
  h.resized(0);assert.equal(h.rerange(83,93).length,10,'A zero-height hidden pane retained an extra window');
  h.resized(800);assert.equal(h.rerange(82,92).length,34);
  const cached=h.current.value;h.context.window.__liuliMessageOverscan.dispose();
  assert.equal(h.current.fn,h.original);assert.equal(h.current.value,cached,'Dispose touched computed dirty flags/cache');
  assert.equal(h.rerange(83,93).length,10);
});
test('normal row churn does not schedule component discovery, and detached lists restore their getter', () => {
  const h=harness();h.install();const scans=h.scans();
  const row={nodeType:1,matches:selector=>selector.includes('.ml-item')};
  h.mutate([{target:{closest:()=>h.list},addedNodes:[row],removedNodes:[]}]);h.flush();
  assert.equal(h.scans(),scans);assert.equal(h.pending(),0);
  const replacement=harness();
  h.list.isConnected=false;h.replace(replacement.list);
  h.context.window.__liuliMessageOverscan.refresh();h.flush();assert.equal(h.current.fn,h.original);
  assert.notEqual(replacement.current.fn,replacement.original);assert.equal(replacement.rerange(81,91).length,34);
  h.context.window.__liuliMessageOverscan.dispose();assert.equal(replacement.current.fn,replacement.original);
});
