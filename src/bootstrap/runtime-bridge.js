import { createStore } from '../state/store.js';
import { isSupportedMediaName, isSupportedMediaFile, isVideoFileLike, MEDIA_VIDEO_EXT_RE } from '../core/media.js';
import { createPerfMonitor } from '../telemetry/perf.js';
import { compareByNameAsc, compareByNameDesc, compareMediaAware } from '../core/sort.js';
import { buildRuntimeSurface } from './runtime-surface.js';

const existing = (typeof window !== 'undefined' && window.ShogaRuntime) ? window.ShogaRuntime : {};
window.ShogaRuntime = buildRuntimeSurface(existing, {
  media: {
    MEDIA_VIDEO_EXT_RE,
    isSupportedMediaName,
    isSupportedMediaFile,
    isVideoFileLike,
  },
  state: {
    createStore,
  },
  perf: {
    createPerfMonitor,
  },
  sort: {
    compareByNameAsc,
    compareByNameDesc,
    compareMediaAware,
  },
});
