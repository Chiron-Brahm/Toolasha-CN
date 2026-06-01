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
    // Skip non-native tabs (Toolasha inventory tabs, missing material tabs)
    // to find the second native marketplace tab
    const nativeTabs = Array.from(tablist.children).filter(
        (child) =>
            !child.hasAttribute('data-mwi-custom-tab') &&
            !child.classList.contains('toolasha-inv-tab')
    );
    return nativeTabs[1] || null;
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

// Chinese zone name mapping (from game's official Chinese translation)
const CN_ZONE_NAMES = {
    // Non-dungeon zones
    'Farmlands': '农田',
    'Autumn Fields': '秋田',
    'Quiet Valley': '幽谷',
    'Misty Marsh': '雾沼',
    'Sunset Forest': '落日森林',
    'Frozen Tundra': '冰原',
    'Volcanic Crater': '火山口',
    'Stormy Highlands': '风暴高地',
    'Abandoned Mines': '废弃矿洞',
    'Ancient Ruins': '远古遗迹',
    'Enchanted Meadow': '魔法草地',
    'Cursed Swamp': '诅咒沼泽',
    'Dark Cavern': '暗黑洞穴',
    'Infernal Abyss': '地狱',
    'Celestial Peak': '天界之巅',
    'Ethereal Realm': '虚空领域',
    // Dungeons (prefix [D])
    'Abandoned Docks': '废弃码头',
    'Abandoned Warehouse': '废弃仓库',
    'Arachnid Lair': '蜘蛛巢穴',
    'Bandits Hideout': '强盗藏身处',
    'Crystal Cavern': '水晶洞穴',
    'Dark Temple': '暗黑神殿',
    'Desecrated Monastery': '亵渎修道院',
    'Frozen Pass': '冰封山道',
    'Goblin Fortress': '哥布林要塞',
    'Haunted Castle': '幽灵城堡',
    'Lava Palace': '熔岩宫殿',
    'Shadow Tower': '暗影之塔',
    'Sunken Temple': '沉没神殿',
    'Thieves Guild': '盗贼公会',
    'Undead Crypt': '亡灵地窖',
    'Vampire Mansion': '吸血鬼庄园',
    'Werewolf Den': '狼人洞穴',
};

export function getZoneDisplayName(zone) {
    return CN_ZONE_NAMES[zone.name] || zone.name;
}
