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
        (child) => !child.hasAttribute('data-mwi-custom-tab') && !child.classList.contains('toolasha-inv-tab')
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

// Chinese monster name mapping (sprite name → Chinese)
const CN_MONSTER_NAMES = {
    fly: '苍蝇',
    rat: '杰瑞',
    skunk: '臭鼬',
    porcupine: '豪猪',
    slimy: '史莱姆',
    smelly_planet: '臭臭星球',
    frog: '青蛙',
    snake: '蛇',
    swampy: '沼泽虫',
    alligator: '夏洛克',
    swamp_planet: '沼泽星球',
    sea_snail: '蜗牛',
    crab: '螃蟹',
    aquahorse: '水马',
    nom_nom: '咬咬鱼',
    turtle: '忍者龟',
    aqua_planet: '海洋星球',
    jungle_sprite: '丛林精灵',
    myconid: '蘑菇人',
    treant: '树人',
    centaur_archer: '半人马弓箭手',
    jungle_planet: '丛林星球',
    gobo_stabby: '刺刺',
    gobo_slashy: '砍砍',
    gobo_smashy: '锤锤',
    gobo_shooty: '咻咻',
    gobo_boomy: '轰轰',
    gobo_planet: '哥布林星球',
    eye: '独眼',
    eyes: '叠眼',
    veyes: '复眼',
    planet_of_the_eyes: '眼球星球',
    novice_sorcerer: '新手巫师',
    ice_sorcerer: '冰霜巫师',
    flame_sorcerer: '火焰巫师',
    elementalist: '元素法师',
    sorcerers_tower: '巫师之塔',
    gummy_bear: '软糖熊',
    panda: '熊猫',
    black_bear: '黑熊',
    grizzly_bear: '棕熊',
    polar_bear: '北极熊',
    bear_with_it: '熊熊星球',
    magnetic_golem: '磁力魔像',
    stalactite_golem: '钟乳石魔像',
    granite_golem: '花岗岩魔像',
    golem_cave: '魔像洞穴',
    zombie: '僵尸',
    vampire: '吸血鬼',
    werewolf: '狼人',
    twilight_zone: '暮光之地',
    abyssal_imp: '深渊小鬼',
    soul_hunter: '灵魂猎手',
    infernal_warlock: '地狱术士',
    infernal_abyss: '地狱深渊',
    chimerical_den: '奇幻洞穴',
    sinister_circus: '阴森马戏团',
    enchanted_fortress: '秘法要塞',
    pirate_cove: '海盗基地',
    // House rooms
    'Archery Range': '射箭场',
    Armory: '军械库',
    Brewery: '冲泡坊',
    'Dairy Barn': '奶牛棚',
    'Dining Room': '餐厅',
    Dojo: '道场',
    Forge: '锻造间',
    Garden: '花园',
    Gym: '健身房',
    Kitchen: '厨房',
    Laboratory: '实验室',
    Library: '图书馆',
    'Log Shed': '木棚',
    'Mystical Study': '神秘研究室',
    Observatory: '天文台',
    'Sewing Parlor': '缝纫室',
    Workshop: '工作间',
};

export function getMonsterDisplayName(monsterHrid) {
    const spriteName = monsterHrid.split('/').pop();
    return CN_MONSTER_NAMES[spriteName] || spriteName;
}

// Chinese zone name mapping (from game's official Chinese translation)
const CN_ZONE_NAMES = {
    // Non-dungeon zones
    Farmlands: '农田',
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
