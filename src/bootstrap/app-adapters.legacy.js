(function initShogaAppAdapters() {
  if (window.ShogaAppAdapters) return;
  function mergeNamespace(existingNamespace, defaults) {
    var out = { ...(existingNamespace || {}) };
    for (var key in defaults) {
      if (out[key] === undefined || out[key] === null) out[key] = defaults[key];
    }
    return out;
  }

  function getRuntimeMedia() {
    return window.ShogaRuntime && window.ShogaRuntime.media ? window.ShogaRuntime.media : null;
  }

  function getRuntimeSort() {
    return window.ShogaRuntime && window.ShogaRuntime.sort ? window.ShogaRuntime.sort : null;
  }

  function createMediaAdapter() {
    var runtimeMedia = getRuntimeMedia();
    var MEDIA_VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov|m4v|avi)$/i;
    var defaults = {
      MEDIA_VIDEO_EXT_RE: MEDIA_VIDEO_EXT_RE,
      isSupportedMediaName: function (name) { return /\.(mp4|webm|mkv|mov|m4v|avi|jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i.test(name || ''); },
      isVideoFileLike: function (file) { return !!file && ((file.type || '').indexOf('video/') === 0 || MEDIA_VIDEO_EXT_RE.test(file.name || '')); },
      isSupportedMediaFile: function (file) { return !!file && ((file.type || '').indexOf('image/') === 0 || defaults.isVideoFileLike(file) || defaults.isSupportedMediaName(file.name || '')); },
    };
    return mergeNamespace(runtimeMedia, defaults);
  }

  function createSortAdapter() {
    var runtimeSort = getRuntimeSort();
    var naturalCollator = new Intl.Collator(undefined, { numeric: true });
    var defaults = {
      compareByNameAsc: function (a, b) { return naturalCollator.compare(a.name, b.name); },
      compareByNameDesc: function (a, b) { return naturalCollator.compare(b.name, a.name); },
      compareMediaAware: null,
    };
    return mergeNamespace(runtimeSort, defaults);
  }

  window.ShogaAppAdapters = Object.freeze({
    createMediaAdapter: createMediaAdapter,
    createSortAdapter: createSortAdapter,
  });
})();
