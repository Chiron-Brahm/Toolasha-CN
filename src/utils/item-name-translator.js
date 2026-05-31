/**
 * Auto-discovers Chinese item names from the game DOM and builds a
 * Chinese → English mapping cached in IndexedDB. Provides a unified
 * getDisplayName() returning Chinese when available, English otherwise.
 */

import dataManager from '../core/data-manager.js';
import storage from '../core/storage.js';

const STORAGE_KEY = 'Toolasha_cnItemNames';
const CACHE_VERSION = 2;
const DEBOUNCE_DELAY = 5000;

const MUTATION_SELECTORS = [
    '[class*="Item_name"]',
    '[class*="Item_itemName"]',
    '[class*="ItemTooltipText_name"]',
    '[class*="Item_craftingItemName"]',
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
            const saved = await storage.get(STORAGE_KEY, 'settings');
            // Invalidate old cache versions (v1 didn't have bulk import)
            if (saved && typeof saved === 'object' && saved._version === CACHE_VERSION && Object.keys(saved).length > 1) {
                this.cnNames = saved;
            }
        } catch (error) {
            console.warn('[ItemNameTranslator] Failed to load names:', error);
        }
        this.isLoaded = true;

        // If cache is empty or outdated, try bulk import from game i18n data
        if (Object.keys(this.cnNames).length <= 1) {
            this._bulkImportFromGameI18n();
        }
    }

    _bulkImportFromGameI18n() {
        const initData = dataManager.getInitClientData();
        if (!initData?.itemDetailMap) return;

        // Try to access game's react-i18next instance or translation store
        // The game stores translations; if we can find them, we can map English→Chinese
        let i18nStore = null;

        // Method 1: Check for i18n on window
        try {
            const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            // React i18next stores translations in a global or on the i18n instance
            if (w.i18n?.store?.data?.zh) i18nStore = w.i18n.store.data.zh;
            if (w.i18next?.store?.data?.zh) i18nStore = w.i18next.store.data.zh;
            if (w.__i18n?.store?.data?.zh) i18nStore = w.__i18n.store.data.zh;
        } catch (_) { /* unsafeWindow may not be available */ }

        // Method 2: Walk React fiber tree to find i18n context
        if (!i18nStore) {
            try {
                const rootEl = document.getElementById('root') || document.body.firstElementChild;
                const fiberKey = Object.keys(rootEl).find((k) => k.startsWith('__reactFiber'));
                if (fiberKey) {
                    let fiber = rootEl[fiberKey];
                    for (let i = 0; i < 50 && fiber; i++) {
                        try {
                            const hooks = fiber.memoizedState;
                            let hook = hooks;
                            while (hook) {
                                const val = hook.memoizedState;
                                if (val?.i18n?.store?.data?.zh) {
                                    i18nStore = val.i18n.store.data.zh;
                                    break;
                                }
                                if (val?.store?.data?.zh) {
                                    i18nStore = val.store.data.zh;
                                    break;
                                }
                                hook = hook.next;
                            }
                            if (i18nStore) break;
                        } catch (_) { /* skip broken fibers */ }
                        fiber = fiber.return;
                    }
                }
            } catch (_) { /* fiber walk failed */ }
        }

        if (!i18nStore) {
            console.log('[ItemNameTranslator] Could not find game i18n data, will learn from DOM');
            return;
        }

        // Map English item names → Chinese using the i18n store
        let count = 0;
        for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
            const enName = item.name;
            // Try common i18n key patterns
            const cnName =
                i18nStore[enName] ||
                i18nStore[`items.${enName}`] ||
                i18nStore[enName.toLowerCase()] ||
                i18nStore[enName.replace(/\s+/g, '_').toLowerCase()];
            if (cnName && typeof cnName === 'string' && CJK_REGEX.test(cnName)) {
                this.cnNames[hrid] = cnName;
                count++;
            }
        }

        if (count > 0) {
            console.log(`[ItemNameTranslator] Bulk imported ${count} Chinese item names from game i18n`);
            this._scheduleSave();
        } else {
            console.log('[ItemNameTranslator] Game i18n found but no item names matched, will learn from DOM');
        }
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
                await storage.set(STORAGE_KEY, data, 'settings', true);
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
            storage.set(STORAGE_KEY, data, 'settings', true).catch(() => {});
        }
    }

    _ensureHRIDMaps() {
        const initData = dataManager.getInitClientData();
        if (!initData?.itemDetailMap) {
            this._enToHrid = null;
            this._hridToEn = null;
            return false;
        }
        const source = initData.itemDetailMap;
        if (this._hridToEnSource === source) return true;
        this._enToHrid = new Map();
        this._hridToEn = new Map();
        for (const [hrid, item] of Object.entries(source)) {
            this._enToHrid.set(item.name, hrid);
            this._hridToEn.set(hrid, item.name);
        }
        this._hridToEnSource = source;
        return true;
    }

    findHridFromDomName(domName) {
        if (!domName) return null;
        const baseName = domName.replace(ENHANCEMENT_STRIP_REGEX, '').trim();
        if (!this._ensureHRIDMaps() || !this._enToHrid) return null;

        let hrid = this._enToHrid.get(baseName);
        if (hrid) return hrid;

        const starVariant = baseName.replace(/\s*\(R\)$/g, ' ★');
        hrid = this._enToHrid.get(starVariant);
        if (hrid) return hrid;

        const rVariant = baseName.replace(/\s*★$/g, ' (R)').replace(/\s+/g, ' ').trim();
        hrid = this._enToHrid.get(rVariant);
        if (hrid) return hrid;

        for (const [cachedHrid, cnName] of Object.entries(this.cnNames)) {
            if (cnName === baseName) return cachedHrid;
        }

        return null;
    }

    captureFromDOM(element, itemHrid) {
        if (!element || !itemHrid) return;
        const text = (element.textContent || element.getAttribute('aria-label') || '').trim();
        if (!text) return;
        const baseName = text.replace(ENHANCEMENT_STRIP_REGEX, '').trim();
        if (!baseName) return;

        if (!CJK_REGEX.test(baseName)) return;

        if (this.cnNames[itemHrid] === baseName) return;

        this.cnNames[itemHrid] = baseName;
        this._scheduleSave();
    }

    getDisplayName(itemHrid) {
        const cnName = this.cnNames[itemHrid];
        if (cnName) return cnName;

        const itemDetails = dataManager.getItemDetails(itemHrid);
        if (itemDetails?.name) return itemDetails.name;

        return itemHrid.split('/').pop().replace(/_/g, ' ');
    }

    getHridFromChineseName(chineseName) {
        if (!chineseName) return null;
        const baseName = chineseName.replace(ENHANCEMENT_STRIP_REGEX, '').trim();
        for (const [hrid, cnName] of Object.entries(this.cnNames)) {
            if (cnName === baseName) return hrid;
        }
        return null;
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
        }
    }
}

export const itemNameTranslator = new ItemNameTranslator();
export default itemNameTranslator;
