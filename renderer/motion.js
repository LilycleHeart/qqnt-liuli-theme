(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  const messages = new Set();
  const rowEntries = new Set();
  const enabled = () => !preference.matches && !document.hidden;

  function play(element, frames, options) {
    if (!enabled() || !element.isConnected || typeof element.animate !== 'function') return;
    running.get(element)?.cancel();
    const { rowEntry, ...nativeOptions } = options || {};
    const animation = element.animate(frames, { ...nativeOptions, fill: 'backwards' });
    running.set(element, animation);
    if (rowEntry) rowEntries.add(element);
    else rowEntries.delete(element);
    const release = () => {
      if (running.get(element) === animation) running.delete(element);
      if (!running.has(element)) rowEntries.delete(element);
    };
    animation.finished.then(() => {
      release();
      animation.cancel();
    }, release);
    return animation;
  }

  function cancelAll() {
    for (const animation of running.values()) animation.cancel();
    running.clear();
    messages.clear();
    rowEntries.clear();
  }
  function cancelEntries(scope) {
    for (const element of rowEntries) if (!scope || element === scope || scope.contains(element)) {
      running.get(element)?.cancel();
      running.delete(element);
      rowEntries.delete(element);
    }
  }
  preference.addEventListener('change', () => {
    if (preference.matches) cancelAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAll();
  });

  function enterMessages(items) {
    if (!enabled() || !items.length) return 0;
    const viewport = document.querySelector('.chat-msg-area');
    if (!viewport) return 0;
    const bounds = viewport.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(innerHeight, bounds.bottom);
    if (bottom <= top) return 0;
    const visible = [];
    // Measure once per candidate, before starting any animation. Prefer recent messages.
    for (const item of [...new Set(items)].reverse()) {
      if (!item.isConnected) continue;
      const rect = item.getBoundingClientRect();
      if (
        rect.width < 1 ||
        rect.height < 1 ||
        rect.bottom <= top ||
        rect.top >= bottom ||
        rect.right <= Math.max(0, bounds.left) ||
        rect.left >= Math.min(innerWidth, bounds.right)
      )
        continue;
      const bubble = item.querySelector('.message-content__wrapper') || item;
      visible.push({ bubble, top: rect.top });
      if (visible.length === 14) break;
    }
    visible.sort((a, b) => a.top - b.top);
    let started = 0;
    visible.forEach(({ bubble }, index) => {
      // Bursts arriving in successive frames share the same animation budget.
      if (messages.size >= 14) {
        const oldest = messages.values().next().value;
        messages.delete(oldest);
        oldest.cancel();
      }
      const animation = play(
        bubble,
        [
          { opacity: 0, transform: 'translateY(10px) scale(0.98)' },
          { opacity: 1, transform: 'none' }
        ],
        {
          duration: 260,
          delay: Math.min(index * 18, 144),
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }
      );
      if (animation) {
        messages.add(animation);
        started += 1;
        const release = () => messages.delete(animation);
        animation.finished.then(release, release);
      }
    });
    return started;
  }

  window.LiuliMotion = Object.freeze({
    play,
    enterMessages,
    cancelEntries,
    get reduced() {
      return preference.matches;
    }
  });
})();
