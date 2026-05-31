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
        // Try to fetch game's i18n translation JSON from server
        const urls = [
            '/locales/zh-CN/translation.json',
            '/locales/zh/translation.json',
            '/i18n/zh.json',
        ];
        const tryFetch = (index) => {
            if (index >= urls.length) return;
            const xhr = new XMLHttpRequest();
            xhr.open('GET', urls[index]);
            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data && typeof data === 'object') {
                            const initData = dataManager.getInitClientData();
                            if (initData?.itemDetailMap) {
                                let count = 0;
                                for (const [hrid, item] of Object.entries(initData.itemDetailMap)) {
                                    const cnName = data[item.name] || data[item.name.toLowerCase()];
                                    if (cnName && typeof cnName === 'string' && CJK_REGEX.test(cnName) && !this.cnNames[hrid]) {
                                        this.cnNames[hrid] = cnName;
                                        count++;
                                    }
                                }
                                if (count > 0) this._scheduleSave();
                            }
                        }
                    } catch (_) { tryFetch(index + 1); }
                } else { tryFetch(index + 1); }
            };
            xhr.onerror = () => tryFetch(index + 1);
            xhr.send();
        };
        tryFetch(0);
    }

    getDisplayName(itemHrid) {
        // 1. Direct cache hit
        const cnName = this.cnNames[itemHrid];
        if (cnName) return cnName;

        // 2. Active lookup: find this item's SVG in the DOM and capture its Chinese aria-label
        const spriteId = itemHrid.split('/').pop();
        const svg = document.querySelector(`svg use[href$="#${spriteId}"]`)?.closest('svg');
        if (svg) {
            const ariaLabel = svg.getAttribute('aria-label');
            if (ariaLabel && CJK_REGEX.test(ariaLabel)) {
                this.cnNames[itemHrid] = ariaLabel;
                this._scheduleSave();
                return ariaLabel;
            }
        }

        // 3. One-time DOM scan
        if (!this._didInitialScan) {
            this._didInitialScan = true;
            this._scanDomNow();
            const fresh = this.cnNames[itemHrid];
            if (fresh) return fresh;
        }

        // 4. Fallback to English
        const enName = dataManager.getItemDetails(itemHrid)?.name;
        if (enName) return enName;
        return itemHrid.split('/').pop().replace(/_/g, ' ');
    }

    _tryCaptureFromElement(el) {
        if (!el) return;
        const text = (el.textContent || el.getAttribute('aria-label') || '').trim();
        if (!text || !CJK_REGEX.test(text)) return;
        // Strip parenthetical quantities like "(10个)" or "(10)"
        const baseName = text.replace(ENHANCEMENT_STRIP_REGEX, '').replace(/\s*\(\d+个?\)\s*$/, '').trim();
        if (!baseName) return;

        // Already cached
        for (const cnName of Object.values(this.cnNames)) {
            if (cnName === baseName) return;
        }

        // Method 1: Extract HRID from SVG sprite href
        const svg = el.closest('svg') || el.querySelector('svg');
        if (svg) {
            const use = svg.querySelector('use');
            if (use) {
                const href = use.getAttribute('href') || '';
                const spriteName = href.split('#').pop();
                if (spriteName) {
                    const hrid = `/items/${spriteName}`;
                    if (dataManager.getItemDetails(hrid)) {
                        this.cnNames[hrid] = baseName;
                        this._scheduleSave();
                        return;
                    }
                }
            }
            // Method 2: Try aria-label → item name lookup in game data
            const ariaLabel = svg.getAttribute('aria-label') || '';
            if (ariaLabel) {
                this._ensureHRIDMaps();
                if (this._enToHrid) {
                    for (const [enName, hrid] of this._enToHrid) {
                        // Try fuzzy: CN text might match English name parts
                        const enLower = enName.toLowerCase().replace(/\s+/g, ' ');
                        const cnLower = baseName.toLowerCase();
                        if (enLower === cnLower || enLower.includes(cnLower) || cnLower.includes(enLower)) {
                            continue; // no match - different languages
                        }
                        // Try matching by word count heuristic
                        const enWords = enLower.split(/\s+/);
                        if (enWords.length >= 2 && cnLower.length >= 2) {
                            // Skip - can't match with just heuristic
                        }
                    }
                }
            }
        }

        // Method 3: Try existing English name lookup
        const hrid = this.findHridFromDomName(baseName);
        if (hrid) {
            this.cnNames[hrid] = baseName;
            this._scheduleSave();
            return;
        }

        // Method 4: Fuzzy match against all game data item names
        // For items without SVG use elements (coins, teas, bags)
        this._ensureHRIDMaps();
        if (this._enToHrid && this._hridToEn) {
            for (const [h, enName] of this._hridToEn) {
                if (enName === baseName) { this.cnNames[h] = baseName; this._scheduleSave(); return; }
            }
            // No exact English match - this is expected for Chinese names with no sprite
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

        // 1. Direct English name match
        let hrid = this._enToHrid.get(baseName);
        if (hrid) return hrid;
        // ★ / (R) variants
        const starVariant = baseName.replace(/\s*\(R\)$/g, ' ★');
        hrid = this._enToHrid.get(starVariant);
        if (hrid) return hrid;
        const rVariant = baseName.replace(/\s*★$/g, ' (R)').replace(/\s+/g, ' ').trim();
        hrid = this._enToHrid.get(rVariant);
        if (hrid) return hrid;

        // 2. Check cached Chinese names
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
        console.log('[ItemNameTranslator] Observer starting, selectors:', MUTATION_SELECTORS);

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

export const itemNameTranslator = new ItemNameTranslator();
export default itemNameTranslator;
