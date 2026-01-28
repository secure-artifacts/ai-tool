import { GoogleGenAI, Type } from "@google/genai";
import { SheetData, ChartDefinition } from "../types";
import { extractImageFromFormula, fetchImageAsBase64 } from "../utils/parser";

const MODEL_NAME = 'gemini-2.5-flash';

interface AnalysisResult {
    text: string;
    relatedChart?: ChartDefinition;
}

export const analyzeData = async (
    prompt: string,
    dataContext: SheetData,
    history: string[] = [],
    getAiInstance: () => GoogleGenAI
): Promise<AnalysisResult> => {
    const ai = getAiInstance();

    // To optimize token usage, we limit the rows sent.
    // We send the headers and the first 50 rows for text context.
    const previewRows = dataContext.rows.slice(0, 50);
    const dataString = JSON.stringify(previewRows);
    const totalRowsCount = dataContext.rows.length;

    let systemInstruction = `
    你是一位专家级的数据分析师和谷歌表格专家。
    你正在帮助用户分析一个电子表格。请使用简体中文进行回复。
    
    用户上传了一个名为 "${dataContext.fileName}" 的文件。
    总行数: ${totalRowsCount} 行。
    列名: ${dataContext.columns.join(', ')}.
    
    你的能力:
    1. 总结数据趋势。
    2. 根据文本描述对数据进行分类。
    3. 分析公式（特别是 =IMAGE 公式或图片链接）。
    4. 结合视觉内容（图片）和表格文本数据进行多模态分析。
    5. **可视化数据**：如果用户的请求涉及统计数量、分布对比、或明确要求图表，你需要生成图表数据。
    
    以下是数据的文本样本（前 50 行）：
    ${dataString}

    如果用户询问可以从样本中计算出的具体统计数据，请进行计算。

    【重要：图表生成规则】
    如果你的回答包含数据统计（例如"A有10个，B有5个"），或者用户要求"画图"、"可视化"，请在回复的最后面附带一个 JSON 代码块来定义图表。
    格式必须严格如下：
    \`\`\`json:chart
    {
      "type": "bar" 或 "pie",
      "title": "图表标题",
      "data": [
        {"name": "类别1", "value": 10},
        {"name": "类别2", "value": 20}
      ],
      "categoryKey": "name",
      "dataKey": "value"
    }
    \`\`\`
    
    使用 Markdown 格式化你的回复文本部分。
  `;

    // 1. Detect Intent
    const promptLower = prompt.toLowerCase();
    const imageKeywords = ['图片', '照片', '图', 'image', 'picture', 'photo', 'img', 'pic'];
    const bulkKeywords = ['所有', '全部', '对比', '分析', '归类', '整体', '总结', '趋势', 'all', 'compare', 'analyze', 'categorize', 'summary', 'trend'];

    const hasImageKeyword = imageKeywords.some(k => promptLower.includes(k));
    const hasBulkKeyword = bulkKeywords.some(k => promptLower.includes(k));

    // Check if it's strictly asking for a chart without image implication
    const isChartRequest = ['chart', 'graph', 'plot', '图表', '画图', '可视化', '统计'].some(k => promptLower.includes(k));

    const isAskingAboutImages = hasImageKeyword && !isChartRequest; // If asking for "chart of images", logic might overlap, but prioritize visual analysis if "picture" is dominant
    // If user explicitly asks to compare/analyze all, or if it's a general image query on a larger dataset
    const isBulkImageAnalysis = hasImageKeyword && (hasBulkKeyword || totalRowsCount > 5);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let userParts: any[] = [];

    // 2. Image Handling Strategy
    if (isAskingAboutImages) {
        // Determine sampling strategy
        const maxImages = isBulkImageAnalysis ? 15 : 3;

        // Step 2.1: Scan ALL rows to find image candidates
        const imageCandidates: { url: string, rowIdx: number, colName: string }[] = [];
        const seenUrls = new Set<string>();

        for (let i = 0; i < dataContext.rows.length; i++) {
            const row = dataContext.rows[i];
            for (const [key, val] of Object.entries(row)) {
                const url = extractImageFromFormula(val as string);
                if (url && !seenUrls.has(url)) {
                    if (url.startsWith('http')) {
                        imageCandidates.push({ url, rowIdx: i, colName: key });
                        seenUrls.add(url);
                    }
                }
            }
        }

        // Step 2.2: Apply Sampling
        const selectedCandidates: typeof imageCandidates = [];
        if (imageCandidates.length > 0) {
            if (imageCandidates.length <= maxImages) {
                selectedCandidates.push(...imageCandidates);
            } else {
                const step = Math.max(1, Math.floor(imageCandidates.length / maxImages));
                for (let i = 0; i < maxImages; i++) {
                    const idx = Math.min(i * step, imageCandidates.length - 1);
                    if (!selectedCandidates.includes(imageCandidates[idx])) {
                        selectedCandidates.push(imageCandidates[idx]);
                    }
                }
            }
        }

        // Step 2.3: Parallel Fetching
        if (selectedCandidates.length > 0) {
            const imagePromises = selectedCandidates.map(async (cand) => {
                try {
                    const base64Data = await fetchImageAsBase64(cand.url);
                    if (base64Data) {
                        return {
                            valid: true,
                            labelPart: { text: `[参考图片] 样本来自第 ${cand.rowIdx + 1} 行, 列 "${cand.colName}":` },
                            imagePart: {
                                inlineData: {
                                    mimeType: "image/jpeg",
                                    data: base64Data
                                }
                            }
                        };
                    }
                } catch (e) {
                    console.warn(`Failed to fetch image at row ${cand.rowIdx}`, e);
                }
                return { valid: false };
            });

            const fetchedImages = await Promise.all(imagePromises);
            const validImages = fetchedImages.filter(img => img.valid);

            if (validImages.length > 0) {
                systemInstruction += `\n\n【多模态分析模式已激活】
            注意：用户正在询问有关图片的问题。我已从数据集中抽取了 ${validImages.length} 张图片作为样本。
            请结合视觉内容进行分析。`;

                for (const img of validImages) {
                    if (img.valid) {
                        userParts.push(img.labelPart);
                        userParts.push(img.imagePart);
                    }
                }
            }
        }
    }

    // Add the actual text prompt at the end
    userParts.push({ text: prompt });

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [
                ...history.map(h => ({ role: 'user', parts: [{ text: h }] })),
                { role: 'user', parts: userParts }
            ],
            config: {
                systemInstruction: systemInstruction,
                thinkingConfig: { thinkingBudget: 1024 }
            }
        });

        const fullText = response.text || "我无法生成回复。";

        // Parse Chart JSON if present
        const chartRegex = /```json:chart([\s\S]*?)```/;
        const match = fullText.match(chartRegex);

        let relatedChart: ChartDefinition | undefined;
        let cleanText = fullText;

        if (match && match[1]) {
            try {
                relatedChart = JSON.parse(match[1]);
                // Remove the JSON block from the text shown to user to keep it clean
                cleanText = fullText.replace(chartRegex, '').trim();
            } catch (e) {
                console.warn("Failed to parse chart JSON from model response", e);
            }
        }

        return { text: cleanText, relatedChart };

    } catch (error) {
        console.error("Gemini API Error:", error);
        throw new Error("分析数据失败。请检查您的 API 密钥或重试。");
    }
};

export const suggestCategorization = async (
    columnName: string,
    uniqueValues: string[],
    getAiInstance: () => GoogleGenAI
): Promise<string> => {
    const ai = getAiInstance();

    const prompt = `
    我的电子表格中有一列名为 "${columnName}"。
    这是其中的一些唯一值: ${JSON.stringify(uniqueValues.slice(0, 50))}.
    
    请建议 3-5 个高级类别，这些项目可以归入其中。
    请只返回一个 JSON 字符串数组。
  `;
    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        });
        return response.text || "[]";
    } catch (error) {
        return "[]";
    }
};
