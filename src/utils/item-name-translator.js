/**
 * Auto-discovers Chinese item names from the game DOM and builds a
 * Chinese → English mapping cached in IndexedDB. Provides a unified
 * getDisplayName() returning Chinese when available, English otherwise.
 */

import dataManager from '../core/data-manager.js';
import storage from '../core/storage.js';
import itemNamesZh from './item-names-zh.js';
import abilityNamesZh from './ability-names-zh.js';

const STORAGE_KEY = 'Toolasha_cnItemNames';
const CACHE_VERSION = 2;
const DEBOUNCE_DELAY = 5000;

const MUTATION_SELECTORS = [
    '[class*="Item_name"]',
    '[class*="Item_itemName"]',
    '[class*="ItemTooltipText_name"]',
    '[class*="Item_craftingItemName"]',
    'svg[aria-label]',
    '[class*="Ability_"][class*="name"]',
    '[class*="AbilitiesPanel_"]',
    '[class*="SkillActionDetail_"]',
    '[class*="CombatPanel_"]',
    '[class*="SimEditor_"]',
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
            if (
                saved &&
                typeof saved === 'object' &&
                saved._version === CACHE_VERSION &&
                Object.keys(saved).length > 1
            ) {
                this.cnNames = saved;
            }
        } catch {
            /* ignore */
        }
        this.isLoaded = true;

        // Bulk import from static Chinese name mapping (Edible Tools translations)
        if (Object.keys(this.cnNames).length <= 1) {
            this._importStaticMapping();
        }
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
        const initData = dataManager.getInitClientData();
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

    getDisplayName(itemHrid) {
        if (!itemHrid) return '';
        if (!this.isLoaded) this._lazyLoad();

        const cached = this.cnNames[itemHrid];
        if (cached) return cached;

        const item = dataManager.getItemDetails(itemHrid);
        const enName = item?.name;
        if (enName) {
            const staticCn = itemNamesZh[enName];
            if (staticCn) {
                this.cnNames[itemHrid] = staticCn;
                return staticCn;
            }
            return enName;
        }

        const ability = this._getAbilityDetails(itemHrid);
        if (ability?.name) {
            const staticCn = itemNamesZh[ability.name] || abilityNamesZh[ability.name];
            if (staticCn) {
                this.cnNames[itemHrid] = staticCn;
                return staticCn;
            }
            return ability.name;
        }

        return itemHrid;
    }

    _getAbilityDetails(abilityHrid) {
        if (!abilityHrid || !abilityHrid.startsWith('/abilities/')) return null;
        try {
            const initData = dataManager.getInitClientData();
            return initData?.abilityDetailMap?.[abilityHrid] || null;
        } catch (e) {
            return null;
        }
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
                    } catch {
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
