(function initAppRuntimeTools() {
  if (window.ShogaRuntimeTools) return;

  function createLowSpecRuntimeState() {
    return {
      videoEl: null,
      imageEl: null,
      queuePumpScheduled: false,
      rafTaskQueued: false,
      reusableCanvases: []
    };
  }

  function getCanvas2DContext(canvas) {
    if (!canvas) return null;
    if (!canvas._ctx2d) canvas._ctx2d = canvas.getContext('2d', { alpha: false });
    return canvas._ctx2d;
  }

  function scheduleFrameTask(lowSpecRuntime, task) {
    if (lowSpecRuntime.rafTaskQueued) return;
    lowSpecRuntime.rafTaskQueued = true;
    requestAnimationFrame(function () {
      lowSpecRuntime.rafTaskQueued = false;
      task();
    });
  }

  function getReusableCanvas(lowSpecRuntime) {
    return lowSpecRuntime.reusableCanvases.pop() || document.createElement('canvas');
  }

  function releaseReusableCanvas(lowSpecRuntime, canvas, isLowEndHardware) {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
    if (lowSpecRuntime.reusableCanvases.length < (isLowEndHardware ? 8 : 16)) {
      lowSpecRuntime.reusableCanvases.push(canvas);
    }
  }

  function scheduleLightweightQueuePump(lowSpecRuntime, isLowEndHardware, scheduleFrameTaskFn, processLightweightQueueFn) {
    if (lowSpecRuntime.queuePumpScheduled) return;
    lowSpecRuntime.queuePumpScheduled = true;
    if (isLowEndHardware) {
      requestAnimationFrame(function () {
        lowSpecRuntime.queuePumpScheduled = false;
        processLightweightQueueFn();
      });
    } else {
      scheduleFrameTaskFn(function () {
        lowSpecRuntime.queuePumpScheduled = false;
        processLightweightQueueFn();
      });
    }
  }

  function createCounterController(options) {
    options = options || {};
    var count = options.initial || 0;
    var onChange = options.onChange || function () {};
    function inc() {
      count += 1;
      onChange(count);
      return count;
    }
    function dec() {
      count = Math.max(0, count - 1);
      onChange(count);
      return count;
    }
    function get() {
      return count;
    }
    return Object.freeze({ inc: inc, dec: dec, get: get });
  }

  function createLoadingController(options) {
    options = options || {};
    var overlay = options.overlay;
    var titleSelector = options.titleSelector || 'div:nth-child(2)';
    var progressElement = options.progressElement || null;
    function show(title, text) {
      if (!overlay) return;
      var titleEl = overlay.querySelector(titleSelector);
      if (titleEl) titleEl.textContent = title || 'PROCESSING';
      if (progressElement) progressElement.textContent = text || '';
      overlay.style.display = 'flex';
    }
    function update(text) {
      if (progressElement) progressElement.textContent = text || '';
    }
    function hide() {
      if (progressElement) progressElement.textContent = '';
      if (overlay) overlay.style.display = 'none';
    }
    return Object.freeze({ show: show, update: update, hide: hide });
  }

  function createUpscaleIndicatorController(options) {
    options = options || {};
    var indicatorEl = options.indicatorEl || null;
    var saveBtn = options.saveBtn || null;
    var onCountChange = options.onCountChange || function () {};
    var counter = createCounterController({
      initial: 0,
      onChange: function (count) {
        if (indicatorEl) indicatorEl.style.display = count > 0 ? 'flex' : 'none';
        if (saveBtn) saveBtn.disabled = count > 0;
        onCountChange(count);
      },
    });
    function show() { return counter.inc(); }
    function hide() { return counter.dec(); }
    function get() { return counter.get(); }
    return Object.freeze({ show: show, hide: hide, get: get });
  }

  function createScriptLoader() {
    var loaded = new Map();
    function loadScript(src) {
      if (loaded.has(src)) return loaded.get(src);
      var promise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      loaded.set(src, promise);
      return promise;
    }
    return Object.freeze({ loadScript: loadScript });
  }

  function shouldDeferPreload(isPanning, isDragging, isAnimating, upscaleTasks) {
    return !!(isPanning || isDragging || isAnimating || upscaleTasks > 0);
  }

  window.ShogaRuntimeTools = Object.freeze({
    createLowSpecRuntimeState: createLowSpecRuntimeState,
    getCanvas2DContext: getCanvas2DContext,
    scheduleFrameTask: scheduleFrameTask,
    getReusableCanvas: getReusableCanvas,
    releaseReusableCanvas: releaseReusableCanvas,
    scheduleLightweightQueuePump: scheduleLightweightQueuePump,
    createCounterController: createCounterController,
    createLoadingController: createLoadingController,
    createUpscaleIndicatorController: createUpscaleIndicatorController,
    createScriptLoader: createScriptLoader,
    shouldDeferPreload: shouldDeferPreload,
  });
})();
