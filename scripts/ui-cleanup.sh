#!/bin/bash
# UI 统一化脚本 - 批量替换常见内联样式模式

# 工作目录
cd "/Volumes/jw/代码/🪄 AI 创作工具包/ai-创作工具包-正式版"

echo "=== 开始批量替换内联样式 ==="

# 1. 替换 display: 'flex' 相关
echo "处理 flex 相关样式..."
find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/style={{ display: 'flex', alignItems: 'center', gap: '4px' }}/className=\"flex items-center gap-1\"/g" \
  -e "s/style={{ display: 'flex', alignItems: 'center', gap: '8px' }}/className=\"flex items-center gap-2\"/g" \
  -e "s/style={{ display: 'flex', alignItems: 'center' }}/className=\"flex items-center\"/g" \
  -e "s/style={{ display: 'flex', flexDirection: 'column' }}/className=\"flex flex-col\"/g" \
  -e "s/style={{ display: 'flex', gap: '8px' }}/className=\"flex gap-2\"/g" \
  -e "s/style={{ display: 'flex', gap: '16px' }}/className=\"flex gap-4\"/g" \
  {} \;

# 2. 替换 fontSize 相关
echo "处理字体大小样式..."
find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/style={{ fontSize: '0.75rem' }}/className=\"text-xs\"/g" \
  -e "s/style={{ fontSize: '0.85rem' }}/className=\"text-sm\"/g" \
  -e "s/style={{ fontSize: '0.875rem' }}/className=\"text-sm\"/g" \
  -e "s/style={{ fontSize: '1rem' }}/className=\"text-base\"/g" \
  -e "s/style={{ fontSize: '1.125rem' }}/className=\"text-lg\"/g" \
  -e "s/style={{ fontSize: '1.25rem' }}/className=\"text-xl\"/g" \
  {} \;

# 3. 替换 margin/padding 相关
echo "处理间距样式..."
find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/style={{ marginTop: '8px' }}/className=\"mt-2\"/g" \
  -e "s/style={{ marginTop: '16px' }}/className=\"mt-4\"/g" \
  -e "s/style={{ marginBottom: '8px' }}/className=\"mb-2\"/g" \
  -e "s/style={{ marginBottom: '16px' }}/className=\"mb-4\"/g" \
  -e "s/style={{ padding: '8px' }}/className=\"p-2\"/g" \
  -e "s/style={{ padding: '16px' }}/className=\"p-4\"/g" \
  {} \;

# 4. 替换 opacity 相关
echo "处理透明度样式..."
find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/style={{ opacity: 0.5 }}/className=\"opacity-50\"/g" \
  -e "s/style={{ opacity: 0.7 }}/className=\"opacity-70\"/g" \
  {} \;

# 5. 替换 textAlign 相关
echo "处理文字对齐样式..."
find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/style={{ textAlign: 'center' }}/className=\"text-center\"/g" \
  -e "s/style={{ textAlign: 'left' }}/className=\"text-left\"/g" \
  -e "s/style={{ textAlign: 'right' }}/className=\"text-right\"/g" \
  {} \;

# 6. 替换 cursor 相关
echo "处理光标样式..."
find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/style={{ cursor: 'pointer' }}/className=\"cursor-pointer\"/g" \
  {} \;

echo "=== 完成！==="

# 统计剩余的内联样式
echo ""
echo "=== 剩余内联样式统计 ==="
remaining=$(grep -r "style={{" apps/ components/ --include="*.tsx" | wc -l)
echo "剩余: $remaining 处"
