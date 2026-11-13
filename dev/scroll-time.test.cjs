'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { messageDate, formatDate, bottomVisible, peerKey, nativeTime, characterChanges } = require('../renderer/scroll-time.js');

test('QQ msgTime接受秒/毫秒，缺失或无效值不会伪造日期', () => {
  const now = new Date(2026, 10, 12, 18, 25, 0);
  assert.equal(messageDate(String(now.getTime() / 1000)).getTime(), now.getTime());
  assert.equal(messageDate(now.getTime()).getTime(), now.getTime());
  for (const value of [undefined, null, '', '23:16', 'yesterday', 0, -1, Infinity, 'NaN']) assert.equal(messageDate(value), null);
});

test('同日显示时分，跨天显示日期，跨年补全年份', () => {
  const now = new Date(2026, 10, 12, 18, 25);
  assert.equal(formatDate(new Date(2026, 10, 12, 8, 5), now), '08:05');
  assert.equal(formatDate(new Date(2026, 10, 11, 23, 16), now), '11月11日 23:16');
  assert.equal(formatDate(new Date(2025, 10, 11, 23, 16), now), '2025年11月11日 23:16');
});

test('只选择视口最底可见行，排除旧虚拟行、隐藏行及零尺寸节点', () => {
  const viewport = { top: 100, bottom: 500, left: 20, right: 400 };
  const row = (id, top, bottom, extra = {}) => ({ id, visible: true,
    rect: { top, bottom, left: 20, right: 400, width: 380, height: bottom - top }, ...extra });
  const rows = [row('first', 80, 200), row('last-full', 200, 450), row('bottom-partial', 450, 600),
    row('old-virtual', -9000, -8900), row('future-virtual', 9000, 9100), row('hidden', 490, 510, { visible: false }),
    row('zero', 490, 490)];
  assert.equal(bottomVisible(rows, viewport).id, 'bottom-partial');
  assert.equal(bottomVisible([rows[3], rows[4], rows[5], rows[6]], viewport), null);
});

test('会话键区分聊天类型；原生fallback只保留本消息已有时间标签', () => {
  assert.notEqual(peerKey({ chatType: 1, peerUid: 'same' }), peerKey({ chatType: 2, peerUid: 'same' }));
  assert.equal(peerKey(null), '');
  const node = text => ({ querySelector: selector => selector.includes('.message__timestamp .babble') ? { textContent: text } : null });
  assert.equal(nativeTime(node('23:16')), '23:16');
  assert.equal(nativeTime(node('2025年11月11日 23:16')), '2025年11月11日 23:16');
  assert.equal(nativeTime(node('')), '');
  assert.equal(nativeTime(node('not a timestamp')), '');
});

test('逐字翻页只更新变化字符，保留未变化的数字、冒号和日期后缀', () => {
  const changed = (before, after) => characterChanges(before, after).filter(cell => cell.previous !== cell.current);
  assert.deepEqual(changed('09:59', '10:00'), [
    { previous: '0', current: '1' }, { previous: '9', current: '0' },
    { previous: '5', current: '0' }, { previous: '9', current: '0' }
  ]);
  assert.deepEqual(changed('00:48', '00:49'), [{ previous: '8', current: '9' }]);
  for (const [before, after] of [['00:48', '11月12日 00:48'], ['11月12日 00:48', '00:48'], ['00:48', '00:48']]) {
    const cells = characterChanges(before, after);
    assert.equal(cells.map(cell => cell.previous).join(''), before);
    assert.equal(cells.map(cell => cell.current).join(''), after);
  }
});
