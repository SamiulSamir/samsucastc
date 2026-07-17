// avatar-cache.js — IndexedDB-backed avatar blob cache
// Downloads user icons once, caches them locally, serves synchronously from memory.

window.AvatarCache = (() => {
    const DB_NAME = 'samsu-avatars';
    const DB_VERSION = 1;
    const STORE_NAME = 'icons';

    let db = null;
    // In-memory map: { username -> blobUrl }
    const memoryCache = {};
    // Track r2 keys to know if icon changed: { username -> r2Key }
    const r2KeyMap = {};
    // Pending downloads to avoid duplicates
    const pendingDownloads = {};

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, { keyPath: 'username' });
                }
            };
            req.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };
            req.onerror = (e) => {
                console.error('AvatarCache: IndexedDB open failed', e);
                resolve(null); // Gracefully degrade
            };
        });
    }

    function getAllCached() {
        return new Promise((resolve) => {
            if (!db) return resolve([]);
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });
    }

    function saveToDB(username, r2Key, blob) {
        return new Promise((resolve) => {
            if (!db) return resolve();
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put({ username, r2Key, blob });
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    function deleteFromDB(username) {
        return new Promise((resolve) => {
            if (!db) return resolve();
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.delete(username);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }

    async function downloadAndCache(username, r2Key) {
        // Don't double-download
        if (pendingDownloads[username]) return pendingDownloads[username];

        pendingDownloads[username] = (async () => {
            try {
                // Wait for R2 to be ready
                let retries = 0;
                while (!window.r2Ready && retries < 50) {
                    await new Promise(r => setTimeout(r, 100));
                    retries++;
                }
                if (!window.r2Ready) {
                    console.warn('AvatarCache: R2 not ready, skipping', username);
                    return;
                }

                const actualKey = r2Key.replace('r2://', '');
                const data = await window.s3.getObject({ Bucket: window.R2Bucket, Key: actualKey }).promise();
                const blob = new Blob([data.Body], { type: data.ContentType || 'image/png' });

                // Revoke old blob URL if exists
                if (memoryCache[username]) {
                    URL.revokeObjectURL(memoryCache[username]);
                }

                const blobUrl = URL.createObjectURL(blob);
                memoryCache[username] = blobUrl;
                r2KeyMap[username] = r2Key;

                // Persist to IndexedDB (store the raw blob, not the URL)
                await saveToDB(username, r2Key, blob);

                console.log(`AvatarCache: Cached avatar for ${username}`);
            } catch (e) {
                console.error(`AvatarCache: Failed to cache avatar for ${username}`, e);
            } finally {
                delete pendingDownloads[username];
            }
        })();

        return pendingDownloads[username];
    }

    return {
        /**
         * Initialize: open IndexedDB and load all cached blobs into memory.
         */
        init: async () => {
            await openDB();
            const cached = await getAllCached();
            for (const entry of cached) {
                if (entry.blob) {
                    const blobUrl = URL.createObjectURL(entry.blob);
                    memoryCache[entry.username] = blobUrl;
                    r2KeyMap[entry.username] = entry.r2Key;
                }
            }
            console.log(`AvatarCache: Loaded ${cached.length} cached avatars from IndexedDB`);
        },

        /**
         * Process the full user icon registry from the server.
         * Downloads new/changed icons, skips unchanged ones.
         * @param {Object} iconMap - { username: "r2://key", ... }
         */
        processRegistry: (iconMap) => {
            if (!iconMap || typeof iconMap !== 'object') return;

            for (const [username, r2Key] of Object.entries(iconMap)) {
                if (!r2Key || !r2Key.startsWith('r2://')) continue;

                // Skip if already cached with the same r2Key
                if (r2KeyMap[username] === r2Key && memoryCache[username]) {
                    continue;
                }

                // Download in background (don't await — non-blocking)
                downloadAndCache(username, r2Key);
            }
        },

        /**
         * Update a single user's cached icon (called on 'user_icon_updated' broadcast).
         * @param {string} username
         * @param {string} r2Key - e.g. "r2://filename.png"
         */
        updateUser: (username, r2Key) => {
            if (!r2Key || !r2Key.startsWith('r2://')) return;

            // Always re-download on update (icon changed)
            downloadAndCache(username, r2Key);
        },

        /**
         * Cache your own icon immediately after uploading (skip waiting for server broadcast).
         * @param {string} username
         * @param {string} r2Key
         */
        setOwnIcon: async (username, r2Key) => {
            if (!r2Key || !r2Key.startsWith('r2://')) return;
            await downloadAndCache(username, r2Key);
        },

        /**
         * Synchronous avatar URL lookup from the in-memory cache.
         * @param {string} username
         * @returns {string|null} - blob:// URL or null if not cached
         */
        getAvatarUrl: (username) => {
            return memoryCache[username] || null;
        },

        /**
         * Get the raw r2 key for a user (useful for checking if icon changed).
         * @param {string} username
         * @returns {string|null}
         */
        getR2Key: (username) => {
            return r2KeyMap[username] || null;
        }
    };
})();
