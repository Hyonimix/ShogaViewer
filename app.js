/*
 * Shoga Viewer
 * Copyright (c) 2026 D5 Kan
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

let MAX_GL_TEXTURE_SIZE = 4096;
let _sharedGlCanvas = document.createElement('canvas');
let _sharedGl = _sharedGlCanvas.getContext('webgl2', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true }) || _sharedGlCanvas.getContext('webgl', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true });
let _shaderCache = new Map();

function forceLoseContext(gl) {
    if (!gl) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    _sharedGl = null;
    _shaderCache.clear();
}

function getGL() {
    if (!_sharedGl || _sharedGl.isContextLost()) {
        console.warn('WebGL Context is lost or null. Recreating...');
        _shaderCache.clear();
        _sharedGlCanvas = document.createElement('canvas');
        _sharedGl = _sharedGlCanvas.getContext('webgl2', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true }) || _sharedGlCanvas.getContext('webgl', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true });
        if (_sharedGl) {
            try { MAX_GL_TEXTURE_SIZE = _sharedGl.getParameter(_sharedGl.MAX_TEXTURE_SIZE); } catch (e) { console.error('Failed to get MAX_TEXTURE_SIZE', e); }
        } else {
            console.error('WebGL context creation completely failed.');
        }
    }
    return _sharedGl;
}

const escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
};

try {
    if (_sharedGl) MAX_GL_TEXTURE_SIZE = _sharedGl.getParameter(_sharedGl.MAX_TEXTURE_SIZE);
} catch (e) { }

function getDynamicMaxArea() {
    const mem = navigator.deviceMemory || 8;
    if (mem <= 4) return 4194304;
    if (mem <= 8) return 8388608;
    return 16777216;
}

let files = [];
let currentFolders = [];
let dirStack = [];
let currentIndex = 0;
let imageLayoutMode = localStorage.getItem('shoga-image-layout') || 'SINGLE';
let videoLayoutMode = localStorage.getItem('shoga-video-layout') || 'SINGLE';

function isVideoFile(file) {
    if (!file) return false;
    return file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(file.name);
}

function getCurrentLayoutMode() {
    if (files.length === 0 || currentIndex < 0 || currentIndex >= files.length) return imageLayoutMode;
    return isVideoFile(files[currentIndex]) ? videoLayoutMode : imageLayoutMode;
}

let readDir = localStorage.getItem('shoga-read-dir') || 'LTR';
let fitMode = localStorage.getItem('shoga-fit-mode') || 'AUTO';
let firstPageCover = localStorage.getItem('shoga-first-page-cover') === 'true';
let viewMode = 'IDLE';

let folderSortMode = 'name-asc';
let fileSortMode = 'name-asc';
const fileSortFn = (a, b) => {
    const aIsVideo = isVideoFile(a);
    const bIsVideo = isVideoFile(b);
    if (aIsVideo && !bIsVideo) return -1;
    if (!aIsVideo && bIsVideo) return 1;

    if (fileSortMode === 'name-asc') return a.name.localeCompare(b.name, undefined, { numeric: true });
    return b.name.localeCompare(a.name, undefined, { numeric: true });
};

let folderFilterText = '';
let fileFilterText = '';
let bookmarkFilterText = '';

let currentTitle = 'Shoga Viewer';
let bookmarks = [];
let isGridRendered = false;
let recentsEnabled = localStorage.getItem('shoga-recents-enabled') !== 'false';

let upscaleMode = localStorage.getItem('shoga-upscale-mode');
if (!upscaleMode) upscaleMode = 'BILINEAR';

let is4xEnabled = localStorage.getItem('shoga-4x-enabled') !== 'false';

const upscaleCache = new Map();

let preloadQueueTimer = null;
let isPreloading = false;

let isSingleFileMode = false;
let pendingBookmarkRestoreId = null;

let prevIndex = -1, nextIndex = -1;

const isHighMemMode = (navigator.deviceMemory || 8) >= 16;
const maxZoomLimit = 25;

let isLowEndHardware = false;

async function initializeHardwareDetection() {
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 4;
    const ua = navigator.userAgent.toLowerCase();

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const isSaveData = connection ? connection.saveData : false;

    let isARM = false;
    let isX86 = false;
    let archName = 'Unknown';

    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        try {
            const hints = await navigator.userAgentData.getHighEntropyValues(['architecture']);
            archName = hints.architecture ? hints.architecture.toLowerCase() : 'unknown';
            isARM = archName.includes('arm');
            isX86 = archName.includes('x86');
        } catch (e) { }
    }

    if (archName === 'Unknown' || archName === 'unknown') {
        isARM = ua.includes('arm') || ua.includes('aarch64');
        isX86 = !isARM && (ua.includes('x86') || ua.includes('x64') || ua.includes('win64') || ua.includes('wow64') || ua.includes('amd64') || ua.includes('intel'));
        archName = isARM ? 'ARM (Fallback)' : (isX86 ? 'x86/x64 (Fallback)' : 'Unknown');
    }

    const isMobile = ua.includes('mobi') || ua.includes('android') || ua.includes('iphone') || ua.includes('ipad') || ua.includes('tablet');
    const isCrOS = ua.includes('cros');

    let gpu = 'unknown';
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
            }
        }
    } catch (e) { }

    const isSoftwareGPU = gpu.includes('swiftshader') || gpu.includes('llvmpipe') || gpu.includes('software');

    let isLowEnd = false;
    let reason = '';

    if (isSaveData) {
        isLowEnd = true;
        reason = 'Data Saver Enabled';
    } else if (isSoftwareGPU) {
        isLowEnd = true;
        reason = `Software Rendering (${gpu})`;
    } else if (mem <= 4) {
        isLowEnd = true;
        reason = `Low Memory (${mem}GB)`;
    } else if (cores <= 4) {
        isLowEnd = true;
        reason = `Low Cores (${cores} cores)`;
    } else if (isCrOS && isARM) {
        isLowEnd = true;
        reason = `ARM Chromebook (${cores} cores, ${mem}GB)`;
    }

    const deviceType = isCrOS ? 'Chromebook' : (isMobile ? 'Mobile/Tablet' : 'Desktop');

    console.group('Hardware Detection');
    console.log(`Device Type: ${deviceType}`);
    console.log(`Architecture: ${archName}`);
    console.log(`Memory: ~${mem} GB`);
    console.log(`Logical Cores: ${cores}`);
    console.log(`GPU: ${gpu}`);
    console.log(`Data Saver: ${isSaveData ? 'On' : 'Off'}`);
    console.log(`Result: ${isLowEnd ? 'Low-End' : 'Good'} (${reason || 'Standard'})`);

    if (isLowEnd) {
        console.warn('Low-End Hardware Detected: Applying Optimizations...');
    }
    console.groupEnd();

    isLowEndHardware = isLowEnd;
}
initializeHardwareDetection();

let currentZoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let isDragging = false;
let axisLocked = null;

let startX = 0, startY = 0;
let initialPanX = 0, initialPanY = 0;
let pointers = [];
let maxPointersDuringTap = 0;
let initialDistance = 0, initialZoom = 1;

let lastTap = 0;
let lastSingleTapTime = 0;
let singleTapTimeout = null;

let navTimeout = null;
let pendingIndex = null;
let adjacentSlotTimer = null;

let upscaleDebounceTimer = null;
let currentRenderToken = 0;
let currentAnimationId = null;
let bounceBackTimer = null;

const urlCache = new Map();

const DB_NAME = 'ShogaViewerDB';
const STORE_HANDLES = 'FileSystemHandles';
const STORE_BOOKMARKS = 'Bookmarks';

let upscaleTasks = 0;
let taskQueue = [];
let isTaskProcessing = false;

async function checkAnimated(file) {
    if (!file) return false;
    if (file.isJellyfin) return false;
    if (file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(file.name)) return true;
    if (file.isAnimated !== undefined) return file.isAnimated;
    if (file.type !== 'image/webp' && file.type !== 'image/gif') {
        file.isAnimated = false;
        return false;
    }
    try {
        const buffer = await file.slice(0, 1024).arrayBuffer();
        const view = new Uint8Array(buffer);
        if (file.type === 'image/webp') {
            if (view.length >= 21 &&
                view[0] === 82 && view[1] === 73 && view[2] === 70 && view[3] === 70 &&
                view[8] === 87 && view[9] === 69 && view[10] === 66 && view[11] === 80) {
                let offset = 12;
                while (offset + 8 <= view.length) {
                    const chunkId = String.fromCharCode(view[offset], view[offset + 1], view[offset + 2], view[offset + 3]);
                    if (chunkId === 'VP8X') {
                        const flags = view[offset + 8];
                        file.isAnimated = (flags & 2) !== 0;
                        return file.isAnimated;
                    }
                    const chunkSize = view[offset + 4] | (view[offset + 5] << 8) | (view[offset + 6] << 16) | (view[offset + 7] << 24);
                    offset += 8 + chunkSize + (chunkSize % 2);
                }
            }
            file.isAnimated = false;
        } else if (file.type === 'image/gif') {
            const str = String.fromCharCode.apply(null, view);
            file.isAnimated = str.includes('NETSCAPE2.0');
        }
    } catch (e) {
        console.error('Error checking animation:', e);
        file.isAnimated = false;
    }
    return file.isAnimated;
}

async function processTaskQueue() {
    if (isTaskProcessing) return;
    isTaskProcessing = true;
    while (taskQueue.length > 0) {
        const task = taskQueue.shift();
        if (task.isValid()) {
            try {
                await task.run();
            } catch (e) {
                console.error('Task failed', e);
            }
        } else {
            if (task.onCancel) task.onCancel();
        }
    }
    isTaskProcessing = false;
}

function enqueueTask(isValid, run, onCancel) {
    taskQueue.push({ isValid, run, onCancel });
    processTaskQueue();
}

let ffmpegInstance = null;
let isTranscoding = false;
let transcodeAbortController = null;

async function loadFFmpeg() {
    if (ffmpegInstance) return ffmpegInstance;
    if (!window.FFmpeg) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = './unpkg/ffmpeg.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = './unpkg/index.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    const { FFmpeg } = window.FFmpeg;
    ffmpegInstance = new FFmpeg();
    await ffmpegInstance.load({
        coreURL: './unpkg/ffmpeg-core.js',
        wasmURL: './unpkg/ffmpeg-core.wasm',
    });
    return ffmpegInstance;
}

async function handleVideoTranscode(file, idx, videoEl) {
    if (file.isJellyfin) {
        file.isBroken = true;
        const errDiv = document.createElement('div');
        errDiv.className = 'broken-file-ui' + (videoEl.className ? ' ' + videoEl.className : '');
        errDiv.style.display = 'flex';
        errDiv.style.flexDirection = 'column';
        errDiv.style.alignItems = 'center';
        errDiv.style.justifyContent = 'center';
        errDiv.style.width = '100%';
        errDiv.style.height = '100%';
        errDiv.style.color = '#ef4444';
        errDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
        errDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div style="margin-top:10px; font-size:0.8rem; font-weight:600; letter-spacing:1px;">SERVER STREAM ERROR</div>`;
        if (videoEl.parentNode) {
            videoEl.parentNode.replaceChild(errDiv, videoEl);
        }
        return;
    }
    if (isTranscoding) return;

    if (isLowEndHardware && localStorage.getItem('shoga-hide-transcode-warning') !== 'true') {
        const proceed = await new Promise((resolve) => {
            const modal = document.getElementById('transcode-warning-modal');
            const btnCancel = document.getElementById('btn-tw-cancel');
            const btnProceed = document.getElementById('btn-tw-proceed');
            const cbSkip = document.getElementById('transcode-warning-skip');

            modal.classList.add('active');

            const cleanup = (result) => {
                modal.classList.remove('active');
                btnCancel.onclick = null;
                btnProceed.onclick = null;
                if (result && cbSkip.checked) {
                    localStorage.setItem('shoga-hide-transcode-warning', 'true');
                }
                resolve(result);
            };

            btnCancel.onclick = () => cleanup(false);
            btnProceed.onclick = () => cleanup(true);
        });

        if (!proceed) {
            file.isBroken = true;
            const errDiv = document.createElement('div');
            errDiv.className = 'broken-file-ui' + (videoEl.className ? ' ' + videoEl.className : '');
            errDiv.style.display = 'flex';
            errDiv.style.flexDirection = 'column';
            errDiv.style.alignItems = 'center';
            errDiv.style.justifyContent = 'center';
            errDiv.style.width = '100%';
            errDiv.style.height = '100%';
            errDiv.style.color = '#ef4444';
            errDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
            errDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div style="margin-top:10px; font-size:0.8rem; font-weight:600; letter-spacing:1px;">TRANSCODE CANCELLED</div>`;
            if (videoEl.parentNode) {
                videoEl.parentNode.replaceChild(errDiv, videoEl);
            }
            return;
        }
    }

    isTranscoding = true;

    const modal = document.getElementById('transcode-modal');
    const progressBar = document.getElementById('transcode-progress-bar');
    const progressText = document.getElementById('transcode-progress-text');
    const btnCancel = document.getElementById('btn-transcode-cancel');

    modal.classList.add('active');
    progressBar.style.width = '0%';
    progressText.textContent = '0%';

    transcodeAbortController = new AbortController();

    const cleanup = () => {
        isTranscoding = false;
        modal.classList.remove('active');
        btnCancel.onclick = null;
        transcodeAbortController = null;
    };

    btnCancel.onclick = () => {
        if (ffmpegInstance) {
            try { ffmpegInstance.terminate(); } catch (e) { }
            ffmpegInstance = null;
        }
        if (transcodeAbortController) transcodeAbortController.abort();
        cleanup();

        file.isBroken = true;
        const errDiv = document.createElement('div');
        errDiv.className = 'broken-file-ui' + (videoEl.className ? ' ' + videoEl.className : '');
        errDiv.style.display = 'flex';
        errDiv.style.flexDirection = 'column';
        errDiv.style.alignItems = 'center';
        errDiv.style.justifyContent = 'center';
        errDiv.style.width = '100%';
        errDiv.style.height = '100%';
        errDiv.style.color = '#ef4444';
        errDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
        errDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div style="margin-top:10px; font-size:0.8rem; font-weight:600; letter-spacing:1px;">TRANSCODE CANCELLED</div>`;
        if (videoEl.parentNode) {
            videoEl.parentNode.replaceChild(errDiv, videoEl);
        }
    };

    try {
        const ffmpeg = await loadFFmpeg();
        const { fetchFile } = window.FFmpegUtil;

        ffmpeg.on('progress', ({ progress }) => {
            const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
            progressBar.style.width = `${percent}%`;
            progressText.textContent = `${percent}%`;
        });

        const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
        const outputName = 'output.mp4';

        await ffmpeg.writeFile(inputName, await fetchFile(file));

        await ffmpeg.exec(['-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', outputName]);

        if (transcodeAbortController && transcodeAbortController.signal.aborted) throw new Error('Aborted');

        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        const newUrl = URL.createObjectURL(blob);

        const oldUrl = urlCache.get(idx);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        urlCache.set(idx, newUrl);

        files[idx] = new File([blob], file.name + '.mp4', { type: 'video/mp4' });

        videoEl.src = newUrl;
        videoEl.play().catch(e => { });

        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);

        cleanup();
    } catch (e) {
        console.error('Transcoding failed:', e);
        if (isTranscoding) btnCancel.click();
    }
}

function showUpscaleIndicator() {
    upscaleTasks++;
    document.getElementById('upscale-indicator').style.display = 'flex';
    document.getElementById('btn-save').disabled = true;
}
function hideUpscaleIndicator() {
    upscaleTasks = Math.max(0, upscaleTasks - 1);
    if (upscaleTasks === 0) {
        document.getElementById('upscale-indicator').style.display = 'none';
        document.getElementById('btn-save').disabled = false;
    }
}

function showLoading(title = 'PROCESSING', text = '') {
    const overlay = document.getElementById('loading-overlay');
    const titleEl = overlay.querySelector('div:nth-child(2)');
    if (titleEl) titleEl.textContent = title;
    if (dom.loadingProgress) dom.loadingProgress.textContent = text;
    overlay.style.display = 'flex';
}
function updateLoading(text) {
    if (dom.loadingProgress) dom.loadingProgress.textContent = text;
}
function hideLoading() {
    if (dom.loadingProgress) dom.loadingProgress.textContent = '';
    document.getElementById('loading-overlay').style.display = 'none';
}

let _dbInstance = null;
function initDB() {
    if (_dbInstance) return Promise.resolve(_dbInstance);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 3);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_HANDLES)) {
                db.createObjectStore(STORE_HANDLES);
            }
            if (!db.objectStoreNames.contains(STORE_BOOKMARKS)) {
                db.createObjectStore(STORE_BOOKMARKS, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => {
            _dbInstance = e.target.result;
            _dbInstance.onclose = () => { _dbInstance = null; };
            _dbInstance.onversionchange = () => { _dbInstance.close(); _dbInstance = null; };
            resolve(_dbInstance);
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveBookmarkToDB(bookmark) {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
                tx.objectStore(STORE_BOOKMARKS).put(bookmark);
                tx.oncomplete = () => { resolve(); };
                tx.onerror = (e) => { reject(e.target.error); };
            } catch (err) {
                reject(err);
            }
        });
    } catch (e) { throw e; }
}

async function loadBookmarksFromDB() {
    try {
        const db = await initDB();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_BOOKMARKS, 'readonly');
                const req = tx.objectStore(STORE_BOOKMARKS).getAll();
                req.onsuccess = () => { resolve(req.result || []); };
                req.onerror = () => { resolve([]); };
            } catch (err) {
                resolve([]);
            }
        });
    } catch (e) {
        return [];
    }
}

async function deleteBookmarkFromDB(id) {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
                tx.objectStore(STORE_BOOKMARKS).delete(id);
                tx.oncomplete = () => { resolve(); };
                tx.onerror = (e) => { reject(e.target.error); };
            } catch (err) {
                reject(err);
            }
        });
    } catch (e) { throw e; }
}

async function saveDirHandle(handle) {
    if (!recentsEnabled) return;
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_HANDLES, 'readwrite');
                const store = tx.objectStore(STORE_HANDLES);
                const req = store.get('recent-handles');
                req.onsuccess = () => {
                    try {
                        let handles = req.result || [];
                        handles = handles.filter(h => h.name !== handle.name);
                        handles.unshift({ name: handle.name, handle: handle, ts: Date.now() });
                        handles = handles.slice(0, 5);
                        store.put(handles, 'recent-handles');
                    } catch (e) {
                        try { tx.abort(); } catch (e2) { }
                        reject(e);
                    }
                };
                tx.oncomplete = () => { resolve(); };
                tx.onerror = (e) => { reject(e.target.error); };
            } catch (err) {
                reject(err);
            }
        });
    } catch (err) { }
}

async function loadDirHandles() {
    try {
        const db = await initDB();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_HANDLES, 'readonly');
                const req = tx.objectStore(STORE_HANDLES).get('recent-handles');
                req.onsuccess = () => { resolve(req.result || []); };
                req.onerror = () => { resolve([]); };
            } catch (err) {
                resolve([]);
            }
        });
    } catch (err) { return []; }
}

async function clearDirHandles() {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_HANDLES, 'readwrite');
                tx.objectStore(STORE_HANDLES).delete('recent-handles');
                tx.oncomplete = () => { resolve(); };
                tx.onerror = (e) => { reject(e.target.error); };
            } catch (err) {
                reject(err);
            }
        });
    } catch (e) { }
}

async function verifyPermission(fileHandle) {
    try {
        const options = { mode: 'read' };
        if ((await fileHandle.queryPermission(options)) === 'granted') return true;
        if ((await fileHandle.requestPermission(options)) === 'granted') return true;
        return false;
    } catch (e) {
        return false;
    }
}

const dom = {
    body: document.body,
    topBar: document.getElementById('top-bar'),
    btnOpenMain: document.getElementById('btn-open-main'),
    openDropdown: document.getElementById('open-dropdown'),
    btnSave: document.getElementById('btn-save'),
    btnHome: document.getElementById('btn-home'),
    btnOpenFiles: document.getElementById('btn-open-files'),
    btnOpenDir: document.getElementById('btn-open-dir'),
    btnOpenJellyfin: document.getElementById('btn-open-jellyfin'),
    jellyfinModal: document.getElementById('jellyfin-modal'),
    jfUrl: document.getElementById('jf-url'),
    jfUser: document.getElementById('jf-user'),
    jfPass: document.getElementById('jf-pass'),
    jfAutoLogin: document.getElementById('jf-auto-login'),
    jfError: document.getElementById('jf-error'),
    btnJfCancel: document.getElementById('btn-jf-cancel'),
    btnJfConnect: document.getElementById('btn-jf-connect'),
    fallbackInputFiles: document.getElementById('fallback-input-files'),
    fallbackInputDir: document.getElementById('fallback-input-dir'),
    recentsSection: document.getElementById('recents-section'),
    btnToggleRecents: document.getElementById('btn-toggle-recents'),
    btnClearRecents: document.getElementById('btn-clear-recents'),
    recentsList: document.getElementById('recents-list'),
    btnGrid: document.getElementById('btn-grid'),
    btnInfo: document.getElementById('btn-info'),
    btnBookmarks: document.getElementById('btn-bookmarks'),
    btnSettings: document.getElementById('btn-settings'),
    settingsPanel: document.getElementById('settings-panel'),
    coverSettingGroup: document.getElementById('cover-setting-group'),
    infoPanel: document.getElementById('info-panel'),
    infoContent: document.getElementById('info-content'),
    licensePanel: document.getElementById('license-panel'),
    attributionLink: document.querySelector('.attribution-link'),
    bookmarksPanel: document.getElementById('bookmarks-panel'),
    btnAddBookmark: document.getElementById('btn-add-bookmark'),
    btnClearBookmarks: document.getElementById('btn-clear-bookmarks'),
    btnSearchBookmarks: document.getElementById('btn-search-bookmarks'),
    bookmarkSearchWrapper: document.getElementById('bookmark-search-wrapper'),
    bookmarkFilterInput: document.getElementById('bookmark-filter-input'),
    bookmarkClearBtn: document.getElementById('bookmark-clear-btn'),
    bookmarksList: document.getElementById('bookmarks-list'),
    loadingProgress: document.getElementById('loading-progress'),
    idleScreen: document.getElementById('idle-screen'),
    ptrIndicator: document.getElementById('ptr-indicator'),
    gridArea: document.getElementById('grid-area'),
    viewerArea: document.getElementById('viewer-area'),
    viewerSlider: document.getElementById('viewer-slider'),
    viewerContent: document.getElementById('viewer-content'),
    slots: {
        prev: document.getElementById('slot-prev'),
        curr: document.getElementById('slot-curr'),
        next: document.getElementById('slot-next')
    }
};

dom.btnSave.style.display = 'none';

const savedJfUrl = localStorage.getItem('shoga-jf-url');
if (savedJfUrl) dom.jfUrl.value = savedJfUrl;

const __swipeStyle = document.createElement('style');
__swipeStyle.textContent = `
    html, body { overscroll-behavior-x: none !important; }
    #grid-area, #bookmarks-panel { touch-action: pan-y !important; }
`;
document.head.appendChild(__swipeStyle);

function switchToIdle() {
    pointers = []; isPanning = false; isDragging = false; isGridSwiping = false; isGridPulling = false; initialDistance = 0;
    viewMode = 'IDLE';
    dom.gridArea.style.display = 'none';
    dom.viewerArea.style.display = 'none';
    dom.btnGrid.style.display = 'none';
    dom.btnInfo.style.display = 'none';
    dom.btnSave.style.display = 'none';
    dom.idleScreen.style.display = 'flex';
    dom.body.classList.remove('ui-hidden');
}

(async () => {
    bookmarks = await loadBookmarksFromDB();
    renderBookmarks();
    if (window.showDirectoryPicker) {
        dom.recentsSection.style.display = 'block';
        dom.btnToggleRecents.textContent = recentsEnabled ? 'ON' : 'OFF';
        dom.btnToggleRecents.classList.toggle('off', !recentsEnabled);
        renderRecents();
    }

    document.getElementById('upscale-off').classList.remove('active');
    if (upscaleMode === 'BILINEAR') {
        document.getElementById('upscale-bilinear').classList.add('active');
    } else if (upscaleMode === 'ADPTV_SHOGA') {
        document.getElementById('upscale-adptv').classList.add('active');
    } else if (upscaleMode === 'FSR') {
        document.getElementById('upscale-fsr').classList.add('active');
    } else if (upscaleMode === 'XBRZ') {
        document.getElementById('upscale-xbrz').classList.add('active');
    } else if (upscaleMode === 'ANIME4K') {
        document.getElementById('upscale-anime4k').classList.add('active');
    } else {
        document.getElementById('upscale-off').classList.add('active');
    }

    document.querySelectorAll('#mode-single, #mode-spread').forEach(b => b.classList.remove('active'));
    document.getElementById(imageLayoutMode === 'SINGLE' ? 'mode-single' : 'mode-spread').classList.add('active');
    if (imageLayoutMode === 'SPREAD') dom.coverSettingGroup.classList.add('visible');
    else dom.coverSettingGroup.classList.remove('visible');

    document.querySelectorAll('#cover-inline, #cover-isolated').forEach(b => b.classList.remove('active'));
    document.getElementById(firstPageCover ? 'cover-isolated' : 'cover-inline').classList.add('active');

    document.querySelectorAll('#dir-ltr, #dir-rtl').forEach(b => b.classList.remove('active'));
    document.getElementById(readDir === 'LTR' ? 'dir-ltr' : 'dir-rtl').classList.add('active');

    document.querySelectorAll('#fit-auto, #fit-contain, #fit-width, #fit-height, #fit-original').forEach(b => b.classList.remove('active'));
    document.getElementById('fit-' + fitMode.toLowerCase()).classList.add('active');

    const x4Tag = document.getElementById('upscale-x4-tag');

    if (isHighMemMode) {
        x4Tag.style.display = 'inline';
        x4Tag.style.color = is4xEnabled ? '#3a82f6' : '#666666';

        x4Tag.addEventListener('click', () => {
            is4xEnabled = !is4xEnabled;
            localStorage.setItem('shoga-4x-enabled', is4xEnabled);
            x4Tag.style.color = is4xEnabled ? '#3a82f6' : '#666666';

            if (upscaleMode !== 'OFF') {
                for (let [k, v] of upscaleCache.entries()) {
                    if (v === 'error') upscaleCache.delete(k);
                }
                clearTimeout(upscaleDebounceTimer);
                upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 300);
                startPreloadQueue();
            }
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const imgUrl = urlParams.get('imgUrl');
    if (imgUrl) {
        showLoading('DOWNLOADING', 'Fetching remote image...');
        try {
            const resp = await fetch(imgUrl);
            const blob = await resp.blob();
            const fileName = imgUrl.split('/').pop().split('?')[0] || 'remote-image';
            const file = new File([blob], fileName, { type: blob.type });
            processFileList([file], 'REMOTE IMAGE');
        } catch (e) { }
        finally { hideLoading(); }
    }
})();

function closeAllPanels() {
    dom.settingsPanel.classList.add('hidden');
    dom.btnSettings.setAttribute('aria-expanded', 'false');
    dom.infoPanel.classList.add('hidden');
    dom.licensePanel.classList.add('hidden');
    dom.openDropdown.classList.remove('active');
    dom.btnOpenMain.setAttribute('aria-expanded', 'false');
    dom.bookmarksPanel.classList.remove('active');
    dom.btnBookmarks.setAttribute('aria-expanded', 'false');
}

function showSearchChoiceModal() {
    return new Promise((resolve) => {
        let modal = document.getElementById('search-choice-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'search-choice-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="panel-title" style="font-size: 0.9rem; color: var(--text-primary); border: none;">SEARCH NAVIGATION</div>
                    <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin: 5px 0 10px 0;">Select the target for your search:</div>
                    <div class="button-group">
                        <button id="modal-search-file">FILE</button>
                        <button id="modal-search-folder">FOLDER</button>
                    </div>
                    <button id="modal-search-cancel" style="background: transparent; border: 1px solid rgba(255,255,255,0.1); margin-top: 5px;">CANCEL</button>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const btnFile = document.getElementById('modal-search-file');
        const btnFolder = document.getElementById('modal-search-folder');
        const btnCancel = document.getElementById('modal-search-cancel');

        modal.classList.add('active');

        const cleanup = (result) => {
            modal.classList.remove('active');
            btnFile.onclick = null;
            btnFolder.onclick = null;
            if (btnCancel) btnCancel.onclick = null;
            resolve(result);
        };

        btnFile.onclick = () => cleanup('file');
        btnFolder.onclick = () => cleanup('folder');
        if (btnCancel) btnCancel.onclick = () => cleanup(null);
        modal.onclick = (e) => { if (e.target === modal) cleanup(null); };
    });
}

const lazyThumbnailObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const canvas = entry.target;
            const file = canvas.fileData;
            if (file) {
                generateHighPerfThumbnail(file, canvas);
                lazyThumbnailObserver.unobserve(canvas);
            }
        }
    });
}, { root: dom.gridArea, rootMargin: '200px' });

async function generateHighPerfThumbnail(file, canvas) {
    const THUMB_SIZE = isLowEndHardware ? 150 : 300;
    if (file.isJellyfin) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = `${file.serverUrl}/Items/${file.id}/Images/Primary?fillWidth=${THUMB_SIZE}&api_key=${file.accessToken}`;
        img.onload = () => {
            canvas.width = THUMB_SIZE;
            canvas.height = THUMB_SIZE * (img.height / img.width);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            if (file.type.startsWith('video/')) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.beginPath();
                ctx.arc(canvas.width / 2, canvas.height / 2, 20, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.moveTo(canvas.width / 2 - 6, canvas.height / 2 - 8);
                ctx.lineTo(canvas.width / 2 + 10, canvas.height / 2);
                ctx.lineTo(canvas.width / 2 - 6, canvas.height / 2 + 8);
                ctx.fill();
            }
            canvas.classList.add('loaded');
        };
        img.onerror = (e) => {
            console.error(`[Thumbnail Error] Jellyfin image load failed for: ${file.name}`, e);
            file.isBroken = true;
            canvas.width = THUMB_SIZE;
            canvas.height = THUMB_SIZE;
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(canvas.width * 0.33, canvas.height * 0.33); ctx.lineTo(canvas.width * 0.66, canvas.height * 0.66);
            ctx.moveTo(canvas.width * 0.66, canvas.height * 0.33); ctx.lineTo(canvas.width * 0.33, canvas.height * 0.66);
            ctx.stroke();
            canvas.classList.add('loaded');
        };
        return;
    }
    if (file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(file.name)) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.playsInline = true;
        video.currentTime = 1;
        video.onloadeddata = () => {
            if (video.currentTime === 0) video.currentTime = 1;
        };
        video.onseeked = () => {
            canvas.width = THUMB_SIZE;
            canvas.height = THUMB_SIZE * (video.videoHeight / video.videoWidth);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(canvas.width / 2 - 6, canvas.height / 2 - 8);
            ctx.lineTo(canvas.width / 2 + 10, canvas.height / 2);
            ctx.lineTo(canvas.width / 2 - 6, canvas.height / 2 + 8);
            ctx.fill();

            URL.revokeObjectURL(video.src);
            canvas.classList.add('loaded');
        };
        video.onerror = (e) => {
            console.error(`[Thumbnail Error] Local video load failed for: ${file.name}`, video.error || e);
            file.isBroken = true;
            canvas.width = THUMB_SIZE;
            canvas.height = THUMB_SIZE;
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(canvas.width * 0.33, canvas.height * 0.33); ctx.lineTo(canvas.width * 0.66, canvas.height * 0.66);
            ctx.moveTo(canvas.width * 0.66, canvas.height * 0.33); ctx.lineTo(canvas.width * 0.33, canvas.height * 0.66);
            ctx.stroke();
            URL.revokeObjectURL(video.src);
            canvas.classList.add('loaded');
        };
        return;
    }
    try {
        const bmp = await createImageBitmap(file, { resizeWidth: THUMB_SIZE, resizeQuality: 'low' });
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        canvas.classList.add('loaded');
    } catch (e) {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                img.onerror();
                return;
            }
            canvas.width = THUMB_SIZE;
            canvas.height = THUMB_SIZE * (img.height / img.width);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(img.src);
            canvas.classList.add('loaded');
        };
        img.onerror = (e) => {
            console.error(`[Thumbnail Error] Local image load failed for: ${file.name}`, e);
            file.isBroken = true;
            canvas.width = THUMB_SIZE;
            canvas.height = THUMB_SIZE;
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(canvas.width * 0.33, canvas.height * 0.33); ctx.lineTo(canvas.width * 0.66, canvas.height * 0.66);
            ctx.moveTo(canvas.width * 0.66, canvas.height * 0.33); ctx.lineTo(canvas.width * 0.33, canvas.height * 0.66);
            ctx.stroke();
            URL.revokeObjectURL(img.src);
            canvas.classList.add('loaded');
        };
    }
}

async function captureThumbnail() {
    const group = getSpreadGroup(currentIndex);

    if (group.length === 1) {
        const gridItem = document.querySelector(`.grid-item[data-index="${group[0]}"] canvas.loaded`);
        if (gridItem) return gridItem.toDataURL('image/jpeg', 0.8);
    } else if (group.length === 2) {
        const canvasL = document.querySelector(`.grid-item[data-index="${readDir === 'LTR' ? group[0] : group[1]}"] canvas.loaded`);
        const canvasR = document.querySelector(`.grid-item[data-index="${readDir === 'LTR' ? group[1] : group[0]}"] canvas.loaded`);
        if (canvasL && canvasR) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasL.width + canvasR.width;
            tempCanvas.height = Math.max(canvasL.height, canvasR.height);
            const ctx = tempCanvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            ctx.drawImage(canvasL, 0, (tempCanvas.height - canvasL.height) / 2);
            ctx.drawImage(canvasR, canvasL.width, (tempCanvas.height - canvasR.height) / 2);
            return tempCanvas.toDataURL('image/jpeg', 0.8);
        }
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });

    const THUMB_W = isLowEndHardware ? 200 : 400;
    const THUMB_W_HALF = isLowEndHardware ? 100 : 200;
    const THUMB_H_DEFAULT = isLowEndHardware ? 150 : 300;

    const getBmp = async (file, targetWidth) => {
        if (file.isJellyfin) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = `${file.serverUrl}/Items/${file.id}/Images/Primary?fillWidth=${targetWidth}&api_key=${file.accessToken}`;
            });
        }
        return await createImageBitmap(file, { resizeWidth: targetWidth });
    };

    let bmp = null, bmpL = null, bmpR = null;
    try {
        if (group.length === 1) {
            bmp = await getBmp(files[group[0]], THUMB_W);
            canvas.width = bmp.width || bmp.naturalWidth;
            canvas.height = bmp.height || bmp.naturalHeight;
            ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        } else if (group.length === 2) {
            let idxLeft = readDir === 'LTR' ? group[0] : group[1];
            let idxRight = readDir === 'LTR' ? group[1] : group[0];

            bmpL = await getBmp(files[idxLeft], THUMB_W_HALF);
            bmpR = await getBmp(files[idxRight], THUMB_W_HALF);

            const wL = bmpL.width || bmpL.naturalWidth;
            const hL = bmpL.height || bmpL.naturalHeight;
            const wR = bmpR.width || bmpR.naturalWidth;
            const hR = bmpR.height || bmpR.naturalHeight;

            canvas.width = wL + wR;
            canvas.height = Math.max(hL, hR);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.drawImage(bmpL, 0, (canvas.height - hL) / 2, wL, hL);
            ctx.drawImage(bmpR, wL, (canvas.height - hR) / 2, wR, hR);
        }
        return canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
        canvas.width = THUMB_W; canvas.height = THUMB_H_DEFAULT;
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, THUMB_W, THUMB_H_DEFAULT);
        return canvas.toDataURL('image/jpeg', 0.8);
    } finally {
        if (bmp && bmp.close) bmp.close();
        if (bmpL && bmpL.close) bmpL.close();
        if (bmpR && bmpR.close) bmpR.close();
        canvas.width = 0; canvas.height = 0;
    }
}

async function renderRecents() {
    dom.recentsList.innerHTML = '';
    const handles = await loadDirHandles();
    handles.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'recent-item';
        btn.textContent = item.name;
        btn.style.fontSize = '0.75rem';
        btn.addEventListener('click', async () => {
            dom.openDropdown.classList.remove('active');
            if (await verifyPermission(item.handle)) {
                dirStack = [{ handle: item.handle, name: item.name }];
                await processDirectoryHandle(item.handle, item.name);
            }
        });
        dom.recentsList.appendChild(btn);
    });
    if (handles.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '10px 15px';
        empty.style.color = 'var(--text-secondary)';
        empty.style.fontSize = '0.7rem';
        empty.style.textAlign = 'center';
        empty.textContent = 'NO RECENT SESSIONS';
        dom.recentsList.appendChild(empty);
    }
}

dom.btnToggleRecents.addEventListener('click', (e) => {
    e.stopPropagation();
    recentsEnabled = !recentsEnabled;
    localStorage.setItem('shoga-recents-enabled', recentsEnabled);
    dom.btnToggleRecents.textContent = recentsEnabled ? 'ON' : 'OFF';
    dom.btnToggleRecents.classList.toggle('off', !recentsEnabled);
});

dom.btnClearRecents.addEventListener('click', async (e) => {
    e.stopPropagation();
    await clearDirHandles();
    renderRecents();
});

function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-modal');
        const titleEl = document.getElementById('modal-title');
        const messageEl = document.getElementById('modal-message');
        const btnCancel = document.getElementById('modal-cancel');
        const btnConfirm = document.getElementById('modal-confirm');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.classList.add('active');

        const cleanup = (result) => {
            modal.classList.remove('active');
            btnConfirm.onclick = null;
            btnCancel.onclick = null;
            resolve(result);
        };

        btnConfirm.onclick = () => cleanup(true);
        btnCancel.onclick = () => cleanup(false);
        modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    });
}

function showAlertModal(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('alert-modal');
        const titleEl = document.getElementById('alert-modal-title');
        const messageEl = document.getElementById('alert-modal-message');
        const btnOk = document.getElementById('alert-modal-ok');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.classList.add('active');

        const cleanup = () => {
            modal.classList.remove('active');
            btnOk.onclick = null;
            resolve();
        };

        btnOk.onclick = () => cleanup();
    });
}

const toggleBookmarkClearBtn = () => {
    if (dom.bookmarkFilterInput.value) {
        dom.bookmarkClearBtn.style.opacity = '1';
        dom.bookmarkClearBtn.style.pointerEvents = 'auto';
    } else {
        dom.bookmarkClearBtn.style.opacity = '0';
        dom.bookmarkClearBtn.style.pointerEvents = 'none';
    }
}

const applyBookmarkFilter = () => {
    let filterStyleEl = document.getElementById('bookmark-filter-style');
    if (!filterStyleEl) {
        filterStyleEl = document.createElement('style');
        filterStyleEl.id = 'bookmark-filter-style';
        document.head.appendChild(filterStyleEl);
    }
    if (bookmarkFilterText) {
        const safeQuery = bookmarkFilterText.toLowerCase().replace(/(["\\])/g, '\\$1');
        filterStyleEl.textContent = `.bookmark-item:not([data-search*="${safeQuery}"]) { display: none !important; }`;
    } else {
        filterStyleEl.textContent = '';
    }
};

dom.btnSearchBookmarks.addEventListener('click', () => {
    dom.bookmarkSearchWrapper.classList.toggle('visible');
    if (dom.bookmarkSearchWrapper.classList.contains('visible')) {
        dom.bookmarkFilterInput.focus();
    } else {
        dom.bookmarkFilterInput.value = '';
        bookmarkFilterText = '';
        applyBookmarkFilter();
        toggleBookmarkClearBtn();
    }
});

dom.bookmarkFilterInput.addEventListener('input', (e) => {
    bookmarkFilterText = e.target.value;
    toggleBookmarkClearBtn();
    applyBookmarkFilter();
});

dom.bookmarkClearBtn.addEventListener('click', () => {
    dom.bookmarkFilterInput.value = '';
    bookmarkFilterText = '';
    toggleBookmarkClearBtn();
    applyBookmarkFilter();
    dom.bookmarkFilterInput.focus();
});

function renderBookmarks() {
    const oldRects = new Map();
    Array.from(dom.bookmarksList.children).forEach(child => {
        if (child.dataset.id) {
            oldRects.set(child.dataset.id, child.getBoundingClientRect().top);
        }
    });

    dom.bookmarksList.innerHTML = '';
    bookmarks.sort((a, b) => b.lastAccessed - a.lastAccessed).forEach(bk => {
        const el = document.createElement('div');
        el.className = 'bookmark-item';
        el.dataset.id = bk.id;
        el.dataset.search = bk.title.toLowerCase();
        el.innerHTML = `
            <div style="position:relative;">
                <img class="bookmark-thumb" src="${bk.thumbnail}">
                <button class="btn-delete-bookmark" style="position:absolute; top:5px; right:5px; padding:4px; background:rgba(0,0,0,0.6); border:none; border-radius:50%; min-width:auto;">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="#ef4444" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="bookmark-title">${escapeHtml(bk.title)}</div>
            <div class="bookmark-meta">Page ${bk.state.currentIndex + 1} / ${bk.state.fileNames.length} • ${bk.state.layoutMode}</div>
        `;
        el.addEventListener('click', async (e) => {
            if (e.target.closest('.btn-delete-bookmark')) {
                e.stopPropagation();
                const confirmed = await showConfirmModal('DELETE BOOKMARK', `Remove "${bk.title}"?`);
                if (!confirmed) return;

                bookmarks = bookmarks.filter(b => b.id !== bk.id);
                try {
                    await deleteBookmarkFromDB(bk.id);
                } catch (err) { console.error(err); }
                renderBookmarks();
            } else {
                await restoreBookmark(bk.id);
            }
        });
        dom.bookmarksList.appendChild(el);
    });

    if (oldRects.size > 0) {
        Array.from(dom.bookmarksList.children).forEach(child => {
            const id = child.dataset.id;
            const oldTop = oldRects.get(id);
            if (oldTop !== undefined) {
                const newTop = child.getBoundingClientRect().top;
                const deltaY = oldTop - newTop;
                if (deltaY !== 0) {
                    child.style.transform = `translateY(${deltaY}px)`;
                    child.style.transition = 'none';
                    requestAnimationFrame(() => {
                        child.style.transform = '';
                        child.style.transition = 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), background 0.2s';
                    });
                }
            }
        });
    }
}

async function restoreBookmark(id) {
    const bk = bookmarks.find(b => b.id === id);
    if (!bk) return;

    bk.lastAccessed = Date.now();
    try {
        await saveBookmarkToDB(bk);
    } catch (err) { console.error(err); }

    renderBookmarks();
    dom.bookmarksList.scrollTo({ top: 0, behavior: 'smooth' });

    dom.bookmarksList.style.pointerEvents = 'none';
    await new Promise(resolve => setTimeout(resolve, 350));
    dom.bookmarksList.style.pointerEvents = 'auto';

    let restoredFiles = [];

    if (currentTitle === bk.title) {
        const nameMap = new Map();
        files.forEach(f => nameMap.set(f.name, f));

        bk.state.fileNames.forEach(name => {
            if (nameMap.has(name)) restoredFiles.push(nameMap.get(name));
        });
    }

    if (restoredFiles.length === 0) {
        let autoRestored = false;

        if (bk.state.dirStack && bk.state.dirStack.length > 0) {
            const target = bk.state.dirStack[bk.state.dirStack.length - 1];
            try {
                if (target.isJellyfin) {
                    if (!jellyfinConfig.accessToken) {
                        pendingBookmarkRestoreId = id;
                        closeAllPanels();
                        switchToIdle();
                        dom.jellyfinModal.classList.add('active');
                        return;
                    }
                    const { serverUrl, accessToken, userId } = jellyfinConfig;
                    let url = `${serverUrl}/Users/${userId}/Items?Fields=PrimaryImageAspectRatio,MediaSources&SortBy=SortName`;
                    if (target.id) url += `&ParentId=${target.id}`;

                    const res = await fetch(url, { headers: { 'X-Emby-Token': accessToken } });
                    if (res.ok) {
                        const data = await res.json();
                        const newFolders = [];
                        const newFiles = [];
                        data.Items.forEach(item => {
                            if (item.IsFolder) {
                                newFolders.push({ name: item.Name, isJellyfin: true, id: item.Id });
                            } else if (item.MediaType === 'Video' || item.MediaType === 'Photo') {
                                let mimeType = item.MediaType === 'Video' ? 'video/mp4' : 'image/jpeg';
                                let ext = item.MediaType === 'Video' ? '.mp4' : '.jpg';
                                let hasExt = /\.[a-z0-9]+$/i.test(item.Name);
                                newFiles.push({
                                    name: hasExt ? item.Name : item.Name + ext,
                                    _baseName: item.Name,
                                    type: mimeType, size: 0, isJellyfin: true, id: item.Id, serverUrl: serverUrl, accessToken: accessToken
                                });
                            }
                        });
                        const newFilesSorted = newFiles.sort(fileSortFn);
                        const newNameMap = new Map();
                        newFilesSorted.forEach(f => newNameMap.set(f._baseName, f));

                        bk.state.fileNames.forEach(name => {
                            const baseName = name.replace(/\.[^/.]+$/, "");
                            if (newNameMap.has(baseName)) {
                                restoredFiles.push(newNameMap.get(baseName));
                            }
                        });

                        if (restoredFiles.length > 0) {
                            autoRestored = true;
                            currentFolders = newFolders;
                            dirStack = bk.state.dirStack;
                        }
                    } else if (res.status === 401) {
                        jellyfinConfig.accessToken = '';
                        localStorage.removeItem('shoga-jf-token');
                        pendingBookmarkRestoreId = id;
                        closeAllPanels();
                        switchToIdle();
                        dom.jellyfinModal.classList.add('active');
                        return;
                    } else {
                        await showAlertModal('ERROR', 'Folder not found or access denied on the Jellyfin server.');
                        return;
                    }
                } else if (await verifyPermission(target.handle)) {
                    const fileList = [];
                    const folderList = [];
                    const fileEntries = [];
                    for await (const entry of target.handle.values()) {
                        if (entry.kind === 'file') {
                            fileEntries.push(entry);
                        } else if (entry.kind === 'directory') {
                            folderList.push(entry);
                        }
                    }
                    const CHUNK_SIZE = 100;
                    for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
                        const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
                        const files = await Promise.all(chunk.map(async (entry) => {
                            try {
                                if (/\.(txt|json|xml|html|css|js|md|csv|zip|rar|7z|mp3|wav)$/i.test(entry.name)) return null;
                                const file = await entry.getFile();
                                if (file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi|jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i.test(file.name)) return file;
                            } catch (err) { }
                            return null;
                        }));
                        fileList.push(...files.filter(f => f !== null));
                    }
                    const newFiles = fileList.sort(fileSortFn);
                    const newNameMap = new Map();
                    newFiles.forEach(f => newNameMap.set(f.name, f));
                    bk.state.fileNames.forEach(name => {
                        if (newNameMap.has(name)) restoredFiles.push(newNameMap.get(name));
                    });
                    if (restoredFiles.length > 0) {
                        autoRestored = true;
                        currentFolders = folderList;
                        dirStack = bk.state.dirStack;
                    }
                }
            } catch (e) { }
        }

        if (!autoRestored && window.showDirectoryPicker) {
            const handles = await loadDirHandles();
            const matchedItem = handles.find(h => h.name === bk.title);
            if (matchedItem) {
                if (await verifyPermission(matchedItem.handle)) {
                    const fileList = [];
                    const folderList = [];
                    const fileEntries = [];
                    for await (const entry of matchedItem.handle.values()) {
                        if (entry.kind === 'file') {
                            fileEntries.push(entry);
                        } else if (entry.kind === 'directory') {
                            folderList.push(entry);
                        }
                    }
                    const CHUNK_SIZE = 100;
                    for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
                        const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
                        const files = await Promise.all(chunk.map(async (entry) => {
                            try {
                                if (/\.(txt|json|xml|html|css|js|md|csv|zip|rar|7z|mp3|wav)$/i.test(entry.name)) return null;
                                const file = await entry.getFile();
                                if (file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi|jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i.test(file.name)) return file;
                            } catch (err) { }
                            return null;
                        }));
                        fileList.push(...files.filter(f => f !== null));
                    }
                    const newFiles = fileList.sort(fileSortFn);
                    const newNameMap = new Map();
                    newFiles.forEach(f => newNameMap.set(f.name, f));
                    bk.state.fileNames.forEach(name => {
                        if (newNameMap.has(name)) restoredFiles.push(newNameMap.get(name));
                    });
                    if (restoredFiles.length > 0) {
                        autoRestored = true;
                        currentFolders = folderList;
                        dirStack = [{ handle: matchedItem.handle, name: matchedItem.name }];
                    }
                }
            }
        }

        if (!autoRestored) {
            if (files.length > 0) {
                restoredFiles = files;
            } else {
                pendingBookmarkRestoreId = id;
                const idleTitle = dom.idleScreen.querySelector('h1');
                const idleDesc = dom.idleScreen.querySelector('p');
                if (idleTitle) idleTitle.textContent = 'RESTORE BOOKMARK';
                if (idleDesc) idleDesc.textContent = `Please select the folder:[ ${bk.title} ]`;
                closeAllPanels();
                switchToIdle();

                setTimeout(() => {
                    if (window.showDirectoryPicker) handleDirectoryPicker();
                    else dom.fallbackInputDir.click();
                }, 100);
                return;
            }
        }
    }

    if (restoredFiles.length === 0) {
        pendingBookmarkRestoreId = null;
        switchToIdle();
        return;
    }

    pendingBookmarkRestoreId = null;
    destroyAllHls();

    urlCache.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
    urlCache.clear();

    upscaleCache.forEach(url => { if (url !== 'error' && url !== 'skipped' && url !== 'processing' && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    upscaleCache.clear();

    files = restoredFiles;
    currentTitle = bk.state.title;
    document.title = currentTitle;

    const targetName = bk.state.currentFileName;
    const foundIndex = files.findIndex(f => f.name === targetName);
    currentIndex = foundIndex !== -1 ? foundIndex : bk.state.currentIndex;
    if (currentIndex >= files.length) currentIndex = Math.max(0, files.length - 1);

    const savedMode = bk.state.layoutMode || 'SINGLE';
    if (files[currentIndex] && isVideoFile(files[currentIndex])) {
        videoLayoutMode = savedMode;
    } else {
        imageLayoutMode = savedMode;
    }
    readDir = bk.state.readDir;
    fitMode = bk.state.fitMode;
    firstPageCover = bk.state.firstPageCover;

    isGridRendered = false;

    document.querySelectorAll('#mode-single, #mode-spread').forEach(b => b.classList.remove('active'));
    document.getElementById(getCurrentLayoutMode() === 'SINGLE' ? 'mode-single' : 'mode-spread').classList.add('active');

    if (getCurrentLayoutMode() === 'SPREAD') dom.coverSettingGroup.classList.add('visible');
    else dom.coverSettingGroup.classList.remove('visible');

    document.querySelectorAll('#cover-inline, #cover-isolated').forEach(b => b.classList.remove('active'));
    document.getElementById(firstPageCover ? 'cover-isolated' : 'cover-inline').classList.add('active');

    document.querySelectorAll('#dir-ltr, #dir-rtl').forEach(b => b.classList.remove('active'));
    document.getElementById(readDir === 'LTR' ? 'dir-ltr' : 'dir-rtl').classList.add('active');

    document.querySelectorAll('#fit-auto, #fit-contain, #fit-width, #fit-height, #fit-original').forEach(b => b.classList.remove('active'));
    document.getElementById('fit-' + fitMode.toLowerCase()).classList.add('active');

    closeAllPanels();
    if (files.length > 0) dom.idleScreen.style.display = 'none';
    switchToViewer();
}

dom.btnAddBookmark.addEventListener('click', async () => {
    if (files.length === 0 || viewMode !== 'VIEWER') return;
    dom.btnAddBookmark.style.opacity = '0.5';
    dom.btnAddBookmark.textContent = '...';

    const tb = await captureThumbnail();
    const bk = {
        id: Date.now(),
        title: currentTitle,
        thumbnail: tb,
        state: {
            fileNames: files.map(f => f.name),
            currentIndex: currentIndex,
            currentFileName: files[currentIndex] ? files[currentIndex].name : null,
            layoutMode: getCurrentLayoutMode(),
            readDir: readDir,
            fitMode: fitMode,
            firstPageCover: firstPageCover,
            title: currentTitle,
            dirStack: dirStack.map(item => ({ handle: item.handle, name: item.name, isJellyfin: item.isJellyfin, id: item.id }))
        },
        lastAccessed: Date.now()
    };

    try {
        await saveBookmarkToDB(bk);
        bookmarks.push(bk);
        renderBookmarks();
    } catch (e) {
        console.error(e);
    }

    dom.btnAddBookmark.style.opacity = '1';
    dom.btnAddBookmark.textContent = '+ ADD';
});

dom.btnClearBookmarks.addEventListener('click', async () => {
    const confirmed = await showConfirmModal('DELETE ALL BOOKMARKS', 'Are you sure you want to permanently clear all items?');
    if (!confirmed) return;

    for (const bk of bookmarks) {
        try {
            await deleteBookmarkFromDB(bk.id);
        } catch (e) { console.error(e); }
    }
    bookmarks = [];
    renderBookmarks();
});

function destroyAllHls() {
    document.querySelectorAll('video').forEach(v => {
        if (v.hlsInstance) {
            v.hlsInstance.destroy();
            delete v.hlsInstance;
        }
        v.removeAttribute('src');
        v.load();
    });
}

function getFileUrl(index) {
    if (index < 0 || index >= files.length) return null;
    const file = files[index];

    if (file.isJellyfin) {
        if (file.type.startsWith('video/')) {
            const mem = navigator.deviceMemory || 4;
            const cores = navigator.hardwareConcurrency || 4;

            let maxVideoBitrate = 40000000;
            let maxWidth = 3840;
            let maxFramerate = 60;

            if (mem <= 2 || cores <= 2) {
                maxVideoBitrate = 4000000;
                maxWidth = 1280;
                maxFramerate = 30;
            } else if (mem <= 4) {
                maxVideoBitrate = 8000000;
                maxWidth = 1920;
                maxFramerate = 30;
            }

            let targetVideoBitrate = maxVideoBitrate;
            let targetAudioBitrate = 320000;

            if (navigator.connection && navigator.connection.downlink) {
                const estimatedBps = navigator.connection.downlink * 1000000 * 0.8;
                targetVideoBitrate = Math.max(2000000, Math.min(maxVideoBitrate, Math.round(estimatedBps)));
                if (targetVideoBitrate < 5000000) targetAudioBitrate = 128000;
            }

            if (!file.playSessionId) {
                const uniqueStr = Math.random().toString(36).substr(2, 9);
                file.playSessionId = `shoga-ps-${uniqueStr}`;
                file.deviceId = `shoga-dev-${uniqueStr}`;
            }

            return `${file.serverUrl}/Videos/${file.id}/master.m3u8?DeviceId=${file.deviceId}&PlaySessionId=${file.playSessionId}&MediaSourceId=${file.id}&VideoCodec=h264&AudioCodec=aac&RequireAvc=true&VideoBitDepth=8&VideoBitrate=${targetVideoBitrate}&AudioBitrate=${targetAudioBitrate}&MaxWidth=${maxWidth}&MaxFramerate=${maxFramerate}&api_key=${file.accessToken}`;
        } else {
            const targetWidth = isLowEndHardware ? 1920 : 3840;
            return `${file.serverUrl}/Items/${file.id}/Images/Primary?maxWidth=${targetWidth}&api_key=${file.accessToken}`;
        }
    }

    if (urlCache.has(index)) {
        const url = urlCache.get(index);
        urlCache.delete(index);
        urlCache.set(index, url);
        return url;
    }
    const url = URL.createObjectURL(file);
    urlCache.set(index, url);
    if (urlCache.size > 64) {
        const firstKey = urlCache.keys().next().value;
        URL.revokeObjectURL(urlCache.get(firstKey));
        urlCache.delete(firstKey);
    }
    return url;
}

setTimeout(() => { if (viewMode === 'IDLE') dom.body.classList.remove('ui-hidden'); }, 100);

dom.btnOpenMain.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingBookmarkRestoreId = null;
    const isActive = dom.openDropdown.classList.contains('active');
    closeAllPanels();
    if (!isActive) {
        dom.openDropdown.classList.add('active');
        dom.btnOpenMain.setAttribute('aria-expanded', 'true');
    }
});

async function saveCurrentImage() {
    if (files.length === 0 || viewMode !== 'VIEWER') return;

    const indices = getSpreadGroup(currentIndex);
    const mediaEls = Array.from(dom.viewerContent.querySelectorAll('img:not(.crossfade-clone), video'));

    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const originalFile = files[idx];
        let blobToSave = originalFile;
        let fileName = originalFile.name;
        let baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
        let ext = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';

        if (originalFile.isJellyfin) {
            try {
                const res = await fetch(getFileUrl(idx));
                blobToSave = await res.blob();
            } catch (e) { continue; }
        }

        const mediaEl = mediaEls.find(el => parseInt(el.dataset.fileIndex) === idx);

        if (mediaEl && mediaEl.tagName.toLowerCase() === 'IMG' && mediaEl.dataset.upscaleAppliedTier && upscaleCache.has(mediaEl.dataset.upscaleAppliedTier)) {
            const cacheKey = imgEl.dataset.upscaleAppliedTier;
            const cachedUrl = upscaleCache.get(cacheKey);

            if (cachedUrl !== 'error' && cachedUrl !== 'skipped' && cachedUrl !== 'processing' && cachedUrl.startsWith('blob:')) {
                try {
                    const resp = await fetch(cachedUrl);
                    blobToSave = await resp.blob();
                    ext = (blobToSave.type === 'image/png') ? '.png' : '.jpg';

                    let modeName = '';
                    if (cacheKey.includes('_FSR_')) modeName = 'FSR_ShogaPlus';
                    else if (cacheKey.includes('_ANIME4K_')) modeName = 'Anime4K';
                    else if (cacheKey.includes('_XBRZ_')) modeName = 'xBRZ';
                    else if (cacheKey.includes('_ADPTV_SHOGA_')) modeName = 'Adptv_ShogaPlus';

                    let ratioMatch = cacheKey.match(/_([\d\.]+)$/);
                    let ratioSuffix = ratioMatch ? `_${ratioMatch[1]}x` : '';

                    if (modeName) {
                        fileName = `${baseName}_${modeName}${ratioSuffix}${ext}`;
                    }
                } catch (e) { }
            }
        }

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blobToSave);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);

        if (indices.length > 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

dom.btnSave.addEventListener('click', (e) => {
    e.stopPropagation();
    saveCurrentImage();
});

dom.btnHome.addEventListener('click', () => {
    dom.openDropdown.classList.remove('active');
    destroyAllHls();
    currentFolders = [];
    dirStack = [];
    currentIndex = 0;

    urlCache.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
    urlCache.clear();

    upscaleCache.forEach(url => { if (url !== 'error' && url !== 'skipped' && url !== 'processing' && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    upscaleCache.clear();

    currentTitle = 'Shoga Viewer';
    document.title = currentTitle;
    dom.gridArea.replaceChildren();
    dom.slots.prev.replaceChildren();
    dom.viewerContent.replaceChildren();
    dom.slots.next.replaceChildren();
    isGridRendered = false;
    switchToIdle();
});

dom.btnOpenFiles.addEventListener('click', () => {
    dom.openDropdown.classList.remove('active');
    dirStack = [];
    currentFolders = [];
    dom.fallbackInputFiles.click();
});

async function processDirectoryHandle(handle, titleOverride = null) {
    showLoading('SCANNING DIRECTORY', 'Preparing...');
    try {
        const fileList = [];
        currentFolders = [];
        const fileEntries = [];
        for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
                fileEntries.push(entry);
            } else if (entry.kind === 'directory') {
                currentFolders.push(entry);
            }
        }
        const CHUNK_SIZE = 100;
        const totalFiles = fileEntries.length;
        let processedCount = 0;

        for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
            const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
            const files = await Promise.all(chunk.map(async (entry) => {
                try {
                    if (/\.(txt|json|xml|html|css|js|md|csv|zip|rar|7z|mp3|wav)$/i.test(entry.name)) return null;
                    const file = await entry.getFile();
                    if (file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi|jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i.test(file.name)) return file;
                } catch (err) { }
                return null;
            }));
            fileList.push(...files.filter(f => f !== null));

            processedCount += chunk.length;
            const percent = totalFiles > 0 ? Math.round((processedCount / totalFiles) * 100) : 0;
            updateLoading(`${processedCount} / ${totalFiles} (${percent}%)`);
        }
        processFileList(fileList, titleOverride || handle.name);
    } finally {
        hideLoading();
    }
}

async function handleDirectoryPicker() {
    try {
        const handle = await window.showDirectoryPicker();
        dirStack = [{ handle: handle, name: handle.name }];
        await saveDirHandle(handle);
        await renderRecents();
        await processDirectoryHandle(handle);
    } catch (e) {
        pendingBookmarkRestoreId = null;
        switchToIdle();
    }
}

dom.btnOpenDir.addEventListener('click', () => {
    dom.openDropdown.classList.remove('active');
    if (window.showDirectoryPicker) {
        handleDirectoryPicker();
    } else {
        dirStack = [];
        currentFolders = [];
        dom.fallbackInputDir.click();
    }
});

let jellyfinConfig = { serverUrl: '', accessToken: '', userId: '' };

dom.btnOpenJellyfin.addEventListener('click', () => {
    dom.openDropdown.classList.remove('active');
    if (jellyfinConfig.accessToken) {
        loadJellyfinFolder();
    } else {
        dom.jellyfinModal.classList.add('active');
    }
});

dom.btnJfCancel.addEventListener('click', () => {
    dom.jellyfinModal.classList.remove('active');
    dom.jfError.style.display = 'none';
    pendingBookmarkRestoreId = null;
});

document.getElementById('jf-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const url = dom.jfUrl.value.trim().replace(/\/$/, '');
    const user = dom.jfUser.value.trim();
    const pass = dom.jfPass.value;

    dom.btnJfConnect.disabled = true;
    dom.btnJfConnect.textContent = 'CONNECTING...';
    dom.jfError.style.display = 'none';

    const loginToken = Date.now();
    dom.jellyfinModal.dataset.loginToken = loginToken;

    let success = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            if (typeof chrome !== 'undefined' && chrome.permissions) {
                const granted = await new Promise(resolve => {
                    chrome.permissions.request({ origins: [url + '/*'] }, resolve);
                });
                if (!granted) throw new Error('Permission denied by user.');
            }

            const authPayload = { Username: user, Pw: pass };
            const authHeaders = {
                'Content-Type': 'application/json',
                'X-Emby-Authorization': 'MediaBrowser Client="Shoga Viewer", Device="Chrome", DeviceId="shoga-ext", Version="1.0.0"'
            };

            const res = await fetch(`${url}/Users/AuthenticateByName`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(authPayload)
            });

            if (!res.ok) throw new Error(`Auth failed (${res.status}). Check credentials.`);

            const data = await res.json();
            jellyfinConfig = {
                serverUrl: url,
                accessToken: data.AccessToken,
                userId: data.User.Id
            };

            localStorage.setItem('shoga-jf-url', url);

            success = true;
            break;
        } catch (err) {
            lastError = err;
            if (attempt < 5) {
                dom.jfError.textContent = `Connection failed. Retrying in 2s... (${attempt}/5)`;
                dom.jfError.style.display = 'block';
                await new Promise(resolve => setTimeout(resolve, 2000));

                if (dom.jellyfinModal.dataset.loginToken != loginToken || !dom.jellyfinModal.classList.contains('active')) {
                    return;
                }
            }
        }
    }

    if (success) {
        dom.jellyfinModal.classList.remove('active');
        if (pendingBookmarkRestoreId) {
            const idToRestore = pendingBookmarkRestoreId;
            pendingBookmarkRestoreId = null;
            restoreBookmark(idToRestore);
        } else {
            loadJellyfinFolder();
        }
        dom.btnJfConnect.disabled = false;
        dom.btnJfConnect.textContent = 'CONNECT';
    } else {
        console.error('[Jellyfin Connection Error]', lastError);
        dom.jfError.textContent = lastError.name === 'TypeError' ? 'Network error. Check Server URL or Mixed Content (HTTP/HTTPS) block.' : lastError.message;
        dom.jfError.style.display = 'block';
        dom.btnJfConnect.disabled = false;
        dom.btnJfConnect.textContent = 'CONNECT';
    }
});

async function loadJellyfinFolder(parentId = null, folderName = 'Jellyfin') {
    showLoading('CONNECTING JELLYFIN', 'Fetching items...');
    try {
        const { serverUrl, accessToken, userId } = jellyfinConfig;
        let url = `${serverUrl}/Users/${userId}/Items?Fields=PrimaryImageAspectRatio,MediaSources&SortBy=SortName`;
        if (parentId) url += `&ParentId=${parentId}`;

        const res = await fetch(url, {
            headers: { 'X-Emby-Token': accessToken }
        });
        if (!res.ok) {
            if (res.status === 401) {
                jellyfinConfig = { serverUrl: '', accessToken: '', userId: '' };
                throw new Error('Session expired. Please reconnect.');
            }
            throw new Error('Failed to fetch items.');
        }

        updateLoading('Parsing data...');

        const data = await res.json();

        const newFolders = [];
        const newFiles = [];

        data.Items.forEach(item => {
            if (item.IsFolder) {
                newFolders.push({
                    name: item.Name,
                    isJellyfin: true,
                    id: item.Id
                });
            } else if (item.MediaType === 'Video' || item.MediaType === 'Photo') {
                let mimeType = item.MediaType === 'Video' ? 'video/mp4' : 'image/jpeg';
                let ext = item.MediaType === 'Video' ? '.mp4' : '.jpg';
                let hasExt = /\.[a-z0-9]+$/i.test(item.Name);
                newFiles.push({
                    name: hasExt ? item.Name : item.Name + ext,
                    type: mimeType,
                    size: 0,
                    isJellyfin: true,
                    id: item.Id,
                    serverUrl: serverUrl,
                    accessToken: accessToken
                });
            }
        });

        currentFolders = newFolders;
        files = newFiles.sort(fileSortFn);
        currentIndex = 0;
        isGridRendered = false;
        isSingleFileMode = false;

        if (!parentId) {
            dirStack = [{ isJellyfin: true, id: null, name: 'Jellyfin' }];
        }

        lazyThumbnailObserver.disconnect();
        dom.gridArea.replaceChildren();
        dom.slots.prev.replaceChildren();
        dom.viewerContent.replaceChildren();
        if (!dom.viewerContent.parentElement) dom.slots.curr.appendChild(dom.viewerContent);
        dom.slots.next.replaceChildren();

        resetTransform(false);
        currentTitle = folderName;
        document.title = currentTitle;

        dom.idleScreen.style.display = 'none';
        switchToGrid();

    } catch (err) {
        console.error(err);
        hideLoading();
        if (err.name === 'TypeError' || err.message.includes('fetch') || err.message.includes('network')) {
            jellyfinConfig = { serverUrl: '', accessToken: '', userId: '' };
            localStorage.removeItem('shoga-jf-token');
            dom.jellyfinModal.classList.add('active');
        } else {
            await showAlertModal('ERROR', err.message);
            switchToIdle();
        }
    } finally {
        hideLoading();
    }
}

const handleFileInput = (e) => {
    if (e.target.files.length > 0) {
        showLoading('READING FILES', 'Processing input...');
        const filesArr = Array.from(e.target.files);
        let title = 'Shoga Viewer';
        if (filesArr[0].webkitRelativePath) {
            title = filesArr[0].webkitRelativePath.split('/')[0] || title;
        }
        processFileList(filesArr.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi|jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i.test(f.name)), title);
        hideLoading();
    }
    e.target.value = '';
};
dom.fallbackInputFiles.addEventListener('change', handleFileInput);
dom.fallbackInputDir.addEventListener('change', handleFileInput);

dom.btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dom.settingsPanel.classList.contains('hidden');
    closeAllPanels();
    if (isHidden) {
        dom.settingsPanel.classList.remove('hidden');
        dom.btnSettings.setAttribute('aria-expanded', 'true');
    }
});

dom.btnInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dom.infoPanel.classList.contains('hidden');
    closeAllPanels();
    if (isHidden) {
        dom.infoPanel.classList.remove('hidden');
        updateInfoPanel();
    }
});

dom.btnBookmarks.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = dom.bookmarksPanel.classList.contains('active');
    closeAllPanels();
    if (!isActive) {
        dom.bookmarksPanel.classList.add('active');
        dom.btnBookmarks.setAttribute('aria-expanded', 'true');
        renderBookmarks();
    }
});

dom.btnGrid.addEventListener('click', () => switchToGrid());

dom.attributionLink.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dom.licensePanel.classList.contains('hidden');
    closeAllPanels();
    if (isHidden) dom.licensePanel.classList.remove('hidden');
});

let lastPanelSwipeTime = 0;

document.addEventListener('click', (e) => {
    if (Date.now() - lastPanelSwipeTime < 100) return;
    if (!dom.settingsPanel.contains(e.target) && e.target !== dom.btnSettings) dom.settingsPanel.classList.add('hidden');
    if (!dom.infoPanel.contains(e.target) && e.target !== dom.btnInfo) dom.infoPanel.classList.add('hidden');
    if (!dom.licensePanel.contains(e.target) && e.target !== dom.attributionLink) dom.licensePanel.classList.add('hidden');
    if (!dom.openDropdown.contains(e.target) && e.target !== dom.btnOpenMain) dom.openDropdown.classList.remove('active');
    if (dom.jellyfinModal && !dom.jellyfinModal.contains(e.target) && e.target !== dom.btnOpenJellyfin && !dom.btnOpenJellyfin.contains(e.target)) dom.jellyfinModal.classList.remove('active');
    if (!dom.bookmarksPanel.contains(e.target) && e.target !== dom.btnBookmarks && !dom.btnBookmarks.contains(e.target) && !dom.bookmarkSearchWrapper.contains(e.target)) dom.bookmarksPanel.classList.remove('active');
});

function bindGroup(ids, callback) {
    ids.forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            ids.forEach(i => document.getElementById(i).classList.remove('active'));
            e.target.classList.add('active');
            callback(id);
        });
    });
}

function applyViewerSettingChange(action) {
    if (action) action();

    if (files.length > 0 && viewMode === 'VIEWER') {
        dom.viewerContent.querySelectorAll('.crossfade-clone').forEach(el => el.remove());
        dom.viewerContent.querySelectorAll('img').forEach(img => {
            delete img.dataset.pendingSwapUrl;
            if (img.pendingUpscaleSwap) {
                img.pendingUpscaleSwap();
                delete img.pendingUpscaleSwap;
            }
        });

        const destroySlot = (slot) => {
            Array.from(slot.children).forEach(child => {
                if (child.hlsInstance) {
                    child.hlsInstance.destroy();
                    delete child.hlsInstance;
                }
                if (child.tagName && child.tagName.toLowerCase() === 'video') {
                    child.removeAttribute('src');
                    child.load();
                }
            });
            slot.replaceChildren();
        };

        destroySlot(dom.viewerContent);
        destroySlot(dom.slots.prev);
        destroySlot(dom.slots.next);
    }

    renderViewer();
}

bindGroup(['mode-single', 'mode-spread'], id => {
    applyViewerSettingChange(() => {
        const mode = id === 'mode-single' ? 'SINGLE' : 'SPREAD';
        if (files.length > 0 && isVideoFile(files[currentIndex])) {
            videoLayoutMode = mode;
            localStorage.setItem('shoga-video-layout', mode);
        } else {
            imageLayoutMode = mode;
            localStorage.setItem('shoga-image-layout', mode);
        }

        if (mode === 'SPREAD') {
            dom.coverSettingGroup.classList.add('visible');
        } else {
            dom.coverSettingGroup.classList.remove('visible');
        }
    });
});
bindGroup(['cover-inline', 'cover-isolated'], id => {
    applyViewerSettingChange(() => {
        firstPageCover = id === 'cover-isolated';
        localStorage.setItem('shoga-first-page-cover', firstPageCover);
    });
});
bindGroup(['dir-ltr', 'dir-rtl'], id => {
    applyViewerSettingChange(() => {
        readDir = id === 'dir-ltr' ? 'LTR' : 'RTL';
        localStorage.setItem('shoga-read-dir', readDir);
    });
});
bindGroup(['fit-auto', 'fit-contain', 'fit-width', 'fit-height', 'fit-original'], id => {
    applyViewerSettingChange(() => {
        fitMode = id.replace('fit-', '').toUpperCase();
        localStorage.setItem('shoga-fit-mode', fitMode);
    });
});
bindGroup(['upscale-off', 'upscale-bilinear', 'upscale-adptv', 'upscale-anime4k', 'upscale-xbrz', 'upscale-fsr'], id => {
    if (id === 'upscale-off') upscaleMode = 'OFF';
    else if (id === 'upscale-bilinear') upscaleMode = 'BILINEAR';
    else if (id === 'upscale-adptv') upscaleMode = 'ADPTV_SHOGA';
    else if (id === 'upscale-anime4k') upscaleMode = 'ANIME4K';
    else if (id === 'upscale-xbrz') upscaleMode = 'XBRZ';
    else upscaleMode = 'FSR';

    console.log(`Mode changed to: ${upscaleMode}`);
    localStorage.setItem('shoga-upscale-mode', upscaleMode);

    if (upscaleMode !== 'OFF') {
        for (let [k, v] of upscaleCache.entries()) {
            if (v === 'error') upscaleCache.delete(k);
        }
        if (viewMode === 'VIEWER') {
            dom.viewerSlider.querySelectorAll('.view-slot img:not(.crossfade-clone)').forEach(img => {
                if (!img.dataset.upscaleAppliedTier) {
                    executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
                }
            });
        }
        clearTimeout(upscaleDebounceTimer);
        upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 300);
        startPreloadQueue();
    } else {
        if (viewMode === 'VIEWER') {
            const imgs = dom.viewerSlider.querySelectorAll('img:not(.crossfade-clone)');
            imgs.forEach(img => {
                if (img.dataset.upscaleAppliedTier) {
                    executeCrossfadeSwap(img, img.dataset.originalUrl, null);
                }
            });
        }
    }
});

function drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH) {
    if (!gl || gl.isContextLost()) { console.error('Context lost in drawWebGL'); throw new Error('Context lost'); }
    if (gl.canvas.width !== cw || gl.canvas.height !== ch) {
        gl.canvas.width = cw;
        gl.canvas.height = ch;
    }
    gl.viewport(0, 0, cw, ch);

    const shaderHash = vsSource.length + '_' + fsSource.length;
    let program = _shaderCache.get(shaderHash);

    if (!program) {
        const compileShader = (type, source) => {
            const shader = gl.createShader(type);
            if (!shader) throw new Error('OOM');
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            return shader;
        };

        const vs = compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
        program = gl.createProgram();
        if (!program) {
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            throw new Error('OOM');
        }
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        gl.deleteShader(vs);
        gl.deleteShader(fs);
        _shaderCache.set(shaderHash, program);
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    if (!positionBuffer || gl.getError() === gl.OUT_OF_MEMORY) {
        forceLoseContext(gl);
        console.error('OOM creating buffer in drawWebGL'); throw new Error('OOM');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    if (!texture || gl.getError() === gl.OUT_OF_MEMORY) {
        if (positionBuffer) gl.deleteBuffer(positionBuffer);
        forceLoseContext(gl);
        console.error('OOM creating texture in drawWebGL'); throw new Error('OOM');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (gl.getError() === gl.OUT_OF_MEMORY) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        forceLoseContext(gl);
        console.error('OOM texImage2D in drawWebGL'); throw new Error('OOM');
    }

    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'u_texSize'), texW, texH);

    return { program, texture, positionBuffer };
}

function renderFSR(img, canvas, cw, ch, texW, texH, sharpness = 2) {
    const gl = getGL();
    if (!gl) { console.error('GL context is null in renderFSR'); return; }

    const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
            v_texCoord.y = 1.0 - v_texCoord.y;
        }
    `;

    const fsSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texSize;
        uniform float u_sharpness;

        void main() {
            vec2 pp = v_texCoord * u_texSize - vec2(0.5);
            vec2 fp = floor(pp);
            vec2 p0 = (fp + vec2(0.5)) / u_texSize;
            vec2 d = 1.0 / u_texSize;

            vec3 c00 = texture2D(u_image, p0 + vec2(-d.x, -d.y)).rgb;
            vec3 c10 = texture2D(u_image, p0 + vec2(0.0, -d.y)).rgb;
            vec3 c20 = texture2D(u_image, p0 + vec2(d.x, -d.y)).rgb;
            vec3 c01 = texture2D(u_image, p0 + vec2(-d.x, 0.0)).rgb;
            vec3 c11 = texture2D(u_image, p0).rgb;
            vec3 c21 = texture2D(u_image, p0 + vec2(d.x, 0.0)).rgb;
            vec3 c02 = texture2D(u_image, p0 + vec2(-d.x, d.y)).rgb;
            vec3 c12 = texture2D(u_image, p0 + vec2(0.0, d.y)).rgb;
            vec3 c22 = texture2D(u_image, p0 + vec2(d.x, d.y)).rgb;

            float l00 = dot(c00, vec3(0.5, 1.0, 0.25));
            float l10 = dot(c10, vec3(0.5, 1.0, 0.25));
            float l20 = dot(c20, vec3(0.5, 1.0, 0.25));
            float l01 = dot(c01, vec3(0.5, 1.0, 0.25));
            float l11 = dot(c11, vec3(0.5, 1.0, 0.25));
            float l21 = dot(c21, vec3(0.5, 1.0, 0.25));
            float l02 = dot(c02, vec3(0.5, 1.0, 0.25));
            float l12 = dot(c12, vec3(0.5, 1.0, 0.25));
            float l22 = dot(c22, vec3(0.5, 1.0, 0.25));

            float dirX = abs(l01 + l21 - 2.0 * l11) * 2.0 + abs(l00 + l20 - 2.0 * l10) + abs(l02 + l22 - 2.0 * l12);
            float dirY = abs(l10 + l12 - 2.0 * l11) * 2.0 + abs(l00 + l02 - 2.0 * l01) + abs(l20 + l22 - 2.0 * l21);
            
            vec3 dirColor = vec3(0.0);
            if (dirX > dirY) {
                dirColor = c11 * 0.5 + c01 * 0.25 + c21 * 0.25;
            } else {
                dirColor = c11 * 0.5 + c10 * 0.25 + c12 * 0.25;
            }
            
            vec3 color = mix(c11, dirColor, 0.25);
            
            float minL = min(min(l10, l12), min(l01, l21));
            float maxL = max(max(l10, l12), max(l01, l21));
            float contrast = maxL - minL;
            
            if (contrast > 0.0) {
                float sharp = u_sharpness * (1.0 + contrast);
                color = color + (color - (c10 + c12 + c01 + c21) * 0.25) * sharp;
                
                vec3 minC = min(min(c10, c12), min(c01, c21));
                vec3 maxC = max(max(c10, c12), max(c01, c21));
                color = clamp(color, minC, maxC);
            }

            gl_FragColor = vec4(color, 1.0);
        }
    `;

    const { program, texture, positionBuffer } = drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.uniform1f(gl.getUniformLocation(program, 'u_sharpness'), sharpness);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
    if (gl.getError() === gl.OUT_OF_MEMORY || gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        forceLoseContext(gl);
        console.error('OOM or Context Lost in renderFSR'); throw new Error('OOM');
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(gl.canvas, 0, 0, cw, ch);

    gl.deleteTexture(texture);
    gl.deleteBuffer(positionBuffer);
}

function renderAntiJaggies(img, canvas, cw, ch, texW, texH) {
    const gl = getGL();
    if (!gl) { console.error('GL context is null in renderAntiJaggies'); return; }

    const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
            v_texCoord.y = 1.0 - v_texCoord.y;
        }
    `;

    const fsSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texSize;

        void main() {
            vec2 d = 1.0 / u_texSize;
            vec2 p = v_texCoord;
            
            vec3 c = texture2D(u_image, p).rgb;
            vec3 n = texture2D(u_image, p + vec2(0.0, -d.y)).rgb;
            vec3 s = texture2D(u_image, p + vec2(0.0, d.y)).rgb;
            vec3 w = texture2D(u_image, p + vec2(-d.x, 0.0)).rgb;
            vec3 e = texture2D(u_image, p + vec2(d.x, 0.0)).rgb;
            
            float lC = dot(c, vec3(0.299, 0.587, 0.114));
            float lN = dot(n, vec3(0.299, 0.587, 0.114));
            float lS = dot(s, vec3(0.299, 0.587, 0.114));
            float lW = dot(w, vec3(0.299, 0.587, 0.114));
            float lE = dot(e, vec3(0.299, 0.587, 0.114));
            
            float lMin = min(min(min(lC, lN), min(lS, lW)), lE);
            float lMax = max(max(max(lC, lN), max(lS, lW)), lE);
            float contrast = lMax - lMin;
            
            if (contrast < 0.12) {
                gl_FragColor = vec4(c, 1.0);
                return;
            }
            
            float lNW = dot(texture2D(u_image, p + vec2(-d.x, -d.y)).rgb, vec3(0.299, 0.587, 0.114));
            float lNE = dot(texture2D(u_image, p + vec2(d.x, -d.y)).rgb, vec3(0.299, 0.587, 0.114));
            float lSW = dot(texture2D(u_image, p + vec2(-d.x, d.y)).rgb, vec3(0.299, 0.587, 0.114));
            float lSE = dot(texture2D(u_image, p + vec2(d.x, d.y)).rgb, vec3(0.299, 0.587, 0.114));
            
            float dirX = -((lNW + lNE) - (lSW + lSE));
            float dirY =  ((lNW + lSW) - (lNE + lSE));
            
            vec2 dir = vec2(dirX, dirY);
            float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 0.0078125);
            float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
            
            dir = min(vec2(8.0, 8.0), max(vec2(-8.0, -8.0), dir * rcpDirMin)) * d;
            
            vec2 edgeDir = normalize(dir + vec2(0.00001)) * d;
            vec3 sampleA = texture2D(u_image, p + edgeDir).rgb;
            vec3 sampleB = texture2D(u_image, p - edgeDir).rgb;
            
            vec3 morphColor = c;
            float lA = dot(sampleA, vec3(0.299, 0.587, 0.114));
            float lB = dot(sampleB, vec3(0.299, 0.587, 0.114));
            
            if (lA < lC && lB < lC) {
                morphColor = mix(c, min(sampleA, sampleB), 0.6);
            } else if (lA > lC && lB > lC) {
                morphColor = mix(c, max(sampleA, sampleB), 0.6);
            }
            
            vec3 res1 = (texture2D(u_image, p + dir * (1.0/3.0 - 0.5)).rgb + texture2D(u_image, p + dir * (2.0/3.0 - 0.5)).rgb) * 0.5;
            vec3 res2 = res1 * 0.5 + (texture2D(u_image, p + dir * (0.0/3.0 - 0.5)).rgb + texture2D(u_image, p + dir * (3.0/3.0 - 0.5)).rgb) * 0.25;
            
            float lRes2 = dot(res2, vec3(0.299, 0.587, 0.114));
            vec3 fxaaColor = (lRes2 < lMin || lRes2 > lMax) ? res1 : res2;
            
            gl_FragColor = vec4(mix(morphColor, fxaaColor, 0.75), 1.0);
        }
    `;
    const { program, texture, positionBuffer } = drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
    if (gl.getError() === gl.OUT_OF_MEMORY || gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        forceLoseContext(gl);
        console.error('OOM or Context Lost in renderAntiJaggies'); throw new Error('OOM');
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(gl.canvas, 0, 0, cw, ch);

    gl.deleteTexture(texture);
    gl.deleteBuffer(positionBuffer);
}

function renderAdptvShogaPlus(img, canvas, cw, ch, texW, texH, scale) {
    const gl = getGL();
    if (!gl) { console.error('GL context is null in renderAdptvShogaPlus'); return; }

    const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
            v_texCoord.y = 1.0 - v_texCoord.y;
        }
    `;

    const fsSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texSize;
        uniform float u_scale;

        void main() {
            vec2 d_src = 1.0 / u_texSize;
            vec2 d_tgt = d_src / u_scale;
            vec2 p = v_texCoord;
            
            vec3 c = texture2D(u_image, p).rgb;
            
            vec3 n_low = texture2D(u_image, p + vec2(0.0, -d_src.y)).rgb;
            vec3 s_low = texture2D(u_image, p + vec2(0.0, d_src.y)).rgb;
            vec3 w_low = texture2D(u_image, p + vec2(-d_src.x, 0.0)).rgb;
            vec3 e_low = texture2D(u_image, p + vec2(d_src.x, 0.0)).rgb;
            
            vec3 nw_low = texture2D(u_image, p + vec2(-d_src.x, -d_src.y)).rgb;
            vec3 ne_low = texture2D(u_image, p + vec2(d_src.x, -d_src.y)).rgb;
            vec3 sw_low = texture2D(u_image, p + vec2(-d_src.x, d_src.y)).rgb;
            vec3 se_low = texture2D(u_image, p + vec2(d_src.x, d_src.y)).rgb;
            
            vec3 blur = (n_low + s_low + w_low + e_low) * 0.15 + (nw_low + ne_low + sw_low + se_low) * 0.1;
            vec3 delta = (c - blur) * 1.8;
            
            vec3 n = texture2D(u_image, p + vec2(0.0, -d_tgt.y)).rgb;
            vec3 s = texture2D(u_image, p + vec2(0.0, d_tgt.y)).rgb;
            vec3 w = texture2D(u_image, p + vec2(-d_tgt.x, 0.0)).rgb;
            vec3 e = texture2D(u_image, p + vec2(d_tgt.x, 0.0)).rgb;
            
            float lC = dot(c, vec3(0.299, 0.587, 0.114));
            float lN = dot(n, vec3(0.299, 0.587, 0.114));
            float lS = dot(s, vec3(0.299, 0.587, 0.114));
            float lW = dot(w, vec3(0.299, 0.587, 0.114));
            float lE = dot(e, vec3(0.299, 0.587, 0.114));
            
            float lMin = min(min(min(lC, lN), min(lS, lW)), lE);
            float lMax = max(max(max(lC, lN), max(lS, lW)), lE);
            float contrast = lMax - lMin;
            
            vec3 finalColor = c;
            
            if (contrast < 0.08) {
                finalColor = c + delta * 0.5;
            } else {
                vec3 nw = texture2D(u_image, p + vec2(-d_tgt.x, -d_tgt.y)).rgb;
                vec3 ne = texture2D(u_image, p + vec2(d_tgt.x, -d_tgt.y)).rgb;
                vec3 sw = texture2D(u_image, p + vec2(-d_tgt.x, d_tgt.y)).rgb;
                vec3 se = texture2D(u_image, p + vec2(d_tgt.x, d_tgt.y)).rgb;
                
                float lNW = dot(nw, vec3(0.299, 0.587, 0.114));
                float lNE = dot(ne, vec3(0.299, 0.587, 0.114));
                float lSW = dot(sw, vec3(0.299, 0.587, 0.114));
                float lSE = dot(se, vec3(0.299, 0.587, 0.114));
                
                float dirX = -((lNW + lNE) - (lSW + lSE));
                float dirY =  ((lNW + lSW) - (lNE + lSE));
                
                vec2 dir = vec2(dirX, dirY);
                float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 0.0078125);
                float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
                
                dir = min(vec2(8.0, 8.0), max(vec2(-8.0, -8.0), dir * rcpDirMin)) * d_tgt;
                
                vec2 edgeDir = normalize(dir + vec2(0.00001)) * d_tgt;
                vec3 sampleA = texture2D(u_image, p + edgeDir).rgb;
                vec3 sampleB = texture2D(u_image, p - edgeDir).rgb;
                
                vec3 morphColor = c;
                float lA = dot(sampleA, vec3(0.299, 0.587, 0.114));
                float lB = dot(sampleB, vec3(0.299, 0.587, 0.114));
                
                if (lA < lC && lB < lC) {
                    morphColor = mix(c, min(sampleA, sampleB), 0.6);
                } else if (lA > lC && lB > lC) {
                    morphColor = mix(c, max(sampleA, sampleB), 0.6);
                }
                
                vec3 res1 = (texture2D(u_image, p + dir * (1.0/3.0 - 0.5)).rgb + texture2D(u_image, p + dir * (2.0/3.0 - 0.5)).rgb) * 0.5;
                vec3 res2 = res1 * 0.5 + (texture2D(u_image, p + dir * (0.0/3.0 - 0.5)).rgb + texture2D(u_image, p + dir * (3.0/3.0 - 0.5)).rgb) * 0.25;
                
                float lRes2 = dot(res2, vec3(0.299, 0.587, 0.114));
                vec3 fxaaColor = (lRes2 < lMin || lRes2 > lMax) ? res1 : res2;
                
                vec3 baseColor = mix(morphColor, fxaaColor, 0.6);
                finalColor = baseColor + delta;
            }
            
            vec3 minC = min(min(min(c, n_low), min(s_low, w_low)), e_low);
            vec3 maxC = max(max(max(c, n_low), max(s_low, w_low)), e_low);
            vec3 minC_diag = min(min(min(nw_low, ne_low), min(sw_low, se_low)), minC);
            vec3 maxC_diag = max(max(max(nw_low, ne_low), max(sw_low, se_low)), maxC);
            
            vec3 overshoot = (maxC_diag - minC_diag) * 0.05;
            finalColor = clamp(finalColor, minC_diag - overshoot, maxC_diag + overshoot);
            
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `;
    const { program, texture, positionBuffer } = drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), scale);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
    if (gl.getError() === gl.OUT_OF_MEMORY || gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        forceLoseContext(gl);
        console.error('OOM or Context Lost in renderAdptvShogaPlus'); throw new Error('OOM');
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(gl.canvas, 0, 0, cw, ch);

    gl.deleteTexture(texture);
    gl.deleteBuffer(positionBuffer);
}

function renderAnime4KLite(img, canvas, cw, ch, texW, texH) {
    const gl = getGL();
    if (!gl) { console.error('GL context is null in renderAnime4KLite'); return; }

    const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
            v_texCoord.y = 1.0 - v_texCoord.y;
        }
    `;

    const fsSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texSize;

        void main() {
            vec2 d = 1.0 / u_texSize;
            vec3 c = texture2D(u_image, v_texCoord).rgb;
            
            vec3 u = texture2D(u_image, v_texCoord + vec2(0.0, -d.y)).rgb;
            vec3 d_c = texture2D(u_image, v_texCoord + vec2(0.0, d.y)).rgb;
            vec3 l = texture2D(u_image, v_texCoord + vec2(-d.x, 0.0)).rgb;
            vec3 r = texture2D(u_image, v_texCoord + vec2(d.x, 0.0)).rgb;
            
            vec3 min_c = min(min(u, d_c), min(l, r));
            vec3 max_c = max(max(u, d_c), max(l, r));
            
            vec3 blurred = (c + u + d_c + l + r) / 5.0;
            vec3 sharpened = c + (c - blurred) * 1.5;
            
            sharpened = clamp(sharpened, min_c, max_c);
            
            gl_FragColor = vec4(sharpened, 1.0);
        }
    `;
    const { program, texture, positionBuffer } = drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
    if (gl.getError() === gl.OUT_OF_MEMORY || gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        forceLoseContext(gl);
        console.error('OOM or Context Lost in renderAnime4KLite'); throw new Error('OOM');
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(gl.canvas, 0, 0, cw, ch);

    gl.deleteTexture(texture);
    gl.deleteBuffer(positionBuffer);
}

function renderXBRZLite(img, canvas, cw, ch, texW, texH) {
    const gl = getGL();
    if (!gl) { console.error('GL context is null in renderXBRZLite'); return; }

    const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
            v_texCoord.y = 1.0 - v_texCoord.y;
        }
    `;

    const fsSource = `
        precision highp float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texSize;

        void main() {
            vec2 d = 1.0 / u_texSize;
            vec2 p = v_texCoord;
            
            vec3 c = texture2D(u_image, p).rgb;
            vec3 u = texture2D(u_image, p + vec2(0.0, -d.y)).rgb;
            vec3 b = texture2D(u_image, p + vec2(0.0, d.y)).rgb;
            vec3 l = texture2D(u_image, p + vec2(-d.x, 0.0)).rgb;
            vec3 r = texture2D(u_image, p + vec2(d.x, 0.0)).rgb;
            
            float d_ul = length(u - l);
            float d_ur = length(u - r);
            float d_bl = length(b - l);
            float d_br = length(b - r);
            
            vec3 outColor = c;
            vec2 f = fract(p * u_texSize);
            
            if (f.x < 0.5 && f.y < 0.5 && d_ul < length(c - texture2D(u_image, p + vec2(-d.x, -d.y)).rgb)) {
                outColor = mix(c, (u+l)*0.5, 0.5);
            } else if (f.x > 0.5 && f.y < 0.5 && d_ur < length(c - texture2D(u_image, p + vec2(d.x, -d.y)).rgb)) {
                outColor = mix(c, (u+r)*0.5, 0.5);
            } else if (f.x < 0.5 && f.y > 0.5 && d_bl < length(c - texture2D(u_image, p + vec2(-d.x, d.y)).rgb)) {
                outColor = mix(c, (b+l)*0.5, 0.5);
            } else if (f.x > 0.5 && f.y > 0.5 && d_br < length(c - texture2D(u_image, p + vec2(d.x, d.y)).rgb)) {
                outColor = mix(c, (b+r)*0.5, 0.5);
            }
            
            gl_FragColor = vec4(outColor, 1.0);
        }
    `;
    const { program, texture, positionBuffer } = drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
    if (gl.getError() === gl.OUT_OF_MEMORY || gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteBuffer(positionBuffer);
        forceLoseContext(gl);
        console.error('OOM or Context Lost in renderXBRZLite'); throw new Error('OOM');
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(gl.canvas, 0, 0, cw, ch);

    gl.deleteTexture(texture);
    gl.deleteBuffer(positionBuffer);
}

function createStepDownscaledCanvas(srcImg, targetW, targetH) {
    let curW = srcImg.naturalWidth || srcImg.width;
    let curH = srcImg.naturalHeight || srcImg.height;
    if (curW === targetW && curH === targetH) {
        let c = document.createElement('canvas');
        c.width = targetW; c.height = targetH;
        c.getContext('2d', { alpha: false }).drawImage(srcImg, 0, 0);
        return c;
    }
    let curCanvas = document.createElement('canvas');
    if (curW * 0.5 >= targetW && curH * 0.5 >= targetH) {
        curW = Math.floor(curW * 0.5);
        curH = Math.floor(curH * 0.5);
    }
    curCanvas.width = curW;
    curCanvas.height = curH;
    let curCtx = curCanvas.getContext('2d', { alpha: false });
    curCtx.drawImage(srcImg, 0, 0, curW, curH);

    while (curW * 0.5 > targetW && curH * 0.5 > targetH) {
        curW = Math.floor(curW * 0.5);
        curH = Math.floor(curH * 0.5);
        let nextCanvas = document.createElement('canvas');
        nextCanvas.width = curW;
        nextCanvas.height = curH;
        let nextCtx = nextCanvas.getContext('2d', { alpha: false });
        nextCtx.drawImage(curCanvas, 0, 0, curW, curH);
        curCanvas.width = 0; curCanvas.height = 0;
        curCanvas = nextCanvas;
    }

    let finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetW;
    finalCanvas.height = targetH;
    let finalCtx = finalCanvas.getContext('2d', { alpha: false });
    finalCtx.drawImage(curCanvas, 0, 0, targetW, targetH);
    curCanvas.width = 0; curCanvas.height = 0;
    return finalCanvas;
}

async function performUpscale(srcImg, actualMode, renderRatio, targetRatio, nw, nh, upscaleW, upscaleH, isValid) {
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = upscaleW;
    finalCanvas.height = upscaleH;
    const finalCtx = finalCanvas.getContext('2d', { alpha: false });

    const PADDING = 4;
    let TILE_SIZE = Math.floor(MAX_GL_TEXTURE_SIZE / renderRatio) - (PADDING * 2);
    TILE_SIZE = Math.max(256, Math.min(1024, TILE_SIZE));

    const chunkCanvas = document.createElement('canvas');
    const chunkCtx = chunkCanvas.getContext('2d', { alpha: false });
    const upChunkCanvas = document.createElement('canvas');
    const intermediateCanvas = actualMode === 'FSR' ? document.createElement('canvas') : null;

    for (let y = 0; y < nh; y += TILE_SIZE) {
        for (let x = 0; x < nw; x += TILE_SIZE) {
            if (isValid && !isValid()) {
                chunkCanvas.width = 0; chunkCanvas.height = 0;
                upChunkCanvas.width = 0; upChunkCanvas.height = 0;
                if (intermediateCanvas) { intermediateCanvas.width = 0; intermediateCanvas.height = 0; }
                finalCanvas.width = 0; finalCanvas.height = 0;
                return null;
            }

            const srcX = Math.max(0, x - PADDING);
            const srcY = Math.max(0, y - PADDING);
            const srcW = Math.min(nw - srcX, TILE_SIZE + (x - srcX) + PADDING);
            const srcH = Math.min(nh - srcY, TILE_SIZE + (y - srcY) + PADDING);

            chunkCanvas.width = srcW;
            chunkCanvas.height = srcH;
            chunkCtx.drawImage(srcImg, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

            const upChunkW = Math.ceil(srcW * renderRatio);
            const upChunkH = Math.ceil(srcH * renderRatio);
            upChunkCanvas.width = upChunkW;
            upChunkCanvas.height = upChunkH;

            if (actualMode === 'FSR') {
                intermediateCanvas.width = upChunkW;
                intermediateCanvas.height = upChunkH;
                renderFSR(chunkCanvas, intermediateCanvas, upChunkW, upChunkH, srcW, srcH, 0.2);
                renderAntiJaggies(intermediateCanvas, upChunkCanvas, upChunkW, upChunkH, upChunkW, upChunkH);
            } else if (actualMode === 'ANIME4K') {
                renderAnime4KLite(chunkCanvas, upChunkCanvas, upChunkW, upChunkH, srcW, srcH);
            } else if (actualMode === 'XBRZ') {
                renderXBRZLite(chunkCanvas, upChunkCanvas, upChunkW, upChunkH, srcW, srcH);
            } else if (actualMode === 'ADPTV_SHOGA') {
                renderAdptvShogaPlus(chunkCanvas, upChunkCanvas, upChunkW, upChunkH, srcW, srcH, renderRatio);
            }

            let finalChunk = upChunkCanvas;
            if (renderRatio > targetRatio) {
                const downW = Math.ceil(srcW * targetRatio);
                const downH = Math.ceil(srcH * targetRatio);
                finalChunk = createStepDownscaledCanvas(upChunkCanvas, downW, downH);
            }

            const outX = Math.round((x - srcX) * targetRatio);
            const outY = Math.round((y - srcY) * targetRatio);
            const outW = Math.round(Math.min(TILE_SIZE, nw - x) * targetRatio);
            const outH = Math.round(Math.min(TILE_SIZE, nh - y) * targetRatio);
            const destX = Math.round(x * targetRatio);
            const destY = Math.round(y * targetRatio);

            const overlap = 4;
            const drawW = Math.min(outW + overlap, finalChunk.width - outX, upscaleW - destX);
            const drawH = Math.min(outH + overlap, finalChunk.height - outY, upscaleH - destY);

            finalCtx.drawImage(
                finalChunk,
                outX, outY, drawW, drawH,
                destX, destY, drawW, drawH
            );

            if (finalChunk !== upChunkCanvas) {
                finalChunk.width = 0; finalChunk.height = 0;
            }

            await new Promise(r => setTimeout(r, 0));
        }
    }

    chunkCanvas.width = 0;
    chunkCanvas.height = 0;
    upChunkCanvas.width = 0;
    upChunkCanvas.height = 0;
    if (intermediateCanvas) {
        intermediateCanvas.width = 0;
        intermediateCanvas.height = 0;
    }

    return finalCanvas;
}

async function processNextPreload() {
    if (upscaleMode === 'OFF' || viewMode !== 'VIEWER') {
        isPreloading = false;
        return;
    }
    if (isPanning || isDragging || dom.body.classList.contains('animating') || upscaleTasks > 0) {
        preloadQueueTimer = setTimeout(processNextPreload, 200);
        return;
    }

    let targetIndex = -1;
    let MAX_PRELOAD = isLowEndHardware ? 2 : 16;
    let actualMode = upscaleMode;
    let isBilinear = actualMode === 'BILINEAR';
    let preloadLogQueue = [];

    for (let i = 1; i <= MAX_PRELOAD; i++) {
        let rightIdx = currentIndex + i;
        let leftIdx = currentIndex - i;
        let checkOrder = readDir === 'LTR' ? [rightIdx, leftIdx] : [leftIdx, rightIdx];

        for (let idx of checkOrder) {
            if (idx >= 0 && idx < files.length) {
                if (files[idx] && files[idx].isBroken) continue;

                let isAnim = await checkAnimated(files[idx]);
                preloadLogQueue.push(`[Index ${idx}] Type: ${files[idx]?.type}, isAnim: ${isAnim}`);
                if (isAnim || files[idx].type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(files[idx].name)) {
                    preloadLogQueue.push(` -> Skipped (Anim/Video)`);
                    continue;
                }

                const origUrl = getFileUrl(idx);
                let checkRatio = (isHighMemMode && is4xEnabled && !isBilinear && actualMode !== 'ADPTV_SHOGA') ? 4.0 : (isBilinear ? 1.0 : 2.0);

                if (actualMode === 'ADPTV_SHOGA') {
                    if (files[idx].nw) {
                        let displayW = window.innerWidth * currentZoom;
                        if (getCurrentLayoutMode() === 'SPREAD' && getSpreadGroup(idx).length === 2) displayW *= 0.5;
                        let dRatio = displayW / files[idx].nw;
                        checkRatio = Math.ceil(dRatio * 10) / 10;
                        if (checkRatio < 0.1) checkRatio = 0.1;
                        const maxArea = getDynamicMaxArea();
                        while ((files[idx].nw * checkRatio * files[idx].nh * checkRatio > maxArea || files[idx].nw * checkRatio > 16384 || files[idx].nh * checkRatio > 16384) && checkRatio > 1.0) {
                            checkRatio = Math.max(1.0, checkRatio - 0.1);
                        }
                        checkRatio = Math.round(checkRatio * 10) / 10;
                    } else {
                        checkRatio = -1;
                    }
                }

                let needsProcessing = true;
                if (checkRatio === -1) {
                    needsProcessing = false;
                    preloadLogQueue.push(` -> Needs Dimension Data`);
                } else {
                    for (let [key, cacheVal] of upscaleCache.entries()) {
                        if (key.startsWith(origUrl + '_' + actualMode + '_')) {
                            let cachedRatio = parseFloat(key.split('_').pop());
                            if (!isNaN(cachedRatio) && cachedRatio >= checkRatio) {
                                if (cacheVal !== 'error' && cacheVal !== 'skipped') {
                                    needsProcessing = false;
                                    preloadLogQueue.push(` -> Cache Hit/Processing`);
                                    break;
                                }
                            }
                        }
                    }
                }

                if (needsProcessing) {
                    targetIndex = idx;
                    preloadLogQueue.push(` -> Selected for Preload (Target Ratio: ${checkRatio})`);
                    break;
                }
            }
        }
        if (targetIndex !== -1) break;
    }

    if (preloadLogQueue.length > 0) {
        console.groupCollapsed(`[Preload] Evaluated items`);
        console.log(preloadLogQueue.join('\n'));
        console.groupEnd();
    }

    if (targetIndex === -1) {
        isPreloading = false;
        return;
    }

    const idx = targetIndex;
    const origUrl = getFileUrl(idx);

    if (isBilinear) {
        const cacheKey = origUrl + '_' + actualMode + '_1';
        upscaleCache.set(cacheKey, origUrl);
        preloadQueueTimer = setTimeout(processNextPreload, 50);
        return;
    }

    const srcImg = new Image();
    srcImg.crossOrigin = "anonymous";
    srcImg.onload = async () => {
        if (isPanning || isDragging || dom.body.classList.contains('animating') || upscaleTasks > 0) {
            preloadQueueTimer = setTimeout(processNextPreload, 200);
            return;
        }
        if (!files[idx] || getFileUrl(idx) !== origUrl) {
            preloadQueueTimer = setTimeout(processNextPreload, 50);
            return;
        }
        const nw = srcImg.naturalWidth;
        const nh = srcImg.naturalHeight;
        if (!nw || !nh) {
            console.error('processNextPreload: nw or nh is 0 for', origUrl);
            preloadQueueTimer = setTimeout(processNextPreload, 50);
            return;
        }

        if (files[idx] && !files[idx].nw) {
            files[idx].nw = nw;
            files[idx].nh = nh;
        }

        let originalTargetRatio = (isHighMemMode && is4xEnabled && !isBilinear && actualMode !== 'ADPTV_SHOGA') ? 4.0 : (isBilinear ? 1.0 : 2.0);
        let currentRatio = originalTargetRatio;
        let fallbackActive = false;

        if (actualMode === 'ADPTV_SHOGA') {
            let displayW = window.innerWidth * currentZoom;
            if (getCurrentLayoutMode() === 'SPREAD' && getSpreadGroup(idx).length === 2) displayW *= 0.5;
            let dRatio = displayW / nw;
            currentRatio = Math.ceil(dRatio * 10) / 10;
            if (currentRatio < 0.1) currentRatio = 0.1;

            const maxArea = getDynamicMaxArea();
            while ((nw * currentRatio * nh * currentRatio > maxArea || nw * currentRatio > 16384 || nh * currentRatio > 16384) && currentRatio > 1.0) {
                currentRatio = Math.max(1.0, currentRatio - 0.1);
            }
            currentRatio = Math.round(currentRatio * 10) / 10;
            originalTargetRatio = currentRatio;
        } else {
            if (originalTargetRatio === 4.0 && (nw * 4.0 > 16384 || nh * 4.0 > 16384)) {
                currentRatio = 2.0;
                fallbackActive = true;
            }
        }

        const cacheKey = origUrl + '_' + actualMode + '_' + originalTargetRatio;
        const actualCacheKey = origUrl + '_' + actualMode + '_' + currentRatio;

        if (viewMode !== 'VIEWER' || Math.abs(idx - currentIndex) > 16) {
            preloadQueueTimer = setTimeout(processNextPreload, 50);
            return;
        }

        if (upscaleCache.has(cacheKey)) {
            preloadQueueTimer = setTimeout(processNextPreload, 50);
            return;
        }

        upscaleCache.set(cacheKey, 'processing');
        if (fallbackActive) upscaleCache.set(actualCacheKey, 'processing');

        const upscaleW = Math.ceil(nw * currentRatio);
        const upscaleH = Math.ceil(nh * currentRatio);

        if (actualMode !== 'ADPTV_SHOGA' && (upscaleW > 16384 || upscaleH > 16384)) {
            upscaleCache.set(actualCacheKey, origUrl);
            if (fallbackActive) upscaleCache.set(cacheKey, origUrl);
            preloadQueueTimer = setTimeout(processNextPreload, 50);
            return;
        }

        try {
            const runSinglePass = async (inputImg, inW, inH, ratio) => {
                return new Promise((resolve, reject) => {
                    let isValid = () => upscaleCache.get(actualCacheKey) === 'processing' && (!fallbackActive || upscaleCache.get(cacheKey) === 'processing') && viewMode === 'VIEWER' && Math.abs(idx - currentIndex) <= 16;
                    enqueueTask(
                        isValid,
                        async () => {
                            if (!isValid()) { resolve(null); return; }
                            try {
                                let outW = Math.ceil(inW * ratio);
                                let outH = Math.ceil(inH * ratio);
                                let resCanvas;

                                let renderRatio = ratio;
                                const bypassThreshold = isLowEndHardware ? 0.8 : (isHighMemMode ? 0.3 : 0.5);
                                let bypassSuperSampling = ratio <= bypassThreshold;

                                if (actualMode === 'ADPTV_SHOGA' && !bypassSuperSampling) {
                                    renderRatio = Math.max(1.5, ratio);
                                    const maxArea = getDynamicMaxArea();
                                    while ((inW * renderRatio * inH * renderRatio > maxArea || inW * renderRatio > 16384 || inH * renderRatio > 16384) && renderRatio > ratio) {
                                        renderRatio = Math.max(ratio, renderRatio - 0.1);
                                    }
                                }

                                if ((actualMode !== 'ADPTV_SHOGA' && ratio < 1.0) || (actualMode === 'ADPTV_SHOGA' && bypassSuperSampling)) {
                                    resCanvas = createStepDownscaledCanvas(inputImg, outW, outH);
                                } else {
                                    let MAX_DIM = MAX_GL_TEXTURE_SIZE;
                                    let MAX_AREA = getDynamicMaxArea();
                                    let requiresTiling = (inW * renderRatio > MAX_DIM || inH * renderRatio > MAX_DIM || (inW * renderRatio) * (inH * renderRatio) > MAX_AREA);

                                    if (requiresTiling || renderRatio > ratio) {
                                        resCanvas = await performUpscale(inputImg, actualMode, renderRatio, ratio, inW, inH, outW, outH, isValid);
                                    } else {
                                        resCanvas = document.createElement('canvas');
                                        resCanvas.width = outW;
                                        resCanvas.height = outH;
                                        if (actualMode === 'FSR') {
                                            const intermediateCanvas = document.createElement('canvas');
                                            intermediateCanvas.width = outW;
                                            intermediateCanvas.height = outH;
                                            renderFSR(inputImg, intermediateCanvas, outW, outH, inW, inH, 0.2);
                                            renderAntiJaggies(intermediateCanvas, resCanvas, outW, outH, outW, outH);
                                            intermediateCanvas.width = 0; intermediateCanvas.height = 0;
                                        } else if (actualMode === 'ANIME4K') {
                                            renderAnime4KLite(inputImg, resCanvas, outW, outH, inW, inH);
                                        } else if (actualMode === 'XBRZ') {
                                            renderXBRZLite(inputImg, resCanvas, outW, outH, inW, inH);
                                        } else if (actualMode === 'ADPTV_SHOGA') {
                                            renderAdptvShogaPlus(inputImg, resCanvas, outW, outH, inW, inH, renderRatio);
                                        }
                                    }
                                }
                                resolve(resCanvas);
                            } catch (e) { reject(e); }
                        },
                        () => resolve(null)
                    );
                });
            };

            let finalCanvas;
            let pass1Canvas = null;
            if (currentRatio === 4.0) {
                pass1Canvas = await runSinglePass(srcImg, nw, nh, 2.0);
                if (!pass1Canvas) {
                    if (upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                    if (fallbackActive && upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                    preloadQueueTimer = setTimeout(processNextPreload, 50);
                    return;
                }
                finalCanvas = await runSinglePass(pass1Canvas, nw * 2.0, nh * 2.0, 2.0);
                pass1Canvas.width = 0; pass1Canvas.height = 0;
            } else {
                finalCanvas = await runSinglePass(srcImg, nw, nh, currentRatio);
            }
            if (!finalCanvas) {
                if (upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                if (fallbackActive && upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                preloadQueueTimer = setTimeout(processNextPreload, 50);
                return;
            }

            const fileType = files[idx].type;
            const mime = (fileType === 'image/png' || fileType === 'image/webp' || fileType === 'image/gif') ? 'image/png' : 'image/jpeg';

            finalCanvas.toBlob(blob => {
                finalCanvas.width = 0; finalCanvas.height = 0;
                if (!blob) {
                    console.error('Preload Canvas toBlob failed for:', actualCacheKey);
                    upscaleCache.set(actualCacheKey, 'error');
                    if (fallbackActive) upscaleCache.set(cacheKey, 'error');
                    preloadQueueTimer = setTimeout(processNextPreload, 50);
                    return;
                }
                const newUrl = URL.createObjectURL(blob);
                if (upscaleCache.size >= 64) {
                    const activeUrls = new Set();
                    for (let i = Math.max(0, currentIndex - 2); i <= Math.min(files.length - 1, currentIndex + 2); i++) {
                        if (urlCache.has(i)) activeUrls.add(urlCache.get(i));
                    }
                    for (const [k, v] of upscaleCache.entries()) {
                        if (v !== 'processing') {
                            const origUrl = k.split('_')[0];
                            if (!activeUrls.has(origUrl)) {
                                if (v && v.startsWith('blob:')) URL.revokeObjectURL(v);
                                upscaleCache.delete(k);
                            }
                        }
                    }
                }
                upscaleCache.set(actualCacheKey, newUrl);
                if (fallbackActive) upscaleCache.set(cacheKey, newUrl);

                clearTimeout(upscaleDebounceTimer);
                upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 100);

                preloadQueueTimer = setTimeout(processNextPreload, 50);
            }, mime, 0.92);
        } catch (e) {
            console.error('Preload upscaling process failed:', e);
            upscaleCache.set(actualCacheKey, 'error');
            if (fallbackActive) upscaleCache.set(cacheKey, 'error');
            preloadQueueTimer = setTimeout(processNextPreload, 50);
        }
    };
    srcImg.onerror = (err) => {
        console.error('Preload failed to load source image:', origUrl, err);
        const cacheKey = origUrl + '_' + actualMode + '_' + originalTargetRatio;
        if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
        upscaleCache.set(cacheKey, 'error');
        preloadQueueTimer = setTimeout(processNextPreload, 50);
    };
    srcImg.src = origUrl;
}

function startPreloadQueue() {
    if (upscaleMode === 'OFF' || viewMode !== 'VIEWER') return;
    if (isPreloading) return;
    isPreloading = true;
    processNextPreload();
}

const executeCrossfadeSwap = (img, targetUrl, tierName) => {
    if (!img.parentElement) return;

    if (img.src === targetUrl || img.dataset.pendingSwapUrl === targetUrl) {
        if (img.src === targetUrl) {
            if (tierName) {
                img.dataset.upscaleAppliedTier = tierName;
                if (tierName === 'NATIVE_BILINEAR') delete img.dataset.upscaleProcessingKey;
            } else {
                delete img.dataset.upscaleAppliedTier;
                delete img.dataset.upscaleProcessingKey;
            }
        }
        return;
    }

    let zoom = img.closest('#viewer-content') ? currentZoom : 1;
    if (zoom > 1.1) {
        img.dataset.pendingSwapUrl = targetUrl;
        const loader = new Image();
        loader.onload = () => {
            if (img.dataset.pendingSwapUrl !== targetUrl || !img.isConnected) return;
            loader.decode().then(() => {
                if (img.dataset.pendingSwapUrl !== targetUrl || !img.isConnected) return;

                const computedStyle = window.getComputedStyle(img);
                const overlay = new Image();
                overlay.src = targetUrl;
                overlay.className = img.className;
                overlay.classList.add('crossfade-clone');
                if (tierName) overlay.dataset.upscaleAppliedTier = tierName;

                overlay.style.cssText = img.style.cssText;
                overlay.style.position = 'absolute';
                overlay.style.width = img.offsetWidth + 'px';
                overlay.style.height = img.offsetHeight + 'px';
                overlay.style.left = img.offsetLeft + 'px';
                overlay.style.top = img.offsetTop + 'px';
                overlay.style.zIndex = '10';
                overlay.style.opacity = '1';
                overlay.style.transition = 'none';
                overlay.style.pointerEvents = 'none';
                overlay.style.objectFit = computedStyle.objectFit;
                overlay.style.objectPosition = computedStyle.objectPosition;

                img.parentElement.style.position = 'relative';
                img.parentElement.appendChild(overlay);

                img.src = targetUrl;
                if (tierName) {
                    img.dataset.upscaleAppliedTier = tierName;
                    if (tierName === 'NATIVE_BILINEAR') delete img.dataset.upscaleProcessingKey;
                } else {
                    delete img.dataset.upscaleAppliedTier;
                    delete img.dataset.upscaleProcessingKey;
                }

                img.decode().then(() => {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }).catch(() => {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                });
            }).catch(() => {
                if (img.dataset.pendingSwapUrl !== targetUrl || !img.isConnected) return;
                img.src = targetUrl;
                if (tierName) {
                    img.dataset.upscaleAppliedTier = tierName;
                    if (tierName === 'NATIVE_BILINEAR') delete img.dataset.upscaleProcessingKey;
                } else {
                    delete img.dataset.upscaleAppliedTier;
                    delete img.dataset.upscaleProcessingKey;
                }
            });
        };
        loader.onerror = () => {
            if (img.dataset.pendingSwapUrl === targetUrl) delete img.dataset.pendingSwapUrl;
        };
        loader.src = targetUrl;
        return;
    }

    img.dataset.pendingSwapUrl = targetUrl;

    const preloader = new Image();
    preloader.onload = () => {
        if (img.dataset.pendingSwapUrl !== targetUrl) return;
        if (!img.parentElement || !img.isConnected) return;

        img.parentElement.style.position = 'relative';

        const overlay = new Image();
        overlay.src = targetUrl;
        overlay.className = img.className;
        overlay.classList.add('crossfade-clone');
        if (tierName) {
            overlay.dataset.upscaleAppliedTier = tierName;
        }

        const computedStyle = window.getComputedStyle(img);

        overlay.style.cssText = img.style.cssText;
        overlay.style.position = 'absolute';
        overlay.style.width = img.offsetWidth + 'px';
        overlay.style.height = img.offsetHeight + 'px';
        overlay.style.left = img.offsetLeft + 'px';
        overlay.style.top = img.offsetTop + 'px';
        overlay.style.zIndex = '10';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 1.5s ease-in-out';
        overlay.style.pointerEvents = 'none';
        overlay.style.objectFit = computedStyle.objectFit;
        overlay.style.objectPosition = computedStyle.objectPosition;

        img.parentElement.appendChild(overlay);

        overlay.decode().then(() => {
            if (!img.isConnected) {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                return;
            }
            if (img.dataset.pendingSwapUrl !== targetUrl) {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                return;
            }

            void overlay.offsetWidth;

            overlay.style.opacity = '1';
            setTimeout(() => {
                if (!img.isConnected) {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    return;
                }
                if (img.dataset.pendingSwapUrl === targetUrl) {
                    img.src = targetUrl;
                    if (tierName) {
                        img.dataset.upscaleAppliedTier = tierName;
                        if (tierName === 'NATIVE_BILINEAR') delete img.dataset.upscaleProcessingKey;
                    } else {
                        delete img.dataset.upscaleAppliedTier;
                        delete img.dataset.upscaleProcessingKey;
                    }

                    img.decode().then(() => {
                        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    }).catch(() => {
                        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    });
                } else {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }
            }, 1550);
        }).catch(() => {
            if (!img.isConnected) {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                return;
            }
            if (img.dataset.pendingSwapUrl === targetUrl) {
                img.src = targetUrl;
                if (tierName) {
                    img.dataset.upscaleAppliedTier = tierName;
                    if (tierName === 'NATIVE_BILINEAR') delete img.dataset.upscaleProcessingKey;
                } else {
                    delete img.dataset.upscaleAppliedTier;
                    delete img.dataset.upscaleProcessingKey;
                }
            }
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        });
    };
    preloader.onerror = (err) => {
        console.error('Crossfade preloader failed to load:', targetUrl, err);
        if (img.dataset.pendingSwapUrl === targetUrl) {
            delete img.dataset.pendingSwapUrl;
        }
    };
    preloader.src = targetUrl;
};

function applyUpscaleOverlays() {
    if (upscaleMode === 'OFF' || viewMode !== 'VIEWER') return;
    if (dom.body.classList.contains('animating')) return;

    const imgs = dom.viewerContent.querySelectorAll('.shoga-main-media:not(.crossfade-clone)');

    const warningIds = {
        'FSR': 'warning-fsr',
        'ANIME4K': 'warning-anime4k',
        'XBRZ': 'warning-xbrz'
    };

    Object.values(warningIds).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    let overlayLogQueue = [];

    Promise.all(Array.from(imgs).map(async (img) => {
        const fIdx = parseInt(img.dataset.fileIndex);
        if (isNaN(fIdx) || !files[fIdx] || files[fIdx].isBroken) return;
        const fileObj = files[fIdx];

        let isAnim = await checkAnimated(fileObj);
        overlayLogQueue.push(`[Index ${fIdx}] Type: ${fileObj.type}, isAnim: ${isAnim}`);
        if (isAnim || fileObj.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(fileObj.name)) {
            overlayLogQueue.push(` -> Skipped (Anim/Video)`);
            return;
        }

        let nw = fileObj.nw;
        let nh = fileObj.nh;
        if (!nw || !nh) {
            if (img.complete && img.naturalWidth && img.naturalHeight) {
                nw = img.naturalWidth;
                nh = img.naturalHeight;
                fileObj.nw = nw;
                fileObj.nh = nh;
            } else {
                overlayLogQueue.push(` -> nw/nh missing, waiting for load.`);
                if (!img.complete) {
                    if (!img.dataset.loadListenerAttached) {
                        img.dataset.loadListenerAttached = 'true';
                        img.addEventListener('load', () => {
                            delete img.dataset.loadListenerAttached;
                            clearTimeout(upscaleDebounceTimer);
                            upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 100);
                        }, { once: true });
                    }
                }
                return;
            }
        }

        let actualMode = upscaleMode;
        let isBilinear = actualMode === 'BILINEAR';
        let originalTargetRatio = (isHighMemMode && is4xEnabled && !isBilinear && actualMode !== 'ADPTV_SHOGA') ? 4.0 : (isBilinear ? 1.0 : 2.0);
        let targetRatio = originalTargetRatio;

        let fallbackActive = false;

        if (actualMode === 'ADPTV_SHOGA') {
            let displayW = window.innerWidth * currentZoom;
            if (getCurrentLayoutMode() === 'SPREAD' && getSpreadGroup(fIdx).length === 2) displayW *= 0.5;
            let dynamicRatio = displayW / nw;
            targetRatio = Math.ceil(dynamicRatio * 10) / 10;
            if (targetRatio < 0.1) targetRatio = 0.1;

            const maxArea = getDynamicMaxArea();
            while ((nw * targetRatio * nh * targetRatio > maxArea || nw * targetRatio > 16384 || nh * targetRatio > 16384) && targetRatio > 1.0) {
                targetRatio = Math.max(1.0, targetRatio - 0.1);
            }
            targetRatio = Math.round(targetRatio * 10) / 10;
            originalTargetRatio = targetRatio;
        } else {
            if (targetRatio === 4.0 && (nw * 4.0 > 16384 || nh * 4.0 > 16384)) {
                targetRatio = 2.0;
                fallbackActive = true;
                const warningEl = document.getElementById(warningIds[actualMode]);
                if (warningEl) warningEl.style.display = 'flex';
            }
        }

        overlayLogQueue.push(` -> Target ratio: ${targetRatio}, fallbackActive: ${fallbackActive}`);

        if (isBilinear) {
            if (img.dataset.upscaleAppliedTier !== 'NATIVE_BILINEAR') {
                executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
            }
            return;
        }

        let currentlyAppliedRatio = -1;
        if (img.dataset.upscaleAppliedTier && img.dataset.upscaleAppliedTier.startsWith(img.dataset.originalUrl + '_' + actualMode + '_')) {
            currentlyAppliedRatio = parseFloat(img.dataset.upscaleAppliedTier.split('_').pop());
        }
        if (!isNaN(currentlyAppliedRatio) && currentlyAppliedRatio >= targetRatio) {
            overlayLogQueue.push(` -> Already met or exceeded target ratio`);
            return;
        }

        let bestCachedKey = null;
        let bestCachedRatio = -1;
        let isProcessingHigher = false;
        let hasSkippedOrError = false;

        for (let [key, cacheVal] of upscaleCache.entries()) {
            if (key.startsWith(img.dataset.originalUrl + '_' + actualMode + '_')) {
                let cachedRatio = parseFloat(key.split('_').pop());
                if (!isNaN(cachedRatio) && cachedRatio >= targetRatio) {
                    if (cacheVal === 'processing') {
                        isProcessingHigher = true;
                    } else if (cacheVal === 'skipped' || cacheVal === 'error') {
                        if (cachedRatio === targetRatio || (fallbackActive && cachedRatio === originalTargetRatio)) {
                            hasSkippedOrError = true;
                        }
                    } else {
                        if (bestCachedRatio === -1 || cachedRatio < bestCachedRatio) {
                            bestCachedKey = key;
                            bestCachedRatio = cachedRatio;
                        }
                    }
                }
            }
        }

        if (bestCachedKey) {
            overlayLogQueue.push(` -> Cache hit: ${bestCachedKey}`);
            if (img.dataset.upscaleAppliedTier === bestCachedKey || img.dataset.upscaleProcessingKey === bestCachedKey) return;
            img.dataset.upscaleProcessingKey = bestCachedKey;
            executeCrossfadeSwap(img, upscaleCache.get(bestCachedKey), bestCachedKey);
            return;
        }

        if (isProcessingHigher) {
            overlayLogQueue.push(` -> isProcessingHigher, skipping`);
            return;
        }

        if (hasSkippedOrError) {
            overlayLogQueue.push(` -> hasSkippedOrError, falling back to NATIVE_BILINEAR`);
            if (img.dataset.upscaleAppliedTier !== 'NATIVE_BILINEAR') {
                executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
            }
            return;
        }

        const cacheKey = img.dataset.originalUrl + '_' + actualMode + '_' + originalTargetRatio;
        const actualCacheKey = img.dataset.originalUrl + '_' + actualMode + '_' + targetRatio;

        if (img.dataset.upscaleAppliedTier === cacheKey || img.dataset.upscaleProcessingKey === cacheKey) return;

        if (isPanning || isDragging) {
            overlayLogQueue.push(` -> isPanning/isDragging, skipping upscale`);
            return;
        }

        overlayLogQueue.push(` -> Starting upscale process, cacheKey: ${cacheKey}`);
        img.dataset.upscaleProcessingKey = cacheKey;
        upscaleCache.set(cacheKey, 'processing');
        if (fallbackActive) upscaleCache.set(actualCacheKey, 'processing');

        const process = async () => {
            showUpscaleIndicator();
            const srcImg = new Image();
            srcImg.crossOrigin = "anonymous";
            srcImg.onload = async () => {
                if (!files[fIdx] || files[fIdx] !== fileObj) {
                    hideUpscaleIndicator();
                    return;
                }
                if (img.dataset.upscaleProcessingKey !== cacheKey || viewMode !== 'VIEWER') {
                    if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                    if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                    hideUpscaleIndicator();
                    return;
                }
                try {
                    const runSinglePass = async (inputImg, inW, inH, ratio) => {
                        return new Promise((resolve, reject) => {
                            let isValid = () => img.dataset.upscaleProcessingKey === cacheKey && viewMode === 'VIEWER';
                            enqueueTask(
                                isValid,
                                async () => {
                                    if (!isValid()) { resolve(null); return; }
                                    try {
                                        let outW = Math.ceil(inW * ratio);
                                        let outH = Math.ceil(inH * ratio);
                                        let resCanvas;

                                        let renderRatio = ratio;
                                        const bypassThreshold = isLowEndHardware ? 0.8 : (isHighMemMode ? 0.3 : 0.5);
                                        let bypassSuperSampling = ratio <= bypassThreshold;

                                        if (actualMode === 'ADPTV_SHOGA' && !bypassSuperSampling) {
                                            renderRatio = Math.max(1.5, ratio);
                                            const maxArea = getDynamicMaxArea();
                                            while ((inW * renderRatio * inH * renderRatio > maxArea || inW * renderRatio > 16384 || inH * renderRatio > 16384) && renderRatio > ratio) {
                                                renderRatio = Math.max(ratio, renderRatio - 0.1);
                                            }
                                        }

                                        if ((actualMode !== 'ADPTV_SHOGA' && ratio < 1.0) || (actualMode === 'ADPTV_SHOGA' && bypassSuperSampling)) {
                                            resCanvas = createStepDownscaledCanvas(inputImg, outW, outH);
                                        } else {
                                            let MAX_DIM = MAX_GL_TEXTURE_SIZE;
                                            let MAX_AREA = getDynamicMaxArea();
                                            let requiresTiling = (inW * renderRatio > MAX_DIM || inH * renderRatio > MAX_DIM || (inW * renderRatio) * (inH * renderRatio) > MAX_AREA);

                                            if (requiresTiling || renderRatio > ratio) {
                                                resCanvas = await performUpscale(inputImg, actualMode, renderRatio, ratio, inW, inH, outW, outH, isValid);
                                            } else {
                                                resCanvas = document.createElement('canvas');
                                                resCanvas.width = outW;
                                                resCanvas.height = outH;
                                                if (actualMode === 'FSR') {
                                                    const intermediateCanvas = document.createElement('canvas');
                                                    intermediateCanvas.width = outW;
                                                    intermediateCanvas.height = outH;
                                                    renderFSR(inputImg, intermediateCanvas, outW, outH, inW, inH, 0.2);
                                                    renderAntiJaggies(intermediateCanvas, resCanvas, outW, outH, outW, outH);
                                                    intermediateCanvas.width = 0; intermediateCanvas.height = 0;
                                                } else if (actualMode === 'ANIME4K') {
                                                    renderAnime4KLite(inputImg, resCanvas, outW, outH, inW, inH);
                                                } else if (actualMode === 'XBRZ') {
                                                    renderXBRZLite(inputImg, resCanvas, outW, outH, inW, inH);
                                                } else if (actualMode === 'ADPTV_SHOGA') {
                                                    renderAdptvShogaPlus(inputImg, resCanvas, outW, outH, inW, inH, renderRatio);
                                                }
                                            }
                                        }
                                        resolve(resCanvas);
                                    } catch (e) { reject(e); }
                                },
                                () => resolve(null)
                            );
                        });
                    };

                    const convertToUrl = (canvas) => {
                        return new Promise(resolve => {
                            const fileType = fileObj.type || 'image/jpeg';
                            const mime = (fileType === 'image/png' || fileType === 'image/webp' || fileType === 'image/gif') ? 'image/png' : 'image/jpeg';
                            canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), mime, 0.92);
                        });
                    };

                    let finalUrl = null;
                    let p1Url = null;
                    try {
                        if (targetRatio === 4.0 && actualMode !== 'ADPTV_SHOGA') {
                            let p1Canvas = await runSinglePass(srcImg, nw, nh, 2.0);
                            if (!p1Canvas) {
                                if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                                if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                                hideUpscaleIndicator();
                                return;
                            }
                            p1Url = await convertToUrl(p1Canvas);
                            if (p1Url) executeCrossfadeSwap(img, p1Url, 'STEP_2X');

                            let p2Canvas = await runSinglePass(p1Canvas, nw * 2.0, nh * 2.0, 2.0);
                            p1Canvas.width = 0; p1Canvas.height = 0;
                            if (!p2Canvas) {
                                if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                                if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                                hideUpscaleIndicator();
                                return;
                            }
                            finalUrl = await convertToUrl(p2Canvas);
                            p2Canvas.width = 0; p2Canvas.height = 0;
                            if (p1Url) setTimeout(() => URL.revokeObjectURL(p1Url), 2000);
                        } else if (actualMode === 'ADPTV_SHOGA' && targetRatio > 1.0) {
                            if (currentlyAppliedRatio < 1.0) {
                                let p1Canvas = await runSinglePass(srcImg, nw, nh, 1.0);
                                if (!p1Canvas) {
                                    if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                                    if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                                    hideUpscaleIndicator();
                                    return;
                                }
                                p1Url = await convertToUrl(p1Canvas);
                                p1Canvas.width = 0; p1Canvas.height = 0;
                                if (p1Url) executeCrossfadeSwap(img, p1Url, 'STEP_1X_ADPTV');
                            }

                            let finalCanvas = await runSinglePass(srcImg, nw, nh, targetRatio);
                            if (!finalCanvas) {
                                if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                                if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                                hideUpscaleIndicator();
                                return;
                            }
                            finalUrl = await convertToUrl(finalCanvas);
                            finalCanvas.width = 0; finalCanvas.height = 0;
                            if (p1Url) setTimeout(() => URL.revokeObjectURL(p1Url), 2000);
                        } else {
                            let finalCanvas = await runSinglePass(srcImg, nw, nh, targetRatio);
                            if (!finalCanvas) {
                                if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                                if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                                hideUpscaleIndicator();
                                return;
                            }
                            finalUrl = await convertToUrl(finalCanvas);
                            finalCanvas.width = 0; finalCanvas.height = 0;
                        }

                        if (finalUrl) {
                            if (img.dataset.upscaleProcessingKey !== cacheKey || viewMode !== 'VIEWER') {
                                URL.revokeObjectURL(finalUrl);
                                if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                                if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                                hideUpscaleIndicator();
                                return;
                            }
                            if (upscaleCache.size >= 64) {
                                const activeUrls = new Set();
                                for (let i = Math.max(0, currentIndex - 2); i <= Math.min(files.length - 1, currentIndex + 2); i++) {
                                    if (urlCache.has(i)) activeUrls.add(urlCache.get(i));
                                }
                                for (const [k, v] of upscaleCache.entries()) {
                                    if (v !== 'processing') {
                                        const origUrl = k.split('_')[0];
                                        if (!activeUrls.has(origUrl)) {
                                            if (v && v.startsWith('blob:')) URL.revokeObjectURL(v);
                                            upscaleCache.delete(k);
                                        }
                                    }
                                }
                            }
                            upscaleCache.set(actualCacheKey, finalUrl);
                            if (fallbackActive) upscaleCache.set(cacheKey, finalUrl);
                            executeCrossfadeSwap(img, finalUrl, cacheKey);
                            hideUpscaleIndicator();
                        } else {
                            console.error('Canvas toBlob failed for:', actualCacheKey);
                            if (img.dataset.upscaleProcessingKey !== cacheKey || viewMode !== 'VIEWER') {
                                if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                                if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                                hideUpscaleIndicator();
                                return;
                            }
                            upscaleCache.set(cacheKey, 'error');
                            if (fallbackActive) upscaleCache.set(actualCacheKey, 'error');
                            executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
                            hideUpscaleIndicator();
                        }
                    } catch (e) {
                        if (p1Url) URL.revokeObjectURL(p1Url);
                        console.error('Upscaling process failed:', e);
                        if (img.dataset.upscaleProcessingKey !== cacheKey || viewMode !== 'VIEWER') {
                            if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                            if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                            hideUpscaleIndicator();
                            return;
                        }
                        upscaleCache.set(cacheKey, 'error');
                        if (fallbackActive) upscaleCache.set(actualCacheKey, 'error');
                        executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
                        hideUpscaleIndicator();
                    }
                } catch (e) {
                    console.error('Upscaling process setup failed:', e);
                    if (img.dataset.upscaleProcessingKey !== cacheKey || viewMode !== 'VIEWER') {
                        if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                        if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                        hideUpscaleIndicator();
                        return;
                    }
                    upscaleCache.set(cacheKey, 'error');
                    if (fallbackActive) upscaleCache.set(actualCacheKey, 'error');
                    executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
                    hideUpscaleIndicator();
                }
            };
            srcImg.onerror = (err) => {
                console.error('Failed to load source image for upscaling:', img.dataset.originalUrl, err);
                if (img.dataset.upscaleProcessingKey !== cacheKey || viewMode !== 'VIEWER') {
                    if (upscaleCache.get(cacheKey) === 'processing') upscaleCache.delete(cacheKey);
                    if (fallbackActive && upscaleCache.get(actualCacheKey) === 'processing') upscaleCache.delete(actualCacheKey);
                    hideUpscaleIndicator();
                    return;
                }
                upscaleCache.set(cacheKey, 'error');
                if (fallbackActive) upscaleCache.set(actualCacheKey, 'error');
                executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
                hideUpscaleIndicator();
            };
            srcImg.src = img.dataset.originalUrl;
        };

        if (img.complete) process();
        else {
            if (!img.dataset.processListenerAttached) {
                img.dataset.processListenerAttached = 'true';
                img.addEventListener('load', () => {
                    delete img.dataset.processListenerAttached;
                    process();
                }, { once: true });
            }
        }
    })).then(() => {
        if (overlayLogQueue.length > 0) {
            console.groupCollapsed(`[UpscaleOverlays] Evaluated ${imgs.length} items`);
            console.log(overlayLogQueue.join('\n'));
            console.groupEnd();
        }
        startPreloadQueue();
    });
}

function processFileList(fileList, title) {
    destroyAllHls();
    urlCache.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
    urlCache.clear();

    upscaleCache.forEach(url => { if (url !== 'error' && url !== 'skipped' && url !== 'processing' && url.startsWith('blob:')) URL.revokeObjectURL(url); });
    upscaleCache.clear();

    files = fileList.sort(fileSortFn);

    currentIndex = 0;
    isGridRendered = false;
    isSingleFileMode = false;

    lazyThumbnailObserver.disconnect();
    dom.gridArea.replaceChildren();
    dom.slots.prev.replaceChildren();
    dom.viewerContent.replaceChildren();
    if (!dom.viewerContent.parentElement) dom.slots.curr.appendChild(dom.viewerContent);
    dom.slots.next.replaceChildren();

    resetTransform(false);

    if (title) {
        currentTitle = title;
        documentTitle = currentTitle;
    } else {
        currentTitle = 'Shoga Viewer';
        document.title = currentTitle;
    }

    if (files.length > 0 || currentFolders.length > 0) {
        dom.idleScreen.style.display = 'none';
        const idleTitle = dom.idleScreen.querySelector('h1');
        const idleDesc = dom.idleScreen.querySelector('p');
        if (idleTitle) idleTitle.textContent = 'SHOGA';
        if (idleDesc) idleDesc.textContent = 'VISUAL INTELLIGENCE ENGINE';

        if (pendingBookmarkRestoreId) {
            const id = pendingBookmarkRestoreId;
            pendingBookmarkRestoreId = null;
            restoreBookmark(id);
        } else {
            switchToGrid();
        }
    }
}

function switchToGrid() {
    destroyAllHls();
    pointers = []; isPanning = false; isDragging = false; isGridSwiping = false; isGridPulling = false; initialDistance = 0;
    viewMode = 'GRID';
    dom.body.classList.remove('ui-hidden');
    dom.gridArea.style.display = 'grid';
    dom.viewerArea.style.display = 'none';
    dom.btnGrid.style.display = 'none';
    dom.btnInfo.style.display = 'none';
    dom.btnSave.style.display = 'none';

    if (isGridRendered) {
        const currentItem = dom.gridArea.querySelector(`.grid-item[data-index="${currentIndex}"]`);
        if (currentItem) {
            currentItem.scrollIntoView({ block: 'center' });
        }
        return;
    }

    lazyThumbnailObserver.disconnect();
    dom.gridArea.innerHTML = '';

    const headerContainer = document.createElement('div');
    headerContainer.style.gridColumn = '1 / -1';
    headerContainer.style.display = 'flex';
    headerContainer.style.justifyContent = 'space-between';
    headerContainer.style.alignItems = 'center';
    headerContainer.style.marginBottom = '15px';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = currentTitle;
    titleSpan.style.fontSize = '0.85rem';
    titleSpan.style.color = 'var(--text-secondary)';
    titleSpan.style.letterSpacing = '1px';
    titleSpan.style.fontWeight = '600';
    titleSpan.style.paddingLeft = '5px';
    headerContainer.appendChild(titleSpan);

    const controlsWrapper = document.createElement('div');
    controlsWrapper.className = 'header-controls-wrapper';

    const btnGridSearch = document.createElement('button');
    btnGridSearch.className = 'btn-grid-search subtle-icon-btn';
    btnGridSearch.style.display = 'none';
    btnGridSearch.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    btnGridSearch.addEventListener('click', () => {
        controlsWrapper.classList.toggle('search-active');
    });
    controlsWrapper.appendChild(btnGridSearch);

    const createSearchFilter = (type) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'grid-search-input-wrapper';
        wrapper.style.position = 'relative';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';

        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.className = type === 'folder' ? 'folder-filter-input' : 'file-filter-input';
        filterInput.id = type === 'folder' ? 'folder-filter-input' : 'file-filter-input';
        filterInput.placeholder = type === 'folder' ? 'Folder...' : 'File...';
        filterInput.value = type === 'folder' ? folderFilterText : fileFilterText;
        filterInput.style.paddingRight = '26px';

        const clearBtn = document.createElement('button');
        clearBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        clearBtn.style.position = 'absolute';
        clearBtn.style.right = '4px';
        clearBtn.style.background = 'transparent';
        clearBtn.style.border = 'none';
        clearBtn.style.color = 'var(--text-secondary)';
        clearBtn.style.padding = '4px';
        clearBtn.style.cursor = 'pointer';
        clearBtn.style.opacity = (type === 'folder' ? folderFilterText : fileFilterText) ? '1' : '0';
        clearBtn.style.transition = 'opacity 0.2s, color 0.2s';
        clearBtn.style.pointerEvents = (type === 'folder' ? folderFilterText : fileFilterText) ? 'auto' : 'none';

        clearBtn.addEventListener('mouseover', () => clearBtn.style.color = 'var(--text-primary)');
        clearBtn.addEventListener('mouseout', () => clearBtn.style.color = 'var(--text-secondary)');

        const toggleClearBtn = () => {
            if (filterInput.value) {
                clearBtn.style.opacity = '1';
                clearBtn.style.pointerEvents = 'auto';
            } else {
                clearBtn.style.opacity = '0';
                clearBtn.style.pointerEvents = 'none';
            }
        };

        const applyFilter = () => {
            let filterId = type === 'folder' ? 'folder-filter-style' : 'file-filter-style';
            let targetClass = type === 'folder' ? '.folder-item' : '.grid-item';
            let currentText = type === 'folder' ? folderFilterText : fileFilterText;

            let styleEl = document.getElementById(filterId);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = filterId;
                document.head.appendChild(styleEl);
            }
            if (currentText) {
                const safeQuery = currentText.toLowerCase().replace(/(["\\])/g, '\\$1');
                styleEl.textContent = `${targetClass}:not([data-search*="${safeQuery}"]) { display: none !important; }`;
            } else {
                styleEl.textContent = '';
            }
        };

        applyFilter();

        filterInput.addEventListener('input', (e) => {
            if (type === 'folder') folderFilterText = e.target.value;
            else fileFilterText = e.target.value;
            toggleClearBtn();
            applyFilter();
        });

        clearBtn.addEventListener('click', () => {
            filterInput.value = '';
            if (type === 'folder') folderFilterText = '';
            else fileFilterText = '';
            toggleClearBtn();
            applyFilter();
            filterInput.focus();
        });

        wrapper.appendChild(filterInput);
        wrapper.appendChild(clearBtn);
        return wrapper;
    };

    if (currentFolders.length > 0) {
        const sortGroup = document.createElement('div');
        sortGroup.className = 'folder-sort-group';

        const createSortBtn = (mode, svgPath) => {
            const b = document.createElement('button');
            b.className = `folder-sort-btn ${folderSortMode === mode ? 'active' : ''}`;
            b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
            b.addEventListener('click', () => {
                folderSortMode = mode;
                isGridRendered = false;
                switchToGrid();
            });
            return b;
        };

        sortGroup.appendChild(createSortBtn('name-asc', '<path d="M6 3v18"></path><path d="M10 7l-4-4-4 4"></path><path d="M20 5h-5"></path><path d="M19 11h-4"></path><path d="M18 17h-4"></path>'));
        sortGroup.appendChild(createSortBtn('name-desc', '<path d="M6 21V3"></path><path d="M10 17l-4 4-4-4"></path><path d="M20 5h-5"></path><path d="M19 11h-4"></path><path d="M18 17h-4"></path>'));

        controlsWrapper.appendChild(sortGroup);
        controlsWrapper.appendChild(createSearchFilter('folder'));
    }

    if (files.length > 0) {
        const fileSortGroup = document.createElement('div');
        fileSortGroup.className = 'folder-sort-group';

        const createFileSortBtn = (mode, svgPath) => {
            const b = document.createElement('button');
            b.className = `folder-sort-btn ${fileSortMode === mode ? 'active' : ''}`;
            b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
            b.addEventListener('click', () => {
                if (fileSortMode === mode) return;
                fileSortMode = mode;

                const currentFile = files[currentIndex];
                files.sort(fileSortFn);

                if (currentFile) {
                    const newIndex = files.findIndex(f => f.name === currentFile.name);
                    if (newIndex !== -1) currentIndex = newIndex;
                }

                urlCache.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
                urlCache.clear();
                upscaleCache.forEach(url => { if (url !== 'error' && url !== 'skipped' && url !== 'processing' && url.startsWith('blob:')) URL.revokeObjectURL(url); });
                upscaleCache.clear();

                isGridRendered = false;
                switchToGrid();
            });
            return b;
        };

        fileSortGroup.appendChild(createFileSortBtn('name-asc', '<path d="M6 3v18"></path><path d="M10 7l-4-4-4 4"></path><path d="M20 5h-5"></path><path d="M19 11h-4"></path><path d="M18 17h-4"></path>'));
        fileSortGroup.appendChild(createFileSortBtn('name-desc', '<path d="M6 21V3"></path><path d="M10 17l-4 4-4-4"></path><path d="M20 5h-5"></path><path d="M19 11h-4"></path><path d="M18 17h-4"></path>'));

        controlsWrapper.appendChild(fileSortGroup);
        controlsWrapper.appendChild(createSearchFilter('file'));
    }

    if (dirStack.length > 1) {
        const btnUp = document.createElement('button');
        btnUp.className = 'btn-up';
        btnUp.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`;
        btnUp.addEventListener('click', async () => {
            dirStack.pop();
            const parent = dirStack[dirStack.length - 1];
            folderFilterText = parent.folderFilterText || '';
            fileFilterText = parent.fileFilterText || '';
            if (parent.isJellyfin) {
                await loadJellyfinFolder(parent.id, parent.name);
            } else {
                await processDirectoryHandle(parent.handle, parent.name);
            }
            requestAnimationFrame(() => {
                dom.gridArea.scrollTop = parent.scrollTop || 0;
            });
        });
        controlsWrapper.appendChild(btnUp);
    }

    headerContainer.appendChild(controlsWrapper);
    dom.gridArea.appendChild(headerContainer);

    if (currentFolders.length > 0) {
        const folderContainer = document.createElement('div');
        folderContainer.style.gridColumn = '1 / -1';
        folderContainer.style.display = 'flex';
        folderContainer.style.flexWrap = 'wrap';
        folderContainer.style.gap = '10px';
        folderContainer.style.marginBottom = '20px';

        let displayFolders = [...currentFolders];
        if (folderSortMode === 'name-asc') displayFolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        else if (folderSortMode === 'name-desc') displayFolders.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));

        displayFolders.forEach(folder => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';

            folderItem.dataset.search = folder.name.toLowerCase();

            folderItem.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> <span>${escapeHtml(folder.name)}</span>`;
            folderItem.addEventListener('click', async () => {
                if (dirStack.length > 0) {
                    dirStack[dirStack.length - 1].scrollTop = dom.gridArea.scrollTop;
                    dirStack[dirStack.length - 1].folderFilterText = folderFilterText;
                    dirStack[dirStack.length - 1].fileFilterText = fileFilterText;
                }
                folderFilterText = '';
                fileFilterText = '';
                const filterStyleEl1 = document.getElementById('folder-filter-style');
                if (filterStyleEl1) filterStyleEl1.textContent = '';
                const filterStyleEl2 = document.getElementById('file-filter-style');
                if (filterStyleEl2) filterStyleEl2.textContent = '';

                history.pushState({ view: 'GRID', path: folder.name }, '');

                if (folder.isJellyfin) {
                    dirStack.push({ isJellyfin: true, id: folder.id, name: folder.name, scrollTop: 0, folderFilterText: '', fileFilterText: '' });
                    await loadJellyfinFolder(folder.id, folder.name);
                } else {
                    dirStack.push({ handle: folder, name: folder.name, scrollTop: 0, folderFilterText: '', fileFilterText: '' });
                    await processDirectoryHandle(folder, folder.name);
                }
            });
            folderContainer.appendChild(folderItem);
        });
        dom.gridArea.appendChild(folderContainer);
    }

    files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'grid-item';
        item.dataset.index = index;
        item.dataset.search = file.name.toLowerCase();
        const canvas = document.createElement('canvas');
        canvas.fileData = file;
        const badge = document.createElement('div');
        badge.className = 'index-badge';
        badge.textContent = index + 1;
        item.appendChild(canvas);
        item.appendChild(badge);
        dom.gridArea.appendChild(item);
        lazyThumbnailObserver.observe(canvas);
    });
    isGridRendered = true;
}

let gridClickStartX = 0;
let gridClickStartY = 0;
dom.gridArea.addEventListener('pointerdown', (e) => {
    gridClickStartX = e.clientX;
    gridClickStartY = e.clientY;
});

dom.gridArea.addEventListener('click', (e) => {
    if (Math.hypot(e.clientX - gridClickStartX, e.clientY - gridClickStartY) > 10) return;
    const item = e.target.closest('.grid-item');
    if (item) {
        currentIndex = parseInt(item.dataset.index, 10);
        switchToViewer();
    }
});

let gridPtrStartY = 0;
let gridPtrDistance = 0;
let isGridPulling = false;
const GRID_PTR_THRESHOLD = 80;

let gridSwipeStartX = 0;
let gridSwipeStartY = 0;
let gridSwipeStartTime = 0;
let isGridSwiping = false;

let gridTicking = false;
function updateGridUI() {
    if (isGridSwiping && dirStack.length > 1 && !isGridPulling) {
        const dx = pointers[0]?.clientX - gridSwipeStartX || 0;
        if (dx > 10) dom.gridArea.style.transform = `translateX(${(dx - 10) * 0.65}px)`;
    } else if (isGridPulling) {
        dom.gridArea.style.transform = `translateY(${gridPtrDistance}px)`;
        dom.ptrIndicator.style.opacity = Math.min(gridPtrDistance / GRID_PTR_THRESHOLD, 1);
        dom.ptrIndicator.style.transform = `translateX(-50%) rotate(${gridPtrDistance * 2}deg)`;
    }
    gridTicking = false;
}

dom.gridArea.addEventListener('pointerdown', (e) => {
    if (dom.bookmarksPanel.classList.contains('active')) {
        const rect = dom.bookmarksPanel.getBoundingClientRect();
        if (e.clientX >= rect.left - 300) return;
    }
    if (viewMode === 'GRID') {
        if (dom.gridArea.scrollTop <= 0) {
            isGridPulling = true;
            gridPtrStartY = e.clientY;
            gridPtrDistance = 0;
        }
        if (dirStack.length > 1) {
            isGridSwiping = true;
            gridSwipeStartX = e.clientX;
            gridSwipeStartY = e.clientY;
            gridSwipeStartTime = Date.now();
            dom.gridArea.style.transition = 'none';
            try { e.target.setPointerCapture(e.pointerId); } catch (err) { }
        }
        const existingIdx = pointers.findIndex(p => p.pointerId === e.pointerId);
        if (existingIdx !== -1) {
            pointers[existingIdx] = e;
        } else {
            pointers.push(e);
        }
    }
});

dom.gridArea.addEventListener('pointermove', (e) => {
    if (viewMode !== 'GRID') return;
    const existingIdx = pointers.findIndex(p => p.pointerId === e.pointerId);
    if (existingIdx !== -1) {
        pointers[existingIdx] = e;
    } else {
        pointers.push(e);
    }

    if (isGridSwiping && dirStack.length > 1) {
        const dx = e.clientX - gridSwipeStartX;
        const dy = Math.abs(e.clientY - gridSwipeStartY);

        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
            if (e.cancelable) e.preventDefault();
            if (dx > 0 && isGridPulling) {
                isGridPulling = false;
                dom.gridArea.classList.remove('pulling');
                dom.ptrIndicator.style.opacity = 0;
                dom.ptrIndicator.style.transform = 'translateX(-50%) rotate(0deg)';
                dom.gridArea.style.transform = '';
            }
        }

        if (dx > 10 && !isGridPulling) {
            if (!gridTicking) {
                requestAnimationFrame(updateGridUI);
                gridTicking = true;
            }
            return;
        }
    }

    if (!isGridPulling) return;
    const dy = e.clientY - gridPtrStartY;

    if (dy > 0 && dom.gridArea.scrollTop <= 0) {
        if (!dom.gridArea.classList.contains('pulling')) {
            dom.gridArea.classList.add('pulling');
            dom.ptrIndicator.style.display = 'block';
        }
        gridPtrDistance = dy * 0.4;
        if (!gridTicking) {
            requestAnimationFrame(updateGridUI);
            gridTicking = true;
        }
        if (e.cancelable) e.preventDefault();
    } else if (dy < 0) {
        isGridPulling = false;
        dom.gridArea.classList.remove('pulling');
        dom.gridArea.style.transform = '';
    }
}, { passive: false });

dom.gridArea.addEventListener('touchmove', (e) => {
    if (viewMode === 'GRID' && isGridSwiping && dirStack.length > 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - gridSwipeStartX;
        const dy = Math.abs(touch.clientY - gridSwipeStartY);
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
            if (e.cancelable) e.preventDefault();
        }
    }
}, { passive: false });

const endGridPull = async (e) => {
    if (isGridSwiping && e && e.clientX !== undefined) {
        isGridSwiping = false;
        try { e.target.releasePointerCapture(e.pointerId); } catch (err) { }

        const dx = e.clientX - gridSwipeStartX;
        const dt = Date.now() - gridSwipeStartTime;
        const velocity = dt > 0 ? dx / dt : 0;

        dom.gridArea.style.transition = 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)';

        if (dx > 70 || (dx > 30 && velocity > 0.6)) {
            isGridPulling = false;
            dom.gridArea.classList.remove('pulling');
            dom.gridArea.style.transform = `translateX(100vw)`;
            setTimeout(async () => {
                if (dirStack.length > 1) {
                    dirStack.pop();
                    const parent = dirStack[dirStack.length - 1];
                    folderFilterText = parent.folderFilterText || '';
                    fileFilterText = parent.fileFilterText || '';
                    if (parent.isJellyfin) {
                        await loadJellyfinFolder(parent.id, parent.name);
                    } else {
                        await processDirectoryHandle(parent.handle, parent.name);
                    }

                    dom.gridArea.style.transition = 'none';
                    dom.gridArea.style.transform = 'translateX(-15vw)';

                    requestAnimationFrame(() => {
                        dom.gridArea.scrollTop = parent.scrollTop || 0;
                        void dom.gridArea.offsetWidth;
                        dom.gridArea.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                        dom.gridArea.style.transform = 'translateX(0px)';
                        setTimeout(() => {
                            dom.gridArea.style.transform = '';
                            dom.gridArea.style.transition = '';
                        }, 300);
                    });
                } else {
                    dom.gridArea.style.transform = '';
                    dom.gridArea.style.transition = '';
                }
            }, 300);
            return;
        } else {
            dom.gridArea.style.transform = 'translateX(0px)';
            setTimeout(() => {
                dom.gridArea.style.transform = '';
                dom.gridArea.style.transition = '';
            }, 300);
        }
    } else {
        isGridSwiping = false;
    }

    if (!isGridPulling && !dom.gridArea.classList.contains('pulling')) return;
    isGridPulling = false;
    dom.gridArea.classList.remove('pulling');

    if (gridPtrDistance >= GRID_PTR_THRESHOLD) {
        dom.ptrIndicator.style.transition = 'transform 0.5s linear';
        dom.ptrIndicator.style.transform = `translateX(-50%) rotate(360deg)`;
        dom.gridArea.style.transform = `translateY(${GRID_PTR_THRESHOLD / 2}px)`;

        if (dirStack.length > 0) {
            const current = dirStack[dirStack.length - 1];
            if (current.isJellyfin) {
                await loadJellyfinFolder(current.id, current.name);
                requestAnimationFrame(() => {
                    dom.gridArea.scrollTop = current.scrollTop || 0;
                });
            } else if (await verifyPermission(current.handle)) {
                await processDirectoryHandle(current.handle, current.name);
                requestAnimationFrame(() => {
                    dom.gridArea.scrollTop = current.scrollTop || 0;
                });
            }
        } else {
            await new Promise(r => setTimeout(r, 400));
        }

        dom.ptrIndicator.style.opacity = 0;
        dom.gridArea.style.transform = 'translateY(0px)';
        setTimeout(() => {
            dom.ptrIndicator.style.display = 'none';
            dom.ptrIndicator.style.transition = '';
        }, 300);
    } else {
        dom.ptrIndicator.style.opacity = 0;
        dom.gridArea.style.transform = 'translateY(0px)';
        setTimeout(() => { dom.ptrIndicator.style.display = 'none'; }, 300);
    }
    gridPtrDistance = 0;
};

dom.gridArea.addEventListener('pointerup', endGridPull);
dom.gridArea.addEventListener('pointercancel', endGridPull);
dom.gridArea.addEventListener('pointerleave', endGridPull);

function switchToViewer() {
    if (viewMode !== 'VIEWER') history.pushState({ view: 'VIEWER' }, '');
    pointers = []; isPanning = false; isDragging = false; isGridSwiping = false; isGridPulling = false; initialDistance = 0;
    viewMode = 'VIEWER';
    dom.gridArea.style.display = 'none';
    dom.viewerArea.style.display = 'block';
    dom.btnGrid.style.display = 'block';
    dom.btnInfo.style.display = 'block';
    dom.btnSave.style.display = 'block';
    dom.body.classList.add('ui-hidden');
    renderViewer();
}

function getSpreadGroup(index) {
    if (index < 0 || index >= files.length) return [];
    const mode = isVideoFile(files[index]) ? videoLayoutMode : imageLayoutMode;
    if (mode === 'SINGLE') return [index];

    if (firstPageCover && index === 0) return [0];

    const offset = firstPageCover ? 1 : 0;
    const adjIndex = index - offset;
    const groupStart = Math.floor(adjIndex / 2) * 2 + offset;

    const group = [groupStart];
    if (groupStart + 1 < files.length) group.push(groupStart + 1);

    return group;
}

function updateIndices() {
    const currentGroup = getSpreadGroup(currentIndex);
    if (currentGroup.length === 0) { prevIndex = -1; nextIndex = -1; return; }

    prevIndex = currentGroup[0] - 1;
    nextIndex = currentGroup[currentGroup.length - 1] + 1;
}

function updateInfoPanel() {
    if (files.length === 0 || viewMode !== 'VIEWER') return;

    const rawGroup = getSpreadGroup(currentIndex);
    let indices = [...rawGroup];
    const mode = getCurrentLayoutMode();
    if (mode === 'SPREAD' && indices.length === 2 && readDir === 'RTL') {
        indices.reverse();
    }

    let html = '';
    indices.forEach((idx, i) => {
        const f = files[idx];

        let sizeDisplay = (f.size / (1024 * 1024)).toFixed(2) + ' MB';
        if (f.size === 0 && f.isJellyfin) sizeDisplay = 'Unknown (Server Stream)';

        if (mode === 'SPREAD' && indices.length === 2) {
            html += `<div class="panel-title">${i === 0 ? 'LEFT PAGE' : 'RIGHT PAGE'}</div>`;
        }

        html += `<div class="info-row"><span class="info-label">FILENAME</span><span class="info-value">${escapeHtml(f.name)}</span></div>
                 <div class="info-row"><span class="info-label">SIZE</span><span class="info-value">${sizeDisplay}</span></div>
                 <div class="info-row"><span class="info-label">INDEX</span><span class="info-value">${idx + 1} / ${files.length}</span></div>`;

        if (i < indices.length - 1) {
            html += `<div class="info-divider"></div>`;
        }
    });

    dom.infoContent.innerHTML = html;
}

function populateSlot(slot, targetIndex, token = null, onComplete = null) {
    let loadPromises = [];
    if (targetIndex < 0 || targetIndex >= files.length) {
        slot.replaceChildren();
        if (onComplete) onComplete();
        return;
    }

    const rawGroup = getSpreadGroup(targetIndex);
    let indices = [...rawGroup];
    const mode = getCurrentLayoutMode();

    if (mode === 'SPREAD' && indices.length === 2) {
        if (readDir === 'RTL') indices.reverse();
    }

    let actualMode = upscaleMode;
    let isBilinear = actualMode === 'BILINEAR';
    let originalTargetRatio = (isHighMemMode && is4xEnabled && !isBilinear && actualMode !== 'ADPTV_SHOGA') ? 4.0 : (isBilinear ? 1.0 : 2.0);

    const currentItems = Array.from(slot.children).filter(el => el.classList.contains('shoga-main-media'));
    let needsRebuild = currentItems.length !== indices.length;
    if (!needsRebuild) {
        indices.forEach((idx, i) => {
            const isUIBroken = currentItems[i].classList.contains('broken-file-ui');
            const isFileBroken = files[idx] && files[idx].isBroken;
            const isVideo = files[idx] && (files[idx].type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(files[idx].name));
            const isUIVideo = currentItems[i].tagName && currentItems[i].tagName.toLowerCase() === 'video';
            if (isUIBroken !== !!isFileBroken || isVideo !== isUIVideo) needsRebuild = true;
        });
    }

    if (needsRebuild) {
        Array.from(slot.children).forEach(child => {
            if (child.hlsInstance) {
                child.hlsInstance.destroy();
                delete child.hlsInstance;
            }
            if (child.tagName && child.tagName.toLowerCase() === 'video') {
                child.removeAttribute('src');
                child.load();
            }
        });
        slot.replaceChildren();
        const networkTasks = [];
        indices.forEach((idx, i) => {
            if (files[idx] && files[idx].isBroken) {
                const errDiv = document.createElement('div');
                errDiv.className = 'broken-file-ui';
                if (mode === 'SPREAD' && indices.length === 2) {
                    errDiv.classList.add(i === 0 ? 'spread-left' : 'spread-right');
                }
                errDiv.style.display = 'flex';
                errDiv.style.flexDirection = 'column';
                errDiv.style.alignItems = 'center';
                errDiv.style.justifyContent = 'center';
                errDiv.style.width = '100%';
                errDiv.style.height = '100%';
                errDiv.style.color = '#ef4444';
                errDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
                errDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div style="margin-top:10px; font-size:0.8rem; font-weight:600; letter-spacing:1px;">MEDIA CORRUPTED</div>`;
                slot.appendChild(errDiv);
                return;
            }

            const isVideo = files[idx] && (files[idx].type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(files[idx].name));
            const mediaEl = document.createElement(isVideo ? 'video' : 'img');
            const url = getFileUrl(idx);

            if (mode === 'SPREAD' && indices.length === 2) {
                mediaEl.className = i === 0 ? 'spread-left' : 'spread-right';
            } else {
                mediaEl.className = '';
            }

            mediaEl.dataset.fileIndex = idx;
            mediaEl.dataset.originalUrl = url;
            mediaEl.classList.add('shoga-main-media');

            let placeholder = null;
            let placeholderSrc = null;
            const gridCanvas = document.querySelector(`.grid-item[data-index="${idx}"] canvas.loaded`);
            if (gridCanvas) {
                placeholderSrc = gridCanvas.toDataURL('image/jpeg', 0.5);
            } else if (files[idx] && files[idx].isJellyfin) {
                placeholderSrc = `${files[idx].serverUrl}/Items/${files[idx].id}/Images/Primary?fillWidth=400&api_key=${files[idx].accessToken}`;
            }

            if (placeholderSrc) {
                placeholder = document.createElement('img');
                networkTasks.push({ idx, isPlaceholder: true, execute: () => { placeholder.src = placeholderSrc; } });

                placeholder.className = mediaEl.className;
                placeholder.classList.remove('shoga-main-media');
                placeholder.classList.add('shoga-placeholder');

                let customCss = 'position:absolute; z-index:-1; filter:blur(10px); opacity:0.5; transition:opacity 0.3s; pointer-events:none; ';

                if (mode === 'SPREAD' && indices.length === 2) {
                    if (fitMode === 'WIDTH') {
                        customCss += i === 0
                            ? 'width:50%; height:auto; left:0; top:auto; bottom:auto; object-fit:contain; object-position:right center;'
                            : 'width:50%; height:auto; right:0; top:auto; bottom:auto; object-fit:contain; object-position:left center;';
                    } else {
                        customCss += i === 0
                            ? 'width:50%; height:100%; left:0; top:0; object-fit:contain; object-position:right center;'
                            : 'width:50%; height:100%; right:0; top:0; object-fit:contain; object-position:left center;';
                    }
                } else {
                    if (fitMode === 'WIDTH') {
                        customCss += 'width:100%; height:auto; left:0; right:0; margin:auto; top:auto; bottom:auto; object-fit:contain; object-position:center;';
                    } else if (fitMode === 'HEIGHT') {
                        customCss += 'width:auto; height:100%; left:0; right:0; margin:auto; top:0; bottom:0; object-fit:contain; object-position:center;';
                    } else if (fitMode === 'ORIGINAL') {
                        customCss += 'width:auto; height:auto; left:0; right:0; margin:auto; top:auto; bottom:auto; object-fit:contain; object-position:center;';
                    } else {
                        customCss += 'width:100%; height:100%; left:0; top:0; object-fit:contain; object-position:center;';
                    }
                }

                placeholder.style.cssText = customCss;
                slot.style.position = 'relative';
                slot.appendChild(placeholder);
                mediaEl._placeholder = placeholder;
            }

            if (isVideo) {
                mediaEl.controls = true;
                mediaEl.playsInline = true;
                mediaEl.loop = true;
                mediaEl.muted = true;

                mediaEl.addEventListener('loadeddata', function () {
                    if (this._placeholder) {
                        const ph = this._placeholder;
                        delete this._placeholder;
                        setTimeout(() => {
                            if (ph && ph.parentNode) {
                                ph.style.opacity = '0';
                                setTimeout(() => { if (ph && ph.parentNode) ph.parentNode.removeChild(ph); }, 300);
                            }
                        }, 250);
                    }
                }, { once: true });

                networkTasks.push({
                    idx, isPlaceholder: false, execute: () => {
                        if (url.includes('.m3u8')) {
                            if (window.Hls && Hls.isSupported()) {
                                const hls = new Hls({ startLevel: -1 });
                                hls.attachMedia(mediaEl);
                                hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                                    hls.loadSource(url);
                                });
                                hls.on(Hls.Events.ERROR, (event, data) => {
                                    if (data.fatal) {
                                        hls.destroy();
                                        mediaEl.src = url.replace('master.m3u8', 'stream.mp4');
                                    }
                                });
                                mediaEl.hlsInstance = hls;
                            } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
                                mediaEl.src = url;
                            } else {
                                mediaEl.src = url.replace('master.m3u8', 'stream.mp4');
                            }
                        } else {
                            mediaEl.src = url;
                        }
                    }
                });

                let vidResolve;
                loadPromises.push(new Promise(r => vidResolve = r));

                mediaEl.onloadedmetadata = function () {
                    if (!this.dataset.origNw) {
                        this.dataset.origNw = this.videoWidth;
                        this.dataset.origNh = this.videoHeight;
                        const currentIdx = parseInt(this.dataset.fileIndex, 10);
                        if (!isNaN(currentIdx) && files[currentIdx] && !files[currentIdx].nw) {
                            files[currentIdx].nw = this.videoWidth;
                            files[currentIdx].nh = this.videoHeight;
                        }
                        this.style.aspectRatio = `${this.videoWidth} / ${this.videoHeight}`;
                        this.style.setProperty('--orig-w', `${this.videoWidth}px`);
                        this.style.setProperty('--orig-h', `${this.videoHeight}px`);
                    }
                    vidResolve();
                };

                mediaEl.onerror = function (e) {
                    if (this._placeholder) {
                        if (this._placeholder.parentNode) this._placeholder.parentNode.removeChild(this._placeholder);
                        delete this._placeholder;
                    }
                    if (this.error && this.error.code === 4) {
                        handleVideoTranscode(files[idx], idx, this);
                    } else {
                        const fIdx = parseInt(this.dataset.fileIndex, 10);
                        if (!isNaN(fIdx) && files[fIdx]) {
                            files[fIdx].isBroken = true;
                            const errDiv = document.createElement('div');
                            errDiv.className = 'broken-file-ui' + (this.className ? ' ' + this.className : '');
                            errDiv.style.display = 'flex';
                            errDiv.style.flexDirection = 'column';
                            errDiv.style.alignItems = 'center';
                            errDiv.style.justifyContent = 'center';
                            errDiv.style.width = '100%';
                            errDiv.style.height = '100%';
                            errDiv.style.color = '#ef4444';
                            errDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
                            errDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div style="margin-top:10px; font-size:0.8rem; font-weight:600; letter-spacing:1px;">MEDIA CORRUPTED</div>`;
                            if (this.parentNode) {
                                this.parentNode.replaceChild(errDiv, this);
                            }
                        }
                    }
                    vidResolve();
                };
                setTimeout(vidResolve, 1500);
                slot.appendChild(mediaEl);
            } else {
                const img = mediaEl;
                img.decoding = 'async';
                img.style.opacity = '0';
                img.style.transition = 'opacity 0.2s ease-out';

                let imgResolve;
                loadPromises.push(new Promise(r => imgResolve = r));

                networkTasks.push({
                    idx, isPlaceholder: false, execute: async () => {
                        let isAnim = await checkAnimated(files[idx]);
                        let checkRatio = originalTargetRatio;
                        if (actualMode === 'ADPTV_SHOGA' && files[idx] && files[idx].nw) {
                            let displayW = window.innerWidth * currentZoom;
                            if (getCurrentLayoutMode() === 'SPREAD' && getSpreadGroup(idx).length === 2) displayW *= 0.5;
                            let dRatio = displayW / files[idx].nw;
                            checkRatio = Math.ceil(dRatio * 10) / 10;
                            if (checkRatio < 0.1) checkRatio = 0.1;
                            const maxArea = getDynamicMaxArea();
                            while ((files[idx].nw * checkRatio * files[idx].nh * checkRatio > maxArea || files[idx].nw * checkRatio > 16384 || files[idx].nh * checkRatio > 16384) && checkRatio > 1.0) {
                                checkRatio = Math.max(1.0, checkRatio - 0.1);
                            }
                            checkRatio = Math.round(checkRatio * 10) / 10;
                        } else if (originalTargetRatio === 4.0 && files[idx] && files[idx].nw) {
                            if (files[idx].nw * 4.0 > 16384 || files[idx].nh * 4.0 > 16384) {
                                checkRatio = 2.0;
                            }
                        }

                        let cacheKey = url + '_' + actualMode + '_' + checkRatio;
                        let cachedUrl = upscaleCache.get(cacheKey);
                        let bestCachedRatio = -1;

                        for (let [key, cacheVal] of upscaleCache.entries()) {
                            if (key.startsWith(url + '_' + actualMode + '_')) {
                                let cachedRatio = parseFloat(key.split('_').pop());
                                if (!isNaN(cachedRatio) && cachedRatio >= checkRatio) {
                                    if (cacheVal !== 'error' && cacheVal !== 'skipped' && cacheVal !== 'processing') {
                                        if (bestCachedRatio === -1 || cachedRatio < bestCachedRatio) {
                                            cacheKey = key;
                                            bestCachedRatio = cachedRatio;
                                            cachedUrl = cacheVal;
                                        }
                                    }
                                }
                            }
                        }

                        img.onload = async function () {
                            const currentSrc = this.src;
                            try { await this.decode(); } catch (e) { }
                            if (this.src !== currentSrc) {
                                imgResolve();
                                return;
                            }
                            this.style.opacity = '1';
                            if (this._placeholder) {
                                const ph = this._placeholder;
                                delete this._placeholder;
                                setTimeout(() => {
                                    if (ph && ph.parentNode) {
                                        ph.style.opacity = '0';
                                        setTimeout(() => { if (ph && ph.parentNode) ph.parentNode.removeChild(ph); }, 300);
                                    }
                                }, 250);
                            }
                            clearTimeout(upscaleDebounceTimer);
                            upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 300);
                            imgResolve();
                        };

                        img.onerror = function () {
                            if (this._placeholder) {
                                if (this._placeholder.parentNode) this._placeholder.parentNode.removeChild(this._placeholder);
                                delete this._placeholder;
                            }
                            if (this.src && this.src !== this.dataset.originalUrl) {
                                const failedTier = this.dataset.upscaleAppliedTier || this.dataset.upscaleProcessingKey;
                                if (failedTier && upscaleCache.has(failedTier)) {
                                    upscaleCache.delete(failedTier);
                                }
                                this.src = this.dataset.originalUrl;
                                delete this.dataset.upscaleAppliedTier;
                                delete this.dataset.upscaleProcessingKey;
                                delete this.dataset.pendingSwapUrl;
                                if (upscaleMode !== 'OFF') {
                                    this.dataset.upscaleAppliedTier = 'NATIVE_BILINEAR';
                                    clearTimeout(upscaleDebounceTimer);
                                    upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 100);
                                }
                            } else {
                                const fIdx = parseInt(this.dataset.fileIndex, 10);
                                if (!isNaN(fIdx) && files[fIdx]) {
                                    files[fIdx].retryCount = (files[fIdx].retryCount || 0) + 1;
                                    if (files[fIdx].retryCount > 3) {
                                        files[fIdx].isBroken = true;
                                        const errDiv = document.createElement('div');
                                        errDiv.className = 'broken-file-ui' + (this.className ? ' ' + this.className : '');
                                        errDiv.style.display = 'flex';
                                        errDiv.style.flexDirection = 'column';
                                        errDiv.style.alignItems = 'center';
                                        errDiv.style.justifyContent = 'center';
                                        errDiv.style.width = '100%';
                                        errDiv.style.height = '100%';
                                        errDiv.style.color = '#ef4444';
                                        errDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
                                        errDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div style="margin-top:10px; font-size:0.8rem; font-weight:600; letter-spacing:1px;">MEDIA CORRUPTED</div>`;
                                        if (this.parentNode) {
                                            this.parentNode.replaceChild(errDiv, this);
                                        }
                                    } else {
                                        const oldUrl = this.dataset.originalUrl;
                                        if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
                                        urlCache.delete(fIdx);

                                        for (let [k, v] of upscaleCache.entries()) {
                                            if (k.startsWith(oldUrl + '_')) {
                                                if (v !== 'processing' && v !== 'error' && v !== 'skipped' && v.startsWith('blob:')) {
                                                    URL.revokeObjectURL(v);
                                                }
                                                upscaleCache.delete(k);
                                            }
                                        }

                                        let newUrl;
                                        if (files[fIdx].isJellyfin) {
                                            newUrl = getFileUrl(fIdx);
                                        } else {
                                            newUrl = URL.createObjectURL(files[fIdx]);
                                            urlCache.set(fIdx, newUrl);
                                        }
                                        this.dataset.originalUrl = newUrl;
                                        this.src = newUrl;
                                    }
                                }
                            }
                            imgResolve();
                        };

                        if (!isAnim && upscaleMode !== 'OFF' && cachedUrl && cachedUrl !== 'error' && cachedUrl !== 'processing' && cachedUrl !== 'skipped') {
                            img.src = cachedUrl;
                            img.dataset.upscaleAppliedTier = cacheKey;
                        } else {
                            img.src = url;
                            if (upscaleMode !== 'OFF') img.dataset.upscaleAppliedTier = 'NATIVE_BILINEAR';
                        }
                    }
                });
                slot.appendChild(img);
            }
        });

        networkTasks.sort((a, b) => a.idx - b.idx);
        networkTasks.filter(t => t.isPlaceholder).forEach(t => t.execute());
        networkTasks.filter(t => !t.isPlaceholder).forEach(t => t.execute());

    } else {
        const networkTasks = [];
        indices.forEach((idx, i) => {
            if (files[idx] && files[idx].isBroken) return;

            const url = getFileUrl(idx);
            const mediaEl = currentItems[i];
            if (mediaEl.dataset.originalUrl !== url || (mediaEl.tagName.toLowerCase() === 'video' && !mediaEl.hasAttribute('src'))) {

                const expectedClass = (mode === 'SPREAD' && indices.length === 2) ? (i === 0 ? 'spread-left' : 'spread-right') : '';

                Array.from(slot.children).forEach(child => {
                    if (child.classList.contains('crossfade-clone') || child.classList.contains('shoga-placeholder')) {
                        if (expectedClass === '' || child.classList.contains(expectedClass)) {
                            child.remove();
                        }
                    }
                });

                mediaEl.className = expectedClass;

                mediaEl.dataset.fileIndex = idx;
                mediaEl.dataset.originalUrl = url;
                mediaEl.classList.add('shoga-main-media');

                if (mediaEl._placeholder && mediaEl._placeholder.parentNode) {
                    mediaEl._placeholder.parentNode.removeChild(mediaEl._placeholder);
                    delete mediaEl._placeholder;
                }

                const isVideo = files[idx] && (files[idx].type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(files[idx].name));

                let placeholder = null;
                let placeholderSrc = null;
                const gridCanvas = document.querySelector(`.grid-item[data-index="${idx}"] canvas.loaded`);
                if (gridCanvas) {
                    placeholderSrc = gridCanvas.toDataURL('image/jpeg', 0.5);
                } else if (files[idx] && files[idx].isJellyfin) {
                    placeholderSrc = `${files[idx].serverUrl}/Items/${files[idx].id}/Images/Primary?fillWidth=400&api_key=${files[idx].accessToken}`;
                }

                if (placeholderSrc) {
                    placeholder = document.createElement('img');
                    networkTasks.push({ idx, isPlaceholder: true, execute: () => { placeholder.src = placeholderSrc; } });

                    placeholder.className = mediaEl.className;
                    placeholder.classList.remove('shoga-main-media');
                    placeholder.classList.add('shoga-placeholder');

                    let customCss = 'position:absolute; z-index:-1; filter:blur(10px); opacity:0.5; transition:opacity 0.3s; pointer-events:none; ';

                    if (mode === 'SPREAD' && indices.length === 2) {
                        if (fitMode === 'WIDTH') {
                            customCss += i === 0
                                ? 'width:50%; height:auto; left:0; top:auto; bottom:auto; object-fit:contain; object-position:right center;'
                                : 'width:50%; height:auto; right:0; top:auto; bottom:auto; object-fit:contain; object-position:left center;';
                        } else {
                            customCss += i === 0
                                ? 'width:50%; height:100%; left:0; top:0; object-fit:contain; object-position:right center;'
                                : 'width:50%; height:100%; right:0; top:0; object-fit:contain; object-position:left center;';
                        }
                    } else {
                        if (fitMode === 'WIDTH') {
                            customCss += 'width:100%; height:auto; left:0; right:0; margin:auto; top:auto; bottom:auto; object-fit:contain; object-position:center;';
                        } else if (fitMode === 'HEIGHT') {
                            customCss += 'width:auto; height:100%; left:0; right:0; margin:auto; top:0; bottom:0; object-fit:contain; object-position:center;';
                        } else if (fitMode === 'ORIGINAL') {
                            customCss += 'width:auto; height:auto; left:0; right:0; margin:auto; top:auto; bottom:auto; object-fit:contain; object-position:center;';
                        } else {
                            customCss += 'width:100%; height:100%; left:0; top:0; object-fit:contain; object-position:center;';
                        }
                    }

                    placeholder.style.cssText = customCss;
                    slot.style.position = 'relative';
                    slot.appendChild(placeholder);
                    mediaEl._placeholder = placeholder;
                }

                if (isVideo) {
                    let vidResolve;
                    loadPromises.push(new Promise(r => vidResolve = r));

                    mediaEl.addEventListener('loadeddata', function () {
                        if (this._placeholder) {
                            const ph = this._placeholder;
                            delete this._placeholder;
                            setTimeout(() => {
                                if (ph && ph.parentNode) {
                                    ph.style.opacity = '0';
                                    setTimeout(() => { if (ph && ph.parentNode) ph.parentNode.removeChild(ph); }, 300);
                                }
                            }, 250);
                        }
                    }, { once: true });

                    networkTasks.push({
                        idx, isPlaceholder: false, execute: () => {
                            if (url.includes('.m3u8')) {
                                if (window.Hls && Hls.isSupported()) {
                                    if (mediaEl.hlsInstance) {
                                        mediaEl.hlsInstance.destroy();
                                        delete mediaEl.hlsInstance;
                                    }
                                    mediaEl.removeAttribute('src');
                                    mediaEl.load();

                                    const hls = new Hls({ startLevel: -1 });
                                    hls.attachMedia(mediaEl);
                                    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                                        hls.loadSource(url);
                                    });
                                    hls.on(Hls.Events.ERROR, (event, data) => {
                                        if (data.fatal) {
                                            hls.destroy();
                                            mediaEl.src = url.replace('master.m3u8', 'stream.mp4');
                                        }
                                    });
                                    mediaEl.hlsInstance = hls;
                                } else if (mediaEl.canPlayType('application/vnd.apple.mpegurl')) {
                                    mediaEl.src = url;
                                } else {
                                    mediaEl.src = url.replace('master.m3u8', 'stream.mp4');
                                }
                            } else {
                                if (mediaEl.hlsInstance) {
                                    mediaEl.hlsInstance.destroy();
                                    delete mediaEl.hlsInstance;
                                }
                                mediaEl.removeAttribute('src');
                                mediaEl.load();
                                mediaEl.src = url;
                            }
                        }
                    });
                    delete mediaEl.dataset.origNw;
                    delete mediaEl.dataset.origNh;

                    mediaEl.onloadedmetadata = function () { vidResolve(); };
                    mediaEl.onerror = function () {
                        if (this._placeholder) {
                            if (this._placeholder.parentNode) this._placeholder.parentNode.removeChild(this._placeholder);
                            delete this._placeholder;
                        }
                        vidResolve();
                    };
                    setTimeout(vidResolve, 1500);

                } else {
                    const img = mediaEl;
                    img.decoding = 'async';
                    img.style.opacity = '0';
                    img.style.transition = 'opacity 0.2s ease-out';

                    let imgResolve;
                    loadPromises.push(new Promise(r => imgResolve = r));

                    networkTasks.push({
                        idx, isPlaceholder: false, execute: async () => {
                            let isAnim = await checkAnimated(files[idx]);
                            let checkRatio = originalTargetRatio;
                            if (actualMode === 'ADPTV_SHOGA' && files[idx] && files[idx].nw) {
                                let displayW = window.innerWidth * currentZoom;
                                if (getCurrentLayoutMode() === 'SPREAD' && getSpreadGroup(idx).length === 2) displayW *= 0.5;
                                let dRatio = displayW / files[idx].nw;
                                checkRatio = Math.ceil(dRatio * 10) / 10;
                                if (checkRatio < 0.1) checkRatio = 0.1;
                                const maxArea = getDynamicMaxArea();
                                while ((files[idx].nw * checkRatio * files[idx].nh * checkRatio > maxArea || files[idx].nw * checkRatio > 16384 || files[idx].nh * checkRatio > 16384) && checkRatio > 1.0) {
                                    checkRatio = Math.max(1.0, checkRatio - 0.1);
                                }
                                checkRatio = Math.round(checkRatio * 10) / 10;
                            } else if (originalTargetRatio === 4.0 && files[idx] && files[idx].nw) {
                                if (files[idx].nw * 4.0 > 16384 || files[idx].nh * 4.0 > 16384) {
                                    checkRatio = 2.0;
                                }
                            }

                            let cacheKey = url + '_' + actualMode + '_' + checkRatio;
                            let cachedUrl = upscaleCache.get(cacheKey);
                            let bestCachedRatio = -1;

                            for (let [key, cacheVal] of upscaleCache.entries()) {
                                if (key.startsWith(url + '_' + actualMode + '_')) {
                                    let cachedRatio = parseFloat(key.split('_').pop());
                                    if (!isNaN(cachedRatio) && cachedRatio >= checkRatio) {
                                        if (cacheVal !== 'error' && cacheVal !== 'skipped' && cacheVal !== 'processing') {
                                            if (bestCachedRatio === -1 || cachedRatio < bestCachedRatio) {
                                                cacheKey = key;
                                                bestCachedRatio = cachedRatio;
                                                cachedUrl = cacheVal;
                                            }
                                        }
                                    }
                                }
                            }

                            img.onload = async function () {
                                const currentSrc = this.src;
                                try { await this.decode(); } catch (e) { }
                                if (this.src !== currentSrc) {
                                    imgResolve();
                                    return;
                                }
                                this.style.opacity = '1';
                                if (this._placeholder) {
                                    const ph = this._placeholder;
                                    delete this._placeholder;
                                    setTimeout(() => {
                                        if (ph && ph.parentNode) {
                                            ph.style.opacity = '0';
                                            setTimeout(() => { if (ph && ph.parentNode) ph.parentNode.removeChild(ph); }, 300);
                                        }
                                    }, 250);
                                }
                                clearTimeout(upscaleDebounceTimer);
                                upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 300);
                                imgResolve();
                            };

                            img.onerror = function () {
                                if (this._placeholder) {
                                    if (this._placeholder.parentNode) this._placeholder.parentNode.removeChild(this._placeholder);
                                    delete this._placeholder;
                                }
                                if (this.src && this.src !== this.dataset.originalUrl) {
                                    const failedTier = this.dataset.upscaleAppliedTier || this.dataset.upscaleProcessingKey;
                                    if (failedTier && upscaleCache.has(failedTier)) {
                                        upscaleCache.delete(failedTier);
                                    }
                                    this.src = this.dataset.originalUrl;
                                    delete this.dataset.upscaleAppliedTier;
                                    delete this.dataset.upscaleProcessingKey;
                                    delete this.dataset.pendingSwapUrl;
                                    if (upscaleMode !== 'OFF') {
                                        this.dataset.upscaleAppliedTier = 'NATIVE_BILINEAR';
                                        clearTimeout(upscaleDebounceTimer);
                                        upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 100);
                                    }
                                } else {
                                    const fIdx = parseInt(this.dataset.fileIndex, 10);
                                    if (!isNaN(fIdx) && files[fIdx]) {
                                        files[fIdx].retryCount = (files[fIdx].retryCount || 0) + 1;
                                        if (files[fIdx].retryCount > 3) {
                                            files[fIdx].isBroken = true;
                                            const errDiv = document.createElement('div');
                                            errDiv.className = 'broken-file-ui' + (this.className ? ' ' + this.className : '');
                                            errDiv.style.display = 'flex';
                                            errDiv.style.flexDirection = 'column';
                                            errDiv.style.alignItems = 'center';
                                            errDiv.style.justifyContent = 'center';
                                            errDiv.style.width = '100%';
                                            errDiv.style.height = '100%';
                                            errDiv.style.color = '#ef4444';
                                            errDiv.style.backgroundColor = 'rgba(255,255,255,0.05)';
                                            errDiv.innerHTML = `<svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><div style="margin-top:10px; font-size:0.8rem; font-weight:600; letter-spacing:1px;">MEDIA CORRUPTED</div>`;
                                            if (this.parentNode) {
                                                this.parentNode.replaceChild(errDiv, this);
                                            }
                                        } else {
                                            const oldUrl = this.dataset.originalUrl;
                                            if (oldUrl && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
                                            urlCache.delete(fIdx);

                                            for (let [k, v] of upscaleCache.entries()) {
                                                if (k.startsWith(oldUrl + '_')) {
                                                    if (v !== 'processing' && v !== 'error' && v !== 'skipped' && v.startsWith('blob:')) {
                                                        URL.revokeObjectURL(v);
                                                    }
                                                    upscaleCache.delete(k);
                                                }
                                            }

                                            let newUrl;
                                            if (files[fIdx].isJellyfin) {
                                                newUrl = getFileUrl(fIdx);
                                            } else {
                                                newUrl = URL.createObjectURL(files[fIdx]);
                                                urlCache.set(fIdx, newUrl);
                                            }
                                            this.dataset.originalUrl = newUrl;
                                            this.src = newUrl;
                                        }
                                    }
                                }
                                imgResolve();
                            };

                            if (!isAnim && upscaleMode !== 'OFF' && cachedUrl && cachedUrl !== 'error' && cachedUrl !== 'processing' && cachedUrl !== 'skipped') {
                                img.src = cachedUrl;
                                img.dataset.upscaleAppliedTier = cacheKey;
                            } else {
                                img.src = url;
                                if (upscaleMode !== 'OFF') {
                                    img.dataset.upscaleAppliedTier = 'NATIVE_BILINEAR';
                                } else {
                                    delete img.dataset.upscaleAppliedTier;
                                }
                            }

                            delete img.dataset.origNw;
                            delete img.dataset.origNh;
                            delete img.dataset.upscaleProcessingKey;
                            delete img.dataset.pendingSwapUrl;
                            delete img.pendingUpscaleSwap;
                        }
                    });
                }
            }
        });

        networkTasks.sort((a, b) => a.idx - b.idx);
        networkTasks.filter(t => t.isPlaceholder).forEach(t => t.execute());
        networkTasks.filter(t => !t.isPlaceholder).forEach(t => t.execute());
    }

    if (onComplete) {
        if (loadPromises.length > 0) {
            Promise.all(loadPromises).finally(() => {
                if (token !== null && currentRenderToken !== token) return;
                onComplete();
            });
        } else {
            onComplete();
        }
    }
}

async function updateUpscaleUIState() {
    if (viewMode !== 'VIEWER' || files.length === 0) return;
    const currentFile = files[currentIndex];
    if (!currentFile) return;

    const isAnim = await checkAnimated(currentFile) || currentFile.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(currentFile.name);

    const advancedUpscaleButtons = document.querySelectorAll('#upscale-adptv, #upscale-anime4k, #upscale-xbrz, #upscale-fsr');
    const bilinearBtn = document.getElementById('upscale-bilinear');

    if (isAnim) {
        advancedUpscaleButtons.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.cursor = 'not-allowed';
            btn.title = 'Disabled for animated images';
        });
    } else {
        advancedUpscaleButtons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor = '';
            if (btn.id === 'upscale-adptv') btn.title = 'Adaptive Shoga+';
            if (btn.id === 'upscale-anime4k') btn.title = 'Anime4K';
            if (btn.id === 'upscale-xbrz') btn.title = 'xBRZ';
            if (btn.id === 'upscale-fsr') btn.title = 'FSR Shoga+';
        });
    }

    if (bilinearBtn) {
        bilinearBtn.disabled = false;
        bilinearBtn.style.opacity = '';
        bilinearBtn.style.cursor = '';
        bilinearBtn.title = 'Bilinear';
    }
}

function updateVideoPlayback() {
    if (viewMode !== 'VIEWER') return;
    dom.viewerSlider.querySelectorAll('video').forEach(v => {
        if (v.closest('#viewer-content')) {
            v.play().catch(e => { });
        } else {
            v.pause();
        }
    });
}

function renderViewer() {

    if (files.length === 0 || viewMode !== 'VIEWER') return;

    updateIndices();

    let fitClass = `fit-${fitMode.toLowerCase()}`;
    let mode = getCurrentLayoutMode();
    let spreadClass = mode === 'SPREAD' ? 'view-spread ' : '';

    dom.slots.prev.className = `view-slot ${spreadClass}${fitClass}`;
    dom.slots.curr.className = `view-slot ${spreadClass}${fitClass}`;
    dom.slots.next.className = `view-slot ${spreadClass}${fitClass}`;

    if (!dom.viewerContent.parentElement) dom.slots.curr.appendChild(dom.viewerContent);

    currentRenderToken++;
    const token = currentRenderToken;

    populateSlot(dom.viewerContent, currentIndex, token, () => {
        if (currentRenderToken !== token || viewMode !== 'VIEWER') return;
        if (readDir === 'LTR') {
            populateSlot(dom.slots.prev, prevIndex, token);
            populateSlot(dom.slots.next, nextIndex, token);
        } else {
            populateSlot(dom.slots.prev, nextIndex, token);
            populateSlot(dom.slots.next, prevIndex, token);
        }
    });

    resetTransform(false);

    if (!dom.body.classList.contains('animating')) {
        clearTimeout(upscaleDebounceTimer);
    }

    updateUpscaleUIState();
    updateVideoPlayback();

    document.querySelectorAll('#mode-single, #mode-spread').forEach(b => b.classList.remove('active'));
    document.getElementById(mode === 'SINGLE' ? 'mode-single' : 'mode-spread').classList.add('active');
    if (mode === 'SPREAD') dom.coverSettingGroup.classList.add('visible');
    else dom.coverSettingGroup.classList.remove('visible');
}

function resetTransform(smooth = true) {

    currentZoom = 1; panX = 0; panY = 0;
    if (currentAnimationId) cancelAnimationFrame(currentAnimationId);
    if (smooth) {
        dom.body.classList.add('animating');
        dom.viewerSlider.style.transform = `translateX(0px)`;
        applyContentTransform();
        setTimeout(() => dom.body.classList.remove('animating'), 350);
    } else {
        dom.viewerSlider.style.transform = `translateX(0px)`;
        applyContentTransform();
    }
}

let isViewerTicking = false;
function applyContentTransform() {
    if (isViewerTicking) return;
    isViewerTicking = true;
    if (currentAnimationId) cancelAnimationFrame(currentAnimationId);
    currentAnimationId = requestAnimationFrame(() => {
        currentAnimationId = null;
        dom.viewerContent.style.transform = `translate(${Math.round(panX)}px, ${Math.round(panY)}px) scale(${currentZoom})`;
        if (!isDragging && !isPanning && !dom.body.classList.contains('animating')) {
            clearTimeout(upscaleDebounceTimer);
            upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 300);
        }
        isViewerTicking = false;
    });
}

function cleanCaches() {
    let revokedUrls = 0;
    const activeUrls = new Set();
    for (const [idx, url] of urlCache.entries()) {
        if (Math.abs(idx - currentIndex) > 16) {
            if (url.startsWith('blob:')) { URL.revokeObjectURL(url); revokedUrls++; }
            urlCache.delete(idx);
        } else {
            activeUrls.add(url);
        }
    }
    for (const [key, url] of upscaleCache.entries()) {
        const origUrl = key.split('_')[0];
        if (!activeUrls.has(origUrl)) {
            if (url === 'processing') continue;
            if (url !== 'error' && url !== 'skipped' && url !== 'processing' && url.startsWith('blob:')) { URL.revokeObjectURL(url); revokedUrls++; }
            upscaleCache.delete(key);
        }
    }
    if (revokedUrls > 0) console.log(`[Cache Clean] Revoked ${revokedUrls} blob URLs. Active urlCache size: ${urlCache.size}`);
}

function commitNavigation() {
    if (navTimeout) {
        clearTimeout(navTimeout);
        navTimeout = null;

        let direction = null;
        if (pendingIndex !== null) {
            if (pendingIndex === nextIndex) direction = 'next';
            else if (pendingIndex === prevIndex) direction = 'prev';
            currentIndex = pendingIndex;
            pendingIndex = null;
        }

        dom.body.classList.remove('animating');

        if (direction) {
            const oldCurrImgs = Array.from(dom.viewerContent.childNodes).filter(n => !n.classList?.contains('crossfade-clone'));
            let oldSideImgs, targetSideSlot;

            if (direction === 'next') {
                oldSideImgs = readDir === 'LTR' ? Array.from(dom.slots.next.childNodes) : Array.from(dom.slots.prev.childNodes);
                targetSideSlot = readDir === 'LTR' ? dom.slots.prev : dom.slots.next;
            } else {
                oldSideImgs = readDir === 'LTR' ? Array.from(dom.slots.prev.childNodes) : Array.from(dom.slots.next.childNodes);
                targetSideSlot = readDir === 'LTR' ? dom.slots.next : dom.slots.prev;
            }

            oldSideImgs = oldSideImgs.filter(n => !n.classList?.contains('crossfade-clone'));

            if (oldCurrImgs.length > 0) targetSideSlot.replaceChildren(...oldCurrImgs);
            if (oldSideImgs.length > 0) dom.viewerContent.replaceChildren(...oldSideImgs);
        }

        dom.viewerSlider.style.transform = `translateX(0px)`;
        void dom.viewerSlider.offsetWidth;
        renderViewer();
        cleanCaches();
        updateVideoPlayback();
    }
}

function navigateLogical(logicalDir) {
    dom.body.classList.add('ui-hidden');
    closeAllPanels();
    commitNavigation();

    updateIndices();
    const targetIdx = logicalDir === 'next' ? nextIndex : prevIndex;

    if (isSingleFileMode || targetIdx < 0 || targetIdx >= files.length) {
        const physicalDir = readDir === 'LTR' ? logicalDir : (logicalDir === 'next' ? 'prev' : 'next');
        const bounceX = physicalDir === 'next' ? -60 : 60;

        requestAnimationFrame(() => {
            dom.body.classList.add('animating');
            dom.viewerSlider.style.transform = `translateX(${bounceX}px)`;
        });

        navTimeout = setTimeout(() => {
            dom.viewerSlider.style.transform = `translateX(0px)`;
            setTimeout(() => {
                dom.body.classList.remove('animating');
                navTimeout = null;
            }, 200);
        }, 150);
        return;
    }

    pendingIndex = targetIdx;
    const physicalDir = readDir === 'LTR' ? logicalDir : (logicalDir === 'next' ? 'prev' : 'next');
    const translationX = physicalDir === 'next' ? -window.innerWidth : window.innerWidth;

    requestAnimationFrame(() => {
        dom.body.classList.add('animating');
        dom.viewerSlider.style.transform = `translateX(${translationX}px)`;
    });

    navTimeout = setTimeout(() => {
        commitNavigation();
        if (!dom.infoPanel.classList.contains('hidden')) updateInfoPanel();
    }, 350);
}

window.addEventListener('popstate', (e) => {
    closeAllPanels();
    if (viewMode === 'VIEWER') {
        switchToGrid();
    } else if (viewMode === 'GRID' && dirStack.length > 1) {
        dirStack.pop();
        const parent = dirStack[dirStack.length - 1];
        folderFilterText = parent.folderFilterText || '';
        fileFilterText = parent.fileFilterText || '';
        if (parent.isJellyfin) {
            loadJellyfinFolder(parent.id, parent.name).then(() => {
                requestAnimationFrame(() => { dom.gridArea.scrollTop = parent.scrollTop || 0; });
            });
        } else {
            processDirectoryHandle(parent.handle, parent.name).then(() => {
                requestAnimationFrame(() => { dom.gridArea.scrollTop = parent.scrollTop || 0; });
            });
        }
    } else if (viewMode === 'GRID' && dirStack.length <= 1) {
        dom.btnHome.click();
    }
});

window.addEventListener('blur', () => {
    isPanning = false; isDragging = false; pointers = []; initialDistance = 0;
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        isPanning = false; isDragging = false; pointers = []; initialDistance = 0;
    }
});

let wheelAccX = 0;
let wheelAccY = 0;
let wheelTimer = null;
let isWheelLocked = false;

const existingViewerWheel = dom.viewerArea.onwheel;
if (existingViewerWheel) dom.viewerArea.removeEventListener('wheel', existingViewerWheel);

dom.viewerArea.addEventListener('wheel', (e) => {
    if (viewMode !== 'VIEWER') return;
    closeAllPanels();
    if (navTimeout) commitNavigation();
    e.preventDefault();

    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        dom.body.classList.add('ui-hidden');
        const zoomFactor = -e.deltaY * 0.001;
        const newZoom = Math.max(0.1, Math.min(currentZoom * Math.exp(zoomFactor), maxZoomLimit));

        const cx = e.clientX - window.innerWidth / 2;
        const cy = e.clientY - window.innerHeight / 2;

        panX = cx - (cx - panX) * (newZoom / currentZoom);
        panY = cy - (cy - panY) * (newZoom / currentZoom);
        currentZoom = newZoom;

        applyContentTransform();

        clearTimeout(bounceBackTimer);
        bounceBackTimer = setTimeout(() => {
            if (currentZoom < 1.0) {
                resetTransform(true);
            }
        }, 150);
        return;
    }

    if (currentZoom > 1) {
        panX -= e.deltaX * 1.5;
        panY -= e.deltaY * 1.5;
        applyContentTransform();
        return;
    }

    if (isWheelLocked) return;
    wheelAccX += e.deltaX;
    wheelAccY += e.deltaY;

    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
        wheelAccX = 0;
        wheelAccY = 0;
        isWheelLocked = false;
    }, 150);

    if (Math.abs(wheelAccX) > 600) {
        isWheelLocked = true;
        const dir = wheelAccX > 0 ? 'next' : 'prev';
        navigateLogical(readDir === 'LTR' ? dir : (dir === 'next' ? 'prev' : 'next'));
        wheelAccX = 0; wheelAccY = 0;
    }
}, { passive: false });

dom.gridArea.addEventListener('wheel', (e) => {
    if (viewMode !== 'GRID' || e.ctrlKey) return;

    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        if (isWheelLocked) {
            e.preventDefault();
            return;
        }
        wheelAccX += e.deltaX;
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelAccX = 0; isWheelLocked = false; }, 150);

        if (wheelAccX < -600 && dirStack.length > 1) {
            isWheelLocked = true;
            e.preventDefault();

            dirStack.pop();
            const parent = dirStack[dirStack.length - 1];
            folderFilterText = parent.folderFilterText || '';
            fileFilterText = parent.fileFilterText || '';
            if (parent.isJellyfin) {
                loadJellyfinFolder(parent.id, parent.name).then(() => {
                    requestAnimationFrame(() => {
                        dom.gridArea.scrollTop = parent.scrollTop || 0;
                    });
                });
            } else {
                processDirectoryHandle(parent.handle, parent.name).then(() => {
                    requestAnimationFrame(() => {
                        dom.gridArea.scrollTop = parent.scrollTop || 0;
                    });
                });
            }
            wheelAccX = 0;
        }
    }
}, { passive: false });

window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;

    if (viewMode === 'VIEWER' && !dom.bookmarksPanel.classList.contains('active')) {
        if (e.clientX > window.innerWidth - 80) {
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                if (isWheelLocked) return;
                wheelAccX += e.deltaX;
                clearTimeout(wheelTimer);
                wheelTimer = setTimeout(() => { wheelAccX = 0; isWheelLocked = false; }, 150);

                if (wheelAccX > 600) {
                    isWheelLocked = true;
                    closeAllPanels();
                    dom.bookmarksPanel.classList.add('active');
                    renderBookmarks();
                    wheelAccX = 0;
                }
            }
        }
    }

    if (dom.bookmarksPanel.classList.contains('active')) {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            if (isWheelLocked) return;
            wheelAccX += e.deltaX;
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => { wheelAccX = 0; isWheelLocked = false; }, 150);

            if (wheelAccX < -600) {
                isWheelLocked = true;
                dom.bookmarksPanel.classList.remove('active');
                wheelAccX = 0;
            }
        }
    }
}, { passive: false });

let vW = 0, vH = 0, cW = 0, cH = 0;

dom.viewerArea.addEventListener('pointerdown', (e) => {
    if (viewMode !== 'VIEWER' || e.target.closest('#top-bar') || e.target.closest('.panel') || e.target.closest('#bookmarks-panel')) return;

    if (e.clientX > window.innerWidth - 30) return;

    closeAllPanels();
    if (navTimeout) commitNavigation();

    const now = Date.now();

    if (pointers.length === 0) {
        maxPointersDuringTap = 0;
        lastTap = now;
    }

    isPanning = true; isDragging = false; axisLocked = null;
    const existingIdx = pointers.findIndex(p => p.pointerId === e.pointerId);
    if (existingIdx !== -1) {
        pointers[existingIdx] = e;
    } else {
        pointers.push(e);
    }
    maxPointersDuringTap = Math.max(maxPointersDuringTap, pointers.length);

    try { dom.viewerArea.setPointerCapture(e.pointerId); } catch (err) { }

    if (pointers.length === 1) {
        startX = e.clientX; startY = e.clientY;
        initialPanX = panX; initialPanY = panY;

        vW = window.innerWidth;
        vH = window.innerHeight;
        cW = 0; cH = 0;
        dom.viewerContent.querySelectorAll('.shoga-main-media:not(.crossfade-clone)').forEach(el => {
            cW += el.offsetWidth;
            cH = Math.max(cH, el.offsetHeight);
        });

        if (currentZoom === 1 && (fitMode === 'AUTO' || fitMode === 'CONTAIN')) {
            cW = Math.min(cW, vW);
            cH = Math.min(cH, vH);
        }
    }
});

let uiHideProgress = 0;
let lastTickTime = 0;
let uiHideRAF = null;
let mouseMoveAccumulator = 0;
let prevMouseX = -1;
let prevMouseY = -1;
let lastKnownMouseY = -1;
let lastDragEndTime = 0;
let lastPointerType = 'mouse';
let isUiRevealedByClick = false;

function updateUiHideEngine(timestamp) {
    if (!lastTickTime) lastTickTime = timestamp;
    let deltaTime = timestamp - lastTickTime;
    lastTickTime = timestamp;

    const noPanelsOpen = dom.settingsPanel.classList.contains('hidden') && dom.infoPanel.classList.contains('hidden') && !dom.bookmarksPanel.classList.contains('active') && !dom.jellyfinModal.classList.contains('active');

    if (!noPanelsOpen || isDragging || isPanning) {
        uiHideRAF = requestAnimationFrame(updateUiHideEngine);
        return;
    }

    let timeSinceDrag = Date.now() - lastDragEndTime;
    let triggerAreaH = 0;
    if (timeSinceDrag > 3000) triggerAreaH = window.innerHeight * 0.25;
    else if (timeSinceDrag > 500) triggerAreaH = window.innerHeight * 0.125;

    let speedMultiplier = 1;
    if (lastPointerType === 'mouse') {
        if (lastKnownMouseY >= 0) {
            const isBottomMode = (window.innerWidth / window.innerHeight) <= (9 / 16);
            const effectiveLastKnownMouseY = isBottomMode ? window.innerHeight - lastKnownMouseY : lastKnownMouseY;

            if (effectiveLastKnownMouseY <= triggerAreaH) {
                speedMultiplier = 1;
            } else {
                if (isUiRevealedByClick) {
                    speedMultiplier = 1;
                } else {
                    let remainingSpace = Math.max(1, window.innerHeight - triggerAreaH);
                    let ratio = Math.max(0, Math.min(1, (effectiveLastKnownMouseY - triggerAreaH) / remainingSpace));
                    speedMultiplier = 2 + (ratio * 5);
                }
            }
        }
    }

    uiHideProgress += deltaTime * speedMultiplier;

    if (uiHideProgress >= 3000) {
        dom.body.classList.add('ui-hidden');
        uiHideProgress = 0;
        uiHideRAF = null;
    } else {
        uiHideRAF = requestAnimationFrame(updateUiHideEngine);
    }
}

function startUiHideEngine() {
    uiHideProgress = 0;
    if (!uiHideRAF) {
        lastTickTime = 0;
        uiHideRAF = requestAnimationFrame(updateUiHideEngine);
    }
}

const uiObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
            const hadUiHidden = mutation.oldValue ? mutation.oldValue.includes('ui-hidden') : false;
            const hasUiHidden = dom.body.classList.contains('ui-hidden');

            if (hadUiHidden === hasUiHidden) return;

            if (!hasUiHidden && viewMode === 'VIEWER') {
                startUiHideEngine();
            } else if (hasUiHidden) {
                if (uiHideRAF) {
                    cancelAnimationFrame(uiHideRAF);
                    uiHideRAF = null;
                }
                mouseMoveAccumulator = 0;
                prevMouseX = -1;
                prevMouseY = -1;
                isUiRevealedByClick = false;
            }
        }
    });
});
uiObserver.observe(dom.body, { attributes: true, attributeOldValue: true });

dom.viewerArea.addEventListener('pointermove', (e) => {
    if (isDragging || isPanning) {
        lastDragEndTime = Date.now();
    }

    if (viewMode === 'VIEWER') {
        lastPointerType = e.pointerType;
        const noPanelsOpen = dom.settingsPanel.classList.contains('hidden') && dom.infoPanel.classList.contains('hidden') && !dom.bookmarksPanel.classList.contains('active') && !dom.jellyfinModal.classList.contains('active');

        if (e.pointerType === 'mouse') {
            lastKnownMouseY = e.clientY;
            let timeSinceDrag = Date.now() - lastDragEndTime;
            let triggerAreaH = 0;
            let moveThreshold = 200;

            if (timeSinceDrag > 3000) {
                triggerAreaH = window.innerHeight * 0.25;
                moveThreshold = 200;
            } else if (timeSinceDrag > 500) {
                triggerAreaH = window.innerHeight * 0.125;
                moveThreshold = 300;
            }

            const isBottomMode = (window.innerWidth / window.innerHeight) <= (9 / 16);
            const effectiveY = isBottomMode ? window.innerHeight - e.clientY : e.clientY;

            if (dom.body.classList.contains('ui-hidden')) {
                if (noPanelsOpen && !(isDragging || isPanning) && timeSinceDrag > 500) {
                    if (effectiveY <= triggerAreaH) {
                        if (prevMouseX !== -1 && prevMouseY !== -1) {
                            mouseMoveAccumulator += Math.hypot(e.clientX - prevMouseX, e.clientY - prevMouseY);
                        }
                        if (mouseMoveAccumulator > moveThreshold) {
                            isUiRevealedByClick = false;
                            dom.body.classList.remove('ui-hidden');
                            mouseMoveAccumulator = 0;
                        }
                    } else {
                        mouseMoveAccumulator = 0;
                    }
                } else {
                    mouseMoveAccumulator = 0;
                }
            } else {
                mouseMoveAccumulator = 0;
                if (noPanelsOpen && effectiveY <= triggerAreaH) startUiHideEngine();
            }
            prevMouseX = e.clientX;
            prevMouseY = e.clientY;
        } else {
            if (!dom.body.classList.contains('ui-hidden') && noPanelsOpen) {
                startUiHideEngine();
            }
        }
    }

    if (!isPanning || navTimeout) return;
    const idx = pointers.findIndex(p => p.pointerId === e.pointerId);
    if (idx !== -1) pointers[idx] = e;
    else return;

    maxPointersDuringTap = Math.max(maxPointersDuringTap, pointers.length);

    if (pointers.length === 1) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && Math.hypot(dx, dy) > 10) {
            isDragging = true;
            dom.body.classList.add('ui-hidden');

            const totalW = cW * currentZoom;
            const maxH = cH * currentZoom;

            const overflowX = totalW > vW + 2;
            const overflowY = maxH > vH + 2;

            if (currentZoom === 1 && !overflowX && !overflowY) {
                axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            } else {
                axisLocked = null;
            }
        }

        if (isDragging) {
            if (axisLocked === 'x') {
                let physicalDir = dx > 0 ? 'prev' : 'next';
                let logicalDir = readDir === 'LTR' ? physicalDir : (physicalDir === 'next' ? 'prev' : 'next');
                updateIndices();
                let targetIdx = logicalDir === 'next' ? nextIndex : prevIndex;
                let isBlocked = isSingleFileMode || targetIdx < 0 || targetIdx >= files.length;

                let applyDx = dx;
                if (isBlocked) {
                    applyDx = dx * 0.2;
                }
                dom.viewerSlider.style.transform = `translateX(${applyDx}px)`;
            } else if (axisLocked === 'y') {
                panY = dy * 0.2;
                applyContentTransform();
            } else {
                const totalW = cW * currentZoom;
                const maxH = cH * currentZoom;

                let maxPx = Math.max(0, (totalW - vW) / 2);
                let maxPy = Math.max(0, (maxH - vH) / 2);

                let targetPanX = initialPanX + dx;
                let targetPanY = initialPanY + dy;

                let overscrollX = 0;
                if (targetPanX > maxPx) {
                    overscrollX = targetPanX - maxPx;
                    targetPanX = maxPx + overscrollX * 0.3;
                } else if (targetPanX < -maxPx) {
                    overscrollX = targetPanX - (-maxPx);
                    targetPanX = -maxPx + overscrollX * 0.3;
                }

                if (targetPanY > maxPy) {
                    targetPanY = maxPy + (targetPanY - maxPy) * 0.3;
                } else if (targetPanY < -maxPy) {
                    targetPanY = -maxPy + (targetPanY - (-maxPy)) * 0.3;
                }

                panX = targetPanX;
                panY = targetPanY;
                applyContentTransform();

                if (Math.abs(overscrollX) > 0) {
                    dom.viewerSlider.style.transform = `translateX(${overscrollX * 0.5}px)`;
                } else {
                    dom.viewerSlider.style.transform = `translateX(0px)`;
                }
            }
        }
    } else if (pointers.length === 2) {
        if (maxPointersDuringTap >= 3) return;
        const dist = Math.hypot(pointers[0].clientX - pointers[1].clientX, pointers[0].clientY - pointers[1].clientY);
        const center = { x: (pointers[0].clientX + pointers[1].clientX) / 2, y: (pointers[0].clientY + pointers[1].clientY) / 2 };

        if (initialDistance === 0) {
            initialDistance = dist; initialZoom = currentZoom;
            startX = center.x; startY = center.y;
            initialPanX = panX; initialPanY = panY;
        } else {
            if (Math.abs(dist - initialDistance) < 5) return;
            const scale = dist / initialDistance;
            const newZoom = Math.max(0.1, Math.min(initialZoom * scale, maxZoomLimit));

            const cx = center.x - vW / 2;
            const cy = center.y - vH / 2;
            panX = cx - (cx - initialPanX - (center.x - startX)) * (newZoom / initialZoom);
            panY = cy - (cy - initialPanY - (center.y - startY)) * (newZoom / initialZoom);
            currentZoom = newZoom;

            applyContentTransform();
        }
    }
});

function handlePointerEnd(e) {
    if (!isPanning) return;

    try {
        if (dom.viewerArea.hasPointerCapture(e.pointerId)) {
            dom.viewerArea.releasePointerCapture(e.pointerId);
        }
    } catch (err) { }

    const idx = pointers.findIndex(p => p.pointerId === e.pointerId);
    if (idx !== -1) pointers.splice(idx, 1);

    if (pointers.length === 0) {
        initialDistance = 0;
        const now = Date.now();
        const tapDuration = now - lastTap;

        if (currentZoom < 1.0) {
            resetTransform(true);
            isPanning = false; isDragging = false;
            return;
        }

        if (tapDuration < 300 && maxPointersDuringTap >= 3) {
            applyViewerSettingChange(() => {
                firstPageCover = !firstPageCover;
                document.querySelectorAll('#cover-inline, #cover-isolated').forEach(b => b.classList.remove('active'));
                document.getElementById(firstPageCover ? 'cover-isolated' : 'cover-inline').classList.add('active');
            });
            isPanning = false; isDragging = false;
            return;
        }

        if (isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (axisLocked === 'x') {
                let physicalDir = dx > 0 ? 'prev' : 'next';
                let logicalDir = readDir === 'LTR' ? physicalDir : (physicalDir === 'next' ? 'prev' : 'next');
                updateIndices();
                let targetIdx = logicalDir === 'next' ? nextIndex : prevIndex;
                let isBlocked = isSingleFileMode || targetIdx < 0 || targetIdx >= files.length;

                const isVideo = files.length > 0 && isVideoFile(files[currentIndex]);
                const swipeMultiplier = isVideo ? 1.5 : 1;
                const threshold = vW * (e.pointerType === 'touch' ? 0.075 : 0.15) * swipeMultiplier;

                if (Math.abs(dx) > threshold && !isBlocked) {
                    navigateLogical(logicalDir);
                } else resetTransform(true);
            } else if (axisLocked === 'y') {
                if (dy > vH * 0.15) {
                    switchToGrid();
                } else {
                    panY = 0; applyContentTransform();
                }
            } else {
                const totalW = cW * currentZoom;
                const maxH = cH * currentZoom;

                let maxPx = Math.max(0, (totalW - vW) / 2);
                let maxPy = Math.max(0, (maxH - vH) / 2);

                let rawPanX = initialPanX + dx;
                let overscrollX = 0;
                if (rawPanX > maxPx) overscrollX = rawPanX - maxPx;
                else if (rawPanX < -maxPx) overscrollX = rawPanX - (-maxPx);

                const isVideo = files.length > 0 && isVideoFile(files[currentIndex]);
                const swipeMultiplier = isVideo ? 1.5 : 1;
                const threshold = vW * (e.pointerType === 'touch' ? 0.075 : 0.15) * swipeMultiplier;

                if (Math.abs(overscrollX) > threshold) {
                    const physicalDir = overscrollX > 0 ? 'prev' : 'next';
                    const logicalDir = readDir === 'LTR' ? physicalDir : (physicalDir === 'next' ? 'prev' : 'next');
                    navigateLogical(logicalDir);
                } else {
                    panX = Math.max(-maxPx, Math.min(maxPx, panX));
                    panY = Math.max(-maxPy, Math.min(maxPy, panY));
                    dom.body.classList.add('animating');
                    dom.viewerSlider.style.transform = `translateX(0px)`;
                    applyContentTransform();
                    setTimeout(() => dom.body.classList.remove('animating'), 350);
                }
            }
        } else {
            const clickX = e.clientX;
            const clickY = e.clientY;

            if (tapDuration < 300 && maxPointersDuringTap === 1) {
                if (now - lastSingleTapTime < 300) {
                    clearTimeout(singleTapTimeout);
                    if (currentZoom !== 1 || fitMode !== 'AUTO') {
                        dom.viewerContent.querySelectorAll('.crossfade-clone').forEach(el => el.remove());

                        let currentW = 0;
                        let currentH = 0;
                        dom.viewerContent.querySelectorAll('.shoga-main-media:not(.crossfade-clone)').forEach(el => {
                            currentW += el.offsetWidth;
                            currentH = Math.max(currentH, el.offsetHeight);
                        });

                        let targetScale = 1;
                        if (fitMode !== 'AUTO' && currentW > 0 && currentH > 0) {
                            targetScale = Math.min(window.innerWidth / currentW, window.innerHeight / currentH);
                        }

                        panX = 0;
                        panY = 0;
                        currentZoom = targetScale;

                        dom.body.classList.add('animating');
                        applyContentTransform();

                        setTimeout(() => {
                            dom.body.classList.remove('animating');

                            dom.viewerContent.querySelectorAll('.crossfade-clone').forEach(el => el.remove());

                            fitMode = 'AUTO';
                            localStorage.setItem('shoga-fit-mode', 'AUTO');
                            document.querySelectorAll('#fit-auto, #fit-contain, #fit-width, #fit-height, #fit-original').forEach(b => b.classList.remove('active'));
                            document.getElementById('fit-auto').classList.add('active');

                            let spreadClass = getCurrentLayoutMode() === 'SPREAD' ? 'view-spread ' : '';
                            dom.slots.prev.className = `view-slot ${spreadClass}fit-auto`;
                            dom.slots.curr.className = `view-slot ${spreadClass}fit-auto`;
                            dom.slots.next.className = `view-slot ${spreadClass}fit-auto`;

                            currentZoom = 1;
                            panX = 0;
                            panY = 0;
                            dom.viewerContent.style.transform = `translate(0px, 0px) scale(1)`;

                            clearTimeout(upscaleDebounceTimer);
                            upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 50);
                        }, 260);
                    } else {
                        let newZoom = 2.5;
                        const imgRef = dom.viewerContent.querySelector('img:not(.crossfade-clone), video');
                        if (imgRef && (imgRef.naturalWidth || imgRef.videoWidth) && (imgRef.naturalHeight || imgRef.videoHeight)) {
                            const w = imgRef.naturalWidth || imgRef.videoWidth;
                            const h = imgRef.naturalHeight || imgRef.videoHeight;
                            const scaleRate = Math.min(imgRef.offsetWidth / w, imgRef.offsetHeight / h);
                            if (scaleRate > 0) newZoom = Math.min(maxZoomLimit, 1 / scaleRate);
                        }
                        const cx = clickX - vW / 2;
                        const cy = clickY - vH / 2;
                        panX = cx - cx * newZoom;
                        panY = cy - cy * newZoom;
                        currentZoom = newZoom;
                        dom.body.classList.add('animating');
                        applyContentTransform();
                        setTimeout(() => {
                            dom.body.classList.remove('animating');
                            clearTimeout(upscaleDebounceTimer);
                            upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 50);
                        }, 350);
                    }
                    lastSingleTapTime = 0;
                } else {
                    lastSingleTapTime = now;
                    singleTapTimeout = setTimeout(() => {
                        if (currentZoom === 1) {
                            const isVideo = files.length > 0 && isVideoFile(files[currentIndex]);
                            const edgeThreshold = vW * 0.15 * (isVideo ? 0.25 : 1);
                            if (clickX < edgeThreshold) navigateLogical(readDir === 'LTR' ? 'prev' : 'next');
                            else if (clickX > vW - edgeThreshold) navigateLogical(readDir === 'LTR' ? 'next' : 'prev');
                            else {
                                const wasHidden = dom.body.classList.contains('ui-hidden');
                                dom.body.classList.toggle('ui-hidden');
                                if (wasHidden && e.pointerType === 'mouse') isUiRevealedByClick = true;
                            }
                        } else {
                            const wasHidden = dom.body.classList.contains('ui-hidden');
                            dom.body.classList.toggle('ui-hidden');
                            if (wasHidden && e.pointerType === 'mouse') isUiRevealedByClick = true;
                        }
                        lastSingleTapTime = 0;
                    }, 250);
                }
            }
        }
        isPanning = false; isDragging = false;
        dom.viewerContent.querySelectorAll('img').forEach(img => {
            if (img.pendingUpscaleSwap) {
                img.pendingUpscaleSwap();
                delete img.pendingUpscaleSwap;
            }
        });
        clearTimeout(upscaleDebounceTimer);
        upscaleDebounceTimer = setTimeout(applyUpscaleOverlays, 300);
    } else {
        startX = pointers[0].clientX; startY = pointers[0].clientY;
        initialPanX = panX; initialPanY = panY;
        initialDistance = 0;
    }
}

dom.viewerArea.addEventListener('pointerup', handlePointerEnd);
dom.viewerArea.addEventListener('pointercancel', handlePointerEnd);

window.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentImage();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (dom.bookmarksPanel.classList.contains('active')) {
            if (!dom.bookmarkSearchWrapper.classList.contains('visible')) {
                dom.btnSearchBookmarks.click();
            } else {
                dom.bookmarkFilterInput.focus();
            }
            return;
        }

        if (viewMode === 'VIEWER') {
            dom.bookmarksPanel.classList.add('active');
            renderBookmarks();
            if (!dom.bookmarkSearchWrapper.classList.contains('visible')) {
                dom.btnSearchBookmarks.click();
            } else {
                dom.bookmarkFilterInput.focus();
            }
            return;
        }

        if (viewMode === 'GRID') {
            if (currentFolders.length > 0 && files.length === 0) {
                const input = document.getElementById('folder-filter-input');
                if (input) input.focus();
            } else if (files.length > 0 && currentFolders.length === 0) {
                const input = document.getElementById('file-filter-input');
                if (input) input.focus();
            } else if (currentFolders.length > 0 && files.length > 0) {
                const choice = await showSearchChoiceModal();
                if (choice === 'file') {
                    const input = document.getElementById('file-filter-input');
                    if (input) input.focus();
                } else if (choice === 'folder') {
                    const input = document.getElementById('folder-filter-input');
                    if (input) input.focus();
                }
            }
        }
        return;
    }

    if (viewMode === 'VIEWER') {
        if (e.key === 'ArrowRight') navigateLogical(readDir === 'LTR' ? 'next' : 'prev');
        if (e.key === 'ArrowLeft') navigateLogical(readDir === 'LTR' ? 'prev' : 'next');

        if (e.key === 'Escape') switchToGrid();

        if (e.key === 'f' || e.key === 'F11') {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
            }
        }

        if (e.key === '=' || e.key === '+') {
            dom.body.classList.add('ui-hidden');
            const newZoom = Math.min(currentZoom * 1.25, maxZoomLimit);
            panX = panX * (newZoom / currentZoom);
            panY = panY * (newZoom / currentZoom);
            currentZoom = newZoom;
            applyContentTransform();
        }
        if (e.key === '-') {
            dom.body.classList.add('ui-hidden');
            const newZoom = Math.max(currentZoom / 1.25, 0.1);
            panX = panX * (newZoom / currentZoom);
            panY = panY * (newZoom / currentZoom);
            currentZoom = newZoom;
            applyContentTransform();
        }
        if (e.key === '0') {
            dom.body.classList.add('ui-hidden');
            resetTransform(true);
        }
    }
});

let edgeSwipeStartX = 0;
let edgeSwipeStartY = 0;
let isEdgeSwiping = false;
let activeEdgeSwipe = false;

window.addEventListener('pointerdown', (e) => {
    if (dom.bookmarksPanel.classList.contains('active')) return;
    if (e.clientX > window.innerWidth - 30) {
        isEdgeSwiping = true;
        activeEdgeSwipe = true;
        edgeSwipeStartX = e.clientX;
        edgeSwipeStartY = e.clientY;
    }
});

window.addEventListener('pointermove', (e) => {
    if (!isEdgeSwiping) return;
    const dx = edgeSwipeStartX - e.clientX;
    const dy = Math.abs(e.clientY - edgeSwipeStartY);

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        if (e.cancelable) e.preventDefault();
    }

    if (dx > 50 && dy < 50) {
        isEdgeSwiping = false;
        closeAllPanels();
        dom.bookmarksPanel.classList.add('active');
        renderBookmarks();
    }
}, { passive: false });

window.addEventListener('pointerup', () => {
    if (isEdgeSwiping || activeEdgeSwipe) lastPanelSwipeTime = Date.now();
    isEdgeSwiping = false;
    activeEdgeSwipe = false;
});
window.addEventListener('pointercancel', () => {
    if (isEdgeSwiping || activeEdgeSwipe) lastPanelSwipeTime = Date.now();
    isEdgeSwiping = false;
    activeEdgeSwipe = false;
});

window.addEventListener('touchmove', (e) => {
    if (!isEdgeSwiping) return;
    const touch = e.touches[0];
    const dx = edgeSwipeStartX - touch.clientX;
    const dy = Math.abs(touch.clientY - edgeSwipeStartY);
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        if (e.cancelable) e.preventDefault();
    }
}, { passive: false });

let bmSwipeStartX = 0;
let bmSwipeStartY = 0;
let isBmSwiping = false;

window.addEventListener('pointerdown', (e) => {
    if (dom.bookmarksPanel.classList.contains('active')) {
        const rect = dom.bookmarksPanel.getBoundingClientRect();
        if (e.clientX >= rect.left - 300) {
            isBmSwiping = true;
            bmSwipeStartX = e.clientX;
            bmSwipeStartY = e.clientY;
            dom.bookmarksPanel.style.transition = 'none';
            try { e.target.setPointerCapture(e.pointerId); } catch (err) { }
        }
    }
});

window.addEventListener('pointermove', (e) => {
    if (!isBmSwiping) return;
    const dx = e.clientX - bmSwipeStartX;
    const dy = Math.abs(e.clientY - bmSwipeStartY);

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        if (e.cancelable) e.preventDefault();
    }

    if (dx > 0) {
        dom.bookmarksPanel.style.transform = `translateX(${dx}px)`;
    }
}, { passive: false });

const btnMobileBack = document.getElementById('btn-mobile-back');
if (btnMobileBack) {
    btnMobileBack.addEventListener('click', (e) => {
        e.stopPropagation();
        if (viewMode === 'VIEWER') {
            switchToGrid();
        } else if (viewMode === 'GRID') {
            if (dirStack.length > 1) {
                const btnUp = document.querySelector('.btn-up');
                if (btnUp) btnUp.click();
            } else {
                dom.btnHome.click();
            }
        }
    });
}

const endBmSwipe = (e) => {
    if (!isBmSwiping) return;
    isBmSwiping = false;
    lastPanelSwipeTime = Date.now();
    try { if (e && e.target) e.target.releasePointerCapture(e.pointerId); } catch (err) { }

    if (e && e.clientX !== undefined) {
        const dx = e.clientX - bmSwipeStartX;
        dom.bookmarksPanel.style.transition = 'transform 0.3s ease-out';
        if (dx > 60) {
            dom.bookmarksPanel.classList.remove('active');
            setTimeout(() => {
                dom.bookmarksPanel.style.transform = '';
                dom.bookmarksPanel.style.transition = '';
            }, 300);
        } else {
            dom.bookmarksPanel.style.transform = 'translateX(0px)';
            setTimeout(() => {
                dom.bookmarksPanel.style.transform = '';
                dom.bookmarksPanel.style.transition = '';
            }, 300);
        }
    } else {
        dom.bookmarksPanel.style.transform = '';
        dom.bookmarksPanel.style.transition = '';
    }
};

window.addEventListener('pointerup', endBmSwipe);
window.addEventListener('pointercancel', endBmSwipe);

window.addEventListener('touchmove', (e) => {
    if (!isBmSwiping) return;
    const touch = e.touches[0];
    const dx = touch.clientX - bmSwipeStartX;
    const dy = Math.abs(touch.clientY - bmSwipeStartY);
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
        if (e.cancelable) e.preventDefault();
    }
}, { passive: false });

if ('launchQueue' in window) {
    launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files.length) return;

        const filePromises = launchParams.files.map(handle => handle.getFile());
        const openedFiles = await Promise.all(filePromises);
        const validImages = openedFiles.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|avi|jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i.test(f.name));

        if (validImages.length > 0) {
            processFileList(validImages, validImages[0].name);
            isSingleFileMode = validImages.length === 1;
            switchToViewer();

            if (isSingleFileMode) {
                const handle = launchParams.files[0];
                const handles = await loadDirHandles();
                for (const item of handles) {
                    try {
                        const path = await item.handle.resolve(handle);
                        if (path !== null) {
                            if (await verifyPermission(item.handle)) {
                                dirStack = [{ handle: item.handle, name: item.name }];
                                await processDirectoryHandle(item.handle, item.name);

                                const targetName = validImages[0].name;
                                const foundIndex = files.findIndex(f => f.name === targetName);
                                if (foundIndex !== -1) {
                                    currentIndex = foundIndex;
                                }

                                isSingleFileMode = false;
                                renderViewer();
                                break;
                            }
                        }
                    } catch (e) { }
                }
            }
        }
    });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "open_directory" && request.handle) {
            processDirectoryHandle(request.handle);
        }
    });
}

let resizeDebounce = null;
window.addEventListener('resize', () => {
    if (viewMode === 'VIEWER') {
        clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => {
            vW = window.innerWidth;
            vH = window.innerHeight;
            resetTransform(false);
        }, 150);
    }
});

/* SERVICEWORKER: PWA ONLY. DO NOT FORGET. */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    });
}
/* -------------------------------------- */
