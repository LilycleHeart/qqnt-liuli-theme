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
  const stats = { passes: 0, requested: 0, measures: 0, updates: 0, clears: 0, writes: 0 };
  const tracks = new Map(), pending = new Map(), dirty = new Set();
  let scroller, list, scheduled = false, disposed = false, remeasure = false;
  let shells = new Set(), measured = new Set();
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
      else if (measured.has(target)) dirty.add(target.closest('.ml-item'));
    }
    if (!document.hidden) refresh();
  });

  function onMutations(records) {
    for (const { target } of records) {
      const row = target.closest('.ml-item');
      if (row) dirty.add(row);
    }
    schedule();
  }

  function onLoad(e) {
    const row = e.target.closest?.('.ml-item');
    if (!row || !list?.contains(row)) return;
    dirty.add(row);
    schedule();
  }

  const structure = new MutationObserver(onMutations);
  const attributes = new MutationObserver(onMutations);
  const settings = new MutationObserver(schedule);
  const areaState = new MutationObserver(schedule);

  function clear(host, track) {
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

  function sample(requests) {
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
        if (!first || !last || first.time !== last.time) { retry.set(host, track); continue; }
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
      if (!disposed && !document.hidden) sample(retry);
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

  function refresh() {
    if (disposed) return;
    stats.passes++;
    const theme = mode();
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
    const switched = list !== nextList;
    if (nextScroller !== scroller) {
      if (scroller) resize.unobserve(scroller);
      scroller = nextScroller;
      if (scroller) resize.observe(scroller, { box: 'border-box' });
    }
    if (switched) {
      list = nextList;
      attributes.disconnect();
      if (list) attributes.observe(list, { subtree: true, attributes: true,
        attributeFilter: ['id', 'data-liuli-g', 'data-liuli-avatar-g'] });
    }
    const groupKey = theme === 'tim' ? 'liuliAvatarG' : 'liuliG';
    const nextShells = new Set(), candidates = new Map();
    for (let el = list || scroller; el && el !== document.body; el = el.parentElement) nextShells.add(el);
    let members = [];
    for (const row of list?.querySelectorAll('.ml-item') || []) {
      // Include system rows as hard boundaries, not just rows with bubbles.
      for (let el = row; el && el !== list; el = el.parentElement) nextShells.add(el);
      const host = row.querySelector('.message-container');
      if (host) for (let el = host; el && el !== row; el = el.parentElement) nextShells.add(el);
      const group = host?.dataset[groupKey];
      const bubble = host?.querySelector(':scope > .message-content__wrapper') || host?.querySelector('.msg-content-container');
      if (!bubble || !['first', 'mid', 'last'].includes(group)) { members = []; continue; }
      if (group === 'first') members = [];
      members.push({ host, row, id: row.id, group, bubble });
      if (group !== 'last') continue;
      const groupMembers = members;
      members = [];
      if (groupMembers.length < 2) continue;
      const avatar = host.querySelector(':scope > .avatar-span');
      if (!avatar?.querySelector(':scope > .message-container__avatar')) continue;
      nextShells.add(avatar);
      candidates.set(host, { avatar, members: groupMembers, theme, groupKey });
    }

    const same = (a, b) => !switched && a && b && a.avatar === b.avatar && a.theme === b.theme &&
      a.members.length === b.members.length && a.members.every((m, i) => {
        const p = b.members[i];
        return m.row === p.row && m.id === p.id && m.host === p.host && m.bubble === p.bubble && m.group === p.group;
      });
    for (const [host, track] of tracks) if (!same(track, candidates.get(host))) clear(host, track);
    for (const [host, job] of pending) if (!same(job.track, candidates.get(host)) || remeasure || job.track.members.some(m => dirty.has(m.row))) cancel(host);
    const requests = new Map();
    for (const [host, track] of candidates) {
      if (!pending.has(host) && (!tracks.has(host) || remeasure || track.members.some(m => dirty.has(m.row)))) requests.set(host, track);
    }
    if (nextShells.size !== shells.size || [...shells].some(el => !nextShells.has(el))) {
      structure.disconnect();
      for (const el of nextShells) structure.observe(el, { childList: true });
      shells = nextShells;
    }
    const nextMeasured = new Set();
    for (const { members } of candidates.values()) for (const { row, bubble } of members) {
      nextMeasured.add(row);
      nextMeasured.add(bubble);
    }
    for (const el of measured) if (!nextMeasured.has(el)) resize.unobserve(el);
    for (const el of nextMeasured) if (!measured.has(el)) resize.observe(el, { box: 'border-box' });
    measured = nextMeasured;
    sample(requests);
    dirty.clear();
    remeasure = false;
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
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('liuli-route', schedule);
    window.removeEventListener('pagehide', dispose);
    pulse.remove();
    delete window[key];
  }

  document.body.append(pulse);
  settings.observe(document.body, { attributes: true, attributeFilter: ['data-liuli-chat-style', 'data-liuli-avatar-position'] });
  document.addEventListener('load', onLoad, true);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('liuli-route', schedule);
  window.addEventListener('pagehide', dispose, { once: true });
  window[key] = {
    refresh(invalidate) {
      if (invalidate === true) remeasure = true;
      schedule();
    },
    dispose, stats, tracks: () => tracks
  };
  schedule();
})();
