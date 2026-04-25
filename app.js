let files =[];
let currentFolders =[];
let dirStack =[];
let currentIndex = 0;
let layoutMode = 'SINGLE';
let readDir = 'LTR';
let fitMode = 'CONTAIN';
let firstPageCover = false;
let viewMode = 'IDLE'; 

let folderSortMode = 'name-asc';
let folderFilterText = '';
let bookmarkFilterText = '';

let currentTitle = 'Shoga Viewer';
let bookmarks =[];
let isGridRendered = false;
let recentsEnabled = localStorage.getItem('shoga-recents-enabled') !== 'false';
let upscaleMode = localStorage.getItem('shoga-upscale-mode') || 'OFF';
const upscaleCache = new Map();

let preloadQueueTimer = null;
let isPreloading = false;

let isSingleFileMode = false; 
let pendingBookmarkRestoreId = null;

let prevIndex = -1, nextIndex = -1;

let currentZoom = 1;
let panX = 0, panY = 0;
let isPanning = false;
let isDragging = false; 
let axisLocked = null;

let startX = 0, startY = 0;
let initialPanX = 0, initialPanY = 0;
let pointers =[];
let initialDistance = 0, initialZoom = 1;

let lastTap = 0;
let singleTapTimeout = null;

let navTimeout = null;
let pendingIndex = null;

let fsrDebounceTimer = null;

const urlCache = new Map();

const DB_NAME = 'ShogaViewerDB';
const STORE_HANDLES = 'FileSystemHandles';
const STORE_BOOKMARKS = 'Bookmarks';

let MAX_GL_TEXTURE_SIZE = 4096;
try {
    const _tmpCanvas = document.createElement('canvas');
    const _tmpGl = _tmpCanvas.getContext('webgl2') || _tmpCanvas.getContext('webgl');
    if (_tmpGl) MAX_GL_TEXTURE_SIZE = _tmpGl.getParameter(_tmpGl.MAX_TEXTURE_SIZE);
} catch (e) {}

let upscaleTasks = 0;
function showUpscaleIndicator() {
    upscaleTasks++;
    document.getElementById('upscale-indicator').style.display = 'flex';
}
function hideUpscaleIndicator() {
    upscaleTasks = Math.max(0, upscaleTasks - 1);
    if (upscaleTasks === 0) {
        document.getElementById('upscale-indicator').style.display = 'none';
    }
}

function initDB() {
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
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveBookmarkToDB(bookmark) {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
            tx.objectStore(STORE_BOOKMARKS).put(bookmark);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = (e) => { db.close(); reject(e.target.error); };
        });
    } catch(e) { throw e; }
}

async function loadBookmarksFromDB() {
    try {
        const db = await initDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_BOOKMARKS, 'readonly');
            const req = tx.objectStore(STORE_BOOKMARKS).getAll();
            req.onsuccess = () => { db.close(); resolve(req.result ||[]); };
            req.onerror = () => { db.close(); resolve([]); };
        });
    } catch (e) {
        return[];
    }
}

async function deleteBookmarkFromDB(id) {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
            tx.objectStore(STORE_BOOKMARKS).delete(id);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = (e) => { db.close(); reject(e.target.error); };
        });
    } catch(e) { throw e; }
}

async function saveDirHandle(handle) {
    if (!recentsEnabled) return;
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_HANDLES, 'readwrite');
            const store = tx.objectStore(STORE_HANDLES);
            const req = store.get('recent-handles');
            req.onsuccess = () => {
                let handles = req.result ||[];
                handles = handles.filter(h => h.name !== handle.name);
                handles.unshift({ name: handle.name, handle: handle, ts: Date.now() });
                handles = handles.slice(0, 5); 
                store.put(handles, 'recent-handles');
            };
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = (e) => { db.close(); reject(e.target.error); };
        });
    } catch (err) {}
}

async function loadDirHandles() {
    try {
        const db = await initDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_HANDLES, 'readonly');
            const req = tx.objectStore(STORE_HANDLES).get('recent-handles');
            req.onsuccess = () => { db.close(); resolve(req.result ||[]); };
            req.onerror = () => { db.close(); resolve([]); };
        });
    } catch (err) { return[]; }
}

async function clearDirHandles() {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_HANDLES, 'readwrite');
            tx.objectStore(STORE_HANDLES).delete('recent-handles');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = (e) => { db.close(); reject(e.target.error); };
        });
    } catch(e) {}
}

async function verifyPermission(fileHandle) {
    const options = { mode: 'read' };
    if ((await fileHandle.queryPermission(options)) === 'granted') return true;
    if ((await fileHandle.requestPermission(options)) === 'granted') return true;
    return false;
}

const dom = {
    body: document.body,
    topBar: document.getElementById('top-bar'),
    btnOpenMain: document.getElementById('btn-open-main'),
    openDropdown: document.getElementById('open-dropdown'),
    btnHome: document.getElementById('btn-home'),
    btnOpenFiles: document.getElementById('btn-open-files'),
    btnOpenDir: document.getElementById('btn-open-dir'),
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

const __swipeStyle = document.createElement('style');
__swipeStyle.textContent = `
    html, body { overscroll-behavior-x: none !important; }
    #grid-area, #bookmarks-panel { touch-action: pan-y !important; }
`;
document.head.appendChild(__swipeStyle);

function switchToIdle() {
    viewMode = 'IDLE';
    dom.gridArea.style.display = 'none';
    dom.viewerArea.style.display = 'none';
    dom.btnGrid.style.display = 'none';
    dom.btnInfo.style.display = 'none';
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
    document.getElementById('fsr-off').classList.remove('active');
    if (upscaleMode === 'BILINEAR') {
        document.getElementById('fsr-bilinear').classList.add('active');
    } else if (upscaleMode === 'FSR') {
        document.getElementById('fsr-fsr').classList.add('active');
    } else if (upscaleMode === 'XBRZ') {
        document.getElementById('fsr-xbrz').classList.add('active');
    } else if (upscaleMode === 'ANIME4X') {
        document.getElementById('fsr-anime4x').classList.add('active');
    } else {
        document.getElementById('fsr-off').classList.add('active');
    }
})();

function closeAllPanels() {
    dom.settingsPanel.classList.add('hidden');
    dom.infoPanel.classList.add('hidden');
    dom.licensePanel.classList.add('hidden');
    dom.openDropdown.classList.remove('active');
    dom.bookmarksPanel.classList.remove('active');
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
    try {
        const bmp = await createImageBitmap(file, { resizeWidth: 300, resizeQuality: 'low' });
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
            canvas.width = 300;
            canvas.height = 300 * (img.height / img.width);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(img.src);
            canvas.classList.add('loaded');
        };
    }
}

