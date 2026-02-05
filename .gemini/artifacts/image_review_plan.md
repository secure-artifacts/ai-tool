# 🖼️ 图片审核工具 (Image Review Tool)

## 一、功能概述

专门用于审核 AI 生成的图片，提供结构化的反馈流程，支持中英文双语反馈验证。

## 二、核心功能

### 2.1 图片导入
- 拖拽/粘贴图片
- 支持批量导入
- 从其他工具（如 AI 图片识别）导入
- 支持 URL 导入

### 2.2 审核状态
| 状态 | 图标 | 说明 |
|-----|------|------|
| 待审核 | ⏳ | 默认状态 |
| 合格 | ✅ | 图片通过审核 |
| 不合格 | ❌ | 图片未通过 |
| 需要修改 | ✏️ | 需要特定修改 |
| 放弃 | 🚫 | 完全放弃此图 |

### 2.3 反馈输入
- **文字反馈**：手动输入中文建议
- **图片标注**：
  - 矩形框标记问题区域
  - 圆圈标记
  - 箭头指示
  - 画笔自由绘制
  - 文字标注
- **快捷短语**：预设常用反馈（可自定义）

### 2.4 批量/组合模式
- **单图模式**：每张图独立反馈
- **批量模式**：选中多张图，给出统一反馈
- **组合模式**：多张图组成一组，给出整体评价

### 2.5 翻译与验证（关键）
```
输入: 中文建议
  ↓
翻译: 中文 → 英文
  ↓
回译: 英文 → 中文（用于验证）
  ↓
输出:
  - 英文反馈 (English Feedback)
  - 回译中文 (Back-translation for verification)
```

**展示格式**:
```
📝 原始反馈 (中文):
人物表情太僵硬，需要更自然的微笑

🔤 英文翻译:
The character's expression is too stiff, needs a more natural smile

🔙 回译确认:
人物表情太僵硬，需要更自然的微笑
✅ 翻译准确 / ⚠️ 需要手动调整
```

## 三、界面布局

```
┌─────────────────────────────────────────────────────────────────┐
│ 工具栏: [导入] [批量操作] [导出] [设置]              [切换视图] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐│
│  │                      │  │ 审核面板                         ││
│  │    图片预览区        │  │                                  ││
│  │   (大图/标注模式)    │  │ 状态: [✅] [❌] [✏️] [🚫]        ││
│  │                      │  │                                  ││
│  │  [标注工具栏]        │  │ 中文反馈:                        ││
│  │  □ ○ → ✏️ T          │  │ ┌────────────────────────────┐  ││
│  │                      │  │ │ 人物表情太僵硬...          │  ││
│  │                      │  │ └────────────────────────────┘  ││
│  │                      │  │                                  ││
│  │                      │  │ [翻译为英文]                     ││
│  │                      │  │                                  ││
│  │                      │  │ 英文翻译:                        ││
│  └──────────────────────┘  │ The character's expression...    ││
│                            │                                  ││
│  ┌──────────────────────┐  │ 回译确认:                        ││
│  │ 图片列表 (缩略图)    │  │ 人物表情太僵硬... ✅             ││
│  │ [□][□][□][□][□][□]   │  │                                  ││
│  │ 可多选/拖拽组合      │  │ [复制英文] [复制全部]            ││
│  └──────────────────────┘  └──────────────────────────────────┘│
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 状态栏: 共 24 张 | 合格: 10 | 待修改: 8 | 不合格: 3 | 待审: 3  │
└─────────────────────────────────────────────────────────────────┘
```

## 四、技术实现

### 4.1 目录结构
```
apps/image-review/
├── ImageReviewApp.tsx        # 主组件
├── types.ts                  # 类型定义
├── HELP.md                   # 帮助文档
├── components/
│   ├── ImageCanvas.tsx       # 图片标注画布
│   ├── AnnotationToolbar.tsx # 标注工具栏
│   ├── ReviewPanel.tsx       # 审核面板
│   ├── ImageGrid.tsx         # 图片网格
│   ├── TranslationPreview.tsx# 翻译预览
│   └── QuickPhrases.tsx      # 快捷短语
└── services/
    └── translationService.ts # 翻译服务
```

### 4.2 核心类型
```typescript
// 审核状态
type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'revision' | 'abandoned';

// 标注类型
type AnnotationType = 'rectangle' | 'circle' | 'arrow' | 'freehand' | 'text';

// 标注项
interface Annotation {
  id: string;
  type: AnnotationType;
  points: { x: number; y: number }[];
  color: string;
  text?: string;
}

// 单张图片审核
interface ImageReview {
  id: string;
  imageUrl: string;
  base64Data?: string;
  status: ReviewStatus;
  feedbackCn: string;           // 中文反馈
  feedbackEn: string;           // 英文翻译
  feedbackBackTranslation: string; // 回译中文
  annotations: Annotation[];    // 图片标注
  createdAt: number;
  updatedAt: number;
}

// 图片组（多图组合反馈）
interface ImageGroup {
  id: string;
  name: string;
  imageIds: string[];
  groupFeedbackCn: string;
  groupFeedbackEn: string;
  groupFeedbackBackTranslation: string;
  status: ReviewStatus;
}

// 应用状态
interface ImageReviewState {
  images: ImageReview[];
  groups: ImageGroup[];
  selectedIds: string[];        // 当前选中的图片
  activeImageId: string | null; // 当前编辑的图片
  viewMode: 'grid' | 'single' | 'compare';
}
```

### 4.3 翻译服务
使用 Gemini API 实现：
- 中文 → 英文翻译
- 英文 → 中文回译
- 并行请求提高效率

### 4.4 标注功能
使用 Canvas API：
- 矩形/圆形选区
- 箭头绘制
- 自由画笔
- 文字标注
- 导出带标注的图片

## 五、实现步骤

### Phase 1: 基础框架
1. 创建目录结构和类型定义
2. 实现基础 UI 布局
3. 图片导入功能

### Phase 2: 审核功能
1. 状态选择组件
2. 反馈输入面板
3. 翻译与回译功能

### Phase 3: 标注功能
1. Canvas 画布组件
2. 标注工具栏
3. 标注保存与导出

### Phase 4: 批量操作
1. 多选功能
2. 图片分组
3. 批量状态/反馈

### Phase 5: 优化与导出
1. 快捷短语预设
2. 导出审核报告
3. 与其他工具集成

## 六、预估工时

| 阶段 | 预估时间 |
|-----|---------|
| Phase 1 | 30 分钟 |
| Phase 2 | 45 分钟 |
| Phase 3 | 60 分钟 |
| Phase 4 | 30 分钟 |
| Phase 5 | 30 分钟 |
| **总计** | **约 3 小时** |

---

## 确认问题

1. **翻译 API**：使用现有的 Gemini API 吗？
2. **标注导出**：需要导出带标注的图片吗？
3. **数据持久化**：是否保存到 Firebase（项目管理）？
4. **导出格式**：需要导出什么格式的审核报告？(JSON/Excel/文本)
