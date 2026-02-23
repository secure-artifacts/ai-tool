# 随机库支持图片URL - 完整实现方案

## 一、问题定义

当前随机库从 Google Sheets 导入时，所有值都被当作纯文本处理。但用户的表格中可能包含：

- `=IMAGE("https://xxx.jpg")` 公式
- `https://example.com/photo.jpg` 直接图片链接
- 普通文本描述词（如"红色礼服"）

**需要**：导入时自动识别，随机抽取到图片URL时自动下载+AI描述，最终以文本描述词形式参与创新。

---

## 二、关键问题：混合内容怎么办？

**场景**：一个库列中同时有文字和图片链接

| 衣服（表头=库名） |
|---|
| 红色连衣裙 |
| =IMAGE("https://xxx/dress.jpg") |
| https://cdn.example.com/jacket.png |
| 蓝色西装 |

### 方案：**逐值标记**，而非逐库标记

不把整个库标为 `image-url`，而是给**每个值**标记类型。这样混合内容自然支持：
- 抽到文字 → 直接用
- 抽到图片URL → 下载+AI描述 → 用描述结果

---

## 三、数据结构改动

### 3.1 `LibraryValue` 扩展（`randomLibraryService.ts`）

```typescript
export interface LibraryValue {
    value: string;              // 值本身（文本 或 URL）
    categories?: string[];      // 所属分类
    valueType?: 'text' | 'image-url';  // 新增：值类型，默认 'text'
    imageUrl?: string;          // 新增：当 valueType='image-url' 时，原始图片URL
    cachedDescription?: string; // 新增：AI描述缓存（避免重复调用API）
}
```

### 3.2 `RandomLibrary` 扩展

```typescript
export interface RandomLibrary {
    // ...现有字段不变...
    hasImageUrls?: boolean;            // 新增：是否包含图片URL（用于UI展示标志）
    imageExtractPrompt?: string;       // 新增：图片描述指令（默认=getDefaultExtractPrompt(库名)）
}
```

---

## 四、导入阶段改动

### 4.1 检测逻辑

在 `fetchMasterSheetLibraries()` 和 `parseTableDataToLibraries()` 中，解析每个值时增加检测：

```typescript
// 检测值是否为图片URL
function detectValueType(value: string): { type: 'text' | 'image-url'; imageUrl?: string } {
    // 1. 检测 =IMAGE("url") 公式
    const imageFormulaMatch = value.match(/^=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i);
    if (imageFormulaMatch) {
        return { type: 'image-url', imageUrl: imageFormulaMatch[1] };
    }

    // 2. 检测直接图片URL（常见图片扩展名 或 Google用户内容链接）
    const trimmed = value.trim();
    if (/^https?:\/\/.+/i.test(trimmed)) {
        const isImageUrl = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(trimmed)
            || trimmed.includes('googleusercontent.com')
            || trimmed.includes('lh3.google.com');
        if (isImageUrl) {
            return { type: 'image-url', imageUrl: trimmed };
        }
    }

    // 3. 默认为文本
    return { type: 'text' };
}
```

### 4.2 导入时的处理

```
解析每个单元格值:
  ├── detectValueType(value)
  │   ├── type='text' → values.push(value)  // 现有逻辑不变
  │   └── type='image-url'
  │       → values.push(imageUrl)  // 存URL字符串（而非公式）
  │       → valuesWithCategory.push({ value: imageUrl, valueType: 'image-url', imageUrl })
  │       → 标记 library.hasImageUrls = true
  └── 库名 = 表头名（不变）
```

### 4.3 导入完成后的提示

如果检测到 `hasImageUrls`，在UI上显示提示：
> "📷 检测到 {N} 个图片链接，随机抽取时将自动下载并AI描述"

---

## 五、随机抽取阶段改动

### 5.1 核心改动点：`pickRandomValues` → 异步化

**问题**：现有 `pickRandomValues` 是同步函数，返回 `string[]`。但图片URL需要 **异步下载+AI描述**。

**方案**：新增一个异步版本

```typescript
// 新函数：异步版随机抽取（处理图片URL）
export async function pickRandomValuesAsync(
    library: RandomLibrary,
    aiDescribe: (imageUrl: string, prompt: string) => Promise<string>
): Promise<string[]> {
    // 1. 先用现有逻辑抽取值
    const picked = pickRandomValues(library);

    // 2. 检查抽到的值里有没有图片URL
    const results: string[] = [];
    for (const value of picked) {
        const detection = detectValueType(value);
        if (detection.type === 'image-url' && detection.imageUrl) {
            // 检查缓存
            const cached = library.valuesWithCategory
                ?.find(v => v.imageUrl === detection.imageUrl)
                ?.cachedDescription;

            if (cached) {
                results.push(cached);
            } else {
                // 下载+AI描述
                const prompt = library.imageExtractPrompt || getDefaultExtractPrompt(library.name);
                const description = await aiDescribe(detection.imageUrl, prompt);
                results.push(description);

                // 缓存结果（修改库内数据）
                const entry = library.valuesWithCategory?.find(v => v.imageUrl === detection.imageUrl);
                if (entry) entry.cachedDescription = description;
            }
        } else {
            results.push(value);
        }
    }
    return results;
}
```