async function captureThumbnail() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    const group = getSpreadGroup(currentIndex);
    
    try {
        if (group.length === 1) {
            const bmp = await createImageBitmap(files[group[0]], { resizeWidth: 400 });
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            ctx.drawImage(bmp, 0, 0);
            bmp.close();
        } else if (group.length === 2) {
            let idxLeft = readDir === 'LTR' ? group[0] : group[1];
            let idxRight = readDir === 'LTR' ? group[1] : group[0];
            
            const bmpL = await createImageBitmap(files[idxLeft], { resizeWidth: 200 });
            const bmpR = await createImageBitmap(files[idxRight], { resizeWidth: 200 });
            
            canvas.width = bmpL.width + bmpR.width;
            canvas.height = Math.max(bmpL.height, bmpR.height);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.drawImage(bmpL, 0, (canvas.height - bmpL.height) / 2);
            ctx.drawImage(bmpR, bmpL.width, (canvas.height - bmpR.height) / 2);
            bmpL.close();
            bmpR.close();
        }
        return canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
        canvas.width = 400; canvas.height = 300;
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, 400, 300);
        return canvas.toDataURL('image/jpeg', 0.8);
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
                dirStack =[{ handle: item.handle, name: item.name }];
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
        modal.onclick = (e) => { if(e.target === modal) cleanup(false); };
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
};

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
            <div class="bookmark-title">${bk.title}</div>
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
                } catch(err) { console.error(err); }
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
    } catch(err) { console.error(err); }
    
    renderBookmarks();
    dom.bookmarksList.scrollTo({ top: 0, behavior: 'smooth' });
    
    dom.bookmarksList.style.pointerEvents = 'none';
    await new Promise(resolve => setTimeout(resolve, 350));
    dom.bookmarksList.style.pointerEvents = 'auto';

    const restoredFiles =[];
    
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
                if (await verifyPermission(target.handle)) {
                    const fileList =[];
                    const folderList =[];
                    for await (const entry of target.handle.values()) {
                        if (entry.kind === 'file') {
                            const file = await entry.getFile();
                            if (file.type.startsWith('image/')) fileList.push(file);
                        } else if (entry.kind === 'directory') {
                            folderList.push(entry);
                        }
                    }
                    const newFiles = fileList.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
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
            } catch (e) {}
        }

        if (!autoRestored && window.showDirectoryPicker) {
            const handles = await loadDirHandles();
            const matchedItem = handles.find(h => h.name === bk.title);
            if (matchedItem) {
                if (await verifyPermission(matchedItem.handle)) {
                    const fileList =[];
                    const folderList =[];
                    for await (const entry of matchedItem.handle.values()) {
                        if (entry.kind === 'file') {
                            const file = await entry.getFile();
                            if (file.type.startsWith('image/')) fileList.push(file);
                        } else if (entry.kind === 'directory') {
                            folderList.push(entry);
                        }
                    }
                    const newFiles = fileList.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
                    const newNameMap = new Map();
                    newFiles.forEach(f => newNameMap.set(f.name, f));
                    bk.state.fileNames.forEach(name => {
                        if (newNameMap.has(name)) restoredFiles.push(newNameMap.get(name));
                    });
                    if (restoredFiles.length > 0) {
                        autoRestored = true;
                        currentFolders = folderList;
                        dirStack =[{ handle: matchedItem.handle, name: matchedItem.name }];
                    }
                }
            }
        }

        if (!autoRestored) {
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
    
    pendingBookmarkRestoreId = null;

    urlCache.forEach(url => URL.revokeObjectURL(url));
    urlCache.clear();

    files = restoredFiles;
    currentTitle = bk.state.title;
    document.title = currentTitle;
    
    const targetName = bk.state.currentFileName;
    const foundIndex = files.findIndex(f => f.name === targetName);
    currentIndex = foundIndex !== -1 ? foundIndex : bk.state.currentIndex;
    if (currentIndex >= files.length) currentIndex = Math.max(0, files.length - 1);
    
    layoutMode = bk.state.layoutMode;
    readDir = bk.state.readDir;
    fitMode = bk.state.fitMode;
    firstPageCover = bk.state.firstPageCover;
    
    isGridRendered = false; 

    document.querySelectorAll('#mode-single, #mode-spread').forEach(b => b.classList.remove('active'));
    document.getElementById(layoutMode === 'SINGLE' ? 'mode-single' : 'mode-spread').classList.add('active');
    
    if (layoutMode === 'SPREAD') dom.coverSettingGroup.classList.add('visible');
    else dom.coverSettingGroup.classList.remove('visible');
    
    document.querySelectorAll('#cover-inline, #cover-isolated').forEach(b => b.classList.remove('active'));
    document.getElementById(firstPageCover ? 'cover-isolated' : 'cover-inline').classList.add('active');

    document.querySelectorAll('#dir-ltr, #dir-rtl').forEach(b => b.classList.remove('active'));
    document.getElementById(readDir === 'LTR' ? 'dir-ltr' : 'dir-rtl').classList.add('active');

    document.querySelectorAll('#fit-contain, #fit-auto, #fit-width, #fit-height, #fit-original').forEach(b => b.classList.remove('active'));
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
            layoutMode: layoutMode,
            readDir: readDir,
            fitMode: fitMode,
            firstPageCover: firstPageCover,
            title: currentTitle,
            dirStack: dirStack.map(item => ({ handle: item.handle, name: item.name }))
        },
        lastAccessed: Date.now()
    };

    try {
        await saveBookmarkToDB(bk);
        bookmarks.push(bk);
        renderBookmarks();
    } catch(e) {
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
        } catch(e) { console.error(e); }
    }
    bookmarks =[];
    renderBookmarks();
});

function getFileUrl(index) {
    if (index < 0 || index >= files.length) return null;
    if (urlCache.has(index)) {
        const url = urlCache.get(index);
        urlCache.delete(index);
        urlCache.set(index, url);
        return url;
    }
    const url = URL.createObjectURL(files[index]);
    urlCache.set(index, url);
    if (urlCache.size > 64) {
        const firstKey = urlCache.keys().next().value;
        URL.revokeObjectURL(urlCache.get(firstKey));
        urlCache.delete(firstKey);
    }
    return url;
}

setTimeout(() => { if(viewMode === 'IDLE') dom.body.classList.remove('ui-hidden'); }, 100);

dom.btnOpenMain.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    pendingBookmarkRestoreId = null;
    const isActive = dom.openDropdown.classList.contains('active');
    closeAllPanels();
    if (!isActive) dom.openDropdown.classList.add('active'); 
});

dom.btnHome.addEventListener('click', () => {
    dom.openDropdown.classList.remove('active');
    files =[];
    currentFolders =[];
    dirStack =[];
    currentIndex = 0;
    urlCache.forEach(url => URL.revokeObjectURL(url));
    urlCache.clear();
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
    dirStack =[];
    currentFolders =[];
    dom.fallbackInputFiles.click(); 
});

async function processDirectoryHandle(handle, titleOverride = null) {
    const fileList =[];
    currentFolders =[];
    for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
            const file = await entry.getFile();
            if (file.type.startsWith('image/')) fileList.push(file);
        } else if (entry.kind === 'directory') {
            currentFolders.push(entry);
        }
    }
    processFileList(fileList, titleOverride || handle.name);
}

