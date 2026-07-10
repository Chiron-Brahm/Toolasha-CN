---
name: toolasha-release
description: Toolasha 项目的提交和发布工作流。当用户说"提交"、"commit"、"发布"、"release"、"build"、"构建"、"push"、"推送"时自动触发。执行完整的格式化、测试、构建、提交、推送流程。
---

# Toolasha Release Workflow

自动化 Toolasha 项目的提交和发布流程。

## 工作流

### 提交流程

1. **格式化代码**
   ```bash
   npm run format
   ```

2. **运行测试**
   ```bash
   npm test
   ```

3. **构建生产版本**
   ```bash
   npm run build
   ```

4. **提交代码**
   ```bash
   git add -A
   git commit --no-verify -m "<提交信息>"
   ```

5. **推送代码**
   ```bash
   git pull --rebase origin main
   git push origin main
   ```

### 提交信息格式（必须使用中文）

- `feat: <中文描述>` — 新功能
- `fix: <中文描述>` — Bug 修复
- `chore: <中文描述>` — 杂项更改
- `style: <中文描述>` — 格式化
- `docs: <中文描述>` — 文档更新

**示例：**
- `feat: 添加战斗评分折叠功能`
- `fix: 修复房屋弹窗卡死问题`
- `chore: 更新发布工作流配置`
- `style: 运行 prettier 格式化`
- `docs: 翻译 README.zh-CN.md`

### 发布流程

release-please 会自动创建 PR 和 release。等待 CI 通过后自动合并。

### 注意事项

- 提交前必须运行 `npm run format`（Prettier）
- 提交前必须运行 `npm test`（测试）
- 使用 `--no-verify` 跳过 pre-commit hooks（已在 CI 中验证）
- 推送前先 `git pull --rebase origin main` 避免冲突
