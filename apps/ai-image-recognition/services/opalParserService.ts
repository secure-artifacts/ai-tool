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
import { shouldUseAiStudioMode, isRunningInAiStudio } from '../../../utils/aiStudioDetect';
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
    // 优先使用主应用暴露的全局实例（包含 API 池轮换等完整逻辑）
    if (typeof window !== 'undefined' && (window as any).__app_get_ai_instance) {
        return (window as any).__app_get_ai_instance();
    }

    // 回退：自行创建实例
    const storedKey = typeof window !== 'undefined' ? localStorage.getItem('user_api_key') : null;
    const rawKey = storedKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
    const cleanKey = rawKey.trim().replace(/[^\x20-\x7E]/g, '');

    // AI Studio 环境：平台内部处理认证
    if (isRunningInAiStudio()) {
        if (cleanKey) return new GoogleGenAI({ apiKey: cleanKey });
        return new GoogleGenAI({});
    }

    if (!cleanKey) {
        throw new Error('API Key 未设置。请先在顶部配置 Google AI Key。');
    }
    if (shouldUseAiStudioMode(cleanKey)) {
        return new GoogleGenAI({ apiKey: cleanKey });
    }
    return new GoogleGenAI({ apiKey: cleanKey, vertexai: true });
};

// ===== 递归提取所有文本 =====