async function handleDirectoryPicker() {
    try {
        const handle = await window.showDirectoryPicker();
        dirStack =[{ handle: handle, name: handle.name }];
        await saveDirHandle(handle);
        await renderRecents();
        await processDirectoryHandle(handle);
    } catch(e) {}
}

dom.btnOpenDir.addEventListener('click', () => {
    dom.openDropdown.classList.remove('active');
    if (window.showDirectoryPicker) {
        handleDirectoryPicker();
    } else {
        dirStack =[];
        currentFolders =[];
        dom.fallbackInputDir.click();
    }
});

const handleFileInput = (e) => {
    if (e.target.files.length > 0) {
        const filesArr = Array.from(e.target.files);
        let title = 'Shoga Viewer';
        if (filesArr[0].webkitRelativePath) {
            title = filesArr[0].webkitRelativePath.split('/')[0] || title;
        }
        processFileList(filesArr.filter(f => f.type.startsWith('image/')), title);
    }
    e.target.value = ''; 
};
dom.fallbackInputFiles.addEventListener('change', handleFileInput);
dom.fallbackInputDir.addEventListener('change', handleFileInput);

dom.btnSettings.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    const isHidden = dom.settingsPanel.classList.contains('hidden');
    closeAllPanels();
    if (isHidden) dom.settingsPanel.classList.remove('hidden'); 
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

document.addEventListener('click', (e) => {
    if (!dom.settingsPanel.contains(e.target) && e.target !== dom.btnSettings) dom.settingsPanel.classList.add('hidden');
    if (!dom.infoPanel.contains(e.target) && e.target !== dom.btnInfo) dom.infoPanel.classList.add('hidden');
    if (!dom.licensePanel.contains(e.target) && e.target !== dom.attributionLink) dom.licensePanel.classList.add('hidden');
    if (!dom.openDropdown.contains(e.target) && e.target !== dom.btnOpenMain) dom.openDropdown.classList.remove('active');
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

bindGroup(['mode-single', 'mode-spread'], id => { 
    layoutMode = id === 'mode-single' ? 'SINGLE' : 'SPREAD'; 
    if (layoutMode === 'SPREAD') {
        dom.coverSettingGroup.classList.add('visible');
    } else {
        dom.coverSettingGroup.classList.remove('visible');
    }
    renderViewer(); 
});
bindGroup(['cover-inline', 'cover-isolated'], id => { firstPageCover = id === 'cover-isolated'; renderViewer(); });
bindGroup(['dir-ltr', 'dir-rtl'], id => { readDir = id === 'dir-ltr' ? 'LTR' : 'RTL'; renderViewer(); });
bindGroup(['fit-contain', 'fit-auto', 'fit-width', 'fit-height', 'fit-original'], id => { fitMode = id.replace('fit-', '').toUpperCase(); renderViewer(); });
bindGroup(['fsr-off', 'fsr-bilinear', 'fsr-anime4x', 'fsr-xbrz', 'fsr-fsr'], id => { 
    if (id === 'fsr-off') upscaleMode = 'OFF';
    else if (id === 'fsr-bilinear') upscaleMode = 'BILINEAR';
    else if (id === 'fsr-anime4x') upscaleMode = 'ANIME4X';
    else if (id === 'fsr-xbrz') upscaleMode = 'XBRZ';
    else upscaleMode = 'FSR';
    
    localStorage.setItem('shoga-upscale-mode', upscaleMode);
    
    if (upscaleMode !== 'OFF') {
        if (viewMode === 'VIEWER') {
            dom.viewerSlider.querySelectorAll('.view-slot img:not(.crossfade-clone)').forEach(img => {
                if (!img.dataset.fsrAppliedTier) {
                    executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
                }
            });
        }
        clearTimeout(fsrDebounceTimer);
        fsrDebounceTimer = setTimeout(applyFSROverlays, 300);
        startPreloadQueue();
    } else {
        if (viewMode === 'VIEWER') {
            const imgs = dom.viewerSlider.querySelectorAll('img:not(.crossfade-clone)');
            imgs.forEach(img => {
                if (img.dataset.fsrAppliedTier) {
                    executeCrossfadeSwap(img, img.dataset.originalUrl, null);
                }
            });
        }
    }
});

function drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH) {
    const compileShader = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    };

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1,  -1,  1,
        -1,  1,  1, -1,   1,  1
    ]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.uniform2f(gl.getUniformLocation(program, 'u_texSize'), texW, texH);

    return program;
}

function renderFSR(img, canvas, cw, ch, texW, texH, sharpness = 1.8) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true }) || canvas.getContext('webgl', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return;

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
        precision mediump float;
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
    
    const program = drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.uniform1f(gl.getUniformLocation(program, 'u_sharpness'), sharpness);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
}

function renderAnime4xLite(img, canvas, cw, ch, texW, texH) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true }) || canvas.getContext('webgl', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return;

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
        precision mediump float;
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
    drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
}

