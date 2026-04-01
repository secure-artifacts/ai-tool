type ProgressCallback = (data: { status: string; file: string; progress: number; loaded: number; total: number }) => void;
type EmbedProgressCallback = (done: number, total: number) => void;

// 后台专用的向量数据库（断点续传核心引擎）
class EmbeddingDB {
    private dbName = 'AI_Toolkit_Embeddings';
    private storeName = 'vectors';
    private db: IDBDatabase | null = null;
    private initPromise: Promise<void> | null = null;

    async init() {
        if (this.db) return;
        if (!this.initPromise) {
            this.initPromise = new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(this.dbName, 1);
                request.onupgradeneeded = (e: any) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName);
                    }
                };
                request.onsuccess = (e: any) => {
                    this.db = e.target.result;
                    resolve();
                };
                request.onerror = () => reject(request.error);
            });
        }
        return this.initPromise;
    }

    async get(text: string): Promise<number[] | null> {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(this.storeName, 'readonly');
            const req = tx.objectStore(this.storeName).get(text);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async set(text: string, embedding: number[]) {
        await this.init();
        return new Promise<void>((resolve, reject) => {
            const tx = this.db!.transaction(this.storeName, 'readwrite');
            const req = tx.objectStore(this.storeName).put(embedding, text);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async clearAll() {
        await this.init();
        return new Promise<void>((resolve, reject) => {
            const tx = this.db!.transaction(this.storeName, 'readwrite');
            const req = tx.objectStore(this.storeName).clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async count(): Promise<number> {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(this.storeName, 'readonly');
            const req = tx.objectStore(this.storeName).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async exportAll(): Promise<{ text: string; embedding: number[] }[]> {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const cursorReq = store.openCursor();
            const entries: { text: string; embedding: number[] }[] = [];
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (cursor) {
                    entries.push({ text: cursor.key as string, embedding: cursor.value });
                    cursor.continue();
                } else {
                    resolve(entries);
                }
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
    }

    async importAll(entries: { text: string; embedding: number[] }[], onProgress?: (done: number, total: number) => void): Promise<number> {
        await this.init();
        let imported = 0;
        for (let i = 0; i < entries.length; i++) {
            const { text, embedding } = entries[i];
            if (text && embedding && Array.isArray(embedding)) {
                await this.set(text, embedding);
                imported++;
            }
            if (onProgress && i % 500 === 0) onProgress(i, entries.length);
        }
        if (onProgress) onProgress(entries.length, entries.length);
        return imported;
    }
}
export const embeddingDB = new EmbeddingDB();

class LocalEmbeddingService {
    private workers: Worker[] = [];
    private maxWorkers = typeof navigator !== 'undefined' ? Math.min(navigator.hardwareConcurrency || 4, 8) : 4;
    private initialised = false;
    private initPromise: Promise<void> | null = null;
    private pendingRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
    private requestCounter = 0;
    private embedProgressCallbacks = new Map<string, EmbedProgressCallback>();
    
    // 用于进度中转落盘
    private currentTextsForDbSave = new Map<string, string[]>();

    // 获取单例
    static instance: LocalEmbeddingService | null = null;
    static getInstance() {
        if (!this.instance) {
            this.instance = new LocalEmbeddingService();
        }
        return this.instance;
    }

    private ensureWorkers(onProgress?: ProgressCallback) {
        if (this.workers.length === 0) {
            for (let i = 0; i < this.maxWorkers; i++) {
                const worker = new Worker(new URL('../workers/embeddingWorker.ts', import.meta.url), {
                    type: 'module'
                });

                worker.addEventListener('message', (event) => {
                    const { type, payload, id } = event.data;
                    
                    if (type === 'progress') {
                        // 只让第一个 Worker 上报下载进度（模型是共享缓存的）
                        if (i === 0) onProgress?.(payload);
                    } else if (type === 'init_done') {
                        // handled in Promise
                    } else if (type === 'embed_progress') {
                        // 批次处理进度回调
                        if (id && this.embedProgressCallbacks.has(id)) {
                            this.embedProgressCallbacks.get(id)!(payload.done, payload.total);
                        }
                        
                        // 动态落盘：将刚跑完的这一批存入硬盘
                        if (id && payload.batchEmbeddings && payload.batchSize) {
                            const originalTexts = this.currentTextsForDbSave.get(id);
                            if (originalTexts) {
                                const startIdx = payload.done - payload.batchSize;
                                for (let j = 0; j < payload.batchSize; j++) {
                                    const text = originalTexts[startIdx + j];
                                    const emb = payload.batchEmbeddings[j];
                                    if (text && emb) {
                                        embeddingDB.set(text, emb).catch(e => console.error('IDB save error:', e));
                                    }
                                }
                            }
                        }
                    } else if (type === 'embed_done' || type === 'error') {
                        if (id && this.pendingRequests.has(id)) {
                            const { resolve, reject } = this.pendingRequests.get(id)!;
                            if (type === 'error') {
                                reject(new Error(payload));
                            } else {
                                resolve(payload.embeddings);
                            }
                            this.pendingRequests.delete(id);
                            this.embedProgressCallbacks.delete(id);
                            this.currentTextsForDbSave.delete(id);
                        }
                    }
                });
                this.workers.push(worker);
            }
        }
    }

    // 初始化（下载模型等）
    public async initEngine(onProgress: ProgressCallback): Promise<void> {
        if (this.initialised) return Promise.resolve();
        
        if (!this.initPromise) {
            this.ensureWorkers(onProgress);
            
            // 等待所有 Worker 初始化完毕
            const initPromises = this.workers.map(worker => new Promise<void>((resolve, reject) => {
                const handler = (event: MessageEvent) => {
                    const { type, payload } = event.data;
                    if (type === 'init_done') {
                        worker.removeEventListener('message', handler);
                        resolve();
                    } else if (type === 'error') {
                        worker.removeEventListener('message', handler);
                        reject(new Error(payload));
                    }
                };
                worker.addEventListener('message', handler);
                worker.postMessage({ type: 'init' });
            }));
            
            this.initPromise = Promise.all(initPromises).then(() => {
                this.initialised = true;
            }).catch(e => {
                this.initPromise = null;
                throw e;
            });
        }
        return this.initPromise;
    }

    public isReady() {
        return this.initialised;
    }

    // 强杀引擎：清空任务并重启 Worker 以立刻释放算力
    public async cancelSearch() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
        this.initialised = false;
        this.initPromise = null;
        
        // 驳回现有的查询请求
        this.pendingRequests.forEach(({ reject }) => {
            reject(new Error('CANCELLED_BY_USER'));
        });
        this.pendingRequests.clear();
        this.embedProgressCallbacks.clear();
        this.currentTextsForDbSave.clear();
    }

    // 获取向量（带可选进度回调与配置项，支持断点续传，多进程分发）
    public async extractEmbeddings(texts: string[], onProgress?: EmbedProgressCallback, options?: { maxBatchChars?: number }): Promise<number[][]> {
        if (!this.initialised) {
            throw new Error('Local Embedding Engine not initialized. Call initEngine() first.');
        }

        const baseId = `req_${this.requestCounter++}`;
        
        // --- 核心：断点续传检测（先扫硬盘） ---
        const finalResults: (number[] | null)[] = new Array(texts.length).fill(null);
        const missingTexts: string[] = [];
        const missingIndices: number[] = [];

        // 批量查询本地硬盘数据库
        for (let i = 0; i < texts.length; i++) {
            const cached = await embeddingDB.get(texts[i]).catch(() => null);
            if (cached) {
                finalResults[i] = cached;
            } else {
                missingTexts.push(texts[i]);
                missingIndices.push(i);
            }
        }

        // 如果全部都在硬盘里命中，瞬间返回
        if (missingTexts.length === 0) {
            onProgress?.(texts.length, texts.length);
            return finalResults as number[][];
        }

        // --- 若有遗漏，把剩下的任务切分成 N 份，分给 N 个 Worker ---
        const numWorkersToUse = Math.min(this.workers.length, missingTexts.length);
        const chunkSize = Math.ceil(missingTexts.length / numWorkersToUse);
        
        const workerProgress = new Array(numWorkersToUse).fill(0);
        
        if (onProgress) {
            for (let i = 0; i < numWorkersToUse; i++) {
                this.embedProgressCallbacks.set(`${baseId}_${i}`, (doneInWorker, totalInWorker) => {
                    workerProgress[i] = doneInWorker;
                    const totalWorkerDone = workerProgress.reduce((a, b) => a + b, 0);
                    const totalFinished = (texts.length - missingTexts.length) + totalWorkerDone;
                    onProgress(totalFinished, texts.length);
                });
            }
            // 先触发一次通知，显示当前已经跳过了多少
            onProgress(texts.length - missingTexts.length, texts.length);
        }

        // 分发各个并行子任务
        const chunkPromises = [];
        for (let i = 0; i < numWorkersToUse; i++) {
            const workerId = `${baseId}_${i}`;
            const startStrIdx = i * chunkSize;
            const endStrIdx = Math.min(startStrIdx + chunkSize, missingTexts.length);
            const chunkMissingTexts = missingTexts.slice(startStrIdx, endStrIdx);
            
            if (chunkMissingTexts.length === 0) continue;

            chunkPromises.push(new Promise<number[][]>((resolve, reject) => {
                this.currentTextsForDbSave.set(workerId, chunkMissingTexts);
                this.pendingRequests.set(workerId, { resolve, reject });
                this.workers[i].postMessage({
                    type: 'embed',
                    id: workerId,
                    payload: { 
                        texts: chunkMissingTexts, // 各个 Worker 只负责自己的分片
                        maxBatchChars: options?.maxBatchChars || 3000
                    }
                });
            }));
        }

        // 等待整个蜂群计算完毕
        const chunkResults = await Promise.all(chunkPromises);

        // 合并所有 Worker 的结果到全局
        let processedCounter = 0;
        for (let i = 0; i < chunkResults.length; i++) {
            const chunkEmbeddings = chunkResults[i];
            for (let j = 0; j < chunkEmbeddings.length; j++) {
                const globalIdx = missingIndices[processedCounter++];
                finalResults[globalIdx] = chunkEmbeddings[j];
            }
        }
        
        return finalResults as number[][];
    }
}

export const localEmbeddingService = LocalEmbeddingService.getInstance();
