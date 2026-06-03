#!/usr/bin/env node

/**
 * Extract all monster names from the game's combat data.
 *
 * Usage: copy and paste the SCRIPT below into DevTools console
 * while playing Milky Way Idle (Chinese UI), then paste the
 * output into src/utils/monster-names-zh.js.
 *
 * The script reads from `window.Toolasha` if available, or scans
 * the global scope for the combat data.
 */

// =============================================================
// STEP 1: Run this in DevTools console (F12 → Console tab)
// =============================================================
const SCRIPT = `
(async () => {
  // Try multiple ways to find the game data
  let combatData = null;

  // 1. Try window dataManager (Toolasha exposes this)
  try {
    if (window.dataManager?.initClientData?.combatMonsterDetailMap) {
      combatData = window.dataManager.initClientData.combatMonsterDetailMap;
    }
  } catch (e) {}

  // 2. Try finding via the game's React internals (most reliable)
  if (!combatData) {
    const root = document.querySelector('#root') || document.body;
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
    if (key) {
      const fiber = root[key].stateNode.current;
      const findCombatData = (fiber, depth = 0) => {
        if (!fiber || depth > 50) return null;
        if (fiber.memoizedState && typeof fiber.memoizedState === 'object') {
          const state = fiber.memoizedState;
          for (const k in state) {
            if (state[k]?.combatMonsterDetailMap) return state[k];
          }
        }
        if (fiber.stateNode?.stateNode?.props?.value?.combatMonsterDetailMap) {
          return fiber.stateNode.stateNode.props.value;
        }
        return findCombatData(fiber.child, depth + 1) || findCombatData(fiber.sibling, depth + 1);
      };
      const found = findCombatData(fiber);
      if (found?.combatMonsterDetailMap) combatData = found.combatMonsterDetailMap;
    }
  }

  // 3. Try scanning window for any object with combatMonsterDetailMap
  if (!combatData) {
    for (const key of Object.keys(window)) {
      try {
        if (window[key]?.combatMonsterDetailMap) {
          combatData = window[key].combatMonsterDetailMap;
          break;
        }
      } catch (e) {}
    }
  }

  if (!combatData) {
    console.error('❌ Could not find combat data. Make sure you are in the game.');
    return;
  }

  // Build the map: English name -> Chinese name
  // We need to find the Chinese name from somewhere. Options:
  // 1. The game has a separate i18n layer — check window.__INITIAL_STATE__ or similar
  // 2. Walk the game's monster UI to extract Chinese names
  // 3. Just dump English names and have the user translate them

  // First, try to find Chinese name from the DOM (if a monster is currently visible)
  // Look for elements with class containing 'Combat_monster' or similar
  const allMonsterElems = document.querySelectorAll('[class*="Combat_monster"], [class*="Monster_name"]');
  const cnNameMap = {};
  for (const elem of allMonsterElems) {
    const text = elem.textContent?.trim();
    if (text) {
      // Try to match by looking at siblings or parents for context
      cnNameMap[text] = text; // Self-reference; user will refine
    }
  }

  // Build the export-ready object
  const result = {};
  for (const [hrid, monster] of Object.entries(combatData)) {
    result[monster.name] = '';
  }

  // Format as ES module export
  const formatted = 'export default ' + JSON.stringify(result, null, 4) + ';';

  console.log('\\n=== COPY THE BLOCK BELOW INTO src/utils/monster-names-zh.js ===');
  console.log('\\n' + formatted);
  console.log('\\n=== END ===');
  console.log('\\n📋 ' + Object.keys(result).length + ' monster names found. Translate the empty Chinese values, then commit.');

  // Also output as a copy-to-clipboard convenience
  try {
    await navigator.clipboard.writeText(formatted);
    console.log('\\n✅ Copied to clipboard!');
  } catch (e) {
    console.log('\\n⚠️ Could not copy automatically. Please copy manually from the output above.');
  }

  return result;
})();
`;

console.log('==================================================');
console.log('MONSTER EXTRACT — STEP 1');
console.log('==================================================');
console.log('Copy the script below and paste it into your');
console.log("browser's DevTools console (F12) while playing");
console.log('Milky Way Idle in Chinese. Then paste the output');
console.log('back into src/utils/monster-names-zh.js.');
console.log('==================================================\n');
console.log(SCRIPT);
console.log('\n==================================================');
console.log('END OF SCRIPT');
console.log('==================================================');
