const fs = require('fs');

// Formatter + time unit translations
const core = {
    's': '秒', 'm': '分', 'h': '时', 'd': '天',
    'year': '年', 'years': '年', 'month': '月', 'months': '月',
    'day': '天', 'days': '天',
    'Just now': '刚刚', '30+ days': '30+ 天前',
    'K': '千', 'M': '百万', 'B': '十亿', 'T': '万亿',
};

// Config.js feature names + descriptions + pricing
const config = {
    // Market features
    'Market Prices in Tooltips': '市场价格提示',
    'Shows bid/ask prices in item tooltips': '在物品提示中显示买卖价格',
    'Artisan-Adjusted Tooltip Prices': '工匠调整价格',
    'Adjusts tooltip price totals for Artisan Tea material reduction': '根据工匠茶减少调整提示总价',
    'Profit Calculator in Tooltips': '提示利润计算器',
    'Shows production cost and profit in tooltips': '在提示中显示生产成本和利润',
    'Consumable Effects in Tooltips': '消耗品效果提示',
    'Shows buff effects and durations for food/drinks': '显示食物/饮品的增益效果和持续时间',
    'Currency Token Tooltips': '货币代币提示',
    'Shows shop values for tokens, seals, and cowbells': '显示代币、封印和牛铃的商店价值',
    'Expected Value Calculator': '期望值计算器',
    'Shows EV for openable containers (crates, chests)': '显示可开启容器（箱子、宝箱）的期望值',
    'Market Listing Price Display': '市场挂单价格显示',
    'Shows top order price, total value, and listing age on My Listings': '在"我的挂单"中显示最高订单价格、总价值和挂单时长',
    'Estimated Listing Age': '预估挂单时长',
    'Estimates creation time for all market listings using listing ID interpolation': '使用列表ID插值估算所有市场挂单的创建时间',
    'Market Order Totals': '市场订单总计',
    'Shows buy orders, sell orders, and unclaimed coins in header': '在标题区显示买单、卖单和未领取金币',
    'Market History Viewer': '市场历史查看器',
    'View and export all market listing history': '查看和导出所有市场挂单历史',
    'Philo Gamba Calculator': '贤者赌博计算器',
    "Calculate expected value of transmuting items into Philosopher's Stones": '计算将物品转化为贤者之石的期望值',
    'Enhancement Simulator': '强化模拟器',
    'Shows enhancement cost calculations in item tooltips': '在物品提示中显示强化成本计算',

    // Action features
    'Action Queue Time Display': '行动队列时间显示',
    'Shows total time and completion time for queued actions': '显示队列行动的总时间和完成时间',
    'Action Bar Countdown': '行动栏倒计时',
    'Live countdown timer on the action progress bar': '行动进度条上的实时倒计时',
    'Quick Input Buttons': '快速输入按钮',
    'Adds 1/10/100/1000 buttons to action inputs': '在行动输入框中添加1/10/100/1000按钮',
    'Action Profit Display': '行动利润显示',
    'Shows profit/loss for gathering and production': '显示采集和生产的利润/亏损',
    'Required Materials Display': '所需材料显示',
    'Shows total required and missing materials for production actions': '显示生产行动所需和缺失的材料总数',

    // Combat features
    'Ability Book Requirements': '技能书需求',
    'Shows books needed to reach target level': '显示达到目标等级所需技能书',
    'Combat Zone Indices': '战斗区域索引',
    'Shows zone numbers in combat location list': '在战斗地点列表中显示区域编号',
    'Task Zone Indices': '任务区域索引',
    'Shows zone numbers on combat tasks': '在战斗任务上显示区域编号',
    'Profile Gear Score': '角色装备评分',
    'Shows gear score on profile': '在角色界面上显示装备评分',
    'Dungeon Tracker': '副本追踪器',
    'Real-time dungeon progress tracking in top bar with wave times, statistics, and party chat completion messages': '在顶部栏实时追踪副本进度，显示波次时间、统计数据和队伍聊天完成消息',
    'Combat Simulator Integration': '战斗模拟器集成',
    'Auto-import character/party data into Shykai Combat Simulator': '自动将角色/队伍数据导入Shykai战斗模拟器',

    // UI features
    'Equipment Level on Icons': '图标上的装备等级',
    'Shows item level number on equipment icons': '在装备图标上显示物品等级数字',
    'Alchemy Item Dimming': '炼金物品灰显',
    'Dims items requiring higher Alchemy level': '灰显需要更高炼金术等级的物品',
    'Skill Experience Percentage': '技能经验百分比',
    'Shows XP progress percentage in left sidebar': '在左侧边栏显示经验进度百分比',
    'Use K/M/B Number Formatting': '使用K/M/B数字格式',
    'Display large numbers as 1.5M instead of 1,500,000': '将大数字显示为1.5M而非1,500,000',

    // Task features
    'Task Profit Calculator': '任务利润计算器',
    'Shows expected profit from task rewards': '显示任务奖励的预期利润',
    'Task Efficiency Rating': '任务效率评级',
    'Shows tokens or profit per hour on task cards': '在任务卡片上显示每小时代币或利润',
    'Task Reroll Tracker': '任务重随追踪器',
    'Tracks reroll costs and history': '追踪重随成本和历史',
    'Task Sorting': '任务排序',
    'Adds button to sort tasks by skill type': '添加按技能类型排序任务的按钮',
    'Task Icons': '任务图标',
    'Shows visual icons on task cards': '在任务卡片上显示视觉图标',
    'Task Icons - Dungeons': '任务图标-副本',
    'Shows dungeon icons for combat tasks': '为战斗任务显示副本图标',

    // Skills/House features
    'Remaining XP Display': '剩余经验显示',
    'Shows remaining XP to next level on skill bars': '在技能条上显示到下一级所需剩余经验',
    'House Upgrade Costs': '房屋升级成本',
    'Shows market value of upgrade materials': '显示升级材料的市场价值',

    // Economy features
    'Net Worth Calculator': '净资产计算器',
    'Shows total asset value in header (Current Assets)': '在标题中显示总资产价值',
    'Inventory Summary Panel': '背包摘要面板',
    'Shows detailed networth breakdown below inventory': '在背包下方显示详细净资产细分',
    'Inventory Sort': '背包排序',
    'Sorts inventory by Ask/Bid price': '按买卖价格排序背包',
    'Inventory Sort Price Badges': '背包排序价格徽章',
    'Shows stack value badges on items when sorting': '排序时在物品上显示堆叠价值徽章',
    'Inventory Price Badges': '背包价格徽章',
    'Shows stack value badges on items (independent of sorting)': '在物品上显示堆叠价值徽章（独立于排序）',

    // Enhancement/Notifications
    'Enhancement Tracker': '强化追踪器',
    'Tracks enhancement attempts, costs, and statistics': '追踪强化尝试、成本和统计数据',
    'Empty Queue Notification': '队列空闲通知',
    'Browser notification when action queue becomes empty': '行动队列为空时的浏览器通知',

    // Pricing mode labels
    'Instant Buy / Instant Sell': '即时买入 / 即时卖出',
    'Instant Buy / Patient Sell': '即时买入 / 挂单卖出',
    'Patient Buy / Patient Sell': '挂单买入 / 挂单卖出',
    'Patient Buy / Instant Sell': '挂单买入 / 即时卖出',
    'Buy: Ask / Sell: Bid': '买入: 卖单价 / 卖出: 买单价',
    'Buy: Ask / Sell: Ask': '买入: 卖单价 / 卖出: 卖单价',
    'Buy: Bid / Sell: Ask': '买入: 买单价 / 卖出: 卖单价',
    'Buy: Bid / Sell: Bid': '买入: 买单价 / 卖出: 买单价',
};

// Read schema fragments
const dir = '.sisyphus';
const files = fs.readdirSync(dir).filter(f => f.startsWith('sc_') && f.endsWith('_frag.js')).sort();
let schema = [];
for (const f of files) {
    const content = fs.readFileSync(dir + '/' + f, 'utf8');
    const pairs = content.match(/'[^']*'\s*:\s*'[^']*'/g) || [];
    schema.push(...pairs);
}

// Merge all: core first, then config, then schema
function buildOutput(map) {
    const entries = Object.entries(map).map(([k, v]) => `'${k}': '${v}'`);
    return entries.join(',\n');
}

const coreStr = buildOutput(core);
const configStr = buildOutput(config);
const schemaStr = schema.join(',\n');

let output = "import { registerLocale } from './i18n.js';\n\nregisterLocale('zh-CN', {\n";
output += coreStr + ',\n\n';
output += configStr + ',\n\n';
output += schemaStr + '\n';
output += '});\n';

fs.writeFileSync('src/core/i18n-zh-CN.js', output);
console.log('Total translations:', Object.keys(core).length + Object.keys(config).length + schema.length);
