(() => {
  'use strict';
  window.__liuliBackgroundPerformance?.dispose();
  const frozen = new Map();
  const pausedVideos = new Map();
  const pausedDecorations = new Set();
  const userVideos = new WeakSet();
  const classification = new WeakMap();
  const pending = new Set();
  const pendingAnimations = new Map();
  const BATCH_MS = 80;
  let focused = document.hasFocus();
  let suspended = false;
  let work = 0;
  let disposed = false;
  const style = document.createElement('style');
  style.id = 'liuli-background-performance-style';
  style.textContent = '[data-liuli-static-frame]{pointer-events:none!important;user-select:none!important}';
  document.head.appendChild(style);
  const IMAGE_SCOPE = '.chat-msg-area,.recent-contact,.expression-panel';
  const FRAME_PROPERTIES = ['display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'box-sizing',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin', 'padding', 'border',
    'border-radius', 'box-shadow', 'vertical-align', 'align-self', 'justify-self', 'flex', 'grid-area',
    'object-fit', 'object-position', 'opacity', 'transform', 'transform-origin', 'filter', 'clip-path',
    'overflow', 'z-index', 'float', 'clear', 'background'];

  function animatedSource(value) {
    return /(?:\.(?:gif|apng)(?:$|[?#/])|^data:image\/(?:gif|apng)[;,]|[/?_-](?:animated|dynamic)[/_-])/i.test(value || '');
  }

  function isAnimatedImage(image) {
    if (!image.closest(IMAGE_SCOPE)) return false;
    const source = image.currentSrc || image.src;
    const old = classification.get(image);
    if (old?.source === source) return old.animated;
    let canCache = true;
    // Native inline QQ faces may be animated PNGs with an ordinary .png URL.
    // Treat the explicit emoji containers as decorative media, including their
    // static faces, while ordinary static .pic-element images remain untouched.
    let animated = animatedSource(source) || animatedSource(image.dataset.path) ||
      !!image.closest('.market-face-element,.face-element,[data-is-animated="true"],[data-animated="true"]');
    if (!animated && image.closest('.pic-element')) {
      // QQ can display a GIF through a .png thumbnail URL. Use the matching
      // native picture record rather than infer animation from an enum number.
      const message = image.closest('.message');
      const pictures = [...(message?.querySelectorAll('.pic-element') || [])];
      const index = pictures.indexOf(image.closest('.pic-element'));
      const elements = window.LiuliQQ?.messageRecord(image)?.elements;
      const record = Array.isArray(elements) ? elements.filter(element => element.picElement)[index]?.picElement : null;
      canCache = !!record;
      animated = !!record && (record.isGif === true || record.isAnimated === true ||
        animatedSource(record.fileName) || animatedSource(record.originImageUrl) || animatedSource(record.sourcePath));
    }
    if (canCache) classification.set(image, { source, animated });
    return animated;
  }

  function prepareFrame(image) {
    if (frozen.has(image) || !image.isConnected || !image.complete || !image.naturalWidth || !isAnimatedImage(image)) return;
    const appearance = getComputedStyle(image);
    if (appearance.display === 'none' || appearance.visibility === 'hidden') return;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'liuli-static-frame';
    canvas.setAttribute('data-liuli-static-frame', '');
    canvas.setAttribute('aria-hidden', 'true');
    // Keep enough pixels for the displayed frame, without allocating a full
    // multi-megapixel source merely to suspend a small sticker.
    const scale = Math.min(1, Math.min(devicePixelRatio || 1, 2) *
      Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight),
      Math.sqrt(1048576 / (image.naturalWidth * image.naturalHeight)));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (const property of FRAME_PROPERTIES) canvas.style.setProperty(property, appearance.getPropertyValue(property));
    canvas.style.setProperty('pointer-events', 'none', 'important');
    canvas.style.setProperty('animation', 'none', 'important');
    canvas.style.setProperty('transition', 'none', 'important');
    try {
      // Drawing a cross-origin image to a visible canvas is allowed. We never
      // read/export its pixels, request it again, or mutate the native source.
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    } catch (_) { return; }
    return { image, canvas, display: image.style.getPropertyValue('display'), priority: image.style.getPropertyPriority('display') };
  }

  function thawImage(image) {
    const state = frozen.get(image);
    if (!state) return;
    frozen.delete(image);
    state.canvas.remove();
    if (state.display) image.style.setProperty('display', state.display, state.priority);
    else image.style.removeProperty('display');
  }

  function automaticVideo(video) {
    return video.id === 'liuli-video-wallpaper' ||
      (video.muted && !userVideos.has(video) && (video.autoplay || video.loop || video.dataset.autoplay === 'true'));
  }

  function pauseVideo(video) {
    if (!video.isConnected || video.paused || !automaticVideo(video)) return;
    if (!pausedVideos.has(video)) pausedVideos.set(video, { source: video.currentSrc || video.src, stream: video.srcObject });
    video.pause();
  }

  function pauseDecorations(animations) {
    // Finite entry/switch animations must finish even in a visible, unfocused
    // window. Only continuous decoration belongs to the idle suspension.
    for (const animation of animations) {
      if (animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity) {
        animation.pause();
        pausedDecorations.add(animation);
      }
    }
  }

  function flush() {
    work = 0;
    if (!suspended || disposed) return;
    for (const image of frozen.keys()) if (!image.isConnected) thawImage(image);
    for (const video of pausedVideos.keys()) if (!video.isConnected) pausedVideos.delete(video);
    for (const animation of pausedDecorations) if (!animation.effect?.target?.isConnected) pausedDecorations.delete(animation);
    // Animation events arrive after the browser has established their styles.
    // Read every target before pausing any of them; never rescan a mounted row
    // subtree merely because the native virtual list added plain text.
    const animations = [];
    for (const [target, includePseudo] of pendingAnimations) if (target.isConnected)
      animations.push(...(target.getAnimations?.({ subtree: includePseudo }) || [])
        .filter(animation => animation.effect?.target === target));
    pendingAnimations.clear();
    const frames = [], videos = [];
    for (const media of pending) {
      if (media instanceof HTMLImageElement) {
        const frame = prepareFrame(media);
        if (frame) frames.push(frame);
      } else videos.push(media);
    }
    pending.clear();
    // All connected image style/geometry reads finish before the first canvas
    // insertion or display write, so a batch needs no read/write layout loop.
    pauseDecorations(animations);
    for (const video of videos) pauseVideo(video);
    for (const state of frames) if (state.image.isConnected) {
      frozen.set(state.image, state);
      state.image.before(state.canvas);
      state.image.style.setProperty('display', 'none', 'important');
    }
  }

  function schedule() { if (!work) work = setTimeout(flush, BATCH_MS); }

  function queue(scope) {
    if (!suspended || !scope || scope.nodeType !== 1 || scope.matches?.('[data-liuli-static-frame]')) return;
    if (scope.matches?.('img,video')) pending.add(scope);
    else for (const media of scope.querySelectorAll?.('img,video') || []) pending.add(media);
    if (pending.size) schedule();
  }

  function resume() {
    for (const animation of pausedDecorations) {
      if (animation.playState === 'paused' && animation.effect?.target?.isConnected) animation.play();
    }
    pausedDecorations.clear();
    for (const image of [...frozen.keys()]) thawImage(image);
    for (const [video, state] of pausedVideos) {
      if (video.isConnected && video.paused && automaticVideo(video) && video.srcObject === state.stream &&
        (video.currentSrc || video.src) === state.source)
        video.play().catch(() => {});
    }
    pausedVideos.clear();
  }

  function sync() {
    const next = document.hidden || !focused;
    if (next === suspended || disposed) return;
    suspended = next;
    document.body.toggleAttribute('data-liuli-background-idle', suspended);
    if (suspended) {
      // One scan on the foreground/background boundary also covers existing
      // WAAPI decorations. Later mounts use animationstart and media candidates.
      pauseDecorations(document.body.getAnimations?.({ subtree: true }) || []);
      queue(document.body);
    }
    else {
      clearTimeout(work); work = 0; pending.clear(); pendingAnimations.clear();
      resume();
    }
  }

  const onBlur = () => { focused = false; sync(); };
  const onFocus = () => { focused = true; sync(); };
  const onVisibility = () => { if (!document.hidden) focused = document.hasFocus(); sync(); };
  const onLoad = event => { if (event.target instanceof HTMLImageElement) queue(event.target); };
  const onPlay = event => { if (suspended && event.target instanceof HTMLVideoElement) pauseVideo(event.target); };
  const onAnimationStart = event => {
    if (!suspended || !event.target?.getAnimations) return;
    pendingAnimations.set(event.target, pendingAnimations.get(event.target) || !!event.pseudoElement);
    schedule();
  };
  const onPointer = event => {
    const video = event.target.closest?.('video') || event.target.closest?.('.video-element')?.querySelector('video');
    if (video && video.id !== 'liuli-video-wallpaper') { userVideos.add(video); pausedVideos.delete(video); }
  };
  const onResize = () => {
    if (!suspended) return;
    // Recreate only the static presentation if the unfocused window is resized.
    for (const image of [...frozen.keys()]) { thawImage(image); queue(image); }
  };
  const observer = new MutationObserver(records => {
    if (!suspended) return;
    for (const record of records) {
      if (record.type === 'attributes') {
        classification.delete(record.target);
        if (frozen.has(record.target)) thawImage(record.target);
        queue(record.target);
      } else {
        for (const node of record.addedNodes) queue(node);
        if (record.removedNodes.length && (frozen.size || pausedVideos.size || pausedDecorations.size)) schedule();
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['src', 'srcset', 'data-path'] });
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('load', onLoad, true);
  document.addEventListener('play', onPlay, true);
  document.addEventListener('animationstart', onAnimationStart, true);
  document.addEventListener('pointerdown', onPointer, true);
  window.__liuliBackgroundPerformance = {
    get suspended() { return suspended; },
    get frozenImages() { return frozen.size; },
    get pausedVideos() { return pausedVideos.size; },
    refresh() {
      sync();
      if (suspended) {
        pauseDecorations(document.body.getAnimations?.({ subtree: true }) || []);
        queue(document.body);
      }
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      clearTimeout(work); pending.clear(); pendingAnimations.clear();
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('load', onLoad, true);
      document.removeEventListener('play', onPlay, true);
      document.removeEventListener('animationstart', onAnimationStart, true);
      document.removeEventListener('pointerdown', onPointer, true);
      suspended = false;
      resume();
      document.body.removeAttribute('data-liuli-background-idle');
      style.remove();
      delete window.__liuliBackgroundPerformance;
    }
  };
  sync();
})();
