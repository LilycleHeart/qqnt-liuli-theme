/* 本地视频壁纸：Blob 放 IndexedDB，localStorage 只放 id 和首帧。
 * 不把大视频编码进 localStorage，也不向页面开放任意文件路径能力。 */
(() => {
  'use strict';
  const DB_NAME = 'liuli-wallpaper-media';
  const STORE = 'videos';
  const LIMIT = 100 * 1024 * 1024;
  let layer = null;
  let objectUrl = '';
  let activeId = '';
  let serial = 0;
  let current = null;
  let pageSuspended = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function database() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onerror = () => reject(req.error || new Error('无法打开视频存储'));
      req.onsuccess = () => resolve(req.result);
    });
  }
  async function transact(mode, action) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let result;
        const req = action(tx.objectStore(STORE));
        req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || req.error || new Error('视频存储失败'));
      });
    } finally { db.close(); }
  }

  function firstFrame(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      let finished = false;
      const timer = setTimeout(() => finish(new Error('视频解码超时，请换一个较短的视频')), 20000);
      function finish(error, value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        video.onloadeddata = video.onseeked = video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        error ? reject(error) : resolve(value);
      }
      function capture() {
        try {
          if (!video.videoWidth || !video.videoHeight) throw new Error('视频没有有效画面');
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 1280 / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('无法创建视频首帧画布');
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const width = video.videoWidth;
          const height = video.videoHeight;
          finish(null, { poster: canvas.toDataURL('image/jpeg', 0.82), width, height });
        } catch (error) { finish(error); }
      }
      video.onerror = () => finish(new Error('无法解码视频，请使用 H.264 MP4 或 WebM'));
      video.onloadeddata = () => {
        // 跳过容器的全黑起始帧，短视频则直接取已解码的帧。
        if (Number.isFinite(video.duration) && video.duration > 0.2) {
          video.onseeked = capture;
          video.currentTime = Math.min(0.1, video.duration / 2);
        } else capture();
      };
      video.src = url;
    });
  }
  async function importFile(file) {
    if (!(file instanceof Blob) || !file.size) throw new Error('请选择有效的视频文件');
    if (file.size > LIMIT) throw new Error('视频不能超过 100 MB');
    if (!/^video\/(mp4|webm)$/i.test(file.type) && !/\.(mp4|webm)$/i.test(file.name || '')) {
      throw new Error('仅支持 MP4 和 WebM 视频');
    }
    const frame = await firstFrame(file);
    const id = crypto.randomUUID();
    await transact('readwrite', store => store.put(file, id));
    return { id, ...frame, name: String(file.name || '本地视频') };
  }
  async function remove(id) {
    if (typeof id !== 'string' || !id) return;
    await transact('readwrite', store => store.delete(id));
  }
  async function clearAll() {
    current = null;
    dispose();
    await transact('readwrite', store => store.clear());
  }
  function dispose() {
    serial++;
    if (layer) {
      layer.pause();
      layer.removeAttribute('src');
      layer.load();
      const host = layer.parentElement;
      layer.remove();
      if (host && host.id === 'liuli-video-layer') host.remove();
      layer = null;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    activeId = '';
    document.body.removeAttribute('data-liuli-video-wallpaper');
  }
  function playback() {
    if (!layer) return;
    if (document.hidden || reduced.matches) layer.pause();
    else layer.play().catch(() => { /* 自动播放被拒绝时保留首帧，用户操作后重试。 */ });
  }
  async function apply(state) {
    current = state;
    const main = document.body.dataset.liuliScope === 'main';
    if (pageSuspended || !main || !state || state.kind !== 'video' || !state.videoId || reduced.matches) {
      dispose();
      return;
    }
    if (layer && activeId === state.videoId) {
      layer.style.objectFit = state.fit === 'stretch' ? 'fill' : state.fit === 'contain' ? 'contain' : 'cover';
      playback();
      return;
    }
    dispose();
    const ticket = serial;
    const id = state.videoId;
    const blob = await transact('readonly', store => store.get(id));
    if (ticket !== serial) return;
    if (!(blob instanceof Blob)) throw new Error('视频文件已丢失，请重新选择壁纸');
    const app = document.getElementById('app');
    if (!app) return;
    const host = document.createElement('div');
    host.id = 'liuli-video-layer';
    host.setAttribute('aria-hidden', 'true');
    const video = document.createElement('video');
    video.id = 'liuli-video-wallpaper';
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.poster = state.src || '';
    video.style.objectFit = state.fit === 'stretch' ? 'fill' : state.fit === 'contain' ? 'contain' : 'cover';
    objectUrl = URL.createObjectURL(blob);
    video.src = objectUrl;
    layer = video;
    activeId = id;
    // 播放失败仍用现有的图片壁纸层作为首帧兜底，不留下空白。
    video.addEventListener('playing', () => {
      if (layer === video) document.body.setAttribute('data-liuli-video-wallpaper', '');
    });
    video.addEventListener('error', () => {
      if (layer === video) document.body.removeAttribute('data-liuli-video-wallpaper');
    });
    host.appendChild(video);
    app.prepend(host);
    playback();
  }
  document.addEventListener('visibilitychange', playback);
  document.addEventListener('pointerdown', playback, { passive: true });
  reduced.addEventListener('change', () => apply(current).catch(console.warn));
  window.addEventListener('pagehide', () => {
    pageSuspended = true;
    dispose();
  });
  // BFCache 会保留 JS 和当前配置，但 pagehide 已释放 Blob URL；恢复时要重建媒体层。
  window.addEventListener('pageshow', () => {
    pageSuspended = false;
    apply(current).catch(console.warn);
  });
  window.LiuliVideoWallpaper = { importFile, remove, clearAll, apply, clear: () => { current = null; dispose(); } };
})();
