// AI 智能判断去重服务
import { GoogleGenAI } from "@google/genai";

export interface CopyItemForJudge {
    id: string;
    index: number;
    text: string;
    chineseText?: string;
}

export interface SimilarPair {
    index1: number;
    index2: number;
    relationship: 'duplicate' | 'variant_keep_both' | 'contains_keep_short' | 'independent';
    reason: string;
    keepIndex: number; // 保留哪一个（如果是独立则为-1）
}

export interface AIJudgeResult {
    uniqueIndices: number[];      // 独特文案的索引（兼容旧格式）
    uniqueItems: {                // 独特文案带原因
        index: number;
        reason: string;
    }[];
    duplicateGroups: {            // 重复组
        keepIndex: number;        // 保留的文案索引
        removeIndices: number[];  // 删除的文案索引
        reason: string;           // 判断理由
    }[];
    totalProcessed: number;
    uniqueCount: number;
    duplicateCount: number;
}

const JUDGE_SYSTEM_PROMPT = `你是一个专业的文案去重与清洗专家。你需要分析一批"情感/宗教/祈祷"类的短文案，找出重复和相似的内容。

# 预处理规则（分析时忽略这些部分）:
- 忽略通用标题（如："THE MOST POWERFUL PRAYER", "Read it once", "A sign from God"）
- 忽略互动引导语（如："Type Amen", "Share this", "Pass to someone", "Link in bio"）
- 忽略乱码或无意义的噪音

# 相似度判断标准（只比对核心正文）:

1. 【完全重复】语义重合度 > 90%（包括只是替换了几个同义词）
   -> 只保留版本最干净、排版最好的一条
   
2. 【包含关系】文案B完全包含文案A，但增加内容 < 10%
   -> 只保留较短的原始版本A
   
3. 【变体保留】虽然相似，但有明显的"时效性信息"或"特定场景"差异
   -> 两条都保留
   
4. 【标题党区分】标题一样但正文核心内容完全不同
   -> 两条都保留

# 输出格式（严格JSON）:
{
  "uniqueIndices": [独特文案的序号数组],
  "duplicateGroups": [
    {
      "keepIndex": 保留的文案序号,
      "removeIndices": [要删除的文案序号数组],
      "reason": "判断理由（简短）"
    }
  ]
}`;

/**
 * 使用 AI 判断文案去重
 * 分批处理以避免超出 token 限制
 */
export async function judgeWithAI(
    items: CopyItemForJudge[],
    ai: GoogleGenAI,
    textModel: string,
    customPrompt: string,
    onProgress?: (current: number, total: number, status: string) => void
): Promise<AIJudgeResult> {
    const BATCH_SIZE = 20; // 每批处理20条

    // 如果文案数量较少，直接一次性处理
    if (items.length <= BATCH_SIZE) {
        onProgress?.(0, 1, 'AI 正在分析文案...');
        const result = await judgeBatch(items, ai, textModel, customPrompt);
        onProgress?.(1, 1, '分析完成');
        return result;
    }

    // 分批处理
    const allResults: AIJudgeResult = {
        uniqueIndices: [],
        uniqueItems: [],
        duplicateGroups: [],
        totalProcessed: items.length,
        uniqueCount: 0,
        duplicateCount: 0
    };

    const totalBatches = Math.ceil(items.length / BATCH_SIZE);

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batchIndex = Math.floor(i / BATCH_SIZE);
        const batch = items.slice(i, i + BATCH_SIZE);

        onProgress?.(batchIndex, totalBatches, `AI 分析中 (${batchIndex + 1}/${totalBatches})...`);

        try {
            const batchResult = await judgeBatch(batch, ai, textModel, customPrompt);

            // 合并结果
            allResults.uniqueIndices.push(...batchResult.uniqueIndices);
            allResults.duplicateGroups.push(...batchResult.duplicateGroups);

        } catch (error) {
            console.error(`批次 ${batchIndex + 1} 处理失败:`, error);
            // 如果失败，把这批都当作独特的
            batch.forEach(item => allResults.uniqueIndices.push(item.index));
        }

        // 批次间延迟
        if (i + BATCH_SIZE < items.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // 计算统计
    const removedSet = new Set<number>();
    allResults.duplicateGroups.forEach(g => {
        g.removeIndices.forEach(idx => removedSet.add(idx));
    });

    allResults.uniqueCount = items.length - removedSet.size;
    allResults.duplicateCount = removedSet.size;

    return allResults;
}

/**
 * 处理单个批次
 */
async function judgeBatch(
    items: CopyItemForJudge[],
    ai: GoogleGenAI,
    textModel: string,
    customPrompt: string
): Promise<AIJudgeResult> {
    // 构建用户提示
    const userPrompt = `请分析以下 ${items.length} 条文案，找出重复/相似的内容，并返回去重结果。

文案列表：
${items.map(item => `[${item.index}] ${item.text}`).join('\n\n')}

请严格按照 JSON 格式返回结果，不要有任何其他内容。`;

    try {
        const result = await ai.models.generateContent({
            model: textModel,
            contents: { parts: [{ text: userPrompt }] },
            config: {
                systemInstruction: customPrompt
            }
        });

        const responseText = result.text?.trim() || '{}';

        // 调试日志
        console.log('=== AI 去重返回结果 ===');
        console.log('原始返回:', responseText);

        // 解析 JSON
        let parsed: any;
        try {
            // 尝试直接解析
            parsed = JSON.parse(responseText);
        } catch {
            // 尝试提取 JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('无法解析 AI 返回的 JSON');
            }
        }

        console.log('解析后:', parsed);
        console.log('uniqueIndices:', parsed.uniqueIndices);
        console.log('duplicateGroups:', parsed.duplicateGroups);

        // 构建结果
        // 支持新格式 uniqueItems 和旧格式 uniqueIndices
        const uniqueItems: AIJudgeResult['uniqueItems'] = (parsed.uniqueItems || []).map((item: any) => ({
            index: item.index,
            reason: item.reason || '独特文案'
        }));
        const uniqueIndices: number[] = parsed.uniqueIndices || uniqueItems.map((item: any) => item.index);
        const duplicateGroups: AIJudgeResult['duplicateGroups'] = (parsed.duplicateGroups || []).map((g: any) => ({
            keepIndex: g.keepIndex,
            removeIndices: g.removeIndices || [],
            reason: g.reason || ''
        }));

        // 计算被删除的索引
        const removedSet = new Set<number>();
        duplicateGroups.forEach(g => {
            g.removeIndices.forEach(idx => removedSet.add(idx));
        });

        // 确保所有未被删除的都在 uniqueIndices 中
        items.forEach(item => {
            if (!removedSet.has(item.index) && !uniqueIndices.includes(item.index)) {
                uniqueIndices.push(item.index);
            }
        });

        return {
            uniqueIndices,
            uniqueItems,
            duplicateGroups,
            totalProcessed: items.length,
            uniqueCount: uniqueIndices.length,
            duplicateCount: removedSet.size
        };

    } catch (error: any) {
        console.error('AI 判断失败:', error);
        // 抛出错误让调用方处理
        const errorMessage = error?.message || error?.toString() || '未知错误';
        if (errorMessage.includes('429') || errorMessage.includes('quota')) {
            throw new Error('API 配额已用尽，请更换 API Key 或稍后再试');
        }
        throw new Error(`AI 分析失败: ${errorMessage}`);
    }
}
