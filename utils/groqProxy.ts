/**
 * Groq 全局代理 — 让所有模块透明使用 Groq
 * 
 * 原理：
 *   1. 在全局模型选择器中加入 Groq 模型（前缀 "groq:"）
 *   2. 代理 GoogleGenAI 实例的 models.generateContent()
 *   3. 如果当前模型是 Groq → 拦截请求 → 转发到 Groq API
 *   4. 如果请求包含图片 → 抛出友好错误
 *   5. 如果 Groq 被限速 (429) → 自动降级回 Google
 * 
 * 智能 Key 路由：
 *   - Groq 模型 (groq:xxx) → 自动使用 gsk_ Key 池
 *   - Google 模型 (gemini-*, gemma-*) → 自动使用 AIza Key 池
 *   - 错误反馈精确区分：Key 问题 / 模型问题 / 配额问题
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEYS_STORAGE_KEYS = ['smart_translate_groq_keys', 'groqKeys'];

// ─── 工具函数 ────────────────────────────────────────────

/** 判断模型 ID 是否为 Groq 模型 */
export function isGroqModel(modelId: string): boolean {
    return modelId.startsWith('groq:');
}

/** 获取真实 Groq 模型 ID（去掉前缀） */
export function getGroqModelId(modelId: string): string {
    return modelId.replace(/^groq:/, '');
}

/** 从 localStorage 读取 Groq Key 池 */
function getGroqKeys(): string[] {
    try {
        const merged = new Set<string>();
        for (const storageKey of GROQ_KEYS_STORAGE_KEYS) {
            const raw = localStorage.getItem(storageKey);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) continue;
            parsed.forEach((k: string) => {
                const trimmed = String(k || '').trim();
                if (trimmed) merged.add(trimmed);
            });
        }
        return Array.from(merged);
    } catch {
        return [];
    }
}

/** Key 掩码：只显示前8后4位，中间用 *** 代替 */
function maskKey(key: string): string {
    if (key.length <= 16) return key.substring(0, 4) + '***';
    return key.substring(0, 8) + '***' + key.substring(key.length - 4);
}

/** Groq Key 健康状态追踪 */
interface GroqKeyStatus {
    key: string;
    failCount: number;
    lastError: string;
    lastFailTime: number;
    isInvalid: boolean; // 永久无效（401/403）
    rateLimitedUntil: number; // 限速恢复时间
}

const _groqKeyStatusMap = new Map<string, GroqKeyStatus>();

function getKeyStatus(key: string): GroqKeyStatus {
    if (!_groqKeyStatusMap.has(key)) {
        _groqKeyStatusMap.set(key, {
            key, failCount: 0, lastError: '', lastFailTime: 0,
            isInvalid: false, rateLimitedUntil: 0,
        });
    }
    return _groqKeyStatusMap.get(key)!;
}

function markKeyError(key: string, errorType: 'invalid' | 'rate_limit' | 'model_error' | 'other', message: string) {
    const status = getKeyStatus(key);
    status.failCount++;
    status.lastError = message;
    status.lastFailTime = Date.now();
    if (errorType === 'invalid') {
        status.isInvalid = true;
    } else if (errorType === 'rate_limit') {
        // 限速通常 60 秒后恢复
        status.rateLimitedUntil = Date.now() + 60_000;
    }
}

function isKeyAvailable(key: string): boolean {
    const status = getKeyStatus(key);
    if (status.isInvalid) return false;
    if (status.rateLimitedUntil > Date.now()) return false;
    return true;
}

/** 轮换索引 */
let _groqKeyIndex = 0;

