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
            }
        );
        this.cleanupRegistry.registerCleanup(unregisterModal);
    }

    /**
     * Handle house modal appearing
     * @param {Element} modalContent - The house panel modal content element
     */
    async handleHouseModal(modalContent) {
        console.log('[HouseDebug] Modal detected via domObserver');

        // Wait a moment for content to fully load
        await new Promise((resolve) => {
            const loadTimeout = setTimeout(resolve, 100);
            this.cleanupRegistry.registerTimeout(loadTimeout);
        });

        // Modal shows one room at a time, not a grid
        // Process the currently displayed room
        await this.processModalContent(modalContent);

        // Set up observer for room switching
        this.observeModalChanges(modalContent);
    }

    /**
     * Process the modal content (single room display)
     * @param {Element} modalContent - The house panel modal content
     */
    async processModalContent(modalContent) {
        // Identify which room is currently displayed
        const houseRoomHrid = this.identifyRoomFromModal(modalContent);

        if (!houseRoomHrid) {
            console.warn('[HouseDebug] identifyRoomFromModal returned null');
            return;
        }
        console.log('[HouseDebug] Room identified:', houseRoomHrid);

        // Find the costs section to add our column
        const costsSection = modalContent.querySelector('[class*="HousePanel_costs"]');

        if (!costsSection) {
            console.warn('[HouseDebug] costsSection not found');
            return;
        }
        console.log('[HouseDebug] costsSection found, adding cost column');

        // Add our cost display as a column
        await houseCostDisplay.addCostColumn(costsSection, houseRoomHrid, modalContent);
    }

    /**
     * Identify house room HRID from modal header
     * @param {Element} modalContent - The modal content element
     * @returns {string|null} House room HRID
     */
    identifyRoomFromModal(modalContent) {
        const header = modalContent.querySelector('[class*="HousePanel_header"]');

        // Try to find the room image/icon and extract room ID from its src
        const headerImg = header?.querySelector('img');
        const allSvgs = header?.querySelectorAll('svg');
        console.log('[HouseDebug] Header img src:', headerImg?.getAttribute('src'));
        allSvgs?.forEach((s, i) => {
            const use = s.querySelector('use');
            console.log(`[HouseDebug] SVG[${i}] use href:`, use?.getAttribute('href'));
        });

        // Primary: extract room ID from SVG sprite href
        const svgUse = modalContent.querySelector('[class*="HousePanel_header"] svg use');
        if (svgUse) {
            const hrefValue = svgUse.getAttribute('href') || '';
            const roomId = hrefValue.split('#')[1];
            if (roomId) {
                console.log('[HouseDebug] Room identified via SVG:', roomId);
                return `/house_rooms/${roomId}`;
            }
        }

        // Fallback: match header text against game data room names
        const initData = dataManager.getInitClientData();
        if (initData?.houseRoomDetailMap) {
            const roomName = header?.textContent?.trim();
            console.log('[HouseDebug] Header text:', JSON.stringify(roomName));
            if (roomName) {
                for (const [hrid, roomData] of Object.entries(initData.houseRoomDetailMap)) {
                    if (roomData.name === roomName) {
                        console.log('[HouseDebug] Room identified via text match:', hrid);
                        return hrid;
                    }
                }
                console.warn('[HouseDebug] No room matched header text. Game has English names, UI is Chinese.');
            }
        }

        return null;
    }
        }

        // Fallback: match header text against game data room names
        const initData = dataManager.getInitClientData();
        const hasRoomMap = !!(initData?.houseRoomDetailMap);
        console.log('[HouseDebug] Game data houseRoomDetailMap available:', hasRoomMap);
        if (initData?.houseRoomDetailMap) {
            const header = modalContent.querySelector('[class*="HousePanel_header"]');
            const roomName = header?.textContent?.trim();
            console.log('[HouseDebug] Header text:', JSON.stringify(roomName));
            if (roomName) {
                const allRoomNames = Object.entries(initData.houseRoomDetailMap).map(([h, r]) => `${h}:${r.name}`);
                console.log('[HouseDebug] Available rooms:', allRoomNames);
                for (const [hrid, roomData] of Object.entries(initData.houseRoomDetailMap)) {
                    if (roomData.name === roomName) {
                        console.log('[HouseDebug] Room identified via text match:', hrid);
                        return hrid;
                    }
                }
                console.warn('[HouseDebug] No room matched header text');
            }
        }

        console.warn('[HouseDebug] All identification methods failed');
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
            }
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
