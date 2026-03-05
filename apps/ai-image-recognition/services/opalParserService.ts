/**
 * Opal 画布工作流解析服务 v6.0
 * 
 * 核心策略：
 *   1. 递归提取 JSON 中所有长文本
 *   2. 一次 AI 调用：发送全部文本 → 返回 Skill 指令 + 库的结构信息（名称+起始标记）
 *   3. 按标记切割各库文本，每个库单独一次 AI 调用提取条目（纯文本格式，避免 JSON 截断）
 *   4. 全部 AI 驱动，零格式假设
 */

import { GoogleGenAI } from '@google/genai';
import { RandomLibrary, LIBRARY_COLORS, generateLibraryId } from './randomLibraryService';

// ===== 类型定义 =====

export interface OpalParseResult {
    title: string;
    summary: string;
    instructions: ParsedInstruction[];
    libraries: ParsedLibrary[];
}

export interface ParsedInstruction {
    name: string;
    text: string;
    type: 'system' | 'user' | 'combined';
}

export interface ParsedLibrary {
    name: string;
    items: string[];
    count: number;
}

// ===== 获取 AI 实例 =====

const getAiInstance = (): GoogleGenAI => {
    const storedKey = typeof window !== 'undefined' ? localStorage.getItem('user_api_key') : null;
    const keyToUse = storedKey || (import.meta as any).env?.VITE_GEMINI_API_KEY;
    if (!keyToUse) {
        throw new Error('API Key 未设置。请先在顶部配置 Google AI Key。');
    }
    return new GoogleGenAI({ apiKey: keyToUse });
};

// ===== 递归提取所有文本 =====

function extractAllTexts(
    obj: any,
    path: string = '',
    results: { path: string; text: string; length: number }[] = []
): { path: string; text: string; length: number }[] {
    if (obj === null || obj === undefined) return results;
    if (typeof obj === 'string') {
        if (obj.length > 50) {
            results.push({ path, text: obj, length: obj.length });
        }
        return results;
    }
    if (Array.isArray(obj)) {
        obj.forEach((item, index) => extractAllTexts(item, `${path}[${index}]`, results));
        return results;
    }
    if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            extractAllTexts(obj[key], path ? `${path}.${key}` : key, results);
        }
        return results;
    }
    return results;
}