/** 获取下一个可用的 Groq Key，跳过无效和限速的 */
function getNextAvailableGroqKey(): { key: string | null; allInvalid: boolean; allRateLimited: boolean; diagnostics: string } {
    const keys = getGroqKeys();
    if (keys.length === 0) {
        return { key: null, allInvalid: false, allRateLimited: false, diagnostics: '未配置 Groq API Key' };
    }

    let invalidCount = 0;
    let rateLimitedCount = 0;

    // 尝试所有 key
    for (let i = 0; i < keys.length; i++) {
        const idx = (_groqKeyIndex + i) % keys.length;
        const key = keys[idx];
        const status = getKeyStatus(key);

        if (status.isInvalid) {
            invalidCount++;
            continue;
        }
        if (status.rateLimitedUntil > Date.now()) {
            rateLimitedCount++;
            continue;
        }

        // 找到可用 key
        _groqKeyIndex = idx + 1;
        return { key, allInvalid: false, allRateLimited: false, diagnostics: '' };
    }

    // 所有 key 都不可用
    const allInvalid = invalidCount === keys.length;
    const allRateLimited = rateLimitedCount === keys.length;

    let diagnostics = '';
    if (allInvalid) {
        diagnostics = `全部 ${keys.length} 个 Groq Key 均无效（401/403），请检查 Key 是否正确`;
    } else if (allRateLimited) {
        const minWait = Math.min(...keys.map(k => getKeyStatus(k).rateLimitedUntil)) - Date.now();
        diagnostics = `全部 ${keys.length} 个 Groq Key 均限速，预计 ${Math.ceil(minWait / 1000)} 秒后恢复`;
    } else {
        diagnostics = `${invalidCount} 个无效 + ${rateLimitedCount} 个限速 = 无可用 Key`;
    }

    return { key: null, allInvalid, allRateLimited, diagnostics };
}

// ─── 请求内容检测 ────────────────────────────────────────

/** 检查 generateContent 参数是否包含图片/二进制数据 */
function containsImageData(params: any): boolean {
    const contents = params?.contents;
    if (!contents) return false;

    const checkParts = (parts: any[]): boolean => {
        if (!Array.isArray(parts)) return false;
        return parts.some((p: any) =>
            p?.inlineData || p?.inline_data || p?.fileData || p?.file_data
        );
    };

    if (typeof contents === 'string') return false;
    if (Array.isArray(contents)) {
        return contents.some((c: any) => {
            if (typeof c === 'string') return false;
            return checkParts(c?.parts || []);
        });
    }
    if (typeof contents === 'object' && contents.parts) {
        return checkParts(contents.parts);
    }
    return false;
}

/** 检查并移除不受支持的 Gemini 特性（工具等），返回是否移除了重要工具以便对外提示 */
function stripUnsupportedFeatures(params: any): boolean {
    let strippedTool = false;
    if (params?.config) {
        try {
            if (params.config.tools && params.config.tools.length > 0) {
                // 安全克隆防止 Strict Mode 报错（冻结对象无法 delete）
                params.config = { ...params.config };
                delete params.config.tools;
                strippedTool = true;
            }
            if (params.config.thinkingConfig) {
                params.config = { ...params.config };
                delete params.config.thinkingConfig;
            }
        } catch (e) {
            console.warn('[GroqProxy] strippedTool failed due to strict mode or frozen object', e);
        }
    }
    return strippedTool;
}

// ─── 格式转换 ────────────────────────────────────────────

