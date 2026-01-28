---
description: 部署到 Firebase 和打包 AI Studio 源码
---

# 🚀 部署与打包工作流程

此工作流程包含两个主要任务：
1. **Firebase 部署** - 发布到正式网站
2. **AI Studio 打包** - 生成源码压缩包供 Google AI Studio 使用

**当前版本**: v2.82 (2026-01-28)

---

## 📦 一、AI Studio 源码打包

用于生成可上传到 Google AI Studio 的源码压缩包。

### 执行命令

// turbo
```bash
rm ~/Desktop/ai-toolkit-源码-v2.82.zip 2>/dev/null; \
cd "/Volumes/jw/代码/🪄 AI 创作工具包/ai-创作工具包-正式版" && \
zip -r ~/Desktop/ai-toolkit-源码-v2.82.zip . \
    -x "node_modules/*" \
    -x ".git/*" \
    -x "dist/*" \
    -x "dist-electron/*" \
    -x "electron/node_modules/*" \
    -x "electron/dist/*" \
    -x "electron/dist-electron/*" \
    -x ".DS_Store" \
    -x "*.log" \
    -x "*.dmg" \
    -x "*.blockmap" \
    -x "*.zip" \
    -x "AI创作工具包-*/*" \
    -x "ai-toolkit-*/*" \
    -x "版本归档/*" \
    -x "functions/node_modules/*"
```

### 输出位置
- `~/Desktop/ai-toolkit-源码-v2.82.zip`

### 包含内容
- ✅ 所有源代码（`apps/`, `services/`, `components/`）
- ✅ 配置文件（`package.json`, `vite.config.ts`, `tsconfig.json`）
- ✅ 样式文件（`index.css`, 各模块 CSS）
- ✅ Firebase 配置

### 排除内容
- ❌ `node_modules/` - 依赖包
- ❌ `dist/`, `dist-electron/` - 构建产物
- ❌ `.git/` - 版本控制
- ❌ `版本归档/` - 历史版本
- ❌ 各种 `.zip`, `.dmg` 文件

### 注意事项
- **版本号更新**：每次打包前请更新命令中的版本号（如 `v2.7.0` → `v2.7.1`）
- **AI Studio 识别**：压缩包根目录必须包含 `package.json`，这是 AI Studio 识别项目的关键

---

## 🌐 二、Firebase 部署

### 正式网站
- URL: https://ai-toolkit-b2b78.web.app

### 第一步：备份当前正式网站（重要！）

在构建和部署新版本之前，先把当前正式网站备份到一个版本频道：

```bash
# 将 X-X-X 替换为当前版本号，如 v2-7-0
firebase hosting:clone ai-toolkit-b2b78:live ai-toolkit-b2b78:v2-7-0
```

备份完成后，老版本可通过独立链接访问，例如：
`https://ai-toolkit-b2b78--v2-7-0-xxxxx.web.app`

### 第二步：构建新版本

// turbo
```bash
npm run build
```

### 第三步：部署到预览频道（可选，用于测试）

如需先测试再上线：

// turbo
```bash
firebase hosting:channel:deploy preview --expires 7d
```

### 第四步：部署到正式网站

测试通过后（或跳过第三步直接部署）：

```bash
firebase deploy --only hosting
```

---

## 📋 快速命令参考

| 操作 | 命令 |
|------|------|
| **AI Studio 打包** | 见上方完整 zip 命令 |
| **备份当前版本** | `firebase hosting:clone ai-toolkit-b2b78:live ai-toolkit-b2b78:vX-X-X` |
| 构建 | `npm run build` |
| 预览部署 | `firebase hosting:channel:deploy preview --expires 7d` |
| 正式部署 | `firebase deploy --only hosting` |
| 查看所有版本 | `firebase hosting:channel:list` |

---

## 👥 用户访问老版本

如果新版本有问题，用户可以临时使用老版本：

1. 查看可用的历史版本：
   ```bash
   firebase hosting:channel:list
   ```

2. 把老版本链接发给用户，例如：
   - v2.7.0: `https://ai-toolkit-b2b78--v2-7-0-xxxxx.web.app`

---

## 🔄 回滚正式网站到老版本

如果需要把正式网站回滚到老版本：

```bash
# 把 v2-7-0 版本恢复为正式版本
firebase hosting:clone ai-toolkit-b2b78:v2-7-0 ai-toolkit-b2b78:live
```

---

## 🗑️ 清理旧版本（可选）

删除不再需要的版本频道：

```bash
firebase hosting:channel:delete v2-5-0
```
