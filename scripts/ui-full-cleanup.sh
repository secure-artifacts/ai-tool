#!/bin/bash
# UI 统一化全量批量处理脚本
# 处理所有模块的 emoji 替换和内联样式优化

cd "/Volumes/jw/代码/🪄 AI 创作工具包/ai-创作工具包-正式版"

echo "=== 开始全量 UI 统一化处理 ==="

# 1. 批量替换常见内联样式为工具类
echo "1. 批量替换内联样式..."

find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/style={{ display: 'flex' }}/className=\"flex\"/g" \
  -e "s/style={{ display: 'flex', alignItems: 'center' }}/className=\"flex items-center\"/g" \
  -e "s/style={{ display: 'flex', justifyContent: 'center' }}/className=\"flex justify-center\"/g" \
  -e "s/style={{ display: 'flex', gap: '8px' }}/className=\"flex gap-2\"/g" \
  -e "s/style={{ display: 'flex', gap: '16px' }}/className=\"flex gap-4\"/g" \
  -e "s/style={{ display: 'flex', flexDirection: 'column' }}/className=\"flex flex-col\"/g" \
  -e "s/style={{ textAlign: 'center' }}/className=\"text-center\"/g" \
  -e "s/style={{ fontWeight: 600 }}/className=\"font-semibold\"/g" \
  -e "s/style={{ fontWeight: 'bold' }}/className=\"font-bold\"/g" \
  -e "s/style={{ fontWeight: 500 }}/className=\"font-medium\"/g" \
  -e "s/style={{ opacity: 0.5 }}/className=\"opacity-50\"/g" \
  -e "s/style={{ opacity: 0.7 }}/className=\"opacity-70\"/g" \
  -e "s/style={{ cursor: 'pointer' }}/className=\"cursor-pointer\"/g" \
  {} \;

# 2. 替换简单的 emoji 为文本符号（在不需要图标的地方）
echo "2. 简化部分 emoji..."

find apps/ components/ -name "*.tsx" -exec sed -i '' \
  -e "s/>📁</>⋮</g" \
  -e "s/>➕ />+ /g" \
  -e "s/🔄 重试/↻ 重试/g" \
  -e "s/🔄 刷新/↻ 刷新/g" \
  {} \;

# 3. 统计处理结果
echo ""
echo "=== 处理完成 ==="
echo "内联样式剩余: $(grep -r 'style={{' apps/ components/ --include='*.tsx' | wc -l | tr -d ' ') 处"
echo "Lucide 图标文件: $(grep -l \"from 'lucide-react'\" apps/ components/ -r --include='*.tsx' | wc -l | tr -d ' ') 个"

echo ""
echo "=== 各模块 emoji 统计 ==="
for dir in apps/*/; do
    name=$(basename "$dir")
    count=$(grep -roh "[📋💾✅❌🖼️⚙️🗑️✨🎨📝💡🔍📊🚀🎯💬🔑📖]" "$dir" --include="*.tsx" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -gt "0" ]; then
        echo "$name: $count 个"
    fi
done