/** 准备文本：去重 + 智能采样。长文本取首尾 + 定期采样（确保所有库标记都能被看到） */
function prepareTexts(texts: { path: string; text: string; length: number }[]): string {
    // 按长度去重（相同前200字符的视为重复）
    const seen = new Set<string>();
    const unique = texts.filter(t => {
        const key = t.text.substring(0, 200);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // 按长度降序排序
    const sorted = [...unique].sort((a, b) => b.length - a.length);

    let totalLength = 0;
    const maxTotalLength = 50000;
    const selected: string[] = [];

    for (const item of sorted) {
        let displayText: string;

        if (item.length <= 3000) {
            // 短文本：保留全文（包含 prompt、配置等关键内容）
            displayText = item.text;
        } else {
            // 长文本：首尾 + 每隔 8K 取样 500 字（确保所有库标记都被采到）
            const parts: string[] = [];
            parts.push(item.text.substring(0, 1500));

            const SAMPLE_INTERVAL = 8000;
            const SAMPLE_SIZE = 500;
            for (let pos = SAMPLE_INTERVAL; pos < item.length - 1500; pos += SAMPLE_INTERVAL) {
                parts.push(`\n...(位置 ${pos})...\n` + item.text.substring(pos, pos + SAMPLE_SIZE));
            }

            parts.push(`\n...(末尾)...\n` + item.text.substring(item.length - 1500));
            displayText = parts.join('');
        }

        if (totalLength + displayText.length > maxTotalLength) continue;
        selected.push(`--- [来源: ${item.path}] (原文${item.length}字) ---\n${displayText}`);
        totalLength += displayText.length;
    }

    return selected.join('\n\n');
}

// ===== 第 1 步：全量分析（指令 + 库结构） =====

async function analyzeFullWorkflow(
    preparedText: string,
    workflowTitle: string
): Promise<{
    instruction: ParsedInstruction;
    libraryStructure: { name: string; startMarker: string }[];
    summary: string;
}> {
    const ai = getAiInstance();

    const systemInstruction = `你是一个 AI 工作流分析专家。用户会给你从一个 AI 生图/生视频工作流配置文件中提取的所有文本内容。

这些文件来自不同的用户，格式各异，没有固定规则。你需要通过理解内容来分析。

## 你的任务

### 任务 1：生成基础指令（Skill）
理解工作流的业务逻辑后，生成一条标准格式的基础指令。

基础指令是一个"元指令"——不是直接给生图模型用的描述词，而是给"描述词生成 AI"用的规则。

基础指令必须包含这些模块：
【角色与目标】定义 AI 角色和任务
【输入变量】系统提供哪些元素信息（用 {维度名} 标注可变维度）
【生成流程】如何把元素组合成描述词
【输出要求】仅输出 1 条最终描述词正文
【质量自检】检查项
【描述词结构模板】用 {维度名} 标注可变部分，其余为固定文字

规则：
- 使用第二人称"你"来指示 AI
- 说"根据系统提供的元素信息"，不要提"随机库"
- 保留原始内容中所有有价值的描述细节和约束条件

### 任务 2：识别随机素材库结构
找出文本中所有随机素材库，告诉我每个库的：
- 名称
- 起始标记（文本中标记这个库开始位置的原文文字，用于代码定位）

注意：不需要提取具体条目内容（那会在后续步骤处理），只需要库名和起始标记。

## 输出格式（严格 JSON）

{
  "summary": "一句话概要",
  "instruction": {
    "name": "指令名称",
    "text": "完整的 Skill 格式基础指令（含所有模块）",
    "type": "combined"
  },
  "libraryStructure": [
    { "name": "库名称", "startMarker": "标记这个库开始的原文文字" }
  ]
}`;

    const userPrompt = `请分析工作流 "${workflowTitle}" 中提取的所有文本内容：\n\n${preparedText}`;

    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
            systemInstruction,
            temperature: 0,
            responseMimeType: 'application/json',
        },
    });

    let jsonStr = response.text?.trim() || '{}';
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(jsonStr);

    return {
        instruction: {
            name: parsed.instruction?.name || '基础指令',
            text: parsed.instruction?.text || '',
            type: 'combined',
        },
        libraryStructure: parsed.libraryStructure || [],
        summary: parsed.summary || '',
    };
}

// ===== 第 2 步：单个库条目提取（纯文本格式） =====

const ITEM_SEP = '====ITEM_BOUNDARY====';

async function extractLibraryItems(
    ai: GoogleGenAI,
    libraryText: string,
    libraryName: string
): Promise<string[]> {
    const sysInstr = `你是一个文本提取工具。用户给你一段来自"${libraryName}"的文本内容。
请识别并提取其中的所有独立条目/项。

规则：
- 每个条目保持原文完整，不缩写不省略不改写
- 去掉编号（如"1."、"2."等序号）
- 如果多行文本属于同一个条目，合并为一条
- 条目之间用 ${ITEM_SEP} 分隔
- 直接输出纯文本，不要输出 JSON 或 markdown 代码块

输出格式：
第一个条目的完整原文
${ITEM_SEP}
第二个条目的完整原文
${ITEM_SEP}
第三个条目的完整原文`;

    try {
        const resp = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: [{ role: 'user', parts: [{ text: libraryText }] }],
            config: { systemInstruction: sysInstr, temperature: 0, maxOutputTokens: 65536 },
        });
        const text = resp.text?.trim() || '';
        if (!text) return [];

        const items = text.split(ITEM_SEP).map(s => s.trim()).filter(s => s.length > 5);
        return items;
    } catch (err: any) {
        console.error(`[OpalParser] ${libraryName} 提取失败:`, err.message);
        return [];
    }
}

// ===== 公开 API =====