function renderXBRZLite(img, canvas, cw, ch, texW, texH) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true }) || canvas.getContext('webgl', { antialias: false, depth: false, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return;

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
        precision mediump float;
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
    drawWebGL(gl, vsSource, fsSource, img, cw, ch, texW, texH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
}

function processNextPreload() {
    if (upscaleMode === 'OFF' || viewMode !== 'VIEWER') {
        isPreloading = false;
        return;
    }
    if (isPanning || isDragging || dom.body.classList.contains('animating') || upscaleTasks > 0) {
        preloadQueueTimer = setTimeout(processNextPreload, 200);
        return;
    }

    let targetIndex = -1;
    let MAX_PRELOAD = 16;
    let actualMode = upscaleMode;
    let fsrRatio = (actualMode !== 'BILINEAR' && actualMode !== 'OFF') ? 2.0 : 1;
    let MAX_DIM = MAX_GL_TEXTURE_SIZE;

    for (let i = 1; i <= MAX_PRELOAD; i++) {
        let rightIdx = currentIndex + i;
        let leftIdx = currentIndex - i;
        let checkOrder = readDir === 'LTR' ?[rightIdx, leftIdx] :[leftIdx, rightIdx];
        
        for (let idx of checkOrder) {
            if (idx >= 0 && idx < files.length) {
                const origUrl = getFileUrl(idx);
                const cacheKey = origUrl + '_' + actualMode + '_' + fsrRatio;
                if (!upscaleCache.has(cacheKey)) {
                    targetIndex = idx;
                    break;
                }
            }
        }
        if (targetIndex !== -1) break;
    }

    if (targetIndex === -1) {
        isPreloading = false;
        return; 
    }

    const idx = targetIndex;
    const origUrl = getFileUrl(idx);
    const cacheKey = origUrl + '_' + actualMode + '_' + fsrRatio;

    if (actualMode === 'BILINEAR') {
        upscaleCache.set(cacheKey, origUrl);
        preloadQueueTimer = setTimeout(processNextPreload, 50);
        return;
    }

    const srcImg = new Image();
    srcImg.crossOrigin = "anonymous";
    srcImg.onload = () => {
        if (isPanning || isDragging || dom.body.classList.contains('animating') || upscaleTasks > 0) {
            preloadQueueTimer = setTimeout(processNextPreload, 200);
            return;
        }
        const nw = srcImg.naturalWidth;
        const nh = srcImg.naturalHeight;
        if (!nw || !nh) {
            preloadQueueTimer = setTimeout(processNextPreload, 50);
            return;
        }

        if (nw * fsrRatio > MAX_DIM || nh * fsrRatio > MAX_DIM) {
            upscaleCache.set(cacheKey, origUrl);
            if (viewMode === 'VIEWER') {
                const domImgs = dom.viewerSlider.querySelectorAll(`img[data-file-index="${idx}"]:not(.crossfade-clone)`);
                domImgs.forEach(domImg => {
                    if (domImg.dataset.fsrAppliedTier !== 'NATIVE_BILINEAR') {
                        executeCrossfadeSwap(domImg, origUrl, 'NATIVE_BILINEAR');
                    }
                });
            }
            preloadQueueTimer = setTimeout(processNextPreload, 50);
            return;
        }

        const upscaleW = Math.ceil(nw * fsrRatio);
        const upscaleH = Math.ceil(nh * fsrRatio);

        let sourceForWebGL = srcImg;
        
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = upscaleW;
        finalCanvas.height = upscaleH;
        
        if (actualMode === 'FSR') {
            renderFSR(sourceForWebGL, finalCanvas, upscaleW, upscaleH, nw, nh, 1.8);
        } else if (actualMode === 'ANIME4X') {
            renderAnime4xLite(sourceForWebGL, finalCanvas, upscaleW, upscaleH, nw, nh);
        } else if (actualMode === 'XBRZ') {
            renderXBRZLite(sourceForWebGL, finalCanvas, upscaleW, upscaleH, nw, nh);
        }
        
        const fileType = files[idx].type;
        const mime = (fileType === 'image/png' || fileType === 'image/webp' || fileType === 'image/gif') ? 'image/png' : 'image/jpeg';
        
        finalCanvas.toBlob(blob => {
            const newUrl = URL.createObjectURL(blob);
            if (upscaleCache.size >= 64) {
                const firstKey = upscaleCache.keys().next().value;
                URL.revokeObjectURL(upscaleCache.get(firstKey));
                upscaleCache.delete(firstKey);
            }
            upscaleCache.set(cacheKey, newUrl);
            
            if (viewMode === 'VIEWER') {
                const domImgs = dom.viewerSlider.querySelectorAll(`img[data-file-index="${idx}"]:not(.crossfade-clone)`);
                domImgs.forEach(domImg => {
                    if (domImg.dataset.fsrAppliedTier !== cacheKey) {
                        executeCrossfadeSwap(domImg, newUrl, cacheKey);
                    }
                });
            }
            
            preloadQueueTimer = setTimeout(processNextPreload, 50);
        }, mime, 0.92);
    };
    srcImg.onerror = () => {
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
    img.parentElement.style.position = 'relative';
    const clone = new Image();
    clone.src = img.src;
    clone.className = img.className;
    clone.classList.add('crossfade-clone');
    if (img.dataset.fsrAppliedTier) {
        clone.dataset.fsrAppliedTier = img.dataset.fsrAppliedTier;
    }
    clone.style.cssText = img.style.cssText;
    clone.style.position = 'absolute';
    clone.style.left = img.offsetLeft + 'px';
    clone.style.top = img.offsetTop + 'px';
    clone.style.width = img.offsetWidth + 'px';
    clone.style.height = img.offsetHeight + 'px';
    clone.style.zIndex = '10';
    clone.style.transition = 'opacity 0.3s ease-out';
    clone.style.pointerEvents = 'none';
    clone.style.objectFit = window.getComputedStyle(img).objectFit;
    clone.style.objectPosition = window.getComputedStyle(img).objectPosition;
    
    img.parentElement.appendChild(clone);
    
    img.src = targetUrl;
    if (tierName) {
        img.dataset.fsrAppliedTier = tierName;
        if (tierName === 'NATIVE_BILINEAR') delete img.dataset.fsrProcessingKey;
    } else {
        delete img.dataset.fsrAppliedTier;
        delete img.dataset.fsrProcessingKey;
    }
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            clone.style.opacity = '0';
            setTimeout(() => {
                if (clone.parentNode) clone.parentNode.removeChild(clone);
            }, 350);
        });
    });
};

