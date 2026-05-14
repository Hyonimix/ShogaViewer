(function initAppTaskQueueFactory() {
  if (window.ShogaTaskQueueFactory) return;

  function createAsyncTaskQueue(options) {
    options = options || {};
    var onError = options.onError || function () {};
    var queue = [];
    var processing = false;

    async function process() {
      if (processing) return;
      processing = true;
      while (queue.length > 0) {
        var task = queue.shift();
        if (task.isValid()) {
          try {
            await task.run();
          } catch (err) {
            onError(err);
          }
        } else if (task.onCancel) {
          task.onCancel();
        }
      }
      processing = false;
    }

    function enqueue(isValid, run, onCancel) {
      queue.push({ isValid: isValid, run: run, onCancel: onCancel });
      process();
    }

    return Object.freeze({ enqueue: enqueue, process: process });
  }

  window.ShogaTaskQueueFactory = Object.freeze({
    createAsyncTaskQueue: createAsyncTaskQueue,
  });
})();
