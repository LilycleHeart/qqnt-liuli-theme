'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/qq.js'), 'utf8');
function helper(name) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  }', start);
  assert(start >= 0 && end > start);
  return source.slice(start, end + 4);
}
const record = (msgId, peerUid = 'p', senderUid = 's') => Object.freeze({ msgId, chatType: 2, peerUid, senderUid, msgTime: 1000 });
const entry = data => Object.freeze({ id: data.msgId, msgId: data.msgId, data, height: 39, pos: 39 });
function harness(records, asRef = true) {
  const area = { closest: () => area, querySelector: () => list, parentElement: null };
  const list = { nodeType: 1, closest: () => area, parentElement: area };
  const state = { value: records.map(entry) };
  const owner = { props: { dataKey: 'msgId' }, vnode: { el: list }, exposed: { msgs: asRef ? state : state.value }, isUnmounted: false };
  // Real _vnode traversal, with no debugger's __VUE__ property anywhere.
  area._vnode = { children: [{ component: owner }] };
  const context = { console };
  vm.createContext(context);
  vm.runInContext('const messageSequenceOwners=new WeakMap();\n' + ['visitComponents', 'messagePeer', 'loadedMessageSequence'].map(helper).join('\n') + '\nglobalThis.read=loadedMessageSequence;', context);
  return { area, list, owner, state, read: () => context.read(area) };
}
test('reads complete exposed msgs through _vnode without debugger mapping or native calls', () => {
  const records = ['a', 'b', 'c'].map(id => record(id));
  const h = harness(records);
  h.owner.exposed.curMsgs = { value: [h.state.value[1]] };
  h.owner.exposed.resetStates = () => { throw Error('Native method called'); };
  const snapshot = h.read();
  assert.equal(snapshot.entries.length, 3);
  const neighbors = snapshot.neighbors(records[1]);
  assert.equal(neighbors.previous, records[0]); assert.equal(neighbors.next, records[2]);
  assert.equal(h.state.value[1].height, 39); assert.equal(h.state.value[1].pos, 39);
});
test('supports exposed arrays and validates recycled record peer/sender', () => {
  const records = ['a', 'b', 'c'].map(id => record(id));
  const h = harness(records, false), snapshot = h.read();
  assert.equal(snapshot.neighbors({ ...records[1] }).previous, records[0]);
  assert.equal(snapshot.neighbors(record('b', 'other-peer')), null);
  assert.equal(snapshot.neighbors(record('b', 'p', 'other-sender')), null);
  assert.equal(snapshot.neighbors({ msgId: 'b', senderUid: 's' }), null);
});
test('takes a fresh source snapshot after deletion, replacement and reordering', () => {
  const records = ['a', 'b', 'c'].map(id => record(id));
  const h = harness(records);
  assert.equal(h.read().neighbors(records[1]).previous, records[0]);
  h.state.value = [entry(records[1]), entry(records[2])];
  assert.equal(h.read().neighbors(records[1]).previous, null);
  h.state.value = [entry(records[2]), entry(records[1])];
  assert.equal(h.read().neighbors(records[1]).previous, records[2]);
  h.state.value = [entry(records[2])];
  assert.equal(h.read().neighbors(records[1]), null);
});
test('keeps malformed entries as adjacency barriers and rejects duplicate IDs', () => {
  const records = ['a', 'b', 'c'].map(id => record(id));
  const h = harness(records);
  h.state.value[1] = { id: 'unknown', msgId: 'unknown', data: { msgId: 'mismatch' } };
  assert.equal(h.read().entries.length, 3);
  assert.equal(h.read().neighbors(records[2]).previous, null);
  h.state.value = [entry(records[0]), entry(records[0]), entry(records[2])];
  assert.equal(h.read().neighbors(records[0]), null);
});
test('ignores hidden panes and replaces cached owners when the native list remounts', () => {
  const records = ['a', 'b'].map(id => record(id));
  const h = harness(records), otherList = { nodeType: 1 };
  const foreign = { props: { dataKey: 'msgId' }, vnode: { el: otherList }, exposed: { msgs: [entry(record('x', 'foreign'))] } };
  h.area._vnode.children.unshift({ component: foreign });
  assert.equal(h.read().entries[0].record, records[0]);
  h.owner.isUnmounted = true;
  const replacement = { props: { dataKey: 'msgId' }, vnode: { el: h.list }, exposed: { msgs: [entry(records[1])] } };
  h.area._vnode.children.push({ component: replacement });
  assert.equal(h.read().entries.length, 1);
  assert.equal(h.read().entries[0].record, records[1]);
  replacement.isUnmounted = true;
  assert.equal(h.read(), null);
});
