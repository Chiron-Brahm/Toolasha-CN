# Toolasha

![Version](https://img.shields.io/badge/version-2.59.4-orange?style=flat-square) ![Status](https://img.shields.io/badge/status-pre--release-yellow?style=flat-square) ![License](https://img.shields.io/badge/license-CC--BY--NC--SA--4.0-blue?style=flat-square)

一个模块化的用户脚本，为 [Milky Way Idle](https://www.milkywayidle.com/game) 提供生活质量功能、市场工具、战斗统计、炼金追踪和全面的游戏数据覆盖。

**📚 [文档](DOCUMENTATION.md)** | **📝 [更新日志](CHANGELOG.md)** | **🤝 [贡献](CONTRIBUTING.md)**

---

## 关于

Toolasha 是流行 MWITools 用户脚本的完整重写，从头开始使用现代 JavaScript 架构构建。所有功能都是模块化的，可以通过游戏内设置面板单独启用或禁用。

## 功能

### 🏪 市场与经济

- **市场价格** — 工具提示中显示 24 小时平均价格
- **利润计算** — 考虑保守/混合/乐观定价模式的制作成本和利润率
- **净资产显示** — 实时资产估值
- **背包排序** — 按价值、类型或自定义条件排序背包
- **挂单时间** — 估算市场挂单的时间
- **队列长度估算** — 市场订单的预计等待时间
- **交易历史** — 查看最近交易活动
- **自动填充价格** — 基于市场数据自动填充买/卖价格
- **订单总计** — 显示未完成订单的总价值
- **哲学家赌博计算器** — 计算哲学家石头赌博的预期利润

### ⚔️ 战斗与副本

- **战斗评分** — 装备上显示的装备分数计算
- **战斗统计** — 战斗面板中的详细统计选项卡
- **战斗摘要** — 返回战斗后的完整统计明细
- **副本追踪器** — 副本时间、波次进度和团队统计
- **迷宫追踪器** — 追踪每种怪物类型击败的最高等级
- **技能触发器** — 显示技能触发条件
- **套装显示** — 套装装备上显示强化等级
- **战斗模拟器集成** — 直接将角色数据导入 Shykai 战斗模拟器

### ⚗️ 炼金

- **炼金利润显示** — 转化和铸币操作的利润计算器
- **转化历史** — 记录并显示转化会话历史
- **铸币历史** — 记录并显示铸币会话历史及催化剂追踪

### 🔨 强化与制作

- **强化追踪器** — 每个会话的成功率和成本追踪
- **强化模拟器** — 最优策略计算器及成本预测
- **强化里程碑** — 达到关键强化等级所需的预期成本和经验
- **生产利润** — 制作成本及利润明细
- **最大可制作** — 基于当前材料显示可制作数量

### 📋 任务与动作

- **动作队列时间** — 队列动作的总完成时间
- **任务利润显示** — 每个任务的奖励价值计算
- **任务效率评级** — 按每小时代币或金币对任务排序
- **任务重投追踪器** — 追踪累计重投成本
- **任务排序器** — 按技能或时间自动排序任务
- **任务图标** — 任务卡片上的视觉图标，包括副本指示器
- **任务背包高亮** — 调暗当前任务不需要的背包物品
- **任务统计** — 已完成任务摘要统计
- **快速输入按钮** — 1 / 10 / 100 / 最大数量的预设按钮
- **技能书计算器** — 达到目标技能等级所需的书籍数量

### 📊 技能与经验

- **经验速率显示** — 在技能栏上显示经验/小时
- **下一等级时间** — 技能工具提示中显示升级预计时间
- **剩余经验** — 在技能栏上显示距下一等级的剩余经验
- **经验百分比** — 距下一等级的进度百分比

### 💬 聊天

- **弹出聊天** — 可分离的聊天窗口，支持多频道分屏视图
- **提及追踪器** — 当名字被提及时显示徽章指示器
- **聊天命令** — `/item`、`/wiki`、`/market` 快速导航命令
- **屏蔽列表** — 在弹出聊天中过滤被屏蔽玩家的消息

### 🏠 房屋

- **升级费用** — 显示房间升级费用及当前市场价格

### 🧭 导航

- **Alt+点击导航** — Alt+点击物品导航至其制作动作、采集区域或市场页面
- **收藏导航** — 收藏面板物品上的导航按钮
- **物品词典** — 带快速查找的物品词典

### 🔔 通知

- **空队列提醒** — 当动作队列耗尽时发送浏览器通知

### 🎨 UI 增强

- **装备等级显示** — 物品图标上显示强化等级
- **背包徽章** — 背包物品上的价格和数量徽章
- **炼金物品调暗** — 调暗低于技能等级的炼金物品
- **图标关键信息** — 叠加在物品图标上的上下文信息
- **外部工具链接** — 从相关面板快速链接至外部工具
- **颜色自定义** — 14 个可配置的 UI 颜色选项

## 安装

### 前置要求

- **浏览器**: Chrome、Firefox 或 Edge，需安装 [Tampermonkey](https://www.tampermonkey.net/)
- **Steam**: 无需额外扩展 — 使用游戏内置扩展管理器从 [Greasy Fork](https://update.greasyfork.org/scripts/562662/toolasha) 安装

### 从 Greasy Fork 安装（推荐）

1. 访问 [Greasy Fork 上的 Toolasha](https://greasyfork.org/en/scripts/562662-toolasha)
2. 点击 **安装此脚本**
3. Tampermonkey 会提示确认安装
4. 访问 [Milky Way Idle](https://www.milkywayidle.com/game) — Toolasha 自动加载

### 从 GitHub 版本安装

1. **下载最新版本**
    - 访问 [版本页面](../../releases)
    - 下载最新版本中的 `Toolasha.user.js`

2. **在 Tampermonkey 中安装**
    - 点击下载的文件，或
    - 打开 Tampermonkey 仪表盘 → 实用工具 → 从文件导入

3. **访问游戏**
    - 进入 [Milky Way Idle](https://www.milkywayidle.com/game)
    - Toolasha 自动加载

> 入口点从 GitHub raw URL 自动加载所需库。

### 从源码安装

```bash
git clone https://github.com/Celasha/Toolasha.git
cd Toolasha
npm install
npm run build:dev
# 在 Tampermonkey 中安装 dist/Toolasha-dev.user.js
```

## 使用方法

### 访问设置

1. 在 [milkywayidle.com/game](https://www.milkywayidle.com/game) 打开游戏
2. 点击你的 **角色图标**（屏幕右上角）
3. 点击 **设置**
4. 在设置菜单中点击 **Toolasha** 选项卡
5. 按需启用/禁用功能 — 设置自动保存

### 故障排除

如果功能不工作：

1. **刷新页面** — 某些功能启用后需要重新加载页面
2. **检查浏览器控制台** — 查找 `[Toolasha]` 错误消息（F12 → 控制台）
3. **验证扩展已启用** — 检查扩展管理器图标
4. **报告问题** — [提交问题](../../issues) 并提供详情

## 面向开发者

Toolasha 使用现代 JavaScript（ES6+）构建，采用模块化、基于功能的架构。欢迎贡献！

### 快速开始

```bash
npm install           # 安装依赖
npm run build:dev     # 构建开发版独立用户脚本
npm run build         # 构建生产版库 + 入口点
npm run dev           # 监视模式（自动重建）
npm test              # 运行测试套件（202 个测试）
```

### 文档

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — 贡献指南和开发工作流程
- **[AGENTS.md](AGENTS.md)** — AI 编码代理开发者指南
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — 系统架构和设计模式
- **[DOCUMENTATION.md](DOCUMENTATION.md)** — 完整文档索引

### 关键技术

- **构建**: Rollup + ES6 模块
- **测试**: Vitest，202 个测试
- **存储**: IndexedDB + 防抖写入
- **代码质量**: ESLint + Prettier + 提交前钩子
- **CI/CD**: GitHub Actions + 自动化发布

## 项目结构

```
Toolasha/
├── src/
│   ├── core/                      # 核心系统（存储、配置、WebSocket、数据管理器）
│   ├── features/                  # 功能模块
│   │   ├── actions/              # 动作面板增强
│   │   ├── alchemy/              # 炼金利润和历史追踪
│   │   ├── chat/                 # 聊天增强和弹出
│   │   ├── combat/               # 战斗统计、副本追踪器、迷宫
│   │   ├── combat-sim-integration/ # Shykai 战斗模拟器集成
│   │   ├── combat-stats/         # 详细战斗统计
│   │   ├── enhancement/          # 强化优化器和追踪器
│   │   ├── house/                # 房屋升级费用
│   │   ├── inventory/            # 背包徽章和排序
│   │   ├── market/               # 市场工具和利润计算
│   │   ├── navigation/           # Alt+点击和快速导航
│   │   ├── notifications/        # 浏览器通知
│   │   ├── profile/              # 角色简介和战斗评分
│   │   ├── skills/               # 经验速率和等级追踪
│   │   ├── tasks/                # 任务效率和排序
│   │   └── ui/                   # UI 增强和覆盖
│   ├── api/                       # 外部 API 集成
│   ├── libraries/                 # 模块包入口点
│   └── utils/                     # 共享工具
├── dist/                          # 构建的用户脚本（git 忽略）
└── docs/                          # 文档
```

## 测试

```bash
npm test                    # 运行所有测试
npm run test:watch          # 监视模式
npm test -- --coverage      # 覆盖率报告
```

13 个测试套件中的 202 个测试，每次提交时都有自动化 CI/CD 验证。

## 许可证与致谢

**许可证**: [CC-BY-NC-SA-4.0](LICENSE)

**原始作者**: bot7420 (MWITools)
**重写与维护**: Celasha 和 Claude
