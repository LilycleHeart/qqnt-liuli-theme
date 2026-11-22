(() => {
  'use strict';
  const key = '__liuliAvatarCompactTrack';
  window[key]?.dispose();
  window.__liuliAvatarSticky?.dispose?.();
  for (const avatar of document.querySelectorAll('.chat-msg-area .avatar-span[data-liuli-ty]')) {
    delete avatar.dataset.liuliTy;
    avatar.style.removeProperty('transform');
  }
  if (!window.ResizeObserver || !window.IntersectionObserver) return;
  // Batch invalidations after layout; native CSS sticky handles scroll without a JS scroll listener.
  const pulse = document.createElement('span');
  pulse.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1px;height:1px;visibility:hidden;pointer-events:none';
  const scrollerSelector = '.chat-msg-area #ml-root';
  const mode = () => document.body.dataset.liuliAvatarPosition === 'bottom' && document.body.dataset.liuliChatStyle;
  const maxSampleRetries = 3;
  const stats = { passes: 0, fullPasses: 0, rowsInspected: 0, reused: 0, requested: 0, abandoned: 0, measures: 0, updates: 0, clears: 0, writes: 0 };
  const tracks = new Map(), pending = new Map(), dirty = new Set();
  const candidates = new Map(), owners = new WeakMap(), measured = new Set();
  // Row identity survives virtual-list recycling only through its id, so the
  // resolved host/bubble pair is cached per row and revalidated by id plus a
  // cheap ancestor check. Grouping is re-read every pass because index.js
  // rewrites it without touching the row.
  const memberCache = new WeakMap();
  let scroller, list, activeMode, scheduled = false, disposed = false, remeasure = false;
  let discovery = true, rebuild = true, directRows = false;
  const areaSelector = '.chat-msg-area';

  function schedule() {
    if (scheduled || disposed || document.hidden) return;
    scheduled = true;
    resize.observe(pulse);
  }

  const resize = new ResizeObserver(entries => {
    if (entries.some(e => e.target === pulse)) {
      resize.unobserve(pulse);
      scheduled = false;
    }
    for (const { target } of entries) {
      if (target === scroller) remeasure = true;
      else if (measured.has(target)) { const row = target.closest('.ml-item'); if (row) dirty.add(row); }
    }
    if (!document.hidden) refresh();
  });

  function onMutations(records) {
    for (const { target, type, addedNodes, removedNodes, previousSibling, nextSibling } of records) {
      const row = target.closest('.ml-item');
      if (row && list?.contains(row)) {
        dirty.add(row);
      } else if (target === list && type === 'childList') {
        for (const node of [...addedNodes, ...removedNodes, previousSibling, nextSibling]) {
          if (node?.matches?.('.ml-item')) dirty.add(node);
          else if (node?.querySelector?.('.ml-item')) rebuild = true;
        }
      } else if (type === 'childList') {
        // Ancestors can replace the scroller or list; descendants can wrap rows.
        if (list?.contains(target)) rebuild = true;
        else discovery = true;
      }
    }
    schedule();
  }

  function rediscover() {
    discovery = true;
    schedule();
  }

  function onVisibility() {
    if (!document.hidden) remeasure = true;
    rediscover();
  }

  function onLoad(e) {
    const row = e.target.closest?.('.ml-item');
    if (!row || !list?.contains(row)) return;
    dirty.add(row);
    schedule();
  }

  const structure = new MutationObserver(onMutations);
  const attributes = new MutationObserver(onMutations);
  const settings = new MutationObserver(rediscover);
  const areaState = new MutationObserver(rediscover);

  function clear(host, track) {
    // Always clear, even for a detached host: the virtual list can reattach the
    // same element, and a leftover marker plus a stale track height would make
    // avatar-compact.css:52-64 apply `position: absolute` with a bogus height.
    // Removing an attribute from a detached element costs no style invalidation.
    host.removeAttribute('data-ll-compact-host');
    track.avatar.style.removeProperty('--ll-compact-track-height');
    stats.writes += 2;
    tracks.delete(host);
    stats.clears++;
  }

  function cancel(host) {
    const job = pending.get(host);
    if (!job) return;
    pending.delete(host);
    job.batch.jobs.delete(host);
    for (const el of job.targets) {
      const remaining = job.batch.refs.get(el) - 1;
      if (remaining) job.batch.refs.set(el, remaining);
      else {
        job.batch.refs.delete(el);
        job.batch.io.unobserve(el);
      }
    }
    if (!job.batch.jobs.size) job.batch.io.disconnect();
  }

  function sample(requests, attempts = 0) {
    if (!requests.size) return;
    const batch = { jobs: new Map(), refs: new Map(), io: new IntersectionObserver(entries => {
      const rects = new Map();
      for (const e of entries) rects.set(e.target, e);
      const retry = new Map();
      for (const [host, job] of batch.jobs) {
        cancel(host);
        const { track, targets } = job;
        if (disposed || !list?.contains(host) || mode() !== track.theme || !track.members.every(m =>
          list.contains(m.row) && m.row.contains(m.host) && m.host.contains(m.bubble) &&
          m.row.id === m.id && m.host.dataset[track.groupKey] === m.group) || track.avatar.parentElement !== host) continue;
        const first = rects.get(targets[0]), last = rects.get(targets[1]);
        if (!first || !last || first.time !== last.time) {
          if (attempts < maxSampleRetries) retry.set(host, track);
          else {
            // 跨投递的坐标差不能用于测量组高，保留已有轨道。
            stats.abandoned++;
            console.debug('[liuli] 头像轨道采样达到重试上限，放弃本轮测量');
          }
          continue;
        }
        if (!first.boundingClientRect.height || !last.boundingClientRect.height) continue;
        const height = last.boundingClientRect.bottom - first.boundingClientRect.top;
        if (height <= 0) continue;
        stats.measures++;
        const previous = tracks.get(host);
        if (previous?.height !== height) {
          track.avatar.style.setProperty('--ll-compact-track-height', height + 'px');
          stats.writes++;
          if (!previous) {
            host.setAttribute('data-ll-compact-host', '');
            stats.writes++;
          }
          stats.updates++;
        }
        tracks.set(host, { ...track, height });
      }
      if (!disposed && !document.hidden) sample(retry, attempts + 1);
    }) };
    for (const [host, track] of requests) {
      const targets = [track.members[0].bubble, track.members.at(-1).bubble];
      const job = { track, targets, batch };
      pending.set(host, job);
      batch.jobs.set(host, job);
      stats.requested++;
      for (const el of targets) {
        const refs = batch.refs.get(el) || 0;
        if (!refs) batch.io.observe(el);
        batch.refs.set(el, refs + 1);
      }
    }
  }

  function bindList(theme) {
    let nextScroller = null;
    areaState.disconnect();
    if (['tim', 'tg'].includes(theme)) {
      for (const el of document.querySelectorAll(scrollerSelector)) {
        const area = el.closest(areaSelector);
        areaState.observe(area, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-ll-switching'] });
        if (!nextScroller && !area.hasAttribute('data-ll-switching') &&
            (!el.checkVisibility || el.checkVisibility({ checkVisibilityCSS: true }))) nextScroller = el;
      }
    }
    const nextList = nextScroller?.querySelector('.ml-list') || null;
    const changedScroller = nextScroller !== scroller;
    if (changedScroller) {
      if (scroller) resize.unobserve(scroller);
      scroller = nextScroller;
      if (scroller) resize.observe(scroller, { box: 'border-box' });
    }
    if (list !== nextList || changedScroller) {
      list = nextList;
      rebuild = true;
      attributes.disconnect();
      structure.disconnect();
      if (list) {
        attributes.observe(list, { subtree: true, attributes: true,
          attributeFilter: ['id', 'data-liuli-g', 'data-liuli-avatar-g'] });
        structure.observe(list, { childList: true, subtree: true });
      }
      for (let el = list?.parentElement || scroller; el && el !== document.body; el = el.parentElement)
        structure.observe(el, { childList: true });
    }
    discovery = false;
  }

  function changeCandidates(affected, next, requests) {
    // Remove old ownership first so a split/merge can claim rows from another tail.
    for (const host of affected) {
      const previous = candidates.get(host), track = next.get(host);
      if (!previous || previous === track) continue;
      cancel(host);
      if (tracks.has(host)) clear(host, tracks.get(host));
      for (const { row, bubble } of previous.members) {
        if (owners.get(row) === host) owners.delete(row);
        for (const el of [row, bubble]) {
          resize.unobserve(el);
          measured.delete(el);
        }
      }
      candidates.delete(host);
    }
    for (const [host, track] of next) {
      if (candidates.get(host) !== track) {
        candidates.set(host, track);
        for (const { row, bubble } of track.members) {
          owners.set(row, host);
          for (const el of [row, bubble]) if (!measured.has(el)) {
            resize.observe(el, { box: 'border-box' });
            measured.add(el);
          }
        }
      }
      cancel(host);
      requests.set(host, track);
    }
  }

  function refresh() {
    if (disposed) return;
    stats.passes++;
    const theme = mode();
    if (theme !== activeMode) {
      activeMode = theme;
      discovery = rebuild = true;
    }
    if (discovery || (list && !list.isConnected)) bindList(theme);
    const groupKey = theme === 'tim' ? 'liuliAvatarG' : 'liuliG';
    const inspected = new Map();
    function memberOf(row) {
      if (!row?.matches('.ml-item') || !list?.contains(row)) return null;
      if (!inspected.has(row)) {
        stats.rowsInspected++;
        const cached = memberCache.get(row);
        // A recycled row keeps its element but swaps id and contents; the id,
        // the still-mounted host and the still-mounted bubble must all match
        // before the cache is trusted. A stale bubble would fail the
        // `m.host.contains(m.bubble)` check in sample() and silently stop the
        // group from ever being measured.
        if (cached && cached.id === row.id && cached.host.isConnected && row.contains(cached.host) &&
            cached.bubble.isConnected && cached.host.contains(cached.bubble)) {
          stats.reused++;
          inspected.set(row, cached);
        } else {
          const host = row.querySelector('.message-container');
          const bubble = host?.querySelector(':scope > .message-content__wrapper') || host?.querySelector('.msg-content-container');
          const member = host && bubble ? { host, row, id: row.id, bubble } : null;
          if (member) memberCache.set(row, member);
          else memberCache.delete(row);
          inspected.set(row, member);
        }
      }
      const member = inspected.get(row);
      if (!member) return null;
      // Grouping is owned by index.js and changes without a row mutation, so it
      // is re-read every pass and returned as a fresh object. The cached entry
      // must stay immutable: `collect()` compares member identity against the
      // previous track, and mutating a shared object would hide a group change.
      const group = member.host.dataset[groupKey];
      return ['first', 'mid', 'last'].includes(group) ? { ...member, group } : null;
    }
    function collect(members, next) {
      if (members.length < 2) return;
      const { host } = members.at(-1);
      const avatar = host.querySelector(':scope > .avatar-span');
      if (!avatar?.querySelector(':scope > .message-container__avatar')) return;
      const old = candidates.get(host);
      const same = old?.theme === theme && old.avatar === avatar && old.members.length === members.length && members.every((m, i) => {
        const p = old.members[i];
        return m.row === p.row && m.id === p.id && m.host === p.host && m.bubble === p.bubble && m.group === p.group;
      });
      next.set(host, same ? old : { avatar, members, theme, groupKey });
    }
    const next = new Map(), affected = new Set(), requests = new Map();
    if (rebuild || (!directRows && dirty.size)) {
      stats.fullPasses++;
      for (const host of candidates.keys()) affected.add(host);
      directRows = true;
      let members = [];
      for (const row of list?.querySelectorAll('.ml-item') || []) {
        if (row.parentElement !== list) directRows = false;
        const member = memberOf(row);
        if (!member) { members = []; continue; }
        if (member.group === 'first') members = [];
        members.push(member);
        if (member.group === 'last') { collect(members, next); members = []; }
      }
    } else if (dirty.size) {
      // Resolve only the old and new groups touching the changed rows.
      const tails = new Set(), visited = new Set();
      function siblingRow(row, direction) {
        for (let sibling = row[direction]; sibling; sibling = sibling[direction]) {
          if (sibling.matches('.ml-item')) return sibling;
        }
        return null;
      }
      function findTail(row) {
        let member = memberOf(row);
        while (member && member.group !== 'last') {
          if (visited.has(member.row)) return;
          visited.add(member.row);
          member = memberOf(siblingRow(member.row, 'nextElementSibling'));
          if (member?.group === 'first') return;
        }
        if (member) tails.add(member.row);
      }
      for (const row of dirty) {
        const owner = owners.get(row);
        if (owner) {
          affected.add(owner);
          const previous = candidates.get(owner); if (previous) tails.add(previous.members.at(-1).row);
        }
        if (row.parentElement === list) findTail(row);
      }
      for (const tail of tails) {
        const last = memberOf(tail);
        if (last?.group !== 'last') continue;
        const members = [last];
        for (let row = siblingRow(tail, 'previousElementSibling'); row; row = siblingRow(row, 'previousElementSibling')) {
          const member = memberOf(row);
          if (!member || member.group === 'last') break;
          members.push(member);
          if (member.group === 'first') break;
        }
        collect(members.reverse(), next);
      }
      for (const host of next.keys()) affected.add(host);
    }
    changeCandidates(affected, next, requests);
    if (remeasure) for (const [host, track] of candidates) {
      cancel(host);
      requests.set(host, track);
    }
    dirty.clear();
    rebuild = remeasure = false;
    sample(requests);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    resize.disconnect();
    structure.disconnect();
    attributes.disconnect();
    settings.disconnect();
    areaState.disconnect();
    for (const host of pending.keys()) cancel(host);
    for (const [host, track] of tracks) clear(host, track);
    document.removeEventListener('load', onLoad, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('liuli-route', rediscover);
    window.removeEventListener('pagehide', dispose);
    pulse.remove();
    delete window[key];
  }

  document.body.append(pulse);
  settings.observe(document.body, { attributes: true, attributeFilter: ['data-liuli-chat-style', 'data-liuli-avatar-position'] });
  document.addEventListener('load', onLoad, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('liuli-route', rediscover);
  window.addEventListener('pagehide', dispose, { once: true });
  window[key] = {
    refresh(invalidate) {
      if (invalidate === true) remeasure = true;
      if (!list?.isConnected) rediscover();
      else if (remeasure || dirty.size || rebuild) schedule();
    },
    dispose, stats, tracks: () => tracks
  };
  schedule();
})();