function applyFSROverlays() {
    if (upscaleMode === 'OFF' || viewMode !== 'VIEWER') return;
    if (dom.body.classList.contains('animating')) return;

    const imgs = dom.viewerContent.querySelectorAll('img:not(.crossfade-clone)');
    let fsrDisabledDueToSize = false;

    imgs.forEach(img => {
        const nw = parseInt(img.dataset.origNw) || img.naturalWidth;
        const nh = parseInt(img.dataset.origNh) || img.naturalHeight;
        if (!nw || !nh) return;

        let MAX_DIM = MAX_GL_TEXTURE_SIZE;
        let actualMode = upscaleMode;
        let fsrRatio = 1;
        let isTooLarge = false;
        
        if (upscaleMode !== 'BILINEAR') {
            fsrRatio = 2.0;
            if (nw * 2.0 > MAX_DIM || nh * 2.0 > MAX_DIM) {
                isTooLarge = true;
                fsrDisabledDueToSize = true;
            }
        }

        if (actualMode === 'BILINEAR' || isTooLarge) {
            if (img.dataset.fsrAppliedTier !== 'NATIVE_BILINEAR') {
                const doSwap = () => {
                    if (!dom.viewerContent.contains(img)) return;
                    executeCrossfadeSwap(img, img.dataset.originalUrl, 'NATIVE_BILINEAR');
                };
                if (isPanning || isDragging || dom.body.classList.contains('animating')) {
                    img.pendingFsrSwap = doSwap;
                } else {
                    doSwap();
                }
            }
            return;
        }

        const cacheKey = img.dataset.originalUrl + '_' + actualMode + '_' + fsrRatio;
        if (img.dataset.fsrAppliedTier === cacheKey || img.dataset.fsrProcessingKey === cacheKey) return;

        const upscaleW = Math.ceil(nw * fsrRatio);
        const upscaleH = Math.ceil(nh * fsrRatio);

        const applyUpscaledImage = async (url) => {
            if (!dom.viewerContent.contains(img) || img.dataset.fsrProcessingKey !== cacheKey) return;
            const tempImg = new Image();
            tempImg.src = url;
            try { 
                await tempImg.decode(); 
            } catch (e) { 
                upscaleCache.delete(cacheKey);
                delete img.dataset.fsrProcessingKey;
                if (img.src !== img.dataset.originalUrl) {
                    img.src = img.dataset.originalUrl;
                    img.dataset.fsrAppliedTier = 'NATIVE_BILINEAR';
                }
                return; 
            }
            
            const doSwap = () => {
                if (!dom.viewerContent.contains(img) || img.dataset.fsrProcessingKey !== cacheKey) return;
                executeCrossfadeSwap(img, url, cacheKey);
            };

            if (isPanning || isDragging || dom.body.classList.contains('animating')) {
                img.pendingFsrSwap = doSwap;
            } else {
                doSwap();
            }
        };

        if (upscaleCache.has(cacheKey)) {
            const cachedUrl = upscaleCache.get(cacheKey);
            upscaleCache.delete(cacheKey);
            upscaleCache.set(cacheKey, cachedUrl);
            img.dataset.fsrProcessingKey = cacheKey;
            applyUpscaledImage(cachedUrl);
            return;
        }

        if (isPanning || isDragging) {
            return;
        }

        if (!img.dataset.fsrAppliedTier) {
            img.dataset.fsrAppliedTier = 'NATIVE_BILINEAR';
        }

        img.dataset.fsrProcessingKey = cacheKey;

        const process = () => {
            showUpscaleIndicator();
            const srcImg = new Image();
            srcImg.crossOrigin = "anonymous";
            srcImg.onload = () => {
                setTimeout(() => {
                    if (isPanning || isDragging || dom.body.classList.contains('animating')) {
                        delete img.dataset.fsrProcessingKey;
                        hideUpscaleIndicator();
                        return;
                    }
                    
                    let sourceForWebGL = srcImg;
                    
                    const finalCanvas = document.createElement('canvas');
                    finalCanvas.width = upscaleW;
                    finalCanvas.height = upscaleH;
                    
                    if (actualMode === 'FSR') {
                        renderFSR(sourceForWebGL, finalCanvas, upscaleW, upscaleH, nw, nh, 1.8);
                    } else if (actualMode === 'ANIME4X') {
                        renderAnime4xLite(sourceForWebGL, finalCanvas, upscaleW, upscaleH, nw, nh);
                    } else if (actualMode === 'XBRZ') {
                        renderXBRZLite(sourceForWebGL, finalCanvas, upscaleW, upscaleH, nw, nh);
                    }
                    
                    setTimeout(() => {
                        if (isPanning || isDragging || dom.body.classList.contains('animating')) {
                            delete img.dataset.fsrProcessingKey;
                            hideUpscaleIndicator();
                            return;
                        }
                        const fileType = img.dataset.fileIndex ? files[parseInt(img.dataset.fileIndex)].type : 'image/jpeg';
                        const mime = (fileType === 'image/png' || fileType === 'image/webp' || fileType === 'image/gif') ? 'image/png' : 'image/jpeg';
                        
                        finalCanvas.toBlob(blob => {
                            const newUrl = URL.createObjectURL(blob);
                            if (upscaleCache.size >= 64) {
                                const firstKey = upscaleCache.keys().next().value;
                                URL.revokeObjectURL(upscaleCache.get(firstKey));
                                upscaleCache.delete(firstKey);
                            }
                            upscaleCache.set(cacheKey, newUrl);
                            applyUpscaledImage(newUrl);
                            hideUpscaleIndicator();
                        }, mime, 0.92);
                    }, 0);
                }, 0);
            };
            srcImg.onerror = () => {
                delete img.dataset.fsrProcessingKey;
                hideUpscaleIndicator();
            };
            srcImg.src = img.dataset.originalUrl || img.src;
        };

        if (img.complete) process();
        else img.addEventListener('load', process, { once: true });
    });

    const fsrWarningEl = document.getElementById('fsr-warning');
    const animeWarningEl = document.getElementById('anime4x-warning');
    const xbrzWarningEl = document.getElementById('xbrz-warning');
    
    if (fsrWarningEl) {
        fsrWarningEl.style.display = (fsrDisabledDueToSize && upscaleMode === 'FSR') ? 'flex' : 'none';
    }
    if (animeWarningEl) {
        animeWarningEl.style.display = (fsrDisabledDueToSize && upscaleMode === 'ANIME4X') ? 'flex' : 'none';
    }
    if (xbrzWarningEl) {
        xbrzWarningEl.style.display = (fsrDisabledDueToSize && upscaleMode === 'XBRZ') ? 'flex' : 'none';
    }
    
    startPreloadQueue();
}

