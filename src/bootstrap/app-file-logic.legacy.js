(function initAppFileLogic() {
  if (window.ShogaFileLogicFactory) return;

  function createFileLogic(deps) {
    var isVideoFileLike = deps.isVideoFileLike;
    var compareByNameAsc = deps.compareByNameAsc;
    var compareByNameDesc = deps.compareByNameDesc;
    var compareMediaAware = deps.compareMediaAware || null;

    var videoFileDetectionCache = new WeakMap();

    function isVideoFile(file) {
      if (!file) return false;
      var cached = videoFileDetectionCache.get(file);
      if (cached !== undefined) return cached;
      var isVideo = isVideoFileLike(file);
      videoFileDetectionCache.set(file, isVideo);
      return isVideo;
    }

    function buildFileSortFn(getSortMode) {
      return function fileSortFn(a, b) {
        if (compareMediaAware) return compareMediaAware(a, b, getSortMode(), isVideoFile);
        var aIsVideo = isVideoFile(a);
        var bIsVideo = isVideoFile(b);
        if (aIsVideo && !bIsVideo) return -1;
        if (!aIsVideo && bIsVideo) return 1;
        if (getSortMode() === 'name-asc') return compareByNameAsc(a, b);
        return compareByNameDesc(a, b);
      };
    }

    function resolveLayoutMode(files, currentIndex, imageLayoutMode, videoLayoutMode) {
      if (!files || files.length === 0 || currentIndex < 0 || currentIndex >= files.length) return imageLayoutMode;
      return isVideoFile(files[currentIndex]) ? videoLayoutMode : imageLayoutMode;
    }

    return {
      isVideoFile: isVideoFile,
      buildFileSortFn: buildFileSortFn,
      resolveLayoutMode: resolveLayoutMode,
    };
  }

  window.ShogaFileLogicFactory = Object.freeze({
    createFileLogic: createFileLogic,
  });
})();
