function now() {
  return performance.now();
}

export function createPerfMonitor(options = {}) {
  const sampleMs = options.sampleMs || 1000;
  const state = { fps: 0, frameCount: 0, last: now(), marks: {} };
  const listeners = new Set();
  let rafId = 0;

  function tick(ts) {
    state.frameCount += 1;
    const elapsed = ts - state.last;
    if (elapsed >= sampleMs) {
      state.fps = Number(((state.frameCount * 1000) / elapsed).toFixed(1));
      state.frameCount = 0;
      state.last = ts;
      const memory = performance.memory ? Math.round(performance.memory.usedJSHeapSize / (1024 * 1024)) : null;
      listeners.forEach((fn) => fn({ fps: state.fps, memoryMB: memory, timestamp: Date.now() }));
    }
    rafId = requestAnimationFrame(tick);
  }

  return {
    start() { if (!rafId) rafId = requestAnimationFrame(tick); },
    stop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    markStart(name) { state.marks[name] = now(); },
    markEnd(name) { const s = state.marks[name]; return typeof s === 'number' ? Number((now() - s).toFixed(2)) : null; }
  };
}
