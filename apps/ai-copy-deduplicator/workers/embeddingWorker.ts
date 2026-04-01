import { pipeline, env } from '@xenova/transformers';

// 优化配置：允许使用浏览器缓存，禁用本地离线加载
env.allowLocalModels = false;
env.useBrowserCache = true;

// 【算力极致榨干】开启 WASM 多线程，拉满 Mac M 芯片的并行处理能力
// 获取浏览器允许的最大逻辑核心数（最大限制为 8 线程避免阻塞主线程）
const numThreads = Math.min(navigator.hardwareConcurrency || 4, 8);
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = numThreads;
    // 强制使用量化模型（q8），速度飙升 4~5 倍，精度几乎无损
    env.backends.onnx.wasm.simd = true; 
}

// 选择极致轻量+针对中英双语优化的模型（大约 45MB）
const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';

// 每批次处理的文本数量（防止 WASM 内存溢出）
const BATCH_SIZE = 8;
// 单条文案最大字符数（bge-small Token 上限 512，约等于 2000-2500 英文字符，为了保护英文文案完整不被截断，放宽阈值）
const MAX_TEXT_LENGTH = 2000;

class EmbeddingPipeline {
    static task = 'feature-extraction' as any;
    static model = MODEL_NAME;
    static instance: any = null;

    static async getInstance(progress_callback: Function) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                quantized: true, // 绝对强制：使用 8位量化模型（q8），将 120MB 模型压缩至 30MB，推理速度提升 4~5 倍
                progress_callback,
            });
        }
        return this.instance;
    }
}

/** 截断超长文本，保护 WASM 内存 */
function truncateText(text: string): string {
    if (text.length <= MAX_TEXT_LENGTH) return text;
    return text.substring(0, MAX_TEXT_LENGTH);
}

// 监听主线程消息
self.addEventListener('message', async (event: MessageEvent) => {
    const { type, payload, id } = event.data;

    if (type === 'init') {
        try {
            await EmbeddingPipeline.getInstance((progressData: any) => {
                // 回传下载进度信息
                self.postMessage({
                    type: 'progress',
                    payload: progressData
                });
            });
            self.postMessage({ type: 'init_done' });
        } catch (error: any) {
            self.postMessage({ type: 'error', payload: error.message });
        }
    } 
    else if (type === 'embed') {
        try {
            const extractor = await EmbeddingPipeline.getInstance(() => {});
            const rawTexts: string[] = payload.texts;
            const allEmbeddings: number[][] = [];

            // 智能动态分批控制（基于字符数和条数双重限制，榨干硬件性能防止崩溃）
            const MAX_BATCH_ITEMS = 2048;   // 极度放宽条目数硬上限，匹配 20 万字符吞吐量
            // 从主线程接收动态配置，默认 3000
            const MAX_BATCH_CHARS = payload.maxBatchChars || 3000; 

            let processedCount = 0;
            
            while (processedCount < rawTexts.length) {
                const currentBatch: string[] = [];
                let currentBatchChars = 0;

                // 组装当前批次
                while (processedCount < rawTexts.length) {
                    const nextText = truncateText(rawTexts[processedCount]);
                    
                    // 如果这已经是当前批次的第一个了，无论多长必须塞进去（截断机制保证单条不过载）
                    if (currentBatch.length === 0) {
                        currentBatch.push(nextText);
                        currentBatchChars += nextText.length;
                        processedCount++;
                        continue;
                    }

                    // 检查如果加进去，会不会超出预设的批次限制
                    if (
                        currentBatch.length >= MAX_BATCH_ITEMS || 
                        (currentBatchChars + nextText.length) > MAX_BATCH_CHARS
                    ) {
                        break; // 等待处理这一批
                    }

                    currentBatch.push(nextText);
                    currentBatchChars += nextText.length;
                    processedCount++;
                }

                // 执行当前批次的计算
                const output = await extractor(currentBatch, { 
                    pooling: 'mean', 
                    normalize: true 
                });
                
                const batchEmbeddings = output.tolist();
                allEmbeddings.push(...batchEmbeddings);

                // 回传进度并附带刚刚计算出的特征图（让主线程立刻落盘到 IndexedDB 持久化）
                self.postMessage({
                    type: 'embed_progress',
                    id,
                    payload: { 
                        done: processedCount, 
                        total: rawTexts.length,
                        batchEmbeddings,
                        batchSize: currentBatch.length
                    }
                });
            }
            
            self.postMessage({
                type: 'embed_done',
                id,
                payload: { embeddings: allEmbeddings }
            });
        } catch (error: any) {
            self.postMessage({ type: 'error', id, payload: error.message });
        }
    }
});
