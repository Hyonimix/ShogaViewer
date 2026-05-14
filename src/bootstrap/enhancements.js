import { announce } from '../ui/announcer.js';
import { createPerfMonitor } from '../telemetry/perf.js';

(function initEnhancements() {
  if (window.__shogaEnhancementsInitialized) return;
  window.__shogaEnhancementsInitialized = true;

  function ensureA11yLabels() {
    const mappings = [
      ['btn-home', 'Home'], ['btn-open-main', 'Open'], ['btn-save', 'Save bookmark'],
      ['btn-bookmarks', 'Bookmarks'], ['btn-settings', 'Settings'], ['btn-grid', 'Grid view'], ['btn-info', 'Information']
    ];
    mappings.forEach(([id, label]) => {
      const el = document.getElementById(id);
      if (el && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
    });
  }

  function installOfflineBanner() {
    const banner = document.getElementById('network-offline-banner');
    if (!banner) return;
    const update = () => {
      const offline = !navigator.onLine;
      banner.style.display = offline ? 'flex' : 'none';
      if (offline) announce('Network offline. Remote streaming may be unavailable.');
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  function installMediaErrorUX() {
    document.addEventListener('error', (event) => {
      const t = event.target;
      if (!t) return;
      if (t.tagName === 'VIDEO' || t.tagName === 'AUDIO') {
        announce('Media playback error. Trying fallback flow.');
      }
    }, true);
  }

  function installPermissionProbe() {
    window.shogaPermissionProbe = async function shogaPermissionProbe() {
      const report = { camera: 'unknown', microphone: 'unknown' };
      if (!navigator.permissions || !navigator.permissions.query) return report;
      for (const name of ['camera', 'microphone']) {
        try {
          const res = await navigator.permissions.query({ name: /** @type {PermissionName} */ (name) });
          report[name] = res.state;
        } catch (_) {}
      }
      if (report.camera === 'denied' || report.microphone === 'denied') {
        announce('Permission denied detected. Check browser site permissions.');
      }
      return report;
    };
  }

  function installPerfHud() {
    const hud = document.getElementById('perf-hud');
    if (!hud) return;
    const devEnabled = localStorage.getItem('shoga-dev-hud') === 'true' || new URLSearchParams(location.search).get('debug') === '1';
    if (!devEnabled) {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = 'flex';
    const fpsEl = document.getElementById('perf-fps');
    const memEl = document.getElementById('perf-mem');
    const monitor = createPerfMonitor({ sampleMs: 1000 });
    monitor.subscribe(({ fps, memoryMB }) => {
      if (fpsEl) fpsEl.textContent = String(fps);
      if (memEl) memEl.textContent = memoryMB == null ? 'n/a' : `${memoryMB} MB`;
    });
    monitor.start();
    window.__shogaPerfMonitor = monitor;
  }

  ensureA11yLabels();
  installOfflineBanner();
  installMediaErrorUX();
  installPermissionProbe();
  installPerfHud();
})();