/** 将 Google generateContent 参数转换为 Groq messages 格式 */
function convertToGroqMessages(params: any): { messages: any[]; temperature?: number; maxTokens?: number; jsonMode?: boolean } {
    const messages: any[] = [];
    const config = params?.config || {};

    // System instruction
    if (config.systemInstruction) {
        const sysText = typeof config.systemInstruction === 'string'
            ? config.systemInstruction
            : config.systemInstruction?.parts?.[0]?.text || '';
        if (sysText) {
            messages.push({ role: 'system', content: sysText });
        }
    }

    // Contents → messages
    const contents = params?.contents;
    
    // 助手函数：将 Google parts 转换为 OpenAI/Groq array
    const processParts = (parts: any[]) => {
        const groqContentArray: any[] = [];
        for (const p of parts) {
            if (typeof p === 'string') {
                groqContentArray.push({ type: 'text', text: p });
            } else if (p.text) {
                groqContentArray.push({ type: 'text', text: p.text });
            } else if (p.inlineData || p.inline_data || p.fileData || p.file_data) {
                // OpenAI Vision 格式
                const dataObj = p.inlineData || p.inline_data;
                if (dataObj && dataObj.data && dataObj.mimeType) {
                    groqContentArray.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${dataObj.mimeType};base64,${dataObj.data}`
                        }
                    });
                }
            }
        }
        // 如果全都是纯文本，可以退化为 string，否则保持 array 结构
        if (groqContentArray.every(item => item.type === 'text')) {
            return groqContentArray.map(item => item.text).join('\n');
        }
        return groqContentArray;
    };

    if (typeof contents === 'string') {
        messages.push({ role: 'user', content: contents });
    } else if (Array.isArray(contents)) {
        for (const c of contents) {
            if (typeof c === 'string') {
                messages.push({ role: 'user', content: c });
            } else if (c?.role && c?.parts) {
                messages.push({ role: c.role === 'model' ? 'assistant' : c.role, content: processParts(c.parts) });
            }
        }
    } else if (typeof contents === 'object' && contents?.parts) {
        messages.push({ role: contents.role || 'user', content: processParts(contents.parts) });
    }

    if (messages.length === 0) {
        messages.push({ role: 'user', content: String(contents || '') });
    }

    const jsonMode = config.responseMimeType === 'application/json';

    // 如果启用了 JSON 模式，Groq 强制要求提示词中必须出现 "JSON" 字样，否则直接报错 400
    if (jsonMode) {
        let hasSystem = false;
        for (const msg of messages) {
            if (msg.role === 'system') {
                msg.content = msg.content + ' You MUST output strictly in JSON format.';
                hasSystem = true;
                break;
            }
        }
        if (!hasSystem) {
            messages.unshift({ role: 'system', content: 'You MUST output strictly in JSON format.' });
        }
    }

    return {
        messages,
        temperature: config.temperature,
        maxTokens: config.maxOutputTokens,
        jsonMode,
    };
}

/** 将 Groq 响应转换为 Google generateContent 响应格式 */
function convertGroqResponse(groqData: any): any {
    let text = groqData?.choices?.[0]?.message?.content || '';

    // 【重要容错】如果是 DeepSeek 这种带思考过程的模型，暴力剔除 <think> 标签内的思考过程
    // 防止大篇幅的心智挣扎干扰到纯文本或 JSON 解析
    text = text.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();

    return {
        text,
        candidates: [{
            content: {
                parts: [{ text }],
                role: 'model',
            },
            finishReason: groqData?.choices?.[0]?.finish_reason || 'STOP',
        }],
        usageMetadata: {
            promptTokenCount: groqData?.usage?.prompt_tokens || 0,
            candidatesTokenCount: groqData?.usage?.completion_tokens || 0,
            totalTokenCount: groqData?.usage?.total_tokens || 0,
        },
    };
}

// ─── 核心调用（含精确错误分类） ───────────────────────────

/** 错误类型枚举 */
type GroqErrorType = 'key_invalid' | 'key_rate_limited' | 'model_not_found' | 'model_overloaded' | 'context_too_long' | 'network' | 'unknown';

/** 分类 Groq 错误 */
function classifyGroqError(status: number, errorBody: any): { type: GroqErrorType; userMessage: string } {
    const errMsg = errorBody?.error?.message || '';
    const errCode = errorBody?.error?.code || '';

    // === Key 问题 ===
    if (status === 401) {
        return {
            type: 'key_invalid',
            userMessage: '🔑 Groq API Key 无效（身份验证失败）。请检查 Key 是否正确，或重新生成一个。',
        };
    }
    if (status === 403) {
        return {
            type: 'key_invalid',
            userMessage: '🔑 Groq API Key 权限不足（403 Forbidden）。该 Key 可能已被禁用或无权访问此模型。',
        };
    }
    if (status === 429) {
        return {
            type: 'key_rate_limited',
            userMessage: '⏱️ Groq API Key 请求过于频繁（429 Rate Limit）。正在自动切换 Key...',
        };
    }

    // === 模型问题 ===
    if (status === 404 || errMsg.includes('model') && errMsg.includes('not found')) {
        return {
            type: 'model_not_found',
            userMessage: `🤖 所选 Groq 模型不存在或已下线。请在全局设置中切换到其他模型。\n详情: ${errMsg}`,
        };
    }
    if (status === 503 || errMsg.includes('overloaded') || errMsg.includes('unavailable')) {
        return {
            type: 'model_overloaded',
            userMessage: '🤖 Groq 模型当前过载/不可用，正在自动降级到 Google...',
        };
    }

    // === 输入/上下文长度问题 ===
    if ((status === 400 || status === 413) && (errMsg.includes('context') || errMsg.includes('token') || errMsg.includes('too large') || errMsg.includes('too long'))) {
        return {
            type: 'context_too_long',
            userMessage: `指令加文案文字内容过多。请精简，或在界面下方将【批量大小】调至 1~5 条/批。\n详情: ${errMsg}`,
        };
    }

    // === 未知 ===
    return {
        type: 'unknown',
        userMessage: `❓ Groq API 错误 (${status}): ${errMsg || '未知错误'}`,
    };
}

/** 调用 Groq API（含精确错误分类） */
async function callGroqAPI(
    apiKey: string,
    modelId: string,
    messages: any[],
    temperature?: number,
    maxTokens?: number,
    jsonMode?: boolean,
): Promise<any> {
    const body: any = {
        model: modelId,
        messages,
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (jsonMode) body.response_format = { type: 'json_object' };

    let resp: Response;
    try {
        resp = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    } catch (networkErr: any) {
        throw Object.assign(new Error(`🌐 无法连接 Groq API。请检查网络连接。\n详情: ${networkErr.message}`), { _groqErrorType: 'network' as GroqErrorType });
    }

    if (resp.ok) {
        return resp.json();
    }

    // 错误处理：解析 body 并精确分类
    const errBody = await resp.json().catch(() => ({}));
    const classified = classifyGroqError(resp.status, errBody);

    console.warn(`[GroqProxy] ${classified.type} | Key: ${maskKey(apiKey)} | Model: ${modelId} | ${classified.userMessage}`);

    const error = new Error(classified.userMessage);
    (error as any)._groqErrorType = classified.type;
    (error as any)._groqKeyUsed = maskKey(apiKey);
    throw error;
}

// ─── 代理工厂 ────────────────────────────────────────────

/**
 * 包装 GoogleGenAI 实例，在 Groq 模型被选中时自动拦截
 * @param apiKey 传入底层 Google Key，用于检测 Groq-only 模式
 */
export function wrapWithGroqProxy(originalAi: any, apiKey?: string): any {
    const origModels = originalAi.models;
    const origGenerateContent = origModels.generateContent.bind(origModels);
    const origGenerateContentStream = origModels.generateContentStream?.bind(origModels);
    const isGroqOnlyMode = !apiKey || apiKey === 'GROQ_ONLY_PLACEHOLDER';

    const proxiedModels = Object.create(origModels);

    proxiedModels.generateContent = async function (params: any) {
        const modelId = params?.model || '';

        // ━━━ 路由诊断日志 ━━━
        const logTag = '%c[GroqProxy]';
        const logStyleRoute = 'background:#1a1a2e;color:#e94560;padding:2px 6px;border-radius:3px;font-weight:bold';
        const logStyleOk = 'background:#0f3460;color:#16c79a;padding:2px 6px;border-radius:3px;font-weight:bold';
        const logStyleWarn = 'background:#4a3000;color:#ffc107;padding:2px 6px;border-radius:3px;font-weight:bold';

        // ── 非 Groq 模型 ──
        if (!isGroqModel(modelId)) {
            // Groq-only 模式：没有 Google Key，不能调 Google
            if (isGroqOnlyMode) {
                const errMsg = `🔑 【需要 Google Key】当前模块使用的模型「${modelId}」是 Google 模型，但您未设置 Google API Key。\n👉 请在全局设置中设置 Google API Key，或确保模块使用的是 Groq 模型。`;
                console.error(logTag, logStyleRoute, `🚫 Groq-only 模式拦截: model=${modelId}`, errMsg);
                throw new Error(errMsg);
            }
            console.log(logTag, logStyleRoute, `🔵 直通 Google | model=${modelId}`);
            return origGenerateContent(params);
        }

        const realModelId = getGroqModelId(params?.model || modelId);
        console.log(logTag, logStyleRoute, `🟢 拦截 Groq | model=${realModelId} | 参数:`, {
            hasImage: containsImageData(params),
            hasContents: !!params?.contents,
            configKeys: params?.config ? Object.keys(params.config) : [],
        });

        // ── 图片请求 ──
        if (containsImageData(params)) {
            // 我们在前面已经把 Google 的 inlineData 转换为了 OpenAI 的 image_url 格式。
            // 不再写死拦截特定模型（如强制要求名称带 vision），因为像 Llama-4 这样的新模型虽然名字不带 vision 也可能支持多模态。
            // 放行所有请求，如果该模型真实不支持，Groq 端会自动返回相应的 400 提示 "model does not support images"
        }

        // ── 清除不支持的特性（降级运行而不报错） ──
        const strippedTool = stripUnsupportedFeatures(params);
        if (strippedTool) {
            console.warn(logTag, logStyleWarn, '⚠️ 自动剥离了 Groq 不支持的联网工具，继续执行');
        }

        // ── 检查 Groq Key 池 ──
        const allKeys = getGroqKeys();
        const { key: firstKey, allInvalid, allRateLimited, diagnostics } = getNextAvailableGroqKey();
        console.log(logTag, logStyleRoute, `🔑 Groq Key 池状态: ${allKeys.length} 个 Key`, {
            firstKeyAvailable: firstKey ? maskKey(firstKey) : '无',
            allInvalid, allRateLimited, diagnostics: diagnostics || '正常',
        });

        if (!firstKey) {
            if (allInvalid) {
                const errMsg = `🔑 【Key 问题】${diagnostics}\n👉 请到全局设置 → Groq API Key 管理中检查或更换 Key。\n💡 或切换到 Gemini/Gemma 模型使用 Google Key。`;
                console.error(logTag, logStyleRoute, errMsg);
                throw new Error(errMsg);
            }
            if (allRateLimited) {
                const errMsg = `⏱️ 【Groq 限速】${diagnostics}\n👉 请稍后重试，或切换到 Gemini 模型。`;
                console.error(logTag, logStyleWarn, errMsg);
                throw new Error(errMsg);
            }
            const errMsg = `🔑 【Key 缺失】您选择了 Groq 模型「${realModelId}」，但尚未配置 Groq API Key。\n👉 请到全局设置 → Groq API Key 管理中添加 gsk_ 开头的 Key。\n💡 免费获取: https://console.groq.com/keys`;
            console.error(logTag, logStyleRoute, errMsg);
            throw new Error(errMsg);
        }

        // ── 转换格式 ──
        const { messages, temperature, maxTokens, jsonMode } = convertToGroqMessages(params);

        // ── 调用 Groq（带 Key 轮换） ──
        const maxAttempts = allKeys.length;
        let lastError: any = null;
        let attemptCount = 0;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const { key, diagnostics: retryDiag } = getNextAvailableGroqKey();
            if (!key) {
                if (retryDiag) console.warn(logTag, logStyleWarn, `重试循环: ${retryDiag}`);
                break;
            }

            attemptCount++;
            console.log(logTag, logStyleOk, `🚀 调用 Groq API | 尝试 ${attemptCount}/${maxAttempts} | Key: ${maskKey(key)} | Model: ${realModelId}`);

            try {
                const groqResponse = await callGroqAPI(key, realModelId, messages, temperature, maxTokens, jsonMode);
                console.log(logTag, logStyleOk, `✅ Groq 成功 | Model: ${realModelId} | Tokens: ${groqResponse?.usage?.total_tokens || '?'}`);
                return convertGroqResponse(groqResponse);
            } catch (err: any) {
                lastError = err;
                const errType: GroqErrorType = err._groqErrorType || 'unknown';

                switch (errType) {
                    case 'key_invalid':
                        markKeyError(key, 'invalid', err.message);
                        console.error(logTag, logStyleRoute, `🔑 Key ${maskKey(key)} 无效(${errType})，标记并跳过`);
                        continue;

                    case 'key_rate_limited':
                        markKeyError(key, 'rate_limit', err.message);
                        console.warn(logTag, logStyleWarn, `⏱️ Key ${maskKey(key)} 限速，尝试下一个...`);
                        continue;

                    case 'model_not_found':
                        const modelErr = `🤖 【模型问题】Groq 模型「${realModelId}」不存在或已下线。\n👉 请在全局设置中切换到其他 Groq 模型或 Gemini 模型。\n💡 Key ${err._groqKeyUsed || maskKey(key)} 本身是正常的（不是 Key 的问题）。`;
                        console.error(logTag, logStyleRoute, modelErr);
                        throw new Error(modelErr);

                    case 'model_overloaded':
                        console.error(logTag, logStyleWarn, `🤖 模型 ${realModelId} 过载`);
                        throw new Error(`🤖 【模型过载】Groq 模型「${realModelId}」当前过载，请稍后重试或切换其他模型。`);

                    case 'context_too_long':
                        console.error(logTag, logStyleRoute, `📏 输入超长: ${err.message}`);
                        throw err;

                    case 'network':
                        console.error(logTag, logStyleWarn, `🌐 网络错误`);
                        throw new Error(`🌐 【网络错误】无法连接 Groq API，请检查网络连接后重试。`);

                    default:
                        markKeyError(key, 'other', err.message);
                        console.error(logTag, logStyleWarn, `❓ 未知错误 | ${err.message}`);
                        throw new Error(`❓ 【Groq 错误】${err.message || '未知错误'}`);
                }
            }
        }

        // 所有 Key 都试过
        if (lastError?._groqErrorType === 'key_invalid') {
            const errMsg = `🔑 【Key 问题】尝试了 ${attemptCount} 个 Groq Key，全部无效。\n👉 请到全局设置 → Groq API Key 管理中检查或更换 Key。\n💡 或切换到 Gemini/Gemma 模型使用 Google Key。`;
            console.error(logTag, logStyleRoute, errMsg);
            throw new Error(errMsg);
        }

        const limErr = `⏱️ 【Groq 限速】全部 ${attemptCount} 个 Key 限速/不可用，请稍后重试或切换到 Gemini 模型。`;
        console.error(logTag, logStyleWarn, limErr);
        throw new Error(limErr);
    };

    // generateContentStream — 对于 Groq 采用伪流式返回（等待计算完成后作为一个 chunk 推送）
    if (origGenerateContentStream) {
        proxiedModels.generateContentStream = async function (params: any) {
            const modelId = params?.model || '';
            if (isGroqModel(modelId)) {
                // 模拟流式：先计算完毕，然后以单一 chunk yield 出去
                // 同样进行特性检查，拦截移除并记录
                const strippedTool = stripUnsupportedFeatures(params);
                
                const result = await proxiedModels.generateContent(params);
                
                // 为了兼容所有环境的异步迭代器，手工构造一个迭代器替代 async function*，防止 Babel 转译出现 'not async iterable' 报错
                const items: any[] = [];
                if (strippedTool) {
                    items.push({ text: "> ⚠️ **系统提示**：当前 Groq 模型暂不支持 Google Search 联网功能，已自动降级为纯文本对话模式。\n\n" });
                }
                items.push(result);

                let i = 0;
                const manualIterable = {
                    async next() {
                        if (i < items.length) {
                            return { value: items[i++], done: false };
                        }
                        return { value: undefined, done: true };
                    },
                    [Symbol.asyncIterator]() { return this; }
                };

                return {
                    response: Promise.resolve(result),
                    stream: manualIterable,
                    [Symbol.asyncIterator]() {
                        return manualIterable;
                    }
                };
            }
            if (isGroqOnlyMode) {
                throw new Error(`🔑 【需要 Google Key】当前模块使用的模型「${modelId}」是 Google 模型，但您未设置 Google API Key。`);
            }
            return origGenerateContentStream(params);
        };
    }

    const proxied = Object.create(originalAi);
    proxied.models = proxiedModels;
    return proxied;
}

// ─── 全局 Groq 模型列表（供设置面板使用） ────────────────

export const GROQ_GLOBAL_MODELS = [
    // 👁️ 支持图片识别 (Vision/Multimodal)
    { value: 'groq:meta-llama/llama-4-scout-17b-16e-instruct', label: '🟢 Groq · Llama 4 Scout 17B (支持图片识别)' },
    { value: 'groq:llama-3.2-90b-vision-preview', label: '🟢 Groq · Llama 3.2 Vision 90B (支持图片识别)' },
    { value: 'groq:llama-3.2-11b-vision-preview', label: '🟢 Groq · Llama 3.2 Vision 11B (支持图片识别)' },
    
    // 💬 纯文本旗舰大模型 (不支持图)
    { value: 'groq:qwen/qwen3-32b', label: '🟢 Groq · Qwen3 32B (中文強·无图片)' },
    { value: 'groq:llama-3.3-70b-versatile', label: '🟢 Groq · Llama 3.3 70B 通用 (无图片)' },
    { value: 'groq:openai/gpt-oss-120b', label: '🟢 Groq · GPT-OSS 120B 旗舰 (无图片)' },
    { value: 'groq:openai/gpt-oss-20b', label: '🟢 Groq · GPT-OSS 20B 快速 (无图片)' },
    { value: 'groq:llama-3.1-8b-instant', label: '🟢 Groq · Llama 3.1 8B 极速 (无图片)' },

    // 🧬 其他经典开源模型 (不支持图)
    { value: 'groq:gemma2-9b-it', label: '🟢 Groq · Gemma 2 9B (无图片)' },
    { value: 'groq:mixtral-8x7b-32768', label: '🟢 Groq · Mixtral 8x7B (无图片)' },
    { value: 'groq:llama3-70b-8192', label: '🟢 Groq · Llama 3 70B 老版 (无图片)' },
    { value: 'groq:llama3-8b-8192', label: '🟢 Groq · Llama 3 8B 老版 (无图片)' },
];

// ─── 诊断接口（供设置面板显示 Key 状态） ────────────────

export function getGroqKeyDiagnostics(): { total: number; valid: number; invalid: number; rateLimited: number; details: { key: string; status: string }[] } {
    const keys = getGroqKeys();
    const details: { key: string; status: string }[] = [];
    let invalid = 0, rateLimited = 0, valid = 0;

    for (const key of keys) {
        const status = getKeyStatus(key);
        if (status.isInvalid) {
            invalid++;
            details.push({ key: maskKey(key), status: `❌ 无效 (${status.lastError.substring(0, 50)})` });
        } else if (status.rateLimitedUntil > Date.now()) {
            rateLimited++;
            const wait = Math.ceil((status.rateLimitedUntil - Date.now()) / 1000);
            details.push({ key: maskKey(key), status: `⏱️ 限速中 (${wait}s 后恢复)` });
        } else {
            valid++;
            details.push({ key: maskKey(key), status: status.failCount > 0 ? `✅ 可用 (历史失败 ${status.failCount} 次)` : '✅ 正常' });
        }
    }

    return { total: keys.length, valid, invalid, rateLimited, details };
}