function processFileList(fileList, title) {
    urlCache.forEach(url => URL.revokeObjectURL(url));
    urlCache.clear();

    files = fileList.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    
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
        document.title = currentTitle;
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
    viewMode = 'GRID';
    dom.body.classList.remove('ui-hidden');
    dom.gridArea.style.display = 'grid';
    dom.viewerArea.style.display = 'none';
    dom.btnGrid.style.display = 'none';
    dom.btnInfo.style.display = 'none';
    
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

    if (currentFolders.length > 0) {
        const sortGroup = document.createElement('div');
        sortGroup.className = 'folder-sort-group';
        
        const createSortBtn = (mode, svgPath) => {
            const b = document.createElement('button');
            b.className = `folder-sort-btn ${folderSortMode === mode ? 'active' : ''}`;
            b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
            b.addEventListener('click', () => {
                folderSortMode = mode;
                switchToGrid();
            });
            return b;
        };

        sortGroup.appendChild(createSortBtn('name-asc', '<path d="M6 3v18"></path><path d="M10 7l-4-4-4 4"></path><path d="M20 5h-5"></path><path d="M19 11h-4"></path><path d="M18 17h-4"></path>'));
        sortGroup.appendChild(createSortBtn('name-desc', '<path d="M6 21V3"></path><path d="M10 17l-4 4-4-4"></path><path d="M20 5h-5"></path><path d="M19 11h-4"></path><path d="M18 17h-4"></path>'));
        
        controlsWrapper.appendChild(sortGroup);

        const filterWrapper = document.createElement('div');
        filterWrapper.style.position = 'relative';
        filterWrapper.style.display = 'flex';
        filterWrapper.style.alignItems = 'center';

        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.className = 'folder-filter-input';
        filterInput.placeholder = 'Search...';
        filterInput.value = folderFilterText;
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
        clearBtn.style.opacity = folderFilterText ? '1' : '0';
        clearBtn.style.transition = 'opacity 0.2s, color 0.2s';
        clearBtn.style.pointerEvents = folderFilterText ? 'auto' : 'none';
        
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
            let filterStyleEl = document.getElementById('folder-filter-style');
            if (!filterStyleEl) {
                filterStyleEl = document.createElement('style');
                filterStyleEl.id = 'folder-filter-style';
                document.head.appendChild(filterStyleEl);
            }
            if (folderFilterText) {
                const safeQuery = folderFilterText.toLowerCase().replace(/(["\\])/g, '\\$1');
                filterStyleEl.textContent = `.folder-item:not([data-search*="${safeQuery}"]) { display: none !important; }`;
            } else {
                filterStyleEl.textContent = '';
            }
        };

        applyFilter(); 

        filterInput.addEventListener('input', (e) => {
            folderFilterText = e.target.value;
            toggleClearBtn();
            applyFilter();
        });

        clearBtn.addEventListener('click', () => {
            filterInput.value = '';
            folderFilterText = '';
            toggleClearBtn();
            applyFilter();
            filterInput.focus();
        });

        filterWrapper.appendChild(filterInput);
        filterWrapper.appendChild(clearBtn);
        controlsWrapper.appendChild(filterWrapper);
        
        setTimeout(() => { if(folderFilterText) filterInput.focus(); }, 0);
    }

    if (dirStack.length > 1) {
        const btnUp = document.createElement('button');
        btnUp.className = 'btn-up';
        btnUp.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`;
        btnUp.addEventListener('click', async () => {
            dirStack.pop();
            const parent = dirStack[dirStack.length - 1];
            folderFilterText = parent.filterText || '';
            await processDirectoryHandle(parent.handle, parent.name);
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
        
        let displayFolders =[...currentFolders];
        if (folderSortMode === 'name-asc') displayFolders.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
        else if (folderSortMode === 'name-desc') displayFolders.sort((a,b) => b.name.localeCompare(a.name, undefined, {numeric: true}));

        displayFolders.forEach(folder => {
            const folderItem = document.createElement('div');
            folderItem.className = 'folder-item';
            
            folderItem.dataset.search = folder.name.toLowerCase(); 
            
            folderItem.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> <span>${folder.name}</span>`;
            folderItem.addEventListener('click', async () => {
                if (dirStack.length > 0) {
                    dirStack[dirStack.length - 1].scrollTop = dom.gridArea.scrollTop;
                    dirStack[dirStack.length - 1].filterText = folderFilterText;
                }
                folderFilterText = ''; 
                const filterStyleEl = document.getElementById('folder-filter-style');
                if (filterStyleEl) filterStyleEl.textContent = ''; 

                dirStack.push({ handle: folder, name: folder.name, scrollTop: 0, filterText: '' });
                await processDirectoryHandle(folder, folder.name);
            });
            folderContainer.appendChild(folderItem);
        });
        dom.gridArea.appendChild(folderContainer);
    }

    files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'grid-item';
        item.dataset.index = index;
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

dom.gridArea.addEventListener('click', (e) => {
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
let isGridSwiping = false;

dom.gridArea.addEventListener('pointerdown', (e) => {
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
            dom.gridArea.style.transition = 'none';
            try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
        }
    }
});

dom.gridArea.addEventListener('pointermove', (e) => {
    if (viewMode === 'GRID' && isGridSwiping && dirStack.length > 1) {
        const dx = e.clientX - gridSwipeStartX;
        const dy = Math.abs(e.clientY - gridSwipeStartY);
        
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5) {
            if (e.cancelable) e.preventDefault();
            if (dx > 0 && isGridPulling) {
                isGridPulling = false;
                dom.gridArea.classList.remove('pulling');
                dom.ptrIndicator.style.opacity = 0;
                dom.ptrIndicator.style.transform = 'translateX(-50%) rotate(0deg)';
            }
        }

        if (dx > 0 && !isGridPulling) {
            dom.gridArea.style.transform = `translateX(${dx}px)`;
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
        dom.gridArea.style.transform = `translateY(${gridPtrDistance}px)`;
        dom.ptrIndicator.style.opacity = Math.min(gridPtrDistance / GRID_PTR_THRESHOLD, 1);
        dom.ptrIndicator.style.transform = `translateX(-50%) rotate(${gridPtrDistance * 2}deg)`;
        
        if (e.cancelable) e.preventDefault();
    } else if (dy < 0) {
        isGridPulling = false;
        dom.gridArea.classList.remove('pulling');
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
        try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}
        
        const dx = e.clientX - gridSwipeStartX;
        dom.gridArea.style.transition = 'transform 0.3s ease-out';
        
        if (dx > 70) {
            dom.gridArea.style.transform = `translateX(100vw)`;
            setTimeout(async () => {
                dirStack.pop();
                const parent = dirStack[dirStack.length - 1];
                folderFilterText = parent.filterText || '';
                await processDirectoryHandle(parent.handle, parent.name);
                
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
            if (await verifyPermission(current.handle)) {
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
    viewMode = 'VIEWER';
    dom.gridArea.style.display = 'none';
    dom.viewerArea.style.display = 'block';
    dom.btnGrid.style.display = 'flex';
    dom.btnInfo.style.display = 'flex';
    dom.body.classList.add('ui-hidden');
    renderViewer();
}

function getSpreadGroup(index) {
    if (index < 0 || index >= files.length) return[];
    if (layoutMode === 'SINGLE') return[index];

    if (firstPageCover && index === 0) return[0];

    const offset = firstPageCover ? 1 : 0;
    const adjIndex = index - offset;
    const groupStart = Math.floor(adjIndex / 2) * 2 + offset;
    
    const group =[groupStart];
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
    let indices =[...rawGroup];
    if (layoutMode === 'SPREAD' && indices.length === 2 && readDir === 'RTL') {
        indices.reverse();
    }

    let html = '';
    indices.forEach((idx, i) => {
        const f = files[idx];
        const sizeMB = (f.size / (1024 * 1024)).toFixed(2);
        
        if (layoutMode === 'SPREAD' && indices.length === 2) {
            html += `<div class="panel-title">${i === 0 ? 'LEFT PAGE' : 'RIGHT PAGE'}</div>`;
        }
        
        html += `<div class="info-row"><span class="info-label">FILENAME</span><span class="info-value">${f.name}</span></div>
                 <div class="info-row"><span class="info-label">SIZE</span><span class="info-value">${sizeMB} MB</span></div>
                 <div class="info-row"><span class="info-label">INDEX</span><span class="info-value">${idx + 1} / ${files.length}</span></div>`;
        
        if (i < indices.length - 1) {
            html += `<div class="info-divider"></div>`;
        }
    });

    dom.infoContent.innerHTML = html;
}

function populateSlot(slot, targetIndex) {
    if (targetIndex < 0 || targetIndex >= files.length) {
        slot.replaceChildren();
        return;
    }
    
    const rawGroup = getSpreadGroup(targetIndex);
    let indices =[...rawGroup];

    if (layoutMode === 'SPREAD' && indices.length === 2) {
        if (readDir === 'RTL') indices.reverse();
    }

    let actualMode = upscaleMode;
    let fsrRatio = (actualMode !== 'BILINEAR' && actualMode !== 'OFF') ? 2.0 : 1;

    const imgs = slot.querySelectorAll('img:not(.crossfade-clone)');
    if (imgs.length !== indices.length) {
        slot.replaceChildren();
        indices.forEach((idx, i) => {
            const img = document.createElement('img');
            const url = getFileUrl(idx);
            const cacheKey = url + '_' + actualMode + '_' + fsrRatio;
            const cachedUrl = upscaleCache.get(cacheKey);

            if (layoutMode === 'SPREAD' && indices.length === 2) {
                img.className = i === 0 ? 'spread-left' : 'spread-right';
            } else {
                img.className = '';
            }

            img.dataset.fileIndex = idx;
            img.dataset.originalUrl = url;
            
            if (upscaleMode !== 'OFF' && cachedUrl && cachedUrl !== 'error') {
                img.src = cachedUrl;
                img.dataset.fsrAppliedTier = cacheKey;
            } else {
                img.src = url;
                if (upscaleMode !== 'OFF') img.dataset.fsrAppliedTier = 'NATIVE_BILINEAR';
            }

            img.onload = function() {
                if (!this.dataset.origNw || this.dataset.originalUrl === this.src) {
                    this.dataset.origNw = this.naturalWidth;
                    this.dataset.origNh = this.naturalHeight;
                    this.style.aspectRatio = `${this.naturalWidth} / ${this.naturalHeight}`;
                    this.style.setProperty('--orig-w', `${this.naturalWidth}px`);
                    this.style.setProperty('--orig-h', `${this.naturalHeight}px`);
                }
            };
            img.onerror = function() {
                if (this.src && this.src !== this.dataset.originalUrl) {
                    const failedTier = this.dataset.fsrAppliedTier || this.dataset.fsrProcessingKey;
                    if (failedTier && upscaleCache.has(failedTier)) {
                        upscaleCache.delete(failedTier);
                    }
                    this.src = this.dataset.originalUrl;
                    delete this.dataset.fsrAppliedTier;
                    delete this.dataset.fsrProcessingKey;
                    if (upscaleMode !== 'OFF') {
                        this.dataset.fsrAppliedTier = 'NATIVE_BILINEAR';
                        clearTimeout(fsrDebounceTimer);
                        fsrDebounceTimer = setTimeout(applyFSROverlays, 100);
                    }
                }
            };
            slot.appendChild(img);
        });
    } else {
        indices.forEach((idx, i) => {
            const url = getFileUrl(idx);
            if (imgs[i].dataset.originalUrl !== url) {
                const cacheKey = url + '_' + actualMode + '_' + fsrRatio;
                const cachedUrl = upscaleCache.get(cacheKey);

                if (layoutMode === 'SPREAD' && indices.length === 2) {
                    imgs[i].className = i === 0 ? 'spread-left' : 'spread-right';
                } else {
                    imgs[i].className = '';
                }

                imgs[i].dataset.fileIndex = idx;
                imgs[i].dataset.originalUrl = url;
                
                if (upscaleMode !== 'OFF' && cachedUrl && cachedUrl !== 'error') {
                    imgs[i].src = cachedUrl;
                    imgs[i].dataset.fsrAppliedTier = cacheKey;
                } else {
                    imgs[i].src = url;
                    if (upscaleMode !== 'OFF') {
                        imgs[i].dataset.fsrAppliedTier = 'NATIVE_BILINEAR';
                    } else {
                        delete imgs[i].dataset.fsrAppliedTier;
                    }
                }
                
                delete imgs[i].dataset.origNw;
                delete imgs[i].dataset.origNh;
                delete imgs[i].dataset.fsrProcessingKey;
                delete imgs[i].pendingFsrSwap;
            }
        });
    }
}

function renderViewer() {
    if (files.length === 0 || viewMode !== 'VIEWER') return;
    
    updateIndices();

    let fitClass = `fit-${fitMode.toLowerCase()}`;
    let spreadClass = layoutMode === 'SPREAD' ? 'view-spread ' : '';
    
    dom.slots.prev.className = `view-slot ${spreadClass}${fitClass}`;
    dom.slots.curr.className = `view-slot ${spreadClass}${fitClass}`;
    dom.slots.next.className = `view-slot ${spreadClass}${fitClass}`;

    if (!dom.viewerContent.parentElement) dom.slots.curr.appendChild(dom.viewerContent);
    
    if (readDir === 'LTR') {
        populateSlot(dom.slots.prev, prevIndex);
        populateSlot(dom.slots.next, nextIndex);
    } else {
        populateSlot(dom.slots.prev, nextIndex);
        populateSlot(dom.slots.next, prevIndex);
    }

    populateSlot(dom.viewerContent, currentIndex);

    resetTransform(false);
    
    if (!dom.body.classList.contains('animating')) {
        clearTimeout(fsrDebounceTimer);
        fsrDebounceTimer = setTimeout(applyFSROverlays, 300);
    }
}

function resetTransform(smooth = true) {
    currentZoom = 1; panX = 0; panY = 0;
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

function applyContentTransform() {
    dom.viewerContent.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
    clearTimeout(fsrDebounceTimer);
    fsrDebounceTimer = setTimeout(applyFSROverlays, 300);
}

function cleanCaches() {
    const activeUrls = new Set();
    for (const[idx, url] of urlCache.entries()) {
        if (Math.abs(idx - currentIndex) > 16) {
            URL.revokeObjectURL(url);
            urlCache.delete(idx);
        } else {
            activeUrls.add(url);
        }
    }
    for (const[key, url] of upscaleCache.entries()) {
        const origUrl = key.split('_')[0];
        if (!activeUrls.has(origUrl)) {
            if (url !== 'error' && url.startsWith('blob:')) URL.revokeObjectURL(url);
            upscaleCache.delete(key);
        }
    }
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
        
        dom.body.classList.add('animating');
        dom.viewerSlider.style.transform = `translateX(${bounceX}px)`;
        
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

    void dom.viewerSlider.offsetWidth; 

    dom.body.classList.add('animating');
    dom.viewerSlider.style.transform = `translateX(${translationX}px)`;

    navTimeout = setTimeout(() => {
        commitNavigation();
        if (!dom.infoPanel.classList.contains('hidden')) updateInfoPanel();
    }, 350);
}

window.addEventListener('blur', () => {
    isPanning = false; isDragging = false; pointers =[]; initialDistance = 0;
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        isPanning = false; isDragging = false; pointers =[]; initialDistance = 0;
    }
});

dom.viewerArea.addEventListener('wheel', (e) => {
    if (viewMode !== 'VIEWER') return;
    closeAllPanels();
    if (navTimeout) commitNavigation();
    e.preventDefault();
    dom.body.classList.add('ui-hidden');
    
    const zoomFactor = -e.deltaY * 0.001;
    const newZoom = Math.max(0.1, Math.min(currentZoom * Math.exp(zoomFactor), 10));
    
    const cx = e.clientX - window.innerWidth / 2;
    const cy = e.clientY - window.innerHeight / 2;

    panX = cx - (cx - panX) * (newZoom / currentZoom);
    panY = cy - (cy - panY) * (newZoom / currentZoom);
    
    currentZoom = newZoom;
    applyContentTransform();
}, { passive: false });

dom.viewerArea.addEventListener('pointerdown', (e) => {
    if (viewMode !== 'VIEWER' || e.target.closest('#top-bar') || e.target.closest('.panel') || e.target.closest('#bookmarks-panel')) return;
    
    closeAllPanels();
    if (navTimeout) commitNavigation();

    const now = Date.now();
    
    if (pointers.length === 0) {
        if (now - lastTap < 250) {
            clearTimeout(singleTapTimeout);
            resetTransform(true);
            lastTap = 0;
            return;
        }
        lastTap = now;
    }

    isPanning = true; isDragging = false; axisLocked = null;
    pointers.push(e);
    
    try { dom.viewerArea.setPointerCapture(e.pointerId); } catch(err) {}

    if (pointers.length === 1) {
        startX = e.clientX; startY = e.clientY;
        initialPanX = panX; initialPanY = panY;
    }
});

dom.viewerArea.addEventListener('pointermove', (e) => {
    if (!isPanning || navTimeout) return;
    const idx = pointers.findIndex(p => p.pointerId === e.pointerId);
    if (idx !== -1) pointers[idx] = e;

    if (pointers.length === 1) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && Math.hypot(dx, dy) > 10) {
            isDragging = true;
            dom.body.classList.add('ui-hidden');
            
            let totalW = 0, maxH = 0;
            dom.viewerContent.querySelectorAll('img:not(.crossfade-clone)').forEach(img => {
                totalW += img.offsetWidth;
                maxH = Math.max(maxH, img.offsetHeight);
            });
            totalW *= currentZoom;
            maxH *= currentZoom;
            
            const overflowX = totalW > window.innerWidth;
            const overflowY = maxH > window.innerHeight;
            
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
                let totalW = 0, maxH = 0;
                dom.viewerContent.querySelectorAll('img:not(.crossfade-clone)').forEach(img => {
                    totalW += img.offsetWidth;
                    maxH = Math.max(maxH, img.offsetHeight);
                });
                totalW *= currentZoom;
                maxH *= currentZoom;
                
                let maxPx = Math.max(0, (totalW - window.innerWidth) / 2);
                let maxPy = Math.max(0, (maxH - window.innerHeight) / 2);
                
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
        const dist = Math.hypot(pointers[0].clientX - pointers[1].clientX, pointers[0].clientY - pointers[1].clientY);
        const center = { x: (pointers[0].clientX + pointers[1].clientX) / 2, y: (pointers[0].clientY + pointers[1].clientY) / 2 };
        
        if (initialDistance === 0) {
            initialDistance = dist; initialZoom = currentZoom;
            startX = center.x; startY = center.y;
            initialPanX = panX; initialPanY = panY;
        } else {
            const scale = dist / initialDistance;
            const newZoom = Math.max(0.1, Math.min(initialZoom * scale, 10));
            const cx = center.x - window.innerWidth / 2;
            const cy = center.y - window.innerHeight / 2;
            
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
    } catch(err) {}

    const idx = pointers.findIndex(p => p.pointerId === e.pointerId);
    if (idx !== -1) pointers.splice(idx, 1);

    if (pointers.length === 0) {
        initialDistance = 0;
        if (isDragging) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY; 
            
            if (axisLocked === 'x') {
                let physicalDir = dx > 0 ? 'prev' : 'next';
                let logicalDir = readDir === 'LTR' ? physicalDir : (physicalDir === 'next' ? 'prev' : 'next');
                updateIndices();
                let targetIdx = logicalDir === 'next' ? nextIndex : prevIndex;
                let isBlocked = isSingleFileMode || targetIdx < 0 || targetIdx >= files.length;

                if (Math.abs(dx) > window.innerWidth * 0.15 && !isBlocked) {
                    navigateLogical(logicalDir);
                } else resetTransform(true);
            } else if (axisLocked === 'y') {
                if (dy > window.innerHeight * 0.15) {
                    switchToGrid();
                } else {
                    panY = 0; applyContentTransform();
                }
            } else {
                let totalW = 0, maxH = 0;
                dom.viewerContent.querySelectorAll('img:not(.crossfade-clone)').forEach(img => {
                    totalW += img.offsetWidth;
                    maxH = Math.max(maxH, img.offsetHeight);
                });
                totalW *= currentZoom;
                maxH *= currentZoom;
                
                let maxPx = Math.max(0, (totalW - window.innerWidth) / 2);
                let maxPy = Math.max(0, (maxH - window.innerHeight) / 2);
                
                let rawPanX = initialPanX + dx;
                let overscrollX = 0;
                if (rawPanX > maxPx) overscrollX = rawPanX - maxPx;
                else if (rawPanX < -maxPx) overscrollX = rawPanX - (-maxPx);
                
                if (Math.abs(overscrollX) > window.innerWidth * 0.15) {
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
            const clickX = e.clientX, screenW = window.innerWidth;
            clearTimeout(singleTapTimeout);
            singleTapTimeout = setTimeout(() => {
                if (currentZoom === 1) {
                    if (clickX < screenW * 0.15) navigateLogical(readDir === 'LTR' ? 'prev' : 'next');
                    else if (clickX > screenW * 0.85) navigateLogical(readDir === 'LTR' ? 'next' : 'prev');
                    else dom.body.classList.toggle('ui-hidden');
                } else dom.body.classList.toggle('ui-hidden');
            }, 200);
        }
        isPanning = false; isDragging = false;
        dom.viewerContent.querySelectorAll('img').forEach(img => {
            if (img.pendingFsrSwap) {
                img.pendingFsrSwap();
                delete img.pendingFsrSwap;
            }
        });
        clearTimeout(fsrDebounceTimer);
        fsrDebounceTimer = setTimeout(applyFSROverlays, 300);
    } else {
        startX = pointers[0].clientX; startY = pointers[0].clientY;
        initialPanX = panX; initialPanY = panY;
        initialDistance = 0; 
    }
}

dom.viewerArea.addEventListener('pointerup', handlePointerEnd);
dom.viewerArea.addEventListener('pointercancel', handlePointerEnd);

window.addEventListener('keydown', (e) => {
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
            const newZoom = Math.min(currentZoom * 1.25, 10);
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

window.addEventListener('pointerdown', (e) => {
    if (e.clientX > window.innerWidth - 30) {
        isEdgeSwiping = true;
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

window.addEventListener('pointerup', () => { isEdgeSwiping = false; });
window.addEventListener('pointercancel', () => { isEdgeSwiping = false; });

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
            try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
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

const endBmSwipe = (e) => {
    if (!isBmSwiping) return;
    isBmSwiping = false;
    try { if (e && e.target) e.target.releasePointerCapture(e.pointerId); } catch(err) {}
    
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
        const validImages = openedFiles.filter(f => f.type.startsWith('image/'));

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
                                dirStack =[{ handle: item.handle, name: item.name }];
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
                    } catch (e) {}
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
