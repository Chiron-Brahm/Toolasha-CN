/**
 * Self Combat Score Widget
 * Renders combat score breakdown above the inventory grid using self data.
 */
import config from '../../core/config.js';
import dataManager from '../../core/data-manager.js';
import domObserver from '../../core/dom-observer.js';
import { calculateCombatScore } from '../profile/score-calculator.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';
import { t } from '../../core/i18n.js';

const WIDGET_ID = 'mwi-self-combat-score';
const SCORE_FMT = (v) => v.toFixed(1);

const breakdownRow = (item) =>
    `<div style="margin-left: 10px; font-size: 0.8rem; color: ${config.COLOR_TEXT_SECONDARY};">${item.name}: ${item.value}</div>`;

const breakdownHTML = (items) => items.map(breakdownRow).join('');

const makeToggle = (toggleEl, detailsEl, label) => {
    if (!toggleEl || !detailsEl) return;
    const text = (expanded) => `${expanded ? '↓ ' : '+ '}${label}`;
    toggleEl.addEventListener('click', () => {
        const expanded = detailsEl.style.display !== 'none';
        detailsEl.style.display = expanded ? 'none' : 'block';
        toggleEl.textContent = text(expanded);
    });
};

class SelfCombatScore {
    constructor() {
        this.widget = null;
        this.cleanup = createCleanupRegistry();
        this.lastScoreData = null;
        this.refreshTimer = null;
    }

    buildSelfProfileData() {
        const cd = dataManager.characterData;
        return {
            profile: {
                characterHouseRoomMap:
                    cd?.characterHouseRoomMap || Object.fromEntries(dataManager.characterHouseRooms || new Map()),
                equippedAbilities: cd?.equippedAbilities || cd?.characterAbilities || [],
                wearableItemMap: cd?.wearableItemMap || Object.fromEntries(dataManager.characterEquipment || new Map()),
                hideWearableItems: false,
            },
        };
    }

    async refresh() {
        if (!this.widget || !document.body.contains(this.widget)) return;
        const profileData = this.buildSelfProfileData();
        let scoreData;
        try {
            scoreData = await calculateCombatScore(profileData);
        } catch (error) {
            console.error('[SelfCombatScore] Error calculating score:', error);
            return;
        }
        this.lastScoreData = scoreData;
        this.populateWidget(this.widget, scoreData);
    }

    populateWidget(widget, scoreData) {
        const score = SCORE_FMT(scoreData.total);
        const house = SCORE_FMT(scoreData.house);
        const ability = SCORE_FMT(scoreData.ability);
        const equipment = SCORE_FMT(scoreData.equipment);
        const skillerTotal = SCORE_FMT(scoreData.skillerTotal);
        const skillerEquipment = SCORE_FMT(scoreData.skillerEquipment);

        widget.innerHTML = `
            <div style="cursor: pointer; font-weight: bold; color: ${config.COLOR_PROFIT};" id="mwi-self-score-toggle">
                + ${t('Combat Score: {0}', score)}
            </div>
            <div id="mwi-self-score-details" style="display: none; margin-left: 20px;">
                <div>${t('House: {0}', house)}</div>
                <div>${t('Ability: {0}', ability)}</div>
                <div>${t('Equipment: {0}', equipment)}</div>
            </div>
            <div style="cursor: pointer; font-weight: bold; color: ${config.COLOR_PROFIT}; margin-top: 8px;" id="mwi-self-skiller-score-toggle">
                + ${t('Skiller Score: {0}', skillerTotal)}
            </div>
            <div id="mwi-self-skiller-score-details" style="display: none; margin-left: 20px;">
                <div>${t('Equipment: {0}', skillerEquipment)}</div>
            </div>
        `;

        makeToggle(
            widget.querySelector('#mwi-self-score-toggle'),
            widget.querySelector('#mwi-self-score-details'),
            t('Combat Score: {0}', score)
        );
        makeToggle(
            widget.querySelector('#mwi-self-skiller-score-toggle'),
            widget.querySelector('#mwi-self-skiller-score-details'),
            t('Skiller Score: {0}', skillerTotal)
        );
    }

    async renderWidget(inventoryElem) {
        if (!inventoryElem?.parentElement) return;

        if (this.widget && this.widget.nextElementSibling === inventoryElem) {
            await this.refresh();
            return;
        }
        if (this.widget) this.widget.remove();

        const widget = document.createElement('div');
        widget.id = WIDGET_ID;
        widget.style.cssText = `
            background: rgba(30, 30, 30, 0.95);
            border: 1px solid #444;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 8px;
            font-size: 0.875rem;
            color: ${config.COLOR_TEXT_PRIMARY};
        `;
        this.widget = widget;
        inventoryElem.insertAdjacentElement('beforebegin', widget);

        await this.refresh();
    }

    initialize() {
        if (!config.getSetting('selfCombatScore')) return;

        this.cleanup.registerCleanup(
            domObserver.onClass('SelfCombatScore', 'Inventory_items', (elem) => {
                this.renderWidget(elem);
            })
        );
        const existing = document.querySelector('[class*="Inventory_items"]');
        if (existing) this.renderWidget(existing);

        const onItemsUpdated = () => {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = setTimeout(() => this.refresh(), 300);
        };
        dataManager.on('items_updated', onItemsUpdated);
        this.cleanup.registerCleanup(() => dataManager.off('items_updated', onItemsUpdated));
        this.cleanup.registerCleanup(() => clearTimeout(this.refreshTimer));
    }

    disable() {
        this.cleanup.cleanupAll();
        if (this.widget) {
            this.widget.remove();
            this.widget = null;
        }
    }
}

const instance = new SelfCombatScore();
config.onSettingChange('selfCombatScore', (enabled) => (enabled ? instance.initialize() : instance.disable()));
instance.initialize();

export default instance;
