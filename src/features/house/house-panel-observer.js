/**
 * House Panel Observer
 * Detects house upgrade modal and injects cost displays
 */

import domObserver from '../../core/dom-observer.js';
import houseCostCalculator from './house-cost-calculator.js';
import houseCostDisplay from './house-cost-display.js';
import dataManager from '../../core/data-manager.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';

class HousePanelObserver {
    constructor() {
        this.isActive = false;
        this.cleanupRegistry = createCleanupRegistry();
        this.processedCards = new WeakSet();
    }

    /**
     * Initialize the observer
     */
    async initialize() {
        if (this.isActive) return;

        // Initialize calculator
        await houseCostCalculator.initialize();

        // Initialize display
        houseCostDisplay.initialize();

        // Register modal observer
        this.registerObservers();

        this.isActive = true;
    }

    /**
     * Register DOM observers
     */
    registerObservers() {
        // Watch for house modal appearing
        const unregisterModal = domObserver.onClass(
            'HousePanelObserver-Modal',
            'HousePanel_modalContent',
            (modalContent) => {
                this.handleHouseModal(modalContent);
            },
            { debounce: true, debounceDelay: 150 }
        );
        this.cleanupRegistry.registerCleanup(unregisterModal);
    }

    /**
     * Handle house modal appearing
     * @param {Element} modalContent - The house panel modal content element
     */
    async handleHouseModal(modalContent) {
        // Wait a moment for content to fully load
        await new Promise((resolve) => {
            const loadTimeout = setTimeout(resolve, 100);
            this.cleanupRegistry.registerTimeout(loadTimeout);
        });

        await this.processModalContent(modalContent);
        this.observeModalChanges(modalContent);
    }

    /**
     * Process the modal content (single room display)
     * @param {Element} modalContent - The house panel modal content
     */
    async processModalContent(modalContent) {
        const houseRoomHrid = this.identifyRoomFromModal(modalContent);
        if (!houseRoomHrid) return;

        const costsSection = modalContent.querySelector('[class*="HousePanel_costs"]');
        if (!costsSection) return;

        await houseCostDisplay.addCostColumn(costsSection, houseRoomHrid, modalContent);
    }

    /**
     * Identify house room HRID from modal header
     * @param {Element} modalContent - The modal content element
     * @returns {string|null} House room HRID
     */
    identifyRoomFromModal(modalContent) {
        // Chinese → HRID mapping (game data stores English names, UI shows Chinese)
        const CN_ROOM_MAP = {
            射箭场: '/house_rooms/archery_range',
            军械库: '/house_rooms/armory',
            冲泡坊: '/house_rooms/brewery',
            奶牛棚: '/house_rooms/dairy_barn',
            餐厅: '/house_rooms/dining_room',
            道场: '/house_rooms/dojo',
            锻造间: '/house_rooms/forge',
            花园: '/house_rooms/garden',
            健身房: '/house_rooms/gym',
            厨房: '/house_rooms/kitchen',
            实验室: '/house_rooms/laboratory',
            图书馆: '/house_rooms/library',
            木棚: '/house_rooms/log_shed',
            神秘研究室: '/house_rooms/mystical_study',
            天文台: '/house_rooms/observatory',
            缝纫室: '/house_rooms/sewing_parlor',
            工作间: '/house_rooms/workshop',
        };

        const header = modalContent.querySelector('[class*="HousePanel_header"]');
        const roomName = header?.textContent?.trim();
        if (roomName && CN_ROOM_MAP[roomName]) {
            return CN_ROOM_MAP[roomName];
        }

        // Fallback: match against English game data names
        const initData = dataManager.getInitClientData();
        if (initData?.houseRoomDetailMap && roomName) {
            for (const [hrid, roomData] of Object.entries(initData.houseRoomDetailMap)) {
                if (roomData.name === roomName) return hrid;
            }
        }

        console.warn('[HouseDebug] Room not found:', roomName);
        return null;
    }

    /**
     * Observe modal for room switching
     * @param {Element} modalContent - The house panel modal content
     */
    observeModalChanges(modalContent) {
        const observer = createMutationWatcher(
            modalContent,
            (mutations) => {
                // Check if header changed (indicates room switch)
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' || mutation.type === 'characterData') {
                        const header = modalContent.querySelector('[class*="HousePanel_header"]');
                        if (header && mutation.target.contains(header)) {
                            // Room switched, reprocess
                            this.processModalContent(modalContent);
                            break;
                        }
                    }
                }
            },
            {
                childList: true,
                subtree: true,
                characterData: true,
            },
            { debounce: true, debounceDelay: 150 }
        );
        this.cleanupRegistry.registerCleanup(observer);
    }

    /**
     * Disable the observer
     */
    disable() {
        this.cleanup();
    }

    /**
     * Clean up observers
     */
    cleanup() {
        this.cleanupRegistry.cleanupAll();
        this.cleanupRegistry = createCleanupRegistry();
        this.processedCards = new WeakSet();
        this.isActive = false;
    }
}

const housePanelObserver = new HousePanelObserver();

export default housePanelObserver;