export async function parseOpalWorkflow(fileContent: string): Promise<OpalParseResult> {
    let data: any;
    try {
        data = JSON.parse(fileContent);
    } catch {
        throw new Error('文件格式错误：不是有效的 JSON 文件。');
    }

    const title = data.title || data.name || '未命名工作流';

    // 1. 递归提取所有文本 + 去重
    const allTexts = extractAllTexts(data);
    if (allTexts.length === 0) throw new Error('文件中未找到有效内容。');

    const preparedText = prepareTexts(allTexts); // 发全文，确保准确
    console.log(`[OpalParser] 提取 ${allTexts.length} 段文本，去重后 ${preparedText.length} 字`);

    // 2. 第一次 AI 调用：全量分析（返回指令 + 库结构）
    console.log('[OpalParser] AI 全量分析中...');
    const { instruction, libraryStructure, summary } = await analyzeFullWorkflow(preparedText, title);
    console.log(`[OpalParser] 指令: ${instruction.text.length}字, 识别到 ${libraryStructure.length} 个库: ${libraryStructure.map(l => l.name).join(', ')}`);

    // 3. 从原文定位各库文本，每个库单独 AI 提取条目
    const ai = getAiInstance();
    const allLibText = allTexts.map(t => t.text).join('\n');

    const libraryPromises = libraryStructure.map(async (libDef) => {
        // 在原文中找到这个库的文本
        const startIdx = allLibText.indexOf(libDef.startMarker);
        if (startIdx === -1) {
            console.warn(`[OpalParser] 找不到库标记: "${libDef.startMarker.substring(0, 50)}..."`);
            return { name: libDef.name, items: [] as string[] };
        }

        const contentStart = startIdx + libDef.startMarker.length;

        // 找到下一个库的起始位置作为结束
        let contentEnd = allLibText.length;
        for (const otherLib of libraryStructure) {
            if (otherLib === libDef) continue;
            const otherIdx = allLibText.indexOf(otherLib.startMarker, contentStart);
            if (otherIdx !== -1 && otherIdx < contentEnd) {
                contentEnd = otherIdx;
            }
        }

        const sectionText = allLibText.substring(contentStart, contentEnd).trim();
        console.log(`[OpalParser] ${libDef.name}: ${sectionText.length}字，开始 AI 提取条目...`);

        // 小库直接一次提取，大库分块并行
        const CHUNK_LIMIT = 10000;
        if (sectionText.length <= CHUNK_LIMIT) {
            const items = await extractLibraryItems(ai, sectionText, libDef.name);
            return { name: libDef.name, items };
        }

        // 大库：在段落边界分块
        const chunks: string[] = [];
        let pos = 0;
        while (pos < sectionText.length) {
            let end = Math.min(pos + CHUNK_LIMIT, sectionText.length);
            if (end < sectionText.length) {
                // 找最近的双换行切割
                const bp = sectionText.lastIndexOf('\n\n', end);
                if (bp > pos + CHUNK_LIMIT * 0.4) end = bp;
            }
            chunks.push(sectionText.substring(pos, end));
            pos = end;
        }
        console.log(`[OpalParser] ${libDef.name}: 分成 ${chunks.length} 块并行处理`);

        // 并行处理所有块
        const chunkResults = await Promise.all(
            chunks.map((chunk, idx) => extractLibraryItems(ai, chunk, `${libDef.name}(块${idx + 1}/${chunks.length})`))
        );
        const allItems = chunkResults.flat();
        return { name: libDef.name, items: allItems };
    });

    // 并行提取所有库
    const libraryResults = await Promise.all(libraryPromises);

    const libraries: ParsedLibrary[] = libraryResults
        .filter(r => r.items.length > 0)
        .map(r => ({ name: r.name, items: r.items, count: r.items.length }));

    console.log(`[OpalParser] 完成: 指令 ${instruction.text.length}字, ${libraries.length} 个库`);
    libraries.forEach(lib => console.log(`  - ${lib.name}: ${lib.items.length} 条`));

    return {
        title,
        summary,
        instructions: instruction.text ? [instruction] : [],
        libraries,
    };
}

export function convertToRandomLibraries(parseResult: OpalParseResult): RandomLibrary[] {
    const now = Date.now();
    return parseResult.libraries.map((lib, index) => ({
        id: generateLibraryId(),
        name: lib.name,
        values: lib.items,
        enabled: true,
        pickMode: 'random-one' as const,
        pickCount: 1,
        color: LIBRARY_COLORS[index % LIBRARY_COLORS.length],
        sourceSheet: `画布: ${parseResult.title}`,
        createdAt: now,
        updatedAt: now,
    }));
}

export function combineInstructions(parseResult: OpalParseResult): string {
    if (parseResult.instructions.length === 0) return '';
    if (parseResult.instructions.length === 1) return parseResult.instructions[0].text;
    return parseResult.instructions
        .map((instr) => `${instr.name}:\n${instr.text}`)
        .join('\n\n---\n\n');
}
