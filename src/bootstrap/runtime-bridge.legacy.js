(function initLegacyRuntimeBridge() {
  var existing = window.ShogaRuntime || {};
  function mergeNamespace(existingNamespace, defaults) {
    var base = { ...(existingNamespace || {}) };
    for (var key in defaults) {
      if (base[key] === undefined || base[key] === null) base[key] = defaults[key];
    }
    return base;
  }

  var MEDIA_VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov|m4v|avi)$/i;
  var MEDIA_IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i;

  function isVideoFileLike(fileLike) {
    fileLike = fileLike || {};
    var type = fileLike.type || '';
    var name = fileLike.name || '';
    return type.indexOf('video/') === 0 || MEDIA_VIDEO_EXT_RE.test(name);
  }

  function isSupportedMediaName(name) {
    name = name || '';
    return MEDIA_VIDEO_EXT_RE.test(name) || MEDIA_IMAGE_EXT_RE.test(name);
  }
  function isSupportedMediaFile(fileLike) {
    fileLike = fileLike || {};
    var type = fileLike.type || '';
    var name = fileLike.name || '';
    return type.indexOf('image/') === 0 || isVideoFileLike(fileLike) || isSupportedMediaName(name);
  }
  var NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true });
  function compareByNameAsc(a, b) {
    return NATURAL_COLLATOR.compare(a.name, b.name);
  }
  function compareByNameDesc(a, b) {
    return NATURAL_COLLATOR.compare(b.name, a.name);
  }
  function compareMediaAware(a, b, sortMode, isVideo) {
    sortMode = sortMode || 'name-asc';
    isVideo = isVideo || isVideoFileLike;
    var aIsVideo = isVideo(a);
    var bIsVideo = isVideo(b);
    if (aIsVideo && !bIsVideo) return -1;
    if (!aIsVideo && bIsVideo) return 1;
    if (sortMode === 'name-asc') return compareByNameAsc(a, b);
    return compareByNameDesc(a, b);
  }
  function createStore(initialState) {
    var state = Object.freeze({ ...(initialState || {}) });
    var listeners = new Set();
    function getState() { return state; }
    function setState(patch, meta) {
      var next = Object.freeze({ ...state, ...(typeof patch === 'function' ? patch(state) : (patch || {})) });
      if (next === state) return state;
      state = next;
      listeners.forEach(function (listener) { listener(state, meta || {}); });
      return state;
    }
    function subscribe(listener) {
      listeners.add(listener);
      return function () { listeners.delete(listener); };
    }
    return { getState: getState, setState: setState, subscribe: subscribe };
  }
  function createPerfMonitor(options) {
    options = options || {};
    var sampleMs = options.sampleMs || 1000;
    var state = { fps: 0, frameCount: 0, last: performance.now(), marks: {} };
    var listeners = new Set();
    var rafId = 0;
    function tick(ts) {
      state.frameCount += 1;
      var elapsed = ts - state.last;
      if (elapsed >= sampleMs) {
        state.fps = Number(((state.frameCount * 1000) / elapsed).toFixed(1));
        state.frameCount = 0;
        state.last = ts;
        var memory = performance.memory ? Math.round(performance.memory.usedJSHeapSize / (1024 * 1024)) : null;
        listeners.forEach(function (fn) { fn({ fps: state.fps, memoryMB: memory, timestamp: Date.now() }); });
      }
      rafId = requestAnimationFrame(tick);
    }
    return {
      start: function () { if (!rafId) rafId = requestAnimationFrame(tick); },
      stop: function () { if (rafId) cancelAnimationFrame(rafId); rafId = 0; },
      subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
      markStart: function (name) { state.marks[name] = performance.now(); },
      markEnd: function (name) { var s = state.marks[name]; return typeof s === 'number' ? Number((performance.now() - s).toFixed(2)) : null; },
    };
  }

  window.ShogaRuntime = Object.freeze({
    ...existing,
    media: Object.freeze(mergeNamespace(existing.media, {
      MEDIA_VIDEO_EXT_RE: MEDIA_VIDEO_EXT_RE,
      isVideoFileLike: isVideoFileLike,
      isSupportedMediaName: isSupportedMediaName,
      isSupportedMediaFile: isSupportedMediaFile,
    })),
    sort: Object.freeze(mergeNamespace(existing.sort, {
      compareByNameAsc: compareByNameAsc,
      compareByNameDesc: compareByNameDesc,
      compareMediaAware: compareMediaAware,
    })),
    state: Object.freeze(mergeNamespace(existing.state, {
      createStore: createStore,
    })),
    perf: Object.freeze(mergeNamespace(existing.perf, {
      createPerfMonitor: createPerfMonitor,
    })),
  });
})();
