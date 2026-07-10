# Toolasha

![Version](https://img.shields.io/badge/version-2.58.3-orange?style=flat-square) ![Status](https://img.shields.io/badge/status-pre--release-yellow?style=flat-square) ![License](https://img.shields.io/badge/license-CC--BY--NC--SA-4.0-blue?style=flat-square)

一个模块化 Tampermonkey 用户脚本，为 [Milky Way Idle](https://www.milkywayidle.com/game) 提供生活便利功能、市场工具、战斗统计、炼金追踪和全面的游戏数据覆盖。

**📚 [文档](DOCUMENTATION.md)** | **📝 [更新日志](CHANGELOG.md)** | **🤝 [参与贡献](CONTRIBUTING.md)**

---

## 关于

Toolasha 是对流行的 MWITools 用户脚本的完整重写，使用现代 JavaScript 架构从头构建。所有功能都是模块化的，可以通过游戏内设置面板单独启用或禁用。

## 功能

### 🏪 市场与经济

- **市场物价** — 物品工具提示显示 24 小时均价
- **利润计算** — 合成成本和利润，支持保守/混合/乐观定价模式
- **净资产显示** — 实时资产估值
- **库存排序** — 按价值、类型或自定义条件排序库存
- **挂牌时间** — 市场挂牌的估计挂单时长
- **队列预估** — 市场订单的预计等待时间
- **交易历史** — 查看最近交易活动
- **自动定价** — 根据市场数据自动填充出价/要价
- **订单总额** — 显示未成交订单的总价值
- **哲人石计算器** — 计算哲人石博彩的期望收益

### ⚔️ 战斗与地下城

- **战斗评分** — 装备评分计算，显示在装备面板
- **战斗统计** — 战斗面板中的详细统计选项卡
- **战斗摘要** — 返回战斗时的完整统计分解
- **地下城追踪** — 运行时间、波次进度和团队统计
- **迷宫追踪** — 追踪每种怪物的最佳击败等级
- **技能触发** — 显示技能触发条件
- **配装显示** — 配装装备上显示强化等级
- **战斗模拟集成** — 将角色数据直接导入 Shykai 战斗模拟器

### ⚗️ 炼金

- **炼金利润显示** — 转化和铸币操作的利润计算器
- **转化历史** — 记录并显示转化会话历史
- **铸币历史** — 记录并显示铸币会话历史及催化剂追踪

### 🔨 强化与制作

- **强化追踪器** — 每次会话的成功率和成本追踪
- **强化模拟器** — 最优策略计算器，含成本预测
- **强化里程碑** — 达到关键强化等级的预期成本和经验值
- **制作利润** — 合成的材料成本和利润分解
- **最大可制作** — 显示当前材料可制作数量

### 📋 任务与行动

- **行动队列时间** — 排队行动的总完成时间
- **任务利润显示** — 每个任务的奖励价值计算
- **任务效率评级** — 按代币或金币/小时排名任务
- **任务重随追踪** — 追踪累计重随成本
- **任务排序器** — 按技能或时间自动排序任务
- **任务图标** — 任务卡片上的视觉图标，含地下城指示器
- **任务库存高亮** — 暗化当前任务不需要的库存物品
- **任务统计** — 已完成任务的汇总统计
- **快捷输入按钮** — 1 / 10 / 100 / 最大数量的预设按钮
- **技能书计算器** — 达到目标技能等级所需的技能书数量

### 📊 技能与经验值

- **经验值速率显示** — 在技能条上显示经验值/小时速率
- **升级预估时间** — 技能工具提示中的预计升级时间
- **剩余经验值** — 显示在技能条上的距下一级剩余经验值
- **经验值百分比** — 距下一级的进度百分比

### 💬 聊天

- **弹出聊天** — 可分离的聊天窗口，支持多频道分屏查看
- **提及追踪** — 被提及时的徽章指示器
- **聊天命令** — `/item`、`/wiki`、`/market` 快捷导航命令
- **屏蔽列表** — 在弹出聊天中过滤被屏蔽玩家的消息

### 🏠 房屋

- **升级费用** — 显示房间升级费用及当前市场价格

### 🧭 导航

- **Alt+点击导航** — Alt+点击物品可导航至其合成行动、采集区域或市场页面
- **收藏导航** — 收藏面板物品上的导航按钮
- **字典** — 物品字典快速查询

### 🔔 通知

- **空队列提醒** — 行动队列为空时的浏览器通知

### 🎨 UI 增强

- **装备等级显示** — 物品图标上显示强化等级
- **库存徽章** — 库存物品上的价格和数量徽章
- **炼金物品暗化** — 暗化低于你技能等级的炼金物品
- **图标关键信息** — 物品图标上的上下文信息覆盖
- **外部工具链接** — 相关面板上的外部工具快捷链接
- **颜色自定义** — 14 种可配置的 UI 颜色选项

## 安装

### 前置要求

- **浏览器**：Chrome、Firefox 或 Edge，安装 [Tampermonkey](https://www.tampermonkey.net/)
- **Steam**：无需额外扩展 — 使用游戏内置扩展管理器从 [Greasy Fork](https://update.greasyfork.org/scripts/562662/Toolasha.user.js) 安装

### 从 Greasy Fork 安装（推荐）

1. 访问 [Toolasha on Greasy Fork](https://greasyfork.org/en/scripts/562662-toolasha)
2. 点击 **Install this script**
3. Tampermonkey 会提示确认安装
4. 访问 [Milky Way Idle](https://www.milkywayidle.com/game) — Toolasha 自动加载

### 从 GitHub Release 安装

1. **下载最新版本**
   - 访问 [Releases 页面](../../releases)
   - 下载 `Toolasha.user.js`

2. **在 Tampermonkey 中安装**
   - 点击下载的文件，或
   - 打开 Tampermonkey 面板 → 工具 → 从文件导入

3. **访问游戏**
   - 前往 [Milky Way Idle](https://www.milkywayidle.com/game)
   - Toolasha 自动加载

> 入口脚本会自动从 GitHub raw URL 加载所需库。

### 从源码安装

```bash
git clone https://github.com/Celasha/Toolasha.git
cd Toolasha
npm install
npm run build:dev
# 将 dist/Toolasha-dev.user.js 安装到 Tampermonkey
```

## 使用

### 访问设置

1. 打开游戏 [milkywayidle.com/game](https://www.milkywayidle.com/game)
2. 点击右上角的**角色头像**
3. 点击**设置**
4. 点击设置菜单中的 **Toolasha** 选项卡
5. 启用/禁用所需功能 — 设置自动保存

### 故障排除

如果功能不工作：

1. **刷新页面** — 部分功能启用后需要重新加载
2. **检查浏览器控制台** — 查找 `[Toolasha]` 错误信息（F12 → Console）
3. **确认扩展已启用** — 检查扩展管理器图标
4. **报告问题** — [提交 Issue](../../issues) 并附上详细信息

## 开发者

Toolasha 使用现代 JavaScript (ES6+) 构建，采用模块化、基于功能的架构。欢迎贡献！

### 快速开始

```bash
npm install           # 安装依赖
npm run build:dev     # 构建开发独立用户脚本
npm run build         # 构建生产库和入口
npm run dev           # 监听模式（自动重建）
npm test              # 运行测试套件（202 个测试）
```

### 文档

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — 贡献指南和开发工作流
- **[AGENTS.md](AGENTS.md)** — AI 编码代理的开发者指南
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — 系统架构和设计模式
- **[DOCUMENTATION.md](DOCUMENTATION.md)** — 完整文档索引

### 关键技术

- **构建**：Rollup + ES6 模块
- **测试**：Vitest（202 个测试）
- **存储**：IndexedDB + 防抖写入
- **代码质量**：ESLint + Prettier + 提交前钩子
- **CI/CD**：GitHub Actions 自动化发布

## 项目结构

```
Toolasha/
├── src/
│   ├── core/                      # 核心系统（存储、配置、WebSocket、数据管理）
│   ├── features/                  # 功能模块
│   │   ├── actions/              # 行动面板增强
│   │   ├── alchemy/              # 炼金利润和历史追踪
│   │   ├── chat/                 # 聊天增强和弹出窗口
│   │   ├── combat/               # 战斗统计、地下城追踪、迷宫
│   │   ├── combat-sim-integration/ # Shykai 战斗模拟器集成
│   │   ├── combat-stats/         # 详细战斗统计
│   │   ├── enhancement/          # 强化优化器和追踪器
│   │   ├── house/                # 房屋升级费用
│   │   ├── inventory/            # 库存徽章和排序
│   │   ├── market/               # 市场工具和利润计算
│   │   ├── navigation/           # Alt+点击和快捷导航
│   │   ├── notifications/        # 浏览器通知
│   │   ├── profile/              # 角色资料和战斗评分
│   │   ├── skills/               # 经验值速率和等级追踪
│   │   ├── tasks/                # 任务效率和排序
│   │   └── ui/                   # UI 增强和覆盖层
│   ├── api/                       # 外部 API 集成
│   ├── libraries/                 # 模块打包入口
│   └── utils/                     # 共享工具
├── dist/                          # 构建的用户脚本（git 忽略）
└── docs/                          # 文档
```

## 测试

```bash
npm test                    # 运行所有测试
npm run test:watch          # 监听模式
npm test -- --coverage      # 覆盖率报告
```

13 个测试套件中的 202 个测试，每次提交都有自动化 CI/CD 管道验证。

## 许可证与致谢

**许可证**：[CC-BY-NC-SA-4.0](LICENSE)

**原作者**：bot7420 (MWITools)
**重写与维护**：Celasha 和 Claude
