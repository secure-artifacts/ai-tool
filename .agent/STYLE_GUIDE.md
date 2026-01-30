# ITEN AI 工具包 - 代码风格指南

## 📐 命名规范

### 文件命名
- **组件**: `PascalCase.tsx` (例: `LoginModal.tsx`)
- **工具函数**: `camelCase.ts` (例: `formatDate.ts`)
- **样式**: `PascalCase.css` 或 `kebab-case.css`
- **类型定义**: `types.ts` 或 `[模块名].types.ts`

### 变量/函数命名
- **组件**: `PascalCase` (例: `UserCard`)
- **函数/变量**: `camelCase` (例: `handleSubmit`, `isLoading`)
- **常量**: `UPPER_SNAKE_CASE` (例: `MAX_RETRY_COUNT`)
- **CSS 类**: `kebab-case` (例: `login-modal-content`)

---

## 🎨 样式规范

### ❌ 避免
```tsx
// 不要使用内联样式
<div style={{ marginTop: '12px', color: '#fff' }}>
```

### ✅ 推荐
```tsx
// 使用 CSS 类
<div className="card-header">

// CSS 文件中
.card-header {
  margin-top: 12px;
  color: #fff;
}
```

### 动态样式例外
```tsx
// 动态值可以使用内联样式
<div style={{ width: `${progress}%` }}>
<div style={{ backgroundColor: dynamicColor }}>
<div style={{ left: position.x, top: position.y }}>
```

---

## 📦 组件结构

### 推荐的组件文件结构
```tsx
/**
 * ComponentName - 组件描述
 * @description 详细说明
 */

import React, { useState, useEffect } from 'react';
import { ExternalDep } from 'external-lib';
import { InternalDep } from '../internal';
import { LocalType } from './types';
import './ComponentName.css';

// 类型定义
interface ComponentNameProps {
  required: string;
  optional?: number;
  onAction: (value: string) => void;
}

// 常量
const DEFAULT_VALUE = 'default';

// 组件
export const ComponentName: React.FC<ComponentNameProps> = ({
  required,
  optional = 10,
  onAction
}) => {
  // Hooks
  const [state, setState] = useState(DEFAULT_VALUE);
  
  // Effects
  useEffect(() => {
    // 副作用逻辑
  }, [dependency]);
  
  // Handlers
  const handleClick = () => {
    onAction(state);
  };
  
  // Render
  return (
    <div className="component-name">
      {/* 内容 */}
    </div>
  );
};

export default ComponentName;
```

---

## 🧪 类型规范

### ❌ 避免
```tsx
const data: any = fetchData();
const items: any[] = [];
function process(input: any): any { }
```

### ✅ 推荐
```tsx
interface UserData {
  id: string;
  name: string;
}

const data: UserData = fetchData();
const items: UserData[] = [];
function process(input: UserData): ProcessedData { }
```

---

## 📝 注释规范

### 文件头注释
```tsx
/**
 * ModuleName - 模块功能
 * @description 详细描述
 * @author 作者 (可选)
 */
```

### 函数注释
```tsx
/**
 * 处理用户登录
 * @param credentials - 用户凭证
 * @returns 登录结果
 */
async function handleLogin(credentials: Credentials): Promise<LoginResult> {
```

### 复杂逻辑注释
```tsx
// 📌 重要: 这里使用延迟加载是因为...
// ⚠️ 注意: 此处需要处理边界情况
// TODO: 待优化 - 描述
```

---

## 🔧 导入顺序

```tsx
// 1. React 核心
import React, { useState, useEffect } from 'react';

// 2. 第三方库
import { motion } from 'framer-motion';
import { Copy, Check } from 'lucide-react';

// 3. 内部模块 (绝对路径)
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';

// 4. 相对路径模块
import { localHelper } from '../utils';
import { LocalComponent } from './LocalComponent';

// 5. 类型导入
import type { ComponentProps } from './types';

// 6. 样式
import './Component.css';
```

---

## 🎯 Golden Sample

参考文件: `apps/ai-mind-map/components/InputPanel.tsx`
- ✅ 零内联样式
- ✅ 清晰的组件结构
- ✅ 良好的类型定义
- ✅ 合理的 CSS 类命名
