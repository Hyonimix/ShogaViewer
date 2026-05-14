(function initAppContext() {
  if (window.ShogaAppContext) return;
  var adapterFactory = window.ShogaAppAdapters || null;
  var mediaAdapter = adapterFactory ? adapterFactory.createMediaAdapter() : null;
  var sortAdapter = adapterFactory ? adapterFactory.createSortAdapter() : null;
  var MEDIA_VIDEO_EXT_RE = mediaAdapter ? mediaAdapter.MEDIA_VIDEO_EXT_RE : /\.(mp4|webm|mkv|mov|m4v|avi)$/i;
  var isSupportedMediaName = mediaAdapter
    ? mediaAdapter.isSupportedMediaName
    : function (name) { return /\.(mp4|webm|mkv|mov|m4v|avi|jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i.test(name || ''); };
  var isVideoFileLike = mediaAdapter
    ? mediaAdapter.isVideoFileLike
    : function (file) { return !!file && ((file.type || '').indexOf('video/') === 0 || MEDIA_VIDEO_EXT_RE.test(file.name || '')); };
  var isSupportedMediaFile = mediaAdapter
    ? mediaAdapter.isSupportedMediaFile
    : function (file) { return !!file && ((file.type || '').indexOf('image/') === 0 || isVideoFileLike(file) || isSupportedMediaName(file.name || '')); };

  var collator = new Intl.Collator(undefined, { numeric: true });
  var compareByNameAsc = sortAdapter ? sortAdapter.compareByNameAsc : function (a, b) { return collator.compare(a.name, b.name); };
  var compareByNameDesc = sortAdapter ? sortAdapter.compareByNameDesc : function (a, b) { return collator.compare(b.name, a.name); };
  var compareMediaAware = sortAdapter ? sortAdapter.compareMediaAware : null;

  window.ShogaAppContext = Object.freeze({
    MEDIA_VIDEO_EXT_RE: MEDIA_VIDEO_EXT_RE,
    isSupportedMediaName: isSupportedMediaName,
    isVideoFileLike: isVideoFileLike,
    isSupportedMediaFile: isSupportedMediaFile,
    compareByNameAsc: compareByNameAsc,
    compareByNameDesc: compareByNameDesc,
    compareMediaAware: compareMediaAware,
  });
})();
