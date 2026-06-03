// ==UserScript==
// @name         Toolasha-CN
// @namespace    http://tampermonkey.net/
// @version      2.59.7
// @downloadURL  https://greasyfork.org/scripts/580878-toolasha-cn/code/Toolasha-CN.user.js
// @updateURL    https://greasyfork.org/scripts/580878-toolasha-cn/code/Toolasha-CN.meta.js
// @description  Toolasha - Enhanced tools for Milky Way Idle.
// @author       Celasha and Claude, thank you to bot7420, DrDucky, Frotty, Truth_Light, AlphB, qu, and sentientmilk, for providing the basis for a lot of this. Thank you to Miku, Orvel, Jigglymoose, Incinarator, Knerd, and others for their time and help. Thank you to Steez for testing and helping me figure out where I'm wrong! Thank you to Tib for his generous contribution of the Character Cards. Thank you to Sapnas for -deeply- testing and singlehandedly help me improve performance. Special thanks to Zaeter for the name.
// @license      CC-BY-NC-SA-4.0
// @run-at       document-start
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://shykai.github.io/MWICombatSimulatorTest/dist/*
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.2/math.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@3.7.0/dist/chart.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0/dist/chartjs-plugin-datalabels.min.js
// @require      https://UPDATE-THIS-URL/toolasha-core.js
// @require      https://UPDATE-THIS-URL/toolasha-utils.js
// @require      https://UPDATE-THIS-URL/toolasha-market.js
// @require      https://UPDATE-THIS-URL/toolasha-actions.js
// @require      https://UPDATE-THIS-URL/toolasha-combat.js
// @require      https://UPDATE-THIS-URL/toolasha-ui.js
// ==/UserScript==
// Note: Combat Sim auto-import requires Tampermonkey for cross-domain storage. Not available on Steam (use manual clipboard copy/paste instead).


