(() => {
  const ID = 'liuli-scroll-time';
  const KEY = '__liuliScrollTime';
  const SCROLL_SETTLE_MS = 350;
  const IDLE_MS = 900;
  const FADE_MS = 180;
  const FLIP_MS = 180;
  const MAX_FLIP_MS = 720;
  const HOVER_MS = 500;
  const LEAVE_MS = 1000;
  const BUBBLE = '.message-content__wrapper, .msg-content-container, .forward-msg, .file-message--content';

  function messageDate(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    const date = new Date(number >= 1e11 ? number : number * 1000);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatDate(date, now = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const time = pad(date.getHours()) + ':' + pad(date.getMinutes());
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()) return time;
    const day = (date.getMonth() + 1) + '月' + date.getDate() + '日';
    return (date.getFullYear() === now.getFullYear() ? '' : date.getFullYear() + '年') + day + ' ' + time;
  }

  function bottomVisible(entries, viewport) {
    let best = null;
    for (const entry of entries) {
      const rect = entry.rect;
      if (!entry.visible || rect.width <= 0 || rect.height <= 0 || rect.bottom <= viewport.top ||
          rect.top >= viewport.bottom || rect.right <= viewport.left || rect.left >= viewport.right) continue;
      const edge = Math.min(rect.bottom, viewport.bottom);
      if (!best || edge > best.edge || (edge === best.edge && rect.top > best.rect.top)) best = { ...entry, edge };
    }
    return best;
  }

  function peerKey(record) {
    return record && (record.peerUid || record.peerUin)
      ? String(record.chatType ?? '') + ':' + String(record.peerUid || record.peerUin) : '';
  }

  function nativeTime(message) {
    // Preserve QQ's exact label, including any date it supplies. A bare HH:mm
    // does not provide a date, so never attach an inferred day to that fallback.
    const text = message.querySelector('.only-time .send-time, .user-name > .send-time, .message__timestamp .babble')?.textContent?.trim();
    return text && text.length <= 64 && /\d{1,2}[:：]\d{2}/.test(text) ? text : '';
  }

  function characterChanges(previous, next) {
    const before = Array.from(previous);
    const after = Array.from(next);
    let prefix = 0;
    let suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix &&
           before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
    const cells = after.slice(0, prefix).map(char => ({ previous: char, current: char }));
    const beforeMiddle = before.slice(prefix, before.length - suffix);
    const afterMiddle = after.slice(prefix, after.length - suffix);
    const count = Math.max(beforeMiddle.length, afterMiddle.length);
    for (let index = 0; index < count; index++) {
      cells.push({ previous: beforeMiddle[index] || '', current: afterMiddle[index] || '' });
    }
    if (suffix) for (const char of after.slice(-suffix)) cells.push({ previous: char, current: char });
    return cells;
  }

  function install(win, doc) {
    let area = null;
    let scroller = null;
    let pill = null;
    let intersection = null;
    let localObserver = null;
    let resizeObserver = null;
    let rows = new Set();
    const visible = new Set();
    let visibleOrdered = [];
    const visibleOrderedSet = new Set();
    const rowGeometry = new Map();
    const visibilityDirty = new Set();
    const pendingRows = new Set();
    let rowsInitialized = false;
    let geometryDirty = true;
    let viewportBox = null;
    let frame = 0;
    let discoveryFrame = 0;
    let settleTimer = 0;
    let idleTimer = 0;
    let clearTimer = 0;
    let active = false;
    let scrolling = false;
    let hoveredRow = null;
    let pendingHoverRow = null;
    let hoverTimer = 0;
    let leaveTimer = 0;
    let value = null;
    let flipTimer = 0;
    let animations = [];
    let labelShown = '';
    let disposed = false;
    let peer = '';
    let rowsDirty = false;

    const isVisible = (element, measured, ignoreOpacity = false) => {
      if (!element?.isConnected) return false;
      const rect = measured || element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (typeof element.checkVisibility === 'function')
        return element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: !ignoreOpacity });
      const style = win.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const recordOf = row => {
      try { return win.LiuliQQ?.messageRecord(row) || null; } catch { return null; }
    };
    function stopFlip() {
      win.clearTimeout(flipTimer);
      for (const animation of animations) animation.cancel();
      animations = [];
      if (value) value.textContent = labelShown;
      pill?.classList.remove('is-flipping');
    }
    function setLabel(label, animate) {
      if (label === labelShown) return;
      const previous = labelShown;
      stopFlip();
      labelShown = label;
      const element = ensurePill();
      if (!value) {
        value = doc.createElement('span');
        value.className = 'liuli-time-value';
        element.appendChild(value);
      }
      value.textContent = label;
      element.dataset.time = label;
      element.setAttribute('aria-label', label);
      if (!animate || !previous || win.matchMedia('(prefers-reduced-motion: reduce)').matches ||
          typeof value.animate !== 'function') return;
      const cells = characterChanges(previous, label);
      const changed = cells.filter(cell => cell.previous !== cell.current).length;
      const duration = Math.min(FLIP_MS, MAX_FLIP_MS / changed);
      value.replaceChildren();
      const half = (parent, position, face, text) => {
        const node = doc.createElement('span');
        node.className = 'liuli-time-half is-' + position + ' is-' + face;
        const line = doc.createElement('span');
        line.textContent = text || '\u00a0';
        node.appendChild(line);
        parent.appendChild(node);
        return node;
      };
      let order = 0;
      for (const cell of cells) {
        const glyph = doc.createElement('span');
        glyph.className = 'liuli-time-char';
        const ink = doc.createElement('span');
        ink.className = 'liuli-time-char-value';
        ink.textContent = cell.current || cell.previous;
        glyph.appendChild(ink);
        value.appendChild(glyph);
        if (cell.previous === cell.current) continue;
        glyph.classList.add('is-flipping');
        const flip = doc.createElement('span');
        flip.className = 'liuli-time-flip';
        flip.setAttribute('aria-hidden', 'true');
        glyph.appendChild(flip);
        half(flip, 'top', 'back', cell.current);
        half(flip, 'bottom', 'back', cell.previous);
        const top = half(flip, 'top', 'front', cell.previous);
        const bottom = half(flip, 'bottom', 'front', cell.current);
        const delay = order++ * duration;
        glyph.dataset.flipOrder = String(order);
        animations.push(
          top.animate([{ transform: 'rotateX(0deg)', filter: 'brightness(1)' },
            { transform: 'rotateX(-90deg)', filter: 'brightness(.82)' }],
            { duration: duration / 2, delay, easing: 'ease-in', fill: 'both' }),
          bottom.animate([{ transform: 'rotateX(90deg)', filter: 'brightness(.82)' },
            { transform: 'rotateX(0deg)', filter: 'brightness(1)' }],
            { duration: duration / 2, delay: delay + duration / 2, easing: 'ease-out', fill: 'both' })
        );
      }
      element.classList.add('is-flipping');
      flipTimer = win.setTimeout(stopFlip, changed * duration);
    }
    function compareRows(a, b) {
      const position = a.compareDocumentPosition(b);
      if (position & win.Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & win.Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    }
    function setOrderedVisible(row, isVisible) {
      const previous = visibleOrderedSet.has(row);
      if (previous === isVisible) return;
      if (!isVisible) {
        visibleOrderedSet.delete(row);
        const index = visibleOrdered.indexOf(row);
        if (index >= 0) visibleOrdered.splice(index, 1);
        return;
      }
      let low = 0, high = visibleOrdered.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareRows(row, visibleOrdered[middle]) < 0) high = middle;
        else low = middle + 1;
      }
      visibleOrdered.splice(low, 0, row);
      visibleOrderedSet.add(row);
    }
    function messagesWithin(node) {
      if (node?.nodeType !== 1) return [];
      const result = node.matches('.message') ? [node] : [];
      result.push(...(node.querySelectorAll?.('.message') || []));
      return result;
    }
    const previousStyle = doc.createElement('i').style;
    function styleChangesVisibility(record) {
      if (record.attributeName !== 'style') return false;
      previousStyle.cssText = record.oldValue || '';
      return ['display', 'visibility'].some(property =>
        previousStyle.getPropertyValue(property) !== record.target.style.getPropertyValue(property) ||
        previousStyle.getPropertyPriority(property) !== record.target.style.getPropertyPriority(property)
      );
    }
    function addRow(row) {
      if (rows.has(row)) return;
      rows.add(row);
      if (intersection) {
        visibilityDirty.add(row);
        intersection.observe(row);
      }
      if (!intersection) {
        const rect = row.getBoundingClientRect();
        const isRowVisible = isVisible(row, rect);
        rowGeometry.set(row, { rect, visible: isRowVisible });
        if (isRowVisible) visible.add(row);
      }
    }
    function removeRow(row) {
      intersection?.unobserve(row);
      rows.delete(row);
      visibilityDirty.delete(row);
      visible.delete(row);
      setOrderedVisible(row, false);
      rowGeometry.delete(row);
    }
    function ensurePill() {
      if (pill) return pill;
      pill = doc.createElement('div');
      pill.id = ID;
      pill.className = 'liuli-scroll-time';
      pill.setAttribute('aria-hidden', 'true');
      // This transient reading aid must not announce every scroll to AT.
      pill.setAttribute('aria-live', 'off');
      doc.body.appendChild(pill);
      return pill;
    }
    function hide(immediate = false, keepPendingHover = false) {
      active = false;
      scrolling = false;
      hoveredRow = null;
      if (!keepPendingHover) {
        pendingHoverRow = null;
        win.clearTimeout(hoverTimer);
      }
      win.clearTimeout(leaveTimer);
      leaveTimer = 0;
      stopFlip();
      win.clearTimeout(settleTimer);
      settleTimer = 0;
      win.clearTimeout(idleTimer);
      win.clearTimeout(clearTimer);
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0;
      if (!pill) return;
      pill.classList.remove('is-active');
      pill.setAttribute('aria-hidden', 'true');
      const clear = () => {
        if (!active && pill) {
          pill.replaceChildren();
          pill.dataset.time = '';
          pill.removeAttribute('aria-label');
          value = null;
          labelShown = '';
        }
      };
      if (immediate || win.matchMedia('(prefers-reduced-motion: reduce)').matches) clear();
      else clearTimer = win.setTimeout(clear, FADE_MS);
    }
    function syncRows(box = viewport()) {
      if (!scroller) return;
      if (!rowsInitialized) {
        for (const row of scroller.querySelectorAll('.message')) addRow(row);
        rowsInitialized = true;
      } else if (rowsDirty) {
        for (const row of pendingRows) {
          if (row.isConnected && scroller.contains(row)) addRow(row);
          else removeRow(row);
        }
        visibleOrdered.sort(compareRows);
      }
      pendingRows.clear();
      rowsDirty = false;
    }
    function viewport(measuredArea) {
      const parent = measuredArea || area.getBoundingClientRect();
      const box = scroller === area ? parent : scroller.getBoundingClientRect();
      return { left: Math.max(0, box.left, parent.left), right: Math.min(win.innerWidth, box.right, parent.right),
        top: Math.max(0, box.top, parent.top), bottom: Math.min(win.innerHeight, box.bottom, parent.bottom) };
    }
    function update(settledScroll = false) {
      frame = 0;
      if (!active || disposed) return;
      if (!area?.isConnected || !scroller?.isConnected || doc.hidden || area.hasAttribute('data-ll-switching')) {
        hide(true);
        scheduleDiscovery();
        return;
      }
      if (geometryDirty || !viewportBox) {
        const areaRect = area.getBoundingClientRect();
        if (!isVisible(area, areaRect)) { hide(true); return; }
        viewportBox = viewport(areaRect);
        geometryDirty = false;
      }
      const box = viewportBox;
      // Newly mounted rows may not have delivered their first IO entry.
      const useSnapshot = !intersection || (settledScroll && rowsDirty);
      if (rowsDirty) syncRows(box);
      if (hoveredRow && (!scroller.contains(hoveredRow) ||
          (intersection ? rowGeometry.get(hoveredRow)?.visible === false : !isVisible(hoveredRow)))) hoveredRow = null;
      if (!hoveredRow && !settledScroll) { hide(); return; }
      const entries = [];
      if (useSnapshot && !hoveredRow) {
        for (const row of rows) {
          if (!scroller.contains(row)) continue;
          const rect = row.getBoundingClientRect();
          if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) continue;
          entries.push({ row, rect, visible: isVisible(row, rect, !!intersection) });
        }
      }
      // QQ keeps message DOM order in visual chronology even though its scroll
      // container is column-reverse. IO tells us which rows intersect; the last
      // of those in DOM order is the bottom message. It needs no scrollTop or
      // rect read between the native layout and its next paint.
      const bottom = useSnapshot ? bottomVisible(entries, box)?.row : visibleOrdered.at(-1);
      const selected = hoveredRow || bottom;
      if (!selected) { hide(true); return; }
      const record = recordOf(selected);
      const nextPeer = peerKey(record);
      if (peer && nextPeer && peer !== nextPeer) {
        peer = nextPeer;
        hide(true);
        return;
      }
      if (nextPeer) peer = nextPeer;
      const date = messageDate(record?.msgTime);
      const label = date ? formatDate(date) : nativeTime(selected);
      if (!label) { hide(true); return; }
      const element = ensurePill();
      setLabel(label, !settledScroll && element.classList.contains('is-active'));
      const left = (box.left + box.right) / 2 + 'px', top = box.top + 10 + 'px';
      if (element.style.left !== left) element.style.left = left;
      if (element.style.top !== top) element.style.top = top;
      element.classList.add('is-active');
      element.setAttribute('aria-hidden', 'false');
    }
    function schedule() {
      if (active && hoveredRow && !scrolling && !frame) frame = win.requestAnimationFrame(() => update());
    }
    function onScroll() {
      if (disposed || doc.hidden || !area?.isConnected || area.hasAttribute('data-ll-switching')) { hide(true); return; }
      if (!scrolling) {
        hoveredRow = pendingHoverRow = null;
        win.clearTimeout(hoverTimer);
        win.clearTimeout(leaveTimer);
        leaveTimer = 0;
        win.clearTimeout(clearTimer);
        win.clearTimeout(idleTimer);
        scrolling = active = true;
      }
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0;
      win.clearTimeout(settleTimer);
      settleTimer = win.setTimeout(() => {
        settleTimer = 0;
        frame = win.requestAnimationFrame(() => {
          scrolling = false;
          update(true);
          if (active) idleTimer = win.setTimeout(() => { if (!hoveredRow) hide(); }, IDLE_MS);
        });
      }, SCROLL_SETTLE_MS);
    }
    function hoveredMessage(target) {
      const bubble = target?.closest?.(BUBBLE);
      const row = bubble?.closest('.message');
      return row && area?.contains(bubble) && scroller?.contains(row) ? row : null;
    }
    function setHover(row) {
      if (scrolling || row === pendingHoverRow) return;
      pendingHoverRow = row;
      win.clearTimeout(hoverTimer);
      if (row && row === hoveredRow) {
        win.clearTimeout(leaveTimer);
        leaveTimer = 0;
        return;
      }
      if (hoveredRow && !leaveTimer) {
        leaveTimer = win.setTimeout(() => {
          leaveTimer = 0;
          hoveredRow = null;
          hide(false, !!pendingHoverRow);
        }, LEAVE_MS);
      }
      if (!row) return;
      hoverTimer = win.setTimeout(() => {
        if (row !== pendingHoverRow || !scroller?.contains(row)) return;
        win.clearTimeout(leaveTimer);
        leaveTimer = 0;
        hoveredRow = row;
        active = true;
        win.clearTimeout(clearTimer);
        schedule();
      }, HOVER_MS);
    }
    function onPointerOver(event) {
      if (event.pointerType === 'touch' || disposed || doc.hidden || area?.hasAttribute('data-ll-switching')) return;
      setHover(hoveredMessage(event.target));
    }
    function onPointerOut(event) {
      if (event.pointerType !== 'touch') setHover(hoveredMessage(event.relatedTarget));
    }
    function onPointerLeave() { setHover(null); }
    function detach() {
      hide(true);
      scroller?.removeEventListener('scroll', onScroll);
      area?.removeEventListener('pointerover', onPointerOver);
      area?.removeEventListener('pointermove', onPointerOver);
      area?.removeEventListener('pointerout', onPointerOut);
      area?.removeEventListener('pointerleave', onPointerLeave);
      intersection?.disconnect();
      localObserver?.disconnect();
      resizeObserver?.disconnect();
      intersection = localObserver = resizeObserver = null;
      rows.clear();
      visible.clear();
      visibleOrdered = [];
      visibleOrderedSet.clear();
      rowGeometry.clear();
      visibilityDirty.clear();
      pendingRows.clear();
      rowsInitialized = false;
      geometryDirty = true;
      viewportBox = null;
      area = scroller = null;
      peer = '';
    }
    function discover() {
      discoveryFrame = 0;
      if (disposed || !doc.body) return;
      const nextArea = [...doc.querySelectorAll('.chat-msg-area')].find(isVisible) || null;
      const nextScroller = nextArea && (nextArea.querySelector('.chat-msg-area__vlist .q-scroll-view') ||
        nextArea.querySelector('.chat-msg-area__vlist') || nextArea);
      if (nextArea === area && nextScroller === scroller) return;
      detach();
      if (!nextScroller) { watchStructure(); return; }
      area = nextArea;
      scroller = nextScroller;
      scroller.addEventListener('scroll', onScroll, { passive: true });
      area.addEventListener('pointerover', onPointerOver, { passive: true });
      area.addEventListener('pointermove', onPointerOver, { passive: true });
      area.addEventListener('pointerout', onPointerOut, { passive: true });
      area.addEventListener('pointerleave', onPointerLeave, { passive: true });
      if (typeof win.IntersectionObserver === 'function') {
        intersection = new win.IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!rows.has(entry.target)) {
              visible.delete(entry.target);
              rowGeometry.delete(entry.target);
              setOrderedVisible(entry.target, false);
              continue;
            }
            const rect = entry.boundingClientRect;
            const previous = rowGeometry.get(entry.target);
            const shouldCheckVisibility = entry.isIntersecting &&
              (!previous || visibilityDirty.has(entry.target));
            if (shouldCheckVisibility) visibilityDirty.delete(entry.target);
            const cssVisible = shouldCheckVisibility
              ? isVisible(entry.target, rect, true)
              : previous?.cssVisible ?? true;
            const isRowVisible = entry.isIntersecting && cssVisible;
            rowGeometry.set(entry.target, { rect: { top: rect.top, bottom: rect.bottom,
              left: rect.left, right: rect.right, width: rect.width, height: rect.height },
              // A delayed message entry can be at opacity zero in the first
              // IO delivery. Opacity later changing alone does not redeliver IO,
              // so it must not permanently disqualify an intersecting row.
              visible: isRowVisible, cssVisible });
            if (entry.isIntersecting && entry.intersectionRatio > 0) visible.add(entry.target);
            else visible.delete(entry.target);
            setOrderedVisible(entry.target, entry.isIntersecting && entry.intersectionRatio > 0 &&
              isRowVisible);
          }
          schedule();
        }, { root: scroller, threshold: [0, 0.001] });
      }
      const box = viewport();
      viewportBox = box;
      geometryDirty = false;
      syncRows(box);
      const initial = bottomVisible([...visible].map(row => ({ row, rect: rowGeometry.get(row)?.rect,
        visible: true })), box);
      peer = peerKey(recordOf(initial?.row));
      localObserver = new win.MutationObserver(records => {
        let shouldUpdate = false;
        const visibilityChanged = new Set();
        for (const record of records) {
          if (record.type === 'attributes') {
            const target = record.target;
            if (target === area && record.attributeName === 'data-ll-switching') {
              if (area.hasAttribute('data-ll-switching')) hide(true);
              shouldUpdate = true;
              continue;
            }
            if ((target === area || target === scroller) && ['class', 'style'].includes(record.attributeName)) {
              geometryDirty = true;
              shouldUpdate = true;
              if (record.attributeName === 'class' || styleChangesVisibility(record)) {
                for (const row of rows) visibilityChanged.add(row);
              }
              continue;
            }
            const wrapper = target.matches?.('.ml-item') ? target : target.closest?.('.ml-item');
            const row = target.matches?.('.message') ? target : wrapper?.querySelector('.message');
            if (row && rows.has(row) && (target === row || target === wrapper) && record.attributeName === 'id') {
              shouldUpdate = true;
              continue;
            }
            if (row && rows.has(row) && (target === row || target === wrapper) &&
                (record.attributeName === 'class' || styleChangesVisibility(record))) {
              visibilityChanged.add(row);
              shouldUpdate = true;
            }
            continue;
          }
          if (record.type === 'childList') {
            for (const node of [...record.addedNodes, ...record.removedNodes]) {
              const affected = messagesWithin(node);
              if (!affected.length) continue;
              rowsDirty = true;
              shouldUpdate = true;
              for (const row of affected) pendingRows.add(row);
            }
          } else if (record.type === 'characterData' && record.target.parentElement?.closest('.message')) {
            shouldUpdate = true;
          }
        }
        if (intersection) {
          // Descendant transforms and colors do not change row eligibility.
          for (const row of visibilityChanged) {
            visibilityDirty.add(row);
            intersection.unobserve(row);
            intersection.observe(row);
          }
        }
        if (!scroller?.isConnected) scheduleDiscovery();
        if (active && shouldUpdate) schedule();
      });
      localObserver.observe(area, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'id', 'data-ll-switching'], attributeOldValue: true, characterData: true });
      if (typeof win.ResizeObserver === 'function') {
        resizeObserver = new win.ResizeObserver(entries => {
          geometryDirty = true;
          if (entries.some(entry => entry.contentRect.width <= 0 || entry.contentRect.height <= 0)) hide(true);
          else schedule();
        });
        resizeObserver.observe(scroller);
      }
      watchStructure();
    }
    function scheduleDiscovery() {
      if (!disposed && !discoveryFrame) discoveryFrame = win.requestAnimationFrame(discover);
    }
    const structureObserver = new win.MutationObserver(records => {
      if (!scroller?.isConnected) { hide(true); scheduleDiscovery(); return; }
      const touchesArea = records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
        (node.matches('.chat-msg-area, .chat-msg-area__vlist') || node.querySelector('.chat-msg-area, .chat-msg-area__vlist'))));
      if (touchesArea) scheduleDiscovery();
    });
    function watchStructure() {
      structureObserver.disconnect();
      if (!area?.isConnected) {
        structureObserver.observe(doc, { childList: true, subtree: true });
        return;
      }
      // Only ancestors can remove or replace the current message area. Once
      // attached, sidebar rows and our flipping time glyphs need no discovery
      // work; message-subtree replacements are handled by localObserver.
      for (let node = area; node; node = node.parentNode) structureObserver.observe(node, { childList: true });
    }
    watchStructure();
    function onSwitch(event) {
      if (event.target?.closest?.('.recent-contact, .recent-contact-item')) hide(true);
    }
    function onRoute() { detach(); scheduleDiscovery(); }
    function onResize() { geometryDirty = true; schedule(); }
    function onVisibility() { hide(true); if (!doc.hidden) scheduleDiscovery(); }
    function dispose() {
      if (disposed) return;
      disposed = true;
      detach();
      structureObserver.disconnect();
      if (discoveryFrame) win.cancelAnimationFrame(discoveryFrame);
      doc.removeEventListener('pointerdown', onSwitch, true);
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('blur', onVisibility);
      win.removeEventListener('liuli-route', onRoute);
      win.removeEventListener('hashchange', onRoute);
      win.removeEventListener('pagehide', dispose);
      pill?.remove();
      pill = null;
      if (win[KEY] === api) {
        delete win[KEY];
        doc.body?.removeAttribute('data-liuli-scroll-time');
      }
    }
    const api = { refresh: scheduleDiscovery, dispose };
    doc.addEventListener('pointerdown', onSwitch, true);
    doc.addEventListener('visibilitychange', onVisibility);
    win.addEventListener('resize', onResize, { passive: true });
    win.addEventListener('blur', onVisibility);
    win.addEventListener('liuli-route', onRoute);
    win.addEventListener('hashchange', onRoute);
    win.addEventListener('pagehide', dispose, { once: true });
    scheduleDiscovery();
    return api;
  }

  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { messageDate, formatDate, bottomVisible, peerKey, nativeTime, characterChanges };
    return;
  }
  window[KEY]?.dispose();
  const setEnabled = enabled => {
    if (enabled === true) {
      document.body.toggleAttribute('data-liuli-scroll-time', true);
      window[KEY] ??= install(window, document);
    } else {
      window[KEY]?.dispose();
      document.body.removeAttribute('data-liuli-scroll-time');
    }
  };
  window.LiuliScrollTime = { setEnabled };
})();
