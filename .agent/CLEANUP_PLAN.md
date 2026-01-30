# 🧹 ITEN AI 工具包 - 代码整理计划

> 最后更新: 2026-01-30 14:48
> 目标: 在不改变核心功能的前提下，提升代码可读性、可维护性和结构合理性

---

## 📊 当前进度

### ✅ 已完成任务 (2026-01-30)
- [x] 创建整理分支 `feature/cleanup-2026`
- [x] **替换 HTML title 属性** → `data-tip` + `tooltip-bottom` (300+ 处)
- [x] **修复 canvas context null 检查错误**
- [x] 创建修复工具脚本 `scripts/fix-duplicate-classname.cjs`

### 📈 代码质量指标更新

| 指标 | 原始值 | 当前值 | 目标值 | 状态 |
|------|--------|--------|--------|------|
| HTML title 属性 | 300+ | **0** | 0 | ✅ 完成 |
| console.log | 530 | **229** | <50 | 🔶 进行中 |
| 内联样式 | 213 | **173** | <50 | 🔶 进行中 |
| any 类型 | 162 | **108** | <30 | 🔶 待处理 |

---

## 🎯 下一步建议 (优先级排序)

### 🔴 高优先级

#### 1. 清理 console.log (229 → <50)
预计收益: 提升生产环境性能，减少控制台噪音

```bash
# 查看分布
grep -rn "console\." apps --include="*.tsx" | cut -d: -f1 | sort | uniq -c | sort -rn | head -10
```

策略:
- 保留 `console.error` (错误处理)
- 移除 `console.log` (调试代码)
- 可选: 替换为统一的 logger 工具

#### 2. 减少内联样式 (173 → <50)
预计收益: CSS 可维护性提升，样式统一

策略:
- 将重复的 `style={{}}` 提取为 CSS 类
- 动态样式考虑使用 CSS 变量
- 保留必要的动态样式 (如动态位置/尺寸)

### 🔶 中优先级

#### 3. any 类型替换 (108 → <30)
预计收益: 类型安全，IDE 提示改善

策略:
- 为常用数据结构创建 interface
- 使用泛型替代 any
- 按模块逐步处理

#### 4. 大文件拆分

| 文件 | 行数 | 建议方案 |
|------|------|----------|
| `MediaGalleryPanel.tsx` | 11,805 | 拆分为 Gallery + Grid + Filters + Toolbar |
| `TransposePanel.tsx` | 3,925 | 拆分为 Controls + Preview + History |
| `ResultsGrid.tsx` | 3,225 | 拆分为 Grid + Item + Actions |
| `CopywritingView.tsx` | 3,103 | 拆分为 Editor + Preview + History |

### 🟢 低优先级

#### 5. CSS 整理
- 移除未使用的 CSS 规则
- 统一颜色变量命名
- 整理媒体查询

#### 6. 添加 ESLint/Prettier
- 添加 `npm run lint` 脚本
- 配置自动格式化
- 添加 pre-commit hooks

---

## 📋 操作建议

### 即可开始: 清理 console.log

建议从以下文件开始（console 最多的文件）:

```
# 按 console 数量排序的文件
apps/sheetmind/components/MediaGalleryPanel.tsx
apps/ai-mind-map/components/MindMapCanvas.tsx
apps/prompt-tool/PromptToolApp.tsx
apps/ai-image-recognition/ImageRecognitionApp.tsx
```

### 命令模板

```bash
# 查看某个文件的 console 调用
grep -n "console\." apps/sheetmind/components/MediaGalleryPanel.tsx

# 统计每个文件的 console 数量
grep -c "console\." apps/sheetmind/components/*.tsx | sort -t: -k2 -rn
```

---

## ⚠️ 注意事项

1. **每步都验证构建**: `npm run build`
2. **小步提交**: 每个文件单独提交
3. **保留错误日志**: 不要删除关键的 `console.error`
4. **视觉验证**: 样式改动后检查页面外观

---

## 🔗 相关资源

- 知识库: `ITEN AI Toolkit Ecosystem`
- CSS 设计系统: `index.css`
- 组件库: `components/`
- 清理脚本: `scripts/fix-duplicate-classname.cjs`