(function () {
    'use strict';

    /**
     * Profile Cache Module
     * Stores current profile in memory for Steam users
     */


    /**
     * Set current profile in memory
     * @param {Object} profileData - Profile data from profile_shared message
     */
    function setCurrentProfile(profileData) {
    }

    /**
     * Centralized IndexedDB Storage
     * Replaces GM storage with IndexedDB for better performance and Chromium compatibility
     * Provides debounced writes to reduce I/O operations
     */

    class Storage {
        constructor() {
            this.db = null;
            this.available = false;
            this.dbName = 'ToolashaDB';
            this.dbVersion = 16; // Bumped for lootLogHistory store
            this.saveDebounceTimers = new Map(); // Per-key debounce timers
            this.pendingWrites = new Map(); // Per-key pending write data: {value, storeName}
            this.SAVE_DEBOUNCE_DELAY = 3000; // 3 seconds
            this._reconnecting = false; // Guard against concurrent reconnection attempts
            this._dbNulledReason = null; // Track why db was last set to null
        }

        /**
         * Initialize the storage system
         * @returns {Promise<boolean>} Success status
         */
        async initialize() {
            try {
                await this.openDatabase();
                this.available = true;
                return true;
            } catch (error) {
                console.error('[Storage] Initialization failed:', error);
                this.available = false;
                return false;
            }
        }

        /**
         * Open IndexedDB database
         * @returns {Promise<void>}
         */
        openDatabase() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = () => {
                    console.error('[Storage] Failed to open IndexedDB', request.error);
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    this._dbNulledReason = null;
                    this._setupDbEventHandlers();
                    resolve();
                };

                request.onblocked = () => {
                    console.warn('[Storage] IndexedDB open blocked by existing connection — retrying after close');
                    this._dbNulledReason = 'onblocked';
                    // Attempt to close any stale connection and retry once
                    if (this.db) {
                        this.db.close();
                        this.db = null;
                    }
                    const retry = indexedDB.open(this.dbName, this.dbVersion);
                    retry.onerror = () => {
                        console.error('[Storage] Retry failed to open IndexedDB', retry.error);
                        reject(retry.error);
                    };
                    retry.onsuccess = () => {
                        this.db = retry.result;
                        this._dbNulledReason = null;
                        this._setupDbEventHandlers();
                        resolve();
                    };
                    retry.onupgradeneeded = request.onupgradeneeded;
                    retry.onblocked = () => {
                        console.error('[Storage] IndexedDB still blocked after retry — DB unavailable');
                        reject(new Error('IndexedDB blocked'));
                    };
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create settings store if it doesn't exist
                    if (!db.objectStoreNames.contains('settings')) {
                        db.createObjectStore('settings');
                    }

                    // Create rerollSpending store if it doesn't exist (for task reroll tracker)
                    if (!db.objectStoreNames.contains('rerollSpending')) {
                        db.createObjectStore('rerollSpending');
                    }

                    // Create dungeonRuns store if it doesn't exist (for dungeon tracker)
                    if (!db.objectStoreNames.contains('dungeonRuns')) {
                        db.createObjectStore('dungeonRuns');
                    }

                    // Create teamRuns store if it doesn't exist (for team-based backfill)
                    if (!db.objectStoreNames.contains('teamRuns')) {
                        db.createObjectStore('teamRuns');
                    }

                    // Create combatExport store if it doesn't exist (for combat sim/milkonomy exports)
                    if (!db.objectStoreNames.contains('combatExport')) {
                        db.createObjectStore('combatExport');
                    }

                    // Create unifiedRuns store if it doesn't exist (for dungeon tracker unified storage)
                    if (!db.objectStoreNames.contains('unifiedRuns')) {
                        db.createObjectStore('unifiedRuns');
                    }

                    // Create marketListings store if it doesn't exist (for estimated listing ages)
                    if (!db.objectStoreNames.contains('marketListings')) {
                        db.createObjectStore('marketListings');
                    }

                    // Create combatStats store if it doesn't exist (for combat statistics feature)
                    if (!db.objectStoreNames.contains('combatStats')) {
                        db.createObjectStore('combatStats');
                    }

                    // Create xpHistory store if it doesn't exist (for XP/hr tracker)
                    if (!db.objectStoreNames.contains('xpHistory')) {
                        db.createObjectStore('xpHistory');
                    }

                    // Create alchemyHistory store if it doesn't exist (for transmute history tracker)
                    if (!db.objectStoreNames.contains('alchemyHistory')) {
                        db.createObjectStore('alchemyHistory');
                    }

                    // Create labyrinth store if it doesn't exist (for labyrinth tracker)
                    if (!db.objectStoreNames.contains('labyrinth')) {
                        db.createObjectStore('labyrinth');
                    }

                    // Create guildHistory store if it doesn't exist (for guild XP tracker)
                    if (!db.objectStoreNames.contains('guildHistory')) {
                        db.createObjectStore('guildHistory');
                    }

                    // Create networthHistory store if it doesn't exist (for networth chart)
                    if (!db.objectStoreNames.contains('networthHistory')) {
                        db.createObjectStore('networthHistory');
                    }

                    // Create collections store if it doesn't exist (for collection filters feature)
                    if (!db.objectStoreNames.contains('collections')) {
                        db.createObjectStore('collections');
                    }

                    // Create queueSnapshots store if it doesn't exist (for cross-character queue monitor)
                    if (!db.objectStoreNames.contains('queueSnapshots')) {
                        db.createObjectStore('queueSnapshots');
                    }

                    // Create lootLogHistory store if it doesn't exist (for extended loot log)
                    if (!db.objectStoreNames.contains('lootLogHistory')) {
                        db.createObjectStore('lootLogHistory');
                    }
                };
            });
        }

        /**
         * Get a value from storage
         * @param {string} key - Storage key
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {Promise<*>} The stored value or default
         */
        async get(key, storeName = 'settings', defaultValue = null) {
            if (!this.db) {
                console.warn(`[Storage] Database not available, returning default for key: ${key}`);
                return defaultValue;
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.get(key);

                    request.onsuccess = () => {
                        resolve(request.result !== undefined ? request.result : defaultValue);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to get key ${key}:`, request.error);
                        resolve(defaultValue);
                    };
                } catch (error) {
                    console.error(`[Storage] Get transaction failed for key ${key}:`, error);
                    resolve(defaultValue);
                }
            });
        }

        /**
         * Set a value in storage (debounced by default)
         * @param {string} key - Storage key
         * @param {*} value - Value to store
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {boolean} immediate - If true, save immediately without debouncing
         * @returns {Promise<boolean>} Success status
         */
        async set(key, value, storeName = 'settings', immediate = false) {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot save key: ${key}`);
                return false;
            }

            if (immediate) {
                return this._saveToIndexedDB(key, value, storeName);
            } else {
                return this._debouncedSave(key, value, storeName);
            }
        }

        /**
         * Internal: Save to IndexedDB (immediate)
         * @private
         */
        async _saveToIndexedDB(key, value, storeName) {
            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.put(value, key);

                    request.onsuccess = () => {
                        resolve(true);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to save key ${key}:`, request.error);
                        resolve(false);
                    };
                } catch (error) {
                    console.error(`[Storage] Save transaction failed for key ${key}:`, error);
                    resolve(false);
                }
            });
        }

        /**
         * Internal: Debounced save
         * @private
         */
        _debouncedSave(key, value, storeName) {
            const timerKey = `${storeName}:${key}`;

            // Store pending write data
            this.pendingWrites.set(timerKey, { value, storeName });

            // Clear existing timer for this key
            if (this.saveDebounceTimers.has(timerKey)) {
                clearTimeout(this.saveDebounceTimers.get(timerKey));
            }

            // Return a promise that resolves when save completes
            return new Promise((resolve) => {
                const timer = setTimeout(async () => {
                    const pending = this.pendingWrites.get(timerKey);
                    if (pending) {
                        const success = await this._saveToIndexedDB(key, pending.value, pending.storeName);
                        this.pendingWrites.delete(timerKey);
                        this.saveDebounceTimers.delete(timerKey);
                        resolve(success);
                    } else {
                        resolve(false);
                    }
                }, this.SAVE_DEBOUNCE_DELAY);

                this.saveDebounceTimers.set(timerKey, timer);
            });
        }

        /**
         * Get a JSON object from storage
         * @param {string} key - Storage key
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {Promise<*>} The parsed object or default
         */
        async getJSON(key, storeName = 'settings', defaultValue = null) {
            const raw = await this.get(key, storeName, null);

            if (raw === null) {
                return defaultValue;
            }

            // If it's already an object, return it
            if (typeof raw === 'object') {
                return raw;
            }

            // Otherwise, try to parse as JSON string
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.error(`[Storage] Error parsing JSON from storage (key: ${key}):`, error);
                return defaultValue;
            }
        }

        /**
         * Set a JSON object in storage
         * @param {string} key - Storage key
         * @param {*} value - Object to store
         * @param {string} storeName - Object store name (default: 'settings')
         * @param {boolean} immediate - If true, save immediately
         * @returns {Promise<boolean>} Success status
         */
        async setJSON(key, value, storeName = 'settings', immediate = false) {
            // IndexedDB can store objects directly, no need to stringify
            return this.set(key, value, storeName, immediate);
        }

        /**
         * Delete a key from storage
         * @param {string} key - Storage key to delete
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<boolean>} Success status
         */
        async delete(key, storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot delete key: ${key}`);
                return false;
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.delete(key);

                    request.onsuccess = () => {
                        resolve(true);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to delete key ${key}:`, request.error);
                        resolve(false);
                    };
                } catch (error) {
                    console.error(`[Storage] Delete transaction failed for key ${key}:`, error);
                    resolve(false);
                }
            });
        }

        /**
         * Check if a key exists in storage
         * @param {string} key - Storage key to check
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<boolean>} True if key exists
         */
        async has(key, storeName = 'settings') {
            if (!this.db) {
                return false;
            }

            const value = await this.get(key, storeName, '__STORAGE_CHECK__');
            return value !== '__STORAGE_CHECK__';
        }

        /**
         * Get all keys from a store
         * @param {string} storeName - Object store name (default: 'settings')
         * @returns {Promise<Array<string>>} Array of keys
         */
        async getAllKeys(storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot get keys from store: ${storeName}`);
                return [];
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const request = store.getAllKeys();

                    request.onsuccess = () => {
                        resolve(request.result || []);
                    };

                    request.onerror = () => {
                        console.error(`[Storage] Failed to get all keys from ${storeName}:`, request.error);
                        resolve([]);
                    };
                } catch (error) {
                    console.error(`[Storage] GetAllKeys transaction failed for store ${storeName}:`, error);
                    resolve([]);
                }
            });
        }

        /**
         * Get all key-value pairs from an object store
         * @param {string} storeName - Object store name
         * @returns {Promise<Object>} Map of key → value
         */
        async getAll(storeName = 'settings') {
            if (!this.db) {
                console.warn(`[Storage] Database not available, cannot get all from store: ${storeName}`);
                return {};
            }

            return new Promise((resolve, _reject) => {
                try {
                    const transaction = this.db.transaction([storeName], 'readonly');
                    const store = transaction.objectStore(storeName);
                    const result = {};
                    const cursorRequest = store.openCursor();

                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            result[cursor.key] = cursor.value;
                            cursor.continue();
                        } else {
                            resolve(result);
                        }
                    };

                    cursorRequest.onerror = () => {
                        console.error(`[Storage] Failed to get all from ${storeName}:`, cursorRequest.error);
                        resolve({});
                    };
                } catch (error) {
                    console.error(`[Storage] GetAll transaction failed for store ${storeName}:`, error);
                    resolve({});
                }
            });
        }

        /**
         * Force immediate save of all pending debounced writes
         */
        async flushAll() {
            // Clear all timers first
            for (const timer of this.saveDebounceTimers.values()) {
                if (timer) {
                    clearTimeout(timer);
                }
            }
            this.saveDebounceTimers.clear();

            // Now execute all pending writes immediately
            const writes = Array.from(this.pendingWrites.entries());
            for (const [timerKey, pending] of writes) {
                // Extract actual key from timerKey (format: "storeName:key")
                const colonIndex = timerKey.indexOf(':');
                const storeName = timerKey.substring(0, colonIndex);
                const key = timerKey.substring(colonIndex + 1); // Handle keys with colons

                await this._saveToIndexedDB(key, pending.value, storeName);
            }
            this.pendingWrites.clear();
        }

        /**
         * Cleanup pending debounced writes without flushing
         */
        cleanupPendingWrites() {
            for (const timer of this.saveDebounceTimers.values()) {
                if (timer) {
                    clearTimeout(timer);
                }
            }
            this.saveDebounceTimers.clear();
            this.pendingWrites.clear();
        }

        /**
         * Set up event handlers on the active DB connection.
         * @private
         */
        _setupDbEventHandlers() {
            if (!this.db) return;

            this.db.onversionchange = () => {
                console.warn('[Storage] DB connection lost: onversionchange fired (another tab/instance upgraded the DB)');
                this._dbNulledReason = 'onversionchange';
                this.db.close();
                this.db = null;
                this._reconnect();
            };

            this.db.onclose = () => {
                console.warn('[Storage] DB connection lost: onclose fired (connection dropped unexpectedly)');
                this._dbNulledReason = 'onclose';
                this.db = null;
                this._reconnect();
            };
        }

        /**
         * Attempt to reconnect to IndexedDB after the connection is lost.
         * @private
         */
        async _reconnect() {
            if (this._reconnecting) return;
            this._reconnecting = true;

            // Wait a brief moment for any version upgrade to complete
            await new Promise((r) => setTimeout(r, 500));

            try {
                await this.openDatabase();
                this.available = true;
                console.log('[Storage] Successfully reconnected to IndexedDB');
            } catch (error) {
                console.error('[Storage] Reconnection failed:', error);
                this.available = false;
            } finally {
                this._reconnecting = false;
            }
        }

        /**
         * Return diagnostic info about current storage state.
         * @returns {Object}
         */
        diagnostics() {
            return {
                dbExists: this.db !== null,
                available: this.available,
                dbName: this.dbName,
                dbVersion: this.dbVersion,
                reconnecting: this._reconnecting,
                lastNullReason: this._dbNulledReason,
                pendingWrites: this.pendingWrites.size,
                activeTimers: this.saveDebounceTimers.size,
            };
        }
    }

    const storage$1 = new Storage();

    /**
     * WebSocket Hook Module
     * Intercepts WebSocket messages from the MWI game server
     *
     * Uses WebSocket constructor wrapper for better performance than MessageEvent.prototype.data hooking
     */


    class WebSocketHook {
        constructor() {
            this.isHooked = false;
            this.messageHandlers = new Map();
            this.socketEventHandlers = new Map();
            this.attachedSockets = new WeakSet();
            /**
             * Track processed message events to avoid duplicate handling when multiple hooks fire.
             *
             * We intercept messages through three paths:
             * 1) MessageEvent.prototype.data getter
             * 2) WebSocket.prototype addEventListener/onmessage wrappers
             * 3) Direct socket listeners in attachSocketListeners
             */
            this.processedMessageEvents = new WeakSet();

            /**
             * Track processed messages by content hash to prevent duplicate JSON.parse
             * Uses message content (first 100 chars) as key since same message can have different event objects
             */
            this.processedMessages = new Map(); // message hash -> timestamp
            this.recentActionCompleted = new Map(); // message content -> timestamp (50ms TTL dedup)
            this.messageCleanupInterval = null;
            this.isSocketWrapped = false;
            this.originalWebSocket = null;
            this.currentWebSocket = null;
            this.clientDataRetryTimeout = null;
        }

        /**
         * Install the WebSocket hook
         * MUST be called before WebSocket connection is established
         * Uses MessageEvent.prototype.data hook (same method as MWI Tools)
         */
        install() {
            if (this.isHooked) {
                console.warn('[WebSocket Hook] Already installed');
                return;
            }

            this.wrapWebSocketConstructor();
            this.wrapWebSocketPrototype();

            // Capture hook instance for closure
            const hookInstance = this;

            // Hook MessageEvent.prototype.data on the PAGE's prototype (via unsafeWindow)
            // Using the sandbox's MessageEvent fails when Tampermonkey isolates prototypes
            const pageMessageEvent = typeof unsafeWindow !== 'undefined' ? unsafeWindow.MessageEvent : MessageEvent;
            const dataProperty = Object.getOwnPropertyDescriptor(pageMessageEvent.prototype, 'data');
            const originalGet = dataProperty.get;

            dataProperty.get = function hookedGet() {
                const socket = this.currentTarget;

                // Only hook MWI game server (URL check handles non-WebSocket events safely)
                if (!hookInstance.isGameSocket(socket)) {
                    return originalGet.call(this);
                }

                // Already processed — pass through without re-processing
                if (hookInstance.isMessageEventProcessed(this)) {
                    return originalGet.call(this);
                }

                hookInstance.attachSocketListeners(socket);

                const message = originalGet.call(this);

                hookInstance.markMessageEventProcessed(this);
                hookInstance.processMessage(message);

                return message;
            };

            Object.defineProperty(pageMessageEvent.prototype, 'data', dataProperty);

            this.isHooked = true;
        }

        /**
         * Wrap WebSocket prototype handlers to intercept message events
         */
        wrapWebSocketPrototype() {
            const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (typeof targetWindow === 'undefined' || !targetWindow.WebSocket || !targetWindow.WebSocket.prototype) {
                return;
            }

            const hookInstance = this;
            const proto = targetWindow.WebSocket.prototype;

            if (!proto.__toolashaPatched) {
                const originalAddEventListener = proto.addEventListener;
                proto.addEventListener = function toolashaAddEventListener(type, listener, options) {
                    if (type === 'message' && typeof listener === 'function') {
                        const wrappedListener = function toolashaMessageListener(event) {
                            if (!hookInstance.isMessageEventProcessed(event) && typeof event?.data === 'string') {
                                hookInstance.markMessageEventProcessed(event);
                                hookInstance.processMessage(event.data);
                            }
                            return listener.call(this, event);
                        };

                        wrappedListener.__toolashaOriginal = listener;
                        return originalAddEventListener.call(this, type, wrappedListener, options);
                    }

                    return originalAddEventListener.call(this, type, listener, options);
                };

                const originalOnMessage = Object.getOwnPropertyDescriptor(proto, 'onmessage');
                if (originalOnMessage && originalOnMessage.set) {
                    Object.defineProperty(proto, 'onmessage', {
                        configurable: true,
                        get: originalOnMessage.get,
                        set(handler) {
                            if (typeof handler !== 'function') {
                                return originalOnMessage.set.call(this, handler);
                            }

                            const wrappedHandler = function toolashaOnMessage(event) {
                                if (!hookInstance.isMessageEventProcessed(event) && typeof event?.data === 'string') {
                                    hookInstance.markMessageEventProcessed(event);
                                    hookInstance.processMessage(event.data);
                                }
                                return handler.call(this, event);
                            };

                            wrappedHandler.__toolashaOriginal = handler;
                            return originalOnMessage.set.call(this, wrappedHandler);
                        },
                    });
                }

                proto.__toolashaPatched = true;
            }
        }

        /**
         * Check if a WebSocket instance belongs to the game server
         * @param {WebSocket} socket - WebSocket instance
         * @returns {boolean} True if game socket
         */
        isGameSocket(socket) {
            if (!socket || !socket.url) {
                return false;
            }

            return (
                socket.url.indexOf('api.milkywayidle.com/ws') !== -1 ||
                socket.url.indexOf('api-test.milkywayidle.com/ws') !== -1
            );
        }

        /**
         * Wrap the WebSocket constructor to attach lifecycle listeners
         */
        wrapWebSocketConstructor() {
            if (this.isSocketWrapped) {
                return;
            }

            const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (typeof targetWindow === 'undefined' || !targetWindow.WebSocket) {
                return;
            }

            const hookInstance = this;

            const wrapConstructor = (OriginalWebSocket) => {
                if (!OriginalWebSocket || OriginalWebSocket.__toolashaWrapped) {
                    hookInstance.currentWebSocket = OriginalWebSocket;
                    return;
                }

                // Only subclass native WebSocket constructors. Third-party wrappers
                // (other userscripts replacing window.WebSocket) are passed through
                // as-is — Toolasha still intercepts via MessageEvent.data hook and
                // WebSocket.prototype patches.
                const isNative = /\[native code\]/.test(Function.prototype.toString.call(OriginalWebSocket));
                if (!isNative) {
                    hookInstance.currentWebSocket = OriginalWebSocket;
                    return;
                }

                class ToolashaWebSocket extends OriginalWebSocket {
                    constructor(...args) {
                        super(...args);
                        hookInstance.attachSocketListeners(this);
                    }
                }

                ToolashaWebSocket.__toolashaWrapped = true;
                ToolashaWebSocket.__toolashaOriginal = OriginalWebSocket;

                hookInstance.originalWebSocket = OriginalWebSocket;
                hookInstance.currentWebSocket = ToolashaWebSocket;
            };

            wrapConstructor(targetWindow.WebSocket);

            Object.defineProperty(targetWindow, 'WebSocket', {
                configurable: true,
                get() {
                    return hookInstance.currentWebSocket;
                },
                set(nextWebSocket) {
                    wrapConstructor(nextWebSocket);
                },
            });
            this.isSocketWrapped = true;
        }

        /**
         * Attach lifecycle listeners to a socket
         * @param {WebSocket} socket - WebSocket instance
         */
        attachSocketListeners(socket) {
            if (!this.isGameSocket(socket)) {
                return;
            }

            if (this.attachedSockets.has(socket)) {
                return;
            }

            this.attachedSockets.add(socket);

            const events = ['open', 'close', 'error'];
            for (const eventName of events) {
                socket.addEventListener(eventName, (event) => {
                    this.emitSocketEvent(eventName, event, socket);
                });
            }

            socket.addEventListener('message', (event) => {
                if (this.isMessageEventProcessed(event)) {
                    return;
                }

                if (!event || typeof event.data !== 'string') {
                    return;
                }

                this.markMessageEventProcessed(event);
                this.processMessage(event.data);
            });
        }

        isMessageEventProcessed(event) {
            if (!event || typeof event !== 'object') {
                return false;
            }

            return this.processedMessageEvents.has(event);
        }

        markMessageEventProcessed(event) {
            if (!event || typeof event !== 'object') {
                return;
            }

            this.processedMessageEvents.add(event);
        }

        /**
         * Process intercepted message
         * @param {string} message - JSON string from WebSocket
         */
        processMessage(message) {
            // Parse message type first to determine deduplication strategy
            let messageType;
            try {
                // Quick parse to get type (avoid full parse for duplicates)
                const typeMatch = message.match(/"type":"([^"]+)"/);
                messageType = typeMatch ? typeMatch[1] : null;
            } catch {
                // If regex fails, skip deduplication and process normally
                messageType = null;
            }

            // Skip deduplication for events where consecutive messages have similar first 100 chars
            // but contain different data (counts, timestamps, etc. beyond the 100-char hash window)
            // OR events that should always trigger UI updates (profile_shared, battle_unit_fetched)
            const skipDedup =
                messageType === 'quests_updated' ||
                messageType === 'action_completed' ||
                messageType === 'actions_updated' ||
                messageType === 'items_updated' ||
                messageType === 'market_item_order_books_updated' ||
                messageType === 'market_listings_updated' ||
                messageType === 'profile_shared' ||
                messageType === 'battle_consumable_ability_updated' ||
                messageType === 'battle_unit_fetched' ||
                messageType === 'action_type_consumable_slots_updated' ||
                messageType === 'consumable_buffs_updated' ||
                messageType === 'character_info_updated' ||
                messageType === 'labyrinth_updated' ||
                messageType === 'loadouts_updated' ||
                messageType === 'setting_updated' ||
                messageType === 'labyrinth_room_progress';

            if (!skipDedup) {
                // Deduplicate by message content to prevent 4x JSON.parse on same message
                // Use first 100 chars as hash (contains type + timestamp, unique enough)
                const messageHash = message.substring(0, 100);

                if (this.processedMessages.has(messageHash)) {
                    return; // Already processed this message, skip
                }

                this.processedMessages.set(messageHash, Date.now());

                // Cleanup old entries every 100 messages to prevent memory leak
                if (this.processedMessages.size > 100) {
                    this.cleanupProcessedMessages();
                }
            } else if (messageType === 'action_completed') {
                // action_completed bypasses the content-hash dedup (Gabriel's fix, commit 1007215)
                // but the WebSocket prototype wrapper can fire two listeners for the same physical
                // message object. The WeakSet guard catches same-object duplicates, but if two
                // independent listeners each receive a distinct MessageEvent wrapping the same
                // payload, both pass the WeakSet check and processMessage is called twice.
                // Use a short 50ms TTL keyed on full message content to collapse these duplicates.
                // Two genuine consecutive action_completed messages are always seconds apart.
                const now = Date.now();
                if (this.recentActionCompleted.has(message)) {
                    return; // Duplicate from second listener — skip
                }
                this.recentActionCompleted.set(message, now);
                // Prune entries older than 50ms to keep memory bounded
                for (const [key, ts] of this.recentActionCompleted) {
                    if (now - ts > 50) {
                        this.recentActionCompleted.delete(key);
                    }
                }
            }

            try {
                const data = JSON.parse(message);
                const parsedMessageType = data.type;

                // Save critical data to GM storage for Combat Sim export
                this.saveCombatSimData(parsedMessageType, message);

                // Call registered handlers for this message type
                const handlers = this.messageHandlers.get(parsedMessageType) || [];

                for (const handler of handlers) {
                    try {
                        const result = handler(data);
                        if (result instanceof Promise) {
                            result.catch((error) => {
                                console.error(`[WebSocket] Async handler error for ${parsedMessageType}:`, error);
                            });
                        }
                    } catch (error) {
                        console.error(`[WebSocket] Handler error for ${parsedMessageType}:`, error);
                    }
                }

                // Call wildcard handlers (receive all messages)
                const wildcardHandlers = this.messageHandlers.get('*') || [];
                for (const handler of wildcardHandlers) {
                    try {
                        const result = handler(data);
                        if (result instanceof Promise) {
                            result.catch((error) => {
                                console.error('[WebSocket] Async wildcard handler error:', error);
                            });
                        }
                    } catch (error) {
                        console.error('[WebSocket] Wildcard handler error:', error);
                    }
                }
            } catch (error) {
                console.error('[WebSocket] Failed to process message:', error);
            }
        }

        /**
         * Save combat sim data for export (cross-domain via GM storage + IndexedDB).
         * Character/client/battle data is saved to GM storage so the Shykai sim page can read it.
         * Profile shares are saved to IndexedDB for cross-session persistence.
         * @param {string} messageType - Message type
         * @param {string} message - Raw message JSON string
         */
        async saveCombatSimData(messageType, message) {
            const hasGM = typeof GM_setValue !== 'undefined';
            try {
                // Save character/client/battle data to GM storage for cross-domain Shykai access
                if (hasGM && messageType === 'init_character_data') {
                    setTimeout(() => {
                        try {
                            GM_setValue('toolasha_init_character_data', message);
                        } catch {
                            /* ignore */
                        }
                    }, 0);
                } else if (hasGM && messageType === 'init_client_data') {
                    setTimeout(() => {
                        try {
                            GM_setValue('toolasha_init_client_data', message);
                        } catch {
                            /* ignore */
                        }
                    }, 0);
                } else if (hasGM && messageType === 'new_battle') {
                    setTimeout(() => {
                        try {
                            GM_setValue('toolasha_new_battle', message);
                        } catch {
                            /* ignore */
                        }
                    }, 0);
                }

                // Save profile shares (when opening party member profiles)
                if (messageType === 'profile_shared') {
                    const parsed = JSON.parse(message);

                    // Extract character info - try multiple sources for ID
                    parsed.characterID =
                        parsed.profile.sharableCharacter?.id ||
                        parsed.profile.characterSkills?.[0]?.characterID ||
                        parsed.profile.character?.id;
                    parsed.characterName = parsed.profile.sharableCharacter?.name || 'Unknown';
                    parsed.timestamp = Date.now();

                    // Validate we got a character ID
                    if (!parsed.characterID) {
                        console.error('[Toolasha] Failed to extract characterID from profile:', parsed);
                        return;
                    }

                    // Store in memory for Steam users (works without GM storage)
                    setCurrentProfile(parsed);

                    // Load existing profile list from IndexedDB
                    let profileList = (await storage$1.getJSON('profile_list', 'combatExport', null)) || [];

                    // Remove old entry for same character
                    profileList = profileList.filter((p) => p.characterID !== parsed.characterID);

                    // Add to front of list
                    profileList.unshift(parsed);

                    // Keep only last 20 profiles
                    if (profileList.length > 20) {
                        profileList.pop();
                    }

                    // Save updated profile list to IndexedDB (cross-session) and GM storage (cross-domain for Shykai)
                    await storage$1.setJSON('profile_list', profileList, 'combatExport', true);
                    if (hasGM) {
                        try {
                            GM_setValue('toolasha_profile_list', JSON.stringify(profileList));
                        } catch {
                            /* ignore */
                        }
                    }
                }
            } catch (error) {
                console.error('[WebSocket] Failed to save Combat Sim data:', error);
            }
        }

        /**
         * Capture init_client_data from localStorage (fallback method)
         * Called periodically since it may not come through WebSocket
         * Uses official game API to avoid manual decompression
         */
        async captureClientDataFromLocalStorage() {
            try {
                // Use official game API instead of manual localStorage access
                if (typeof localStorageUtil === 'undefined' || typeof localStorageUtil.getInitClientData !== 'function') {
                    // API not ready yet, retry
                    this.scheduleClientDataRetry();
                    return;
                }

                // API returns parsed object and handles decompression automatically
                const clientDataObj = localStorageUtil.getInitClientData();
                if (!clientDataObj || Object.keys(clientDataObj).length === 0) {
                    // Data not available yet, retry
                    this.scheduleClientDataRetry();
                    return;
                }

                // Verify it's init_client_data
                if (clientDataObj?.type === 'init_client_data') {
                    this.clearClientDataRetry();
                }
            } catch (error) {
                console.error('[WebSocket] Failed to capture client data from localStorage:', error);
                // Retry on error
                this.scheduleClientDataRetry();
            }
        }

        /**
         * Schedule a retry for client data capture
         */
        scheduleClientDataRetry() {
            this.clearClientDataRetry();
            this.clientDataRetryTimeout = setTimeout(() => this.captureClientDataFromLocalStorage(), 2000);
        }

        /**
         * Clear any pending client data retry
         */
        clearClientDataRetry() {
            if (this.clientDataRetryTimeout) {
                clearTimeout(this.clientDataRetryTimeout);
                this.clientDataRetryTimeout = null;
            }
        }

        /**
         * Cleanup old processed message entries (keep last 50, remove rest)
         */
        cleanupProcessedMessages() {
            const entries = Array.from(this.processedMessages.entries());
            // Sort by timestamp, keep newest 50
            entries.sort((a, b) => b[1] - a[1]);

            this.processedMessages.clear();
            for (let i = 0; i < Math.min(50, entries.length); i++) {
                this.processedMessages.set(entries[i][0], entries[i][1]);
            }
        }

        /**
         * Cleanup any pending retry timeouts
         */
        cleanup() {
            this.clearClientDataRetry();
            this.processedMessages.clear();
        }

        /**
         * Register a handler for a specific message type
         * @param {string} messageType - Message type to handle (e.g., "init_character_data")
         * @param {Function} handler - Function to call when message received
         */
        on(messageType, handler) {
            if (!this.messageHandlers.has(messageType)) {
                this.messageHandlers.set(messageType, []);
            }
            const handlers = this.messageHandlers.get(messageType);
            if (!handlers.includes(handler)) {
                handlers.push(handler);
            }
        }

        /**
         * Register a handler for WebSocket lifecycle events
         * @param {string} eventType - Event type (open, close, error)
         * @param {Function} handler - Handler function
         */
        onSocketEvent(eventType, handler) {
            if (!this.socketEventHandlers.has(eventType)) {
                this.socketEventHandlers.set(eventType, []);
            }
            this.socketEventHandlers.get(eventType).push(handler);
        }

        /**
         * Unregister a handler
         * @param {string} messageType - Message type
         * @param {Function} handler - Handler function to remove
         */
        off(messageType, handler) {
            const handlers = this.messageHandlers.get(messageType);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }

        /**
         * Unregister a WebSocket lifecycle handler
         * @param {string} eventType - Event type
         * @param {Function} handler - Handler function
         */
        offSocketEvent(eventType, handler) {
            const handlers = this.socketEventHandlers.get(eventType);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }

        emitSocketEvent(eventType, event, socket) {
            const handlers = this.socketEventHandlers.get(eventType) || [];
            for (const handler of handlers) {
                try {
                    handler(event, socket);
                } catch (error) {
                    console.error(`[WebSocket] ${eventType} handler error:`, error);
                }
            }
        }
    }

    const webSocketHook$1 = new WebSocketHook();

    const CONNECTION_STATES = {
        CONNECTED: 'connected',
        DISCONNECTED: 'disconnected',
        RECONNECTING: 'reconnecting',
    };

    class ConnectionState {
        constructor() {
            this.state = CONNECTION_STATES.RECONNECTING;
            this.eventListeners = new Map();
            this.lastDisconnectedAt = null;
            this.lastConnectedAt = null;

            this.setupListeners();
        }

        /**
         * Get current connection state
         * @returns {string} Connection state (connected, disconnected, reconnecting)
         */
        getState() {
            return this.state;
        }

        /**
         * Check if currently connected
         * @returns {boolean} True if connected
         */
        isConnected() {
            return this.state === CONNECTION_STATES.CONNECTED;
        }

        /**
         * Register a listener for connection events
         * @param {string} event - Event name (disconnected, reconnected)
         * @param {Function} callback - Handler function
         */
        on(event, callback) {
            if (!this.eventListeners.has(event)) {
                this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(callback);
        }

        /**
         * Unregister a connection event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function to remove
         */
        off(event, callback) {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }

        /**
         * Notify connection state from character initialization
         * @param {Object} data - Character initialization payload
         */
        handleCharacterInitialized(data) {
            if (!data) {
                return;
            }

            this.setConnected('character_initialized');
        }

        setupListeners() {
            webSocketHook$1.onSocketEvent('open', () => {
                this.setReconnecting('socket_open', { allowConnected: true });
            });

            webSocketHook$1.onSocketEvent('close', (event) => {
                this.setDisconnected('socket_close', event);
            });

            webSocketHook$1.onSocketEvent('error', (event) => {
                this.setDisconnected('socket_error', event);
            });

            webSocketHook$1.on('init_character_data', () => {
                this.setConnected('init_character_data');
            });
        }

        setReconnecting(reason, options = {}) {
            if (this.state === CONNECTION_STATES.CONNECTED && !options.allowConnected) {
                return;
            }

            this.updateState(CONNECTION_STATES.RECONNECTING, {
                reason,
            });
        }

        setDisconnected(reason, event) {
            if (this.state === CONNECTION_STATES.DISCONNECTED) {
                return;
            }

            this.lastDisconnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.DISCONNECTED, {
                reason,
                event,
                disconnectedAt: this.lastDisconnectedAt,
            });
        }

        setConnected(reason) {
            if (this.state === CONNECTION_STATES.CONNECTED) {
                return;
            }

            this.lastConnectedAt = Date.now();
            this.updateState(CONNECTION_STATES.CONNECTED, {
                reason,
                disconnectedAt: this.lastDisconnectedAt,
                connectedAt: this.lastConnectedAt,
            });
        }

        updateState(nextState, details) {
            if (this.state === nextState) {
                return;
            }

            const previousState = this.state;
            this.state = nextState;

            if (nextState === CONNECTION_STATES.DISCONNECTED) {
                this.emit('disconnected', {
                    previousState,
                    ...details,
                });
                return;
            }

            if (nextState === CONNECTION_STATES.CONNECTED) {
                this.emit('reconnected', {
                    previousState,
                    ...details,
                });
            }
        }

        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];
            for (const listener of listeners) {
                try {
                    listener(data);
                } catch (error) {
                    console.error('[ConnectionState] Listener error:', error);
                }
            }
        }
    }

    const connectionState = new ConnectionState();

    /**
     * Merge market listing updates into the current list.
     * @param {Array} currentListings - Existing market listings.
     * @param {Array} updatedListings - Updated listings from WebSocket.
     * @returns {Array} New merged listings array.
     */
    const mergeMarketListings = (currentListings = [], updatedListings = []) => {
        const safeCurrent = Array.isArray(currentListings) ? currentListings : [];
        const safeUpdates = Array.isArray(updatedListings) ? updatedListings : [];

        if (safeUpdates.length === 0) {
            return [...safeCurrent];
        }

        const indexById = new Map();
        safeCurrent.forEach((listing, index) => {
            if (!listing || listing.id === undefined || listing.id === null) {
                return;
            }
            indexById.set(listing.id, index);
        });

        const merged = [...safeCurrent];

        for (const listing of safeUpdates) {
            if (!listing || listing.id === undefined || listing.id === null) {
                continue;
            }

            const existingIndex = indexById.get(listing.id);
            if (existingIndex !== undefined) {
                merged[existingIndex] = listing;
            } else {
                merged.push(listing);
            }
        }

        // Remove dead listings: cancelled/expired immediately, filled once fully claimed
        return merged.filter((listing) => {
            if (!listing) return false;
            if (
                listing.status === '/market_listing_status/cancelled' ||
                listing.status === '/market_listing_status/expired'
            ) {
                return false;
            }
            if (
                listing.status === '/market_listing_status/filled' &&
                (listing.unclaimedItemCount || 0) === 0 &&
                (listing.unclaimedCoinCount || 0) === 0
            ) {
                return false;
            }
            return true;
        });
    };

    /**
     * Scroll Buff Values
     * Hardcoded buff definitions for Labyrinth scrolls (formerly "Seals").
     * The game JSON has no consumableDetail for scroll items — values sourced from item descriptions.
     */

    const SCROLL_BUFF_VALUES = {
        '/buff_types/efficiency': 0.14,
        '/buff_types/gathering': 0.18,
        '/buff_types/wisdom': 0.2,
        '/buff_types/action_speed': 0.15,
        '/buff_types/rare_find': 0.6,
        '/buff_types/processing': 0.2,
        '/buff_types/gourmet': 0.16,
    };

    /**
     * Data Manager Module
     * Central hub for accessing game data
     *
     * Uses official API: localStorageUtil.getInitClientData()
     * Listens to WebSocket messages for player data updates
     */


    class DataManager {
        constructor() {
            this.webSocketHook = webSocketHook$1;

            // Static game data (items, actions, monsters, abilities, etc.)
            this.initClientData = null;

            // Player data (updated via WebSocket)
            this.characterData = null;
            this.characterSkills = null;
            this.characterItems = null;
            this.characterActions = [];
            this.characterQuests = []; // Active quests including tasks
            this.characterEquipment = new Map();
            this.characterHouseRooms = new Map(); // House room HRID -> {houseRoomHrid, level}
            this.actionTypeDrinkSlotsMap = new Map(); // Action type HRID -> array of drink items
            this.monsterSortIndexMap = new Map(); // Monster HRID -> combat zone sortIndex
            this.bossMonsterHrids = new Set(); // Monster HRIDs that appear in bossSpawns
            this.battleData = null; // Current battle data (for Combat Sim export on Steam)

            // Character tracking for switch detection
            this.currentCharacterId = null;
            this.currentCharacterName = null;
            this.currentCharacterGameMode = null;
            this.isCharacterSwitching = false;
            this.lastCharacterSwitchTime = 0; // Prevent rapid-fire switch loops

            // Event listeners
            this.eventListeners = new Map();

            // Achievement buff cache (action type → buff type → flat boost)
            this.achievementBuffCache = {
                source: null,
                byActionType: new Map(),
            };

            // Personal buffs from seals (personal_buffs_updated WebSocket message)
            this.personalActionTypeBuffsMap = {};

            // Per-action-type scroll simulation (Set of buffTypeHrids to simulate)
            this.scrollSimulationByActionType = {};

            // Retry interval for loading static game data
            this.loadRetryInterval = null;
            this.fallbackInterval = null;

            // Setup WebSocket message handlers
            this.setupMessageHandlers();
        }

        /**
         * Initialize the Data Manager
         * Call this after game loads (or immediately - will retry if needed)
         */
        initialize() {
            this.cleanupIntervals();

            // Try to load static game data using official API
            const success = this.tryLoadStaticData();

            // If failed, set up retry polling
            if (!success && !this.loadRetryInterval) {
                this.loadRetryInterval = setInterval(() => {
                    if (this.tryLoadStaticData()) {
                        this.cleanupIntervals();
                    }
                }, 500); // Retry every 500ms
            }

            // FALLBACK: Continuous polling for missed init_character_data (should not be needed with @run-at document-start)
            // Extended timeout for slower connections/computers (Steam, etc.)
            let fallbackAttempts = 0;
            const maxAttempts = 60; // Poll for up to 30 seconds (60 × 500ms)

            const stopFallbackInterval = () => {
                if (this.fallbackInterval) {
                    clearInterval(this.fallbackInterval);
                    this.fallbackInterval = null;
                }
            };

            this.fallbackInterval = setInterval(() => {
                fallbackAttempts++;

                // Stop if character data received via WebSocket
                if (this.characterData) {
                    stopFallbackInterval();
                    return;
                }

                // Give up after max attempts
                if (fallbackAttempts >= maxAttempts) {
                    console.error(
                        '[DataManager] Character data not received after 30 seconds. WebSocket hook may have failed.'
                    );
                    stopFallbackInterval();
                }
            }, 500); // Check every 500ms
        }

        /**
         * Cleanup polling intervals
         */
        cleanupIntervals() {
            if (this.loadRetryInterval) {
                clearInterval(this.loadRetryInterval);
                this.loadRetryInterval = null;
            }

            if (this.fallbackInterval) {
                clearInterval(this.fallbackInterval);
                this.fallbackInterval = null;
            }
        }

        /**
         * Attempt to load static game data
         * @returns {boolean} True if successful, false if needs retry
         * @private
         */
        tryLoadStaticData() {
            try {
                if (typeof localStorageUtil !== 'undefined' && typeof localStorageUtil.getInitClientData === 'function') {
                    const data = localStorageUtil.getInitClientData();
                    if (data && Object.keys(data).length > 0) {
                        this.initClientData = data;

                        // Build monster sort index map for task sorting
                        this.buildMonsterSortIndexMap();

                        return true;
                    }
                }
                return false;
            } catch (error) {
                console.error('[Data Manager] Failed to load init_client_data:', error);
                return false;
            }
        }

        /**
         * Setup WebSocket message handlers
         * Listens for game data updates
         */
        setupMessageHandlers() {
            // Handle init_character_data (player data on login/refresh)
            this.webSocketHook.on('init_character_data', async (data) => {
                // Detect character switch
                const newCharacterId = data.character?.id;
                const newCharacterName = data.character?.name;

                // Validate character data before processing
                if (!newCharacterId || !newCharacterName) {
                    console.error('[DataManager] Invalid character data received:', {
                        hasCharacter: !!data.character,
                        hasId: !!newCharacterId,
                        hasName: !!newCharacterName,
                    });
                    return; // Don't process invalid character data
                }

                // Track whether this is a character switch or first load
                let isCharacterSwitch = false;

                // Check if this is a character switch (not first load)
                if (this.currentCharacterId && this.currentCharacterId !== newCharacterId) {
                    isCharacterSwitch = true;
                    // Prevent rapid-fire character switches (loop protection)
                    const now = Date.now();
                    if (this.lastCharacterSwitchTime && now - this.lastCharacterSwitchTime < 1000) {
                        console.warn('[Toolasha] Ignoring rapid character switch (<1s since last), possible loop detected');
                        return;
                    }
                    this.lastCharacterSwitchTime = now;

                    // Flush all pending storage writes before cleanup (non-blocking)
                    // Use setTimeout to prevent main thread blocking during character switch
                    setTimeout(async () => {
                        try {
                            if (storage$1 && typeof storage$1.flushAll === 'function') {
                                await storage$1.flushAll();
                            }
                        } catch (error) {
                            console.error('[Toolasha] Failed to flush storage before character switch:', error);
                        }
                    }, 0);

                    // Set switching flag to block feature initialization
                    this.isCharacterSwitching = true;

                    // Emit character_switching event (cleanup phase)
                    this.emit('character_switching', {
                        oldId: this.currentCharacterId,
                        newId: newCharacterId,
                        oldName: this.currentCharacterName,
                        newName: newCharacterName,
                    });

                    // Update character tracking
                    this.currentCharacterId = newCharacterId;
                    this.currentCharacterName = newCharacterName;
                    this.currentCharacterGameMode = data.character?.gameMode || null;

                    // Clear old character data
                    this.characterData = null;
                    this.characterSkills = null;
                    this.characterItems = null;
                    this.characterActions = [];
                    this.characterQuests = [];
                    this.characterEquipment.clear();
                    this.characterHouseRooms.clear();
                    this.actionTypeDrinkSlotsMap.clear();
                    this.personalActionTypeBuffsMap = {};
                    this.battleData = null;

                    // Reset switching flag (cleanup complete, ready for re-init)
                    this.isCharacterSwitching = false;

                    // Emit character_switched event (ready for re-init)
                    this.emit('character_switched', {
                        newId: newCharacterId,
                        newName: newCharacterName,
                    });
                } else if (!this.currentCharacterId) {
                    // First load - set character tracking
                    this.currentCharacterId = newCharacterId;
                    this.currentCharacterName = newCharacterName;
                    this.currentCharacterGameMode = data.character?.gameMode || null;
                }

                // Process new character data normally
                this.characterData = data;
                this.characterSkills = data.characterSkills;
                this.characterItems = data.characterItems;
                this.characterActions = [...data.characterActions];
                this.characterQuests = data.characterQuests || [];

                // Build equipment map
                this.updateEquipmentMap(data.characterItems);

                // Build house room map
                this.updateHouseRoomMap(data.characterHouseRoomMap);

                // Build drink slots map (tea buffs)
                this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);

                // Load personal buffs (seal buffs from Labyrinth, may be present on login)
                if (data.personalActionTypeBuffsMap) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                }

                // Clear switching flag
                this.isCharacterSwitching = false;

                // Emit character_initialized event (trigger feature initialization)
                // Include flag to indicate if this is a character switch vs first load
                // IMPORTANT: Mutate data object instead of spreading to avoid copying MB of data
                data._isCharacterSwitch = isCharacterSwitch;
                this.emit('character_initialized', data);
                connectionState.handleCharacterInitialized(data);
            });

            // Handle actions_updated (action queue changes)
            this.webSocketHook.on('actions_updated', (data) => {
                // Update action list
                for (const action of data.endCharacterActions) {
                    // Always remove the old entry first to prevent duplicates —
                    // endCharacterActions can contain existing actions alongside new ones.
                    this.characterActions = this.characterActions.filter((a) => a.id !== action.id);
                    if (action.isDone === false) {
                        this.characterActions.push(action);
                    }
                }

                this.emit('actions_updated', data);
            });

            // Handle action_completed (action progress)
            this.webSocketHook.on('action_completed', (data) => {
                const action = data.endCharacterAction;
                if (action.isDone === false) {
                    for (let i = 0; i < this.characterActions.length; i++) {
                        if (this.characterActions[i].id === action.id) {
                            // Replace the entire cached action with fresh data from the server
                            // This keeps primaryItemHash, enhancingMaxLevel, etc. up to date
                            this.characterActions[i] = action;
                            break;
                        }
                    }
                }

                // CRITICAL: Update inventory from action_completed (this is how inventory updates during gathering!)
                if (data.endCharacterItems && Array.isArray(data.endCharacterItems) && this.characterItems) {
                    for (const endItem of data.endCharacterItems) {
                        // Only update inventory items
                        if (endItem.itemLocationHrid !== '/item_locations/inventory') {
                            continue;
                        }

                        // Find and update the item in inventory
                        const index = this.characterItems.findIndex((invItem) => invItem.id === endItem.id);
                        if (index !== -1) {
                            // Update existing item
                            this.characterItems[index].count = endItem.count;
                        } else {
                            // Add new item to inventory
                            this.characterItems.push(endItem);
                        }
                    }

                    // Notify items_updated listeners (e.g. networth) of the inventory change
                    this.emit('items_updated', data);
                }

                // CRITICAL: Update skill experience from action_completed (this is how XP updates in real-time!)
                if (data.endCharacterSkills && Array.isArray(data.endCharacterSkills) && this.characterSkills) {
                    for (const updatedSkill of data.endCharacterSkills) {
                        const skill = this.characterSkills.find((s) => s.skillHrid === updatedSkill.skillHrid);
                        if (skill) {
                            // Update experience (and level if it changed)
                            skill.experience = updatedSkill.experience;
                            if (updatedSkill.level !== undefined) {
                                skill.level = updatedSkill.level;
                            }
                        }
                    }
                }

                this.emit('action_completed', data);
            });

            // Handle items_updated (inventory/equipment changes)
            this.webSocketHook.on('items_updated', (data) => {
                if (data.endCharacterItems) {
                    if (!this.characterItems) {
                        this.emit('items_updated', data);
                        return;
                    }
                    // Update inventory items in-place (endCharacterItems contains only changed items, not full inventory)
                    for (const item of data.endCharacterItems) {
                        const index = this.characterItems.findIndex((invItem) => invItem.id === item.id);
                        if (index !== -1) {
                            if (item.count === 0) {
                                // count 0 means removed from this location (e.g. equipped from inventory)
                                this.characterItems.splice(index, 1);
                            } else {
                                // Update existing item (count and location may have changed, e.g. unequip)
                                this.characterItems[index] = { ...this.characterItems[index], ...item };
                            }
                        } else if (item.count > 0) {
                            // New item in inventory or equipment slot
                            this.characterItems.push(item);
                        }
                    }

                    this.updateEquipmentMap(data.endCharacterItems);
                }

                this.emit('items_updated', data);
            });

            // Handle market_listings_updated (market order changes)
            this.webSocketHook.on('market_listings_updated', (data) => {
                if (!this.characterData || !Array.isArray(data?.endMarketListings)) {
                    return;
                }

                const currentListings = Array.isArray(this.characterData.myMarketListings)
                    ? this.characterData.myMarketListings
                    : [];
                const updatedListings = mergeMarketListings(currentListings, data.endMarketListings);

                this.characterData = {
                    ...this.characterData,
                    myMarketListings: updatedListings,
                };

                this.emit('market_listings_updated', {
                    ...data,
                    myMarketListings: updatedListings,
                });
            });

            // Handle market_item_order_books_updated (order book updates)
            this.webSocketHook.on('market_item_order_books_updated', (data) => {
                this.emit('market_item_order_books_updated', data);
            });

            // Handle action_type_consumable_slots_updated (when user changes tea assignments)
            this.webSocketHook.on('action_type_consumable_slots_updated', (data) => {
                // Update drink slots map with new consumables
                if (data.actionTypeDrinkSlotsMap) {
                    this.updateDrinkSlotsMap(data.actionTypeDrinkSlotsMap);
                }

                this.emit('consumables_updated', data);
            });

            // Handle consumable_buffs_updated (when buffs expire/refresh)
            this.webSocketHook.on('consumable_buffs_updated', (data) => {
                // Buffs updated - next hover will show updated values
                this.emit('buffs_updated', data);
            });

            // Handle personal_buffs_updated (seal buffs from Labyrinth)
            this.webSocketHook.on('personal_buffs_updated', (data) => {
                if (data.personalActionTypeBuffsMap) {
                    this.personalActionTypeBuffsMap = data.personalActionTypeBuffsMap;
                }
                this.emit('personal_buffs_updated', data);
            });

            // Handle house_rooms_updated (when user upgrades house rooms)
            this.webSocketHook.on('house_rooms_updated', (data) => {
                // Update house room map with new levels
                if (data.characterHouseRoomMap) {
                    this.updateHouseRoomMap(data.characterHouseRoomMap);
                }

                this.emit('house_rooms_updated', data);
            });

            // Handle skills_updated (when user gains skill levels)
            this.webSocketHook.on('skills_updated', (data) => {
                // Update character skills with new levels
                if (data.characterSkills) {
                    this.characterSkills = data.characterSkills;
                }

                this.emit('skills_updated', data);
            });

            // Handle new_battle (combat start - for Combat Sim export on Steam)
            this.webSocketHook.on('new_battle', (data) => {
                // Store battle data (includes party consumables)
                this.battleData = data;
            });

            // Handle character_info_updated (task slot changes, cooldown timestamps, etc.)
            this.webSocketHook.on('character_info_updated', (data) => {
                if (this.characterData && data.characterInfo) {
                    this.characterData.characterInfo = data.characterInfo;
                }
                this.emit('character_info_updated', data);
            });

            // Handle setting_updated (labyrinth skip thresholds, crate selection, etc.)
            this.webSocketHook.on('setting_updated', (data) => {
                if (this.characterData && data.characterSetting) {
                    this.characterData.characterSetting = data.characterSetting;
                }
                this.emit('setting_updated', data);
            });

            // Handle quests_updated (keep characterQuests in sync mid-session)
            this.webSocketHook.on('quests_updated', (data) => {
                if (data.endCharacterQuests && Array.isArray(data.endCharacterQuests)) {
                    for (const updatedQuest of data.endCharacterQuests) {
                        const index = this.characterQuests.findIndex((q) => q.id === updatedQuest.id);
                        if (index !== -1) {
                            this.characterQuests[index] = updatedQuest;
                        } else {
                            this.characterQuests.push(updatedQuest);
                        }
                    }
                    // Remove claimed quests
                    this.characterQuests = this.characterQuests.filter((q) => q.status !== '/quest_status/claimed');
                }
            });
        }

        /**
         * Update equipment map from character items
         * @param {Array} items - Character items array
         */
        updateEquipmentMap(items) {
            for (const item of items) {
                if (item.itemLocationHrid !== '/item_locations/inventory') {
                    if (item.count === 0) {
                        this.characterEquipment.delete(item.itemLocationHrid);
                    } else {
                        this.characterEquipment.set(item.itemLocationHrid, item);
                    }
                }
            }
        }

        /**
         * Update house room map from character house room data
         * @param {Object} houseRoomMap - Character house room map
         */
        updateHouseRoomMap(houseRoomMap) {
            if (!houseRoomMap) {
                return;
            }

            this.characterHouseRooms.clear();
            for (const [_hrid, room] of Object.entries(houseRoomMap)) {
                this.characterHouseRooms.set(room.houseRoomHrid, room);
            }
        }

        /**
         * Update drink slots map from character data
         * @param {Object} drinkSlotsMap - Action type drink slots map
         */
        updateDrinkSlotsMap(drinkSlotsMap) {
            if (!drinkSlotsMap) {
                return;
            }

            this.actionTypeDrinkSlotsMap.clear();
            for (const [actionTypeHrid, drinks] of Object.entries(drinkSlotsMap)) {
                this.actionTypeDrinkSlotsMap.set(actionTypeHrid, drinks || []);
            }
        }

        /**
         * Get static game data
         * @returns {Object} Init client data (items, actions, monsters, etc.)
         */
        getInitClientData() {
            return this.initClientData;
        }

        /**
         * Get combined game data (static + character)
         * Used for features that need both static data and player data
         * @returns {Object} Combined data object
         */
        getCombinedData() {
            if (!this.initClientData) {
                return null;
            }

            return {
                ...this.initClientData,
                // Character-specific data
                characterItems: this.characterItems || [],
                myMarketListings: this.characterData?.myMarketListings || [],
                characterHouseRoomMap: Object.fromEntries(this.characterHouseRooms),
                characterAbilities: this.characterData?.characterAbilities || [],
                abilityCombatTriggersMap: this.characterData?.abilityCombatTriggersMap || {},
            };
        }

        /**
         * Get item details by HRID
         * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
         * @returns {Object|null} Item details
         */
        getItemDetails(itemHrid) {
            return this.initClientData?.itemDetailMap?.[itemHrid] || null;
        }

        /**
         * Get action details by HRID
         * @param {string} actionHrid - Action HRID (e.g., "/actions/milking/cow")
         * @returns {Object|null} Action details
         */
        getActionDetails(actionHrid) {
            return this.initClientData?.actionDetailMap?.[actionHrid] || null;
        }

        /**
         * Get player's current actions
         * @returns {Array} Current action queue
         */
        getCurrentActions() {
            return [...this.characterActions];
        }

        /**
         * Get player's equipped items
         * @returns {Map} Equipment map (slot HRID -> item)
         */
        getEquipment() {
            return new Map(this.characterEquipment);
        }

        /**
         * Get MooPass buffs
         * @returns {Array} MooPass buffs array (empty if no MooPass)
         */
        getMooPassBuffs() {
            return this.characterData?.mooPassBuffs || [];
        }

        /**
         * Get player's house rooms
         * @returns {Map} House room map (room HRID -> {houseRoomHrid, level})
         */
        getHouseRooms() {
            return new Map(this.characterHouseRooms);
        }

        /**
         * Get house room level
         * @param {string} houseRoomHrid - House room HRID (e.g., "/house_rooms/brewery")
         * @returns {number} Room level (0 if not found)
         */
        getHouseRoomLevel(houseRoomHrid) {
            const room = this.characterHouseRooms.get(houseRoomHrid);
            return room?.level || 0;
        }

        /**
         * Get active drink items for an action type
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/brewing")
         * @returns {Array} Array of drink items (empty if none)
         */
        getActionDrinkSlots(actionTypeHrid) {
            return this.actionTypeDrinkSlotsMap.get(actionTypeHrid) || [];
        }

        /**
         * Get current character ID
         * @returns {string|null} Character ID or null
         */
        getCurrentCharacterId() {
            return this.currentCharacterId;
        }

        /**
         * Get current character name
         * @returns {string|null} Character name or null
         */
        getCurrentCharacterName() {
            return this.currentCharacterName;
        }

        /**
         * Get current character game mode
         * @returns {string|null} Game mode ('ironcow', 'standard', etc.) or null
         */
        getCurrentCharacterGameMode() {
            return this.currentCharacterGameMode;
        }

        /**
         * Check if character is currently switching
         * @returns {boolean} True if switching
         */
        getIsCharacterSwitching() {
            return this.isCharacterSwitching;
        }

        /**
         * Get community buff level
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/community_buff_types/production_efficiency")
         * @returns {number} Buff level (0 if not active)
         */
        getCommunityBuffLevel(buffTypeHrid) {
            if (!this.characterData?.communityBuffs) {
                return 0;
            }

            const buff = this.characterData.communityBuffs.find((b) => b.hrid === buffTypeHrid);
            return buff?.level || 0;
        }

        /**
         * Get achievement buffs for an action type
         * Achievement buffs are provided by the game based on completed achievement tiers
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @returns {Object} Buff object with stat bonuses (e.g., {gatheringQuantity: 0.02}) or empty object
         */
        getAchievementBuffs(actionTypeHrid) {
            if (!this.characterData?.achievementActionTypeBuffsMap) {
                return {};
            }

            return this.characterData.achievementActionTypeBuffsMap[actionTypeHrid] || {};
        }

        /**
         * Get achievement buff flat boost for an action type and buff type
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/wisdom")
         * @returns {number} Flat boost value (decimal) or 0 if not found
         */
        getAchievementBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
            const achievementMap = this.characterData?.achievementActionTypeBuffsMap;
            if (!achievementMap) {
                return 0;
            }

            if (this.achievementBuffCache.source !== achievementMap) {
                this.achievementBuffCache = {
                    source: achievementMap,
                    byActionType: new Map(),
                };
            }

            const actionCache = this.achievementBuffCache.byActionType.get(actionTypeHrid) || new Map();
            if (actionCache.has(buffTypeHrid)) {
                return actionCache.get(buffTypeHrid);
            }

            const achievementBuffs = achievementMap[actionTypeHrid];
            if (!Array.isArray(achievementBuffs)) {
                actionCache.set(buffTypeHrid, 0);
                this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
                return 0;
            }

            const buff = achievementBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            const flatBoost = buff?.flatBoost || 0;
            actionCache.set(buffTypeHrid, flatBoost);
            this.achievementBuffCache.byActionType.set(actionTypeHrid, actionCache);
            return flatBoost;
        }

        /**
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/enhancing")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/enhancing_success")
         * @returns {number} Ratio boost value (decimal) or 0 if not found
         */
        getAchievementBuffRatioBoost(actionTypeHrid, buffTypeHrid) {
            const achievementMap = this.characterData?.achievementActionTypeBuffsMap;
            if (!achievementMap) return 0;

            const achievementBuffs = achievementMap[actionTypeHrid];
            if (!Array.isArray(achievementBuffs)) return 0;

            const buff = achievementBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            return buff?.ratioBoost || 0;
        }

        /**
         * Get personal buff flat boost for an action type and buff type (seal buffs from Labyrinth).
         * When scroll simulation is armed for this action type, returns max(active, simulated).
         * @param {string} actionTypeHrid - Action type HRID (e.g., "/action_types/foraging")
         * @param {string} buffTypeHrid - Buff type HRID (e.g., "/buff_types/efficiency")
         * @returns {number} Flat boost value (decimal) or 0 if not found
         */
        getPersonalBuffFlatBoost(actionTypeHrid, buffTypeHrid) {
            const activeValue = this._getActivePersonalBuff(actionTypeHrid, buffTypeHrid);
            const simSet = this.scrollSimulationByActionType[actionTypeHrid];
            if (simSet?.has(buffTypeHrid)) {
                return Math.max(activeValue, SCROLL_BUFF_VALUES[buffTypeHrid] ?? 0);
            }
            return activeValue;
        }

        /**
         * @param {string} actionTypeHrid
         * @param {string} buffTypeHrid
         * @returns {number}
         */
        _getActivePersonalBuff(actionTypeHrid, buffTypeHrid) {
            const personalBuffs = this.personalActionTypeBuffsMap[actionTypeHrid];
            if (!Array.isArray(personalBuffs)) return 0;
            const buff = personalBuffs.find((entry) => entry?.typeHrid === buffTypeHrid);
            return buff?.flatBoost || 0;
        }

        /**
         * Arm scroll simulation for a specific action type before running calculations.
         * @param {string} actionTypeHrid
         * @param {Set<string>} buffTypeSet - Set of buffTypeHrids to simulate
         */
        setScrollSimulation(actionTypeHrid, buffTypeSet) {
            if (buffTypeSet?.size > 0) {
                this.scrollSimulationByActionType[actionTypeHrid] = buffTypeSet;
            } else {
                delete this.scrollSimulationByActionType[actionTypeHrid];
            }
        }

        /**
         * Disarm scroll simulation for a specific action type after calculations are done.
         * @param {string} actionTypeHrid
         */
        clearScrollSimulation(actionTypeHrid) {
            delete this.scrollSimulationByActionType[actionTypeHrid];
        }

        /**
         * Returns true when a scroll buff is being simulated (simulated value > active value).
         * Used by display code to decide whether to show the scroll sprite on a buff row.
         * @param {string} actionTypeHrid
         * @param {string} buffTypeHrid
         * @returns {boolean}
         */
        isBuffBeingSimulated(actionTypeHrid, buffTypeHrid) {
            const simSet = this.scrollSimulationByActionType[actionTypeHrid];
            if (!simSet?.has(buffTypeHrid)) return false;
            return (SCROLL_BUFF_VALUES[buffTypeHrid] ?? 0) > this._getActivePersonalBuff(actionTypeHrid, buffTypeHrid);
        }

        /**
         * Get player's skills
         * @returns {Array|null} Character skills
         */
        getSkills() {
            return this.characterSkills ? [...this.characterSkills] : null;
        }

        /**
         * Get player's inventory
         * @returns {Array|null} Character items
         */
        getInventory() {
            return this.characterItems ? [...this.characterItems] : null;
        }

        /**
         * Get player's market listings
         * @returns {Array} Market listings array
         */
        getMarketListings() {
            return this.characterData?.myMarketListings ? [...this.characterData.myMarketListings] : [];
        }

        /**
         * Get the current blocked character map { [characterId]: name }
         * @returns {Object} Blocked character map, or empty object if not available
         */
        getBlockedCharacterMap() {
            return this.characterData?.blockedCharacterMap || {};
        }

        /**
         * Get active task action HRIDs
         * @returns {Array<string>} Array of action HRIDs that are currently active tasks
         */
        getActiveTaskActionHrids() {
            if (!this.characterQuests || this.characterQuests.length === 0) {
                return [];
            }

            return this.characterQuests
                .filter(
                    (quest) =>
                        quest.category === '/quest_category/random_task' &&
                        quest.status === '/quest_status/in_progress' &&
                        quest.actionHrid
                )
                .map((quest) => quest.actionHrid);
        }

        /**
         * Check if an action is currently an active task
         * @param {string} actionHrid - Action HRID to check
         * @returns {boolean} True if action is an active task
         */
        isTaskAction(actionHrid) {
            const activeTasks = this.getActiveTaskActionHrids();
            return activeTasks.includes(actionHrid);
        }

        /**
         * Get task speed bonus from equipped task badges
         * @returns {number} Task speed percentage (e.g., 15 for 15%)
         */
        getTaskSpeedBonus() {
            if (!this.characterEquipment || !this.initClientData) {
                return 0;
            }

            let totalTaskSpeed = 0;

            // Task badges are in trinket slot
            const trinketLocation = '/item_locations/trinket';
            const equippedItem = this.characterEquipment.get(trinketLocation);

            if (!equippedItem || !equippedItem.itemHrid) {
                return 0;
            }

            const itemDetail = this.initClientData.itemDetailMap[equippedItem.itemHrid];
            if (!itemDetail || !itemDetail.equipmentDetail) {
                return 0;
            }

            const taskSpeed = itemDetail.equipmentDetail.noncombatStats?.taskSpeed || 0;
            if (taskSpeed === 0) {
                return 0;
            }

            // Calculate enhancement bonus
            // Note: noncombatEnhancementBonuses already includes slot multiplier (5× for trinket)
            const enhancementLevel = equippedItem.enhancementLevel || 0;
            const enhancementBonus = itemDetail.equipmentDetail.noncombatEnhancementBonuses?.taskSpeed || 0;
            const totalEnhancementBonus = enhancementBonus * enhancementLevel;

            // Total taskSpeed = base + enhancement
            totalTaskSpeed = (taskSpeed + totalEnhancementBonus) * 100; // Convert to percentage

            return totalTaskSpeed;
        }

        /**
         * Build monster-to-sortIndex mapping from combat zone data
         * Used for sorting combat tasks by zone progression order
         * @private
         */
        buildMonsterSortIndexMap() {
            if (!this.initClientData || !this.initClientData.actionDetailMap) {
                return;
            }

            this.monsterSortIndexMap.clear();
            this.bossMonsterHrids.clear();

            // Extract combat zones (non-dungeon only)
            for (const [_zoneHrid, action] of Object.entries(this.initClientData.actionDetailMap)) {
                // Skip non-combat actions and dungeons
                if (action.type !== '/action_types/combat' || action.combatZoneInfo?.isDungeon) {
                    continue;
                }

                const sortIndex = action.sortIndex;

                // Get regular spawn monsters
                const regularMonsters = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];

                // Get boss monsters (every 10 battles)
                const bossMonsters = action.combatZoneInfo?.fightInfo?.bossSpawns || [];

                // Track boss monster HRIDs
                for (const boss of bossMonsters) {
                    if (boss.combatMonsterHrid) {
                        this.bossMonsterHrids.add(boss.combatMonsterHrid);
                    }
                }

                // Combine all monsters from this zone
                const allMonsters = [...regularMonsters, ...bossMonsters];

                // Map each monster to this zone's sortIndex
                for (const spawn of allMonsters) {
                    const monsterHrid = spawn.combatMonsterHrid;
                    if (!monsterHrid) continue;

                    // If monster appears in multiple zones, use earliest zone (lowest sortIndex)
                    if (
                        !this.monsterSortIndexMap.has(monsterHrid) ||
                        sortIndex < this.monsterSortIndexMap.get(monsterHrid)
                    ) {
                        this.monsterSortIndexMap.set(monsterHrid, sortIndex);
                    }
                }
            }
        }

        /**
         * Find the combat zone actionHrid that contains a given monster
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/bear")
         * @returns {string|null} Zone actionHrid or null
         */
        getCombatZoneForMonster(monsterHrid) {
            if (!this.initClientData?.actionDetailMap) return null;

            for (const [zoneHrid, action] of Object.entries(this.initClientData.actionDetailMap)) {
                if (action.type !== '/action_types/combat') continue;

                const spawns = action.combatZoneInfo?.fightInfo?.randomSpawnInfo?.spawns || [];
                const bosses = action.combatZoneInfo?.fightInfo?.bossSpawns || [];

                for (const spawn of [...spawns, ...bosses]) {
                    if (spawn.combatMonsterHrid === monsterHrid) {
                        return zoneHrid;
                    }
                }
            }
            return null;
        }

        /**
         * Get zone sortIndex for a monster (for task sorting)
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/rat")
         * @returns {number} Zone sortIndex (999 if not found)
         */
        getMonsterSortIndex(monsterHrid) {
            return this.monsterSortIndexMap.get(monsterHrid) || 999;
        }

        /**
         * Check if a monster is a boss (appears in bossSpawns of any combat zone)
         * @param {string} monsterHrid - Monster HRID (e.g., "/monsters/crystal_colossus")
         * @returns {boolean} True if the monster is a boss
         */
        isBossMonster(monsterHrid) {
            return this.bossMonsterHrids.has(monsterHrid);
        }

        /**
         * Get monster HRID from display name (for task sorting)
         * @param {string} monsterName - Monster display name (e.g., "Jerry")
         * @returns {string|null} Monster HRID or null if not found
         */
        getMonsterHridFromName(monsterName) {
            if (!this.initClientData || !this.initClientData.combatMonsterDetailMap) {
                return null;
            }

            // Search for monster by display name
            for (const [hrid, monster] of Object.entries(this.initClientData.combatMonsterDetailMap)) {
                if (monster.name === monsterName) {
                    return hrid;
                }
            }

            return null;
        }

        /**
         * Register event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function
         */
        on(event, callback) {
            if (!this.eventListeners.has(event)) {
                this.eventListeners.set(event, []);
            }
            this.eventListeners.get(event).push(callback);
        }

        /**
         * Unregister event listener
         * @param {string} event - Event name
         * @param {Function} callback - Handler function to remove
         */
        off(event, callback) {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }

        /**
         * Emit event to all listeners
         * Only character_switching is critical (must run immediately for proper cleanup)
         * All other events including character_switched and character_initialized are deferred
         * @param {string} event - Event name
         * @param {*} data - Event data
         */
        emit(event, data) {
            const listeners = this.eventListeners.get(event) || [];

            // Only character_switching must run immediately (cleanup phase)
            // character_switched can be deferred - it just schedules re-init anyway
            const isCritical = event === 'character_switching';

            if (isCritical) {
                // Run immediately on main thread
                for (const listener of listeners) {
                    try {
                        listener(data);
                    } catch (error) {
                        console.error(`[Data Manager] Error in ${event} listener:`, error);
                    }
                }
            } else {
                // Defer all other events to prevent main thread blocking
                setTimeout(() => {
                    for (const listener of listeners) {
                        try {
                            listener(data);
                        } catch (error) {
                            console.error(`[Data Manager] Error in ${event} listener:`, error);
                        }
                    }
                }, 0);
            }
        }
    }

    const dataManager$1 = new DataManager();

    var itemNamesZh = {
        Coin: '金币',
        'Task Token': '任务代币',
        'Labyrinth Token': '迷宫代币',
        'Chimerical Token': '奇幻代币',
        'Sinister Token': '阴森代币',
        'Enchanted Token': '秘法代币',
        'Pirate Token': '海盗代币',
        Cowbell: '牛铃',
        'Bag Of 10 Cowbells': '牛铃袋 (10个)',
        "Purple's Gift": '小紫牛的礼物',
        'Small Meteorite Cache': '小陨石舱',
        'Medium Meteorite Cache': '中陨石舱',
        'Large Meteorite Cache': '大陨石舱',
        "Small Artisan's Crate": '小工匠匣',
        "Medium Artisan's Crate": '中工匠匣',
        "Large Artisan's Crate": '大工匠匣',
        'Small Treasure Chest': '小宝箱',
        'Medium Treasure Chest': '中宝箱',
        'Large Treasure Chest': '大宝箱',
        'Chimerical Chest': '奇幻宝箱',
        'Sinister Chest': '阴森宝箱',
        'Enchanted Chest': '秘法宝箱',
        'Pirate Chest': '海盗宝箱',
        "Purdora's Box (Skilling)": '紫多拉之盒（生活）',
        "Purdora's Box (Combat)": '紫多拉之盒（战斗）',
        'Scroll Of Gathering': '采集卷轴',
        'Scroll Of Gourmet': '美食卷轴',
        'Scroll Of Processing': '加工卷轴',
        'Scroll Of Efficiency': '效率卷轴',
        'Scroll Of Action Speed': '行动速度卷轴',
        'Scroll Of Combat Drop': '战斗掉落卷轴',
        'Scroll Of Attack Speed': '攻击速度卷轴',
        'Scroll Of Cast Speed': '施法速度卷轴',
        'Scroll Of Damage': '伤害卷轴',
        'Scroll Of Critical Rate': '暴击率卷轴',
        'Scroll Of Wisdom': '经验卷轴',
        'Scroll Of Rare Find': '稀有发现卷轴',
        'Blue Key Fragment': '蓝色钥匙碎片',
        'Green Key Fragment': '绿色钥匙碎片',
        'Purple Key Fragment': '紫色钥匙碎片',
        'White Key Fragment': '白色钥匙碎片',
        'Orange Key Fragment': '橙色钥匙碎片',
        'Brown Key Fragment': '棕色钥匙碎片',
        'Stone Key Fragment': '石头钥匙碎片',
        'Dark Key Fragment': '黑暗钥匙碎片',
        'Burning Key Fragment': '燃烧钥匙碎片',
        Donut: '甜甜圈',
        'Blueberry Donut': '蓝莓甜甜圈',
        'Blackberry Donut': '黑莓甜甜圈',
        'Strawberry Donut': '草莓甜甜圈',
        'Mooberry Donut': '哞莓甜甜圈',
        'Marsberry Donut': '火星莓甜甜圈',
        'Spaceberry Donut': '太空莓甜甜圈',
        Cupcake: '纸杯蛋糕',
        'Blueberry Cake': '蓝莓蛋糕',
        'Blackberry Cake': '黑莓蛋糕',
        'Strawberry Cake': '草莓蛋糕',
        'Mooberry Cake': '哞莓蛋糕',
        'Marsberry Cake': '火星莓蛋糕',
        'Spaceberry Cake': '太空莓蛋糕',
        Gummy: '软糖',
        'Apple Gummy': '苹果软糖',
        'Orange Gummy': '橙子软糖',
        'Plum Gummy': '李子软糖',
        'Peach Gummy': '桃子软糖',
        'Dragon Fruit Gummy': '火龙果软糖',
        'Star Fruit Gummy': '杨桃软糖',
        Yogurt: '酸奶',
        'Apple Yogurt': '苹果酸奶',
        'Orange Yogurt': '橙子酸奶',
        'Plum Yogurt': '李子酸奶',
        'Peach Yogurt': '桃子酸奶',
        'Dragon Fruit Yogurt': '火龙果酸奶',
        'Star Fruit Yogurt': '杨桃酸奶',
        'Milking Tea': '挤奶茶',
        'Foraging Tea': '采摘茶',
        'Woodcutting Tea': '伐木茶',
        'Cooking Tea': '烹饪茶',
        'Brewing Tea': '冲泡茶',
        'Alchemy Tea': '炼金茶',
        'Enhancing Tea': '强化茶',
        'Cheesesmithing Tea': '奶酪锻造茶',
        'Crafting Tea': '制作茶',
        'Tailoring Tea': '缝纫茶',
        'Super Milking Tea': '超级挤奶茶',
        'Super Foraging Tea': '超级采摘茶',
        'Super Woodcutting Tea': '超级伐木茶',
        'Super Cooking Tea': '超级烹饪茶',
        'Super Brewing Tea': '超级冲泡茶',
        'Super Alchemy Tea': '超级炼金茶',
        'Super Enhancing Tea': '超级强化茶',
        'Super Crafting Tea': '超级制作茶',
        'Super Tailoring Tea': '超级缝纫茶',
        'Ultra Milking Tea': '究极挤奶茶',
        'Ultra Foraging Tea': '究极采摘茶',
        'Ultra Woodcutting Tea': '究极伐木茶',
        'Ultra Cooking Tea': '究极烹饪茶',
        'Ultra Brewing Tea': '究极冲泡茶',
        'Ultra Alchemy Tea': '究极炼金茶',
        'Ultra Enhancing Tea': '究极强化茶',
        'Ultra Crafting Tea': '究极制作茶',
        'Ultra Tailoring Tea': '究极缝纫茶',
        'Gathering Tea': '采集茶',
        'Gourmet Tea': '美食茶',
        'Wisdom Tea': '经验茶',
        'Processing Tea': '加工茶',
        'Efficiency Tea': '效率茶',
        'Artisan Tea': '工匠茶',
        'Catalytic Tea': '催化茶',
        'Blessed Tea': '福气茶',
        'Stamina Coffee': '耐力咖啡',
        'Intelligence Coffee': '智力咖啡',
        'Defense Coffee': '防御咖啡',
        'Attack Coffee': '攻击咖啡',
        'Melee Coffee': '近战咖啡',
        'Ranged Coffee': '远程咖啡',
        'Magic Coffee': '魔法咖啡',
        'Super Stamina Coffee': '超级耐力咖啡',
        'Super Intelligence Coffee': '超级智力咖啡',
        'Super Defense Coffee': '超级防御咖啡',
        'Super Attack Coffee': '超级攻击咖啡',
        'Super Melee Coffee': '超级近战咖啡',
        'Super Ranged Coffee': '超级远程咖啡',
        'Super Magic Coffee': '超级魔法咖啡',
        'Ultra Stamina Coffee': '究极耐力咖啡',
        'Ultra Intelligence Coffee': '究极智力咖啡',
        'Ultra Defense Coffee': '究极防御咖啡',
        'Ultra Attack Coffee': '究极攻击咖啡',
        'Ultra Melee Coffee': '究极近战咖啡',
        'Ultra Ranged Coffee': '究极远程咖啡',
        'Ultra Magic Coffee': '究极魔法咖啡',
        'Wisdom Coffee': '经验咖啡',
        'Lucky Coffee': '幸运咖啡',
        'Swiftness Coffee': '迅捷咖啡',
        'Channeling Coffee': '吟唱咖啡',
        'Critical Coffee': '暴击咖啡',
        Poke: '破胆之刺',
        Impale: '透骨之刺',
        Puncture: '破甲之刺',
        'Penetrating Strike': '贯心之刺',
        Scratch: '爪影斩',
        Cleave: '分裂斩',
        Maim: '血刃斩',
        'Crippling Slash': '致残斩',
        Smack: '重碾',
        Sweep: '重扫',
        'Stunning Blow': '重锤',
        'Fracturing Impact': '碎裂冲击',
        'Shield Bash': '盾击',
        'Quick Shot': '快速射击',
        'Aqua Arrow': '流水箭',
        'Flame Arrow': '烈焰箭',
        'Rain Of Arrows': '箭雨',
        'Silencing Shot': '沉默之箭',
        'Steady Shot': '稳定射击',
        'Pestilent Shot': '疫病射击',
        'Penetrating Shot': '贯穿射击',
        'Water Strike': '流水冲击',
        'Ice Spear': '冰枪术',
        'Frost Surge': '冰霜爆裂',
        'Mana Spring': '法力喷泉',
        Entangle: '缠绕',
        'Toxic Pollen': '剧毒粉尘',
        "Nature's Veil": '自然菌幕',
        'Life Drain': '生命吸取',
        Fireball: '火球',
        'Flame Blast': '熔岩爆裂',
        Firestorm: '火焰风暴',
        'Smoke Burst': '烟爆灭影',
        'Minor Heal': '初级自愈术',
        Heal: '自愈术',
        'Quick Aid': '快速治疗术',
        Rejuvenate: '群体治疗术',
        Taunt: '嘲讽',
        Provoke: '挑衅',
        Toughness: '坚韧',
        Elusiveness: '闪避',
        Precision: '精确',
        Berserk: '狂暴',
        'Elemental Affinity': '元素增幅',
        Frenzy: '狂速',
        'Spike Shell': '尖刺防护',
        Retribution: '惩戒',
        Vampirism: '吸血',
        Revive: '复活',
        Insanity: '疯狂',
        Invincible: '无敌',
        'Speed Aura': '速度光环',
        'Guardian Aura': '守护光环',
        'Fierce Aura': '物理光环',
        'Critical Aura': '暴击光环',
        'Mystic Aura': '元素光环',
        'Gobo Stabber': '哥布林长剑',
        'Gobo Slasher': '哥布林关刀',
        'Gobo Smasher': '哥布林狼牙棒',
        'Spiked Bulwark': '尖刺重盾',
        'Werewolf Slasher': '狼人关刀',
        'Griffin Bulwark': '狮鹫重盾',
        'Griffin Bulwark (R)': '狮鹫重盾（精）',
        'Gobo Shooter': '哥布林弹弓',
        'Vampiric Bow': '吸血弓',
        'Cursed Bow': '咒怨之弓',
        'Cursed Bow (R)': '咒怨之弓（精）',
        'Gobo Boomstick': '哥布林火棍',
        'Cheese Bulwark': '奶酪重盾',
        'Verdant Bulwark': '翠绿重盾',
        'Azure Bulwark': '蔚蓝重盾',
        'Burble Bulwark': '深紫重盾',
        'Crimson Bulwark': '绛红重盾',
        'Rainbow Bulwark': '彩虹重盾',
        'Holy Bulwark': '神圣重盾',
        'Wooden Bow': '木弓',
        'Birch Bow': '桦木弓',
        'Cedar Bow': '雪松弓',
        'Purpleheart Bow': '紫心弓',
        'Ginkgo Bow': '银杏弓',
        'Redwood Bow': '红杉弓',
        'Arcane Bow': '神秘弓',
        'Stalactite Spear': '石钟长枪',
        'Granite Bludgeon': '花岗岩大棒',
        'Furious Spear': '狂怒长枪',
        'Furious Spear (R)': '狂怒长枪（精）',
        'Regal Sword': '君王之剑',
        'Regal Sword (R)': '君王之剑（精）',
        'Chaotic Flail': '混沌连枷',
        'Chaotic Flail (R)': '混沌连枷（精）',
        'Soul Hunter Crossbow': '灵魂猎手弩',
        'Sundering Crossbow': '裂空之弩',
        'Sundering Crossbow (R)': '裂空之弩（精）',
        'Frost Staff': '冰霜法杖',
        'Infernal Battlestaff': '炼狱法杖',
        'Jackalope Staff': '鹿角兔之杖',
        'Rippling Trident': '涟漪三叉戟',
        'Rippling Trident (R)': '涟漪三叉戟（精）',
        'Blooming Trident': '绽放三叉戟',
        'Blooming Trident (R)': '绽放三叉戟（精）',
        'Blazing Trident': '炽焰三叉戟',
        'Blazing Trident (R)': '炽焰三叉戟（精）',
        'Cheese Sword': '奶酪剑',
        'Verdant Sword': '翠绿剑',
        'Azure Sword': '蔚蓝剑',
        'Burble Sword': '深紫剑',
        'Crimson Sword': '绛红剑',
        'Rainbow Sword': '彩虹剑',
        'Holy Sword': '神圣剑',
        'Cheese Spear': '奶酪长枪',
        'Verdant Spear': '翠绿长枪',
        'Azure Spear': '蔚蓝长枪',
        'Burble Spear': '深紫长枪',
        'Crimson Spear': '绛红长枪',
        'Rainbow Spear': '彩虹长枪',
        'Holy Spear': '神圣长枪',
        'Cheese Mace': '奶酪钉头锤',
        'Verdant Mace': '翠绿钉头锤',
        'Azure Mace': '蔚蓝钉头锤',
        'Burble Mace': '深紫钉头锤',
        'Crimson Mace': '绛红钉头锤',
        'Rainbow Mace': '彩虹钉头锤',
        'Holy Mace': '神圣钉头锤',
        'Wooden Crossbow': '木弩',
        'Birch Crossbow': '桦木弩',
        'Cedar Crossbow': '雪松弩',
        'Purpleheart Crossbow': '紫心弩',
        'Ginkgo Crossbow': '银杏弩',
        'Redwood Crossbow': '红杉弩',
        'Arcane Crossbow': '神秘弩',
        'Wooden Water Staff': '木制水法杖',
        'Birch Water Staff': '桦木水法杖',
        'Cedar Water Staff': '雪松水法杖',
        'Purpleheart Water Staff': '紫心水法杖',
        'Ginkgo Water Staff': '银杏水法杖',
        'Redwood Water Staff': '红杉水法杖',
        'Arcane Water Staff': '神秘水法杖',
        'Wooden Nature Staff': '木制自然法杖',
        'Birch Nature Staff': '桦木自然法杖',
        'Cedar Nature Staff': '雪松自然法杖',
        'Purpleheart Nature Staff': '紫心自然法杖',
        'Ginkgo Nature Staff': '银杏自然法杖',
        'Redwood Nature Staff': '红杉自然法杖',
        'Arcane Nature Staff': '神秘自然法杖',
        'Wooden Fire Staff': '木制火法杖',
        'Birch Fire Staff': '桦木火法杖',
        'Cedar Fire Staff': '雪松火法杖',
        'Purpleheart Fire Staff': '紫心火法杖',
        'Ginkgo Fire Staff': '银杏火法杖',
        'Redwood Fire Staff': '红杉火法杖',
        'Arcane Fire Staff': '神秘火法杖',
        'Eye Watch': '掌上监工',
        'Snake Fang Dirk': '蛇牙短剑',
        'Vision Shield': '视觉盾',
        'Gobo Defender': '哥布林防御者',
        'Vampire Fang Dirk': '吸血鬼短剑',
        "Knight's Aegis": '骑士盾',
        "Knight's Aegis (R)": '骑士盾（精）',
        'Treant Shield': '树人盾',
        'Manticore Shield': '蝎狮盾',
        'Tome Of Healing': '治疗之书',
        'Tome Of The Elements': '元素之书',
        'Watchful Relic': '警戒遗物',
        "Bishop's Codex": '主教法典',
        "Bishop's Codex (R)": '主教法典（精）',
        'Cheese Buckler': '奶酪圆盾',
        'Verdant Buckler': '翠绿圆盾',
        'Azure Buckler': '蔚蓝圆盾',
        'Burble Buckler': '深紫圆盾',
        'Crimson Buckler': '绛红圆盾',
        'Rainbow Buckler': '彩虹圆盾',
        'Holy Buckler': '神圣圆盾',
        'Wooden Shield': '木盾',
        'Birch Shield': '桦木盾',
        'Cedar Shield': '雪松盾',
        'Purpleheart Shield': '紫心盾',
        'Ginkgo Shield': '银杏盾',
        'Redwood Shield': '红杉盾',
        'Arcane Shield': '神秘盾',
        'Gatherer Cape': '采集者披风',
        'Gatherer Cape (R)': '采集者披风（精）',
        'Artificer Cape': '工匠披风',
        'Artificer Cape (R)': '工匠披风（精）',
        'Culinary Cape': '厨师披风',
        'Culinary Cape (R)': '厨师披风（精）',
        'Chance Cape': '机缘披风',
        'Chance Cape (R)': '机缘披风（精）',
        'Sinister Cape': '阴森披风',
        'Sinister Cape (R)': '阴森披风（精）',
        'Chimerical Quiver': '奇幻箭袋',
        'Chimerical Quiver (R)': '奇幻箭袋（精）',
        'Enchanted Cloak': '秘法披风',
        'Enchanted Cloak (R)': '秘法披风（精）',
        'Red Culinary Hat': '红色厨师帽',
        'Snail Shell Helmet': '蜗牛壳头盔',
        'Vision Helmet': '视觉头盔',
        'Fluffy Red Hat': '蓬松红帽子',
        'Corsair Helmet': '掠夺者头盔',
        'Corsair Helmet (R)': '掠夺者头盔（精）',
        'Acrobatic Hood': '杂技师兜帽',
        'Acrobatic Hood (R)': '杂技师兜帽（精）',
        "Magician's Hat": '魔术师帽',
        "Magician's Hat (R)": '魔术师帽（精）',
        'Cheese Helmet': '奶酪头盔',
        'Verdant Helmet': '翠绿头盔',
        'Azure Helmet': '蔚蓝头盔',
        'Burble Helmet': '深紫头盔',
        'Crimson Helmet': '绛红头盔',
        'Rainbow Helmet': '彩虹头盔',
        'Holy Helmet': '神圣头盔',
        'Rough Hood': '粗糙兜帽',
        'Reptile Hood': '爬行动物兜帽',
        'Gobo Hood': '哥布林兜帽',
        'Beast Hood': '野兽兜帽',
        'Umbral Hood': '暗影兜帽',
        'Cotton Hat': '棉帽',
        'Linen Hat': '亚麻帽',
        'Bamboo Hat': '竹帽',
        'Silk Hat': '丝帽',
        'Radiant Hat': '光辉帽',
        "Dairyhand's Top": '挤奶工上衣',
        "Forager's Top": '采摘者上衣',
        "Lumberjack's Top": '伐木工上衣',
        "Cheesemaker's Top": '奶酪师上衣',
        "Crafter's Top": '工匠上衣',
        "Tailor's Top": '裁缝上衣',
        "Chef's Top": '厨师上衣',
        "Brewer's Top": '饮品师上衣',
        "Alchemist's Top": '炼金师上衣',
        "Enhancer's Top": '强化师上衣',
        'Gator Vest': '鳄鱼马甲',
        'Turtle Shell Body': '龟壳胸甲',
        'Colossus Plate Body': '巨像胸甲',
        'Demonic Plate Body': '恶魔胸甲',
        'Anchorbound Plate Body': '锚定胸甲',
        'Anchorbound Plate Body (R)': '锚定胸甲（精）',
        'Maelstrom Plate Body': '怒涛胸甲',
        'Maelstrom Plate Body (R)': '怒涛胸甲（精）',
        'Marine Tunic': '海洋皮衣',
        'Revenant Tunic': '亡灵皮衣',
        'Griffin Tunic': '狮鹫皮衣',
        'Kraken Tunic': '克拉肯皮衣',
        'Kraken Tunic (R)': '克拉肯皮衣（精）',
        'Icy Robe Top': '冰霜袍服',
        'Flaming Robe Top': '烈焰袍服',
        'Luna Robe Top': '月神袍服',
        'Royal Water Robe Top': '皇家水系袍服',
        'Royal Water Robe Top (R)': '皇家水系袍服（精）',
        'Royal Nature Robe Top': '皇家自然系袍服',
        'Royal Nature Robe Top (R)': '皇家自然系袍服（精）',
        'Royal Fire Robe Top': '皇家火系袍服',
        'Royal Fire Robe Top (R)': '皇家火系袍服（精）',
        'Cheese Plate Body': '奶酪胸甲',
        'Verdant Plate Body': '翠绿胸甲',
        'Azure Plate Body': '蔚蓝胸甲',
        'Burble Plate Body': '深紫胸甲',
        'Crimson Plate Body': '绛红胸甲',
        'Rainbow Plate Body': '彩虹胸甲',
        'Holy Plate Body': '神圣胸甲',
        'Rough Tunic': '粗糙皮衣',
        'Reptile Tunic': '爬行动物皮衣',
        'Gobo Tunic': '哥布林皮衣',
        'Beast Tunic': '野兽皮衣',
        'Umbral Tunic': '暗影皮衣',
        'Cotton Robe Top': '棉袍服',
        'Linen Robe Top': '亚麻袍服',
        'Bamboo Robe Top': '竹袍服',
        'Silk Robe Top': '丝绸袍服',
        'Radiant Robe Top': '光辉袍服',
        "Dairyhand's Bottoms": '挤奶工下装',
        "Forager's Bottoms": '采摘者下装',
        "Lumberjack's Bottoms": '伐木工下装',
        "Cheesemaker's Bottoms": '奶酪师下装',
        "Crafter's Bottoms": '工匠下装',
        "Tailor's Bottoms": '裁缝下装',
        "Chef's Bottoms": '厨师下装',
        "Brewer's Bottoms": '饮品师下装',
        "Alchemist's Bottoms": '炼金师下装',
        "Enhancer's Bottoms": '强化师下装',
        'Turtle Shell Legs': '龟壳腿甲',
        'Colossus Plate Legs': '巨像腿甲',
        'Demonic Plate Legs': '恶魔腿甲',
        'Anchorbound Plate Legs': '锚定腿甲',
        'Anchorbound Plate Legs (R)': '锚定腿甲（精）',
        'Maelstrom Plate Legs': '怒涛腿甲',
        'Maelstrom Plate Legs (R)': '怒涛腿甲（精）',
        'Marine Chaps': '航海皮裤',
        'Revenant Chaps': '亡灵皮裤',
        'Griffin Chaps': '狮鹫皮裤',
        'Kraken Chaps': '克拉肯皮裤',
        'Kraken Chaps (R)': '克拉肯皮裤（精）',
        'Icy Robe Bottoms': '冰霜袍裙',
        'Flaming Robe Bottoms': '烈焰袍裙',
        'Luna Robe Bottoms': '月神袍裙',
        'Royal Water Robe Bottoms': '皇家水系袍裙',
        'Royal Water Robe Bottoms (R)': '皇家水系袍裙（精）',
        'Royal Nature Robe Bottoms': '皇家自然系袍裙',
        'Royal Nature Robe Bottoms (R)': '皇家自然系袍裙（精）',
        'Royal Fire Robe Bottoms': '皇家火系袍裙',
        'Royal Fire Robe Bottoms (R)': '皇家火系袍裙（精）',
        'Cheese Plate Legs': '奶酪腿甲',
        'Verdant Plate Legs': '翠绿腿甲',
        'Azure Plate Legs': '蔚蓝腿甲',
        'Burble Plate Legs': '深紫腿甲',
        'Crimson Plate Legs': '绛红腿甲',
        'Rainbow Plate Legs': '彩虹腿甲',
        'Holy Plate Legs': '神圣腿甲',
        'Rough Chaps': '粗糙皮裤',
        'Reptile Chaps': '爬行动物皮裤',
        'Gobo Chaps': '哥布林皮裤',
        'Beast Chaps': '野兽皮裤',
        'Umbral Chaps': '暗影皮裤',
        'Cotton Robe Bottoms': '棉袍裙',
        'Linen Robe Bottoms': '亚麻袍裙',
        'Bamboo Robe Bottoms': '竹袍裙',
        'Silk Robe Bottoms': '丝绸袍裙',
        'Radiant Robe Bottoms': '光辉袍裙',
        'Enchanted Gloves': '附魔手套',
        'Pincer Gloves': '蟹钳手套',
        'Panda Gloves': '熊猫手套',
        'Magnetic Gloves': '磁力手套',
        'Dodocamel Gauntlets': '渡渡驼护手',
        'Dodocamel Gauntlets (R)': '渡渡驼护手（精）',
        'Sighted Bracers': '瞄准护腕',
        'Marksman Bracers': '神射护腕',
        'Marksman Bracers (R)': '神射护腕（精）',
        'Chrono Gloves': '时空手套',
        'Cheese Gauntlets': '奶酪护手',
        'Verdant Gauntlets': '翠绿护手',
        'Azure Gauntlets': '蔚蓝护手',
        'Burble Gauntlets': '深紫护手',
        'Crimson Gauntlets': '绛红护手',
        'Rainbow Gauntlets': '彩虹护手',
        'Holy Gauntlets': '神圣护手',
        'Rough Bracers': '粗糙护腕',
        'Reptile Bracers': '爬行动物护腕',
        'Gobo Bracers': '哥布林护腕',
        'Beast Bracers': '野兽护腕',
        'Umbral Bracers': '暗影护腕',
        'Cotton Gloves': '棉手套',
        'Linen Gloves': '亚麻手套',
        'Bamboo Gloves': '竹手套',
        'Silk Gloves': '丝手套',
        'Radiant Gloves': '光辉手套',
        "Collector's Boots": '收藏家靴',
        'Shoebill Shoes': '鲸头鹳鞋',
        'Black Bear Shoes': '黑熊鞋',
        'Grizzly Bear Shoes': '棕熊鞋',
        'Polar Bear Shoes': '北极熊鞋',
        'Pathbreaker Boots': '开路者靴',
        'Pathbreaker Boots (R)': '开路者靴（精）',
        'Centaur Boots': '半人马靴',
        'Pathfinder Boots': '探路者靴',
        'Pathfinder Boots (R)': '探路者靴（精）',
        'Sorcerer Boots': '巫师靴',
        'Pathseeker Boots': '寻路者靴',
        'Pathseeker Boots (R)': '寻路者靴（精）',
        'Cheese Boots': '奶酪靴',
        'Verdant Boots': '翠绿靴',
        'Azure Boots': '蔚蓝靴',
        'Burble Boots': '深紫靴',
        'Crimson Boots': '绛红靴',
        'Rainbow Boots': '彩虹靴',
        'Holy Boots': '神圣靴',
        'Rough Boots': '粗糙靴',
        'Reptile Boots': '爬行动物靴',
        'Gobo Boots': '哥布林靴',
        'Beast Boots': '野兽靴',
        'Umbral Boots': '暗影靴',
        'Cotton Boots': '棉靴',
        'Linen Boots': '亚麻靴',
        'Bamboo Boots': '竹靴',
        'Silk Boots': '丝靴',
        'Radiant Boots': '光辉靴',
        'Small Pouch': '小袋子',
        'Medium Pouch': '中袋子',
        'Large Pouch': '大袋子',
        'Giant Pouch': '巨大袋子',
        'Gluttonous Pouch': '贪食之袋',
        'Guzzling Pouch': '暴饮之囊',
        'Necklace Of Efficiency': '效率项链',
        'Fighter Necklace': '战士项链',
        'Ranger Necklace': '射手项链',
        'Wizard Necklace': '巫师项链',
        'Necklace Of Wisdom': '经验项链',
        'Necklace Of Speed': '速度项链',
        "Philosopher's Necklace": '贤者项链',
        'Earrings Of Gathering': '采集耳环',
        'Earrings Of Essence Find': '精华发现耳环',
        'Earrings Of Armor': '护甲耳环',
        'Earrings Of Regeneration': '恢复耳环',
        'Earrings Of Resistance': '抗性耳环',
        'Earrings Of Rare Find': '稀有发现耳环',
        'Earrings Of Critical Strike': '暴击耳环',
        "Philosopher's Earrings": '贤者耳环',
        'Ring Of Gathering': '采集戒指',
        'Ring Of Essence Find': '精华发现戒指',
        'Ring Of Armor': '护甲戒指',
        'Ring Of Regeneration': '恢复戒指',
        'Ring Of Resistance': '抗性戒指',
        'Ring Of Rare Find': '稀有发现戒指',
        'Ring Of Critical Strike': '暴击戒指',
        "Philosopher's Ring": '贤者戒指',
        'Trainee Milking Charm': '实习挤奶护符',
        'Basic Milking Charm': '基础挤奶护符',
        'Advanced Milking Charm': '高级挤奶护符',
        'Expert Milking Charm': '专家挤奶护符',
        'Master Milking Charm': '大师挤奶护符',
        'Grandmaster Milking Charm': '宗师挤奶护符',
        'Trainee Foraging Charm': '实习采摘护符',
        'Basic Foraging Charm': '基础采摘护符',
        'Advanced Foraging Charm': '高级采摘护符',
        'Expert Foraging Charm': '专家采摘护符',
        'Master Foraging Charm': '大师采摘护符',
        'Grandmaster Foraging Charm': '宗师采摘护符',
        'Trainee Woodcutting Charm': '实习伐木护符',
        'Basic Woodcutting Charm': '基础伐木护符',
        'Advanced Woodcutting Charm': '高级伐木护符',
        'Expert Woodcutting Charm': '专家伐木护符',
        'Master Woodcutting Charm': '大师伐木护符',
        'Grandmaster Woodcutting Charm': '宗师伐木护符',
        'Trainee Cheesesmithing Charm': '实习奶酪锻造护符',
        'Basic Cheesesmithing Charm': '基础奶酪锻造护符',
        'Advanced Cheesesmithing Charm': '高级奶酪锻造护符',
        'Expert Cheesesmithing Charm': '专家奶酪锻造护符',
        'Master Cheesesmithing Charm': '大师奶酪锻造护符',
        'Grandmaster Cheesesmithing Charm': '宗师奶酪锻造护符',
        'Trainee Crafting Charm': '实习制作护符',
        'Basic Crafting Charm': '基础制作护符',
        'Advanced Crafting Charm': '高级制作护符',
        'Expert Crafting Charm': '专家制作护符',
        'Master Crafting Charm': '大师制作护符',
        'Grandmaster Crafting Charm': '宗师制作护符',
        'Trainee Tailoring Charm': '实习缝纫护符',
        'Basic Tailoring Charm': '基础缝纫护符',
        'Advanced Tailoring Charm': '高级缝纫护符',
        'Expert Tailoring Charm': '专家缝纫护符',
        'Master Tailoring Charm': '大师缝纫护符',
        'Grandmaster Tailoring Charm': '宗师缝纫护符',
        'Trainee Cooking Charm': '实习烹饪护符',
        'Basic Cooking Charm': '基础烹饪护符',
        'Advanced Cooking Charm': '高级烹饪护符',
        'Expert Cooking Charm': '专家烹饪护符',
        'Master Cooking Charm': '大师烹饪护符',
        'Grandmaster Cooking Charm': '宗师烹饪护符',
        'Trainee Brewing Charm': '实习冲泡护符',
        'Basic Brewing Charm': '基础冲泡护符',
        'Advanced Brewing Charm': '高级冲泡护符',
        'Expert Brewing Charm': '专家冲泡护符',
        'Master Brewing Charm': '大师冲泡护符',
        'Grandmaster Brewing Charm': '宗师冲泡护符',
        'Trainee Alchemy Charm': '实习炼金护符',
        'Basic Alchemy Charm': '基础炼金护符',
        'Advanced Alchemy Charm': '高级炼金护符',
        'Expert Alchemy Charm': '专家炼金护符',
        'Master Alchemy Charm': '大师炼金护符',
        'Grandmaster Alchemy Charm': '宗师炼金护符',
        'Trainee Enhancing Charm': '实习强化护符',
        'Basic Enhancing Charm': '基础强化护符',
        'Advanced Enhancing Charm': '高级强化护符',
        'Expert Enhancing Charm': '专家强化护符',
        'Master Enhancing Charm': '大师强化护符',
        'Grandmaster Enhancing Charm': '宗师强化护符',
        'Trainee Stamina Charm': '实习耐力护符',
        'Basic Stamina Charm': '基础耐力护符',
        'Advanced Stamina Charm': '高级耐力护符',
        'Expert Stamina Charm': '专家耐力护符',
        'Master Stamina Charm': '大师耐力护符',
        'Grandmaster Stamina Charm': '宗师耐力护符',
        'Trainee Intelligence Charm': '实习智力护符',
        'Basic Intelligence Charm': '基础智力护符',
        'Advanced Intelligence Charm': '高级智力护符',
        'Expert Intelligence Charm': '专家智力护符',
        'Master Intelligence Charm': '大师智力护符',
        'Grandmaster Intelligence Charm': '宗师智力护符',
        'Trainee Attack Charm': '实习攻击护符',
        'Basic Attack Charm': '基础攻击护符',
        'Advanced Attack Charm': '高级攻击护符',
        'Expert Attack Charm': '专家攻击护符',
        'Master Attack Charm': '大师攻击护符',
        'Grandmaster Attack Charm': '宗师攻击护符',
        'Trainee Defense Charm': '实习防御护符',
        'Basic Defense Charm': '基础防御护符',
        'Advanced Defense Charm': '高级防御护符',
        'Expert Defense Charm': '专家防御护符',
        'Master Defense Charm': '大师防御护符',
        'Grandmaster Defense Charm': '宗师防御护符',
        'Trainee Melee Charm': '实习近战护符',
        'Basic Melee Charm': '基础近战护符',
        'Advanced Melee Charm': '高级近战护符',
        'Expert Melee Charm': '专家近战护符',
        'Master Melee Charm': '大师近战护符',
        'Grandmaster Melee Charm': '宗师近战护符',
        'Trainee Ranged Charm': '实习远程护符',
        'Basic Ranged Charm': '基础远程护符',
        'Advanced Ranged Charm': '高级远程护符',
        'Expert Ranged Charm': '专家远程护符',
        'Master Ranged Charm': '大师远程护符',
        'Grandmaster Ranged Charm': '宗师远程护符',
        'Trainee Magic Charm': '实习魔法护符',
        'Basic Magic Charm': '基础魔法护符',
        'Advanced Magic Charm': '高级魔法护符',
        'Expert Magic Charm': '专家魔法护符',
        'Master Magic Charm': '大师魔法护符',
        'Grandmaster Magic Charm': '宗师魔法护符',
        'Basic Task Badge': '基础任务徽章',
        'Advanced Task Badge': '高级任务徽章',
        'Expert Task Badge': '专家任务徽章',
        'Celestial Brush': '星空刷子',
        'Cheese Brush': '奶酪刷子',
        'Verdant Brush': '翠绿刷子',
        'Azure Brush': '蔚蓝刷子',
        'Burble Brush': '深紫刷子',
        'Crimson Brush': '绛红刷子',
        'Rainbow Brush': '彩虹刷子',
        'Holy Brush': '神圣刷子',
        'Celestial Shears': '星空剪刀',
        'Cheese Shears': '奶酪剪刀',
        'Verdant Shears': '翠绿剪刀',
        'Azure Shears': '蔚蓝剪刀',
        'Burble Shears': '深紫剪刀',
        'Crimson Shears': '绛红剪刀',
        'Rainbow Shears': '彩虹剪刀',
        'Holy Shears': '神圣剪刀',
        'Celestial Hatchet': '星空斧头',
        'Cheese Hatchet': '奶酪斧头',
        'Verdant Hatchet': '翠绿斧头',
        'Azure Hatchet': '蔚蓝斧头',
        'Burble Hatchet': '深紫斧头',
        'Crimson Hatchet': '绛红斧头',
        'Rainbow Hatchet': '彩虹斧头',
        'Holy Hatchet': '神圣斧头',
        'Celestial Hammer': '星空锤子',
        'Cheese Hammer': '奶酪锤子',
        'Verdant Hammer': '翠绿锤子',
        'Azure Hammer': '蔚蓝锤子',
        'Burble Hammer': '深紫锤子',
        'Crimson Hammer': '绛红锤子',
        'Rainbow Hammer': '彩虹锤子',
        'Holy Hammer': '神圣锤子',
        'Celestial Chisel': '星空凿子',
        'Cheese Chisel': '奶酪凿子',
        'Verdant Chisel': '翠绿凿子',
        'Azure Chisel': '蔚蓝凿子',
        'Burble Chisel': '深紫凿子',
        'Crimson Chisel': '绛红凿子',
        'Rainbow Chisel': '彩虹凿子',
        'Holy Chisel': '神圣凿子',
        'Celestial Needle': '星空针',
        'Cheese Needle': '奶酪针',
        'Verdant Needle': '翠绿针',
        'Azure Needle': '蔚蓝针',
        'Burble Needle': '深紫针',
        'Crimson Needle': '绛红针',
        'Rainbow Needle': '彩虹针',
        'Holy Needle': '神圣针',
        'Celestial Spatula': '星空锅铲',
        'Cheese Spatula': '奶酪锅铲',
        'Verdant Spatula': '翠绿锅铲',
        'Azure Spatula': '蔚蓝锅铲',
        'Burble Spatula': '深紫锅铲',
        'Crimson Spatula': '绛红锅铲',
        'Rainbow Spatula': '彩虹锅铲',
        'Holy Spatula': '神圣锅铲',
        'Celestial Pot': '星空壶',
        'Cheese Pot': '奶酪壶',
        'Verdant Pot': '翠绿壶',
        'Azure Pot': '蔚蓝壶',
        'Burble Pot': '深紫壶',
        'Crimson Pot': '绛红壶',
        'Rainbow Pot': '彩虹壶',
        'Holy Pot': '神圣壶',
        'Celestial Alembic': '星空蒸馏器',
        'Cheese Alembic': '奶酪蒸馏器',
        'Verdant Alembic': '翠绿蒸馏器',
        'Azure Alembic': '蔚蓝蒸馏器',
        'Burble Alembic': '深紫蒸馏器',
        'Crimson Alembic': '绛红蒸馏器',
        'Rainbow Alembic': '彩虹蒸馏器',
        'Holy Alembic': '神圣蒸馏器',
        'Celestial Enhancer': '星空强化器',
        'Cheese Enhancer': '奶酪强化器',
        'Verdant Enhancer': '翠绿强化器',
        'Azure Enhancer': '蔚蓝强化器',
        'Burble Enhancer': '深紫强化器',
        'Crimson Enhancer': '绛红强化器',
        'Rainbow Enhancer': '彩虹强化器',
        'Holy Enhancer': '神圣强化器',
        Milk: '牛奶',
        'Verdant Milk': '翠绿牛奶',
        'Azure Milk': '蔚蓝牛奶',
        'Burble Milk': '深紫牛奶',
        'Crimson Milk': '绛红牛奶',
        'Rainbow Milk': '彩虹牛奶',
        'Holy Milk': '神圣牛奶',
        Cheese: '奶酪',
        'Verdant Cheese': '翠绿奶酪',
        'Azure Cheese': '蔚蓝奶酪',
        'Burble Cheese': '深紫奶酪',
        'Crimson Cheese': '绛红奶酪',
        'Rainbow Cheese': '彩虹奶酪',
        'Holy Cheese': '神圣奶酪',
        Log: '原木',
        'Birch Log': '白桦原木',
        'Cedar Log': '雪松原木',
        'Purpleheart Log': '紫心原木',
        'Ginkgo Log': '银杏原木',
        'Redwood Log': '红杉原木',
        'Arcane Log': '神秘原木',
        Lumber: '木板',
        'Birch Lumber': '白桦木板',
        'Cedar Lumber': '雪松木板',
        'Purpleheart Lumber': '紫心木板',
        'Ginkgo Lumber': '银杏木板',
        'Redwood Lumber': '红杉木板',
        'Arcane Lumber': '神秘木板',
        'Rough Hide': '粗糙兽皮',
        'Reptile Hide': '爬行动物皮',
        'Gobo Hide': '哥布林皮',
        'Beast Hide': '野兽皮',
        'Umbral Hide': '暗影皮',
        'Rough Leather': '粗糙皮革',
        'Reptile Leather': '爬行动物皮革',
        'Gobo Leather': '哥布林皮革',
        'Beast Leather': '野兽皮革',
        'Umbral Leather': '暗影皮革',
        Cotton: '棉花',
        Flax: '亚麻',
        'Bamboo Branch': '竹子',
        Cocoon: '蚕茧',
        'Radiant Fiber': '光辉纤维',
        'Cotton Fabric': '棉花布料',
        'Linen Fabric': '亚麻布料',
        'Bamboo Fabric': '竹子布料',
        'Silk Fabric': '丝绸',
        'Radiant Fabric': '光辉布料',
        Egg: '鸡蛋',
        Wheat: '小麦',
        Sugar: '糖',
        Blueberry: '蓝莓',
        Blackberry: '黑莓',
        Strawberry: '草莓',
        Mooberry: '哞莓',
        Marsberry: '火星莓',
        Spaceberry: '太空莓',
        Apple: '苹果',
        Orange: '橙子',
        Plum: '李子',
        Peach: '桃子',
        'Dragon Fruit': '火龙果',
        'Star Fruit': '杨桃',
        'Arabica Coffee Bean': '低级咖啡豆',
        'Robusta Coffee Bean': '中级咖啡豆',
        'Liberica Coffee Bean': '高级咖啡豆',
        'Excelsa Coffee Bean': '特级咖啡豆',
        'Fieriosa Coffee Bean': '火山咖啡豆',
        'Spacia Coffee Bean': '太空咖啡豆',
        'Green Tea Leaf': '绿茶叶',
        'Black Tea Leaf': '黑茶叶',
        'Burble Tea Leaf': '紫茶叶',
        'Moolong Tea Leaf': '哞龙茶叶',
        'Red Tea Leaf': '红茶叶',
        'Emp Tea Leaf': '虚空茶叶',
        'Catalyst Of Coinification': '点金催化剂',
        'Catalyst Of Decomposition': '分解催化剂',
        'Catalyst Of Transmutation': '转化催化剂',
        'Prime Catalyst': '至高催化剂',
        'Snake Fang': '蛇牙',
        'Shoebill Feather': '鲸头鹳羽毛',
        'Snail Shell': '蜗牛壳',
        'Crab Pincer': '蟹钳',
        'Turtle Shell': '乌龟壳',
        'Marine Scale': '海洋鳞片',
        'Treant Bark': '树皮',
        'Centaur Hoof': '半人马蹄',
        'Luna Wing': '月神翼',
        'Gobo Rag': '哥布林抹布',
        Goggles: '护目镜',
        'Magnifying Glass': '放大镜',
        'Eye Of The Watcher': '观察者之眼',
        'Icy Cloth': '冰霜织物',
        'Flaming Cloth': '烈焰织物',
        "Sorcerer's Sole": '魔法师鞋底',
        'Chrono Sphere': '时空球',
        'Frost Sphere': '冰霜球',
        'Panda Fluff': '熊猫绒',
        'Black Bear Fluff': '黑熊绒',
        'Grizzly Bear Fluff': '棕熊绒',
        'Polar Bear Fluff': '北极熊绒',
        'Red Panda Fluff': '小熊猫绒',
        Magnet: '磁铁',
        'Stalactite Shard': '钟乳石碎片',
        'Living Granite': '花岗岩',
        'Colossus Core': '巨像核心',
        'Vampire Fang': '吸血鬼之牙',
        'Werewolf Claw': '狼人之爪',
        'Revenant Anima': '亡者之魂',
        'Soul Fragment': '灵魂碎片',
        'Infernal Ember': '地狱余烬',
        'Demonic Core': '恶魔核心',
        'Griffin Leather': '狮鹫之皮',
        'Manticore Sting': '蝎狮之刺',
        'Jackalope Antler': '鹿角兔之角',
        'Dodocamel Plume': '渡渡驼之翎',
        'Griffin Talon': '狮鹫之爪',
        'Chimerical Refinement Shard': '奇幻精炼碎片',
        "Acrobat's Ribbon": '杂技师彩带',
        "Magician's Cloth": '魔术师织物',
        'Chaotic Chain': '混沌锁链',
        'Cursed Ball': '诅咒之球',
        'Sinister Refinement Shard': '阴森精炼碎片',
        'Royal Cloth': '皇家织物',
        "Knight's Ingot": '骑士之锭',
        "Bishop's Scroll": '主教卷轴',
        'Regal Jewel': '君王宝石',
        'Sundering Jewel': '裂空宝石',
        'Enchanted Refinement Shard': '秘法精炼碎片',
        'Marksman Brooch': '神射胸针',
        'Corsair Crest': '掠夺者徽章',
        'Damaged Anchor': '破损船锚',
        'Maelstrom Plating': '怒涛甲片',
        'Kraken Leather': '克拉肯皮革',
        'Kraken Fang': '克拉肯之牙',
        'Pirate Refinement Shard': '海盗精炼碎片',
        'Pathbreaker Lodestone': '开路者磁石',
        'Pathfinder Lodestone': '探路者磁石',
        'Pathseeker Lodestone': '寻路者磁石',
        'Labyrinth Refinement Shard': '迷宫精炼碎片',
        'Butter Of Proficiency': '精通之油',
        'Thread Of Expertise': '专精之线',
        'Branch Of Insight': '洞察之枝',
        'Gluttonous Energy': '贪食能量',
        'Guzzling Energy': '暴饮能量',
        'Milking Essence': '挤奶精华',
        'Foraging Essence': '采摘精华',
        'Woodcutting Essence': '伐木精华',
        'Cheesesmithing Essence': '奶酪锻造精华',
        'Crafting Essence': '制作精华',
        'Tailoring Essence': '缝纫精华',
        'Cooking Essence': '烹饪精华',
        'Brewing Essence': '冲泡精华',
        'Alchemy Essence': '炼金精华',
        'Enhancing Essence': '强化精华',
        'Swamp Essence': '沼泽精华',
        'Aqua Essence': '海洋精华',
        'Jungle Essence': '丛林精华',
        'Gobo Essence': '哥布林精华',
        Eyessence: '眼精华',
        'Sorcerer Essence': '法师精华',
        'Bear Essence': '熊熊精华',
        'Golem Essence': '魔像精华',
        'Twilight Essence': '暮光精华',
        'Abyssal Essence': '地狱精华',
        'Chimerical Essence': '奇幻精华',
        'Sinister Essence': '阴森精华',
        'Enchanted Essence': '秘法精华',
        'Pirate Essence': '海盗精华',
        'Labyrinth Essence': '迷宫精华',
        'Task Crystal': '任务水晶',
        'Star Fragment': '星光碎片',
        Pearl: '珍珠',
        Amber: '琥珀',
        Garnet: '石榴石',
        Jade: '翡翠',
        Amethyst: '紫水晶',
        Moonstone: '月亮石',
        Sunstone: '太阳石',
        "Philosopher's Stone": '贤者之石',
        'Crushed Pearl': '珍珠碎片',
        'Crushed Amber': '琥珀碎片',
        'Crushed Garnet': '石榴石碎片',
        'Crushed Jade': '翡翠碎片',
        'Crushed Amethyst': '紫水晶碎片',
        'Crushed Moonstone': '月亮石碎片',
        'Crushed Sunstone': '太阳石碎片',
        "Crushed Philosopher's Stone": '贤者之石碎片',
        'Shard Of Protection': '保护碎片',
        'Mirror Of Protection': '保护之镜',
        "Philosopher's Mirror": '贤者之镜',
        'Basic Torch': '基础火把',
        'Advanced Torch': '进阶火把',
        'Expert Torch': '专家火把',
        'Basic Shroud': '基础斗篷',
        'Advanced Shroud': '进阶斗篷',
        'Expert Shroud': '专家斗篷',
        'Basic Beacon': '基础探照灯',
        'Advanced Beacon': '进阶探照灯',
        'Expert Beacon': '专家探照灯',
        'Basic Food Crate': '基础食物箱',
        'Advanced Food Crate': '进阶食物箱',
        'Expert Food Crate': '专家食物箱',
        'Basic Tea Crate': '基础茶叶箱',
        'Advanced Tea Crate': '进阶茶叶箱',
        'Expert Tea Crate': '专家茶叶箱',
        'Basic Coffee Crate': '基础咖啡箱',
        'Advanced Coffee Crate': '进阶咖啡箱',
        'Expert Coffee Crate': '专家咖啡箱',
    };

    /**
     * Auto-discovers Chinese item names from the game DOM and builds a
     * Chinese → English mapping cached in IndexedDB. Provides a unified
     * getDisplayName() returning Chinese when available, English otherwise.
     */


    const STORAGE_KEY = 'Toolasha_cnItemNames';
    const CACHE_VERSION = 2;
    const DEBOUNCE_DELAY = 5000;

    const MUTATION_SELECTORS = [
        '[class*="Item_name"]',
        '[class*="Item_itemName"]',
        '[class*="ItemTooltipText_name"]',
        '[class*="Item_craftingItemName"]',
        'svg[aria-label]',
    ];

    const ENHANCEMENT_STRIP_REGEX = /\s*\+\d+$/;
    const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

    class ItemNameTranslator {
        constructor() {
            this.cnNames = {};
            this.isLoaded = false;
            this._saveTimer = null;
            this._dirty = false;
            this._enToHrid = null;
            this._hridToEn = null;
            this._hridToEnSource = null;
            this._observer = null;
            this._observerStarted = false;
        }

        async load() {
            if (this.isLoaded) return;
            try {
                const saved = await storage$1.get(STORAGE_KEY, 'settings');
                if (
                    saved &&
                    typeof saved === 'object' &&
                    saved._version === CACHE_VERSION &&
                    Object.keys(saved).length > 1
                ) {
                    this.cnNames = saved;
                }
            } catch (_) {
                /* ignore */
            }
            this.isLoaded = true;
            this._importStaticMapping();
        }

        captureFromDOM(element, itemHrid) {
            if (!element || !itemHrid) return;
            const text = (element.textContent || element.getAttribute('aria-label') || '').trim();
            if (!text || !CJK_REGEX.test(text)) return;
            const baseName = text.replace(ENHANCEMENT_STRIP_REGEX, '').trim();
            if (!baseName) return;
            if (this.cnNames[itemHrid] === baseName) return;
            this.cnNames[itemHrid] = baseName;
            this._scheduleSave();
        }

        _importStaticMapping() {
            const initData = dataManager$1.getInitClientData();
            if (!initData?.itemDetailMap) return;
            let count = 0;
            for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                const cnName = itemNamesZh[item.name];
                if (cnName && !this.cnNames[hrid]) {
                    this.cnNames[hrid] = cnName;
                    count++;
                }
            }
            if (count > 0) this._scheduleSave();
        }

        _scheduleSave() {
            if (!this.isLoaded) return;
            this._dirty = true;
            if (this._saveTimer) return;
            this._saveTimer = setTimeout(async () => {
                this._saveTimer = null;
                if (!this._dirty) return;
                this._dirty = false;
                try {
                    const data = { ...this.cnNames, _version: CACHE_VERSION };
                    await storage$1.set(STORAGE_KEY, data, 'settings', true);
                } catch (error) {
                    console.warn('[ItemNameTranslator] Failed to save names:', error);
                }
            }, DEBOUNCE_DELAY);
        }

        flush() {
            if (this._saveTimer) {
                clearTimeout(this._saveTimer);
                this._saveTimer = null;
            }
            if (this._dirty) {
                this._dirty = false;
                const data = { ...this.cnNames, _version: CACHE_VERSION };
                storage$1.set(STORAGE_KEY, data, 'settings', true).catch(() => {});
            }
        }

        _scanDomNow() {
            for (const selector of MUTATION_SELECTORS) {
                for (const el of document.querySelectorAll(selector)) {
                    this._tryCaptureFromElement(el);
                }
            }
        }

        getDisplayName(itemHrid) {
            if (!itemHrid) return '';
            if (!this.isLoaded) this._lazyLoad();

            const cached = this.cnNames[itemHrid];
            if (cached) return cached;

            const item = dataManager$1.getItemDetails(itemHrid);
            const enName = item?.name;
            if (!enName) return itemHrid;

            const staticCn = itemNamesZh[enName];
            if (staticCn) {
                this.cnNames[itemHrid] = staticCn;
                return staticCn;
            }

            return enName;
        }

        _lazyLoad() {
            this.load().catch(() => {});
        }

        getHridFromChineseName(chineseName) {
            if (!chineseName) return null;
            const baseName = chineseName.replace(ENHANCEMENT_STRIP_REGEX, '').trim();
            for (const [hrid, cnName] of Object.entries(this.cnNames)) {
                if (cnName === baseName) return hrid;
            }
            for (const [enName, cnName] of Object.entries(itemNamesZh)) {
                if (cnName === baseName) {
                    const initData = dataManager$1.getInitClientData();
                    if (initData?.itemDetailMap) {
                        for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                            if (item.name === enName) return hrid;
                        }
                    }
                }
            }
            return null;
        }

        findHridFromDomName(chineseName) {
            if (!chineseName) return null;
            for (const [hrid, cnName] of Object.entries(this.cnNames)) {
                if (cnName === chineseName) return hrid;
            }
            for (const [enName, cnName] of Object.entries(itemNamesZh)) {
                if (cnName === chineseName) {
                    const initData = dataManager$1.getInitClientData();
                    if (initData?.itemDetailMap) {
                        for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                            if (item.name === enName) return hrid;
                        }
                    }
                }
            }
            const initData = dataManager$1.getInitClientData();
            if (initData?.itemDetailMap) {
                for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                    if (item.name === chineseName) return hrid;
                }
            }
            return null;
        }

        _ensureHRIDMaps() {
            if (this._hridToEn && this._enToHrid) return;
            this._enToHrid = {};
            this._hridToEn = {};
            const initData = dataManager$1.getInitClientData();
            if (!initData?.itemDetailMap) return;
            for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                this._enToHrid[item.name] = hrid;
                this._hridToEn[hrid] = item.name;
            }
        }

        startObserver() {
            if (this._observerStarted) return;
            this._observerStarted = true;

            const processNode = (node) => {
                if (!node || node.nodeType !== 1) return;
                for (const selector of MUTATION_SELECTORS) {
                    if (node.matches(selector)) {
                        this._tryCaptureFromElement(node);
                        break;
                    }
                }
                for (const selector of MUTATION_SELECTORS) {
                    const children = node.querySelectorAll(selector);
                    for (const child of children) {
                        this._tryCaptureFromElement(child);
                    }
                }
            };

            for (const selector of MUTATION_SELECTORS) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    this._tryCaptureFromElement(el);
                }
            }

            this._observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        try {
                            processNode(node);
                        } catch (_) {
                            // Skip errors from processing individual nodes
                        }
                    }
                }
            });

            this._observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }

        stopObserver() {
            if (this._observer) {
                this._observer.disconnect();
                this._observer = null;
            }
            this._observerStarted = false;
        }

        _tryCaptureFromElement(el) {
            if (!el) return;
            const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
            if (!text) return;

            if (!CJK_REGEX.test(text)) return;

            const baseName = text.replace(ENHANCEMENT_STRIP_REGEX, '').trim();
            if (!baseName) return;

            for (const [, cnName] of Object.entries(this.cnNames)) {
                if (cnName === baseName) return;
            }

            const hrid = this.findHridFromDomName(baseName);
            if (hrid) {
                this.cnNames[hrid] = baseName;
                this._scheduleSave();
            } else {
                // Log first 5 failures
                if (!this._failCount) this._failCount = 0;
                if (this._failCount < 5) {
                    console.log('[ItemNameTranslator] CJK text found but no HRID match:', baseName);
                    this._failCount++;
                }
            }
        }
    }

    const itemNameTranslator = new ItemNameTranslator();

    /**
     * Toolasha Entrypoint
     * Minimal bootstrap script that loads libraries and initializes features
     *
     * Libraries are loaded via @require in userscript header:
     * - Core (core modules, API)
     * - Utils (all utilities)
     * - Market (market, inventory, economy)
     * - Actions (production, gathering, alchemy)
     * - Combat (combat, stats, abilities)
     * - UI (tasks, skills, settings, misc)
     */

    // Access libraries from global namespace
    const Core = window.Toolasha.Core;
    const Utils = window.Toolasha.Utils;
    const Market = window.Toolasha.Market;
    const Actions = window.Toolasha.Actions;
    const Combat = window.Toolasha.Combat;
    const UI = window.Toolasha.UI;

    // Destructure core modules
    const { storage, config, webSocketHook, domObserver, dataManager, featureRegistry } = Core;

    const { setupScrollTooltipDismissal } = Utils.dom;

    /**
     * Detect if running on Combat Simulator page
     * @returns {boolean} True if on Combat Simulator
     */
    function isCombatSimulatorPage() {
        const url = window.location.href;
        // Only work on test Combat Simulator for now
        return url.includes('shykai.github.io/MWICombatSimulatorTest/dist/');
    }

    /**
     * Register all features from libraries into the feature registry
     */
    function registerFeatures() {
        // Market Features
        const marketFeatures = [
            {
                key: 'tooltipPrices',
                name: 'Tooltip Prices',
                category: 'Market',
                module: Market.tooltipPrices,
                async: true,
                customCheck: () => config.getSetting('itemTooltip_prices') || config.getSetting('itemTooltip_pinTop'),
            },
            {
                key: 'expectedValueCalculator',
                name: 'Expected Value Calculator',
                category: 'Market',
                module: Market.expectedValueCalculator,
                async: true,
            },
            {
                key: 'tooltipConsumables',
                name: 'Tooltip Consumables',
                category: 'Market',
                module: Market.tooltipConsumables,
                async: true,
            },
            {
                key: 'dungeonTokenTooltips',
                name: 'Dungeon Token Tooltips',
                category: 'Inventory',
                module: Market.dungeonTokenTooltips,
                async: true,
            },
            { key: 'marketFilter', name: 'Market Filter', category: 'Market', module: Market.marketFilter, async: false },
            { key: 'marketSort', name: 'Market Sort', category: 'Market', module: Market.marketSort, async: false },
            {
                key: 'autoFillPrice',
                name: 'Auto Fill Price',
                category: 'Market',
                module: Market.autoFillPrice,
                async: false,
            },
            {
                key: 'autoClickMax',
                name: 'Auto Click Max',
                category: 'Market',
                module: Market.autoClickMax,
                async: false,
            },
            {
                key: 'itemCountDisplay',
                name: 'Item Count Display',
                category: 'Market',
                module: Market.itemCountDisplay,
                async: false,
            },
            {
                key: 'listingPriceDisplay',
                name: 'Listing Price Display',
                category: 'Market',
                module: Market.listingPriceDisplay,
                async: false,
            },
            {
                key: 'estimatedListingAge',
                name: 'Estimated Listing Age',
                category: 'Market',
                module: Market.estimatedListingAge,
                async: false,
            },
            {
                key: 'queueLengthEstimator',
                name: 'Queue Length Estimator',
                category: 'Market',
                module: Market.queueLengthEstimator,
                async: false,
            },
            {
                key: 'marketOrderTotals',
                name: 'Market Order Totals',
                category: 'Market',
                module: Market.marketOrderTotals,
                async: false,
            },
            {
                key: 'marketHistoryViewer',
                name: 'Market History Viewer',
                category: 'Market',
                module: Market.marketHistoryViewer,
                async: false,
            },
            {
                key: 'philoCalculator',
                name: 'Philo Calculator',
                category: 'Market',
                module: Market.philoCalculator,
                async: false,
            },
            { key: 'tradeHistory', name: 'Trade History', category: 'Market', module: Market.tradeHistory, async: false },
            {
                key: 'tradeHistoryDisplay',
                name: 'Trade History Display',
                category: 'Market',
                module: Market.tradeHistoryDisplay,
                async: false,
            },
            {
                key: 'milkywayMarketLink',
                name: 'MilkyWay Market Link',
                category: 'Market',
                module: Market.milkywayMarketLink,
                async: false,
            },
            { key: 'networth', name: 'Net Worth', category: 'Economy', module: Market.networthFeature, async: false },
            {
                key: 'inventoryBadgeManager',
                name: 'Inventory Badge Manager',
                category: 'Inventory',
                module: Market.inventoryBadgeManager,
                async: false,
            },
            {
                key: 'inventorySort',
                name: 'Inventory Sort',
                category: 'Inventory',
                module: Market.inventorySort,
                async: false,
            },
            {
                key: 'inventoryBadgePrices',
                name: 'Inventory Badge Prices',
                category: 'Inventory',
                module: Market.inventoryBadgePrices,
                async: false,
            },
            {
                key: 'invCategoryTotals',
                name: 'Inventory Category Totals',
                category: 'Inventory',
                module: Market.inventoryCategoryTotals,
                async: false,
            },
            {
                key: 'autoAllButton',
                name: 'Auto All Button',
                category: 'Inventory',
                module: Market.autoAllButton,
                async: false,
            },
            {
                key: 'inventoryTabs',
                name: 'Custom Inventory Tabs',
                category: 'Inventory',
                module: Market.customTabsFeature,
                async: true,
            },
        ];

        // Actions Features
        const actionsFeatures = [
            {
                key: 'actionTimeDisplay',
                name: 'Action Time Display',
                category: 'Actions',
                module: Actions.actionTimeDisplay,
                async: false,
            },
            {
                key: 'actionCountdown',
                name: 'Action Bar Countdown',
                category: 'Actions',
                module: Actions.actionCountdown,
                async: false,
            },
            {
                key: 'quickInputButtons',
                name: 'Quick Input Buttons',
                category: 'Actions',
                module: Actions.quickInputButtons,
                async: false,
            },
            { key: 'outputTotals', name: 'Output Totals', category: 'Actions', module: Actions.outputTotals, async: false },
            {
                key: 'maxProduceable',
                name: 'Max Produceable',
                category: 'Actions',
                module: Actions.maxProduceable,
                async: false,
            },
            {
                key: 'gatheringStats',
                name: 'Gathering Stats',
                category: 'Actions',
                module: Actions.gatheringStats,
                async: false,
            },
            {
                key: 'requiredMaterials',
                name: 'Required Materials',
                category: 'Actions',
                module: Actions.requiredMaterials,
                async: false,
            },
            {
                key: 'missingMaterialsButton',
                name: 'Missing Materials Button',
                category: 'Actions',
                module: Actions.missingMaterialsButton,
                async: false,
            },
            {
                key: 'budgetCalculator',
                name: 'Budget Calculator',
                category: 'Actions',
                module: Actions.budgetCalculator,
                async: false,
            },
            {
                key: 'craftingPlan',
                name: 'Crafting Plan',
                category: 'Actions',
                module: Actions.craftingPlan,
                async: false,
            },
            {
                key: 'alchemyProfitDisplay',
                name: 'Alchemy Profit Display',
                category: 'Alchemy',
                module: Actions.alchemyProfitDisplay,
                async: false,
            },
            {
                key: 'alchemyBestItems',
                name: 'Alchemy Best Items',
                category: 'Alchemy',
                module: Actions.alchemyBestItems,
                async: false,
                customCheck: () => config.getSetting('alchemy_bestItems'),
            },
            {
                key: 'teaRecommendation',
                name: 'Tea Recommendation',
                category: 'Actions',
                module: Actions.teaRecommendation,
                async: false,
            },
            {
                key: 'lootLogStats',
                name: 'Loot Log Statistics',
                category: 'Actions',
                module: UI.lootLogStats,
                async: false,
            },
            {
                key: 'inventoryCountDisplay',
                name: 'Inventory Count Display',
                category: 'Actions',
                module: Actions.inventoryCountDisplay,
                async: false,
            },
            {
                key: 'pinnedActionsPage',
                name: 'Pinned Actions Page',
                category: 'Actions',
                module: Actions.pinnedActionsPage,
                async: false,
            },
        ];

        // Combat Features
        const combatFeatures = [
            {
                key: 'abilityBookCalculator',
                name: 'Ability Book Calculator',
                category: 'Combat',
                module: Combat.abilityBookCalculator,
                async: false,
            },
            { key: 'zoneIndices', name: 'Zone Indices', category: 'Combat', module: Combat.zoneIndices, async: false },
            { key: 'combatScore', name: 'Combat Score', category: 'Profile', module: Combat.combatScore, async: false },
            {
                key: 'characterCardButton',
                name: 'Character Card Button',
                category: 'Profile',
                module: Combat.characterCardButton,
                async: false,
            },
            {
                key: 'loadoutEnhancementDisplay',
                name: 'Loadout Enhancement Display',
                category: 'Combat',
                module: Combat.loadoutEnhancementDisplay,
                async: false,
            },
            {
                key: 'dungeonTracker',
                name: 'Dungeon Tracker',
                category: 'Combat',
                module: Combat.dungeonTracker,
                async: false,
            },
            {
                key: 'dungeonTrackerUI',
                name: 'Dungeon Tracker UI',
                category: 'Combat',
                module: Combat.dungeonTrackerUI,
                async: false,
            },
            {
                key: 'dungeonTrackerChatAnnotations',
                name: 'Dungeon Tracker Chat',
                category: 'Combat',
                module: Combat.dungeonTrackerChatAnnotations,
                async: false,
            },
            {
                key: 'combatBattleCounter',
                name: 'Combat Battle Counter',
                category: 'Combat',
                module: Combat.combatBattleCounter,
                async: false,
            },
            {
                key: 'combatSummary',
                name: 'Combat Summary',
                category: 'Combat',
                module: Combat.combatSummary,
                async: false,
            },
            { key: 'combatStats', name: 'Combat Stats', category: 'Combat', module: Combat.combatStats, async: true },
            {
                key: 'labyrinthTracker',
                name: 'Labyrinth Tracker',
                category: 'Combat',
                module: Combat.labyrinthTracker,
                async: false,
            },
            {
                key: 'labyrinthBestLevel',
                name: 'Labyrinth Best Level',
                category: 'Combat',
                module: Combat.labyrinthBestLevel,
                async: false,
            },
            {
                key: 'labyrinthShopPrices',
                name: 'Labyrinth Shop Prices',
                category: 'Combat',
                module: Combat.labyrinthShopPrices,
                async: false,
            },
            {
                key: 'labyrinthClearRate',
                name: 'Labyrinth Clear Rate',
                category: 'Combat',
                module: Combat.labyrinthClearRate,
                async: false,
            },
            {
                key: 'loadoutSort',
                name: 'Loadout Sort',
                category: 'Combat',
                module: Combat.loadoutSort,
                async: false,
            },
            {
                key: 'loadoutSnapshot',
                name: 'Loadout Snapshots',
                category: 'Combat',
                module: Combat.loadoutSnapshot,
                async: true,
            },
            {
                key: 'scrollSimulatorUI',
                name: 'Scroll Simulator UI',
                category: 'Combat',
                module: Combat.scrollSimulatorUI,
                async: false,
            },
            {
                key: 'combatSim',
                name: 'Combat Simulator',
                category: 'Combat',
                module: Combat.combatSim,
                async: false,
            },
            {
                key: 'combatSim',
                name: 'Lab Simulator',
                category: 'Combat',
                module: Combat.labSim,
                async: false,
            },
        ];

        // UI Features
        const uiFeatures = [
            {
                key: 'equipmentLevelDisplay',
                name: 'Equipment Level Display',
                category: 'UI',
                module: UI.equipmentLevelDisplay,
                async: false,
            },
            {
                key: 'alchemyItemDimming',
                name: 'Alchemy Item Dimming',
                category: 'UI',
                module: UI.alchemyItemDimming,
                async: false,
            },
            {
                key: 'skillExperiencePercentage',
                name: 'Skill Experience Percentage',
                category: 'UI',
                module: UI.skillExperiencePercentage,
                async: false,
            },
            { key: 'externalLinks', name: 'External Links', category: 'UI', module: UI.externalLinks, async: false },
            {
                key: 'hideLabyrinthBadge',
                name: 'Hide Labyrinth Badge',
                category: 'UI',
                module: UI.hideLabyrinthBadge,
                async: false,
            },
            {
                key: 'tabReorder',
                name: 'Tab Reorder',
                category: 'UI',
                module: UI.tabReorder,
                async: true,
            },
            {
                key: 'altClickNavigation',
                name: 'Alt+Click Navigation',
                category: 'Navigation',
                module: UI.altClickNavigation,
                async: false,
            },
            {
                key: 'collectionNavigation',
                name: 'Collection Navigation',
                category: 'Navigation',
                module: UI.collectionNavigation,
                async: false,
            },
            {
                key: 'collectionFilters',
                name: 'Collection Filters',
                category: 'Collection',
                module: UI.collectionFilters,
                async: true,
                customCheck: () =>
                    config.isFeatureEnabled('collectionFilters') || config.isFeatureEnabled('collectionFavorites'),
            },
            { key: 'chatCommands', name: 'Chat Commands', category: 'Chat', module: UI.chatCommands, async: true },
            { key: 'mentionTracker', name: 'Mention Tracker', category: 'Chat', module: UI.mentionTracker, async: true },
            { key: 'popOutChat', name: 'Pop-Out Chat', category: 'Chat', module: UI.popOutChat, async: true },
            { key: 'chatBlockList', name: 'Chat Block List', category: 'Chat', module: UI.chatBlockList, async: false },
            {
                key: 'chatHistoryExtender',
                name: 'Chat History Extender',
                category: 'Chat',
                module: UI.chatHistoryExtender,
                async: false,
            },
            {
                key: 'taskProfitDisplay',
                name: 'Task Profit Display',
                category: 'Tasks',
                module: UI.taskProfitDisplay,
                async: false,
                customCheck: () =>
                    config.getSetting('taskProfitCalculator') ||
                    config.getSetting('taskGoMerge') ||
                    config.getSetting('taskQueuedIndicator') ||
                    config.getSetting('taskMaterialsIndicator') ||
                    config.getSetting('taskEfficiencyRating'),
            },
            {
                key: 'taskRerollTracker',
                name: 'Task Reroll Tracker',
                category: 'Tasks',
                module: UI.taskRerollTracker,
                async: false,
            },
            { key: 'taskSorter', name: 'Task Sorter', category: 'Tasks', module: UI.taskSorter, async: false },
            { key: 'taskIcons', name: 'Task Icons', category: 'Tasks', module: UI.taskIcons, async: false },
            {
                key: 'taskInventoryHighlighter',
                name: 'Task Inventory Highlighter',
                category: 'Tasks',
                module: UI.taskInventoryHighlighter,
                async: false,
            },
            {
                key: 'taskStatistics',
                name: 'Task Statistics',
                category: 'Tasks',
                module: UI.taskStatistics,
                async: false,
            },
            {
                key: 'taskClaimCollector',
                name: 'Task Claim Collector',
                category: 'Tasks',
                module: UI.taskClaimCollector,
                async: false,
            },
            {
                key: 'taskRerollProtection',
                name: 'Task Reroll Protection',
                category: 'Tasks',
                module: UI.taskRerollProtection,
                async: true,
            },
            {
                key: 'taskAutoReroll',
                name: 'Task Auto-Reroll Reminder',
                category: 'Tasks',
                module: UI.taskAutoReroll,
                async: true,
            },
            { key: 'skillRemainingXP', name: 'Remaining XP', category: 'Skills', module: UI.remainingXP, async: false },
            { key: 'xpTracker', name: 'XP/hr Tracker', category: 'Skills', module: UI.xpTracker, async: false },
            {
                key: 'housePanelObserver',
                name: 'House Panel Observer',
                category: 'House',
                module: UI.housePanelObserver,
                async: false,
            },
            {
                key: 'transmuteRates',
                name: 'Transmute Rates',
                category: 'Dictionary',
                module: UI.transmuteRates,
                async: false,
            },
            {
                key: 'alchemy_transmuteHistory',
                name: 'Transmute History Tracker',
                category: 'Alchemy',
                module: UI.transmuteHistoryTracker,
                async: false,
            },
            {
                key: 'alchemy_transmuteHistoryViewer',
                name: 'Transmute History Viewer',
                category: 'Alchemy',
                module: UI.transmuteHistoryViewer,
                async: false,
            },
            {
                key: 'alchemy_coinifyHistory',
                name: 'Coinify History Tracker',
                category: 'Alchemy',
                module: UI.coinifyHistoryTracker,
                async: false,
            },
            {
                key: 'alchemy_coinifyHistoryViewer',
                name: 'Coinify History Viewer',
                category: 'Alchemy',
                module: UI.coinifyHistoryViewer,
                async: false,
            },
            {
                key: 'alchemy_decomposeHistory',
                name: 'Decompose History Tracker',
                category: 'Alchemy',
                module: UI.decomposeHistoryTracker,
                async: false,
            },
            {
                key: 'alchemy_decomposeHistoryViewer',
                name: 'Decompose History Viewer',
                category: 'Alchemy',
                module: UI.decomposeHistoryViewer,
                async: false,
            },
            {
                key: 'alchemy_actionProtection',
                name: 'Alchemy Action Protection',
                category: 'Alchemy',
                module: UI.alchemyActionProtection,
                async: true,
            },
            {
                key: 'enhancementFeature',
                name: 'Enhancement Tracker',
                category: 'Enhancement',
                module: UI.enhancementFeature,
                async: false,
            },
            {
                key: 'enhancementXPH',
                name: 'Enhancement XPH Calculator',
                category: 'Enhancement',
                module: UI.xphCalculator,
                async: false,
            },
            {
                key: 'guildXPTracker',
                name: 'Guild XP Tracker',
                category: 'Guild',
                module: UI.guildXPTracker,
                async: false,
            },
            {
                key: 'guildXPDisplay',
                name: 'Guild XP Display',
                category: 'Guild',
                module: UI.guildXPDisplay,
                async: false,
            },
            {
                key: 'emptyQueueNotification',
                name: 'Empty Queue Notification',
                category: 'Notifications',
                module: UI.emptyQueueNotification,
                async: false,
            },
            {
                key: 'queueMonitor',
                name: 'Queue Monitor',
                category: 'General',
                module: UI.queueMonitor,
                async: false,
            },
        ];

        // Combine all features
        const allFeatures = [...marketFeatures, ...actionsFeatures, ...combatFeatures, ...uiFeatures];

        // Convert to feature registry format
        const features = allFeatures.map((feature) => ({
            key: feature.key,
            name: feature.name,
            category: feature.category,
            initialize: () => feature.module.initialize(),
            disable: typeof feature.module.disable === 'function' ? () => feature.module.disable() : undefined,
            async: feature.async,
            customCheck: feature.customCheck || undefined,
        }));

        // Replace feature registry's features array
        featureRegistry.replaceFeatures(features);
    }

    if (isCombatSimulatorPage()) {
        // Initialize combat sim integration only
        Combat.combatSimIntegration.initialize();

        // Skip all other initialization
    } else {
        // CRITICAL: Install WebSocket hook FIRST, before game connects
        webSocketHook.install();

        // CRITICAL: Start centralized DOM observer SECOND, before features initialize
        domObserver.start();

        // Set up scroll listener to dismiss stuck tooltips
        setupScrollTooltipDismissal();

        // Initialize network alert (must be early, before market features)
        Market.networkAlert.initialize();

        // Start capturing client data from localStorage (for Combat Sim export)
        webSocketHook.captureClientDataFromLocalStorage();

        // Register all features from libraries
        registerFeatures();

        // Initialize action panel observer (special case - not a regular feature)
        Actions.initActionPanelObserver();

        // Initialize storage and config THIRD (async)
        // Store the promise so character_initialized can wait for storage readiness
        const storageReady = (async () => {
            try {
                // Initialize storage (opens IndexedDB)
                await storage.initialize();

                // Initialize config (loads settings from storage)
                await config.initialize();

                // Add beforeunload handler to flush all pending writes
                window.addEventListener('beforeunload', () => {
                    storage.flushAll();
                    itemNameTranslator.flush();
                });

                // Initialize Data Manager immediately
                // Don't wait for localStorageUtil - it handles missing data gracefully
                dataManager.initialize();

                // Load Chinese item name cache from storage + bulk import from game i18n
                await itemNameTranslator.load();
                if (document.body) {
                    itemNameTranslator.startObserver();
                } else {
                    document.addEventListener('DOMContentLoaded', () => itemNameTranslator.startObserver(), { once: true });
                }
            } catch (error) {
                console.error('[Toolasha] Storage/config initialization failed:', error);
                // Initialize anyway
                dataManager.initialize();
            }
        })();

        // Setup character switch handler once (NOT inside character_initialized listener)
        featureRegistry.setupCharacterSwitchHandler();

        dataManager.on('character_initialized', (_data) => {
            // Skip full initialization during character switches
            // The character_switched handler in feature-registry already handles reinitialization
            if (_data._isCharacterSwitch) {
                return;
            }

            // Initialize all features using the feature registry
            setTimeout(async () => {
                try {
                    // Ensure storage/config are initialized before loading character settings
                    // On Steam, character data can arrive before IndexedDB is open
                    await storageReady;

                    // Reload config settings with character-specific data
                    await config.loadSettings();
                    config.applyColorSettings();

                    // Initialize scroll simulator storage (character-specific)
                    await Combat.scrollSimulator.initialize().catch((error) => {
                        console.error('[Toolasha] Scroll simulator initialization failed:', error);
                    });

                    // Initialize Settings UI after character data is loaded
                    await UI.settingsUI.initialize().catch((error) => {
                        console.error('[Toolasha] Settings UI initialization failed:', error);
                    });

                    await featureRegistry.initializeFeatures();

                    // Health check after initialization
                    setTimeout(async () => {
                        const failedFeatures = featureRegistry.checkFeatureHealth();

                        // Note: Settings tab health check removed - tab only appears when user opens settings panel

                        if (failedFeatures.length > 0) {
                            console.warn(
                                '[Toolasha] Health check found failed features:',
                                failedFeatures.map((f) => f.name)
                            );

                            setTimeout(async () => {
                                await featureRegistry.retryFailedFeatures(failedFeatures);

                                // Final health check
                                const stillFailed = featureRegistry.checkFeatureHealth();
                                if (stillFailed.length > 0) {
                                    console.warn(
                                        '[Toolasha] These features could not initialize:',
                                        stillFailed.map((f) => f.name)
                                    );
                                    console.warn(
                                        '[Toolasha] Try refreshing the page or reopening the relevant game panels'
                                    );
                                }
                            }, 1000);
                        }
                    }, 500); // Wait 500ms after initialization to check health
                } catch (error) {
                    console.error('[Toolasha] Feature initialization failed:', error);
                }
            }, 100);
        });

        // Expose minimal user-facing API
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        targetWindow.Toolasha.version = '2.59.7';

        // Feature toggle API (for users to manage settings via console)
        targetWindow.Toolasha.features = {
            list: () => config.getFeaturesByCategory(),
            enable: (key) => config.setFeatureEnabled(key, true),
            disable: (key) => config.setFeatureEnabled(key, false),
            toggle: (key) => config.toggleFeature(key),
            status: (key) => config.isFeatureEnabled(key),
            info: (key) => config.getFeatureInfo(key),
        };

        // Guild XP data management
        targetWindow.Toolasha.guild = {
            resetMemberXP: () => UI.guildXPTracker.resetMemberData(),
        };

        // Debug utilities (for diagnosing issues via console)
        targetWindow.Toolasha.debug = {
            storage: () => {
                const diag = storage.diagnostics();
                console.log('=== Storage Diagnostics ===');
                console.log('DB connection exists:', diag.dbExists);
                console.log('Storage available:', diag.available);
                console.log('DB name:', diag.dbName);
                console.log('DB version:', diag.dbVersion);
                console.log('Reconnecting:', diag.reconnecting);
                console.log('Last null reason:', diag.lastNullReason || 'never');
                console.log('Pending writes:', diag.pendingWrites);
                console.log('Active timers:', diag.activeTimers);
                return diag;
            },
        };
    }

})();
