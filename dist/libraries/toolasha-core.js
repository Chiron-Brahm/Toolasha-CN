/**
 * Toolasha Core Library
 * Core infrastructure and API clients
 * Version: 2.63.2
 * License: CC-BY-NC-SA-4.0
 */

(function () {
    'use strict';

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

    const storage = new Storage();

    /**
     * Internationalization (i18n) Module
     * Lightweight translation layer with English-as-key fallback.
     *
     * Usage:
     *   import { t, registerLocale } from '../core/i18n.js';
     *   t('Market Prices in Tooltips')  →  '市场价格提示' (if translated)
     *   t('Market Prices in Tooltips')  →  'Market Prices in Tooltips' (fallback)
     *   t('Cost: {0}/hr', '100K')       →  '花费: 100K/时'
     */

    /** @type {Record<string, string>} */
    const translations = {};

    /**
     * Register a locale dictionary.
     * Merges into existing translations (last write wins for duplicate keys).
     * @param {string} _localeCode - Locale identifier (e.g., 'zh-CN'), reserved for future multi-locale support
     * @param {Record<string, string>} dict - Key-value translation pairs
     */
    function registerLocale(_localeCode, dict) {
        Object.assign(translations, dict);
    }

    /**
     * Translate a string. Returns the Chinese translation if available, otherwise the English key itself.
     * Supports positional interpolation with {0}, {1}, etc.
     *
     * @param {string} str - English key string
     * @param {...(string|number)} args - Positional arguments for interpolation
     * @returns {string} Translated or fallback string
     *
     * @example
     *   t('Hello')                          // '你好'
     *   t('Unknown key')                    // 'Unknown key' (fallback)
     *   t('Profit: {0}/hr', '12.3K')        // '利润: 12.3K/时'
     */
    function t(str, ...args) {
        const translated = translations[str] !== undefined ? translations[str] : str;

        if (args.length === 0) {
            return translated;
        }

        return translated.replace(/\{(\d+)\}/g, (_, index) => {
            const arg = args[parseInt(index, 10)];
            return arg !== undefined ? String(arg) : `{${index}}`;
        });
    }

    registerLocale('zh-CN', {
        ' (Default)': '（默认）',
        ' (Equipment hidden)': '（装备已隐藏）',
        ' - Abilities & Triggers': ' - 能力与触发',
        ' [Clear {0}% | +{1}/+{2} | {3} left]': ' [通关 {0}% | +{1}/+{2} | 剩余{3}]',
        ' [Clear {0}% | {1} left]': ' [通关 {0}% | 剩余{1}]',
        ' times': ' 次',
        ' | Missing: {0} (open their profiles)': '| 缺少：{0}（打开其角色页面）',
        '%': '%',
        '% success': '% 成功率',
        '* = partial price data.': '* = 部分价格数据。',
        '+ Add Text': '+ 添加文本',
        '+ Exclude': '+ 排除',
        '+ Import': '+ 导入',
        '+ Import Player': '+ 导入角色',
        '+ Pane': '+ 面板',
        '+ Tab': '+ 标签页',
        '+10 and above': '+10 及以上',
        '+11 and above': '+11 及以上',
        '+12 and above': '+12 及以上',
        '+13 and above (recommended)': '+13 及以上（推荐）',
        '+15 and above': '+15 及以上',
        '+Levels': '+等级',
        '-': '-',
        '- Direct array: [{listing1}, {listing2}, ...]': '- 直接数组：[{listing1}, {listing2}, ...]',
        '- Edible Tools format: {': '- Edible Tools格式：{',
        '- Object format: {': '- 对象格式：{',
        '/': '/',
        '/action_types/alchemy': '/action_types/alchemy',
        '/action_types/enhancing': '/action_types/enhancing',
        '/buff_types/accuracy': '/增益类型/命中',
        '/buff_types/cast_speed': '/增益类型/施法速度',
        '/buff_types/combat_drop_quantity': '/增益类型/战斗掉落数量',
        '/buff_types/combat_drop_rate': '/增益类型/战斗掉落率',
        '/buff_types/critical_damage': '/增益类型/暴击伤害',
        '/buff_types/critical_rate': '/增益类型/暴击率',
        '/buff_types/damage': '/增益类型/伤害',
        '/buff_types/damage_taken': '/增益类型/所受伤害',
        '/buff_types/elemental_thorns': '/增益类型/元素荆棘',
        '/buff_types/fire_amplify': '/增益类型/火焰增强',
        '/buff_types/fury_accuracy': '/增益类型/狂怒命中',
        '/buff_types/fury_damage': '/增益类型/狂怒伤害',
        '/buff_types/healing_amplify': '/增益类型/治疗增强',
        '/buff_types/hp_regen': '/增益类型/生命恢复',
        '/buff_types/life_steal': '/增益类型/生命偷取',
        '/buff_types/mp_regen': '/增益类型/法力恢复',
        '/buff_types/nature_amplify': '/增益类型/自然增强',
        '/buff_types/physical_amplify': '/增益类型/物理增强',
        '/buff_types/physical_thorns': '/增益类型/物理荆棘',
        '/buff_types/rare_find': '/增益类型/稀有发现',
        '/buff_types/retaliation': '/增益类型/反击',
        '/buff_types/tenacity': '/增益类型/坚韧',
        '/buff_types/threat': '/增益类型/威胁',
        '/buff_types/water_amplify': '/增益类型/水源增强',
        '/buff_types/wisdom': '/增益类型/智慧',
        '/day': '/天',
        '/hr': '/时',
        '/item_locations/pouch': '/item_locations/pouch',
        '/item_locations/trinket': '/item_locations/trinket',
        '/items/philosophers_mirror': '/items/philosophers_mirror',
        '12-hour (2:30 PM)': '12小时制（下午2:30）',
        '24-hour (14:30)': '24小时制（14:30）',
        '2d': '2d',
        ':': '：',
        '::': '：',
        '< 1 minute': '< 1 分钟',
        Abilities: '技能',
        'Abilities: {0}': '能力：{0}',
        'Ability Books ({0}): {1}': '技能书({0})：{1}',
        'Ability Levels': '技能等级',
        'Ability Slot': '技能槽位',
        'Ability Swaps': '技能切换',
        'Ability: {0}': '能力：{0}',
        'Absolute target level for all abilities': '所有技能的绝对目标等级',
        'Achievement Bonus': '成就加成',
        'Achievement bonus (+0.2%)': '成就加成（+0.2%）',
        'Achievement:': '成就：',
        Action: '行动',
        'Action Panel Enhancements': '行动面板增强',
        'Action Profit': '行动利润',
        'Action Profit:': '行动利润：',
        'Action Speed & Time': '行动速度与时间',
        'Action Speed: +{0}': '行动速度：+{0}',
        'Action bar: Actions/hr and items/hr': '行动栏：行动/小时和物品/小时',
        'Action bar: Compact width (800px limit)': '行动栏：紧凑宽度（限制800px）',
        'Action bar: Enable action bar display': '行动栏：启用行动栏显示',
        'Action bar: Live countdown timer': '行动栏：实时倒计时',
        'Action bar: Queue/remaining count': '行动栏：队列/剩余数量',
        'Action bar: Time per action (e.g. 14.94s/action)': '行动栏：每次行动时间（如14.94秒/次）',
        'Action bar: Time remaining and completion ETA': '行动栏：剩余时间和完成预估',
        'Action bar: Transmute recycle time estimate': '行动栏：转化回收时间预估',
        'Action page: Show exp/hr on tiles': '行动页：在方块上显示经验/小时',
        'Action page: Show profit/hr on tiles': '行动页：在方块上显示利润/小时',
        'Action panel: Budget calculator': '行动面板：预算计算器',
        'Action panel: Crafting plan buys raw materials only': '行动面板：制作计划仅购买原材料',
        'Action panel: Crafting plan gold/hr value': '行动面板：制作计划金币/小时价值',
        'Action panel: Crafting plan no processing': '行动面板：制作计划不加工',
        'Action panel: Crafting plan task mode': '行动面板：制作计划任务模式',
        'Action panel: Crafting plan time cost': '行动面板：制作计划时间成本',
        'Action panel: Custom count presets (comma-separated, e.g. 100,1000,1000000)':
            '行动面板：自定义数量预设（逗号分隔，如100,1000,1000000）',
        'Action panel: Custom hour presets (comma-separated, e.g. 0.5,1,24,168,720)':
            '行动面板：自定义小时预设（逗号分隔，如0.5,1,24,168,720）',
        'Action panel: Hide actions with negative profit': '行动面板：隐藏负利润行动',
        'Action panel: Overall profit for multi-outcome foraging': '行动面板：多产出采集的总体利润',
        'Action panel: Quick input buttons (hours, count presets, Max)': '行动面板：快速输入按钮（小时、数量预设、最大）',
        'Action panel: Show best crafting plan': '行动面板：显示最佳制作方案',
        'Action panel: Show level progress': '行动面板：显示等级进度',
        'Action panel: Show max produceable count on crafting actions': '行动面板：显示制作行动的最大可制作数量',
        'Action panel: Show profitability detail': '行动面板：显示利润详情',
        'Action panel: Show total expected outputs below per-action outputs': '行动面板：在单次产出下方显示总预期产出',
        'Action panel: Show total required and missing materials': '行动面板：显示所需和缺失材料总量',
        'Action panel: Total time, times to reach target level, exp/hour': '行动面板：总时间、达到目标等级次数、经验/小时',
        'Action panels: Show current inventory count of output item': '行动面板：显示产出物品的当前背包数量',
        Actions: '行动',
        'Actions: {0} @ {1}s each': '行动：每次{0}个 @ {1}秒',
        'Actions: {0}/hr': '行动：{0}/时',
        'Actions: {0}/hr | Efficiency: +{1}%': '行动：{0}/时 | 效率：+{1}%',
        'Actions: {0}/{1}': '行动：{0}/{1}',
        'Active Only': '仅活跃',
        'Active Units': '活跃单位',
        Activity: '活动',
        'Add navigation buttons to collection items': '为收藏品添加导航按钮',
        'Add subtab': '添加子标签页',
        'Add to Tab': '添加到标签页',
        'Adds ': '添加 ',
        'Adds 10, 100, 1000 preset quantity buttons to buy/sell dialogs': '在买卖对话框中添加10、100、1000预设数量按钮',
        'Adds View Action and Item Dictionary buttons when clicking collection items':
            '点击收藏品时添加查看行动和物品词典按钮',
        'Adds a Marketplace Action dropdown to item menus with Sell Now, Buy Now, and listing shortcuts':
            '在物品菜单中添加市场行动下拉菜单，包含立即出售、立即购买和挂单快捷操作',
        'Adds a Pinned button to the left nav bar that shows all pinned actions in one list with skill, level, profit/hr, and XP/hr.':
            '在左侧导航栏添加已固定按钮，在一个列表中显示所有已固定行动，包含技能、等级、利润/小时和经验/小时。',
        'Adds a Statistics button to the Combat panel showing income, profit, consumable costs, EXP, and drop details':
            '在战斗面板添加统计按钮，显示收入、利润、消耗品成本、经验和掉落详情',
        'Adds a Statistics button to the Tasks panel showing overflow time, expected rewards, and completion estimates':
            '在任务面板添加统计按钮，显示超时时间、预期奖励和完成预估',
        'Adds a Toolasha tab to the character panel where you can organize inventory items into personal tabs.':
            '在角色面板添加Toolasha标签页，可在其中将背包物品整理到个人标签页。',
        'Adds a black outline/shadow to the XP text for better readability against progress bars':
            '为经验文字添加黑色轮廓/阴影，使其在进度条上更易读',
        'Adds a budget input below the Missing Mats button. Enter a gold budget (e.g. 50m) to calculate how many units you can produce by buying missing tradeable materials at ask price.':
            '在缺失材料按钮下方添加预算输入框。输入金币预算（如50m）以计算通过按卖单价购买缺失可交易材料可生产的数量。',
        'Adds a button to dim inventory items not needed for your current non-combat tasks':
            '添加按钮来灰显当前非战斗任务不需要的背包物品',
        'Adds a button to see items ranked by profit or XP for each alchemy type.':
            '添加按钮按利润或经验查看每种炼金类型的物品排名。',
        'Adds a button to sort marketplace items by profit/hour. Items without profit data (drop-only) appear at the end.':
            '添加按钮按利润/小时排序市场物品。无利润数据（仅掉落）的物品排在末尾。',
        'Adds a button to the chat panel to open chat in a separate browser window with multi-channel split view':
            '在聊天面板添加按钮，在独立浏览器窗口中打开聊天，支持多频道分屏视图',
        'Adds a small link to view the current item on milkyway.market': '添加小链接在milkyway.market上查看当前物品',
        'Adds button to open character sheet in external viewer': '添加按钮在外部查看器中打开角色面板',
        'Adds button to production panels that opens marketplace with tabs for missing materials':
            '在生产面板添加按钮，打开带有缺失材料标签的市场',
        'Adds colored timer annotations to ': '为...添加彩色计时标注',
        'Adds quick links to Combat Sim, Market Tracker, Enhancelator, and Milkonomy':
            '添加战斗模拟器、市场追踪器、强化计算器和Milkonomy的快速链接',
        'Adds ÷2 and ×2 buttons to the price and quantity rows in buy/sell dialogs':
            '在买卖对话框的价格和数量行中添加÷2和×2按钮',
        'Adjust tooltip prices for Artisan Tea reduction': '调整工匠茶减半后的提示价格',
        Advanced: '高级',
        'After {0} days:': '{0}天后：',
        Alchemy: '炼金术',
        'Alchemy Action Protection': '炼金行动保护',
        'Alchemy panel: Dim items requiring higher level': '炼金面板：灰显需要更高等级的物品',
        'Alchemy panel: Protect categories from accidental alchemy actions': '炼金面板：保护分类防止误操作',
        'Alchemy panel: Show best items button': '炼金面板：显示最佳物品按钮',
        'Alchemy panel: Show profit calculator': '炼金面板：显示利润计算器',
        'Alchemy panel: Track and view coinify session history': '炼金面板：追踪和查看铸币会话历史',
        'Alchemy panel: Track and view decompose session history': '炼金面板：追踪和查看分解会话历史',
        'Alchemy panel: Track and view transmute session history': '炼金面板：追踪和查看转化会话历史',
        All: '全部',
        'All Abilities': '所有能力',
        'All Ability Books': '所有技能书',
        'All Allies': '所有盟友',
        'All Drops': '所有掉落',
        'All Dungeons': '所有副本',
        'All Enemies': '所有敌人',
        'All Equipped Items': '所有已装备物品',
        'All Houses': '所有房屋',
        'All Market Listings': '所有市场挂单',
        'All Off': '全部关闭',
        'All Skills': '所有技能',
        'All Statuses': '所有状态',
        'All Teams': '所有队伍',
        'All Types': '所有类型',
        'All run history cleared.': '所有副本记录已清除。',
        'All zones complete in {0}: {1} zones \\u00b7 {2} hours each':
            '全部区域在{0}内完成：{1}个区域 \\u00b7 每区域{2}小时',
        'Already achieved': '已达到',
        'Already in this tab': '已在此标签页中',
        'Alt+click items to navigate to crafting/gathering or dictionary': '按住Alt并点击物品可跳转到制作/采集或词典',
        'Alternative Actions:': '替代行动：',
        'Alternatives:': '替代方案：',
        'Always craft items that have a recipe — only buy uncraftable raw materials from the market.':
            '始终制作有配方的物品——仅从市场购买不可制作的原材料。',
        'Analysis cancelled.': '分析已取消。',
        'Analysis failed:': '分析失败：',
        Analyze: '分析',
        'Analyze Upgrades': '分析升级',
        'Applied when no loadout matches the current skill (or loadout snapshots are disabled).':
            '当没有装备配置匹配当前技能时应用（或装备配置快照已禁用）。',
        'Applies to tooltips, action panels, profit displays, and all number formatting throughout the UI':
            '适用于提示、行动面板、利润显示和整个UI中的所有数字格式',
        Apply: '应用',
        'Are you absolutely sure you want to continue?': '你确定要继续吗？',
        Ask: '卖单价',
        'Ask (instant buy)': '卖单价（即时买入）',
        'Ask Price': '卖单价',
        Atk: '攻击',
        'Atk Speed': '攻速',
        Attack: '攻击力',
        'Attempt Factor': '尝试系数',
        Attempts: '尝试次数',
        'Auto-Reroll List': '自动重随列表',
        'Auto-click ': '自动点击 ',
        'Auto-click Max button on sell listing dialogs': '自动点击出售挂单对话框的最大按钮',
        'Auto-detect your stats (false = use settings below)': '自动检测你的属性（关闭=使用下方设置）',
        'Auto-fill buy price strategy': '自动填充买入价格策略',
        'Auto-fill marketplace orders with optimal price': '以最优价格自动填充市场订单',
        'Auto-fill sell price strategy': '自动填充卖出价格策略',
        'Automatically clicks the ': '自动点击 ',
        'Automatically clicks the Max button in the quantity field when opening Sell listing dialogs':
            '打开出售挂单对话框时自动点击数量字段中的最大按钮',
        'Automatically sort tasks when opening task panel': '打开任务面板时自动排序任务',
        'Automatically sorts tasks by skill type when you open the task panel': '打开任务面板时自动按技能类型排序任务',
        Automation: '自动化',
        Available: '可用',
        'Available: {0} - {1}': '可用：{0} - {1}',
        Average: '平均',
        'Avg Clear:': '平均通关：',
        'Avg Run': '平均通关',
        'Avg Run:': '平均通关：',
        'Avg completion time': '平均完成时间',
        'Avg {0}/hr: {1}': '平均{0}/时：{1}',
        'Avg:': '平均：',
        Azure: '蔚蓝',
        Back: '返回',
        Backfill: '回溯填充',
        'Backfill complete!\\n\\nRuns added: {0}\\nTeams: {1}': '回填完成！\\n\\n添加记录：{0}\\n队伍：{1}',
        'Backfill failed. Check console for details.': '回填失败，查看控制台了解详情。',
        'Badge type when ': '排序为...时的徽章类型',
        'Ban (force exclude)': '禁用（强制排除）',
        'Base Success Rate': '基础成功率',
        'Base:': '基础：',
        'Baseline Avg Clear:': '基准平均通关：',
        'Baseline:': '基准：',
        Basic: '基础',
        'Battle #': '战斗 #',
        'Battle ended:': '战斗结束：',
        'Battle started:': '战斗开始：',
        Beacon: '信标',
        'Begin enhancing to populate data': '开始强化以填充数据',
        'Below inventory: Show inventory summary': '背包下方：显示背包摘要',
        'Best Crafting Plan': '最佳制作方案',
        'Best Items': '最佳物品',
        'Best Items — {0}': '最佳物品 — {0}',
        'Best: {0}': '最佳：{0}',
        Bid: '买单价',
        'Bid (patient buy)': '买单价（挂单买入）',
        'Binary search for highest beatable level at the specified win rate threshold':
            '在指定胜率阈值下二分搜索最高可击败等级',
        'Blessed Tea active': '祝福茶激活',
        'Blessed:': '祝福：',
        'Blocks alchemy action buttons for 3 seconds when the selected item belongs to a protected category. A shield icon appears in the alchemy panel to configure protected categories.':
            '当所选物品属于受保护分类时，阻止炼金行动按钮3秒。炼金面板中出现盾牌图标用于配置受保护分类。',
        Body: '身体',
        'Body:': '身体：',
        'Books needed:': '所需技能书：',
        'Border and separator color': '边框和分隔线颜色',
        Borders: '边框',
        Both: '两者',
        'Bottom left corner of icons: Show equipment level': '图标左下角：显示装备等级',
        'Bottom left corner of key icons: Show zone index': '钥匙图标左下角：显示区域索引',
        Bottoms: '裤子',
        Brewing: '酿造',
        'Browser notification when action queue is empty': '行动队列为空时浏览器通知',
        'Budget (e.g. 50m)': '预算（如 50m）',
        'Budget Calculator': '预算计算器',
        'Budget: {0}': '预算：{0}',
        Burble: '泡泡',
        Buy: '买入',
        'Buy Item': '购买物品',
        'Buy Listing': '买入挂单',
        'Buy Missing Materials': '购买缺失材料',
        'Buy Now': '立即买入',
        'Buy Orders': '买单',
        'Buy Orders (coins locked in buy orders)': '买单（锁定在买单中的金币）',
        'Buy Price': '买入价格',
        'Buy from market': '从市场购买',
        'Buy on Marketplace': '在市场购买',
        'Buy only': '仅买入',
        'Buy raw materials only': '仅购买原材料',
        'Buy: Ask / Sell: Ask (Instant Buy / Patient Sell)': '买入：卖单价 / 卖出：卖单价（即时买入 / 挂单卖出）',
        'Buy: Ask / Sell: Bid (Instant Buy / Instant Sell)': '买入：卖单价 / 卖出：买单价（即时买入 / 即时卖出）',
        'Buy: Bid / Sell: Ask (Patient Buy / Patient Sell)': '买入：买单价 / 卖出：卖单价（挂单买入 / 挂单卖出）',
        'Buy: Bid / Sell: Bid (Patient Buy / Instant Sell)': '买入：买单价 / 卖出：买单价（挂单买入 / 即时卖出）',
        'CPU %': 'CPU %',
        'CSV file is empty or invalid': 'CSV文件为空或无效',
        Calculate: '计算',
        'Calculate expected value of transmuting items into Philosopher': '计算将物品转化为贤者之石的期望值',
        'Calculating...': '计算中...',
        'Calculating…': '计算中……',
        'Calls/s': '调用/秒',
        'Can produce: {0}': '可生产：{0}',
        Cancel: '取消',
        'Canceled Only': '仅已取消',
        Cape: '披风',
        'Cast Speed': '施法速度',
        'Catalyst Cost: {0}/hr': '催化剂成本：{0}/时',
        'Catalyst Price: ': '催化剂价格：',
        'Catalyst of Coinification': '铸币催化剂',
        'Catalyst of Decomposition': '分解催化剂',
        'Category Value': '类别价值',
        Celestial: '天界',
        'Character panel: Drag-and-drop tab reordering': '角色面板：拖拽标签页重新排序',
        Charm: '护符',
        'Chat: ': '聊天： ',
        'Chat: Extend chat history': '聊天：扩展聊天历史',
        'Chat: Max messages to retain per tab': '聊天：每个标签页保留的最大消息数',
        'Check All': '全选',
        Cheese: '奶酪',
        Cheesesmithing: '奶酪制作',
        'Choose how missing materials accounts for Artisan Tea reductions when suggesting what to buy.':
            '选择缺失材料在建议购买时如何处理工匠茶的减半效果。',
        'Choose how to calculate the total value for queued actions. Profit shows net earnings after materials and drinks. Estimated Value shows gross revenue after market tax (always positive).':
            '选择如何计算队列行动的总价值。利润显示扣除材料和饮品后的净收益。估算价值显示市场税后的总收入（始终为正）。',
        'Choose how to display listing creation times': '选择挂单创建时间的显示方式',
        'Choose whether to rate by task token payout or total profit.': '选择按任务代币发放或总利润进行评级。',
        'Claim Reward': '领取奖励',
        'Class: ': '类别：',
        Clear: '清除',
        'Clear All': '全部清除',
        'Clear All Filters': '清除所有筛选',
        'Clear Highlight': '清除高亮',
        'Clear History': '清除历史',
        'Clear Rate': '通关率',
        'Clear all enhancement sessions?': '清除所有强化记录？',
        'Clear all runs': '清除所有记录',
        'Clear all sessions': '清除所有记录',
        'Clear: {0}% | Expected: {1} | Room level: {2}': '通关率：{0}% | 预期：{1} | 房间等级：{2}',
        'Click again to confirm.': '再次点击确认。',
        'Click for item breakdown': '点击查看物品明细',
        'Click reroll now to confirm.': '点击重随确认。',
        'Click to expand': '点击展开',
        'Clipboard access denied. Please allow clipboard permissions for this site.':
            '剪贴板访问被拒绝。请允许此网站的剪贴板权限。',
        Close: '关闭',
        'Close pane': '关闭面板',
        Coffee: '咖啡',
        'Coin: {0}': '金币：{0}',
        'Coinify History': '铸币历史',
        'Coinify history cleared.': '铸币历史已清除。',
        Coins: '金币',
        'Coins Earned': '获得金币',
        'Coins:': '金币：',
        'Collapse panel': '收起面板',
        'Collapse/Expand': '折叠/展开',
        'Collection Favorites: Show favorites section at top of grid': '收藏收藏夹：在网格顶部显示收藏夹区域',
        'Collection Favorites: Star (★) items to mark and filter favorites': '收藏收藏夹：用星号（★）标记和筛选收藏品',
        'Collection Filters': '收藏筛选器',
        'Collection Filters: Count-range, dungeon, and skilling-outfit filters': '收藏筛选器：数量范围、副本和技能装备筛选',
        'Collection data not yet loaded — visit Collections page to refresh': '收藏数据尚未加载——请访问收藏页面刷新',
        'Color Customization': '颜色自定义',
        'Color for ': '颜色用于 ',
        'Color for Ask price badges on inventory items (seller asking price - better selling value)':
            '背包物品卖单价徽章的颜色（卖家要价——更好的出售价值）',
        'Color for Bid price badges on inventory items (buyer bid price - instant-sell value)':
            '背包物品买单价徽章的颜色（买家出价——即时出售价值）',
        'Color for XP/hr rate text on skill bars in left navigation': '左侧导航技能条上经验/小时文本的颜色',
        'Color for estimated queue lengths (extrapolated from 20+ orders at same price)':
            '预估队列长度的颜色（基于同价20+订单推算）',
        'Color for informational text in tooltips (light backgrounds)': '提示中信息文本的颜色（浅色背景）',
        'Color for inventory count shown on action tiles and in the action detail panel':
            '行动方块和行动详情面板中背包数量的颜色',
        'Color for known queue lengths (when all visible orders are counted)': '已知队列长度的颜色（所有可见订单已统计）',
        'Color for loss/negative values in tooltips (light backgrounds)': '提示中亏损/负值的颜色（浅色背景）',
        'Color for market listing total prices of 1 million or more': '市场挂单总价100万及以上的颜色',
        'Color for market listing total prices of 100K or more': '市场挂单总价10万及以上的颜色',
        'Color for market listing total prices of 10K or more': '市场挂单总价1万及以上的颜色',
        'Color for market listing total prices under 10K': '市场挂单总价低于1万的颜色',
        'Color for profit/positive values in tooltips (light backgrounds)': '提示中利润/正值的颜色（浅色背景）',
        'Color for remaining XP text below skill bars in left navigation': '左侧导航技能条下方剩余经验文本的颜色',
        'Color for warnings in tooltips (light backgrounds)': '提示中警告文本的颜色（浅色背景）',
        'Color used for essence drops and essence-related text': '用于精华掉落和精华相关文本的颜色',
        'Color used for gold and currency displays': '用于金币和货币显示的颜色',
        'Color used for informational text and highlights': '用于信息文本和高亮的颜色',
        'Color used for losses, costs, and negative values': '用于亏损、成本和负值的颜色',
        'Color used for profit, gains, and positive values': '用于利润、收益和正值的颜色',
        'Color used for transmutation success rate percentages in Item Dictionary': '用于物品词典中转化成功率百分比的颜色',
        'Color used for warnings and important notices': '用于警告和重要通知的颜色',
        'Colors efficiency ratings relative to visible tasks.': '根据可见任务相对着色效率评级。',
        Combat: '战斗',
        'Combat Features': '战斗功能',
        'Combat Score: {0}': '战斗评分：{0}',
        'Combat Sim': '战斗模拟',
        'Combat Sim Export': '战斗模拟导出',
        'Combat Simulator': '战斗模拟器',
        'Combat Simulator: Default hours (All Zones)': '战斗模拟器：默认小时数（所有区域）',
        'Combat Simulator: Default hours (Seek)': '战斗模拟器：默认小时数（搜索）',
        'Combat Simulator: Default hours (single zone)': '战斗模拟器：默认小时数（单区域）',
        'Combat Simulator: Show completion time as decimal minutes': '战斗模拟器：以十进制分钟显示完成时间',
        'Combat Statistics': '战斗统计数据',
        'Combat Statistics: Chat message format': '战斗统计：聊天消息格式',
        'Combat Statistics: Show Statistics tab in Combat panel': '战斗统计：在战斗面板显示统计标签页',
        'Combat Summary: Show detailed statistics on return': '战斗总结：返回时显示详细统计',
        'Combat icons unavailable': '战斗图标不可用',
        'Combat level: {0}': '战斗等级：{0}',
        'Combat monster sprites need to be loaded. Visit the Combat panel to load them.':
            '需要加载战斗怪物精灵，请访问战斗面板加载。',
        'Combat zones: Show zone index numbers': '战斗区域：显示区域索引编号',
        'Combined Total': '合计总计',
        'Comma-separated preset values (e.g. 50,500,5000). Leave blank for defaults (10, 100, 1000). Max 8 values.':
            '逗号分隔的预设值（如50,500,5000）。留空使用默认值（10, 100, 1000）。最多8个值。',
        'Community (Wisdom T{0}):': '社区（智慧T{0}）：',
        'Community Buff': '社区增益',
        'Community Buffs': '社区增益',
        'Community:': '社区：',
        'Compared to snapshot from {0}h ago': '与{0}小时前的快照比较',
        'Comparison ({0} runs)': '对比（{0}次运行）',
        Complete: '完成',
        'Complete at': '完成于',
        Completed: '已完成',
        'Completed in': '完成于',
        'Completion Time': '完成时间',
        'Computed Stats': '计算属性',
        Configure: '配置',
        'Configure Net Worth Exclusions': '配置净资产排除',
        'Configure task auto-reroll reminders': '配置任务自动重随提醒',
        'Configure task reroll protection': '配置任务重随保护',
        'Configure...': '配置...',
        'Confirm Clear?': '确认清除？',
        'Confirm Delete?': '确认删除？',
        'Connect Gaps': '连接缺口',
        'Consumable Costs': '消耗品成本',
        Consumables: '消耗品',
        'Consumables:': '消耗品：',
        Cooking: '烹饪',
        Cooldown: '冷却',
        Copied: '已复制',
        'Copy Settings to All Characters': '复制设置到所有角色',
        Cost: '成本',
        'Cost/day': '成本/天',
        'Cost/hr': '成本/时',
        'Cost: {0} / {1} (ask / bid)': '成本：{0} / {1}（卖单价/买单价）',
        'Cost: {0}/hr': '成本：{0}/小时',
        'Cost: {0}/item': '成本：{0}/个',
        'Costs by Enhancement Level:': '各等级强化成本：',
        'Costs: ': '成本：',
        'Costs: {0}/hr': '成本：{0}/时',
        'Could not detect current skill': '无法检测当前技能',
        'Could not identify monster.': '无法识别怪物。',
        Count: '数量',
        'Count ability books as inventory (Current Assets)': '将技能书算作背包（当前资产）',
        'Cowbells are not tradeable, but they have a value based on Bag of 10 Cowbells market price':
            '牛铃不可交易，但其价值基于10牛铃袋的市场价格',
        'Craft Item': '制作物品',
        'Craft cost:': '制作成本：',
        'Craft from materials': '从材料制作',
        'Craft: Off': '制作：关',
        'Craft: On': '制作：开',
        Crafting: '制作',
        'Crafting Steps': '制作步骤',
        Crimson: '深红',
        'Crit Rate': '暴击率',
        'Cross-character queue monitor': '跨角色队列监视器',
        'Cumulative to Level:': '累计至等级：',
        'Currency tooltips: Show shop values for tokens, seals, and cowbells': '货币提示：显示代币、封印和牛铃的商店价值',
        'Current Assets: {0}': '当前资产：{0}',
        'Current Exclusions': '当前排除',
        'Current Gear': '当前装备',
        'Current level:': '当前等级：',
        'Current:': '当前：',
        'Custom Inventory Tabs': '自定义背包标签页',
        'Custom Inventory Tabs: Add all items when adding category': '自定义背包标签页：添加分类时添加所有物品',
        'Custom Inventory Tabs: Enable': '自定义背包标签页：启用',
        'Custom Inventory Tabs: Include food & drinks when adding from loadout':
            '自定义背包标签页：从装备配置添加时包含食物和饮品',
        'Custom Inventory Tabs: Item spacing (px)': '自定义背包标签页：物品间距（像素）',
        'Custom Inventory Tabs: Items visible in topmost tab only': '自定义背包标签页：仅在最顶层标签页显示物品',
        'Custom Inventory Tabs: Show Toolasha tab by default': '自定义背包标签页：默认显示Toolasha标签页',
        'Custom Inventory Tabs: Show Unorganized bucket': '自定义背包标签页：显示未整理桶',
        'Custom Price Overrides': '自定义价格覆盖',
        'Custom color': '自定义颜色',
        'Custom price overrides': '自定义价格覆盖',
        'Custom…': '自定义…',
        'DD-MM (13-01)': 'DD-MM（13-01）',
        'DOM Observers': 'DOM 观察器',
        DPH: '每次伤害',
        DPS: '每秒伤害',
        'Daily Consumable Costs': '每日消耗品成本',
        'Daily Income': '每日收入',
        'Daily Key Costs': '每日钥匙成本',
        'Daily Output: {0}/{1}': '日产：{0}/{1}',
        'Daily Output: —': '日产：—',
        'Daily Profit': '每日利润',
        Damage: '伤害',
        Date: '日期',
        'Date format when using Date/Time display (only applies if Date/Time format is selected)':
            '使用日期/时间显示时的日期格式（仅在选择日期/时间格式时适用）',
        'Date/Time (e.g., ': '日期/时间（例如 ',
        'Date: {0}': '日期：{0}',
        DblProg: '双倍进度',
        'Death Count': '死亡次数',
        Deaths: '死亡次数',
        'Deaths/hr': '死亡/时',
        'Deaths:': '死亡：',
        'Decompose History': '分解历史',
        'Decompose history cleared.': '分解历史已清除。',
        Def: '防御',
        Default: '默认',
        'Default hours of combat simulation per binary search step in recommendations':
            '推荐中每步二分搜索的战斗模拟默认小时数',
        'Default simulation duration in hours for All Zones runs': '所有区域运行的默认模拟持续小时数',
        'Default simulation duration in hours for Seek Best Source runs': '搜索最佳来源运行的默认模拟持续小时数',
        'Default simulation duration in hours for single-zone runs': '单区域运行的默认模拟持续小时数',
        'Default target clear rate for labyrinth skip threshold recommendations': '迷宫跳过阈值推荐的默认目标通关率',
        'Default: 140 (professional enhancer level)': '默认：140（专业强化师等级）',
        'Default: 8 (max level)': '默认：8（最高等级）',
        'Defaults to Max Level result when available': '默认为最高等级结果（可用时）',
        'Defaults...': '默认设置...',
        Defense: '防御力',
        'Delete ALL run history data?\\n\\nThis cannot be undone!': '删除所有副本记录数据？\\n\\n此操作不可撤销！',
        'Delete point': '删除数据点',
        'Delete result': '删除结果',
        'Delete tab': '删除标签页',
        'Delete this listing': '删除此挂单',
        'Delete this run': '删除此记录',
        'Delete this session': '删除此记录',
        Delta: '增量',
        'Detailed Breakdown': '详细明细',
        'Dimmed/secondary text color': '暗淡/次要文本颜色',
        'Disable all market &amp; profit features for a no-marketplace playthrough.':
            '禁用所有市场与利润功能，以进行无市场游玩。',
        'Disable all market &amp; profit features. ACTIVE — market features locked.':
            '禁用所有市场与利润功能。已激活——市场功能已锁定。',
        'Disable all market and profit features for a no-marketplace playthrough.':
            '禁用所有市场和利润功能，进行无市场模式的游戏。',
        'Display avg completion time as ': '显示平均完成时间为 ',
        'Display estimated age of the top competing order for each of your listings (requires estimated listing age feature to be active)':
            '显示每个挂单中排名第一的竞争订单的预估时长（需要启用预估挂单时长功能）',
        'Display how long ago each listing was created on the My Listings tab (e.g., ': '显示每个挂单的创建时间（例如 ',
        'Display total value, average time, and daily output in loot logs': '在战利品日志中显示总价值、平均时间和每日产出',
        'Displays ': '显示 ',
        'Displays XP and level progress estimates inside action panels': '在行动面板内显示经验和等级进度预估',
        'Displays XP/hr rates, rankings, and a weekly chart on the Guild Overview, Members, and Guild Leaderboard tabs. Disable the standalone Guild XP/h userscript if using this.':
            '在公会概览、成员和公会排行榜标签页显示经验/小时比率、排名和周图表。如使用此功能，请禁用独立的公会经验/小时用户脚本。',
        'Displays a color-graded efficiency score based on expected completion time.':
            '根据预期完成时间显示彩色分级的效率评分。',
        'Displays a red badge on chat tabs when someone @mentions you': '当有人@提及时在聊天标签页显示红色徽章',
        'Displays a status message on task cards when their action is in your action queue':
            '当任务行动在你的行动队列中时，在任务卡片上显示状态消息',
        'Displays best profit/hr highlighted, with other alternative actions (craft, coinify, decompose, transmute) summarized below':
            '高亮显示最佳利润/小时，其他替代行动（制作、铸币、分解、转化）汇总在下方',
        'Displays buy orders (BO), sell orders (SO), and unclaimed coins (💰) in the header area below gold':
            '在标题区金币下方显示买单（BO）、卖单（SO）和未领取金币（💰）',
        'Displays calculated totals when you enter a quantity in the action input':
            '在行动输入框中输入数量时显示计算后的总计',
        'Displays dungeon progress panel with wave counter, run history, and statistics':
            '显示副本进度面板，包含波次计数器、运行历史和统计数据',
        'Displays encounters/hour, revenue, experience rates when returning from combat':
            '从战斗返回时显示遭遇/小时、收入、经验比率',
        'Displays equipped abilities, consumables, and their combat triggers below the profile':
            '在角色下方显示已装备的技能、消耗品及其战斗触发条件',
        'Displays exp/hr on each action tile in the action list page': '在行动列表页的每个行动方块上显示经验/小时',
        'Displays how many items you can make based on current inventory': '显示基于当前背包可制作的物品数量',
        'Displays how many of each item you own when browsing the market': '浏览市场时显示每个物品的拥有数量',
        'Displays how many of the item you currently own in Buy Now and Buy Listing modals':
            '在立即购买和购买挂单弹窗中显示当前拥有的物品数量',
        'Displays how much XP needed to reach the next level under skill progress bars':
            '在技能进度条下方显示达到下一级所需的经验值',
        'Displays live XP/hr rate under each skill bar in the navigation panel':
            '在导航面板的每个技能条下方显示实时经验/小时比率',
        'Displays per-item ask and bid prices on inventory items': '在背包物品上显示每件物品的买卖单价',
        'Displays profit/hour and profit/day for alchemy actions based on success rate and market prices':
            '基于成功率和市场价格显示炼金行动的利润/小时和利润/天',
        'Displays profit/hr on each action tile in the action list page': '在行动列表页的每个行动方块上显示利润/小时',
        'Displays semi-transparent item/monster icons on task cards': '在任务卡片上显示半透明的物品/怪物图标',
        'Displays success rate percentages in the ': '在...中显示成功率百分比',
        'Displays the profitability breakdown section inside gathering, production, and alchemy action panels':
            '在采集、生产和炼金行动面板内显示利润分解部分',
        'Displays the total market value of all items in each inventory category': '显示每个背包分类中所有物品的总市场价值',
        'Displays top order price and total value on each listing in My Listings table':
            '在“我的挂单”表格中显示每个挂单的最高订单价格和总价值',
        'Displays total materials needed and shortfall when entering quantity': '输入数量时显示所需材料总量和缺口',
        'Displays total quantity at best price below Buy/Sell buttons. Estimated values (20+ orders at same price) are shown in a different color.':
            '在买入/卖出按钮下方显示最优价格的总数量。估算值（同价20+订单）以不同颜色显示。',
        'Displays your collection count on skilling actions (open Collections once to populate counts)':
            '在技能行动上显示收藏计数（打开收藏一次以填充计数）',
        'Displays your last buy/sell prices for items in marketplace': '在市场显示物品的上次买入/卖出价格',
        'Do ': '执行 ',
        Done: '完成',
        Double: '双倍',
        'Double Progress': '双倍进度',
        'Drag tabs to rearrange the order of Inventory, Toolasha, Equipment, Houses, Abilities, and Loadout. Order persists through refresh.':
            '拖拽标签页重新排列背包、Toolasha、装备、房屋、技能和装备配置的顺序。刷新后顺序保持不变。',
        'Drag to move': '拖动移动',
        'Drag to reorder': '拖拽排序',
        Drink: '饮品',
        'Drink Conc:': '饮品浓度：',
        'Drink Concentration: ': '饮品浓度：',
        'Drink Costs: {0}/hr': '饮品成本：{0}/时',
        Drinks: '饮品',
        Drops: '掉落',
        'Drops:': '掉落：',
        Dungeon: '副本',
        'Dungeon Loading...': '副本加载中...',
        'Dungeon Run Chart': '副本通关图表',
        'Dungeon Tracker position reset': '副本追踪位置已重置',
        'Dungeon Tracker: Real-time progress tracking': '副本追踪器：实时进度追踪',
        'Dungeon:': '副本：',
        'Dungeons completed/hr': '副本完成/时',
        'Dungeons failed/hr': '副本失败/时',
        Duration: '持续时间',
        'Duration (minutes)': '时长（分钟）',
        'Duration: {0}': '持续时间：{0}',
        EPH: '每小时经验',
        'EV: {0}/chest': '期望值：{0}/宝箱',
        'EXP/Hour': '经验/小时',
        'EXP/hour': '经验/小时',
        'EXP/hr': '经验/时',
        'EXPECTED VALUE': '期望值',
        Earring: '耳环',
        Earrings: '耳环',
        'Economy & Inventory': '经济与背包',
        'Edit Template': '编辑模板',
        'Edit tab': '编辑标签页',
        'Eff. Lvl': '有效等级',
        'Effective Level:': '有效等级：',
        'Effective Level: {0} (base {1} + {2})': '有效等级：{0}（基础{1} + {2}）',
        'Effective: {0}': '有效：{0}',
        Efficiency: '效率',
        'Efficiency algorithm': '效率算法',
        'Efficiency: +{0}': '效率：+{0}',
        'Elapsed Time (e.g., ': '已过时间（例如 ',
        'Elapsed: ': '已用时间：',
        Empty: '空',
        'Empty (clear slot)': '空（清除槽位）',
        'Empty (remove slot)': '空（移除槽位）',
        'Enable Enhancement Tracker': '启用强化追踪器',
        'Enable Pop-out Chat Window button': '启用弹出聊天窗口按钮',
        'Enable Task Inventory Highlighter button': '启用任务背包高亮按钮',
        'Enable chat commands (/item, /wiki, /market)': '启用聊天命令（/item、/wiki、/market）',
        'Enable net worth history chart': '启用净资产历史图表',
        'Enable sorting for Equipment category': '启用装备分类排序',
        'Enc/hr': '战斗/时',
        'Encounters/Hour': '遭遇/小时',
        'Encounters/hour:': '遭遇/小时：',
        'Encounters/hr': '战斗次数/时',
        'Encounters:': '战斗次数：',
        'Enemy Level': '敌人等级',
        Enh: '强化',
        'Enh Lvl: {0}': '强化等级：{0}',
        'Enh Lvl: {0} selected': '已选强化等级：{0}',
        'Enh. Level': '强化等级',
        EnhSpd: '强化速度',
        'Enhance: +{0}/+{1}': '强化：+{0}/+{1}',
        'Enhanced Buy': '增强买入',
        'Enhanced Sell': '增强卖出',
        'Enhanced items valued by enhancement simulator': '强化物品由强化模拟器估值',
        Enhancelator: 'Enhancelator',
        Enhancement: '强化',
        'Enhancement Simulator Settings': '强化模拟器设置',
        'Enhancement XPH Calculator': '强化经验/时计算器',
        'Enhancement XPH: Default max enhancement level (1–20)': '强化XPH：默认最大强化等级（1–20）',
        'Enhancement XPH: Default protect from level (0 = no protection)': '强化XPH：默认保护等级（0=无保护）',
        'Enhancement level at which to stop trusting market prices': '停止信任市场价格的强化等级',
        'Enhancement material limit: Include protection items': '强化材料限制：包含保护物品',
        'Enhancement path: Use crafting cost for base item if cheaper': '强化路径：基础物品更便宜时使用制作成本',
        'Enhancement tooltips: Show detailed breakdown for consumed items': '强化提示：显示消耗物品的详细分解',
        'Enhancement: XPH calculator': '强化：XPH计算器',
        Enhancer: '强化者',
        Enhancing: '强化',
        'Enhancing Speed': '强化速度',
        'Enhancing Tea (+3)': '强化茶（+3）',
        'Enhancing skill level': '强化技能等级',
        'Enhancing speed community buff. Checked = auto-detect from game.': '强化速度社区增益。勾选=从游戏自动检测。',
        'Enhancing tea': '强化茶',
        'Enhancing tea provides skill level bonus': '强化茶提供技能等级加成',
        'Enter a quantity to check missing materials': '输入数量以检查缺失材料',
        'Enter moving average window in hours:': '输入移动平均窗口（小时）：',
        'Enter parameters and click Calculate.': '输入参数并点击计算。',
        'Enter text:': '输入文本：',
        Equipment: '装备',
        'Equipment Bonus': '装备加成',
        'Equipment Upgrades': '装备升级',
        'Equipment value: {0}': '装备价值：{0}',
        'Equipment:': '装备：',
        'Equipment: {0}': '装备：{0}',
        Equipped: '已装备',
        'Equipped ({0}): {1}': '已装备({0})：{1}',
        'Error during calculation.': '计算错误。',
        'Error loading run history': '加载通关历史出错',
        'Error: No character data': '错误：无角色数据',
        'Essence Drops:': '精粹掉落：',
        'Essence Drops: {0}/hr': '精粹掉落：{0}/时',
        'Essence Find: +{0}%': '精粹发现：+{0}%',
        Essences: '精华',
        'Est. w/ recycle: {0} → {1}': '预估（含回收）：{0} → {1}',
        Estimate: '估算',
        'Estimate failed. ': '估算失败。',
        'Estimated Value (revenue after tax)': '估算价值（税后收入）',
        'Estimated age of the top competing order': '最高竞价的预估时长',
        'Estimated listing age (based on listing ID)': '预估挂单时长（基于挂单ID）',
        'Estimated total queue depth (extrapolated from {0} visible orders)': '预估总队列深度（基于{0}个可见订单推算）',
        Excluded: '已排除',
        'Excluded ({0} - level too low)': '已排除（{0} - 等级过低）',
        'Excluded: {0}': '已排除：{0}',
        Exp: '经验',
        'Exp/hr: {0}': '经验/时：{0}',
        'Expand panel': '展开面板',
        'Expected Attempts': '预期尝试次数',
        'Expected Prots': '预期保护次数',
        'Expected Return: {0}': '预期回报：{0}',
        'Expected Rewards': '预期奖励',
        'Expected value (average)': '期望值（平均）',
        'Expected value drop display': '期望值掉落显示',
        Experience: '经验值',
        'Experience:': '经验：',
        Expert: '专家',
        'Expert Tea Crate: +{0}': '专家茶箱：+{0}',
        'Expired Only': '仅已过期',
        Export: '导出',
        'Export CSV': '导出CSV',
        'Export Profile': '导出角色',
        'Export Settings': '导出设置',
        'Export failed: ': '导出失败：',
        'Factor in the time cost of crafting when deciding buy vs craft. Uses your gold/hr value to determine if crafting is worth your time.':
            '在决定购买与制作时考虑制作的时间成本。使用你的金币/小时价值来判断制作是否值得。',
        'Factor in time cost': '考虑时间成本',
        Fail: '失败',
        Failed: '失败',
        'Failed to clear history: {0}': '清除历史失败：{0}',
        'Failed to clear run history. Check console for details.': '清除副本记录失败，查看控制台了解详情。',
        'Failed to import settings.': '导入设置失败。',
        'Failed to import settings. Please check the file format.': '导入设置失败。请检查文件格式。',
        'Failed to load character data.': '加载角色数据失败。',
        'Failed to open Item Dictionary': '打开物品词典失败',
        'Failed to open marketplace': '打开市场失败',
        'Failed to sync settings: {0}': '同步设置失败：{0}',
        Fastest: '最快',
        'Fastest Run': '最快通关',
        Favorites: '收藏',
        'Feature Init': '功能初始化',
        'Feature unavailable after 2/21/26 game update': '2026年2月21日游戏更新后此功能不可用',
        Feet: '脚部',
        'File appears to be truncated or incomplete. The JSON does not end properly. ':
            '文件似乎被截断或不完整，JSON未正确结束。',
        Filled: '已成交',
        'Filled Only': '仅已成交',
        'Filled or Active': '已成交或活跃',
        'Filter actions...': '筛选行动...',
        'Filter by Date': '按日期筛选',
        'Filter by Enhancement Level': '按强化等级筛选',
        'Filter by Input Item': '按输入物品筛选',
        'Filter by Item': '按物品筛选',
        'Filter by Result Item': '按结果物品筛选',
        'Filter by Skill': '按技能筛选',
        'Filter by Type': '按类型筛选',
        'Filter: ': '筛选：',
        'Find Max': '查找最高',
        'Find Max Result': '查找最高结果',
        'Fixed Assets: {0}': '固定资产：{0}',
        Food: '食物',
        'Food & Drinks': '食物与饮品',
        Foraging: '采集',
        'Forces item tooltips to always appear centered at the top of the screen instead of near the hovered item':
            '强制物品提示始终居中显示在屏幕顶部，而非悬停物品附近',
        'Forces the final craft step (for task credit) but allows buying intermediate materials if cheaper.':
            '强制最后一步制作（用于任务计数），但允许在更便宜时购买中间材料。',
        'Found in:': '发现于：',
        'From:': '从：',
        'From: +{0}': '从：+{0}',
        'Full at': '满于',
        'Full breakdown of enhancement costs for all levels': '所有等级强化成本完整明细',
        'Full in': '满于',
        GATHERING: '采集',
        'Game Mode': '游戏模式',
        'Gap: +{0}': '差距：+{0}',
        GathQty: '采集数量',
        'Gathering Qty': '采集数量',
        'Gathering Value:': '采集价值：',
        General: '通用',
        'General Settings': '通用设置',
        Gloves: '手套',
        Gold: '金币',
        'Gold Upgrades': '金币升级',
        'Gold cost to next tier': '下一阶金币成本',
        'Gold for {0}: {1} / {2}': '{0}的金币：{1} / {2}',
        'Gold/0.1% DPS': '金币/0.1%每秒伤害',
        'Gold/0.1% EXP': '金币/0.1%经验',
        'Gold/0.1% Profit': '金币/0.1%利润',
        'Gold/1%': '金币/1%',
        'Gold/Currency': '金币/货币',
        'Gold/Token': '金币/代币',
        'Gold/XP': '金币/经验',
        'Gold/day': '金币/天',
        'Gold/hr': '金币/时',
        'Gold: {0}': '金币：{0}',
        Grandmaster: '宗师',
        'Group by:': '分组方式：',
        Guild: '公会',
        Guzzling: '贪食',
        HP: '生命值',
        'HP Instant': '瞬间生命',
        'HP Over Time': '持续生命',
        'HP/MP consumables: Restore speed, cost performance': 'HP/MP消耗品：恢复速度、性价比',
        Hands: '手部',
        'Hands:': '手部：',
        Head: '头部',
        Hello: '你好',
        'Hide Details': '隐藏详情',
        'Hide Sort Tasks button': '隐藏排序任务按钮',
        'Hide tooltip extras in enhance item selector': '在强化物品选择器中隐藏提示额外内容',
        'Hide tracker when not on the Enhancing screen': '不在强化界面时隐藏追踪器',
        'Hides action panels that would result in a loss (negative profit/hr)': '隐藏会导致亏损（负利润/小时）的行动面板',
        'Hides the Sort Tasks button while keeping auto-sort functional': '隐藏排序任务按钮，同时保持自动排序功能可用',
        'Hides the native Inventory tab and automatically activates the Toolasha tab whenever the character panel opens.':
            '隐藏原生背包标签页，并在角色面板打开时自动激活Toolasha标签页。',
        'Highlight Task Items': '高亮任务物品',
        'Highlights tasks you want to reroll with a red border and reminder badge. Configure per-character via the target icon in the task panel.':
            '用红色边框和提醒徽章高亮你想要重随的任务。通过任务面板中的目标图标按角色配置。',
        'Hold Alt/Option and click any item to navigate to its crafting/gathering page, or item dictionary if not craftable':
            '按住Alt/Option并点击任何物品，跳转到其制作/采集页面，或不可制作时跳转到物品词典',
        Holy: '神圣',
        Hours: '小时',
        'Hours to Level Text': '升级小时数文本',
        House: '房屋',
        'House (Observatory):': '房屋（天文台）：',
        'House Bonus': '房屋加成',
        'House Rooms': '房屋房间',
        'House Rooms (Wisdom):': '房屋房间（智慧）：',
        'House Rooms:': '房屋房间：',
        'House:': '房屋：',
        'House: {0}': '房屋：{0}',
        'Houses: {0}': '房屋：{0}',
        'How tasks are ordered when clicking Sort Tasks. ': '点击排序任务时任务的排序方式。',
        'How transparent item tiles appear when you own zero of that item': '当拥有该物品数量为零时，物品方块的透明度',
        Idle: '空闲',
        'Ignore queued actions when calculating missing materials': '计算缺失材料时忽略队列中的行动',
        Import: '导入',
        'Import Failed': '导入失败',
        'Import Market Data': '导入市场数据',
        'Import Settings': '导入设置',
        'Import complete!\\n\\nImported: {0} new listings\\nSkipped: {1} duplicates or invalid rows\\nTotal: {2} listings':
            '导入完成！\\n\\n导入：{0}个新挂单\\n跳过：{1}个重复或无效行\\n总计：{2}个挂单',
        'Import complete!\\n\\nImported: {0} new listings\\nSkipped: {1} duplicates\\nTotal: {2} listings':
            '导入完成！\\n\\n导入：{0}个新挂单\\n跳过：{1}个重复\\n总计：{2}个挂单',
        'Import failed: {0}': '导入失败：{0}',
        'Import from Toolasha': '从Toolasha导入',
        Imported: '已导入',
        'Importing {0} listings from CSV...': '正在从CSV导入{0}个挂单...',
        'Importing {0} listings...': '正在导入{0}个挂单...',
        'In Progress': '进行中',
        'In inventory': '在背包中',
        'Include cowbell value in expected value calculations': '在期望值计算中包含牛铃价值',
        'Include cowbells in net worth': '在净资产中包含牛铃',
        'Include currently equipped items in the displayed count': '在显示数量中包含当前已装备的物品',
        'Include enhancing achievement success bonus': '包含强化成就成功加成',
        'Include task tokens in net worth': '在净资产中包含任务代币',
        Income: '收入',
        Informational: '信息',
        Ingredient: '材料',
        'Input Item': '输入物品',
        'Input: {0}': '输入：{0}',
        Instant: '即时',
        'Instant: Compare to instant buy/sell prices. Orders: Compare to buy/sell orders.':
            '即时：比较即时买入/卖出价格。订单：比较买入/卖出订单。',
        Int: '智力',
        Intelligence: '智力',
        'Invalid format. Paste a Combat Sim Export JSON.': '格式无效。请粘贴战斗模拟导出JSON。',
        'Invalid format. Paste a Shykai export JSON.': '格式无效。请粘贴Shykai导出JSON。',
        'Invalid level': '无效等级',
        'Invalid session': '无效记录',
        'Invalid target level': '无效的目标等级',
        Inventory: '背包',
        'Inventory Badge: Ask Price': '背包徽章：卖单价',
        'Inventory Badge: Bid Price': '背包徽章：买单价',
        'Inventory Count Text': '背包数量文本',
        'Inventory value: {0}': '背包价值：{0}',
        'Iron Cow Mode': '铁牛模式',
        Item: '物品',
        'Item ': '物品 ',
        'Item Dictionary': '物品词典',
        'Item Dictionary: Include base success rate in transmutation percentages': '物品词典：在转化百分比中包含基础成功率',
        'Item Dictionary: Show transmutation success rates': '物品词典：显示转化成功率',
        'Item Tooltip Enhancements': '物品提示增强',
        'Item name...': '物品名称...',
        'Item price:': '物品价格：',
        'Items to next tier': '下一阶物品数',
        Joined: '已加入',
        'K/M/B Format': 'K/M/B格式',
        'Key ({0})': '钥匙({0})',
        'Key Cost': '钥匙成本',
        'Key Costs': '钥匙成本',
        'Key pricing mode': '钥匙定价模式',
        'Keys:': '钥匙：',
        'Lab Sim': '迷宫模拟',
        'Lab Simulator': '迷宫模拟器',
        'Labyrinth Buffs': '迷宫增益',
        'Labyrinth Shop Value:': '迷宫商店价值：',
        'Labyrinth Shop: Show market prices': '迷宫商店：显示市场价格',
        'Labyrinth best level tracker': '迷宫最佳等级追踪器',
        'Labyrinth clear rate calculator': '迷宫通关率计算器',
        'Labyrinth simulation cancelled.': '迷宫模拟已取消。',
        'Labyrinth:': '迷宫：',
        'Labyrinth: Recommend sim hours per step': '迷宫：建议每步模拟小时数',
        'Labyrinth: Recommend target clear rate (%)': '迷宫：建议目标通关率（%）',
        'Labyrinth: Show live clear chance': '迷宫：显示实时通关几率',
        'Last Run': '上次通关',
        'Last Run:': '上次通关：',
        'Last XP/h': '上次经验/小时',
        'Last day XP/h': '昨日经验/小时',
        'Last hour XP/h': '上小时经验/小时',
        'Last week XP/h': '上周经验/小时',
        'Last {0}:': '上次{0}：',
        'Left sidebar: Hide Labyrinth ping badge': '左侧边栏：隐藏迷宫通知徽章',
        'Left sidebar: Show XP/hr rate on skill bars': '左侧边栏：在技能条上显示经验/小时比率',
        'Left sidebar: Show external tool links': '左侧边栏：显示外部工具链接',
        'Left sidebar: Show remaining XP to next level': '左侧边栏：显示到下一级的剩余经验',
        'Left sidebar: Show skill XP percentages': '左侧边栏：显示技能经验百分比',
        Legs: '腿部',
        'Legs:': '腿部：',
        Level: '等级',
        'Level < ': '等级 < ',
        'Level >= ': '等级 >= ',
        'Level Bonus': '等级加成',
        'Level advantage:': '等级优势：',
        'Level:': '等级：',
        'Limits action bar width to 800px. Useful for wide monitors.': '将行动栏宽度限制为800px。适用于宽屏显示器。',
        Listed: '已挂单',
        'Listing Total: 100K+': '挂单总价：10万+',
        'Listing Total: 10K+': '挂单总价：1万+',
        'Listing Total: 1M+': '挂单总价：100万+',
        'Listing Total: <10K': '挂单总价：<1万',
        Listings: '挂单',
        'Loading loadout...': '加载装备配置中...',
        'Loading market data...': '加载市场数据...',
        'Loading...': '加载中...',
        Loadout: '装备配置',
        'Loadout panel: Enable drag-and-drop reordering': '装备配置面板：启用拖拽重新排序',
        'Loadout panel: Show highest-owned enhancement level on equipment icons':
            '装备配置面板：在装备图标上显示最高拥有强化等级',
        'Loadout panel: Use saved loadout snapshots in profit calculations':
            '装备配置面板：在利润计算中使用已保存的装备配置快照',
        'Loadout:': '装备配置：',
        'Loadout: ': '装备配置：',
        'Loadout: {name}': '装备配置：{name}',
        'Loot Log Statistics': '战利品日志统计',
        'Loot Log: Persist and display historical entries': '战利品日志：持久化和显示历史条目',
        'Loss/Negative Values': '亏损/负值',
        Lv: '等',
        Lvl: '等级',
        'Lvl {0}': '等级 {0}',
        'MM-DD (01-13)': 'MM-DD（01-13）',
        MP: '魔力值',
        'MP Instant': '瞬间法力',
        'MP Over Time': '持续法力',
        'MWI Chat': 'MWI 聊天',
        Magic: '魔法',
        'Main Hand': '主手',
        'Main text color': '主文本颜色',
        'Manage Overrides': '管理覆盖',
        'Market History': '市场历史',
        'Market Movement': '市场变动',
        'Market Tax: {0} (2%)': '市场税：{0}（2%）',
        'Market buy:': '市场购买：',
        'Market data not available. Please try again.': '市场数据不可用。请稍后重试。',
        'Market history cleared successfully.': '市场历史已成功清除。',
        'Market listings: {0}': '市场挂单：{0}',
        'Market prices are unreliable for highly enhanced items (+13 and above). Use calculated enhancement cost instead.':
            '高强化物品（+13及以上）的市场价格不可靠。改用计算的强化成本。',
        'Market: Count equipped items': '市场：计算已装备物品',
        'Market: Date format for date/time display': '市场：日期/时间显示的日期格式',
        'Market: Listing age display format': '市场：挂单时长显示格式',
        'Market: Listing price decimal precision': '市场：挂单价格小数精度',
        'Market: Opacity for items not in inventory': '市场：不在背包中的物品透明度',
        'Market: Show MilkyWay Market link': '市场：显示MilkyWay Market链接',
        'Market: Show Philo Gamba calculator button in settings': '市场：在设置中显示贤者赌博计算器按钮',
        'Market: Show estimated age on order book': '市场：在订单簿上显示预估时长',
        'Market: Show history viewer button in settings': '市场：在设置中显示历史查看器按钮',
        'Market: Show inventory count on items': '市场：在物品上显示背包数量',
        'Market: Show listing age on My Listings': '市场：在“我的挂单”上显示挂单时长',
        'Market: Show order totals in header': '市场：在标题区显示订单总计',
        'Market: Show personal trade history': '市场：显示个人交易历史',
        'Market: Show prices on individual listings': '市场：在单个挂单上显示价格',
        'Market: Show queue length estimates': '市场：显示队列长度预估',
        'Market: Show top order age on My Listings': '市场：在“我的挂单”上显示最高订单时长',
        'Market: Time format for date/time display': '市场：日期/时间显示的时间格式',
        'Market: Trade history comparison mode': '市场：交易历史比较模式',
        'Marketplace Action': '市场行动',
        'Marketplace: Custom quick input presets': '市场：自定义快速输入预设',
        'Marketplace: Filter by level, class, slot': '市场：按等级、职业、部位筛选',
        'Marketplace: Quick input buttons on order dialogs': '市场：订单对话框上的快速输入按钮',
        'Marketplace: Show ': '市场：显示 ',
        'Marketplace: Show owned count in buy dialogs': '市场：在购买对话框中显示拥有数量',
        'Marketplace: Sort items by profitability': '市场：按利润率排序物品',
        'Marketplace: ÷2 and ×2 buttons on order dialogs': '市场：订单对话框上的÷2和×2按钮',
        Master: '大师',
        'Match best buy price': '匹配最优购买价格',
        'Match best sell price': '匹配最优出售价格',
        Material: '材料',
        'Material Costs:': '材料成本：',
        'Material Costs: {0}/hr': '材料成本：{0}/时',
        Materials: '材料',
        'Materials Per Attempt:': '每次尝试材料：',
        'Mats:': '材料：',
        Max: '最大',
        'Max Level': '最高等级',
        'Max beatable level: {0} ({1}% win rate).': '最高可击败等级：{0}（{1}%胜率）。',
        'Max level': '最高等级',
        'Max wave reached': '到达最高波次',
        Melee: '近战',
        'Mentions — {0}': '提及 — {0}',
        'Merge duplicate tasks on Go': '点击前往时合并重复任务',
        'Message format when Ctrl+clicking player card in Statistics. Click ':
            '在统计中按住Ctrl点击玩家卡片时的消息格式。点击 ',
        Milking: '挤奶',
        Milkonomy: 'Milkonomy',
        'Milkonomy Export': 'Milkonomy导出',
        'Milky Way Idle': 'Milky Way Idle',
        'MilkyWay Market ↗': 'MilkyWay市场 ↗',
        'Milkyway Market': 'Milkyway Market',
        Min: '最小',
        'Minimum enhancement level to use cost': '使用成本的最低强化等级',
        'Missing HP': '缺失生命值',
        'Missing MP': '缺失魔力值',
        'Missing Mats Marketplace': '缺失材料市场',
        'Missing materials: Artisan requirement mode': '缺失材料：工匠需求模式',
        'Missing price data': '缺失价格数据',
        'Missing: {0}': '缺失：{0}',
        Mode: '模式',
        'Mode: {0}': '模式：{0}',
        Modifiers: '修正系数',
        'Modifiers:': '修正系数：',
        Monster: '怪物',
        'Monster:': '怪物：',
        'Monster: {0} | Room Level: {1}': '怪物：{0} | 房间等级：{1}',
        'Most players should leave this off to see realistic professional enhancer costs':
            '大多数玩家应保持关闭以查看真实的专业强化师成本',
        'Move Claim Reward buttons to top of task list': '将领取奖励按钮移至任务列表顶部',
        'Move ability books from Fixed Assets to Current Assets inventory value. Useful if you plan to sell them.':
            '将技能书从固定资产移至当前资产背包价值。如果你打算出售它们，此选项很有用。',
        'Move to top': '移至顶部',
        'Moves all Claim Reward buttons to a stack at the top of the task list so you can click the same spot repeatedly to claim all completed tasks':
            '将所有领取奖励按钮移到任务列表顶部堆叠，你可以反复点击同一位置领取所有已完成任务',
        'Multiple items match: {0}. Please be more specific.': '匹配到多个物品：{0}。请指定更具体的信息。',
        'N/A': '无',
        'N/A (combat)': '无（战斗）',
        Name: '名称',
        Neck: '项链',
        'Net Production:': '净产出：',
        'Net Profit': '净利润',
        'Net Profit: -- ⚠': '净利润：-- ⚠',
        'Net Profit: {0}': '净利润：{0}',
        'Net Profit: {0} ⚠': '净利润：{0} ⚠',
        'Net Profit: {0}/action': '净利润：{0}/行动',
        'Net Profit: {0}/action ⚠': '净利润：{0}/行动 ⚠',
        'Net Profit: {0}/hr ⚠, {1}/day ⚠': '净利润：{0}/时 ⚠，{1}/天 ⚠',
        'Net Profit: {0}/hr, {1}/day': '净利润：{0}/时，{1}/天',
        'Net Value: {0}': '净值：{0}',
        'Net Worth': '净资产',
        'Net Worth Exclusions': '净资产排除',
        'Net Worth History': '净资产历史',
        'Net Worth History Chart': '净资产历史图表',
        'Net Worth: {0}': '净资产：{0}',
        'Net after key: {0}': '扣钥匙后净值：{0}',
        'Net: {0}/chest': '净收益：{0}/宝箱',
        'Net: {0}/hr ({1}/day)': '净：{0}/时（{1}/天）',
        'Networth: Loading...': '净资产：加载中...',
        Never: '从未',
        'New Buy Listing': '新建买单',
        'New Sell Listing': '新建卖单',
        'No Data': '无数据',
        'No Enhancement': '无强化',
        'No abilities': '无能力',
        'No ability books': '无技能书',
        'No actions match the current filter.': '没有符合当前筛选条件的行动。',
        'No attempts recorded yet': '暂无尝试记录',
        'No auto-reroll tasks yet. Search to add.': '暂无自动重随任务，搜索添加。',
        'No breakdown data available': '无可用的明细数据',
        'No character data available.': '无可用角色数据。',
        'No character data found. Please:\\n1. Refresh the game page\\n2. Wait for it to fully load\\n3. Try again':
            '未找到角色数据。请：\\n1. 刷新游戏页面\\n2. 等待完全加载\\n3. 重试',
        'No character data found. Please:\\n1. Refresh the game page\\n2. Wait for it to fully load\\n3. Try again\\n\\nIf viewing another player':
            '未找到角色数据。请：\\n1. 刷新游戏页面\\n2. 等待完全加载\\n3. 重试\\n\\n如果查看其他玩家',
        'No character data. Wait for editor to load.': '无角色数据。等待编辑器加载。',
        'No coinify history recorded yet.': '暂无铸币记录。',
        'No combat data available. Start a combat run first.': '无战斗数据可用。请先开始一次战斗。',
        'No consumables used': '未使用消耗品',
        'No custom price overrides. Use the search bar above to add items.':
            '没有自定义价格覆盖。使用上方的搜索栏添加物品。',
        'No custom tabs yet. Click ': '暂无自定义标签页。点击 ',
        'No data': '暂无数据',
        'No data available for this range': '此范围无可用数据',
        'No decompose history recorded yet.': '暂无分解记录。',
        'No detail snapshot available yet (data collected hourly)': '暂无详细快照（每小时采集一次数据）',
        'No eligible items found': '未找到符合条件的物品',
        'No equipment': '无装备',
        'No exclusions configured': '未配置排除项',
        'No experience gain (not trained in simulation)': '无经验获取（未在模拟中训练）',
        'No filter': '无过滤',
        'No game data available.': '无可用游戏数据。',
        'No houses built': '未建造房屋',
        'No inventory': '无背包物品',
        'No item selected in alchemy panel': '炼金面板未选择物品',
        'No item selected. Type a name and pick from the list.': '未选择物品。输入名称并从列表中选择。',
        'No item-level changes in the last 24h': '过去24小时内无物品等级变化',
        'No key data yet': '暂无钥匙数据',
        'No listings found': '未找到挂单',
        'No listings found in file or array is empty': '文件中未找到挂单或数组为空',
        'No live data available': '无实时数据可用',
        'No loadout snapshots — open your loadout panel first.': '没有装备配置快照——请先打开装备配置面板。',
        'No market data': '无市场数据',
        'No market listings': '无市场挂单',
        'No market orders': '无市场订单',
        'No matching actions': '无匹配行动',
        'No mentions': '无提及',
        'No new runs found to backfill.': '未找到需要回填的新副本记录。',
        'No other character data yet.': '暂无其他角色数据。',
        'No pinned actions yet': '暂无固定行动',
        'No player data available.': '无可用角色数据。',
        'No player data available. Configure a simulation first.': '无可用角色数据。请先配置模拟。',
        'No players loaded.': '未加载角色。',
        'No price data': '无价格数据',
        'No processing (buy intermediates)': '不加工（购买中间品）',
        'No production actions pinned': '未固定生产行动',
        'No protected tasks yet. Search to add.': '暂无受保护任务，搜索添加。',
        'No protection needed': '无需保护',
        'No results': '无结果',
        'No results yet. Run a simulation first.': '暂无结果。请先运行模拟。',
        'No runs match filters': '无符合筛选条件的记录',
        'No runs yet': '暂无记录',
        'No sessions match the current filters.': '没有符合当前筛选条件的记录。',
        'No skilling upgrade candidates found.': '未找到技能升级候选。',
        'No transmute history recorded yet.': '暂无转化记录。',
        'No trigger': '无触发',
        'No upgrade candidates found.': '未找到升级候选。',
        'No valid combinations with current constraints.': '当前约束下无有效组合。',
        'No zone found for monster.': '未找到怪物的区域。',
        'No zone selected.': '未选择区域。',
        'No zones selected.': '未选择区域。',
        'Non-Excl': '非排除',
        'Non-Excluded': '未排除',
        'Non-dungeon zones support max 3 players (you have {0}). Remove players to continue.':
            '非副本区域最多支持3名角色（当前有{0}名）。请移除角色以继续。',
        None: '无',
        Normal: '普通',
        'Normal Drops: {0}/hr': '普通掉落：{0}/时',
        'Not Tradeable': '不可交易',
        'Not enough data for chart': '数据不足无法生成图表',
        Notifications: '通知',
        'Number of decimal places to show for listing prices': '挂单价格显示的小数位数',
        'Number of levels to add to each ability': '每个技能增加等级数',
        'Observatory Lvl {0}': '天文台等级 {0}',
        'Observatory house room level': '天文台房屋房间等级',
        Off: '关闭',
        'Off Hand': '副手',
        'On Hand': '持有',
        'Only craft the final item — buy all sub-materials from the market instead of processing them yourself.':
            '仅制作最终物品——从市场购买所有子材料，而非自行加工。',
        'Only works when the game page is open': '仅在游戏页面打开时生效',
        'Open profile in game': '在游戏中打开角色页面',
        'Optimal Teas for {0}': '{0}的最佳工匠茶',
        'Optimal {0}/hr for {1}': '{1}的最佳{0}/时',
        'Optimal {0}/hr for {1}: {2}': '{1}的最佳{0}/时：{2}',
        'Optimal:': '最佳：',
        'Order book data - Visit market page to refresh': '订单簿数据 - 访问市场页面刷新',
        'Order book data from {0} ago - Visit market page to refresh': '{0}前的订单簿数据 - 访问市场页面刷新',
        Orders: '订单',
        Other: '其他',
        'Other Abilities ({0}): {1}': '其他能力({0})：{1}',
        'Outbid by 1 (best buy + 1)': '加价1（最优买入+1）',
        Overview: '概览',
        'Owned: ': '拥有：',
        PFormance: '性能面板',
        PROFIT: '利润',
        'Page {0} of {1}': '第{0}页，共{1}页',
        'Party ({0} loaded{1})': '队伍（{0}已加载{1}）',
        'Party DPS (est.)': '队伍每秒伤害（估）',
        'Paste Combat Sim Export JSON here...': '在此粘贴战斗模拟导出JSON...',
        'Paste Shykai export JSON here...': '在此粘贴Shykai导出JSON...',
        'Paste export data first.': '请先粘贴导出数据。',
        'Per action breakdown': '每次行动明细',
        'Per hour breakdown': '每小时明细',
        'Per unit cost (ask)': '单价成本（卖单价）',
        Philo: '贤者',
        'Philo Gamba': '贤者赌博',
        'Philo Price: ': '贤者之石价格：',
        Philosopher: '贤者',
        'Pin (force include)': '固定（强制包含）',
        'Pin actions using the 📌 icon on action tiles to see them here.': '在行动面板使用📌图标固定行动到此查看。',
        'Pin this action': '固定此行动',
        'Pin this action to keep it visible': '固定此行动以保持可见',
        'Pin tooltips to top-center of screen': '将提示固定在屏幕顶部中央',
        Pinned: '已固定',
        'Pinned Actions': '固定行动',
        'Pinned actions page in navigation bar': '导航栏中的已固定行动页面',
        'Pixel gap between item tiles on the Toolasha tab.': 'Toolasha标签页上物品方块之间的像素间距。',
        Player: '角色',
        'Player 1': '角色1',
        'Player 2': '角色2',
        'Player 3': '角色3',
        'Player 4': '角色4',
        'Player 5': '角色5',
        'Pop out chart': '弹出图表',
        'Pop out chat': '弹出聊天窗口',
        'Pop-out': '弹出',
        Pouch: '背包',
        'Preserves messages that the game removes from the live buffer, keeping them visible above the live chat':
            '保留游戏从实时缓冲区移除的消息，使其在实时聊天上方保持可见',
        Price: '价格',
        'Price:': '价格：',
        Pricing: '定价',
        'Pricing Mode: ': '定价模式：',
        'Pricing Mode: {0}': '定价模式：{0}',
        'Pricing mode naming convention': '定价模式命名惯例',
        'Pricing: {0}': '定价：{0}',
        'Primary Outputs:': '主要产出：',
        'Primary Text': '主要文本',
        'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)':
            '脚本UI元素的主强调色（按钮、标题、区域编号、经验百分比等）',
        'Prime Catalyst': '主催化剂',
        'Prod. Efficiency': '生产效率',
        ProdEff: '生产效率',
        'Professional enhancers use this to reduce attempts': '专业强化师使用此功能来减少尝试次数',
        'Profile panel: Show View Card button': '角色面板：显示查看卡片按钮',
        'Profile panel: Show abilities & triggers': '角色面板：显示技能和触发条件',
        'Profile panel: Show gear score': '角色面板：显示装备评分',
        Profit: '利润',
        'Profit calculation pricing mode': '利润计算定价模式',
        'Profit/Positive Values': '利润/正值',
        'Profit/XP: {0}': '利润/经验：{0}',
        'Profit/day': '利润/天',
        'Profit/hr': '利润/时',
        'Profit/hr:': '利润/时：',
        'Profit/hr: -- ⚠': '利润/时：-- ⚠',
        'Profit/hr: {0}': '利润/时：{0}',
        'Profit: Use crafting cost for upgrade items if cheaper': '利润：升级物品更便宜时使用制作成本',
        'Profit: {0}/action, {1}/hour, {2}/day': '利润：{0}/行动，{1}/时，{2}/天',
        'Profit: {0}/hr': '利润：{0}/小时',
        Profitability: '盈利分析',
        'Profitable only': '仅盈利',
        'Profits:': '利润：',
        'Progress: {0}/{1}': '进度：{0}/{1}',
        Prot: '保护',
        'Prot Factor': '保护系数',
        'Protect from': '保护从',
        'Protect specific tasks from accidental rerolling. Protected tasks get a green highlight and require a confirmation click before rerolling. A shield icon appears in the task panel to configure protected zones.':
            '保护特定任务免于意外重随。受保护的任务获得绿色高亮，重随前需要确认点击。任务面板中出现盾牌图标用于配置受保护区域。',
        'Protected Tasks': '受保护任务',
        'Protected category ({0})! Unlocks in 3s...': '受保护的类别（{0}）！3秒后解锁...',
        'Protected task! Unlocks in 3s...': '受保护任务！3秒后解锁...',
        Protection: '保护',
        'Prots Used': '保护使用次数',
        Purple: '紫色',
        Quantity: '数量',
        'Queue Length: Estimated Value': '队列长度：估算值',
        'Queue Length: Known Value': '队列长度：已知值',
        'Queue Monitor': '队列监视器',
        'Queued actions: Show profit/value for queued actions': '队列行动：显示队列行动的利润/价值',
        'Queued actions: Show total time and completion time': '队列行动：显示总时间和完成时间',
        'Queued actions: Value calculation mode': '队列行动：价值计算模式',
        'RECOMMENDATION: Export to CSV first using the ': '建议：先使用',
        Rainbow: '彩虹',
        Ranged: '远程',
        'Ranks all enhanceable items by expected XP per hour at your current stats':
            '根据你当前的属性，按预期经验/小时对所有可强化物品进行排序',
        'Rare Drops: {0}/hr': '稀有掉落：{0}/时',
        'Rare Find': '稀有发现',
        'Rare Find:': '稀有发现：',
        'Rare Find: +{0}%': '稀有发现：+{0}%',
        'Rare Finds:': '稀有发现：',
        Rate: '比率',
        'Rate:': '速率：',
        'Re-run': '重新计算',
        'Rec: +{0}': '推荐：+{0}',
        Recommend: '推荐',
        'Recommended skip threshold for ≥{0}% clear rate': '≥{0}%通关率的推荐跳过阈值',
        'Recommending... ({0}/{1})': '推荐中...({0}/{1})',
        'Records coinify sessions and displays history in a viewer tab in the Alchemy panel':
            '记录铸币会话并在炼金面板的查看器标签页中显示历史',
        'Records decompose sessions and displays history in a viewer tab in the Alchemy panel':
            '记录分解会话并在炼金面板的查看器标签页中显示历史',
        'Records guild and member XP data from WebSocket messages for XP/hr calculations':
            '从WebSocket消息记录公会和成员经验数据，用于计算经验/小时',
        'Records hourly net worth snapshots and shows a chart icon next to Total Net Worth. Disable to stop tracking and hide the chart button.':
            '每小时记录净资产快照，并在总净资产旁显示图表图标。禁用以停止追踪并隐藏图表按钮。',
        'Records transmutation sessions and displays history in a viewer tab in the Alchemy panel':
            '记录转化会话并在炼金面板的查看器标签页中显示历史',
        Refined: '精炼',
        'Refresh Prices': '刷新价格',
        'Refresh page to update current level': '刷新页面以更新当前等级',
        'Refreshing...': '刷新中...',
        'Remaining XP Text': '剩余经验文本',
        'Remaining XP: Add black text border for better visibility': '剩余经验：添加黑色文字边框以提高可见性',
        Remove: '移除',
        'Remove all custom price overrides?': '移除所有自定义价格覆盖？',
        'Remove ban': '取消禁用',
        'Remove exclusion': '移除排除',
        'Remove from comparison': '从对比中移除',
        'Remove pin': '取消固定',
        'Remove player': '移除角色',
        'Removes the green outline/glow from protected tasks while keeping the reroll confirmation active.':
            '移除受保护任务的绿色轮廓/发光，同时保持重随确认有效。',
        'Replaces the static time display on the action progress bar with a live countdown in seconds':
            '将行动进度条上的静态时间显示替换为实时倒计时（秒）',
        Required: '所需',
        'Reroll spent: ': '重随花费：',
        'Reroll!': '重随！',
        'Reset Consumable Tracking': '重置消耗品追踪',
        'Reset Order': '重置顺序',
        'Reset all settings to defaults? This cannot be undone.': '重置所有设置到默认？此操作不可撤销。',
        'Reset consumable tracking? This will clear all tracked consumption data and start fresh.':
            '重置消耗品追踪？这将清除所有已追踪的消耗数据并重新开始。',
        'Reset template to default? This will discard your current template.': '重置模板到默认？这将丢弃当前模板。',
        'Reset to Current': '重置为当前',
        'Reset to Defaults': '重置为默认',
        Restore: '恢复',
        'Restore to Default': '恢复为默认',
        Results: '结果',
        'Results: ': '结果：',
        Retry: '重试',
        'Rev/hr': '收入/时',
        'Revenue/day:': '收入/天：',
        'Revenue/hour:': '收入/小时：',
        'Revenue: ': '收入：',
        'Revenue: {0}/hr': '收入：{0}/时',
        Ring: '戒指',
        'Room Level': '房间等级',
        'Room Level: {0}': '房间等级：{0}',
        'Room Level: {0} | XP/room: {1}': '房间等级：{0} | 经验/房间：{1}',
        Rounding: '取整',
        'Rows per page:': '每页行数：',
        'Run ': '通关 ',
        'Run Chart': '通关图表',
        'Run History': '通关历史',
        'Run Number': '通关编号',
        'Run Times': '通关时间',
        'Runs:': '通关：',
        'Runs: {0} | Avg: {1} | Best: {2} | Worst: {3}': '通关：{0} | 平均：{1} | 最佳：{2} | 最差：{3}',
        SEND: '发送',
        Save: '保存',
        'Saves loot log entries and displays older entries below current ones in the loot log panel':
            '保存战利品日志条目，并在战利品日志面板中将旧条目显示在当前条目下方',
        'Saves your loadout equipment when you view loadouts, so profit/hr calculations use the correct tool bonuses even when that loadout is not equipped. Disable to always use currently-equipped gear.':
            '查看装备配置时保存你的装备，使利润/小时计算即使在未装备该配置时也能使用正确的工具加成。禁用则始终使用当前装备。',
        'Scan party chat and import historical runs': '扫描队伍聊天并导入历史记录',
        Scenario: '场景',
        'Script Accent Color': '脚本强调色',
        'Scroll Defaults': '卷轴默认值',
        'Scroll Simulation': '卷轴模拟',
        'Scroll Simulator UI': '卷轴模拟器界面',
        'Search actions, monsters, zones...': '搜索行动、怪物、区域...',
        'Search for a combat drop item, then click Seek.': '搜索战斗掉落物品，然后点击寻找。',
        'Search item...': '搜索物品...',
        'Search items, categories, houses, loadouts...': '搜索物品、类别、房屋、装备配置...',
        'Search items...': '搜索物品...',
        'Search settings...': '搜索设置...',
        'Search...': '搜索...',
        'Secondary Text': '次要文本',
        Seek: '寻找',
        'Seek cancelled.': '寻找已取消。',
        'Seek complete in {0}: {1} sources found for {2}': '寻找完成于{0}：为{2}找到{1}个来源',
        'Seek error: {0}': '寻找错误：{0}',
        'Seeking {0} in {1} zone/tiers... {2}': '正在{1}个区域/层级中寻找{0}...{2}',
        Select: '选择',
        'Select a monster and click Simulate.': '选择一个怪物并点击模拟。',
        'Select a monster first.': '请先选择一个怪物。',
        'Select a monster in the Max Level tab first.': '请先在最高等级标签页中选择一个怪物。',
        'Select a player and click Analyze.': '选择一个角色并点击分析。',
        'Select a zone and click Simulate.': '选择一个区域并点击模拟。',
        'Select a zone in Configure tab first.': '请先在配置标签页中选择一个区域。',
        Self: '自身',
        Sell: '卖出',
        'Sell Listing': '卖出挂单',
        'Sell Now': '立即卖出',
        'Sell Orders': '卖单',
        'Sell Orders (expected proceeds after tax)': '卖单（税后预期收益）',
        'Sell Price': '卖出价格',
        'Sell only': '仅卖出',
        'Session Duration': '记录持续时间',
        'Session Start': '记录开始',
        'Set custom buy/sell prices for items. Leave a field blank to use the marketplace price. Overridden prices show * in profit displays.':
            '为物品设置自定义买入/卖出价格。留空则使用市场价格。覆盖的价格在利润显示中显示 * 号。',
        'Set custom buy/sell prices for specific items. Overrides marketplace prices in profit calculations.':
            '为特定物品设置自定义买入/卖出价格。在利润计算中覆盖市场价格。',
        Settings: '设置',
        'Settings imported successfully ({0} keys imported). Please refresh the page.':
            '设置导入成功（已导入 {0} 个键值）。请刷新页面。',
        'Settings imported successfully ({0} keys imported, {1} skipped from other characters). Please refresh the page.':
            '设置导入成功（已导入 {0} 个键值，{1} 个来自其他角色的已跳过）。请刷新页面。',
        'Settings reset to defaults. Please refresh the page.': '设置已重置为默认。请刷新页面。',
        'Settings successfully copied to {0} character{1}!': '设置已成功复制到 {0} 个角色{1}！',
        'Shopping List': '购物清单',
        'Show ': '显示 ',
        'Show 24-hour average market prices': '显示24小时平均市场价格',
        'Show All': '显示全部',
        'Show Bars': '显示柱状图',
        'Show Details': '显示详情',
        'Show Dungeon Tracker UI panel': '显示副本追踪器UI面板',
        'Show XP/hr stats on Guild panel and Leaderboard': '在公会面板和排行榜上显示经验/小时统计',
        'Show ability book status': '显示技能书状态',
        'Show alert when market price data cannot be fetched': '无法获取市场价格数据时显示提示',
        'Show an ': '显示一个 ',
        'Show badge values net of market tax': '显示扣除市场税后的徽章价值',
        'Show badge when mentioned in chat': '在聊天中被提及时显示徽章',
        'Show battle/wave counter in current action panel during combat': '战斗期间在当前行动面板显示战斗/波次计数器',
        'Show category totals in inventory': '在背包中显示分类总计',
        'Show collection count badges on skilling action tiles': '在技能行动方块上显示收藏计数徽章',
        'Show combat zone index numbers on tasks': '在任务上显示战斗区域索引编号',
        'Show detailed materials breakdown in profit display': '在利润显示中显示详细材料分解',
        'Show dungeon icons on combat tasks': '在战斗任务上显示副本图标',
        'Show enhancement milestones (+5/+7/+10/+12)': '显示强化里程碑（+5/+7/+10/+12）',
        'Show enhancement path on enhanced items': '在强化物品上显示强化路径',
        'Show enhancement simulator calculations': '显示强化模拟器计算',
        'Show expected value for openable containers': '显示可开启容器的期望值',
        'Show gathering sources and profit': '显示采集来源和利润',
        'Show materials availability on production tasks': '显示生产任务的材料可用性',
        'Show more ({0} remaining)': '显示更多（剩余{0}）',
        'Show price badges on item icons': '在物品图标上显示价格徽章',
        'Show pricing modes as ': '将定价模式显示为 ',
        'Show production cost and profit': '显示生产成本和利润',
        'Show profit comparison for all item actions': '显示所有物品行动的利润比较',
        'Show rare drops from gathering': '显示采集的稀有掉落',
        'Show run time in party chat': '在队伍聊天中显示运行时间',
        'Show stack value badges when sorting by Ask/Bid': '按卖单价/买单价排序时显示堆叠价值徽章',
        'Show task efficiency rating (tokens/profit per hour)': '显示任务效率评级（代币/每小时利润）',
        'Show task statistics button on Tasks panel': '在任务面板上显示任务统计按钮',
        'Show total profit for gathering/production tasks': '显示采集/生产任务的总利润',
        'Show tracker only on Enhancing screen': '仅在强化界面显示追踪器',
        'Show upgrade costs with market prices and inventory comparison': '显示带有市场价格和背包对比的升级成本',
        'Show visual icons on task cards': '在任务卡片上显示视觉图标',
        'Showing all {0} listings': '显示全部{0}个挂单',
        'Showing all {0} sessions': '显示全部{0}条记录',
        'Showing top {0} of {1} items': '显示前{0}个，共{1}个物品',
        'Shows ask/bid market prices on tradeable items in the Labyrinth Shop tab':
            '在迷宫商店标签页中显示可交易物品的买卖单价',
        'Shows estimated queue time remaining for your other characters in a floating widget':
            '在浮动小部件中显示其他角色的预估队列剩余时间',
        'Shows estimated time remaining until the next level in the skill hover tooltip (based on current XP/hr)':
            '在技能悬停提示中显示达到下一级的预估剩余时间（基于当前经验/小时）',
        'Shows estimated total time accounting for self-return recycling during transmute actions':
            '显示考虑转化行动中自返回收的预估总时间',
        'Shows expected clear time and success rate on labyrinth skilling room tiles':
            '在迷宫技能房间方块上显示预期通关时间和成功率',
        'Shows expected cost and XP to reach +5, +7, +10, and +12 on unenhanced equipment tooltips':
            '在未强化装备提示上显示达到+5、+7、+10和+12的预期成本和经验',
        'Shows gathering actions that produce this item (foraging, woodcutting, milking)':
            '显示产出此物品的采集行动（采集、伐木、挤奶）',
        'Shows how many of the output item you currently own, on action tiles and in the action detail panel':
            '在行动方块和行动详情面板中显示当前拥有的产出物品数量',
        'Shows how many task actions you can complete with current inventory.': '显示使用当前背包可以完成多少次任务行动。',
        'Shows live clear chance during active labyrinth skilling/enhancing rooms':
            '在活跃的迷宫技能/强化房间中显示实时通关几率',
        'Shows material costs table with Ask/Bid prices, actions/hour, and profit breakdown':
            '显示带有买卖单价、行动/小时和利润分解的材料成本表',
        'Shows rare find drops from gathering zones (e.g., Thread of Expertise from Asteroid Belt)':
            '显示采集区域的稀有发现掉落（例如小行星带的专精之线）',
        'Shows the cheapest way to obtain a crafted item by comparing buy vs craft at each material tier.':
            '通过比较每个材料层级的购买与制作，显示获取制作物品的最便宜方式。',
        'Shows the optimal enhancement path cost breakdown when hovering over enhanced (+1 to +20) items':
            '悬停强化物品（+1至+20）时显示最优强化路径成本分解',
        'Shows whether ability is learned and current level/progress on ability book tooltips':
            '在技能书提示上显示技能是否已学习以及当前等级/进度',
        'Shows which dungeons contain the monster (requires Task Icons enabled)':
            '显示哪些副本包含该怪物（需要启用任务图标）',
        Shroud: '遮蔽',
        'Sim All Solo': '模拟全部单人',
        'Sim All Zones': '模拟全部区域',
        'Sim Character': '模拟角色',
        'Sim Hours': '模拟小时数',
        'Sim Time:': '模拟时间：',
        Simulate: '模拟',
        'Simulate combat encounters to estimate XP/hr, deaths, and consumable usage':
            '模拟战斗遭遇以估算经验/小时、死亡次数和消耗品使用',
        'Simulating ({0})... {1}': '模拟中（{0}）...{1}',
        'Simulating combat...': '模拟战斗中...',
        'Simulating {0} zones... {1}': '模拟{0}个区域中...{1}',
        'Simulating...': '模拟中...',
        'Simulation cancelled.': '模拟已取消。',
        'Simulation complete in {0}: {1} hours \\u00b7 {2} \\u00b7 {3}: {4}{5}':
            '模拟完成于{0}：{1}小时 \\u00b7 {2} \\u00b7 {3}：{4}{5}',
        'Simulation complete — {0}% win rate at level {1}.': '模拟完成——等级{1}胜率{0}%。',
        'Simulation error: {0}': '模拟错误：{0}',
        'Simulation failed:': '模拟失败：',
        Skill: '技能',
        'Skill / Zone': '技能 / 区域',
        'Skill Levels': '技能等级',
        'Skill Loadouts': '技能配置',
        'Skill books: Show books needed to reach target level (in the ability book item dictionary window)':
            '技能书：显示达到目标等级所需书籍（在技能书物品词典窗口中）',
        'Skill page: Craft toggle button': '技能页：制作切换按钮',
        'Skill page: Filter actions input': '技能页：筛选行动输入框',
        'Skill page: Pricing mode button': '技能页：定价模式按钮',
        'Skill page: Sort button': '技能页：排序按钮',
        'Skill tooltip: Show time till next level': '技能提示：显示下一级所需时间',
        'Skiller Score: {0}': '技能评分：{0}',
        Skilling: '技能',
        'Skilling Room Level': '技能房间等级',
        'Skilling clear rates calculated for level {0}.': '已计算等级{0}的技能通关率。',
        'Skilling upgrade analysis failed:': '技能升级分析失败：',
        Skills: '技能',
        'Skills: Simulate missing scroll effects in calculations': '技能：在计算中模拟缺失的卷轴效果',
        'Skip Worse Tiers': '跳过更差层级',
        Slot: '槽位',
        'Slot: ': '栏位：',
        'Slots Used': '已用栏位',
        Slowest: '最慢',
        'Slowest Run': '最慢通关',
        Socko: 'Socko',
        Solo: '单人',
        'Solo Runs': '单人通关',
        'Solo:': '单人：',
        'Some settings require a page refresh to take effect': '部分设置需要刷新页面才能生效',
        'Sort Tasks': '排序任务',
        'Sort by Profit': '按利润排序',
        'Sort by Profit ▲': '按利润排序 ▲',
        'Sort by Profit ▼': '按利润排序 ▼',
        'Sort by:': '排序方式：',
        'Sort inventory items by value': '按价值排序背包物品',
        'Sort:': '排序：',
        'Sort: Default': '排序：默认',
        'Sort: Profit': '排序：利润',
        'Sort: Profit/XP': '排序：利润/经验',
        'Sort: XP': '排序：经验',
        'Sorting... ▲': '排序中... ▲',
        'Sorting... ▼': '排序中... ▼',
        Special: '特殊',
        'Special Ability': '特殊技能',
        Speed: '速度',
        'Speed:': '速度：',
        Stale: '过期',
        Stam: '体力',
        Stamina: '体力',
        'Start Time: {0}': '开始时间：{0}',
        Statistics: '统计数据',
        'Stats unavailable (game data not loaded)': '统计数据不可用（游戏数据未加载）',
        Status: '状态',
        Stop: '停止',
        'Stop simming higher tiers for a zone if both XP/hr and profit/hr declined vs the previous tier':
            '如果某区域的每小时经验和利润均低于上一层级，则停止模拟更高层级',
        Success: '成功',
        'Success Rate': '成功率',
        'Success Rate: {0}': '成功率：{0}',
        'Success:': '成功：',
        'Success: {0} | Double: {1}': '成功：{0} | 双倍：{1}',
        'Success: {0}% | Double: {1}%': '成功：{0}% | 双倍：{1}%',
        Successes: '成功次数',
        'Sufficient ({0})': '充足（{0}）',
        'Summary Only': '仅摘要',
        'Super Enhancing Tea (+6)': '超级强化茶（+6）',
        'Suppresses injected tooltip content (prices, profit, milestones) when browsing items in the enhancement selector':
            '在强化选择器中浏览物品时抑制注入的提示内容（价格、利润、里程碑）',
        'Switch characters to capture queue state.': '切换角色以捕获队列状态。',
        Tailoring: '裁缝',
        Target: '目标',
        'Target Lv': '目标等级',
        'Target Win %': '目标胜率',
        'Target: +{0} | Effective Level: {1}': '目标：+{0} | 有效等级：{1}',
        'Task Auto-Reroll Reminder': '任务自动重随提醒',
        'Task Profit Breakdown': '任务利润明细',
        'Task Reroll Protection': '任务重随保护',
        'Task Rewards:': '任务奖励：',
        'Task Shop Value:': '任务商店价值：',
        'Task Slots': '任务栏位',
        'Task Statistics': '任务统计',
        'Task Tokens:': '任务代币：',
        'Task Tokens: Loading...': '任务代币：加载中...',
        'Task auto-reroll reminder': '任务自动重随提醒',
        'Task mode (force last step)': '任务模式（强制最后一步）',
        'Task profit per hour': '任务每小时利润',
        'Task reroll protection': '任务重随保护',
        'Task reroll protection: Hide green highlight': '任务重随保护：隐藏绿色高亮',
        'Task sort mode': '任务排序模式',
        'Task tokens per hour': '任务每小时代币',
        Tasks: '任务',
        'Tasks full!': '任务已满！',
        Tea: '茶',
        'Tea Bonus': '工匠茶加成',
        'Tea Constraints:': '工匠茶约束：',
        'Tea cost: {0}/hr {1}': '工匠茶成本：{0}/时 {1}',
        'Tea cost: {0}/hr ▶': '工匠茶成本：{0}/时 ▶',
        'Tea:': '工匠茶：',
        Team: '队伍',
        'Team:': '队伍：',
        'These scrolls override the defaults when this loadout is active for a skill.':
            '当此装备配置对某个技能激活时，这些卷轴会覆盖默认值。',
        'This action CANNOT be undone!\\n': '此操作不可撤销！\\n',
        'This will copy your current settings to {0} other character{1}. Their existing settings will be overwritten.\n\nContinue?':
            '这将把当前设置复制到 {0} 个其他角色{1}。他们现有的设置将被覆盖。\n\n是否继续？',
        'This will permanently delete ALL coinify history ({0} sessions).\\nThis cannot be undone.\\n\\nAre you sure?':
            '这将永久删除所有铸币历史（{0}条记录）。\\n此操作不可撤销。\\n\\n确定吗？',
        Tier: '层级',
        'Time (ms)': '时间（毫秒）',
        'Time format when using Date/Time display (only applies if Date/Time format is selected)':
            '使用日期/时间显示时的时间格式（仅在选择日期/时间格式时适用）',
        'Time since dungeon started': '副本开始以来用时',
        'Time to Completion': '完成时间',
        'Time to next tier': '下一阶所需时间',
        'To Buy': '待购买',
        'To level:': '目标等级：',
        'To:': '到：',
        'Toggle add mode: click to accumulate counts instead of setting them': '切换添加模式：点击累计数量而非设为固定值',
        'Toggle between Auto-Detect and Manual modes': '在自动检测和手动模式间切换',
        Token: '代币',
        'Token Shop Value:': '代币商店价值：',
        'Token Upgrades': '代币升级',
        'Token Value': '代币价值',
        Tokens: '代币',
        'Tokens Value': '代币价值',
        'Tokens/1%': '代币/1%',
        'Tool Success:': '工具成功率：',
        'Tool:': '工具：',
        Toolasha: 'Toolasha',
        'Tooltip Informational': '提示信息',
        'Tooltip Loss/Negative': '提示亏损/负值',
        'Tooltip Profit/Positive': '提示利润/正值',
        'Tooltip Warnings': '提示警告',
        Top: '上衣',
        'Top 10': '前10',
        'Top 10 Drops': '前10掉落',
        'Top 5': '前5',
        'Top 5 Drops': '前5掉落',
        'Top Order Age': '最高订单时长',
        'Top Order Price': '最高订单价格',
        'Top ask: ~{0}': '最高卖单价：~{0}',
        'Top right: Show current assets (net worth)': '右上角：显示当前资产（净资产）',
        Torch: '火炬',
        Total: '总计',
        'Total (non-combat)': '总计（非战斗）',
        'Total Action Profit': '总行动利润',
        'Total Attempts': '总尝试次数',
        'Total Coins': '总金币',
        'Total Cost': '总成本',
        'Total Cost (click for details)': '总成本（点击查看详情）',
        'Total EXP': '总经验',
        'Total Expenses': '总支出',
        'Total Gold': '总金币',
        'Total Income': '总收入',
        'Total Market Value: {0}': '市场总价值：{0}',
        'Total Price': '总价',
        'Total Profit (revenue - all costs)': '总利润（收入-所有成本）',
        'Total Profit:': '总利润：',
        'Total Revenue': '总收入',
        'Total Reward Value': '总奖励价值',
        'Total Task Tokens': '任务代币总计',
        'Total Value: —': '总价值：—',
        'Total XP Gained': '获得总经验',
        'Total XP/hr': '总经验/时',
        'Total completed / failed': '总完成/失败',
        'Total craft time': '制作总时间',
        'Total exp/hour:': '总经验/小时：',
        'Total exp:': '总经验：',
        'Total from {0} drops: {1}': '{0}个掉落总计：{1}',
        'Total material cost': '材料总成本',
        'Total ms': '总毫秒数',
        'Total profit: -- ⚠': '总利润：-- ⚠',
        'Total profit: 0': '总利润：0',
        'Total profit: {0}': '总利润：{0}',
        'Total quantity at best {0} price': '最优{0}价格总数量',
        'Total revenue:': '总收入：',
        'Total spend': '总花费',
        'Total time: 0s': '总时间：0秒',
        'Total time: {0}': '总时间：{0}',
        'Total time: ∞': '总时间：∞',
        'Total:': '总计：',
        'Total: [∞]': '总计：[∞]',
        'Total: {0}': '总计：{0}',
        'Total: {0} + [∞]': '总计：{0} + [∞]',
        'Total: {0} listings': '总计：{0}个挂单',
        'Track enhancement attempts, costs, and statistics': '追踪强化尝试、成本和统计数据',
        'Track guild and member XP over time': '追踪公会和成员的随时间经验变化',
        'Track task reroll costs': '追踪任务重随成本',
        'Tracks dungeon runs with server-validated duration from party messages':
            '通过队伍消息中的服务器验证时长追踪副本运行',
        'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)':
            '追踪重随每个任务花费的金币/牛铃（实验性——可能导致UI卡死）',
        'Tracks the highest recommended level enemy defeated per monster type and shows it in the Automation tab':
            '追踪每种怪物类型中击败的最高推荐等级敌人，并在自动化标签页中显示',
        Trainee: '学徒',
        'Transmutation Rates': '转化率',
        'Transmute History': '转化历史',
        'Transmute history cleared.': '转化历史已清除。',
        'Try exporting from Edible Tools again, or export to CSV from the Market History Viewer and import that instead.':
            '尝试从Edible Tools重新导出，或从市场历史查看器导出CSV并导入。',
        'Two Hand': '双手',
        Type: '类型',
        'Type /item, /wiki, or /market followed by an item name in chat. Example: /item radiant fiber':
            '在聊天中输入/item、/wiki或/market后跟物品名称。例如：/item radiant fiber',
        'Type a message...': '输入消息...',
        'Type: {0}': '类型：{0}',
        'UI Enhancements': 'UI增强',
        'Ultra Enhancing Tea (+8)': '终极强化茶（+8）',
        'Unable to calculate profit': '无法计算利润',
        'Unable to calculate projection': '无法计算预测',
        'Unclaimed coins (waiting to be collected)': '未领取金币（等待领取）',
        'Undercut by 1 (best buy - 1)': '降价1（最优买入-1）',
        'Undercut by 1 (best sell - 1)': '降价1（最优卖出-1）',
        'Unit cost': '单价',
        'Units/hr': '单位/时',
        Unknown: '未知',
        'Unknown Item': '未知物品',
        'Unknown Only': '仅未知',
        'Unknown Room': '未知房间',
        'Unknown error': '未知错误',
        'Unknown key': '未知键值',
        'Unorganized ({0})': '未分类（{0}）',
        'Unpin this action': '取消固定此行动',
        'Unrecognized format. Expected:': '无法识别的格式，期望：',
        Upgrade: '升级',
        'Upgrade analysis failed:': '升级分析失败：',
        'Use K/M/B number formatting (e.g., 1.5M instead of 1,500,000)': '使用K/M/B数字格式（如1.5M而非1,500,000）',
        'Use enhancement cost for highly enhanced items': '高强化物品使用强化成本',
        'Use pricing mode for expected value calculations': '在期望值计算中使用定价模式',
        'Use relative gradient colors': '使用相对渐变颜色',
        'Using party chat timestamps (computer sleep detected)': '使用队伍聊天时间戳（检测到电脑休眠）',
        'Value task tokens based on expected value from Task Shop chests. Disable to exclude them from net worth.':
            '基于任务商店箱子的期望值对任务代币进行估值。禁用则将其排除在净资产之外。',
        Verdant: '翠绿',
        Vertical: '垂直',
        'View Action': '查看行动',
        'View Card': '查看卡片',
        'View full table': '查看完整表格',
        'View last breakdown': '查看上次明细',
        Warnings: '警告',
        Wave: '波次',
        'Wave ': '波次 ',
        'When adding a category to a tab, add every item in that category (including items not in your inventory). When disabled, only items currently in your inventory are added.':
            '向标签页添加分类时，添加该分类中的所有物品（包括不在背包中的物品）。禁用时，仅添加当前背包中的物品。',
        'When adding items from a loadout to a tab, also include food and drink items.':
            '从装备配置向标签页添加物品时，同时包含食物和饮品物品。',
        'When an item appears in multiple tabs, it only shows in the highest (topmost) tab that contains it. When disabled, collapsing a tab releases its items to lower tabs.':
            '当物品出现在多个标签页中时，仅显示在包含它的最顶层标签页。禁用时，折叠标签页会将其物品释放到下层标签页。',
        'When clicking Go on a task, combines the required amounts of all in-progress tasks for the same action into a single pre-filled count':
            '点击任务的前往按钮时，将同一行动的所有进行中任务的需求量合并为单个预填数量',
        'When creating buy listings, choose whether to outbid, match, or undercut the current best buy price':
            '创建买入挂单时，选择加价、匹配或降价当前最优买入价格',
        'When creating sell listings, choose whether to match or undercut the current best sell price':
            '创建卖出挂单时，选择匹配或降价当前最优卖出价格',
        'When enabled, Scroll of... items from the Labyrinth are not auto-opened': '启用时，迷宫的卷轴类物品不会自动打开',
        'When enabled, missing materials calculation only considers current action request, ignoring materials already reserved by queued actions. Default (off) accounts for queue.':
            '启用时，缺失材料计算仅考虑当前行动请求，忽略已由队列行动预留的材料。默认（关闭）会考虑队列。',
        'When enabled, profit/XP/speed calculations show hypothetical results as if selected scrolls were active. Configure default scrolls with the button; override per-loadout from the Loadouts panel.':
            '启用时，利润/经验/速度计算显示选定卷轴激活时的假设结果。使用按钮配置默认卷轴；从装备配置面板按配置覆盖。',
        'When enabled, protection item availability is factored into the material limit estimate. Disable to see material limit based only on enhancement materials.':
            '启用时，保护物品的可用性计入材料限制估算。禁用则仅基于强化材料查看材料限制。',
        'When enabled, shows total probability (base rate × drop rate). When disabled, shows conditional probability (drop rate only, matching ':
            '启用时，显示总概率（基础概率×掉落率）。禁用时，显示条件概率（仅掉落率，匹配 ',
        'When enabled, uses crafting cost instead of market price for upgrade items if cheaper, and factors crafting time into profit/hr calculations.':
            '启用时，升级物品更便宜时使用制作成本而非市场价格，并将制作时间计入利润/小时计算。',
        'When enabled, uses the lower of crafting cost or market price for the base item in enhancement path calculations, applied independently to both the Ask and Bid columns':
            '启用时，在强化路径计算中对基础物品使用制作成本或市场价格中较低者，分别应用于卖单价和买单价列',
        'When viewing a recipe on an action panel, adjusts the total price to reflect actual material cost after Artisan Tea reduction':
            '在行动面板查看配方时，调整总价以反映工匠茶减半后的实际材料成本',
        'Whether to use ask (instant buy) or bid (patient buy) prices when valuing dungeon keys in tooltips, networth, and combat income calculations.':
            '在提示、净资产和战斗收入计算中评估副本钥匙价值时，使用卖单价（即时买入）还是买单价（挂单买入）价格。',
        'Win Rate': '胜率',
        'Win Rate:': '胜率：',
        'Win Rate: {0} | Avg Fight: {1}s': '胜率：{0} | 平均战斗：{1}秒',
        'Wisdom Tea:': '智慧茶：',
        Woodcutting: '伐木',
        'Work Power: {0} → Progress: {1}/{2} per success': '工作效率：{0} → 每次成功进度：{1}/{2}',
        'Worst-case per action (ceil per craft)': '每次行动最坏情况（每次制作向上取整）',
        XP: '经验',
        'XP Rate Text': '经验比率文本',
        'XP/Hour': '经验/时',
        'XP/hr': '经验/时',
        'XPH Calc': '经验/时计算器',
        You: '你',
        'You are about to delete {0} listings.\\n': '即将删除{0}个挂单。\\n',
        'You only have one character. Settings are already saved for this character.':
            '您只有一个角色。设置已为此角色保存。',
        'Your Enhancing Stats:': '你的强化统计：',
        'Your action queue is empty!': '你的行动队列为空！',
        'Your last buy price': '你的上次买入价',
        'Your last sell price': '你的上次卖出价',
        'Your level: {0}': '你的等级：{0}',
        'Your time value in gold per hour. Used to calculate if crafting intermediates is worth the time. Set to your typical hourly profit (e.g., 500000).':
            '你的时间价值（金币/小时）。用于计算制作中间材料是否值得花费时间。设置为你的典型每小时利润（例如500000）。',
        Zone: '区域',
        '[Toolasha] Failed to read layout file.': '[Toolasha] 读取布局文件失败。',
        '[Toolasha] Invalid layout file.': '[Toolasha] 布局文件无效。',
        '[Unknown action]': '[未知行动]',
        '[class*=': '[class*=',
        '[data-item-hrid]': '[data-item-hrid]',
        '[data-mwi-uid]': '[data-mwi-uid]',
        '[data-run-timestamp]': '[data-run-timestamp]',
        '[infinite]': '[无限]',
        '[role=': '[role=',
        '[∞]': '[∞]',
        '\\n': '\\n',
        '\\u21a9 Return': '\\u21a9 返回',
        ']': ']',
        _: '_',
        a: 'a',
        'a[href*=': 'a[href*=',
        action_completed: 'action_completed',
        actions_updated: 'actions_updated',
        active: '已激活',
        add: '添加',
        afterbegin: 'afterbegin',
        afterend: '之后',
        'at level': '在等级',
        attackInterval: '攻击间隔',
        battle: 'battle',
        beforebegin: 'beforebegin',
        buffs_updated: 'buffs_updated',
        button: '按钮',
        canvas: 'canvas',
        change: '更改',
        characterId: 'characterId',
        character_info_updated: 'character_info_updated',
        character_initialized: 'character_initialized',
        character_switched: 'character_switched',
        character_switching: 'character_switching',
        close: 'close',
        consumables_updated: 'consumables_updated',
        currentProfileId: 'currentProfileId',
        custom: 'custom',
        'days after': '天后',
        disconnected: 'disconnected',
        div: '区块',
        'div.SkillActionDetail_regularComponent__3oCgr': 'div.SkillActionDetail_regularComponent__3oCgr',
        drinkSlots: '饮品槽位',
        drinks: '饮品',
        drop: 'drop',
        each: 'each',
        'en-US': 'en-US',
        equipped: '已装备',
        error: 'error',
        'exp/hour:': '经验/小时：',
        expected_value_initialized: 'expected_value_initialized',
        food: '食物',
        foodSlots: '食物槽位',
        gold: 'gold',
        'gold limit': 'gold limit',
        'gold/hr': '金币/时',
        h2: 'h2',
        h3: 'h3',
        hour: '小时',
        house_rooms_updated: 'house_rooms_updated',
        'in use': '使用中',
        input: '输入',
        'input[type=': 'input[type=',
        'is active': '已激活',
        'is inactive': '未激活',
        items: '物品',
        items_updated: 'items_updated',
        keydown: 'keydown',
        kills: 'kills',
        labSimSkillingLoadouts: '迷宫模拟技能配置',
        label: '标签',
        marketHistoryKMBFormat: 'marketHistoryKMBFormat',
        market_item_order_books_updated: 'market_item_order_books_updated',
        market_listings_updated: 'market_listings_updated',
        mat: 'mat',
        'mat limit': 'mat limit',
        max: 'max',
        minute: '分钟',
        missing: '缺少',
        'more (refine search)': '更多（细化搜索）',
        mouseleave: 'mouseleave',
        mouseout: 'mouseout',
        mwilinks: 'mwilinks',
        networthChartPrefs: 'networthChartPrefs',
        open: 'open',
        option: '选项',
        p: 'p',
        'per task': '每个任务',
        personal_buffs_updated: 'personal_buffs_updated',
        playerXP_leaderboard: 'playerXP_leaderboard',
        queueMonitor_collapsed: 'queueMonitor_collapsed',
        quickInput_addMode: 'quickInput_addMode',
        reconnected: 'reconnected',
        's / ': 's / ',
        select: 'select',
        setting_updated: 'setting_updated',
        skills_updated: 'skills_updated',
        span: '跨度',
        step: '步',
        steps: '步',
        style: 'style',
        svg: 'svg',
        table: 'table',
        tbody: 'tbody',
        td: 'td',
        tea: 'tea',
        'text or /regex/': '文本或 /正则/',
        th: 'th',
        'th[data-sort-key]': '表头[data-sort-key]',
        thead: 'thead',
        'till next level': '距下一级',
        tokens: 'tokens',
        'tokens/hr': '代币/时',
        tr: 'tr',
        upgrade: 'upgrade',
        'upgrade limit': 'upgrade limit',
        'visit Combat to load sprites': '访问战斗面板加载精灵',
        week: '周',
        '{0} ({1} failed)': '{0}（{1}失败）',
        '{0} XP left': '剩余{0}经验',
        '{0} actions (+{1} excluded)': '{0}个行动（+{1}已排除）',
        '{0} actions evaluated': '已评估{0}个行动',
        '{0} collected — updated {1} ago': '已收集 {0} — {1} 前更新',
        '{0} day{1}': '{0}天{1}',
        '{0} hour{1}': '{0}小时{1}',
        '{0} input items': '{0}个输入物品',
        '{0} items selected': '已选{0}个物品',
        '{0} level {1} {2}%': '{0}等级{1} {2}%',
        '{0} minute{1}': '{0}分钟{1}',
        '{0} profitable of {1}': '{0}个盈利，共{1}个',
        '{0} profitable of {1} (+{2} excluded)': '{0}个盈利，共{1}个（+{2}已排除）',
        '{0} sessions': '{0}条记录',
        '{0} skilling upgrade candidates analyzed.': '已分析{0}个技能升级候选。',
        '{0} to level': '{0}到等级',
        '{0} to level {1} takes:': '{0}到等级{1}需要：',
        '{0} units': '{0}单位',
        '{0} upgrade candidates analyzed.': '已分析{0}个升级候选。',
        '{0} week{1}': '{0}周{1}',
        '{0} xp/h': '{0}经验/小时',
        '{0} x{1} (self-return)': '{0} x{1}（自回）',
        '{0} x{1} = {2} ({3} each)': '{0} x{1} = {2}（每个{3}）',
        '{0}/ea': '{0}/个',
        '{0}/hr | Total time: 0s': '{0}/时 | 总时间：0秒',
        '{0}/hr | Total time: {1}': '{0}/时 | 总时间：{1}',
        '{0}/hr | Total time: ∞': '{0}/时 | 总时间：∞',
        '{count} items · {withCost} with cost data': '{count}个物品 · {withCost}个有成本数据',
        '{name} (category)': '{name}（类别）',
        '|': '|',
        '~Age': '~时长',
        '~Unknown': '~未知',
        '~{0}': '~{0}',
        '~{0} protections': '~{0}次保护',
        '~{0} to target': '~{0}到目标',
        '—': '—',
        '— Current Gear —': '— 当前装备 —',
        '— Historical Entries ({0}) —': '— 历史记录（{0}）—',
        '• Action time: {0}s (includes {1}% speed bonus)': '• 行动时间：{0}秒（含{1}%速度加成）',
        '• Attempts and time are statistical averages<br>': '• 尝试次数和时间为统计平均值<br>',
        '• Market Tax: 2% of revenue → {0}': '• 市场税：收入的2% → {0}',
        '• No protection used (all failures return to +0)<br>': '• 未使用保护（失败全部归零）<br>',
        '• Protection active from +{0} onwards (enhancement level -1 on failure)<br>':
            '• 从+{0}开始启用保护（失败降1级）<br>',
        '← All {0} actions': '← 所有{0}个行动',
        '⏱{0}': '⏱{0}',
        '⏳ Fetching...': '⏳ 获取中...',
        '⏸ Queued': '⏸ 排队',
        '▶ Active': '▶ 活跃',
        '▶ Total Value: {0}/{1}': '▶ 总价值：{0}/{1}',
        '▼ {0} (+{1})': '▼ {0}（+{1}）',
        '▼ {0} actions': '▼ {0}个行动',
        '▼ {0} profitable': '▼ {0}个盈利',
        '▼ {0} profitable (+{1})': '▼ {0}个盈利（+{1}）',
        '⚙️ ENHANCEMENT CALCULATOR': '⚙️ 强化计算器',
        '⚙️ Toolasha Settings (refresh to apply)': '⚙️ Toolasha 设置（刷新页面生效）',
        '⚠ Disconnected from game tab': '⚠ 与游戏标签页断开连接',
        '⚠️ Market data unavailable': '⚠️ 市场数据不可用',
        '⚠️ This will permanently delete ALL transmute history ({0} sessions).\\nThis cannot be undone.\\n\\nAre you sure?':
            '⚠️ 这将永久删除所有转化历史（{0}条记录）。\\n此操作不可撤销。\\n\\n确定吗？',
        '⚠️ WARNING: This will permanently delete ALL market history data!\\n':
            '⚠️ 警告：这将永久删除所有市场历史数据！\\n',
        '✅ Updated!': '✅ 已更新！',
        '✏️ Manual': '✏️ 手动',
        '✓ Copied': '✓ 已复制',
        '✕ Remove': '✕ 移除',
        '✗ Failed': '✗ 失败',
        '✗ No Data': '✗ 无数据',
        '❌ Error': '❌ 错误',
        '❌ Failed': '❌ 失败',
        '⟳ Backfill': '⟳ 回填',
        '⟳ Processing...': '⟳ 处理中...',
        '🎉 {0} reached {1} {2}!': '🎉 {0} 已达到 {1} {2}！',
        '📊 Costs by Enhancement Level': '📊 各等级强化成本',
        '🔄 Fetch Latest Prices': '🔄 获取最新价格',
        '🔍 Auto': '🔍 自动',
        queued: '已排队',
        's/action': '秒/次',
        'actions/hr': '次/时',
        'items/hr': '个/时',
        '📊 Tracked {0} - No consumption yet (rate decreases over time)': '📊 已追踪 {0} - 暂无消耗（速率随时间衰减）',
    });

    /**
     * Settings Configuration
     * Organizes all script settings into logical groups for the settings UI
     */


    const settingsGroups = {
        ironCow: {
            title: t('Iron Cow Mode'),
            icon: '🐄',
            settings: {
                ironCow_enabled: {
                    id: 'ironCow_enabled',
                    label: t('Iron Cow Mode'),
                    type: 'checkbox',
                    default: false,
                    hidden: true,
                    help: t('Disable all market and profit features for a no-marketplace playthrough.'),
                },
            },
        },
        general: {
            title: t('General Settings'),
            icon: '⚙️',
            settings: {
                networkAlert: {
                    id: 'networkAlert',
                    label: t('Show alert when market price data cannot be fetched'),
                    type: 'checkbox',
                    default: true,
                },
                chatCommands: {
                    id: 'chatCommands',
                    label: t('Enable chat commands (/item, /wiki, /market)'),
                    type: 'checkbox',
                    default: true,
                    help: t('Type /item, /wiki, or /market followed by an item name in chat. Example: /item radiant fiber'),
                },
                chat_mentionTracker: {
                    id: 'chat_mentionTracker',
                    label: t('Show badge when mentioned in chat'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays a red badge on chat tabs when someone @mentions you'),
                },
                chat_popOut: {
                    id: 'chat_popOut',
                    label: t('Enable Pop-out Chat Window button'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a button to the chat panel to open chat in a separate browser window with multi-channel split view'
                    ),
                },
                chatHistoryExtender: {
                    id: 'chatHistoryExtender',
                    label: t('Chat: Extend chat history'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Preserves messages that the game removes from the live buffer, keeping them visible above the live chat'
                    ),
                },
                chatHistoryExtender_maxHistory: {
                    id: 'chatHistoryExtender_maxHistory',
                    label: t('Chat: Max messages to retain per tab'),
                    type: 'text',
                    default: '150',
                },
                altClickNavigation: {
                    id: 'altClickNavigation',
                    label: t('Alt+click items to navigate to crafting/gathering or dictionary'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Hold Alt/Option and click any item to navigate to its crafting/gathering page, or item dictionary if not craftable'
                    ),
                },
                collectionNavigation: {
                    id: 'collectionNavigation',
                    label: t('Add navigation buttons to collection items'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds View Action and Item Dictionary buttons when clicking collection items'),
                },
                queueMonitor: {
                    id: 'queueMonitor',
                    label: t('Cross-character queue monitor'),
                    type: 'checkbox',
                    default: false,
                    help: t('Shows estimated queue time remaining for your other characters in a floating widget'),
                },
            },
        },

        actionPanel: {
            title: t('Action Panel Enhancements'),
            icon: '⚡',
            settings: {
                actionBar_enabled: {
                    id: 'actionBar_enabled',
                    label: t('Action bar: Enable action bar display'),
                    type: 'checkbox',
                    default: true,
                },
                actionBar_compactWidth: {
                    id: 'actionBar_compactWidth',
                    label: t('Action bar: Compact width (800px limit)'),
                    type: 'checkbox',
                    default: false,
                    help: t('Limits action bar width to 800px. Useful for wide monitors.'),
                },
                actionBar_showQueueCount: {
                    id: 'actionBar_showQueueCount',
                    label: t('Action bar: Queue/remaining count'),
                    type: 'checkbox',
                    default: true,
                },
                actionBar_showActionDuration: {
                    id: 'actionBar_showActionDuration',
                    label: t('Action bar: Time per action (e.g. 14.94s/action)'),
                    type: 'checkbox',
                    default: true,
                },
                actionBar_showActionsPerHour: {
                    id: 'actionBar_showActionsPerHour',
                    label: t('Action bar: Actions/hr and items/hr'),
                    type: 'checkbox',
                    default: true,
                },
                actionBar_showTimeRemaining: {
                    id: 'actionBar_showTimeRemaining',
                    label: t('Action bar: Time remaining and completion ETA'),
                    type: 'checkbox',
                    default: true,
                },
                actionBar_showRecycleTime: {
                    id: 'actionBar_showRecycleTime',
                    label: t('Action bar: Transmute recycle time estimate'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows estimated total time accounting for self-return recycling during transmute actions'),
                },
                actionPanel_liveCountdown: {
                    id: 'actionPanel_liveCountdown',
                    label: t('Action bar: Live countdown timer'),
                    type: 'checkbox',
                    default: false,
                    help: t('Replaces the static time display on the action progress bar with a live countdown in seconds'),
                },
                actionPanel_totalTime: {
                    id: 'actionPanel_totalTime',
                    label: t('Action panel: Total time, times to reach target level, exp/hour'),
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_totalTime_quickInputs: {
                    id: 'actionPanel_totalTime_quickInputs',
                    label: t('Action panel: Quick input buttons (hours, count presets, Max)'),
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_quickInputs_countPresets: {
                    id: 'actionPanel_quickInputs_countPresets',
                    label: t('Action panel: Custom count presets (comma-separated, e.g. 100,1000,1000000)'),
                    type: 'text',
                    default: '',
                },
                actionPanel_quickInputs_hourPresets: {
                    id: 'actionPanel_quickInputs_hourPresets',
                    label: t('Action panel: Custom hour presets (comma-separated, e.g. 0.5,1,24,168,720)'),
                    type: 'text',
                    default: '',
                },
                actionPanel_foragingTotal: {
                    id: 'actionPanel_foragingTotal',
                    label: t('Action panel: Overall profit for multi-outcome foraging'),
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showFilter: {
                    id: 'actionPanel_showFilter',
                    label: t('Skill page: Filter actions input'),
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showSort: {
                    id: 'actionPanel_showSort',
                    label: t('Skill page: Sort button'),
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showPricingMode: {
                    id: 'actionPanel_showPricingMode',
                    label: t('Skill page: Pricing mode button'),
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_showCraftToggle: {
                    id: 'actionPanel_showCraftToggle',
                    label: t('Skill page: Craft toggle button'),
                    type: 'checkbox',
                    default: true,
                },
                actionQueue: {
                    id: 'actionQueue',
                    label: t('Queued actions: Show total time and completion time'),
                    type: 'checkbox',
                    default: true,
                },
                actionQueue_showValue: {
                    id: 'actionQueue_showValue',
                    label: t('Queued actions: Show profit/value for queued actions'),
                    type: 'checkbox',
                    default: true,
                },
                actionPanel_enhanceMatLimitProtections: {
                    id: 'actionPanel_enhanceMatLimitProtections',
                    label: t('Enhancement material limit: Include protection items'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'When enabled, protection item availability is factored into the material limit estimate. Disable to see material limit based only on enhancement materials.'
                    ),
                },
                actionQueue_valueMode: {
                    id: 'actionQueue_valueMode',
                    label: t('Queued actions: Value calculation mode'),
                    type: 'select',
                    default: 'profit',
                    options: [
                        { value: 'profit', label: t('Total Profit (revenue - all costs)') },
                        { value: 'estimated_value', label: t('Estimated Value (revenue after tax)') },
                    ],
                    help: t(
                        'Choose how to calculate the total value for queued actions. Profit shows net earnings after materials and drinks. Estimated Value shows gross revenue after market tax (always positive).'
                    ),
                },
                actionPanel_outputTotals: {
                    id: 'actionPanel_outputTotals',
                    label: t('Action panel: Show total expected outputs below per-action outputs'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays calculated totals when you enter a quantity in the action input'),
                },
                actionPanel_maxProduceable: {
                    id: 'actionPanel_maxProduceable',
                    label: t('Action panel: Show max produceable count on crafting actions'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays how many items you can make based on current inventory'),
                },
                actionPanel_showProfitPerHour: {
                    id: 'actionPanel_showProfitPerHour',
                    label: t('Action page: Show profit/hr on tiles'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays profit/hr on each action tile in the action list page'),
                },
                actionPanel_showProfitDetail: {
                    id: 'actionPanel_showProfitDetail',
                    label: t('Action panel: Show profitability detail'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Displays the profitability breakdown section inside gathering, production, and alchemy action panels'
                    ),
                },
                actionPanel_showLevelProgress: {
                    id: 'actionPanel_showLevelProgress',
                    label: t('Action panel: Show level progress'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays XP and level progress estimates inside action panels'),
                },
                actionPanel_showExpPerHour: {
                    id: 'actionPanel_showExpPerHour',
                    label: t('Action page: Show exp/hr on tiles'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays exp/hr on each action tile in the action list page'),
                },
                actionPanel_hideNegativeProfit: {
                    id: 'actionPanel_hideNegativeProfit',
                    label: t('Action panel: Hide actions with negative profit'),
                    type: 'checkbox',
                    default: false,
                    help: t('Hides action panels that would result in a loss (negative profit/hr)'),
                },
                requiredMaterials: {
                    id: 'requiredMaterials',
                    label: t('Action panel: Show total required and missing materials'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays total materials needed and shortfall when entering quantity'),
                },
                alchemy_profitDisplay: {
                    id: 'alchemy_profitDisplay',
                    label: t('Alchemy panel: Show profit calculator'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Displays profit/hour and profit/day for alchemy actions based on success rate and market prices'
                    ),
                },
                alchemy_bestItems: {
                    id: 'alchemy_bestItems',
                    label: t('Alchemy panel: Show best items button'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds a button to see items ranked by profit or XP for each alchemy type.'),
                },
                alchemy_transmuteHistory: {
                    id: 'alchemy_transmuteHistory',
                    label: t('Alchemy panel: Track and view transmute session history'),
                    type: 'checkbox',
                    default: true,
                    help: t('Records transmutation sessions and displays history in a viewer tab in the Alchemy panel'),
                },
                alchemy_coinifyHistory: {
                    id: 'alchemy_coinifyHistory',
                    label: t('Alchemy panel: Track and view coinify session history'),
                    type: 'checkbox',
                    default: true,
                    help: t('Records coinify sessions and displays history in a viewer tab in the Alchemy panel'),
                },
                alchemy_decomposeHistory: {
                    id: 'alchemy_decomposeHistory',
                    label: t('Alchemy panel: Track and view decompose session history'),
                    type: 'checkbox',
                    default: true,
                    help: t('Records decompose sessions and displays history in a viewer tab in the Alchemy panel'),
                },
                alchemy_actionProtection: {
                    id: 'alchemy_actionProtection',
                    label: t('Alchemy panel: Protect categories from accidental alchemy actions'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Blocks alchemy action buttons for 3 seconds when the selected item belongs to a protected category. A shield icon appears in the alchemy panel to configure protected categories.'
                    ),
                },
                actions_missingMaterialsButton: {
                    id: 'actions_missingMaterialsButton',
                    label: t('Show "Missing Mats Marketplace" button on production panels'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds button to production panels that opens marketplace with tabs for missing materials'),
                },
                actions_missingMaterialsButton_ignoreQueue: {
                    id: 'actions_missingMaterialsButton_ignoreQueue',
                    label: t('Ignore queued actions when calculating missing materials'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'When enabled, missing materials calculation only considers current action request, ignoring materials already reserved by queued actions. Default (off) accounts for queue.'
                    ),
                },
                actions_budgetCalculator: {
                    id: 'actions_budgetCalculator',
                    label: t('Action panel: Budget calculator'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a budget input below the Missing Mats button. Enter a gold budget (e.g. 50m) to calculate how many units you can produce by buying missing tradeable materials at ask price.'
                    ),
                },
                actionPanel_bestCraftingPlan: {
                    id: 'actionPanel_bestCraftingPlan',
                    label: t('Action panel: Show best crafting plan'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Shows the cheapest way to obtain a crafted item by comparing buy vs craft at each material tier.'
                    ),
                },
                actionPanel_craftingPlanBuyIntermediates: {
                    id: 'actionPanel_craftingPlanBuyIntermediates',
                    label: t('Action panel: Crafting plan buys raw materials only'),
                    type: 'checkbox',
                    default: false,
                    help: t('Always craft items that have a recipe — only buy uncraftable raw materials from the market.'),
                },
                actionPanel_craftingPlanNoProcessing: {
                    id: 'actionPanel_craftingPlanNoProcessing',
                    label: t('Action panel: Crafting plan no processing'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Only craft the final item — buy all sub-materials from the market instead of processing them yourself.'
                    ),
                },
                actionPanel_craftingPlanTaskMode: {
                    id: 'actionPanel_craftingPlanTaskMode',
                    label: t('Action panel: Crafting plan task mode'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Forces the final craft step (for task credit) but allows buying intermediate materials if cheaper.'
                    ),
                },
                actionPanel_craftingPlanTimeCost: {
                    id: 'actionPanel_craftingPlanTimeCost',
                    label: t('Action panel: Crafting plan time cost'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Factor in the time cost of crafting when deciding buy vs craft. Uses your gold/hr value to determine if crafting is worth your time.'
                    ),
                },
                actionPanel_craftingPlanGoldPerHour: {
                    id: 'actionPanel_craftingPlanGoldPerHour',
                    label: t('Action panel: Crafting plan gold/hr value'),
                    type: 'number',
                    default: 0,
                    help: t(
                        'Your time value in gold per hour. Used to calculate if crafting intermediates is worth the time. Set to your typical hourly profit (e.g., 500000).'
                    ),
                },
                lootLogStats: {
                    id: 'lootLogStats',
                    label: t('Loot Log Statistics'),
                    type: 'checkbox',
                    default: true,
                    help: t('Display total value, average time, and daily output in loot logs'),
                },
                lootLogHistory: {
                    id: 'lootLogHistory',
                    label: t('Loot Log: Persist and display historical entries'),
                    type: 'checkbox',
                    default: true,
                    help: t('Saves loot log entries and displays older entries below current ones in the loot log panel'),
                },
                inventoryCountDisplay: {
                    id: 'inventoryCountDisplay',
                    label: t('Action panels: Show current inventory count of output item'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Shows how many of the output item you currently own, on action tiles and in the action detail panel'
                    ),
                },
                actions_pinnedPage: {
                    id: 'actions_pinnedPage',
                    label: t('Pinned actions page in navigation bar'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a Pinned button to the left nav bar that shows all pinned actions in one list with skill, level, profit/hr, and XP/hr.'
                    ),
                },
            },
        },

        tooltips: {
            title: t('Item Tooltip Enhancements'),
            icon: '💬',
            settings: {
                itemTooltip_prices: {
                    id: 'itemTooltip_prices',
                    label: t('Show 24-hour average market prices'),
                    type: 'checkbox',
                    default: true,
                },
                itemTooltip_artisanPrices: {
                    id: 'itemTooltip_artisanPrices',
                    label: t('Adjust tooltip prices for Artisan Tea reduction'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'When viewing a recipe on an action panel, adjusts the total price to reflect actual material cost after Artisan Tea reduction'
                    ),
                },
                itemTooltip_profit: {
                    id: 'itemTooltip_profit',
                    label: t('Show production cost and profit'),
                    type: 'checkbox',
                    default: true,
                },
                itemTooltip_detailedProfit: {
                    id: 'itemTooltip_detailedProfit',
                    label: t('Show detailed materials breakdown in profit display'),
                    type: 'checkbox',
                    default: false,
                    help: t('Shows material costs table with Ask/Bid prices, actions/hour, and profit breakdown'),
                },
                itemTooltip_multiActionProfit: {
                    id: 'itemTooltip_multiActionProfit',
                    label: t('Show profit comparison for all item actions'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Displays best profit/hr highlighted, with other alternative actions (craft, coinify, decompose, transmute) summarized below'
                    ),
                },
                profitCalc_craftUpgradeItems: {
                    id: 'profitCalc_craftUpgradeItems',
                    label: t('Profit: Use crafting cost for upgrade items if cheaper'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'When enabled, uses crafting cost instead of market price for upgrade items if cheaper, and factors crafting time into profit/hr calculations.'
                    ),
                },
                itemTooltip_expectedValue: {
                    id: 'itemTooltip_expectedValue',
                    label: t('Show expected value for openable containers'),
                    type: 'checkbox',
                    default: true,
                },
                expectedValue_showDrops: {
                    id: 'expectedValue_showDrops',
                    label: t('Expected value drop display'),
                    type: 'select',
                    default: 'All',
                    options: [
                        { value: 'Top 5', label: t('Top 5') },
                        { value: 'Top 10', label: t('Top 10') },
                        { value: 'All', label: t('All Drops') },
                        { value: 'None', label: t('Summary Only') },
                    ],
                },
                expectedValue_respectPricingMode: {
                    id: 'expectedValue_respectPricingMode',
                    label: t('Use pricing mode for expected value calculations'),
                    type: 'checkbox',
                    default: true,
                },
                expectedValue_includeCowbells: {
                    id: 'expectedValue_includeCowbells',
                    label: t('Include cowbell value in expected value calculations'),
                    type: 'checkbox',
                    default: true,
                },
                showConsumTips: {
                    id: 'showConsumTips',
                    label: t('HP/MP consumables: Restore speed, cost performance'),
                    type: 'checkbox',
                    default: true,
                },
                dungeonTokenTooltips: {
                    id: 'dungeonTokenTooltips',
                    label: t('Currency tooltips: Show shop values for tokens, seals, and cowbells'),
                    type: 'checkbox',
                    default: true,
                },
                enhanceSim: {
                    id: 'enhanceSim',
                    label: t('Show enhancement simulator calculations'),
                    type: 'checkbox',
                    default: true,
                },
                enhanceSim_showConsumedItemsDetail: {
                    id: 'enhanceSim_showConsumedItemsDetail',
                    label: t('Enhancement tooltips: Show detailed breakdown for consumed items'),
                    type: 'checkbox',
                    default: false,
                    help: "When enabled, shows base/materials/protection breakdown for each consumed item in Philosopher's Mirror calculations",
                },
                enhanceSim_baseItemCraftingCost: {
                    id: 'enhanceSim_baseItemCraftingCost',
                    label: t('Enhancement path: Use crafting cost for base item if cheaper'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'When enabled, uses the lower of crafting cost or market price for the base item in enhancement path calculations, applied independently to both the Ask and Bid columns'
                    ),
                },
                itemTooltip_gathering: {
                    id: 'itemTooltip_gathering',
                    label: t('Show gathering sources and profit'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows gathering actions that produce this item (foraging, woodcutting, milking)'),
                },
                itemTooltip_gatheringRareDrops: {
                    id: 'itemTooltip_gatheringRareDrops',
                    label: t('Show rare drops from gathering'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows rare find drops from gathering zones (e.g., Thread of Expertise from Asteroid Belt)'),
                },
                itemTooltip_abilityStatus: {
                    id: 'itemTooltip_abilityStatus',
                    label: t('Show ability book status'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows whether ability is learned and current level/progress on ability book tooltips'),
                },
                itemTooltip_enhancementMilestones: {
                    id: 'itemTooltip_enhancementMilestones',
                    label: t('Show enhancement milestones (+5/+7/+10/+12)'),
                    type: 'checkbox',
                    default: false,
                    help: t('Shows expected cost and XP to reach +5, +7, +10, and +12 on unenhanced equipment tooltips'),
                },
                itemTooltip_enhancementPath: {
                    id: 'itemTooltip_enhancementPath',
                    label: t('Show enhancement path on enhanced items'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Shows the optimal enhancement path cost breakdown when hovering over enhanced (+1 to +20) items'
                    ),
                },
                itemTooltip_pinTop: {
                    id: 'itemTooltip_pinTop',
                    label: t('Pin tooltips to top-center of screen'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Forces item tooltips to always appear centered at the top of the screen instead of near the hovered item'
                    ),
                },
                itemTooltip_hideInEnhanceSelector: {
                    id: 'itemTooltip_hideInEnhanceSelector',
                    label: t('Hide tooltip extras in enhance item selector'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Suppresses injected tooltip content (prices, profit, milestones) when browsing items in the enhancement selector'
                    ),
                },
            },
        },

        enhancementSimulator: {
            title: t('Enhancement Simulator Settings'),
            icon: '✨',
            settings: {
                enhanceSim_autoDetect: {
                    id: 'enhanceSim_autoDetect',
                    label: t('Auto-detect your stats (false = use settings below)'),
                    type: 'checkbox',
                    default: false,
                    help: t('Most players should leave this off to see realistic professional enhancer costs'),
                },
                // --- ENHANCING ---
                enhanceSim_enhancingLevel: {
                    id: 'enhanceSim_enhancingLevel',
                    label: t('Enhancing skill level'),
                    type: 'number',
                    default: 140,
                    min: 1,
                    max: 200,
                    help: t('Default: 140 (professional enhancer level)'),
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_houseLevel: {
                    id: 'enhanceSim_houseLevel',
                    label: t('Observatory house room level'),
                    type: 'number',
                    default: 8,
                    min: 0,
                    max: 8,
                    help: t('Default: 8 (max level)'),
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_achievement: {
                    id: 'enhanceSim_achievement',
                    label: t('Achievement bonus (+0.2%)'),
                    type: 'checkbox',
                    default: false,
                    help: t('Include enhancing achievement success bonus'),
                    disabledBy: 'enhanceSim_autoDetect',
                },
                // --- GEAR (compact rows: checkbox + optional tier + enhancement level) ---
                enhanceSim_gear_enhancer: {
                    id: 'enhanceSim_gear_enhancer',
                    label: t('Enhancer'),
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'celestial', level: 13 },
                    tiers: [
                        { value: 'cheese', label: t('Cheese') },
                        { value: 'verdant', label: t('Verdant') },
                        { value: 'azure', label: t('Azure') },
                        { value: 'burble', label: t('Burble') },
                        { value: 'crimson', label: t('Crimson') },
                        { value: 'rainbow', label: t('Rainbow') },
                        { value: 'holy', label: t('Holy') },
                        { value: 'celestial', label: t('Celestial') },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_gloves: {
                    id: 'enhanceSim_gear_gloves',
                    label: t('Gloves'),
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_top: {
                    id: 'enhanceSim_gear_top',
                    label: t('Top'),
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_bottoms: {
                    id: 'enhanceSim_gear_bottoms',
                    label: t('Bottoms'),
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_neck: {
                    id: 'enhanceSim_gear_neck',
                    label: t('Neck'),
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'philo', level: 10 },
                    tiers: [
                        { value: 'philo', label: t('Philo') },
                        { value: 'speed', label: t('Speed') },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_ring: {
                    id: 'enhanceSim_gear_ring',
                    label: t('Ring'),
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'philo', level: 10 },
                    tiers: [
                        { value: 'philo', label: t('Philo') },
                        { value: 'rarefind', label: t('Rare Find') },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_earring: {
                    id: 'enhanceSim_gear_earring',
                    label: t('Earring'),
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'philo', level: 10 },
                    tiers: [
                        { value: 'philo', label: t('Philo') },
                        { value: 'rarefind', label: t('Rare Find') },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_cape: {
                    id: 'enhanceSim_gear_cape',
                    label: t('Cape'),
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'normal', level: 5 },
                    tiers: [
                        { value: 'normal', label: t('Normal') },
                        { value: 'refined', label: t('Refined') },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_guzzling: {
                    id: 'enhanceSim_gear_guzzling',
                    label: t('Guzzling'),
                    type: 'enhanceGear',
                    default: { enabled: true, level: 10 },
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_gear_charm: {
                    id: 'enhanceSim_gear_charm',
                    label: t('Charm'),
                    type: 'enhanceGear',
                    default: { enabled: true, tier: 'grandmaster', level: 0 },
                    tiers: [
                        { value: 'trainee', label: t('Trainee') },
                        { value: 'basic', label: t('Basic') },
                        { value: 'advanced', label: t('Advanced') },
                        { value: 'expert', label: t('Expert') },
                        { value: 'master', label: t('Master') },
                        { value: 'grandmaster', label: t('Grandmaster') },
                    ],
                    disabledBy: 'enhanceSim_autoDetect',
                },
                // --- BUFFS ---
                enhanceSim_tea: {
                    id: 'enhanceSim_tea',
                    label: t('Enhancing tea'),
                    type: 'select',
                    default: 'ultra',
                    options: [
                        { value: 'none', label: t('None') },
                        { value: 'basic', label: t('Enhancing Tea (+3)') },
                        { value: 'super', label: t('Super Enhancing Tea (+6)') },
                        { value: 'ultra', label: t('Ultra Enhancing Tea (+8)') },
                    ],
                    help: t('Enhancing tea provides skill level bonus'),
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_blessedTea: {
                    id: 'enhanceSim_blessedTea',
                    label: t('Blessed Tea active'),
                    type: 'checkbox',
                    default: true,
                    help: t('Professional enhancers use this to reduce attempts'),
                    disabledBy: 'enhanceSim_autoDetect',
                },
                enhanceSim_communityBuff: {
                    id: 'enhanceSim_communityBuff',
                    label: t('Community Buff'),
                    type: 'enhanceGear',
                    default: { enabled: true, level: 1 },
                    help: t('Enhancing speed community buff. Checked = auto-detect from game.'),
                    checkedMeansAuto: true,
                    disabledBy: 'enhanceSim_autoDetect',
                },
            },
        },

        enhancementTracker: {
            title: t('Enhancement Tracker'),
            icon: '📊',
            settings: {
                enhancementTracker: {
                    id: 'enhancementTracker',
                    label: t('Enable Enhancement Tracker'),
                    type: 'checkbox',
                    default: false,
                    help: t('Track enhancement attempts, costs, and statistics'),
                },
                enhancementTracker_showOnlyOnEnhancingScreen: {
                    id: 'enhancementTracker_showOnlyOnEnhancingScreen',
                    label: t('Show tracker only on Enhancing screen'),
                    type: 'checkbox',
                    default: false,
                    help: t('Hide tracker when not on the Enhancing screen'),
                },
                enhancementXPH: {
                    id: 'enhancementXPH',
                    label: t('Enhancement: XPH calculator'),
                    type: 'checkbox',
                    default: true,
                    help: t('Ranks all enhanceable items by expected XP per hour at your current stats'),
                },
                enhancementXPH_maxLevel: {
                    id: 'enhancementXPH_maxLevel',
                    label: t('Enhancement XPH: Default max enhancement level (1–20)'),
                    type: 'text',
                    default: '6',
                },
                enhancementXPH_protectFrom: {
                    id: 'enhancementXPH_protectFrom',
                    label: t('Enhancement XPH: Default protect from level (0 = no protection)'),
                    type: 'text',
                    default: '0',
                },
            },
        },

        economy: {
            title: t('Economy & Inventory'),
            icon: '💰',
            settings: {
                networth: {
                    id: 'networth',
                    label: t('Top right: Show current assets (net worth)'),
                    type: 'checkbox',
                    default: true,
                    help: t('Enhanced items valued by enhancement simulator'),
                },
                invWorth: {
                    id: 'invWorth',
                    label: t('Below inventory: Show inventory summary'),
                    type: 'checkbox',
                    default: true,
                },
                invSort: {
                    id: 'invSort',
                    label: t('Sort inventory items by value'),
                    type: 'checkbox',
                    default: true,
                },
                invSort_showBadges: {
                    id: 'invSort_showBadges',
                    label: t('Show stack value badges when sorting by Ask/Bid'),
                    type: 'checkbox',
                    default: false,
                },
                invSort_badgesOnNone: {
                    id: 'invSort_badgesOnNone',
                    label: t('Badge type when "None" sort is selected'),
                    type: 'select',
                    default: 'None',
                    options: ['None', 'Ask', 'Bid'],
                },
                invSort_netOfTax: {
                    id: 'invSort_netOfTax',
                    label: t('Show badge values net of market tax'),
                    type: 'checkbox',
                    default: false,
                },
                invSort_sortEquipment: {
                    id: 'invSort_sortEquipment',
                    label: t('Enable sorting for Equipment category'),
                    type: 'checkbox',
                    default: false,
                },
                invBadgePrices: {
                    id: 'invBadgePrices',
                    label: t('Show price badges on item icons'),
                    type: 'checkbox',
                    default: false,
                    help: t('Displays per-item ask and bid prices on inventory items'),
                },
                invCategoryTotals: {
                    id: 'invCategoryTotals',
                    label: t('Show category totals in inventory'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays the total market value of all items in each inventory category'),
                },
                profitCalc_pricingMode: {
                    id: 'profitCalc_pricingMode',
                    label: t('Profit calculation pricing mode'),
                    type: 'select',
                    default: 'hybrid',
                    options: [
                        { value: 'conservative', label: t('Buy: Ask / Sell: Bid (Instant Buy / Instant Sell)') },
                        { value: 'hybrid', label: t('Buy: Ask / Sell: Ask (Instant Buy / Patient Sell)') },
                        { value: 'optimistic', label: t('Buy: Bid / Sell: Ask (Patient Buy / Patient Sell)') },
                        { value: 'patientBuy', label: t('Buy: Bid / Sell: Bid (Patient Buy / Instant Sell)') },
                    ],
                },
                profitCalc_pricingNaming: {
                    id: 'profitCalc_pricingNaming',
                    label: t('Pricing mode naming convention'),
                    type: 'checkbox',
                    default: false,
                    help: t('Show pricing modes as "Instant Buy / Instant Sell" instead of "Buy: Ask / Sell: Bid"'),
                },
                profitCalc_keyPricingMode: {
                    id: 'profitCalc_keyPricingMode',
                    label: t('Key pricing mode'),
                    type: 'select',
                    default: 'ask',
                    options: ['ask', 'bid'],
                    help: t(
                        'Whether to use ask (instant buy) or bid (patient buy) prices when valuing dungeon keys in tooltips, networth, and combat income calculations.'
                    ),
                },
                profitCalc_customPriceOverrides: {
                    id: 'profitCalc_customPriceOverrides',
                    label: t('Custom price overrides'),
                    type: 'customPriceOverrides',
                    default: {},
                    help: t(
                        'Set custom buy/sell prices for specific items. Overrides marketplace prices in profit calculations.'
                    ),
                },
                actions_artisanMaterialMode: {
                    id: 'actions_artisanMaterialMode',
                    label: t('Missing materials: Artisan requirement mode'),
                    type: 'select',
                    default: 'expected',
                    options: [
                        { value: 'expected', label: t('Expected value (average)') },
                        { value: 'worst-case', label: t('Worst-case per action (ceil per craft)') },
                    ],
                    help: t(
                        'Choose how missing materials accounts for Artisan Tea reductions when suggesting what to buy.'
                    ),
                },
                networth_highEnhancementUseCost: {
                    id: 'networth_highEnhancementUseCost',
                    label: t('Use enhancement cost for highly enhanced items'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Market prices are unreliable for highly enhanced items (+13 and above). Use calculated enhancement cost instead.'
                    ),
                },
                networth_highEnhancementMinLevel: {
                    id: 'networth_highEnhancementMinLevel',
                    label: t('Minimum enhancement level to use cost'),
                    type: 'select',
                    default: 13,
                    options: [
                        { value: 10, label: t('+10 and above') },
                        { value: 11, label: t('+11 and above') },
                        { value: 12, label: t('+12 and above') },
                        { value: 13, label: t('+13 and above (recommended)') },
                        { value: 15, label: t('+15 and above') },
                    ],
                    help: t('Enhancement level at which to stop trusting market prices'),
                },
                networth_includeCowbells: {
                    id: 'networth_includeCowbells',
                    label: t('Include cowbells in net worth'),
                    type: 'checkbox',
                    default: false,
                    help: t('Cowbells are not tradeable, but they have a value based on Bag of 10 Cowbells market price'),
                },
                networth_includeTaskTokens: {
                    id: 'networth_includeTaskTokens',
                    label: t('Include task tokens in net worth'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Value task tokens based on expected value from Task Shop chests. Disable to exclude them from net worth.'
                    ),
                },
                networth_abilityBooksAsInventory: {
                    id: 'networth_abilityBooksAsInventory',
                    label: t('Count ability books as inventory (Current Assets)'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Move ability books from Fixed Assets to Current Assets inventory value. Useful if you plan to sell them.'
                    ),
                },
                networth_historyChart: {
                    id: 'networth_historyChart',
                    label: t('Enable net worth history chart'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Records hourly net worth snapshots and shows a chart icon next to Total Net Worth. Disable to stop tracking and hide the chart button.'
                    ),
                },
                autoAllButton: {
                    id: 'autoAllButton',
                    label: t('Auto-click "All" button when opening loot boxes'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Automatically clicks the "All" button when opening openable containers (crates, chests, caches)'
                    ),
                },
                autoAllButton_excludeSeals: {
                    id: 'autoAllButton_excludeSeals',
                    label: t('Auto-click "All": Skip Scroll of... items'),
                    type: 'checkbox',
                    default: true,
                    help: t('When enabled, Scroll of... items from the Labyrinth are not auto-opened'),
                },
            },
        },

        inventoryTabs: {
            title: t('Custom Inventory Tabs'),
            icon: '🗂️',
            settings: {
                inventoryTabs: {
                    id: 'inventoryTabs',
                    label: t('Custom Inventory Tabs: Enable'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a Toolasha tab to the character panel where you can organize inventory items into personal tabs.'
                    ),
                },
                inventoryTabs_showUnorganized: {
                    id: 'inventoryTabs_showUnorganized',
                    label: t('Custom Inventory Tabs: Show Unorganized bucket'),
                    type: 'checkbox',
                    default: true,
                    help: t('Show an "Unorganized" section containing all items not assigned to any tab.'),
                },
                inventoryTabs_categoryAddAll: {
                    id: 'inventoryTabs_categoryAddAll',
                    label: t('Custom Inventory Tabs: Add all items when adding category'),
                    type: 'checkbox',
                    default: false,
                    hidden: true,
                    help: t(
                        'When adding a category to a tab, add every item in that category (including items not in your inventory). When disabled, only items currently in your inventory are added.'
                    ),
                },
                inventoryTabs_defaultTab: {
                    id: 'inventoryTabs_defaultTab',
                    label: t('Custom Inventory Tabs: Show Toolasha tab by default'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Hides the native Inventory tab and automatically activates the Toolasha tab whenever the character panel opens.'
                    ),
                },
                inventoryTabs_tileGap: {
                    id: 'inventoryTabs_tileGap',
                    label: t('Custom Inventory Tabs: Item spacing (px)'),
                    type: 'number',
                    default: 4,
                    min: 0,
                    max: 20,
                    step: 1,
                    help: t('Pixel gap between item tiles on the Toolasha tab.'),
                },
                inventoryTabs_loadoutIncludeConsumables: {
                    id: 'inventoryTabs_loadoutIncludeConsumables',
                    label: t('Custom Inventory Tabs: Include food & drinks when adding from loadout'),
                    type: 'checkbox',
                    default: false,
                    help: t('When adding items from a loadout to a tab, also include food and drink items.'),
                },
                inventoryTabs_topTabPriority: {
                    id: 'inventoryTabs_topTabPriority',
                    label: t('Custom Inventory Tabs: Items visible in topmost tab only'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'When an item appears in multiple tabs, it only shows in the highest (topmost) tab that contains it. When disabled, collapsing a tab releases its items to lower tabs.'
                    ),
                },
            },
        },

        skills: {
            title: t('Skills'),
            icon: '📚',
            settings: {
                simulateScrollEffects: {
                    id: 'simulateScrollEffects',
                    label: t('Skills: Simulate missing scroll effects in calculations'),
                    type: 'checkboxWithButton',
                    buttonLabel: t('Defaults...'),
                    default: false,
                    help: t(
                        'When enabled, profit/XP/speed calculations show hypothetical results as if selected scrolls were active. Configure default scrolls with the button; override per-loadout from the Loadouts panel.'
                    ),
                },
                xpTracker: {
                    id: 'xpTracker',
                    label: t('Left sidebar: Show XP/hr rate on skill bars'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays live XP/hr rate under each skill bar in the navigation panel'),
                },
                xpTracker_timeTillLevel: {
                    id: 'xpTracker_timeTillLevel',
                    label: t('Skill tooltip: Show time till next level'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Shows estimated time remaining until the next level in the skill hover tooltip (based on current XP/hr)'
                    ),
                },
                skillRemainingXP: {
                    id: 'skillRemainingXP',
                    label: t('Left sidebar: Show remaining XP to next level'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays how much XP needed to reach the next level under skill progress bars'),
                },
                skillRemainingXP_blackBorder: {
                    id: 'skillRemainingXP_blackBorder',
                    label: t('Remaining XP: Add black text border for better visibility'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds a black outline/shadow to the XP text for better readability against progress bars'),
                },
                skillbook: {
                    id: 'skillbook',
                    label: t(
                        'Skill books: Show books needed to reach target level (in the ability book item dictionary window)'
                    ),
                    type: 'checkbox',
                    default: true,
                },
            },
        },

        combat: {
            title: t('Combat Features'),
            icon: '⚔️',
            settings: {
                combatScore: {
                    id: 'combatScore',
                    label: t('Profile panel: Show gear score'),
                    type: 'checkbox',
                    default: true,
                },
                abilitiesTriggers: {
                    id: 'abilitiesTriggers',
                    label: t('Profile panel: Show abilities & triggers'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays equipped abilities, consumables, and their combat triggers below the profile'),
                },
                characterCard: {
                    id: 'characterCard',
                    label: t('Profile panel: Show View Card button'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds button to open character sheet in external viewer'),
                },
                dungeonTracker: {
                    id: 'dungeonTracker',
                    label: t('Dungeon Tracker: Real-time progress tracking'),
                    type: 'checkbox',
                    default: true,
                    help: t('Tracks dungeon runs with server-validated duration from party messages'),
                },
                dungeonTrackerUI: {
                    id: 'dungeonTrackerUI',
                    label: t('Show Dungeon Tracker UI panel'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays dungeon progress panel with wave counter, run history, and statistics'),
                },
                dungeonTrackerChatAnnotations: {
                    id: 'dungeonTrackerChatAnnotations',
                    label: t('Show run time in party chat'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds colored timer annotations to "Key counts" messages (green if fast, red if slow)'),
                },
                labyrinthTracker: {
                    id: 'labyrinthTracker',
                    label: t('Labyrinth best level tracker'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Tracks the highest recommended level enemy defeated per monster type and shows it in the Automation tab'
                    ),
                },
                labyrinthShopPrices: {
                    id: 'labyrinthShopPrices',
                    label: t('Labyrinth Shop: Show market prices'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows ask/bid market prices on tradeable items in the Labyrinth Shop tab'),
                },
                labyrinthClearRate: {
                    id: 'labyrinthClearRate',
                    label: t('Labyrinth clear rate calculator'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows expected clear time and success rate on labyrinth skilling room tiles'),
                },
                labyrinthRecommendTargetRate: {
                    id: 'labyrinthRecommendTargetRate',
                    label: t('Labyrinth: Recommend target clear rate (%)'),
                    type: 'number',
                    default: 70,
                    min: 1,
                    max: 100,
                    step: 1,
                    help: t('Default target clear rate for labyrinth skip threshold recommendations'),
                },
                labyrinthRecommendSimHours: {
                    id: 'labyrinthRecommendSimHours',
                    label: t('Labyrinth: Recommend sim hours per step'),
                    type: 'number',
                    default: 1,
                    min: 1,
                    max: 100,
                    step: 1,
                    help: t('Default hours of combat simulation per binary search step in recommendations'),
                },
                labyrinthLiveProgress: {
                    id: 'labyrinthLiveProgress',
                    label: t('Labyrinth: Show live clear chance'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows live clear chance during active labyrinth skilling/enhancing rooms'),
                },
                combatBattleCounter: {
                    id: 'combatBattleCounter',
                    label: t('Show battle/wave counter in current action panel during combat'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays "Battle #N" for regular zones or "Wave N" for dungeons in the top-left action panel'),
                },
                combatSummary: {
                    id: 'combatSummary',
                    label: t('Combat Summary: Show detailed statistics on return'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays encounters/hour, revenue, experience rates when returning from combat'),
                },
                combatSim: {
                    id: 'combatSim',
                    label: t('Combat Simulator'),
                    type: 'checkbox',
                    default: true,
                    help: t('Simulate combat encounters to estimate XP/hr, deaths, and consumable usage'),
                },
                combatSim_defaultHours: {
                    id: 'combatSim_defaultHours',
                    label: t('Combat Simulator: Default hours (single zone)'),
                    type: 'number',
                    default: 100,
                    min: 1,
                    max: 10000,
                    step: 1,
                    help: t('Default simulation duration in hours for single-zone runs'),
                },
                combatSim_allZonesDefaultHours: {
                    id: 'combatSim_allZonesDefaultHours',
                    label: t('Combat Simulator: Default hours (All Zones)'),
                    type: 'number',
                    default: 10,
                    min: 1,
                    max: 10000,
                    step: 1,
                    help: t('Default simulation duration in hours for All Zones runs'),
                },
                combatSim_seekDefaultHours: {
                    id: 'combatSim_seekDefaultHours',
                    label: t('Combat Simulator: Default hours (Seek)'),
                    type: 'number',
                    default: 10,
                    min: 1,
                    max: 10000,
                    step: 1,
                    help: t('Default simulation duration in hours for Seek Best Source runs'),
                },
                combatSim_decimalMinutes: {
                    id: 'combatSim_decimalMinutes',
                    label: t('Combat Simulator: Show completion time as decimal minutes'),
                    type: 'checkbox',
                    default: false,
                    help: t('Display avg completion time as "X.XX min" instead of "Xm Ys"'),
                },
                combatStats: {
                    id: 'combatStats',
                    label: t('Combat Statistics: Show Statistics tab in Combat panel'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a Statistics button to the Combat panel showing income, profit, consumable costs, EXP, and drop details'
                    ),
                },
                combatStatsChatMessage: {
                    id: 'combatStatsChatMessage',
                    label: t('Combat Statistics: Chat message format'),
                    type: 'template',
                    default: [
                        { type: 'text', value: 'Combat Stats: ' },
                        { type: 'variable', key: '{duration}', label: t('Duration') },
                        { type: 'text', value: ' duration | ' },
                        { type: 'variable', key: '{encountersPerHour}', label: t('Encounters/Hour') },
                        { type: 'text', value: ' EPH | ' },
                        { type: 'variable', key: '{income}', label: t('Total Income') },
                        { type: 'text', value: ' income | ' },
                        { type: 'variable', key: '{dailyIncome}', label: t('Daily Income') },
                        { type: 'text', value: ' income/d | ' },
                        { type: 'variable', key: '{dailyConsumableCosts}', label: t('Daily Consumable Costs') },
                        { type: 'text', value: ' consumables/d | ' },
                        { type: 'variable', key: '{dailyProfit}', label: t('Daily Profit') },
                        { type: 'text', value: ' profit/d | ' },
                        { type: 'variable', key: '{exp}', label: t('EXP/Hour') },
                        { type: 'text', value: ' exp/h | ' },
                        { type: 'variable', key: '{deathCount}', label: t('Deaths') },
                        { type: 'text', value: ' deaths' },
                    ],
                    help: t(
                        'Message format when Ctrl+clicking player card in Statistics. Click "Edit Template" to customize.'
                    ),
                    templateVariables: [
                        { key: '{duration}', label: t('Duration'), description: 'Combat session duration' },
                        {
                            key: '{encountersPerHour}',
                            label: t('Encounters/Hour'),
                            description: 'Encounters per hour (EPH)',
                        },
                        { key: '{income}', label: t('Total Income'), description: 'Total income from combat' },
                        { key: '{dailyIncome}', label: t('Daily Income'), description: 'Income per day' },
                        {
                            key: '{dailyConsumableCosts}',
                            label: t('Daily Consumable Costs'),
                            description: 'Consumable costs per day',
                        },
                        { key: '{dailyProfit}', label: t('Daily Profit'), description: 'Profit per day' },
                        { key: '{exp}', label: t('EXP/Hour'), description: 'Experience per hour' },
                        { key: '{deathCount}', label: t('Deaths'), description: 'Number of deaths' },
                    ],
                },
            },
        },

        tasks: {
            title: t('Tasks'),
            icon: '📋',
            settings: {
                taskProfitCalculator: {
                    id: 'taskProfitCalculator',
                    label: t('Show total profit for gathering/production tasks'),
                    type: 'checkbox',
                    default: true,
                },
                taskEfficiencyRating: {
                    id: 'taskEfficiencyRating',
                    label: t('Show task efficiency rating (tokens/profit per hour)'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays a color-graded efficiency score based on expected completion time.'),
                },
                taskMaterialsIndicator: {
                    id: 'taskMaterialsIndicator',
                    label: t('Show materials availability on production tasks'),
                    type: 'checkbox',
                    default: true,
                    help: t('Shows how many task actions you can complete with current inventory.'),
                },
                taskEfficiencyRatingMode: {
                    id: 'taskEfficiencyRatingMode',
                    label: t('Efficiency algorithm'),
                    type: 'select',
                    default: 'gold',
                    options: [
                        { value: 'tokens', label: t('Task tokens per hour') },
                        { value: 'gold', label: t('Task profit per hour') },
                    ],
                    help: t('Choose whether to rate by task token payout or total profit.'),
                },
                taskEfficiencyGradient: {
                    id: 'taskEfficiencyGradient',
                    label: t('Use relative gradient colors'),
                    type: 'checkbox',
                    default: false,
                    help: t('Colors efficiency ratings relative to visible tasks.'),
                },
                taskQueuedIndicator: {
                    id: 'taskQueuedIndicator',
                    label: t('Show "Queued" indicator on task cards'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays a status message on task cards when their action is in your action queue'),
                },
                taskRerollTracker: {
                    id: 'taskRerollTracker',
                    label: t('Track task reroll costs'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Tracks how much gold/cowbells spent rerolling each task (EXPERIMENTAL - may cause UI freezing)'
                    ),
                },
                taskMapIndex: {
                    id: 'taskMapIndex',
                    label: t('Show combat zone index numbers on tasks'),
                    type: 'checkbox',
                    default: true,
                },
                taskIcons: {
                    id: 'taskIcons',
                    label: t('Show visual icons on task cards'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays semi-transparent item/monster icons on task cards'),
                },
                taskIconsDungeons: {
                    id: 'taskIconsDungeons',
                    label: t('Show dungeon icons on combat tasks'),
                    type: 'checkbox',
                    default: false,
                    help: t('Shows which dungeons contain the monster (requires Task Icons enabled)'),
                },
                taskSorter_autoSort: {
                    id: 'taskSorter_autoSort',
                    label: t('Automatically sort tasks when opening task panel'),
                    type: 'checkbox',
                    default: false,
                    help: t('Automatically sorts tasks by skill type when you open the task panel'),
                },
                taskSorter_hideButton: {
                    id: 'taskSorter_hideButton',
                    label: t('Hide Sort Tasks button'),
                    type: 'checkbox',
                    default: false,
                    help: t('Hides the Sort Tasks button while keeping auto-sort functional'),
                },
                taskSorter_sortMode: {
                    id: 'taskSorter_sortMode',
                    label: t('Task sort mode'),
                    type: 'select',
                    default: 'skill',
                    options: [
                        { value: 'skill', label: t('Skill / Zone') },
                        { value: 'time', label: t('Time to Completion') },
                    ],
                    help: t(
                        'How tasks are ordered when clicking Sort Tasks. "Time to Completion" sorts fastest tasks first; combat and completed tasks go to the bottom.'
                    ),
                },
                taskInventoryHighlighter: {
                    id: 'taskInventoryHighlighter',
                    label: t('Enable Task Inventory Highlighter button'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds a button to dim inventory items not needed for your current non-combat tasks'),
                },
                taskStatistics: {
                    id: 'taskStatistics',
                    label: t('Show task statistics button on Tasks panel'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a Statistics button to the Tasks panel showing overflow time, expected rewards, and completion estimates'
                    ),
                },
                taskClaimCollector: {
                    id: 'taskClaimCollector',
                    label: t('Move Claim Reward buttons to top of task list'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Moves all Claim Reward buttons to a stack at the top of the task list so you can click the same spot repeatedly to claim all completed tasks'
                    ),
                },
                taskGoMerge: {
                    id: 'taskGoMerge',
                    label: t('Merge duplicate tasks on Go'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'When clicking Go on a task, combines the required amounts of all in-progress tasks for the same action into a single pre-filled count'
                    ),
                },
                taskRerollProtection: {
                    id: 'taskRerollProtection',
                    label: t('Task reroll protection'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Protect specific tasks from accidental rerolling. Protected tasks get a green highlight and require a confirmation click before rerolling. A shield icon appears in the task panel to configure protected zones.'
                    ),
                },
                taskRerollProtection_hideHighlight: {
                    id: 'taskRerollProtection_hideHighlight',
                    label: t('Task reroll protection: Hide green highlight'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Removes the green outline/glow from protected tasks while keeping the reroll confirmation active.'
                    ),
                },
                taskAutoReroll: {
                    id: 'taskAutoReroll',
                    label: t('Task auto-reroll reminder'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Highlights tasks you want to reroll with a red border and reminder badge. Configure per-character via the target icon in the task panel.'
                    ),
                },
            },
        },

        ui: {
            title: t('UI Enhancements'),
            icon: '🎨',
            settings: {
                formatting_useKMBFormat: {
                    id: 'formatting_useKMBFormat',
                    label: t('Use K/M/B number formatting (e.g., 1.5M instead of 1,500,000)'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Applies to tooltips, action panels, profit displays, and all number formatting throughout the UI'
                    ),
                },
                ui_externalLinks: {
                    id: 'ui_externalLinks',
                    label: t('Left sidebar: Show external tool links'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds quick links to Combat Sim, Market Tracker, Enhancelator, and Milkonomy'),
                },
                hideLabyrinthBadge: {
                    id: 'hideLabyrinthBadge',
                    label: t('Left sidebar: Hide Labyrinth ping badge'),
                    type: 'checkbox',
                    default: false,
                },
                tabReorder: {
                    id: 'tabReorder',
                    label: t('Character panel: Drag-and-drop tab reordering'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Drag tabs to rearrange the order of Inventory, Toolasha, Equipment, Houses, Abilities, and Loadout. Order persists through refresh.'
                    ),
                },
                expPercentage: {
                    id: 'expPercentage',
                    label: t('Left sidebar: Show skill XP percentages'),
                    type: 'checkbox',
                    default: true,
                },
                itemIconLevel: {
                    id: 'itemIconLevel',
                    label: t('Bottom left corner of icons: Show equipment level'),
                    type: 'checkbox',
                    default: true,
                },
                loadoutEnhancementDisplay: {
                    id: 'loadoutEnhancementDisplay',
                    label: t('Loadout panel: Show highest-owned enhancement level on equipment icons'),
                    type: 'checkbox',
                    default: true,
                },
                loadout_sortEnabled: {
                    id: 'loadout_sortEnabled',
                    label: t('Loadout panel: Enable drag-and-drop reordering'),
                    type: 'checkbox',
                    default: true,
                },
                loadoutSnapshot: {
                    id: 'loadoutSnapshot',
                    label: t('Loadout panel: Use saved loadout snapshots in profit calculations'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Saves your loadout equipment when you view loadouts, so profit/hr calculations use the correct tool bonuses even when that loadout is not equipped. Disable to always use currently-equipped gear.'
                    ),
                },
                showsKeyInfoInIcon: {
                    id: 'showsKeyInfoInIcon',
                    label: t('Bottom left corner of key icons: Show zone index'),
                    type: 'checkbox',
                    default: true,
                },
                mapIndex: {
                    id: 'mapIndex',
                    label: t('Combat zones: Show zone index numbers'),
                    type: 'checkbox',
                    default: true,
                },
                alchemyItemDimming: {
                    id: 'alchemyItemDimming',
                    label: t('Alchemy panel: Dim items requiring higher level'),
                    type: 'checkbox',
                    default: true,
                },
                marketFilter: {
                    id: 'marketFilter',
                    label: t('Marketplace: Filter by level, class, slot'),
                    type: 'checkbox',
                    default: true,
                },
                marketSort: {
                    id: 'marketSort',
                    label: t('Marketplace: Sort items by profitability'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a button to sort marketplace items by profit/hour. Items without profit data (drop-only) appear at the end.'
                    ),
                },
                fillMarketOrderPrice: {
                    id: 'fillMarketOrderPrice',
                    label: t('Auto-fill marketplace orders with optimal price'),
                    type: 'checkbox',
                    default: true,
                },
                market_autoFillSellStrategy: {
                    id: 'market_autoFillSellStrategy',
                    label: t('Auto-fill sell price strategy'),
                    type: 'select',
                    default: 'match',
                    options: [
                        { value: 'match', label: t('Match best sell price') },
                        { value: 'undercut', label: t('Undercut by 1 (best sell - 1)') },
                    ],
                    help: t('When creating sell listings, choose whether to match or undercut the current best sell price'),
                },
                market_autoFillBuyStrategy: {
                    id: 'market_autoFillBuyStrategy',
                    label: t('Auto-fill buy price strategy'),
                    type: 'select',
                    default: 'outbid',
                    options: [
                        { value: 'outbid', label: t('Outbid by 1 (best buy + 1)') },
                        { value: 'match', label: t('Match best buy price') },
                        { value: 'undercut', label: t('Undercut by 1 (best buy - 1)') },
                    ],
                    help: t(
                        'When creating buy listings, choose whether to outbid, match, or undercut the current best buy price'
                    ),
                },
                market_autoClickMax: {
                    id: 'market_autoClickMax',
                    label: t('Auto-click Max button on sell listing dialogs'),
                    type: 'checkbox',
                    default: true,
                    help: t('Automatically clicks the Max button in the quantity field when opening Sell listing dialogs'),
                },
                market_quickInputButtons: {
                    id: 'market_quickInputButtons',
                    label: t('Marketplace: Quick input buttons on order dialogs'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds 10, 100, 1000 preset quantity buttons to buy/sell dialogs'),
                },
                market_quickInputButtons_presets: {
                    id: 'market_quickInputButtons_presets',
                    label: t('Marketplace: Custom quick input presets'),
                    type: 'text',
                    default: '',
                    help: t(
                        'Comma-separated preset values (e.g. 50,500,5000). Leave blank for defaults (10, 100, 1000). Max 8 values.'
                    ),
                },
                market_multiplierButtons: {
                    id: 'market_multiplierButtons',
                    label: t('Marketplace: ÷2 and ×2 buttons on order dialogs'),
                    type: 'checkbox',
                    default: true,
                    help: t('Adds ÷2 and ×2 buttons to the price and quantity rows in buy/sell dialogs'),
                },
                market_showOwnedInBuyModal: {
                    id: 'market_showOwnedInBuyModal',
                    label: t('Marketplace: Show owned count in buy dialogs'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays how many of the item you currently own in Buy Now and Buy Listing modals'),
                },
                market_marketplaceShortcuts: {
                    id: 'market_marketplaceShortcuts',
                    label: t('Marketplace: Show "Marketplace Action" button on item menus'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds a Marketplace Action dropdown to item menus with Sell Now, Buy Now, and listing shortcuts'
                    ),
                },
                market_visibleItemCount: {
                    id: 'market_visibleItemCount',
                    label: t('Market: Show inventory count on items'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays how many of each item you own when browsing the market'),
                },
                market_visibleItemCountOpacity: {
                    id: 'market_visibleItemCountOpacity',
                    label: t('Market: Opacity for items not in inventory'),
                    type: 'slider',
                    default: 0.25,
                    min: 0,
                    max: 1,
                    step: 0.05,
                    help: t('How transparent item tiles appear when you own zero of that item'),
                },
                market_visibleItemCountIncludeEquipped: {
                    id: 'market_visibleItemCountIncludeEquipped',
                    label: t('Market: Count equipped items'),
                    type: 'checkbox',
                    default: true,
                    help: t('Include currently equipped items in the displayed count'),
                },
                market_showListingPrices: {
                    id: 'market_showListingPrices',
                    label: t('Market: Show prices on individual listings'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays top order price and total value on each listing in My Listings table'),
                },
                market_tradeHistory: {
                    id: 'market_tradeHistory',
                    label: t('Market: Show personal trade history'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays your last buy/sell prices for items in marketplace'),
                },
                market_tradeHistoryComparisonMode: {
                    id: 'market_tradeHistoryComparisonMode',
                    label: t('Market: Trade history comparison mode'),
                    type: 'select',
                    default: 'instant',
                    options: [
                        { value: 'instant', label: t('Instant') },
                        { value: 'listing', label: t('Orders') },
                    ],
                    help: t('Instant: Compare to instant buy/sell prices. Orders: Compare to buy/sell orders.'),
                },
                market_listingPricePrecision: {
                    id: 'market_listingPricePrecision',
                    label: t('Market: Listing price decimal precision'),
                    type: 'number',
                    default: 2,
                    min: 0,
                    max: 4,
                    help: t('Number of decimal places to show for listing prices'),
                },
                market_showListingAge: {
                    id: 'market_showListingAge',
                    label: t('Market: Show listing age on My Listings'),
                    type: 'checkbox',
                    default: false,
                    help: t('Display how long ago each listing was created on the My Listings tab (e.g., "3h 45m")'),
                },
                market_showTopOrderAge: {
                    id: 'market_showTopOrderAge',
                    label: t('Market: Show top order age on My Listings'),
                    type: 'checkbox',
                    default: false,
                    help: t(
                        'Display estimated age of the top competing order for each of your listings (requires estimated listing age feature to be active)'
                    ),
                },
                market_showEstimatedListingAge: {
                    id: 'market_showEstimatedListingAge',
                    label: t('Market: Show estimated age on order book'),
                    type: 'checkbox',
                    default: true,
                    help: t('Estimates creation time for all market listings using listing ID interpolation'),
                },
                market_listingAgeFormat: {
                    id: 'market_listingAgeFormat',
                    label: t('Market: Listing age display format'),
                    type: 'select',
                    default: 'datetime',
                    options: [
                        { value: 'elapsed', label: t('Elapsed Time (e.g., "3h 45m")') },
                        { value: 'datetime', label: t('Date/Time (e.g., "01-13 14:30")') },
                    ],
                    help: t('Choose how to display listing creation times'),
                },
                market_listingTimeFormat: {
                    id: 'market_listingTimeFormat',
                    label: t('Market: Time format for date/time display'),
                    type: 'select',
                    default: '24hour',
                    options: [
                        { value: '24hour', label: t('24-hour (14:30)') },
                        { value: '12hour', label: t('12-hour (2:30 PM)') },
                    ],
                    help: t('Time format when using Date/Time display (only applies if Date/Time format is selected)'),
                },
                market_listingDateFormat: {
                    id: 'market_listingDateFormat',
                    label: t('Market: Date format for date/time display'),
                    type: 'select',
                    default: 'MM-DD',
                    options: [
                        { value: 'MM-DD', label: t('MM-DD (01-13)') },
                        { value: 'DD-MM', label: t('DD-MM (13-01)') },
                    ],
                    help: t('Date format when using Date/Time display (only applies if Date/Time format is selected)'),
                },
                market_showOrderTotals: {
                    id: 'market_showOrderTotals',
                    label: t('Market: Show order totals in header'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Displays buy orders (BO), sell orders (SO), and unclaimed coins (💰) in the header area below gold'
                    ),
                },
                market_showHistoryViewer: {
                    id: 'market_showHistoryViewer',
                    label: t('Market: Show history viewer button in settings'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds "View Market History" button to settings panel for viewing and exporting all market listing history'
                    ),
                },
                market_showPhiloCalculator: {
                    id: 'market_showPhiloCalculator',
                    label: t('Market: Show Philo Gamba calculator button in settings'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Adds "Philo Gamba" button to settings panel for calculating transmutation ROI into Philosopher\'s Stones'
                    ),
                },
                market_showQueueLength: {
                    id: 'market_showQueueLength',
                    label: t('Market: Show queue length estimates'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Displays total quantity at best price below Buy/Sell buttons. Estimated values (20+ orders at same price) are shown in a different color.'
                    ),
                },
                market_milkywayMarketLink: {
                    id: 'market_milkywayMarketLink',
                    label: t('Market: Show MilkyWay Market link'),
                    type: 'checkbox',
                    default: false,
                    help: t('Adds a small link to view the current item on milkyway.market'),
                },
                itemDictionary_transmuteRates: {
                    id: 'itemDictionary_transmuteRates',
                    label: t('Item Dictionary: Show transmutation success rates'),
                    type: 'checkbox',
                    default: true,
                    help: t('Displays success rate percentages in the "Transmuted From (Alchemy)" section'),
                },
                itemDictionary_transmuteIncludeBaseRate: {
                    id: 'itemDictionary_transmuteIncludeBaseRate',
                    label: t('Item Dictionary: Include base success rate in transmutation percentages'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'When enabled, shows total probability (base rate × drop rate). When disabled, shows conditional probability (drop rate only, matching "Transmutes Into" section)'
                    ),
                },
            },
        },

        guild: {
            title: t('Guild'),
            icon: '👥',
            settings: {
                guildXPTracker: {
                    id: 'guildXPTracker',
                    label: t('Track guild and member XP over time'),
                    type: 'checkbox',
                    default: true,
                    help: t('Records guild and member XP data from WebSocket messages for XP/hr calculations'),
                },
                guildXPDisplay: {
                    id: 'guildXPDisplay',
                    label: t('Show XP/hr stats on Guild panel and Leaderboard'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Displays XP/hr rates, rankings, and a weekly chart on the Guild Overview, Members, and Guild Leaderboard tabs. Disable the standalone Guild XP/h userscript if using this.'
                    ),
                },
            },
        },

        house: {
            title: t('House'),
            icon: '🏠',
            settings: {
                houseUpgradeCosts: {
                    id: 'houseUpgradeCosts',
                    label: t('Show upgrade costs with market prices and inventory comparison'),
                    type: 'checkbox',
                    default: true,
                },
            },
        },

        notifications: {
            title: t('Notifications'),
            icon: '🔔',
            settings: {
                notifiEmptyAction: {
                    id: 'notifiEmptyAction',
                    label: t('Browser notification when action queue is empty'),
                    type: 'checkbox',
                    default: false,
                    help: t('Only works when the game page is open'),
                },
            },
        },

        colors: {
            title: t('Color Customization'),
            icon: '🎨',
            settings: {
                color_profit: {
                    id: 'color_profit',
                    label: t('Profit/Positive Values'),
                    type: 'color',
                    default: '#047857',
                    help: t('Color used for profit, gains, and positive values'),
                },
                color_loss: {
                    id: 'color_loss',
                    label: t('Loss/Negative Values'),
                    type: 'color',
                    default: '#f87171',
                    help: t('Color used for losses, costs, and negative values'),
                },
                color_warning: {
                    id: 'color_warning',
                    label: t('Warnings'),
                    type: 'color',
                    default: '#ffa500',
                    help: t('Color used for warnings and important notices'),
                },
                color_info: {
                    id: 'color_info',
                    label: t('Informational'),
                    type: 'color',
                    default: '#60a5fa',
                    help: t('Color used for informational text and highlights'),
                },
                color_essence: {
                    id: 'color_essence',
                    label: t('Essences'),
                    type: 'color',
                    default: '#c084fc',
                    help: t('Color used for essence drops and essence-related text'),
                },
                color_tooltip_profit: {
                    id: 'color_tooltip_profit',
                    label: t('Tooltip Profit/Positive'),
                    type: 'color',
                    default: '#047857',
                    help: t('Color for profit/positive values in tooltips (light backgrounds)'),
                },
                color_tooltip_loss: {
                    id: 'color_tooltip_loss',
                    label: t('Tooltip Loss/Negative'),
                    type: 'color',
                    default: '#dc2626',
                    help: t('Color for loss/negative values in tooltips (light backgrounds)'),
                },
                color_tooltip_info: {
                    id: 'color_tooltip_info',
                    label: t('Tooltip Informational'),
                    type: 'color',
                    default: '#2563eb',
                    help: t('Color for informational text in tooltips (light backgrounds)'),
                },
                color_tooltip_warning: {
                    id: 'color_tooltip_warning',
                    label: t('Tooltip Warnings'),
                    type: 'color',
                    default: '#ea580c',
                    help: t('Color for warnings in tooltips (light backgrounds)'),
                },
                color_text_primary: {
                    id: 'color_text_primary',
                    label: t('Primary Text'),
                    type: 'color',
                    default: '#ffffff',
                    help: t('Main text color'),
                },
                color_text_secondary: {
                    id: 'color_text_secondary',
                    label: t('Secondary Text'),
                    type: 'color',
                    default: '#888888',
                    help: t('Dimmed/secondary text color'),
                },
                color_border: {
                    id: 'color_border',
                    label: t('Borders'),
                    type: 'color',
                    default: '#444444',
                    help: t('Border and separator color'),
                },
                color_gold: {
                    id: 'color_gold',
                    label: t('Gold/Currency'),
                    type: 'color',
                    default: '#ffa500',
                    help: t('Color used for gold and currency displays'),
                },
                color_mirror: {
                    id: 'color_mirror',
                    label: "Philosopher's Mirror",
                    type: 'color',
                    default: '#ffd700',
                    help: "Color for the Philosopher's Mirror usage line in enhancement tooltips",
                },
                color_listing_price_1m: {
                    id: 'color_listing_price_1m',
                    label: t('Listing Total: 1M+'),
                    type: 'color',
                    default: '#ffd700',
                    help: t('Color for market listing total prices of 1 million or more'),
                },
                color_listing_price_100k: {
                    id: 'color_listing_price_100k',
                    label: t('Listing Total: 100K+'),
                    type: 'color',
                    default: '#22c55e',
                    help: t('Color for market listing total prices of 100K or more'),
                },
                color_listing_price_10k: {
                    id: 'color_listing_price_10k',
                    label: t('Listing Total: 10K+'),
                    type: 'color',
                    default: '#ffffff',
                    help: t('Color for market listing total prices of 10K or more'),
                },
                color_listing_price_low: {
                    id: 'color_listing_price_low',
                    label: t('Listing Total: <10K'),
                    type: 'color',
                    default: '#888888',
                    help: t('Color for market listing total prices under 10K'),
                },
                color_accent: {
                    id: 'color_accent',
                    label: t('Script Accent Color'),
                    type: 'color',
                    default: '#22c55e',
                    help: t(
                        'Primary accent color for script UI elements (buttons, headers, zone numbers, XP percentages, etc.)'
                    ),
                },
                color_remaining_xp: {
                    id: 'color_remaining_xp',
                    label: t('Remaining XP Text'),
                    type: 'color',
                    default: '#FFFFFF',
                    help: t('Color for remaining XP text below skill bars in left navigation'),
                },
                color_xp_rate: {
                    id: 'color_xp_rate',
                    label: t('XP Rate Text'),
                    type: 'color',
                    default: '#ffffff',
                    help: t('Color for XP/hr rate text on skill bars in left navigation'),
                },
                color_hours_to_level: {
                    id: 'color_hours_to_level',
                    label: t('Hours to Level Text'),
                    type: 'color',
                    default: '#ffffff',
                    help: t('Color for "hours till next level" text in skill tooltips'),
                },
                color_inv_count: {
                    id: 'color_inv_count',
                    label: t('Inventory Count Text'),
                    type: 'color',
                    default: '#ffffff',
                    help: t('Color for inventory count shown on action tiles and in the action detail panel'),
                },
                color_invBadge_ask: {
                    id: 'color_invBadge_ask',
                    label: t('Inventory Badge: Ask Price'),
                    type: 'color',
                    default: '#047857',
                    help: t('Color for Ask price badges on inventory items (seller asking price - better selling value)'),
                },
                color_invBadge_bid: {
                    id: 'color_invBadge_bid',
                    label: t('Inventory Badge: Bid Price'),
                    type: 'color',
                    default: '#60a5fa',
                    help: t('Color for Bid price badges on inventory items (buyer bid price - instant-sell value)'),
                },
                color_transmute: {
                    id: 'color_transmute',
                    label: t('Transmutation Rates'),
                    type: 'color',
                    default: '#ffffff',
                    help: t('Color used for transmutation success rate percentages in Item Dictionary'),
                },
                color_queueLength_known: {
                    id: 'color_queueLength_known',
                    label: t('Queue Length: Known Value'),
                    type: 'color',
                    default: '#ffffff',
                    help: t('Color for known queue lengths (when all visible orders are counted)'),
                },
                color_queueLength_estimated: {
                    id: 'color_queueLength_estimated',
                    label: t('Queue Length: Estimated Value'),
                    type: 'color',
                    default: '#60a5fa',
                    help: t('Color for estimated queue lengths (extrapolated from 20+ orders at same price)'),
                },
            },
        },

        collectionFilters: {
            title: t('Collection Filters'),
            icon: '⭐',
            settings: {
                collectionFilters: {
                    id: 'collectionFilters',
                    label: t('Collection Filters: Count-range, dungeon, and skilling-outfit filters'),
                    type: 'checkbox',
                    default: true,
                },
                collectionFavorites: {
                    id: 'collectionFavorites',
                    label: t('Collection Favorites: Star (★) items to mark and filter favorites'),
                    type: 'checkbox',
                    default: true,
                },
                collectionFavoritesSection: {
                    id: 'collectionFavoritesSection',
                    label: t('Collection Favorites: Show favorites section at top of grid'),
                    type: 'checkbox',
                    default: true,
                },
                collectionFilters_skillingBadges: {
                    id: 'collectionFilters_skillingBadges',
                    label: t('Show collection count badges on skilling action tiles'),
                    type: 'checkbox',
                    default: true,
                    help: t(
                        'Displays your collection count on skilling actions (open Collections once to populate counts)'
                    ),
                },
            },
        },
    };

    /**
     * Settings Storage Module
     * Handles persistence of settings to chrome.storage.local
     */


    class SettingsStorage {
        constructor() {
            this.storageKey = 'script_settingsMap'; // Legacy global key (used as template)
            this.storageArea = 'settings';
            this.currentCharacterId = null; // Current character ID (set after login)
            this.knownCharactersKey = 'known_character_ids'; // List of character IDs
        }

        /**
         * Set the current character ID
         * Must be called after character_initialized event
         * @param {string} characterId - Character ID
         */
        setCharacterId(characterId) {
            this.currentCharacterId = characterId;
        }

        /**
         * Get the storage key for current character
         * Falls back to global key if no character ID set
         * @returns {string} Storage key
         */
        getCharacterStorageKey() {
            if (this.currentCharacterId) {
                return `${this.storageKey}_${this.currentCharacterId}`;
            }
            return this.storageKey; // Fallback to global key
        }

        /**
         * Load all settings from storage
         * Merges saved values with defaults from settings-schema
         * @returns {Promise<Object>} Settings map
         */
        async loadSettings() {
            const characterKey = this.getCharacterStorageKey();
            let saved = await storage.getJSON(characterKey, this.storageArea, null);

            // Migration: If this is a character-specific key and it doesn't exist
            // Copy from global template (old 'script_settingsMap' key)
            if (this.currentCharacterId && !saved) {
                const globalTemplate = await storage.getJSON(this.storageKey, this.storageArea, null);
                if (globalTemplate) {
                    // Copy global template to this character
                    saved = globalTemplate;
                    await storage.setJSON(characterKey, saved, this.storageArea, true);
                }

                // Add character to known characters list
                await this.addToKnownCharacters(this.currentCharacterId);
            }

            const settings = {};

            // Build default settings from config
            for (const group of Object.values(settingsGroups)) {
                for (const [settingId, settingDef] of Object.entries(group.settings)) {
                    settings[settingId] = {
                        id: settingId,
                        desc: settingDef.label,
                        type: settingDef.type || 'checkbox',
                    };

                    // Set default value
                    if (settingDef.type === 'checkbox') {
                        settings[settingId].isTrue = settingDef.default ?? false;
                    } else {
                        settings[settingId].value = settingDef.default ?? '';
                    }

                    // Copy other properties
                    if (settingDef.options && typeof settingDef.options !== 'function') {
                        settings[settingId].options = settingDef.options;
                    }
                    if (settingDef.min !== undefined) {
                        settings[settingId].min = settingDef.min;
                    }
                    if (settingDef.max !== undefined) {
                        settings[settingId].max = settingDef.max;
                    }
                    if (settingDef.step !== undefined) {
                        settings[settingId].step = settingDef.step;
                    }
                }
            }

            // Merge saved settings
            if (saved) {
                for (const [settingId, savedValue] of Object.entries(saved)) {
                    if (settings[settingId]) {
                        // Merge saved boolean values
                        if (savedValue.hasOwnProperty('isTrue')) {
                            settings[settingId].isTrue = savedValue.isTrue;
                        }
                        // Merge saved non-boolean values
                        if (savedValue.hasOwnProperty('value')) {
                            settings[settingId].value = savedValue.value;
                        }
                    }
                }

                // Migrate: formatting_useKMBFormat changed from checkbox to select
                const fmtSaved = saved['formatting_useKMBFormat'];
                if (fmtSaved && fmtSaved.hasOwnProperty('isTrue') && !fmtSaved.hasOwnProperty('value')) {
                    settings['formatting_useKMBFormat'].value = fmtSaved.isTrue ? 'compact' : 'full';
                }
            }

            return settings;
        }

        /**
         * Build default settings from schema without touching storage
         * Used during early initialization before character ID is known
         * @returns {Object} Settings map with schema defaults only
         */
        buildDefaults() {
            const settings = {};

            for (const group of Object.values(settingsGroups)) {
                for (const [settingId, settingDef] of Object.entries(group.settings)) {
                    settings[settingId] = {
                        id: settingId,
                        desc: settingDef.label,
                        type: settingDef.type || 'checkbox',
                    };

                    if (settingDef.type === 'checkbox') {
                        settings[settingId].isTrue = settingDef.default ?? false;
                    } else {
                        settings[settingId].value = settingDef.default ?? '';
                    }

                    if (settingDef.options) {
                        settings[settingId].options = settingDef.options;
                    }
                    if (settingDef.min !== undefined) {
                        settings[settingId].min = settingDef.min;
                    }
                    if (settingDef.max !== undefined) {
                        settings[settingId].max = settingDef.max;
                    }
                    if (settingDef.step !== undefined) {
                        settings[settingId].step = settingDef.step;
                    }
                }
            }

            return settings;
        }

        /**
         * Save all settings to storage
         * @param {Object} settings - Settings map
         * @returns {Promise<void>}
         */
        async saveSettings(settings) {
            const characterKey = this.getCharacterStorageKey();
            await storage.setJSON(characterKey, settings, this.storageArea, true);
        }

        /**
         * Add character to known characters list
         * @param {string} characterId - Character ID
         * @returns {Promise<void>}
         */
        async addToKnownCharacters(characterId) {
            const knownCharacters = await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
            if (!knownCharacters.includes(characterId)) {
                knownCharacters.push(characterId);
                await storage.setJSON(this.knownCharactersKey, knownCharacters, this.storageArea, true);
            }
        }

        /**
         * Get list of known character IDs
         * @returns {Promise<Array<string>>} Character IDs
         */
        async getKnownCharacters() {
            return await storage.getJSON(this.knownCharactersKey, this.storageArea, []);
        }

        /**
         * Sync current settings to all other characters
         * @param {Object} settings - Current settings to copy
         * @returns {Promise<number>} Number of characters synced
         */
        async syncSettingsToAllCharacters(settings) {
            const knownCharacters = await this.getKnownCharacters();
            let syncedCount = 0;

            for (const characterId of knownCharacters) {
                // Skip current character (already has these settings)
                if (characterId === this.currentCharacterId) {
                    continue;
                }

                // Write settings to this character's key
                const characterKey = `${this.storageKey}_${characterId}`;
                await storage.setJSON(characterKey, settings, this.storageArea, true);
                syncedCount++;
            }

            return syncedCount;
        }

        /**
         * Get a single setting value
         * @param {string} settingId - Setting ID
         * @param {*} defaultValue - Default value if not found
         * @returns {Promise<*>} Setting value
         */
        async getSetting(settingId, defaultValue = null) {
            const settings = await this.loadSettings();
            const setting = settings[settingId];

            if (!setting) {
                return defaultValue;
            }

            // Return boolean for checkbox settings
            if (setting.type === 'checkbox') {
                return setting.isTrue ?? defaultValue;
            }

            // Return value for other settings
            return setting.value ?? defaultValue;
        }

        /**
         * Set a single setting value
         * @param {string} settingId - Setting ID
         * @param {*} value - New value
         * @returns {Promise<void>}
         */
        async setSetting(settingId, value) {
            const settings = await this.loadSettings();

            if (!settings[settingId]) {
                console.warn(`Setting '${settingId}' not found`);
                return;
            }

            // Update value
            if (settings[settingId].type === 'checkbox') {
                settings[settingId].isTrue = value;
            } else {
                settings[settingId].value = value;
            }

            await this.saveSettings(settings);
        }

        /**
         * Reset all settings to defaults
         * @returns {Promise<void>}
         */
        async resetToDefaults() {
            // Clear per-character settings so loadSettings() returns defaults
            const characterKey = this.getCharacterStorageKey();
            await storage.delete(characterKey, this.storageArea);
        }

        /**
         * Export all settings as JSON (full dump of settings store)
         * Includes global keys and current character's keys.
         * Excludes transient cache data.
         * @returns {Promise<string>} JSON string
         */
        async exportSettings() {
            const allData = await storage.getAll(this.storageArea);

            // Exclude transient cache keys
            const EXCLUDE_PREFIXES = ['marketplace_cache'];
            const exported = {};

            for (const [key, value] of Object.entries(allData)) {
                if (EXCLUDE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
                exported[key] = value;
            }

            return JSON.stringify(exported, null, 2);
        }

        /**
         * Import settings from JSON
         * Only imports global keys and keys matching the current character ID.
         * Character-specific keys for other characters are skipped.
         * @param {string} jsonString - JSON string
         * @returns {Promise<{imported: number, skipped: number}>} Import result
         */
        async importSettings(jsonString) {
            try {
                const data = JSON.parse(jsonString);
                const currentCharId = this.currentCharacterId;
                let imported = 0;
                let skipped = 0;

                for (const [key, value] of Object.entries(data)) {
                    // Check if this is a character-specific key (contains a character ID pattern)
                    const charIdMatch = key.match(/_([0-9a-f]{24})$/i) || key.match(/_(\d{10,})$/);

                    if (charIdMatch) {
                        const keyCharId = charIdMatch[1];
                        if (currentCharId && keyCharId !== currentCharId) {
                            // Key belongs to a different character — skip
                            skipped++;
                            continue;
                        }
                    }

                    // Import global keys and current character's keys
                    await storage.setJSON(key, value, this.storageArea, true);
                    imported++;
                }

                return { imported, skipped };
            } catch (error) {
                console.error('[Settings Storage] Import failed:', error);
                return null;
            }
        }
    }

    const settingsStorage = new SettingsStorage();

    /**
     * Profile Cache Module
     * Stores current profile in memory for Steam users
     */

    // Module-level variable to hold current profile in memory
    let currentProfileCache = null;

    /**
     * Set current profile in memory
     * @param {Object} profileData - Profile data from profile_shared message
     */
    function setCurrentProfile(profileData) {
        currentProfileCache = profileData;
    }

    /**
     * Get current profile from memory
     * @returns {Object|null} Current profile or null
     */
    function getCurrentProfile() {
        return currentProfileCache;
    }

    /**
     * Clear current profile from memory
     */
    function clearCurrentProfile() {
        currentProfileCache = null;
    }

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
                    let profileList = (await storage.getJSON('profile_list', 'combatExport', null)) || [];

                    // Remove old entry for same character
                    profileList = profileList.filter((p) => p.characterID !== parsed.characterID);

                    // Add to front of list
                    profileList.unshift(parsed);

                    // Keep only last 20 profiles
                    if (profileList.length > 20) {
                        profileList.pop();
                    }

                    // Save updated profile list to IndexedDB (cross-session) and GM storage (cross-domain for Shykai)
                    await storage.setJSON('profile_list', profileList, 'combatExport', true);
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

    const webSocketHook = new WebSocketHook();

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
            webSocketHook.onSocketEvent('open', () => {
                this.setReconnecting('socket_open', { allowConnected: true });
            });

            webSocketHook.onSocketEvent('close', (event) => {
                this.setDisconnected('socket_close', event);
            });

            webSocketHook.onSocketEvent('error', (event) => {
                this.setDisconnected('socket_error', event);
            });

            webSocketHook.on('init_character_data', () => {
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
            this.webSocketHook = webSocketHook;

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
                            if (storage && typeof storage.flushAll === 'function') {
                                await storage.flushAll();
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

    const dataManager = new DataManager();

    /**
     * Configuration Module
     * Manages all script constants and user settings
     */


    /**
     * Config class manages all script configuration
     * - Constants (colors, URLs, formatters)
     * - User settings with persistence
     */
    class Config {
        constructor() {
            // Number formatting separators (locale-aware)
            this.THOUSAND_SEPARATOR = new Intl.NumberFormat().format(1111).replaceAll('1', '').at(0) || '';
            this.DECIMAL_SEPARATOR = new Intl.NumberFormat().format(1.1).replaceAll('1', '').at(0);

            // Extended color palette (configurable)
            // Dark background colors (for UI elements on dark backgrounds)
            this.COLOR_PROFIT = '#047857'; // Emerald green for positive values
            this.COLOR_LOSS = '#f87171'; // Red for negative values
            this.COLOR_WARNING = '#ffa500'; // Orange for warnings
            this.COLOR_INFO = '#60a5fa'; // Blue for informational
            this.COLOR_ESSENCE = '#c084fc'; // Purple for essences

            // Tooltip colors (for text on light/tooltip backgrounds)
            this.COLOR_TOOLTIP_PROFIT = '#047857'; // Green for tooltips
            this.COLOR_TOOLTIP_LOSS = '#dc2626'; // Darker red for tooltips
            this.COLOR_TOOLTIP_INFO = '#2563eb'; // Darker blue for tooltips
            this.COLOR_TOOLTIP_WARNING = '#ea580c'; // Darker orange for tooltips

            // General colors
            this.COLOR_TEXT_PRIMARY = '#ffffff'; // Primary text color
            this.COLOR_TEXT_SECONDARY = '#888888'; // Secondary text color
            this.COLOR_BORDER = '#444444'; // Border color
            this.COLOR_GOLD = '#ffa500'; // Gold/currency color
            this.COLOR_MIRROR = '#ffd700'; // Philosopher's Mirror highlight color
            this.COLOR_LISTING_PRICE_1M = '#ffd700'; // Listing total price 1M+
            this.COLOR_LISTING_PRICE_100K = '#22c55e'; // Listing total price 100K+
            this.COLOR_LISTING_PRICE_10K = '#ffffff'; // Listing total price 10K+
            this.COLOR_LISTING_PRICE_LOW = '#888888'; // Listing total price <10K
            this.COLOR_ACCENT = '#22c55e'; // Script accent color (green)
            this.COLOR_REMAINING_XP = '#FFFFFF'; // Remaining XP text color
            this.COLOR_XP_RATE = '#ffffff'; // XP/hr rate text color
            this.COLOR_HOURS_TO_LEVEL = '#ffffff'; // Hours to level text color
            this.COLOR_INV_COUNT = '#ffffff'; // Inventory count display color

            // Legacy color constants (mapped to COLOR_ACCENT)
            this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_ALERT = 'red';

            // Z-index tiers
            this.Z_HUD = 50; // In-game HUD overlays — below game interactive UI
            this.Z_FLOATING_PANEL = 1100; // Persistent panels — below MUI modals (game = ~1300)
            this.Z_POPUP = 9000; // Contextual popups / short-lived overlays
            this.Z_MODAL = 9000; // Full-screen intentional modals
            this.Z_NOTIFICATION = 99999; // Transient notifications (above everything)

            // Market API URL
            this.MARKET_API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

            // Settings loaded from settings-schema via settings-storage.js
            this.settingsMap = {};

            // Map of setting keys to callback functions
            this.settingChangeCallbacks = {};

            // Feature toggles with metadata for future UI
            this.features = {
                // Market Features
                tooltipPrices: {
                    enabled: true,
                    name: t('Market Prices in Tooltips'),
                    category: 'Market',
                    description: t('Shows bid/ask prices in item tooltips'),
                    settingKey: 'itemTooltip_prices',
                },
                tooltipArtisanPrices: {
                    enabled: true,
                    name: t('Artisan-Adjusted Tooltip Prices'),
                    category: 'Market',
                    description: t('Adjusts tooltip price totals for Artisan Tea material reduction'),
                    settingKey: 'itemTooltip_artisanPrices',
                },
                tooltipProfit: {
                    enabled: true,
                    name: t('Profit Calculator in Tooltips'),
                    category: 'Market',
                    description: t('Shows production cost and profit in tooltips'),
                    settingKey: 'itemTooltip_profit',
                },
                tooltipConsumables: {
                    enabled: true,
                    name: t('Consumable Effects in Tooltips'),
                    category: 'Market',
                    description: t('Shows buff effects and durations for food/drinks'),
                    settingKey: 'showConsumTips',
                },
                dungeonTokenTooltips: {
                    enabled: true,
                    name: t('Currency Token Tooltips'),
                    category: 'Inventory',
                    description: t('Shows shop values for tokens, seals, and cowbells'),
                    settingKey: 'dungeonTokenTooltips',
                },
                expectedValueCalculator: {
                    enabled: true,
                    name: t('Expected Value Calculator'),
                    category: 'Market',
                    description: t('Shows EV for openable containers (crates, chests)'),
                    settingKey: 'itemTooltip_expectedValue',
                },
                market_showListingPrices: {
                    enabled: true,
                    name: t('Market Listing Price Display'),
                    category: 'Market',
                    description: t('Shows top order price, total value, and listing age on My Listings'),
                    settingKey: 'market_showListingPrices',
                },
                market_showEstimatedListingAge: {
                    enabled: true,
                    name: t('Estimated Listing Age'),
                    category: 'Market',
                    description: t('Estimates creation time for all market listings using listing ID interpolation'),
                    settingKey: 'market_showEstimatedListingAge',
                },
                market_showOrderTotals: {
                    enabled: true,
                    name: t('Market Order Totals'),
                    category: 'Market',
                    description: t('Shows buy orders, sell orders, and unclaimed coins in header'),
                    settingKey: 'market_showOrderTotals',
                },
                market_showHistoryViewer: {
                    enabled: true,
                    name: t('Market History Viewer'),
                    category: 'Market',
                    description: t('View and export all market listing history'),
                    settingKey: 'market_showHistoryViewer',
                },
                market_showPhiloCalculator: {
                    enabled: true,
                    name: t('Philo Gamba Calculator'),
                    category: 'Market',
                    description: t("Calculate expected value of transmuting items into Philosopher's Stones"),
                    settingKey: 'market_showPhiloCalculator',
                },

                // Action Features
                actionTimeDisplay: {
                    enabled: true,
                    name: t('Action Queue Time Display'),
                    category: 'Actions',
                    description: t('Shows total time and completion time for queued actions'),
                    settingKey: 'actionBar_enabled',
                },
                actionCountdown: {
                    enabled: true,
                    name: t('Action Bar Countdown'),
                    category: 'Actions',
                    description: t('Live countdown timer on the action progress bar'),
                },
                quickInputButtons: {
                    enabled: true,
                    name: t('Quick Input Buttons'),
                    category: 'Actions',
                    description: t('Adds 1/10/100/1000 buttons to action inputs'),
                    settingKey: 'actionPanel_totalTime_quickInputs',
                },
                actionPanelProfit: {
                    enabled: true,
                    name: t('Action Profit Display'),
                    category: 'Actions',
                    description: t('Shows profit/loss for gathering and production'),
                    settingKey: 'actionPanel_foragingTotal',
                },
                requiredMaterials: {
                    enabled: true,
                    name: t('Required Materials Display'),
                    category: 'Actions',
                    description: t('Shows total required and missing materials for production actions'),
                    settingKey: 'requiredMaterials',
                },

                // Combat Features
                abilityBookCalculator: {
                    enabled: true,
                    name: t('Ability Book Requirements'),
                    category: 'Combat',
                    description: t('Shows books needed to reach target level'),
                    settingKey: 'skillbook',
                },
                zoneIndices: {
                    enabled: true,
                    name: t('Combat Zone Indices'),
                    category: 'Combat',
                    description: t('Shows zone numbers in combat location list'),
                    settingKey: 'mapIndex',
                },
                taskZoneIndices: {
                    enabled: true,
                    name: t('Task Zone Indices'),
                    category: 'Tasks',
                    description: t('Shows zone numbers on combat tasks'),
                    settingKey: 'taskMapIndex',
                },
                combatScore: {
                    enabled: true,
                    name: t('Profile Gear Score'),
                    category: 'Combat',
                    description: t('Shows gear score on profile'),
                    settingKey: 'combatScore',
                },
                dungeonTracker: {
                    enabled: true,
                    name: t('Dungeon Tracker'),
                    category: 'Combat',
                    description: t(
                        'Real-time dungeon progress tracking in top bar with wave times, statistics, and party chat completion messages'
                    ),
                    settingKey: 'dungeonTracker',
                },
                combatSimIntegration: {
                    enabled: true,
                    name: t('Combat Simulator Integration'),
                    category: 'Combat',
                    description: t('Auto-import character/party data into Shykai Combat Simulator'),
                    settingKey: null, // New feature, no legacy setting
                },
                enhancementSimulator: {
                    enabled: true,
                    name: t('Enhancement Simulator'),
                    category: 'Market',
                    description: t('Shows enhancement cost calculations in item tooltips'),
                    settingKey: 'enhanceSim',
                },

                // UI Features
                equipmentLevelDisplay: {
                    enabled: true,
                    name: t('Equipment Level on Icons'),
                    category: 'UI',
                    description: t('Shows item level number on equipment icons'),
                    settingKey: 'itemIconLevel',
                },
                alchemyItemDimming: {
                    enabled: true,
                    name: t('Alchemy Item Dimming'),
                    category: 'UI',
                    description: t('Dims items requiring higher Alchemy level'),
                    settingKey: 'alchemyItemDimming',
                },
                skillExperiencePercentage: {
                    enabled: true,
                    name: t('Skill Experience Percentage'),
                    category: 'UI',
                    description: t('Shows XP progress percentage in left sidebar'),
                    settingKey: 'expPercentage',
                },
                largeNumberFormatting: {
                    enabled: true,
                    name: t('Use K/M/B Number Formatting'),
                    category: 'UI',
                    description: t('Display large numbers as 1.5M instead of 1,500,000'),
                    settingKey: 'formatting_useKMBFormat',
                },

                // Task Features
                taskProfitDisplay: {
                    enabled: true,
                    name: t('Task Profit Calculator'),
                    category: 'Tasks',
                    description: t('Shows expected profit from task rewards'),
                    settingKey: 'taskProfitCalculator',
                },
                taskEfficiencyRating: {
                    enabled: true,
                    name: t('Task Efficiency Rating'),
                    category: 'Tasks',
                    description: t('Shows tokens or profit per hour on task cards'),
                    settingKey: 'taskEfficiencyRating',
                },
                taskRerollTracker: {
                    enabled: true,
                    name: t('Task Reroll Tracker'),
                    category: 'Tasks',
                    description: t('Tracks reroll costs and history'),
                    settingKey: 'taskRerollTracker',
                },
                taskSorter: {
                    enabled: true,
                    name: t('Task Sorting'),
                    category: 'Tasks',
                    description: t('Adds button to sort tasks by skill type'),
                    settingKey: 'taskSorter',
                },
                taskIcons: {
                    enabled: true,
                    name: t('Task Icons'),
                    category: 'Tasks',
                    description: t('Shows visual icons on task cards'),
                    settingKey: 'taskIcons',
                },
                taskIconsDungeons: {
                    enabled: false,
                    name: t('Task Icons - Dungeons'),
                    category: 'Tasks',
                    description: t('Shows dungeon icons for combat tasks'),
                    settingKey: 'taskIconsDungeons',
                    dependencies: ['taskIcons'],
                },

                // Skills Features
                skillRemainingXP: {
                    enabled: true,
                    name: t('Remaining XP Display'),
                    category: 'Skills',
                    description: t('Shows remaining XP to next level on skill bars'),
                    settingKey: 'skillRemainingXP',
                },

                // House Features
                houseCostDisplay: {
                    enabled: true,
                    name: t('House Upgrade Costs'),
                    category: 'House',
                    description: t('Shows market value of upgrade materials'),
                    settingKey: 'houseUpgradeCosts',
                },

                // Economy Features
                networth: {
                    enabled: true,
                    name: t('Net Worth Calculator'),
                    category: 'Economy',
                    description: t('Shows total asset value in header (Current Assets)'),
                    settingKey: 'networth',
                },
                inventorySummary: {
                    enabled: true,
                    name: t('Inventory Summary Panel'),
                    category: 'Economy',
                    description: t('Shows detailed networth breakdown below inventory'),
                    settingKey: 'invWorth',
                },
                inventorySort: {
                    enabled: true,
                    name: t('Inventory Sort'),
                    category: 'Economy',
                    description: t('Sorts inventory by Ask/Bid price'),
                    settingKey: 'invSort',
                },
                inventorySortBadges: {
                    enabled: false,
                    name: t('Inventory Sort Price Badges'),
                    category: 'Economy',
                    description: t('Shows stack value badges on items when sorting'),
                    settingKey: 'invSort_showBadges',
                },
                inventoryBadgePrices: {
                    enabled: false,
                    name: t('Inventory Price Badges'),
                    category: 'Economy',
                    description: t('Shows stack value badges on items (independent of sorting)'),
                    settingKey: 'invBadgePrices',
                },

                // Enhancement Features
                enhancementTracker: {
                    enabled: false,
                    name: t('Enhancement Tracker'),
                    category: 'Enhancement',
                    description: t('Tracks enhancement attempts, costs, and statistics'),
                    settingKey: 'enhancementTracker',
                },

                // Notification Features
                notifiEmptyAction: {
                    enabled: false,
                    name: t('Empty Queue Notification'),
                    category: 'Notifications',
                    description: t('Browser notification when action queue becomes empty'),
                    settingKey: 'notifiEmptyAction',
                },
            };

            // Note: loadSettings() must be called separately (async)
        }

        /**
         * Initialize config (async) - loads settings from storage
         * @returns {Promise<void>}
         */
        async initialize() {
            await this.loadSettings();
            this.applyColorSettings();
        }

        /**
         * Load settings from storage (async)
         * @returns {Promise<void>}
         */
        async loadSettings() {
            // Set character ID in settings storage for per-character settings
            const characterId = dataManager.getCurrentCharacterId();

            // Before character ID is known, only populate schema defaults (no storage access)
            // This prevents loading from the wrong storage key during early initialization
            if (!characterId) {
                this.settingsMap = settingsStorage.buildDefaults();
                return;
            }

            settingsStorage.setCharacterId(characterId);

            const previousMap = this.settingsMap;

            // Load settings from settings-storage (which uses settings-schema as source of truth)
            this.settingsMap = await settingsStorage.loadSettings();

            // Fire change callbacks for settings that differ from what was previously loaded
            for (const key of Object.keys(this.settingChangeCallbacks)) {
                const prev = previousMap[key];
                const curr = this.settingsMap[key];
                if (!prev || !curr) continue;
                const prevVal = prev.hasOwnProperty('value') ? prev.value : prev.isTrue;
                const currVal = curr.hasOwnProperty('value') ? curr.value : curr.isTrue;
                if (prevVal !== currVal) {
                    for (const cb of this.settingChangeCallbacks[key]) cb(currVal);
                }
            }
        }

        /**
         * Clear settings cache (for character switching)
         */
        clearSettingsCache() {
            this.settingsMap = {};
        }

        /**
         * Save settings to storage (immediately)
         */
        saveSettings() {
            settingsStorage.saveSettings(this.settingsMap);
        }

        /**
         * Get a setting value
         * @param {string} key - Setting key
         * @returns {boolean} Setting value
         */
        getSetting(key) {
            // Check loaded settings first
            if (this.settingsMap[key]) {
                return this.settingsMap[key].isTrue ?? false;
            }

            // Fallback: Check settings-schema for default (fixes race condition on load)
            for (const group of Object.values(settingsGroups)) {
                if (group.settings[key]) {
                    return group.settings[key].default ?? false;
                }
            }

            // Ultimate fallback
            return false;
        }

        /**
         * Get the display label for a pricing mode key, respecting the naming convention setting.
         * @param {string} mode - Pricing mode key ('conservative', 'hybrid', 'optimistic', 'patientBuy')
         * @returns {string} Display label
         */
        getPricingModeLabel(mode) {
            const useInstant = this.getSetting('profitCalc_pricingNaming');
            const labels = useInstant
                ? {
                      conservative: t('Instant Buy / Instant Sell'),
                      hybrid: t('Instant Buy / Patient Sell'),
                      optimistic: t('Patient Buy / Patient Sell'),
                      patientBuy: t('Patient Buy / Instant Sell'),
                  }
                : {
                      conservative: t('Buy: Ask / Sell: Bid'),
                      hybrid: t('Buy: Ask / Sell: Ask'),
                      optimistic: t('Buy: Bid / Sell: Ask'),
                      patientBuy: t('Buy: Bid / Sell: Bid'),
                  };
            return labels[mode] || labels.hybrid;
        }

        /**
         * Get a setting value (for non-boolean settings)
         * @param {string} key - Setting key
         * @param {*} defaultValue - Default value if key doesn't exist
         * @returns {*} Setting value
         */
        getSettingValue(key, defaultValue = null) {
            const setting = this.settingsMap[key];
            if (!setting) {
                return defaultValue;
            }
            // Handle both boolean (isTrue) and value-based settings
            if (setting.hasOwnProperty('value')) {
                let value = setting.value;

                // Parse JSON strings for template-type settings
                if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                    try {
                        value = JSON.parse(value);
                    } catch (e) {
                        console.warn(`[Config] Failed to parse JSON for setting '${key}':`, e);
                        // Return as-is if parsing fails
                    }
                }

                return value;
            } else if (setting.hasOwnProperty('isTrue')) {
                return setting.isTrue;
            }
            return defaultValue;
        }

        /**
         * Set a setting value (auto-saves)
         * @param {string} key - Setting key
         * @param {boolean} value - Setting value
         */
        setSetting(key, value) {
            if (this.settingsMap[key]) {
                this.settingsMap[key].isTrue = value;
                this.saveSettings();

                // Re-apply colors if color setting changed
                if (key === 'useOrangeAsMainColor') {
                    this.applyColorSettings();
                }

                // Trigger registered callbacks for this setting
                if (this.settingChangeCallbacks[key]) {
                    for (const cb of this.settingChangeCallbacks[key]) cb(value);
                }
            }
        }

        /**
         * Set a setting value (for non-boolean settings, auto-saves)
         * @param {string} key - Setting key
         * @param {*} value - Setting value
         */
        setSettingValue(key, value) {
            if (this.settingsMap[key]) {
                this.settingsMap[key].value = value;
                this.saveSettings();

                // Re-apply color settings if this is a color setting
                if (key.startsWith('color_')) {
                    this.applyColorSettings();
                }

                // Trigger registered callbacks for this setting
                if (this.settingChangeCallbacks[key]) {
                    for (const cb of this.settingChangeCallbacks[key]) cb(value);
                }
            }
        }

        /**
         * Register a callback to be called when a specific setting changes.
         * Multiple callbacks per key are supported.
         * @param {string} key - Setting key to watch
         * @param {Function} callback - Callback function to call when setting changes
         */
        onSettingChange(key, callback) {
            if (!this.settingChangeCallbacks[key]) {
                this.settingChangeCallbacks[key] = [];
            }
            this.settingChangeCallbacks[key].push(callback);
        }

        /**
         * Unregister a specific callback for a setting change
         * @param {string} key - Setting key to stop watching
         * @param {Function} callback - The exact callback reference to remove
         */
        offSettingChange(key, callback) {
            if (this.settingChangeCallbacks[key]) {
                this.settingChangeCallbacks[key] = this.settingChangeCallbacks[key].filter((cb) => cb !== callback);
            }
        }

        /**
         * Toggle a setting (auto-saves)
         * @param {string} key - Setting key
         * @returns {boolean} New value
         */
        toggleSetting(key) {
            const newValue = !this.getSetting(key);
            this.setSetting(key, newValue);
            return newValue;
        }

        /**
         * Get all settings as an array (useful for UI)
         * @returns {Array} Array of setting objects
         */
        getAllSettings() {
            return Object.values(this.settingsMap);
        }

        /**
         * Reset all settings to defaults
         */
        async resetToDefaults() {
            this.settingsMap = settingsStorage.buildDefaults();
            await settingsStorage.saveSettings(this.settingsMap);
            this.applyColorSettings();
        }

        /**
         * Sync current settings to all other characters
         * @returns {Promise<{success: boolean, count: number, error?: string}>} Result object
         */
        async syncSettingsToAllCharacters() {
            try {
                // Ensure character ID is set
                const characterId = dataManager.getCurrentCharacterId();
                if (!characterId) {
                    return {
                        success: false,
                        count: 0,
                        error: 'No character ID available',
                    };
                }

                // Set character ID in settings storage
                settingsStorage.setCharacterId(characterId);

                // Sync settings to all other characters
                const syncedCount = await settingsStorage.syncSettingsToAllCharacters(this.settingsMap);

                return {
                    success: true,
                    count: syncedCount,
                };
            } catch (error) {
                console.error('[Config] Failed to sync settings:', error);
                return {
                    success: false,
                    count: 0,
                    error: error.message,
                };
            }
        }

        /**
         * Get number of known characters (including current)
         * @returns {Promise<number>} Number of characters
         */
        async getKnownCharacterCount() {
            try {
                const knownCharacters = await settingsStorage.getKnownCharacters();
                return knownCharacters.length;
            } catch (error) {
                console.error('[Config] Failed to get character count:', error);
                return 0;
            }
        }

        /**
         * Apply color settings to color constants
         */
        applyColorSettings() {
            // Apply extended color palette from settings
            this.COLOR_PROFIT = this.getSettingValue('color_profit', '#047857');
            this.COLOR_LOSS = this.getSettingValue('color_loss', '#f87171');
            this.COLOR_WARNING = this.getSettingValue('color_warning', '#ffa500');
            this.COLOR_INFO = this.getSettingValue('color_info', '#60a5fa');
            this.COLOR_ESSENCE = this.getSettingValue('color_essence', '#c084fc');
            this.COLOR_TOOLTIP_PROFIT = this.getSettingValue('color_tooltip_profit', '#047857');
            this.COLOR_TOOLTIP_LOSS = this.getSettingValue('color_tooltip_loss', '#dc2626');
            this.COLOR_TOOLTIP_INFO = this.getSettingValue('color_tooltip_info', '#2563eb');
            this.COLOR_TOOLTIP_WARNING = this.getSettingValue('color_tooltip_warning', '#ea580c');
            this.COLOR_TEXT_PRIMARY = this.getSettingValue('color_text_primary', '#ffffff');
            this.COLOR_TEXT_SECONDARY = this.getSettingValue('color_text_secondary', '#888888');
            this.COLOR_BORDER = this.getSettingValue('color_border', '#444444');
            this.COLOR_GOLD = this.getSettingValue('color_gold', '#ffa500');
            this.COLOR_MIRROR = this.getSettingValue('color_mirror', '#ffd700');
            this.COLOR_LISTING_PRICE_1M = this.getSettingValue('color_listing_price_1m', '#ffd700');
            this.COLOR_LISTING_PRICE_100K = this.getSettingValue('color_listing_price_100k', '#22c55e');
            this.COLOR_LISTING_PRICE_10K = this.getSettingValue('color_listing_price_10k', '#ffffff');
            this.COLOR_LISTING_PRICE_LOW = this.getSettingValue('color_listing_price_low', '#888888');
            this.COLOR_ACCENT = this.getSettingValue('color_accent', '#22c55e');
            this.COLOR_REMAINING_XP = this.getSettingValue('color_remaining_xp', '#FFFFFF');
            this.COLOR_XP_RATE = this.getSettingValue('color_xp_rate', '#ffffff');
            this.COLOR_HOURS_TO_LEVEL = this.getSettingValue('color_hours_to_level', '#ffffff');
            this.COLOR_INV_COUNT = this.getSettingValue('color_inv_count', '#ffffff');
            this.COLOR_INVBADGE_ASK = this.getSettingValue('color_invBadge_ask', '#047857');
            this.COLOR_INVBADGE_BID = this.getSettingValue('color_invBadge_bid', '#60a5fa');
            this.COLOR_TRANSMUTE = this.getSettingValue('color_transmute', '#ffffff');

            // Set legacy SCRIPT_COLOR_MAIN to accent color
            this.SCRIPT_COLOR_MAIN = this.COLOR_ACCENT;
            this.SCRIPT_COLOR_TOOLTIP = this.COLOR_ACCENT; // Keep tooltip same as main
        }

        /**
         * Check if a feature is enabled
         * Uses legacy settingKey if available, otherwise uses feature.enabled
         * @param {string} featureKey - Feature key (e.g., 'tooltipPrices')
         * @returns {boolean} Whether feature is enabled
         */
        isFeatureEnabled(featureKey) {
            const feature = this.features?.[featureKey];
            if (!feature) {
                return true; // Default to enabled if not found
            }

            // Check legacy setting first (for backward compatibility)
            if (feature.settingKey && this.settingsMap[feature.settingKey]) {
                return this.settingsMap[feature.settingKey].isTrue ?? true;
            }

            // Otherwise use feature.enabled
            return feature.enabled ?? true;
        }

        /**
         * Enable or disable a feature
         * @param {string} featureKey - Feature key
         * @param {boolean} enabled - Enable state
         */
        async setFeatureEnabled(featureKey, enabled) {
            const feature = this.features?.[featureKey];
            if (!feature) {
                console.warn(`Feature '${featureKey}' not found`);
                return;
            }

            // Update legacy setting if it exists
            if (feature.settingKey && this.settingsMap[feature.settingKey]) {
                this.settingsMap[feature.settingKey].isTrue = enabled;
            }

            // Update feature registry
            feature.enabled = enabled;

            await this.saveSettings();
        }

        /**
         * Toggle a feature
         * @param {string} featureKey - Feature key
         * @returns {boolean} New enabled state
         */
        async toggleFeature(featureKey) {
            const current = this.isFeatureEnabled(featureKey);
            await this.setFeatureEnabled(featureKey, !current);
            return !current;
        }

        /**
         * Get all features grouped by category
         * @returns {Object} Features grouped by category
         */
        getFeaturesByCategory() {
            const grouped = {};

            for (const [key, feature] of Object.entries(this.features)) {
                const category = feature.category || 'Other';
                if (!grouped[category]) {
                    grouped[category] = [];
                }
                grouped[category].push({
                    key,
                    name: feature.name,
                    description: feature.description,
                    enabled: this.isFeatureEnabled(key),
                });
            }

            return grouped;
        }

        /**
         * Get all feature keys
         * @returns {string[]} Array of feature keys
         */
        getFeatureKeys() {
            return Object.keys(this.features || {});
        }

        /**
         * Get feature info
         * @param {string} featureKey - Feature key
         * @returns {Object|null} Feature info with current enabled state
         */
        getFeatureInfo(featureKey) {
            const feature = this.features?.[featureKey];
            if (!feature) {
                return null;
            }

            return {
                key: featureKey,
                name: feature.name,
                category: feature.category,
                description: feature.description,
                enabled: this.isFeatureEnabled(featureKey),
            };
        }
    }

    const config = new Config();

    /**
     * Performance Monitor
     * Tracks execution time of features and DOM observer handlers
     * using a rolling window for CPU percentage calculations.
     */

    const WINDOW_MS = 5000;

    class PerformanceMonitor {
        constructor() {
            this.measurements = new Map();
            this.snapshots = new Map();
            this.windowMs = WINDOW_MS;
            this.enabled = false;
            this._onVisibilityChange = () => {
                this._tabVisible = !document.hidden;
            };
            this._tabVisible = true;
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', this._onVisibilityChange);
            }
        }

        /**
         * Record a timing measurement
         * @param {string} name - Metric name (e.g. "dom:MarketFilter", "init:tooltipPrices")
         * @param {number} durationMs - Duration in milliseconds
         */
        record(name, durationMs) {
            if (!this.enabled || !this._tabVisible) return;
            if (!this.measurements.has(name)) {
                this.measurements.set(name, []);
            }
            this.measurements.get(name).push({ time: Date.now(), duration: durationMs });
        }

        /**
         * Store a one-time snapshot measurement that persists beyond the rolling window
         * @param {string} name - Metric name
         * @param {number} durationMs - Duration in milliseconds
         */
        snapshot(name, durationMs) {
            this.snapshots.set(name, { duration: durationMs, time: Date.now() });
        }

        /**
         * Wrap a function with automatic timing
         * @param {string} name - Metric name
         * @param {Function} fn - Function to wrap
         * @returns {Function} Wrapped function
         */
        wrap(name, fn) {
            const monitor = this;
            return function (...args) {
                if (!monitor.enabled || !monitor._tabVisible) return fn.apply(this, args);
                const start = performance.now();
                try {
                    const result = fn.apply(this, args);
                    if (result && typeof result.then === 'function') {
                        return result.finally(() => monitor.record(name, performance.now() - start));
                    }
                    monitor.record(name, performance.now() - start);
                    return result;
                } catch (error) {
                    monitor.record(name, performance.now() - start);
                    throw error;
                }
            };
        }

        /**
         * Get stats for a single metric within the rolling window
         * @param {string} name - Metric name
         * @returns {{ calls: number, totalMs: number, avgMs: number, cpuPercent: number } | null}
         */
        getStats(name) {
            const entries = this.measurements.get(name);
            if (!entries || entries.length === 0) return null;

            const cutoff = Date.now() - this.windowMs;
            let calls = 0;
            let totalMs = 0;

            for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].time < cutoff) break;
                calls++;
                totalMs += entries[i].duration;
            }

            if (calls === 0) return null;

            return {
                calls,
                totalMs,
                avgMs: totalMs / calls,
                cpuPercent: Math.min((totalMs / this.windowMs) * 100, 100),
            };
        }

        /**
         * Get stats for all metrics, cleaning up stale data
         * @returns {Map<string, { calls: number, totalMs: number, avgMs: number, cpuPercent: number }>}
         */
        getAllStats() {
            this._cleanup();
            const result = new Map();

            for (const [name, entries] of this.measurements) {
                if (entries.length === 0) continue;
                const stats = this.getStats(name);
                if (stats) {
                    result.set(name, stats);
                }
            }

            return result;
        }

        /**
         * Remove measurements older than the rolling window
         * @private
         */
        _cleanup() {
            const cutoff = Date.now() - this.windowMs;
            for (const [name, entries] of this.measurements) {
                let firstValid = 0;
                while (firstValid < entries.length && entries[firstValid].time < cutoff) {
                    firstValid++;
                }
                if (firstValid > 0) {
                    entries.splice(0, firstValid);
                }
                if (entries.length === 0) {
                    this.measurements.delete(name);
                }
            }
        }

        /**
         * Get all snapshot measurements
         * @returns {Map<string, { duration: number, time: number }>}
         */
        getSnapshots() {
            return new Map(this.snapshots);
        }

        /**
         * Clear all measurements
         */
        reset() {
            this.measurements.clear();
            this.snapshots.clear();
        }
    }

    const performanceMonitor = new PerformanceMonitor();

    /**
     * Centralized DOM Observer
     * Single MutationObserver that dispatches to registered handlers
     * Replaces 15 separate observers watching document.body
     * Supports optional debouncing to reduce CPU usage during bulk DOM changes
     */


    class DOMObserver {
        constructor() {
            this.observer = null;
            this.handlers = [];
            this.isObserving = false;
            this.debounceTimers = new Map(); // Track debounce timers per handler
            this.debouncedElements = new Map(); // Track pending elements per handler
            this.DEFAULT_DEBOUNCE_DELAY = 50; // 50ms default delay
        }

        /**
         * Start observing DOM changes
         */
        start() {
            if (this.isObserving) return;

            // Wait for document.body to exist (critical for @run-at document-start)
            const startObserver = () => {
                if (!document.body) {
                    // Body doesn't exist yet, wait and try again
                    setTimeout(startObserver, 10);
                    return;
                }

                this.observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType !== Node.ELEMENT_NODE) continue;

                            // Dispatch to all registered handlers
                            this.handlers.forEach((handler) => {
                                try {
                                    if (handler.debounce) {
                                        this.debouncedCallback(handler, node, mutation);
                                    } else if (performanceMonitor.enabled) {
                                        const start = performance.now();
                                        handler.callback(node, mutation);
                                        performanceMonitor.record(`dom:${handler.name}`, performance.now() - start);
                                    } else {
                                        handler.callback(node, mutation);
                                    }
                                } catch (error) {
                                    console.error(`[DOM Observer] Handler error (${handler.name}):`, error);
                                }
                            });
                        }
                    }
                });

                this.observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                });

                this.isObserving = true;
            };

            startObserver();
        }

        /**
         * Debounced callback handler
         * Collects elements and fires callback after delay
         * @private
         */
        debouncedCallback(handler, node, mutation) {
            const handlerName = handler.name;
            const delay = handler.debounceDelay || this.DEFAULT_DEBOUNCE_DELAY;

            // Store element for batched processing
            if (!this.debouncedElements.has(handlerName)) {
                this.debouncedElements.set(handlerName, []);
            }
            this.debouncedElements.get(handlerName).push({ node, mutation });

            // Clear existing timer
            if (this.debounceTimers.has(handlerName)) {
                clearTimeout(this.debounceTimers.get(handlerName));
            }

            // Set new timer
            const timer = setTimeout(() => {
                const elements = this.debouncedElements.get(handlerName) || [];
                this.debouncedElements.delete(handlerName);
                this.debounceTimers.delete(handlerName);

                // Process all collected elements
                // For most handlers, we only need to process the last element
                // (e.g., task list updated multiple times, we only care about final state)
                if (elements.length > 0) {
                    const lastElement = elements[elements.length - 1];
                    if (performanceMonitor.enabled) {
                        const start = performance.now();
                        handler.callback(lastElement.node, lastElement.mutation);
                        performanceMonitor.record(`dom:${handler.name}`, performance.now() - start);
                    } else {
                        handler.callback(lastElement.node, lastElement.mutation);
                    }
                }
            }, delay);

            this.debounceTimers.set(handlerName, timer);
        }

        /**
         * Stop observing DOM changes
         */
        stop() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            // Clear all debounce timers
            this.debounceTimers.forEach((timer) => clearTimeout(timer));
            this.debounceTimers.clear();
            this.debouncedElements.clear();

            this.isObserving = false;
        }

        /**
         * Register a handler for DOM changes
         * @param {string} name - Handler name for debugging
         * @param {Function} callback - Function to call when nodes are added (receives node, mutation)
         * @param {Object} options - Optional configuration
         * @param {boolean} options.debounce - Enable debouncing (default: false)
         * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
         * @returns {Function} Unregister function
         */
        register(name, callback, options = {}) {
            const handler = {
                name,
                callback,
                debounce: options.debounce || false,
                debounceDelay: options.debounceDelay,
            };
            this.handlers.push(handler);

            // Return unregister function
            return () => {
                const index = this.handlers.indexOf(handler);
                if (index > -1) {
                    this.handlers.splice(index, 1);

                    // Clean up any pending debounced callbacks
                    if (this.debounceTimers.has(name)) {
                        clearTimeout(this.debounceTimers.get(name));
                        this.debounceTimers.delete(name);
                        this.debouncedElements.delete(name);
                    }
                }
            };
        }

        /**
         * Register a handler for specific class names
         * @param {string} name - Handler name for debugging
         * @param {string|string[]} classNames - Class name(s) to watch for (supports partial matches)
         * @param {Function} callback - Function to call when matching elements appear
         * @param {Object} options - Optional configuration
         * @param {boolean} options.debounce - Enable debouncing (default: false for immediate response)
         * @param {number} options.debounceDelay - Debounce delay in ms (default: 50)
         * @returns {Function} Unregister function
         */
        onClass(name, classNames, callback, options = {}) {
            const classArray = Array.isArray(classNames) ? classNames : [classNames];

            return this.register(
                name,
                (node) => {
                    // Safely get className as string (handles SVG elements)
                    const className = typeof node.className === 'string' ? node.className : '';

                    // Check if node matches any of the target classes
                    for (const targetClass of classArray) {
                        if (className.includes(targetClass)) {
                            callback(node, true);
                            return; // Only call once per node
                        }
                    }

                    // Also check descendants when a container subtree is inserted.
                    // Only applies when the node has children — leaf nodes are skipped,
                    // which eliminates the bulk of querySelectorAll cost during React's
                    // init burst (thousands of individual leaf additions).
                    if (node.childElementCount >= 3) {
                        const combinedSelector =
                            classArray.length === 1
                                ? `[class*="${classArray[0]}"]`
                                : classArray.map((c) => `[class*="${c}"]`).join(',');
                        const matches = node.querySelectorAll(combinedSelector);
                        for (let i = 0; i < matches.length; i++) {
                            callback(matches[i], false);
                        }
                    }
                },
                options
            );
        }

        /**
         * Get stats about registered handlers
         */
        getStats() {
            return {
                isObserving: this.isObserving,
                handlerCount: this.handlers.length,
                handlers: this.handlers.map((h) => ({
                    name: h.name,
                    debounced: h.debounce || false,
                })),
                pendingCallbacks: this.debounceTimers.size,
            };
        }
    }

    const domObserver = new DOMObserver();

    /**
     * Feature Registry
     * Centralized feature initialization system
     */


    /**
     * Feature Registry
     * Populated at runtime by the entrypoint to avoid bundling feature code in core.
     */
    const featureRegistry = [];

    /**
     * Initialize all enabled features
     * @returns {Promise<void>}
     */
    async function initializeFeatures() {
        // Block feature initialization during character switch
        if (dataManager.getIsCharacterSwitching()) {
            return;
        }

        const errors = [];

        for (const feature of featureRegistry) {
            try {
                const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

                if (!isEnabled) {
                    continue;
                }

                // Initialize feature
                const start = performance.now();
                if (feature.async) {
                    await feature.initialize();
                } else {
                    feature.initialize();
                }
                performanceMonitor.snapshot(`init:${feature.key}`, performance.now() - start);
            } catch (error) {
                errors.push({
                    feature: feature.name,
                    error: error.message,
                });
                console.error(`[Toolasha] Failed to initialize ${feature.name}:`, error);
            }
        }

        // Log errors if any occurred
        if (errors.length > 0) {
            console.error(`[Toolasha] ${errors.length} feature(s) failed to initialize`, errors);
        }
    }

    /**
     * Get feature by key
     * @param {string} key - Feature key
     * @returns {Object|null} Feature definition or null
     */
    function getFeature(key) {
        return featureRegistry.find((f) => f.key === key) || null;
    }

    /**
     * Get all features
     * @returns {Array} Feature registry
     */
    function getAllFeatures() {
        return [...featureRegistry];
    }

    /**
     * Get features by category
     * @param {string} category - Category name
     * @returns {Array} Features in category
     */
    function getFeaturesByCategory(category) {
        return featureRegistry.filter((f) => f.category === category);
    }

    /**
     * Check health of all initialized features
     * @returns {Array<Object>} Array of failed features with details
     */
    function checkFeatureHealth() {
        const failed = [];

        for (const feature of featureRegistry) {
            // Skip if feature has no health check
            if (!feature.healthCheck) continue;

            // Skip if feature is not enabled
            const isEnabled = feature.customCheck ? feature.customCheck() : config.isFeatureEnabled(feature.key);

            if (!isEnabled) continue;

            try {
                const result = feature.healthCheck();

                // null = can't verify (DOM not ready), false = failed, true = healthy
                if (result === false) {
                    failed.push({
                        key: feature.key,
                        name: feature.name,
                        reason: 'Health check returned false',
                    });
                }
            } catch (error) {
                failed.push({
                    key: feature.key,
                    name: feature.name,
                    reason: `Health check error: ${error.message}`,
                });
            }
        }

        return failed;
    }

    /**
     * Setup character switch handler
     * Re-initializes all features when character switches
     */
    function setupCharacterSwitchHandler() {
        // Promise that resolves when cleanup is complete
        let cleanupPromise = null;
        let reinitScheduled = false;

        // Handle character_switching event (cleanup phase)
        dataManager.on('character_switching', async (_data) => {
            cleanupPromise = (async () => {
                try {
                    // Clear config cache IMMEDIATELY to prevent stale settings
                    if (config && typeof config.clearSettingsCache === 'function') {
                        config.clearSettingsCache();
                    }

                    // Disable all active features (cleanup DOM elements, event listeners, etc.)
                    const cleanupPromises = [];
                    for (const feature of featureRegistry) {
                        try {
                            const featureInstance = getFeatureInstance(feature.key);
                            if (featureInstance && typeof featureInstance.disable === 'function') {
                                const result = featureInstance.disable();
                                if (result && typeof result.then === 'function') {
                                    cleanupPromises.push(
                                        result.catch((error) => {
                                            console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                                        })
                                    );
                                }
                            }
                        } catch (error) {
                            console.error(`[FeatureRegistry] Failed to disable ${feature.name}:`, error);
                        }
                    }

                    // Wait for all cleanup in parallel
                    if (cleanupPromises.length > 0) {
                        await Promise.all(cleanupPromises);
                    }
                } catch (error) {
                    console.error('[FeatureRegistry] Error during character switch cleanup:', error);
                }
            })();

            await cleanupPromise;
        });

        // Handle character_switched event (re-initialization phase)
        dataManager.on('character_switched', async (_data) => {
            // Prevent multiple overlapping reinits
            if (reinitScheduled) {
                return;
            }

            reinitScheduled = true;

            // Force cleanup of dungeon tracker UI (safety measure)
            const dungeonTrackerFeature = getFeature('dungeonTrackerUI');
            if (dungeonTrackerFeature && typeof dungeonTrackerFeature.cleanup === 'function') {
                dungeonTrackerFeature.cleanup();
            }

            try {
                // Wait for cleanup to complete (with safety timeout)
                if (cleanupPromise) {
                    await Promise.race([cleanupPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
                }

                // CRITICAL: Load settings BEFORE any feature initialization
                // This ensures all features see the new character's settings
                await config.loadSettings();
                config.applyColorSettings();

                // Small delay to ensure game state is stable
                await new Promise((resolve) => setTimeout(resolve, 50));

                // Now re-initialize all features with fresh settings
                await initializeFeatures();
            } catch (error) {
                console.error('[FeatureRegistry] Error during feature reinitialization:', error);
            } finally {
                reinitScheduled = false;
            }
        });
    }

    /**
     * Get feature instance from imported module
     * @param {string} key - Feature key
     * @returns {Object|null} Feature instance or null
     * @private
     */
    function getFeatureInstance(key) {
        const feature = getFeature(key);
        if (!feature) {
            return null;
        }

        return feature.module || feature;
    }

    /**
     * Retry initialization for specific features
     * @param {Array<Object>} failedFeatures - Array of failed feature objects
     * @returns {Promise<void>}
     */
    async function retryFailedFeatures(failedFeatures) {
        for (const failed of failedFeatures) {
            const feature = getFeature(failed.key);
            if (!feature) continue;

            try {
                if (feature.async) {
                    await feature.initialize();
                } else {
                    feature.initialize();
                }

                // Verify the retry actually worked by running health check
                if (feature.healthCheck) {
                    const healthResult = feature.healthCheck();
                    if (healthResult === false) {
                        console.warn(`[Toolasha] ${feature.name} retry completed but health check still fails`);
                    }
                }
            } catch (error) {
                console.error(`[Toolasha] ${feature.name} retry failed:`, error);
            }
        }
    }

    /**
     * Replace the feature registry (for library split)
     * @param {Array} newFeatures - New feature registry array
     */
    function replaceFeatures(newFeatures) {
        featureRegistry.length = 0; // Clear existing array
        featureRegistry.push(...newFeatures); // Add new features
    }

    var featureRegistry$1 = {
        initializeFeatures,
        setupCharacterSwitchHandler,
        checkFeatureHealth,
        retryFailedFeatures,
        getFeature,
        getAllFeatures,
        replaceFeatures,
        getFeaturesByCategory,
    };

    /**
     * Tooltip Observer
     * Centralized observer for tooltip/popper appearances
     * Any feature can subscribe to be notified when tooltips appear
     */


    class TooltipObserver {
        constructor() {
            this.subscribers = new Map(); // name -> callback
            this.unregisterObserver = null;
            this.isInitialized = false;
        }

        /**
         * Initialize the observer (call once)
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Watch for tooltip/popper elements appearing
            // These are the common classes used by MUI tooltips/poppers
            this.unregisterObserver = domObserver.onClass('TooltipObserver', ['MuiPopper', 'MuiTooltip'], (element) => {
                this.notifySubscribers(element);
            });
        }

        /**
         * Subscribe to tooltip appearance events
         * @param {string} name - Unique subscriber name
         * @param {Function} callback - Function(element) to call when tooltip appears
         */
        subscribe(name, callback) {
            this.subscribers.set(name, callback);

            // Auto-initialize if first subscriber
            if (!this.isInitialized) {
                this.initialize();
            }
        }

        /**
         * Unsubscribe from tooltip events
         * @param {string} name - Subscriber name
         */
        unsubscribe(name) {
            this.subscribers.delete(name);

            // If no subscribers left, could optionally stop observing
            // For now, keep observer active for simplicity
        }

        /**
         * Notify all subscribers that a tooltip appeared
         * @param {Element} element - The tooltip/popper element
         * @private
         */
        notifySubscribers(element) {
            // Set up observer to detect when this specific tooltip is removed
            const removalObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const removedNode of mutation.removedNodes) {
                        if (removedNode === element) {
                            // Notify subscribers that tooltip closed
                            for (const [name, callback] of this.subscribers.entries()) {
                                try {
                                    callback(element, 'closed');
                                } catch (error) {
                                    console.error(`[TooltipObserver] Error in subscriber "${name}" (close):`, error);
                                }
                            }
                            removalObserver.disconnect();
                            return;
                        }
                    }
                }
            });

            // Watch the parent for removal of this tooltip
            if (element.parentNode) {
                removalObserver.observe(element.parentNode, {
                    childList: true,
                });
            }

            // Notify subscribers that tooltip opened
            for (const [name, callback] of this.subscribers.entries()) {
                try {
                    callback(element, 'opened');
                } catch (error) {
                    console.error(`[TooltipObserver] Error in subscriber "${name}" (open):`, error);
                }
            }
        }

        /**
         * Cleanup and disable
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }
            this.subscribers.clear();
            this.isInitialized = false;
        }
    }

    const tooltipObserver = new TooltipObserver();

    /**
     * Network Alert Display
     * Shows a warning message when market data cannot be fetched
     */


    class NetworkAlert {
        constructor() {
            this.container = null;
            this.unregisterHandlers = [];
            this.isVisible = false;
        }

        /**
         * Initialize network alert display
         */
        initialize() {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            // 1. Check if header exists already
            const existingElem = document.querySelector('[class*="Header_totalLevel"]');
            if (existingElem) {
                this.prepareContainer(existingElem);
            }

            // 2. Watch for header to appear (handles SPA navigation)
            const unregister = domObserver.onClass('NetworkAlert', 'Header_totalLevel', (elem) => {
                this.prepareContainer(elem);
            });
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Prepare container but don't show yet
         * @param {Element} totalLevelElem - Total level element
         */
        prepareContainer(totalLevelElem) {
            // Check if already prepared
            if (this.container && document.body.contains(this.container)) {
                return;
            }

            // Remove any existing container
            if (this.container) {
                this.container.remove();
            }

            // Create container (hidden by default)
            this.container = document.createElement('div');
            this.container.className = 'mwi-network-alert';
            this.container.style.cssText = `
            display: none;
            font-size: 0.875rem;
            font-weight: 500;
            color: #ff4444;
            text-wrap: nowrap;
            margin-left: 16px;
        `;

            // Insert after total level (or after networth if it exists)
            const networthElem = totalLevelElem.parentElement.querySelector('.mwi-networth-header');
            if (networthElem) {
                networthElem.insertAdjacentElement('afterend', this.container);
            } else {
                totalLevelElem.insertAdjacentElement('afterend', this.container);
            }
        }

        /**
         * Show the network alert
         * @param {string} message - Alert message to display
         */
        show(message = t('⚠️ Market data unavailable')) {
            if (!config.getSetting('networkAlert')) {
                return;
            }

            if (!this.container || !document.body.contains(this.container)) {
                // Try to prepare container if not ready
                const totalLevelElem = document.querySelector('[class*="Header_totalLevel"]');
                if (totalLevelElem) {
                    this.prepareContainer(totalLevelElem);
                } else {
                    // Header not found, fallback to console
                    console.warn('[Network Alert]', message);
                    return;
                }
            }

            if (this.container) {
                this.container.textContent = message;
                this.container.style.display = 'block';
                this.isVisible = true;
            }
        }

        /**
         * Hide the network alert
         */
        hide() {
            if (this.container && document.body.contains(this.container)) {
                this.container.style.display = 'none';
                this.isVisible = false;
            }
        }

        /**
         * Cleanup
         */
        disable() {
            this.hide();

            if (this.container) {
                this.container.remove();
                this.container = null;
            }

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
        }
    }

    const networkAlert = new NetworkAlert();

    /**
     * Marketplace API Module
     * Fetches and caches market price data from the MWI marketplace API
     */


    /**
     * MarketAPI class handles fetching and caching market price data
     */
    class MarketAPI {
        constructor() {
            // API endpoint
            this.API_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

            // Cache settings
            this.CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
            this.CACHE_KEY_DATA = 'Toolasha_marketAPI_json';
            this.CACHE_KEY_TIMESTAMP = 'Toolasha_marketAPI_timestamp';
            this.CACHE_KEY_PATCHES = 'Toolasha_marketAPI_patches';
            this.CACHE_KEY_MIGRATION = 'Toolasha_marketAPI_migration_version';
            this.CURRENT_MIGRATION_VERSION = 1; // Increment this when patches need to be cleared

            // Current market data
            this.marketData = null;
            this.lastFetchTimestamp = null;
            this.errorLog = [];

            // Price patches from order book data (fresher than API)
            // Structure: { "itemHrid:enhLevel": { a: ask, b: bid, timestamp: ms } }
            this.pricePatchs = {};

            // Event listeners for price updates
            this.listeners = [];
        }

        /**
         * Fetch market data from API or cache
         * @param {boolean} forceFetch - Force a fresh fetch even if cache is valid
         * @returns {Promise<Object|null>} Market data object or null if failed
         */
        async fetch(forceFetch = false) {
            // Check cache first (unless force fetch)
            if (!forceFetch) {
                const cached = await this.getCachedData();
                if (cached) {
                    this.marketData = cached.data;
                    // API timestamp is in seconds, convert to milliseconds for comparison with Date.now()
                    this.lastFetchTimestamp = cached.timestamp * 1000;
                    // Load patches from storage
                    await this.loadPatches();
                    // Hide alert on successful cache load
                    networkAlert.hide();
                    // Notify listeners (initial load)
                    this.notifyListeners();
                    return this.marketData;
                }
            }

            if (!connectionState.isConnected()) {
                const cachedFallback = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
                if (cachedFallback?.marketData) {
                    this.marketData = cachedFallback.marketData;
                    // API timestamp is in seconds, convert to milliseconds
                    this.lastFetchTimestamp = cachedFallback.timestamp * 1000;
                    // Load patches from storage
                    await this.loadPatches();
                    console.warn('[MarketAPI] Skipping fetch; disconnected. Using cached data.');
                    return this.marketData;
                }

                console.warn('[MarketAPI] Skipping fetch; disconnected and no cache available');
                return null;
            }

            // Try to fetch fresh data
            try {
                const response = await this.fetchFromAPI();

                if (response) {
                    // Cache the fresh data
                    this.cacheData(response);
                    this.marketData = response.marketData;
                    // API timestamp is in seconds, convert to milliseconds
                    this.lastFetchTimestamp = response.timestamp * 1000;
                    // Load patches from storage (they may still be fresher than new API data)
                    await this.loadPatches();
                    // Hide alert on successful fetch
                    networkAlert.hide();
                    // Notify listeners of price update
                    this.notifyListeners();
                    return this.marketData;
                }
            } catch (error) {
                this.logError('Fetch failed', error);
            }

            // Fallback: Try to use expired cache
            const expiredCache = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);
            if (expiredCache) {
                console.warn('[MarketAPI] Using expired cache as fallback');
                this.marketData = expiredCache.marketData;
                // API timestamp is in seconds, convert to milliseconds
                this.lastFetchTimestamp = expiredCache.timestamp * 1000;
                // Load patches from storage
                await this.loadPatches();
                // Show alert when using expired cache
                networkAlert.show('⚠️ Using outdated market data');
                return this.marketData;
            }

            // Total failure - show alert
            console.error('[MarketAPI] ❌ No market data available');
            networkAlert.show('⚠️ Market data unavailable');
            return null;
        }

        /**
         * Fetch from API endpoint
         * @returns {Promise<Object|null>} API response or null
         */
        async fetchFromAPI() {
            try {
                const response = await fetch(this.API_URL);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                // Validate response structure
                if (!data.marketData || typeof data.marketData !== 'object') {
                    throw new Error('Invalid API response structure');
                }

                return data;
            } catch (error) {
                console.error('[MarketAPI] API fetch error:', error);
                throw error;
            }
        }

        /**
         * Get cached data if valid
         * @returns {Promise<Object|null>} { data, timestamp } or null if invalid/expired
         */
        async getCachedData() {
            const cachedTimestamp = await storage.get(this.CACHE_KEY_TIMESTAMP, 'settings', null);
            const cachedData = await storage.getJSON(this.CACHE_KEY_DATA, 'settings', null);

            if (!cachedTimestamp || !cachedData) {
                return null;
            }

            // Check if cache is still valid
            const now = Date.now();
            const age = now - cachedTimestamp;

            if (age > this.CACHE_DURATION) {
                return null;
            }

            return {
                data: cachedData.marketData,
                timestamp: cachedData.timestamp,
            };
        }

        /**
         * Cache market data
         * @param {Object} data - API response to cache
         */
        cacheData(data) {
            storage.setJSON(this.CACHE_KEY_DATA, data, 'settings');
            storage.set(this.CACHE_KEY_TIMESTAMP, Date.now(), 'settings');
        }

        /**
         * Get price for an item
         * @param {string} itemHrid - Item HRID (e.g., "/items/cheese")
         * @param {number} enhancementLevel - Enhancement level (default: 0)
         * @returns {Object|null} { ask: number, bid: number } or null if not found
         */
        getPrice(itemHrid, enhancementLevel = 0) {
            const normalizeMarketPriceValue = (value) => {
                if (typeof value !== 'number') {
                    return null;
                }

                if (value < 0) {
                    return null;
                }

                return value;
            };

            // Check for fresh patch first
            const patchKey = `${itemHrid}:${enhancementLevel}`;
            const patch = this.pricePatchs[patchKey];

            if (patch && patch.timestamp > this.lastFetchTimestamp) {
                // Patch is fresher than API data - use it
                return {
                    ask: normalizeMarketPriceValue(patch.a),
                    bid: normalizeMarketPriceValue(patch.b),
                };
            }

            // Fall back to API data
            if (!this.marketData) {
                console.warn('[MarketAPI] ⚠️ No market data available');
                return null;
            }

            const priceData = this.marketData[itemHrid];

            if (!priceData || typeof priceData !== 'object') {
                // Item not in market data at all
                return null;
            }

            // Market data is organized by enhancement level
            // { 0: { a: 1000, b: 900 }, 2: { a: 5000, b: 4500 }, ... }
            const price = priceData[enhancementLevel];

            if (!price) {
                // No price data for this enhancement level
                return null;
            }

            return {
                ask: normalizeMarketPriceValue(price.a), // Sell price
                bid: normalizeMarketPriceValue(price.b), // Buy price
            };
        }

        /**
         * Get prices for multiple items
         * @param {string[]} itemHrids - Array of item HRIDs
         * @returns {Map<string, Object>} Map of HRID -> { ask, bid }
         */
        getPrices(itemHrids) {
            const prices = new Map();

            for (const hrid of itemHrids) {
                const price = this.getPrice(hrid);
                if (price) {
                    prices.set(hrid, price);
                }
            }

            return prices;
        }

        /**
         * Get prices for multiple items with enhancement levels (batch optimized)
         * @param {Array<{itemHrid: string, enhancementLevel: number}>} items - Array of items with enhancement levels
         * @returns {Map<string, Object>} Map of "hrid:level" -> { ask, bid }
         */
        getPricesBatch(items) {
            const priceMap = new Map();

            for (const { itemHrid, enhancementLevel = 0 } of items) {
                const key = `${itemHrid}:${enhancementLevel}`;
                if (!priceMap.has(key)) {
                    const price = this.getPrice(itemHrid, enhancementLevel);
                    if (price) {
                        priceMap.set(key, price);
                    }
                }
            }

            return priceMap;
        }

        /**
         * Check if market data is loaded
         * @returns {boolean} True if data is available
         */
        isLoaded() {
            return this.marketData !== null;
        }

        /**
         * Get age of current data in milliseconds
         * @returns {number|null} Age in ms or null if no data
         */
        getDataAge() {
            if (!this.lastFetchTimestamp) {
                return null;
            }

            return Date.now() - this.lastFetchTimestamp;
        }

        /**
         * Log an error
         * @param {string} message - Error message
         * @param {Error} error - Error object
         */
        logError(message, error) {
            const errorEntry = {
                timestamp: new Date().toISOString(),
                message,
                error: error?.message || String(error),
            };

            this.errorLog.push(errorEntry);
            console.error(`[MarketAPI] ${message}:`, error);
        }

        /**
         * Get error log
         * @returns {Array} Array of error entries
         */
        getErrors() {
            return [...this.errorLog];
        }

        /**
         * Clear error log
         */
        clearErrors() {
            this.errorLog = [];
        }

        /**
         * Update price from order book data (fresher than API)
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         * @param {number|null} ask - Top ask price (null if no asks)
         * @param {number|null} bid - Top bid price (null if no bids)
         */
        updatePrice(itemHrid, enhancementLevel, ask, bid) {
            const key = `${itemHrid}:${enhancementLevel}`;

            this.pricePatchs[key] = {
                a: ask,
                b: bid,
                timestamp: Date.now(),
            };

            // Save patches to storage (debounced via storage module)
            this.savePatches();

            // Notify listeners of price update
            this.notifyListeners();
        }

        /**
         * Load price patches from storage
         */
        async loadPatches() {
            try {
                // Check migration version - clear patches if old version
                const migrationVersion = await storage.get(this.CACHE_KEY_MIGRATION, 'settings', 0);

                if (migrationVersion < this.CURRENT_MIGRATION_VERSION) {
                    console.log(
                        `[MarketAPI] Migrating price patches from v${migrationVersion} to v${this.CURRENT_MIGRATION_VERSION}`
                    );
                    // Clear old patches (they may have corrupted data)
                    this.pricePatchs = {};
                    await storage.set(this.CACHE_KEY_PATCHES, {}, 'settings');
                    await storage.set(this.CACHE_KEY_MIGRATION, this.CURRENT_MIGRATION_VERSION, 'settings');
                    console.log('[MarketAPI] Price patches cleared due to migration');
                    return;
                }

                // Load patches normally
                const patches = await storage.getJSON(this.CACHE_KEY_PATCHES, 'settings', {});
                this.pricePatchs = patches || {};

                // Purge stale patches (older than API data)
                this.purgeStalePatches();
            } catch (error) {
                console.error('[MarketAPI] Failed to load price patches:', error);
                this.pricePatchs = {};
            }
        }

        /**
         * Remove patches older than the current API data
         * Called after loadPatches() to clean up stale patches
         */
        purgeStalePatches() {
            if (!this.lastFetchTimestamp) {
                return; // No API data loaded yet
            }

            let purgedCount = 0;
            const keysToDelete = [];

            for (const [key, patch] of Object.entries(this.pricePatchs)) {
                // Check for corrupted/invalid patches or stale timestamps
                if (!patch || !patch.timestamp || patch.timestamp < this.lastFetchTimestamp) {
                    keysToDelete.push(key);
                    purgedCount++;
                }
            }

            // Remove stale patches
            for (const key of keysToDelete) {
                delete this.pricePatchs[key];
            }

            if (purgedCount > 0) {
                console.log(`[MarketAPI] Purged ${purgedCount} stale price patches`);
                // Save cleaned patches
                this.savePatches();
            }
        }

        /**
         * Save price patches to storage
         */
        savePatches() {
            storage.setJSON(this.CACHE_KEY_PATCHES, this.pricePatchs, 'settings', true);
        }

        /**
         * Clear cache and fetch fresh market data
         * @returns {Promise<Object|null>} Fresh market data or null if failed
         */
        async clearCacheAndRefetch() {
            // Clear storage cache
            await storage.delete(this.CACHE_KEY_DATA, 'settings');
            await storage.delete(this.CACHE_KEY_TIMESTAMP, 'settings');

            // Clear in-memory state
            this.marketData = null;
            this.lastFetchTimestamp = null;

            // Force fresh fetch
            return await this.fetch(true);
        }

        /**
         * Register a listener for price updates
         * @param {Function} callback - Called when prices update
         */
        on(callback) {
            this.listeners.push(callback);
        }

        /**
         * Unregister a listener
         * @param {Function} callback - The callback to remove
         */
        off(callback) {
            this.listeners = this.listeners.filter((cb) => cb !== callback);
        }

        /**
         * Notify all listeners that prices have been updated
         */
        notifyListeners() {
            for (const callback of this.listeners) {
                try {
                    callback();
                } catch (error) {
                    console.error('[MarketAPI] Listener error:', error);
                }
            }
        }
    }

    const marketAPI = new MarketAPI();

    /**
     * Foundation Core Library
     * Core infrastructure and API clients only (no utilities)
     *
     * Exports to: window.Toolasha.Core
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.Core = {
        storage,
        config,
        webSocketHook,
        domObserver,
        dataManager,
        featureRegistry: featureRegistry$1,
        settingsStorage,
        settingsGroups,
        tooltipObserver,
        profileManager: {
            setCurrentProfile,
            getCurrentProfile,
            clearCurrentProfile,
        },
        marketAPI,
        performanceMonitor,
    };

    console.log('[Toolasha] Core library loaded');

})();
