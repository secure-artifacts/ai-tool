import { DEFAULT_INSTRUCTION, DEFAULT_SYSTEM_INSTRUCTION } from '../CopywritingView';

export interface PromptToolBatchOptions {
    textModel: string;
    inst: string;
    autoTranslate: boolean;
    systemInstruction?: string;
}

export async function promptToolBatchExecute(
    ai: any,
    batchItems: string[],
    options: PromptToolBatchOptions
): Promise<Array<{ foreign: string; chinese: string; rawResponse: string }>> {
    const {
        textModel,
        inst,
        autoTranslate,
        systemInstruction = DEFAULT_SYSTEM_INSTRUCTION
    } = options;

    const numberedInputs = batchItems.map((item, idx) => `[${idx + 1}] ${item}`).join('\n\n');

    let systemPrompt: string;
    let userPrompt: string;

    const hasCustomFormat = inst.includes('|||');
    if (hasCustomFormat) {
        systemPrompt = `${systemInstruction}\n\n【批量处理输出规则】\n你需要处理多条文案，每条以 [编号] 开头。\n对于每条文案，严格按用户指令中的输出格式输出，使用 ||| 作为分隔符。\n每条结果占一行，格式为：[编号] 结果内容`;
        userPrompt = `改写指令：\n${inst}\n\n请处理以下每条文案：\n\n${numberedInputs}\n\n按用户指令中的格式输出每条结果，每条以 [编号] 开头`;
    } else if (!autoTranslate) {
        systemPrompt = `${systemInstruction}\n\n【批量处理输出规则】\n你需要处理多条文案，每条以 [编号] 开头。\n对于每条文案，只输出改写结果，不需要翻译。\n每条结果占一行，格式为：[编号] 改写结果`;
        userPrompt = `改写指令：\n${inst}\n\n请处理以下每条文案：\n\n${numberedInputs}\n\n按格式输出每条结果：[编号] 改写结果`;
    } else {
        systemPrompt = `${systemInstruction}\n\n【批量处理输出规则】\n你需要处理多条文案，每条以 [编号] 开头。\n对于每条文案，输出格式为：[编号] 改写后的外文|||中文翻译\n每条结果中有且仅有一个 ||| 分隔符。\n\n【重要】\n- 用户指令中的格式要求属于内容层，在 ||| 的左右两部分中分别应用\n- 如果用户指令要求输出中文或双语，忽略该要求，统一由 ||| 右侧的中文翻译提供\n- ||| 是语言版本分界符，每条结果中只能出现一次`;
        userPrompt = `改写指令：\n${inst}\n\n请处理以下每条文案：\n\n${numberedInputs}\n\n按格式输出每条结果：[编号] 改写后的外文|||中文翻译`;
    }

    let apiResult: any;
    for (let attempt = 0; attempt <= 3; attempt++) {
        try {
            apiResult = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: userPrompt }] },
                config: { systemInstruction: systemPrompt }
            });
            break;
        } catch (retryError: any) {
            const msg = retryError?.message || '';
            const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
            if (is429 && attempt < 3) {
                const waitSec = Math.pow(2, attempt + 1) * 2.5;
                console.warn(`[PromptTool] 429限速，第${attempt + 1}次重试，等待${waitSec}s`);
                await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                continue;
            }
            throw retryError;
        }
    }

    const responseText = apiResult.text?.trim() || '';
    const lines = responseText.split('\n').filter((line: string) => line.trim());
    
    // Default mapped output
    const results = new Array(batchItems.length).fill({ foreign: '', chinese: '', rawResponse: '' });

    for (const line of lines) {
        const match = line.match(/^\[(\d+)\]\s*(.+)$/);
        if (match) {
            const idx = parseInt(match[1], 10) - 1;
            const content = match[2].trim();

            if (idx >= 0 && idx < batchItems.length) {
                if (!autoTranslate && !hasCustomFormat) {
                    results[idx] = { foreign: content, chinese: '', rawResponse: content };
                } else {
                    const parts = content.split('|||');
                    if (parts.length >= 2) {
                        results[idx] = {
                            foreign: parts[0].trim(),
                            chinese: parts[1].trim(),
                            rawResponse: content
                        };
                    } else {
                        results[idx] = { foreign: content, chinese: '(解析失败)', rawResponse: content };
                    }
                }
            }
        }
    }

    return results;
}
