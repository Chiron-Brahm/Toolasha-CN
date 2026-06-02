// Debug script to check action drop table structure
// Run this in browser console when on milkywayidle.com

(function() {
    const gameData = localStorageUtil.getInitClientData();

    // Find a foraging zone action with drop table
    const zoneActions = Object.entries(gameData.actionDetailMap).filter(([hrid, action]) => {
        return action.type === '/action_types/foraging' && action.dropTable && action.dropTable.length > 0;
    });

    if (zoneActions.length > 0) {
        const [actionHrid, action] = zoneActions[0];
        console.log('=== Action Drop Table Debug ===');
        console.log('Action:', action.name);
        console.log('Drop Table:', action.dropTable);
        console.log('\nFirst Drop Entry:');
        console.log(JSON.stringify(action.dropTable[0], null, 2));
        console.log('\nAll Fields in First Drop:');
        console.log(Object.keys(action.dropTable[0]));
    }
})();