### 5.2 `generateRandomCombination` → 异步化

```typescript
// 改为异步版本
export async function generateRandomCombinationAsync(
    config: RandomLibraryConfig,
    aiDescribe: (imageUrl: string, prompt: string) => Promise<string>
): Promise<string> {
    // 与现有逻辑相同，但调用 pickRandomValuesAsync 替代 pickRandomValues
    // ...
}
```

### 5.3 AI描述的实现（`aiDescribe` 回调）

```typescript
// 在 ImageRecognitionApp.tsx 中实现
const aiDescribeImageUrl = async (imageUrl: string, prompt: string): Promise<string> => {
    // 1. 通过代理下载图片（避免CORS）并转为 base64
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&output=jpg&q=80`;
    const response = await fetch(proxyUrl);
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    const mimeType = blob.type || 'image/jpeg';

    // 2. 调用现有的 classifyImage 函数
    const result = await classifyImage(base64, mimeType, prompt);
    return result.trim();
};
```

### 5.4 调用入口改动

在以下位置，将同步的 `generateRandomCombination` / `generateMultipleUniqueCombinations` 改为异步版本：
- `runNoImageBatchInnovation`（无图快捷模式批量）- 约 L1848
- `startSingleCardInnovation`（单卡创新）- 约 L2053
- `runCreativeAnalysis`（创新模式主流程）- 约 L4995-5381

---

## 六、批量复制库值（替代Google Sheets写入）

### 6.1 功能

每次创新完成后，用户可以点击"📋 复制本次库值"按钮，将本次运行中所有维度产生的值复制为 TSV 格式，用户手动贴回表格。

### 6.2 复制格式

```
场景	衣服	风格	道具
森林小道	白色长裙	油画风	花篮
海边悬崖	黑色皮衣	电影感	吉他
都市天台	灰色西装	赛博朋克	霓虹灯管
```

### 6.3 实现位置

在创新完成后的结果区域（ResultsGrid）或随机库管理面板新增按钮：
- **复制本次库值**：复制本次创新中各维度产生的值（含表头），可直接贴到 Google Sheets 末尾

---

## 七、实施步骤（推荐顺序）

### 第一步：数据结构 + 导入检测
- 扩展 `LibraryValue` 和 `RandomLibrary` 类型
- 在 `fetchMasterSheetLibraries` 和 `parseTableDataToLibraries` 中添加 `detectValueType`
- 导入后标记 `hasImageUrls`
- **可测试点**：导入含 `=IMAGE()` 的表格，确认 URL 被正确识别和存储

### 第二步：异步抽取 + AI描述
- 实现 `pickRandomValuesAsync` 和 `generateRandomCombinationAsync`
- 实现 `aiDescribeImageUrl`（图片下载+AI调用）
- 修改主流程调用入口
- **可测试点**：随机抽到图片URL时，能自动下载并生成描述

### 第三步：缓存 + 复制
- 实现 `cachedDescription` 缓存机制
- 避免同一图片重复调用 AI
- 实现"复制库值"按钮
- **可测试点**：同一图片第二次被抽到时直接用缓存，复制格式正确

### 第四步：UI 完善
- 库标签显示 📷 图标标记图片URL库
- 显示扩充值计数
- 图片URL的缩略图预览（可选）
- 图片描述指令编辑入口

---

## 八、风险和注意事项

| 风险 | 影响 | 对策 |
|------|------|------|
| 图片下载慢/失败 | 阻塞创新流程 | 设置超时(10s)，失败时 fallback 到 URL 字符串本身 |
| CORS 限制 | 无法下载某些图片 | 使用代理 `images.weserv.nl`（已在项目中使用） |
| API 调用增加 | 成本增加 | 缓存机制 + 扩充库（用过的不再需要AI） |
| 异步化改动大 | 可能引入 bug | 保留同步版本作为 fallback，只有检测到图片URL时才走异步路径 |

---

## 九、与现有功能的关系

| 现有功能 | 关系 |
|---------|------|
| **覆盖模式 (OverrideEntry)** | 覆盖是"用户主动指定"，新功能是"库数据自带图片URL自动处理" |
| **图片转库 (handleImageToLibConvert)** | 图片转库是上传图片→AI分析→生成多个维度的库，新功能是库中已有图片URL在运行时描述 |
| **默认提取指令 (getDefaultExtractPrompt)** | 复用同一个默认指令 |
| **分类联动** | 图片URL值也支持分类 |
