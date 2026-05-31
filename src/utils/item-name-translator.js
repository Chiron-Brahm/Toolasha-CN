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
        console.log('[ItemNameTranslator] load() called, isLoaded:', this.isLoaded);
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
        try {
            // Method 1: Use game's official API (handles decompression)
            let parsed = null;
            if (typeof localStorageUtil !== 'undefined' && typeof localStorageUtil.getInitClientData === 'function') {
                parsed = localStorageUtil.getInitClientData();
            }
            // Method 2: Try raw JSON parse if not compressed
            if (!parsed) {
                const raw = localStorage.getItem('initClientData');
                if (raw) {
                    try { parsed = JSON.parse(raw); } catch (_) {
                        // Method 3: LZString decompress if available
                        if (typeof LZString !== 'undefined' && LZString.decompressFromUTF16) {
                            parsed = JSON.parse(LZString.decompressFromUTF16(raw));
                        }
                    }
                }
            }
            if (!parsed || !parsed.itemDetailMap) return;

            let count = 0;
            for (const [hrid, item] of Object.entries(parsed.itemDetailMap)) {
                if (item.name && CJK_REGEX.test(item.name) && !this.cnNames[hrid]) {
                    this.cnNames[hrid] = item.name;
                    count++;
                }
            }
            if (count > 0) this._scheduleSave();
        } catch (_) { /* fall back to DOM capture */ }
    }

    getDisplayName(itemHrid) {
        const cnName = this.cnNames[itemHrid];
        if (cnName) return cnName;

        // Trigger one-time DOM scan to capture any available Chinese names
        if (!this._didInitialScan) {
            this._didInitialScan = true;
            this._scanDomNow();
        }

        const freshName = this.cnNames[itemHrid];
        if (freshName) return freshName;

        const itemDetails = dataManager.getItemDetails(itemHrid);
        if (itemDetails?.name) return itemDetails.name;

        return itemHrid.split('/').pop().replace(/_/g, ' ');
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

    _scanDomNow() {
        for (const selector of MUTATION_SELECTORS) {
            for (const el of document.querySelectorAll(selector)) {
                this._tryCaptureFromElement(el);
            }
        }
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