function extractAllTexts(
    obj: any,
    path: string = '',
    results: { path: string; text: string; length: number }[] = []
): { path: string; text: string; length: number }[] {
    if (obj === null || obj === undefined) return results;
    if (typeof obj === 'string') {
        // 降低阈值到 10 字，避免丢失短指令/短规则
        if (obj.length > 10) {
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

/** 准备文本：去重，保留全文，不做任何截断 */
function prepareTexts(texts: { path: string; text: string; length: number }[]): string {
    // 用完整文本内容去重
    const seen = new Set<string>();
    const unique = texts.filter(t => {
        const key = t.text.length <= 500
            ? t.text
            : `${t.text.substring(0, 200)}||${t.text.substring(t.text.length - 200)}||${t.text.length}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // 按长度降序排序
    const sorted = [...unique].sort((a, b) => b.length - a.length);

    // 全量保留，不截断、不采样
    const selected: string[] = [];
    for (const item of sorted) {
        selected.push(`--- [来源: ${item.path}] (${item.length}字) ---\n${item.text}`);
    }

    return selected.join('\n\n');
}

// ===== AI 库结构识别（只分类，不返回指令内容） =====

async function identifyLibraryStructure(
    preparedText: string,
    workflowTitle: string
): Promise<{
    libraryStructure: { name: string; startMarker: string }[];
    summary: string;
}> {
    const ai = getAiInstance();

    // 对于超长文本，AI只需要看到采样就能识别库结构
    let textForAI = preparedText;
    if (preparedText.length > 50000) {
        // 采样：首 5K + 每隔 10K 取 1K + 尾 5K
        const parts: string[] = [];
        parts.push(preparedText.substring(0, 5000));
        for (let pos = 10000; pos < preparedText.length - 5000; pos += 10000) {
            parts.push(`\n...(位置 ${pos})...\n` + preparedText.substring(pos, pos + 1000));
        }
        parts.push(`\n...(末尾)...\n` + preparedText.substring(preparedText.length - 5000));
        textForAI = parts.join('');
    }

    const systemInstruction = `你是一个 AI 工作流分析工具。用户给你一些从画布工作流中物理提取的节点文本。

你的唯一任务：识别哪些文本块是"随机素材库"（包含大量编号条目的列表）。

注意：
- 你只需要返回库的名称和起始标记（用于代码定位）
- 不需要返回指令内容（那已经由代码物理提取了）
- 不需要提取库的具体条目（那会在后续步骤处理）

## 输出 JSON

{
  "summary": "一句话概要",
  "libraryStructure": [
    { "name": "库名称", "startMarker": "原文中标记这个库开始位置的文字（20-50字）" }
  ]
}`;

    const userPrompt = `识别工作流 "${workflowTitle}" 中的随机素材库结构：\n\n${textForAI}`;

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
        libraryStructure: parsed.libraryStructure || [],
        summary: parsed.summary || '',
    };
}

// ===== 按需 AI 整理指令（用户主动触发） =====

export async function reorganizeInstructions(rawInstructions: ParsedInstruction[]): Promise<ParsedInstruction[]> {
    const ai = getAiInstance();

    const allText = rawInstructions.map(i => i.text).join('\n\n---\n\n');

    const systemInstruction = `你是一个 AI 工作流分析专家。用户给你多段原始指令文本，请将它们整理合并成一条结构化的基础指令。

基础指令是一个"元指令"——给"描述词生成 AI"用的规则。

你可以：
- ✅ 合并散落在不同位置的相关指令
- ✅ 重新组织排版，更清晰易读
- ✅ 调整格式（加标题、分段）
- ✅ 使用第二人称"你"来指示 AI
- ✅ 说"根据系统提供的元素信息"，不要提"随机库"

⚠️ 铁律：**不能少项目！**
- ❌ 禁止删除任何一条规则、要求、约束、描述细节
- ❌ 禁止精简掉任何条目
- ❌ 禁止用一句概括替代多条具体要求
- ❌ 禁止省略描述词模板、格式要求、质量标准

你可以"换个方式说"，但不能"少说"。
如果原文有维度名、格式模板、描述词结构，必须原封不动保留。

输出 JSON：
{
  "instructions": [
    { "name": "标题", "text": "整理后的完整指令", "type": "combined" }
  ]
}`;

    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: `请整理以下指令，可以合并重组，但不能少任何一条要求：\n\n${allText}` }] }],
        config: {
            systemInstruction,
            temperature: 0,
            responseMimeType: 'application/json',
            maxOutputTokens: 65536,
        },
    });

    let jsonStr = response.text?.trim() || '{}';
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed.instructions) && parsed.instructions.length > 0) {
        return parsed.instructions.map((instr: any, idx: number) => ({
            name: instr.name || `整理后指令 ${idx + 1}`,
            text: instr.text || '',
            type: (instr.type as 'system' | 'user' | 'combined') || 'combined',
        }));
    }

    // 失败则返回原始内容
    return rawInstructions;
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

/** 尝试从非标准内容中解析出可用数据 */
function smartParseContent(fileContent: string): { data: any; rawText?: string } {
    // 策略 1：标准 JSON
    try {
        return { data: JSON.parse(fileContent) };
    } catch { /* continue */ }

    // 策略 2：JSONL（每行一个 JSON）
    const lines = fileContent.split('\n').filter(l => l.trim());
    const jsonObjects: any[] = [];
    for (const line of lines) {
        try {
            jsonObjects.push(JSON.parse(line.trim()));
        } catch { /* skip non-JSON lines */ }
    }
    if (jsonObjects.length > 0) {
        // 合并所有 JSON 对象
        const merged = jsonObjects.length === 1
            ? jsonObjects[0]
            : { _merged: true, objects: jsonObjects };
        return { data: merged };
    }

    // 策略 3：提取文件中所有 JSON 片段（{...} 或 [...]）
    const jsonFragments: any[] = [];
    const regex = /[\[{][\s\S]*?[\]}]/g;
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
        try {
            const parsed = JSON.parse(match[0]);
            if (typeof parsed === 'object' && parsed !== null) {
                jsonFragments.push(parsed);
            }
        } catch { /* not valid JSON fragment */ }
    }
    if (jsonFragments.length > 0) {
        const merged = jsonFragments.length === 1
            ? jsonFragments[0]
            : { _merged: true, objects: jsonFragments };
        return { data: merged };
    }

    // 策略 4：纯文本兜底（整个文件当作文本内容送给 AI）
    console.log('[OpalParser] 非 JSON 文件，以纯文本模式解析');
    return { data: { _rawText: true, content: fileContent }, rawText: fileContent };
}

// ===== 画布节点物理提取（零AI，纯代码） =====

interface ExtractedNode {
    nodeIndex: number;
    nodeId: string;
    nodeType: string;
    generationMode: string;
    prompt: string;
    systemInstruction: string;
    description: string;
}

/** 从 {role, parts: [{text: "..."}]} 结构中提取纯文本 */
function extractPartsText(val: any): string {
    if (!val || typeof val !== 'object') return '';
    const parts = val.parts;
    if (!Array.isArray(parts)) return '';
    return parts
        .map((p: any) => (typeof p === 'object' && p.text ? p.text : ''))
        .filter((t: string) => t.length > 0)
        .join('\n');
}

/** 物理提取画布 JSON 中所有节点的 prompt 和 system-instruction */
function extractCanvasNodes(data: any): ExtractedNode[] {
    const nodes = data.nodes;
    if (!Array.isArray(nodes)) return [];

    const results: ExtractedNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const config = node.configuration || {};

        const prompt = extractPartsText(config['config$prompt']);
        const systemInstruction = extractPartsText(config['b-system-instruction']);
        const description = extractPartsText(config['description']);

        // 只收集有实际内容的节点
        if (prompt || systemInstruction || description) {
            results.push({
                nodeIndex: i,
                nodeId: (node.id || '').substring(0, 20),
                nodeType: node.type || '',
                generationMode: config['generation-mode'] || '',
                prompt,
                systemInstruction,
                description,
            });
        }
    }
    return results;
}

/** 将物理提取的节点内容组装成发给 AI 的文本（完整原文，零修改） */
function buildNodeContentText(nodes: ExtractedNode[]): string {
    // 去重：相同内容不重复发送（如4个节点共用同一个 system-instruction）
    const seenPrompts = new Set<string>();
    const seenSysInstr = new Set<string>();
    const parts: string[] = [];

    for (const node of nodes) {
        const modeLabel = node.generationMode ? ` [${node.generationMode}]` : '';

        if (node.description && !seenPrompts.has(node.description)) {
            seenPrompts.add(node.description);
            parts.push(`=== 节点 ${node.nodeIndex} 描述${modeLabel} ===\n${node.description}`);
        }

        if (node.prompt && !seenPrompts.has(node.prompt)) {
            seenPrompts.add(node.prompt);
            parts.push(`=== 节点 ${node.nodeIndex} Prompt${modeLabel} ===\n${node.prompt}`);
        }

        if (node.systemInstruction && !seenSysInstr.has(node.systemInstruction)) {
            seenSysInstr.add(node.systemInstruction);
            parts.push(`=== 节点 ${node.nodeIndex} System Instruction${modeLabel} ===\n${node.systemInstruction}`);
        }
    }

    return parts.join('\n\n');
}

export async function parseOpalWorkflow(fileContent: string): Promise<OpalParseResult> {
    const { data, rawText } = smartParseContent(fileContent);
    if (!data) {
        throw new Error('文件内容为空，无法解析。');
    }

    const title = data.title || data.name || '未命名工作流';

    // ============================================================
    // 第 1 步：物理提取（纯代码，零 AI）→ 直接作为指令
    // ============================================================
    const canvasNodes = extractCanvasNodes(data);

    let preparedText: string;
    let instructions: ParsedInstruction[] = [];

    if (canvasNodes.length > 0) {
        // 画布格式：直接读取节点字段
        preparedText = buildNodeContentText(canvasNodes);
        console.log(`[OpalParser] 物理提取 ${canvasNodes.length} 个节点，去重后 ${preparedText.length} 字`);

        // 指令直接来自物理提取的节点内容（去重）
        const seenTexts = new Set<string>();
        for (const node of canvasNodes) {
            const modeLabel = node.generationMode ? ` [${node.generationMode}]` : '';

            if (node.systemInstruction && !seenTexts.has(node.systemInstruction)) {
                seenTexts.add(node.systemInstruction);
                instructions.push({
                    name: `nodes[${node.nodeIndex}].configuration.b-system-instruction.parts[0].text`,
                    text: node.systemInstruction,
                    type: 'system',
                });
            }
            if (node.prompt && !seenTexts.has(node.prompt)) {
                seenTexts.add(node.prompt);
                instructions.push({
                    name: `nodes[${node.nodeIndex}].configuration.config$prompt.parts[0].text`,
                    text: node.prompt,
                    type: 'user',
                });
            }
            if (node.description && !seenTexts.has(node.description)) {
                seenTexts.add(node.description);
                instructions.push({
                    name: `nodes[${node.nodeIndex}].configuration.description`,
                    text: node.description,
                    type: 'combined',
                });
            }
        }
    } else {
        // 非画布格式 fallback：递归提取所有文本
        const allTexts = extractAllTexts(data);
        if (allTexts.length === 0) throw new Error('文件中未找到有效内容。');
        preparedText = prepareTexts(allTexts);
        console.log(`[OpalParser] 递归提取 ${allTexts.length} 段文本，去重后 ${preparedText.length} 字`);

        // fallback 模式：每段文本作为一条指令
        instructions = allTexts.map((t, idx) => ({
            name: t.path || `文本块 ${idx + 1}`,
            text: t.text,
            type: 'combined' as const,
        }));
    }

    const totalInstrLen = instructions.reduce((sum, i) => sum + i.text.length, 0);
    console.log(`[OpalParser] 物理提取指令: ${instructions.length}条 共${totalInstrLen}字`);

    // ============================================================
    // 第 2 步：AI 只识别库结构（不返回指令内容）
    // ============================================================
    console.log('[OpalParser] AI 识别库结构中...');
    const { libraryStructure, summary } = await identifyLibraryStructure(preparedText, title);
    console.log(`[OpalParser] 识别到 ${libraryStructure.length} 个库: ${libraryStructure.map(l => l.name).join(', ')}`);

    // 3. 从原文定位各库文本，每个库单独 AI 提取条目
    const ai = getAiInstance();
    // 用物理提取的原文来定位库
    const allLibText = preparedText;

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

    console.log(`[OpalParser] 完成: 指令 ${instructions.length}条, ${libraries.length} 个库`);
    libraries.forEach(lib => console.log(`  - ${lib.name}: ${lib.items.length} 条`));

    return {
        title,
        summary,
        instructions,
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
