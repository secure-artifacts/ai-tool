---
description: 部署到 Firebase 和打包 AI Studio 源码
---

# 🚀 部署与打包工作流程

此工作流程包含两个主要任务：
1. **Firebase 部署** - 发布到正式网站
2. **AI Studio 打包** - 生成源码压缩包供 Google AI Studio 使用

---

## ⚠️ 零、版本号同步（每次部署前必做！）

每次部署或打包前，必须确保以下所有位置的版本号一致：

### 需要更新的位置

| 文件 | 位置说明 |
|------|----------|
| `package.json` | 根目录 `"version"` 字段 |
| `metadata.json` | AI Studio 应用名中的版本号（`"name"` 字段） |
| `index.tsx` | 设置面板中的 `当前版本: vX.X.X`（搜索 `当前版本`） |
| `index.tsx` | 设置面板「历史版本」链接列表（搜索 `历史版本`，更新 URL 和版本号） |
| `index.tsx` | `UpdateNotice` 组件中的版本号（如有） |
| 本文件 `deploy.md` | zip 命令中的版本号 |

### 快速查找命令

// turbo
```bash
cd "/Volumes/jw/代码/🪄 AI 创作工具包/ai-创作工具包-正式版" && \
echo "=== package.json ===" && \
grep '"version"' package.json && \
echo "=== index.tsx 设置面板版本 ===" && \
grep -n '当前版本' index.tsx | head -3
```

> [!IMPORTANT]
> 如果版本号不一致，先统一更新再执行后续步骤！

---

## 📦 一、AI Studio 源码打包

用于生成可上传到 Google AI Studio 的源码压缩包。

### 1. 检查异常大文件（防泄漏检查）

执行打包前，先运行此命令快速检查项目中是否有大于 2MB 的隐藏大文件/临时文件未在排除范围内：

// turbo
```bash
cd "/Volumes/jw/代码/🪄 AI 创作工具包/ai-创作工具包-正式版" && \
find . -type f -size +2M \
  ! -path "*/node_modules/*" \
  ! -path "*/\.git/*" \
  ! -path "*/dist*/*" \
  ! -path "*/\.agent/*" \
  ! -name "*.png" \
  ! -name "*.jpg"
```
*(如果输出显示了不应该打包回去的比如 .backup, 日志缓存, 数据库文件，记得修改下方的排除列表！)*

### 2. 执行打包命令

// turbo
```bash
rm ~/Desktop/ai-toolkit-源码-v5.0.3.zip 2>/dev/null; \
cd "/Volumes/jw/代码/🪄 AI 创作工具包/ai-创作工具包-正式版" && \
zip -r ~/Desktop/ai-toolkit-源码-v5.0.3.zip . \
    -x "node_modules/*" \
    -x ".git/*" \
    -x "dist/*" \
    -x "dist-electron/*" \
    -x "electron/*" \
    -x "functions/*" \
    -x "*.backup*" \
    -x "**/*.backup*" \
    -x ".playwright-mcp/*" \
    -x ".vscode/*" \
    -x ".DS_Store" \
    -x "package-lock.json" \
    -x "*.log" \
    -x "*.dmg" \
    -x "*.blockmap" \
    -x "*.zip" \
    -x "AI创作工具包-*/*" \
    -x "ai-toolkit-*/*" \
    -x "版本归档/*" \
    -x "未命名文件夹/*" \
    -x "backups/*" \
    -x "docs/*" \
    -x ".agents/*" \
    -x ".gemini/*" \
    -x ".github/*" \
    -x ".agent/*" \
    -x ".firebase/*" \
    -x "google-apps-script/*" \
    -x "scripts/*" \
    -x "extensions/*" \
    -x "*.rej" \
    -x "*.py" \
    -x "*.patch" \
    -x "*.txt" \
    -x "test_*" \
    -x "test-*" \
    -x "temp_*" \
    -x "tsc_*" \
    -x "fix_*" \
    -x "format_*" \
    -x "_move_*" \
    -x "CopywritingView_diff*" \
    -x "copywriting_diff*" \
    -x "*.orig" \
    -x "*.png"
```

### 输出位置
- `~/Desktop/ai-toolkit-源码-v5.0.3.zip`

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
- **版本号更新**：每次打包前请更新命令中的版本号（如 `v3.8.3` → `v3.8.3`）
- **AI Studio 识别**：压缩包根目录必须包含 `package.json`，这是 AI Studio 识别项目的关键

---

## 🌐 二、Firebase 部署

### 正式网站
- URL: https://ai-toolkit-b2b78.web.app

### 第一步：备份当前正式网站（重要！）

在构建和部署新版本之前，先把当前正式网站备份到一个版本频道：

```bash
# 将 X-X-X 替换为当前版本号，如 v3-8-0
firebase hosting:clone ai-toolkit-b2b78:live ai-toolkit-b2b78:v3-8-0
```

备份完成后，老版本可通过独立链接访问，例如：
`https://ai-toolkit-b2b78--v3-8-0-xxxxx.web.app`

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
| **版本号检查** | `grep '"version"' package.json && grep -n '当前版本' index.tsx` |
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
   - v3.8.1: `https://ai-toolkit-b2b78--v3-8-1-xxxxx.web.app`

---

## 🔄 回滚正式网站到老版本

如果需要把正式网站回滚到老版本：

```bash
# 把 v3-8-0 版本恢复为正式版本
firebase hosting:clone ai-toolkit-b2b78:v3-8-0 ai-toolkit-b2b78:live
```

---

## 🗑️ 清理旧版本（可选）

删除不再需要的版本频道：

```bash
firebase hosting:channel:delete v2-5-0
```
