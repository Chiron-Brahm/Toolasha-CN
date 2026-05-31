/**
 * Locale-safe DOM matching utilities for game UI interactions.
 * All functions use CSS classes, data attributes, or structural positions
 * instead of textContent matching, which breaks when the game is in Chinese.
 */

/**
 * Check if a tabs container belongs to the marketplace panel.
 * Uses the panel's CSS module class (partial match for hash stability).
 *
 * @param {Element} tablistContainer - A tablist container element
 * @returns {boolean} True if the container is part of the marketplace panel
 */
export function isMarketplacePanel(tablistContainer) {
    return !!tablistContainer.closest('[class*="MarketplacePanel_marketplacePanel"]');
}

/**
 * Get the "My Listings" tab from a marketplace tablist.
 * "My Listings" tab is at index 1 in the marketplace MUI tab bar.
 * Index 0 = search/filter tab (verified via the panel detection above).
 *
 * @param {Element} tablist - The marketplace tablist element
 * @returns {Element|null} The "My Listings" tab element, or null if not found
 */
export function getMyListingsTab(tablist) {
    const children = Array.from(tablist.children);
    return children[1] || null;
}

/**
 * Check if a tablist belongs to the alchemy action panel.
 *
 * @param {Element} tablist - A tablist element to check
 * @returns {boolean} True if the tablist belongs to the alchemy panel
 */
export function isAlchemyPanel(tablist) {
    return (
        !!tablist.closest('[class*="SkillActionDetail_skillActionDetail"]') &&
        !!tablist.closest('[class*="AlchemyPanel_"]')
    );
}

/**
 * Get an alchemy tab by its known position.
 * Alchemy tabs order: [Coinify=0, Transmute=1, Decompose=2]
 *
 * @param {Element} tablist - The alchemy tablist element
 * @param {number} positionIndex - The zero-based position index of the desired tab
 * @returns {Element|null} The tab element at the given position, or null
 */
export function getAlchemyTab(tablist, positionIndex) {
    const children = Array.from(tablist.children);
    return children[positionIndex] || null;
}

/**
 * Get the Inventory tab from the character panel tab bar.
 * The Inventory tab is always at index 0 in the [role="tablist"][aria-label="character tabs"].
 *
 * @returns {Element|null} The Inventory tab element, or null if not found
 */
export function findInventoryTab() {
    const tablist = document.querySelector('.MuiTabs-root [role="tablist"]');
    if (!tablist) return null;
    return tablist.children[0] || null;
}

/**
 * Get enhancing panel input fields by their structural position.
 * Enhancing panel inputs: [Repeat count, Target Level, Protect From Level]
 *
 * @param {Element} panel - The enhancing panel DOM element
 * @returns {HTMLElement[]} Array of number input elements
 */
export function getEnhancingInputs(panel) {
    return Array.from(panel.querySelectorAll('input[type="number"]'));
}

/**
 * Get a guild table column element by its known stable position.
 *
 * @param {Element} theadRow - The thead row element
 * @param {number} columnIndex - The zero-based column index
 * @returns {Element|null} The column element at the given index, or null
 */
export function getGuildTableColumn(theadRow, columnIndex) {
    return theadRow.children[columnIndex] || null;
}
