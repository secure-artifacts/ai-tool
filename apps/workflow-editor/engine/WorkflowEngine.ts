/**
 * 工作流执行引擎
 * 拓扑排序后按顺序执行节点
 * 支持「智能合批」：当批量 > 1 且含随机库/代码随机时，合并成单次 AI 调用
 */

import { Node, Edge } from '@xyflow/react';

export interface AiLogEntry {
  prompt: string;
  response: string;
  images?: string[]; // 发送的图片 data URLs
  timestamp: number;
  model: string;
  nodeId: string;
  nodeLabel: string;
}

export interface WorkflowResult {
  success: boolean;
  error?: string;
  outputs?: Record<string, any>;
  aiLogs?: AiLogEntry[];
}

/**
 * 拓扑排序 — 确保上游节点先执行
 */
function topologicalSort(nodes: Node[], edges: Edge[]): string[] {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // 初始化
  nodes.forEach((n) => {
    adjList.set(n.id, []);
    inDegree.set(n.id, 0);
  });

  // 构建邻接表
  edges.forEach((e) => {
    adjList.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  });

  // BFS
  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    adjList.get(current)?.forEach((neighbor) => {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    });
  }

  return sorted;
}

/**
 * 获取某节点的所有上游节点的数据
 */
function getUpstreamData(nodeId: string, edges: Edge[], nodeDataMap: Map<string, any>, nodeMap?: Map<string, Node>): any[] {
  return edges
    .filter((e) => e.target === nodeId)
    .map((e) => {
      const data = nodeDataMap.get(e.source);
      if (!data) return null;
      // 附加节点类型，供判断节点等需要区分上游类型的场景使用
      const sourceNode = nodeMap?.get(e.source);
      return { ...data, _nodeType: sourceNode?.type || '' };
    })
    .filter(Boolean);
}

/**
 * 沿着上游链路收集所有图片（穿透多层中间节点）
 * 优先使用 _upstreamImages（中间节点转发的），其次 images（输入节点原生的）
 */
function collectAllUpstreamImages(
  nodeId: string,
  edges: Edge[],
  nodeDataMap: Map<string, any>,
  visited = new Set<string>()
): string[] {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const imgs: string[] = [];
  const upEdges = edges.filter((e) => e.target === nodeId);
  for (const edge of upEdges) {
    const data = nodeDataMap.get(edge.source);
    if (!data) continue;
    // 中间节点转发的上游图片
    if (data._upstreamImages && Array.isArray(data._upstreamImages) && data._upstreamImages.length > 0) {
      imgs.push(...data._upstreamImages);
    }
    // 输入节点自身带的图片
    if (data.images && Array.isArray(data.images) && data.images.length > 0) {
      imgs.push(...data.images);
    }
    // 始终继续向上查找更深层的图片（不跳过已有图片的分支）
    imgs.push(...collectAllUpstreamImages(edge.source, edges, nodeDataMap, visited));
  }
  return [...new Set(imgs)]; // 去重
}

/**
 * 运行工作流
 * @param batchSize 智能合批大小（>1 时启用合批模式：随机库/代码随机生成 N 组，写描述词打包成 1 次 AI 请求）
 */
export async function runWorkflow(
  nodes: Node[],
  edges: Edge[],
  updateNodeData: (nodeId: string, data: any) => void,
  getAiInstance?: () => any,
  batchSize: number = 1
): Promise<WorkflowResult> {
  const sortedIds = topologicalSort(nodes, edges);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeDataMap = new Map<string, any>();
  const aiLogs: AiLogEntry[] = [];

  // 初始化数据
  nodes.forEach((n) => {
    nodeDataMap.set(n.id, { ...n.data });
  });

  for (const nodeId of sortedIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const upstreamData = getUpstreamData(nodeId, edges, nodeDataMap, nodeMap);

    switch (node.type) {
      case 'inputNode': {
        // 输入节点 — 数据已经在 node.data 中由用户填写
        // 无需额外处理，直接作为输出传递
        break;
      }

      case 'fileNode': {
        // 文件节点 — 数据已由用户上传/填写，直接透传
        // text 和 files 都在 node.data 中
        break;
      }

      case 'randomLibrary': {
        // 随机库节点 — 使用完整的 RandomLibraryConfig 执行抽取
        const data = nodeDataMap.get(nodeId);
        const config = data.randomLibraryConfig;
        if (config && config.libraries) {
          const enabledLibs = config.libraries.filter(
            (lib: any) => lib.enabled && lib.values.length > 0
          );
          if (enabledLibs.length > 0) {
            // 执行一次随机抽取
            const pickOne = (): { combo: string; dimValues: Record<string, string> } => {
              const parts: string[] = [];
              const dimValues: Record<string, string> = {};
              for (const lib of enabledLibs) {
                // 参与率过滤
                const rate = lib.participationRate ?? 100;
                if (rate < 100 && Math.random() * 100 >= rate) continue;

                // 权重抽取
                let picked: string;
                if (lib.valueWeights && Object.keys(lib.valueWeights).length > 0) {
                  // 加权随机
                  const entries = lib.values.map((v: string) => ({
                    value: v,
                    weight: lib.valueWeights[v] || 1,
                  }));
                  const totalW = entries.reduce((s: number, e: any) => s + e.weight, 0);
                  let r = Math.random() * totalW;
                  picked = entries[entries.length - 1].value;
                  for (const e of entries) {
                    r -= e.weight;
                    if (r <= 0) { picked = e.value; break; }
                  }
                } else {
                  picked = lib.values[Math.floor(Math.random() * lib.values.length)];
                }

                parts.push(`[${lib.name}] ${picked}`);
                dimValues[lib.name] = picked;
              }
              return { combo: parts.join(' + '), dimValues };
            };

            if (batchSize > 1) {
              // ✨ 智能合批：生成 N 个不同的组合
              const combinations: string[] = [];
              const combinationsDimValues: Record<string, string>[] = [];
              const usedCombos = new Set<string>();

              for (let i = 0; i < batchSize; i++) {
                // 尝试生成不重复的组合（最多重试 50 次）
                let attempts = 0;
                let result = pickOne();
                while (usedCombos.has(result.combo) && attempts < 50) {
                  result = pickOne();
                  attempts++;
                }
                usedCombos.add(result.combo);
                combinations.push(result.combo);
                combinationsDimValues.push(result.dimValues);
              }

              data.combinations = combinations;
              data.combinationsDimValues = combinationsDimValues;
              data.combination = combinations[0]; // 向后兼容
              data.dimValues = combinationsDimValues[0]; // 向后兼容
            } else {
              // 单次模式：和原来一样
              const result = pickOne();
              data.combination = result.combo;
              data.dimValues = result.dimValues;
            }

            // 透传上游图片
            const _upstreamImages = collectAllUpstreamImages(nodeId, edges, nodeDataMap);
            data._upstreamImages = _upstreamImages;
            nodeDataMap.set(nodeId, data);
            updateNodeData(nodeId, {
              combination: data.combination,
              dimValues: data.dimValues,
              ...(data.combinations ? { combinations: data.combinations, combinationsDimValues: data.combinationsDimValues } : {}),
            });
          }
        }
        break;
      }

      case 'overrideNode': {
        // 覆盖节点 — 应用覆盖配置
        const data = nodeDataMap.get(nodeId);
        const overrides = data.overrides || {};

        // 检查上游是否有批量组合
        const upstreamCombinations: string[] = [];
        const upstreamDimValuesArr: Record<string, string>[] = [];
        const singleDimValues: Record<string, string> = {};
        const comboParts: string[] = [];

        upstreamData.forEach((ud: any) => {
          // 批量模式
          if (ud.combinations && Array.isArray(ud.combinations)) {
            upstreamCombinations.push(...ud.combinations);
            if (ud.combinationsDimValues) {
              upstreamDimValuesArr.push(...ud.combinationsDimValues);
            }
          }
          // 单次模式
          if (ud.dimValues) {
            Object.assign(singleDimValues, ud.dimValues);
          }
          if (ud.combination) {
            comboParts.push(ud.combination);
          }
        });

        // 应用覆盖的核心函数
        const applyOverrideToDimValues = (
          baseDimValues: Record<string, string>,
          overrideIdx: number,
          totalCount: number
        ): { finalDimValues: Record<string, string>; finalCombination: string } => {
          const finalDimValues = { ...baseDimValues };
          for (const [dimName, entry] of Object.entries(overrides as Record<string, any>)) {
            if (!entry) continue;
            const mode = entry.mode || 'text';
            if (mode === 'text' && entry.value?.trim()) {
              // 检查覆盖个数限制
              const overrideCount = entry.count || 0; // 0 = 全部
              if (overrideCount === 0 || overrideIdx < overrideCount) {
                finalDimValues[dimName] = entry.value.trim();
              }
              // 否则保持随机值
            } else if (mode === 'image' && entry.value?.trim()) {
              const overrideCount = entry.count || 0;
              if (overrideCount === 0 || overrideIdx < overrideCount) {
                finalDimValues[dimName] = entry.value.trim();
              }
            }
          }

          const finalParts = Object.entries(finalDimValues).map(
            ([name, val]) => `[${name}] ${val}`
          );
          return {
            finalDimValues,
            finalCombination: finalParts.join(' + '),
          };
        };

        if (upstreamDimValuesArr.length > 1) {
          // ✨ 批量模式：对每个组合分别应用覆盖
          const finalCombinations: string[] = [];
          const finalDimValuesArr: Record<string, string>[] = [];

          for (let i = 0; i < upstreamDimValuesArr.length; i++) {
            const { finalDimValues, finalCombination } = applyOverrideToDimValues(
              upstreamDimValuesArr[i], i, upstreamDimValuesArr.length
            );
            finalCombinations.push(finalCombination);
            finalDimValuesArr.push(finalDimValues);
          }

          data.combinations = finalCombinations;
          data.combinationsDimValues = finalDimValuesArr;
          data.combination = finalCombinations[0]; // 向后兼容
          data.dimValues = finalDimValuesArr[0];
          data.finalValues = Object.values(finalDimValuesArr[0]);
        } else {
          // 单次模式
          const { finalDimValues, finalCombination } = applyOverrideToDimValues(
            singleDimValues, 0, 1
          );
          data.finalValues = Object.values(finalDimValues);
          data.combination = finalCombination;
          data.dimValues = finalDimValues;
        }

        // 透传上游图片
        data._upstreamImages = collectAllUpstreamImages(nodeId, edges, nodeDataMap);
        nodeDataMap.set(nodeId, data);
        updateNodeData(nodeId, {
          finalValues: data.finalValues,
          combination: data.combination,
          dimValues: data.dimValues,
          ...(data.combinations ? { combinations: data.combinations, combinationsDimValues: data.combinationsDimValues } : {}),
        });
        break;
      }

      case 'codeRandom': {
        // 代码随机节点 — 运行用户的 JS 代码
        const data = nodeDataMap.get(nodeId);
        const code = data.code || '';
        if (code.trim()) {
          try {
            if (batchSize > 1) {
              // ✨ 智能合批：运行 N 次代码，收集 N 个结果
              const combinations: string[] = [];
              const usedResults = new Set<string>();

              for (let i = 0; i < batchSize; i++) {
                const fn = new Function('index', 'total', code);
                const result = String(fn(i, batchSize) ?? '');
                combinations.push(result);
                usedResults.add(result);
              }

              data.combinations = combinations;
              data.combination = combinations[0]; // 向后兼容
              data.lastResult = combinations[0];
              data.result = combinations[0];
            } else {
              // 单次模式
              const fn = new Function(code);
              const result = String(fn() ?? '');
              data.lastResult = result;
              data.result = result;
              data.combination = result;
            }

            // 透传上游图片
            data._upstreamImages = collectAllUpstreamImages(nodeId, edges, nodeDataMap);
            nodeDataMap.set(nodeId, data);
            updateNodeData(nodeId, {
              lastResult: data.lastResult,
              result: data.result,
              combination: data.combination,
              ...(data.combinations ? { combinations: data.combinations } : {}),
            });
          } catch (err: any) {
            data.error = err.message;
            nodeDataMap.set(nodeId, data);
            updateNodeData(nodeId, { error: err.message });
          }
        }
        break;
      }

      case 'judgeNode': {
        // 判断节点 — 根据条件决定输出
        const data = nodeDataMap.get(nodeId);
        const judgeMode = data.judgeMode || 'nonempty';

        // 收集上游 A（用户输入）和 B（随机/代码结果）
        let inputA = '';
        let inputB = '';
        // 检查上游是否有批量组合
        let upstreamCombinations: string[] | null = null;

        upstreamData.forEach((ud: any) => {
          // 输入/文件节点 → A
          if (ud._nodeType === 'inputNode' || ud._nodeType === 'fileNode') {
            inputA = ud.text || '';
          } else if (ud.result || ud.combination || ud.lastResult) {
            inputB = ud.result || ud.combination || ud.lastResult || '';
          } else if (ud.text) {
            if (!inputA) inputA = ud.text;
            else if (!inputB) inputB = ud.text;
          }
          // 批量组合
          if (ud.combinations && Array.isArray(ud.combinations)) {
            upstreamCombinations = ud.combinations;
          }
        });

        try {
          // 判断逻辑的核心函数
          const runJudge = (a: string, b: string): string => {
            switch (judgeMode) {
              case 'priorityReplace': {
                const globalKeyword = data.globalKeyword || '全局优先';
                const replaceRules = data.replaceRules || [];
                const appendKws = (data.appendKeywords || '').split(/[,，、\s]+/).filter(Boolean);

                if (globalKeyword && a.includes(globalKeyword)) {
                  return a;
                } else {
                  let result = b;
                  for (const rule of replaceRules) {
                    const kw = (rule.keyword || '').trim();
                    if (!kw) continue;
                    const patterns = [
                      new RegExp(`(?:【${kw}】|\\[${kw}\\])\\s*[:：=]?\\s*(.+?)(?:\\n|$)`, 'i'),
                      new RegExp(`${kw}\\s*[:：=]\\s*(.+?)(?:\\n|$)`, 'i'),
                    ];
                    let userValue = '';
                    for (const pat of patterns) {
                      const m = a.match(pat);
                      if (m && m[1]?.trim()) { userValue = m[1].trim(); break; }
                    }
                    if (!userValue) continue;
                    const rp = new RegExp(
                      `((?:【${kw}】|\\[${kw}\\]|${kw})\\s*[:：=]?\\s*)([^\\n]*)`,
                      rule.replaceAll ? 'gi' : 'i'
                    );
                    if (rp.test(result)) {
                      result = result.replace(rp, `$1${userValue}`);
                    }
                  }
                  for (const ak of appendKws) {
                    const akPat = new RegExp(`(?:【?${ak}】?)\\s*[:：=]?\\s*(.+?)(?:\\n|$)`, 'i');
                    const m = a.match(akPat);
                    if (m && m[1]?.trim()) {
                      result = result.trimEnd() + '\n' + m[1].trim();
                    }
                  }
                  return result;
                }
              }
              case 'keyword': {
                const kws = (data.matchKeywords || '').split(/[,，、\s]+/).filter(Boolean);
                return kws.some((kw: string) => a.includes(kw)) ? a : b;
              }
              case 'nonempty': {
                return a.trim() ? a : b;
              }
              case 'custom': {
                const fn = new Function('A', 'B', data.customCode || 'return A || B;');
                return String(fn(a, b) ?? '');
              }
              default:
                return a || b;
            }
          };

          if (upstreamCombinations && upstreamCombinations.length > 1) {
            // ✨ 批量模式：对每个组合分别运行判断
            const resultCombinations = upstreamCombinations.map((combo: string) => {
              return runJudge(inputA, combo);
            });

            data.combinations = resultCombinations;
            data.result = resultCombinations[0];
            data.lastResult = resultCombinations[0];
            data.combination = resultCombinations[0];
          } else {
            // 单次模式
            const result = runJudge(inputA, inputB);
            data.result = result;
            data.lastResult = result;
            data.combination = result;
          }

          // 透传上游图片
          data._upstreamImages = collectAllUpstreamImages(nodeId, edges, nodeDataMap);
          nodeDataMap.set(nodeId, data);
          updateNodeData(nodeId, {
            result: data.result,
            lastResult: data.lastResult,
            combination: data.combination,
            ...(data.combinations ? { combinations: data.combinations } : {}),
          });
        } catch (err: any) {
          data.error = err.message;
          nodeDataMap.set(nodeId, data);
          updateNodeData(nodeId, { error: err.message });
        }
        break;
      }

      case 'promptWriter': {
        // 写描述词节点 — 调用 AI 生成
        updateNodeData(nodeId, { isGenerating: true, result: '' });

        try {
          // 收集所有上游数据
          const parts: string[] = [];
          // 检查上游是否有批量组合
          const allCombinations: string[] = [];

          upstreamData.forEach((ud: any) => {
            if (ud.text) parts.push(ud.text);
            if (ud.finalValues && Array.isArray(ud.finalValues)) {
              parts.push(`风格元素: ${ud.finalValues.join(', ')}`);
            }
            // 收集批量组合
            if (ud.combinations && Array.isArray(ud.combinations) && ud.combinations.length > 1) {
              allCombinations.push(...ud.combinations);
            } else if (ud.combination) {
              parts.push(`随机素材: ${ud.combination}`);
            }
            // 来自文件节点的文本文件内容
            if (ud.files && Array.isArray(ud.files)) {
              ud.files.forEach((f: any) => {
                if (f.type === 'text' && f.data) {
                  parts.push(`[文件: ${f.name}]\n${f.data}`);
                }
              });
            }
          });

          // 收集上游图片（直接来源 + 中间节点透传的）
          const allImages: string[] = [];
          upstreamData.forEach((ud: any) => {
            if (ud.images && Array.isArray(ud.images)) {
              allImages.push(...ud.images);
            }
            // 中间节点（覆盖/判断/代码随机等）透传的上游图片
            if (ud._upstreamImages && Array.isArray(ud._upstreamImages)) {
              allImages.push(...ud._upstreamImages);
            }
          });
          // 兜底：如果直接上游没有图片，从全链路收集
          if (allImages.length === 0) {
            allImages.push(...collectAllUpstreamImages(nodeId, edges, nodeDataMap));
          }

          const data = nodeDataMap.get(nodeId);
          let instruction = data.instruction || '请根据以下素材，写出一段详细的、专业的 AI 绘图提示词（Prompt），要求富有创意，画面感强，细节丰富。';

          // 如果开启了"从表格读取指令"，从上游随机库的 linkedInstructions 中获取
          if (data.useLinkedInstruction) {
            let foundLinked = '';
            upstreamData.forEach((ud: any) => {
              if (foundLinked) return;
              const cfg = ud.randomLibraryConfig;
              if (cfg?.linkedInstructions) {
                const activeSheet = cfg.activeSourceSheet || '';
                if (cfg.linkedInstructions[activeSheet]?.trim()) {
                  foundLinked = cfg.linkedInstructions[activeSheet].trim();
                } else {
                  // 取第一个有值的
                  for (const val of Object.values(cfg.linkedInstructions)) {
                    if ((val as string)?.trim()) { foundLinked = (val as string).trim(); break; }
                  }
                }
              }
            });
            if (foundLinked) instruction = foundLinked;
          }

          const usedModel = 'gemini-3-flash-preview';

          // ✨ 智能合批：如果有多个组合，打包成 1 次 AI 请求
          if (allCombinations.length > 1) {
            const combinationsList = allCombinations
              .map((combo, i) => `【组合${i + 1}】\n${combo}`)
              .join('\n\n');

            const contextParts = parts.length > 0 ? `\n\n背景素材：\n${parts.join('\n')}` : '';
            const batchPrompt = `${instruction}${contextParts}

下面有 ${allCombinations.length} 个不同的创意组合，请针对每个组合分别生成一个对应的AI图像描述词：

${combinationsList}

【输出要求】
- 为每个组合生成一个完整、详细的描述词
- 使用 "=== [编号] ===" 分隔不同组合的结果（编号从 1 开始）
- 不要输出组合编号、标题或任何解释，只输出描述词本身
- 格式示例：
=== [1] ===
完整描述词1
=== [2] ===
完整描述词2`;

            let batchResult = '';
            if (getAiInstance) {
              try {
                const ai = getAiInstance();
                const contentParts2: any[] = [{ text: batchPrompt }];
                for (const imgData of allImages) {
                  const match = imgData.match(/^data:(image\/\w+);base64,(.+)$/);
                  if (match) {
                    contentParts2.push({
                      inlineData: { mimeType: match[1], data: match[2] },
                    });
                  }
                }
                const response = await ai.models.generateContent({
                  model: usedModel,
                  contents: { role: 'user', parts: contentParts2 },
                  config: { temperature: 0.8 },
                });
                batchResult = response?.text || '（AI 未返回内容）';
              } catch (apiErr: any) {
                console.error('[WorkflowEngine] AI 合批调用失败:', apiErr);
                batchResult = `[API 错误] ${apiErr.message || apiErr.toString()}`;
              }
            } else {
              batchResult = allCombinations.map((c, i) => `=== [${i + 1}] ===\n[演示模式] 基于组合: ${c}`).join('\n');
            }

            // 解析批量结果
            const results: string[] = [];
            const sections = batchResult.split(/===\s*\[(\d+)\]\s*===/);
            // sections: [前缀, "1", 内容1, "2", 内容2, ...]
            for (let i = 1; i < sections.length; i += 2) {
              const content = (sections[i + 1] || '').trim();
              if (content) {
                results.push(content);
              }
            }

            // 如果解析失败，尝试用 --- 分隔
            if (results.length === 0) {
              const fallbackResults = batchResult.split(/---+/).map(r => r.trim()).filter(r => r.length > 0);
              results.push(...fallbackResults);
            }

            // 还是空的话，整体作为一个结果
            if (results.length === 0) {
              results.push(batchResult);
            }

            // 记录 AI 对话日志
            aiLogs.push({
              prompt: batchPrompt,
              response: batchResult,
              images: allImages.length > 0 ? allImages : undefined,
              timestamp: Date.now(),
              model: usedModel,
              nodeId,
              nodeLabel: data.label || '写描述词',
            });

            data.result = results.join('\n---\n'); // 向后兼容
            data.batchResults = results; // 批量结果数组
            data._upstreamImages = collectAllUpstreamImages(nodeId, edges, nodeDataMap);
            nodeDataMap.set(nodeId, data);
            updateNodeData(nodeId, { result: data.result, batchResults: results, isGenerating: false });

          } else {
            // 单次模式：保持原有逻辑
            const fullPrompt = `${instruction}\n\n素材信息：\n${parts.join('\n')}`;

            let result = '';

            if (getAiInstance) {
              try {
                const ai = getAiInstance();
                // 构建 multimodal parts: 文本 + 图片
                const contentParts2: any[] = [{ text: fullPrompt }];
                for (const imgData of allImages) {
                  const match = imgData.match(/^data:(image\/\w+);base64,(.+)$/);
                  if (match) {
                    contentParts2.push({
                      inlineData: { mimeType: match[1], data: match[2] },
                    });
                  }
                }
                const response = await ai.models.generateContent({
                  model: usedModel,
                  contents: {
                    role: 'user',
                    parts: contentParts2,
                  },
                  config: {
                    temperature: 0.8,
                  },
                });
                result = response?.text || '（AI 未返回内容）';
              } catch (apiErr: any) {
                console.error('[WorkflowEngine] AI API 调用失败:', apiErr);
                result = `[API 错误] ${apiErr.message || apiErr.toString()}`;
              }
            } else {
              result = `[演示模式]\n\n基于以下素材生成的描述词：\n${parts.join('\n')}\n\n---\n（请连接 API Key 以获取真实 AI 生成结果）`;
            }

            // 记录 AI 对话日志
            aiLogs.push({
              prompt: fullPrompt,
              response: result,
              images: allImages.length > 0 ? allImages : undefined,
              timestamp: Date.now(),
              model: usedModel,
              nodeId,
              nodeLabel: data.label || '写描述词',
            });

            data.result = result;
            // 透传上游图片
            data._upstreamImages = collectAllUpstreamImages(nodeId, edges, nodeDataMap);
            nodeDataMap.set(nodeId, data);
            updateNodeData(nodeId, { result, isGenerating: false });
          }
        } catch (err: any) {
          updateNodeData(nodeId, {
            result: `[引擎错误] ${err.message}`,
            isGenerating: false,
          });
        }
        break;
      }

      case 'outputNode': {
        // 输出节点 — 收集上游结果（兼容旧 entries + 新 tableRows）
        const data = nodeDataMap.get(nodeId);
        const resultEntries: any[] = [];
        const tableRows: any[] = [];

        // 全链路收集图片（作为 fallback）
        const allChainImages = collectAllUpstreamImages(nodeId, edges, nodeDataMap);

        upstreamData.forEach((ud: any) => {
          // ✨ 优先处理批量结果
          if (ud.batchResults && Array.isArray(ud.batchResults) && ud.batchResults.length > 0) {
            for (const [i, singleResult] of ud.batchResults.entries()) {
              const isError = singleResult.startsWith('[API 错误]') || singleResult.startsWith('[引擎错误]');
              const rowId = `batch-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;

              const rowImages: string[] = [];
              if (ud._upstreamImages && Array.isArray(ud._upstreamImages)) rowImages.push(...ud._upstreamImages);
              if (ud.images && Array.isArray(ud.images)) rowImages.push(...ud.images);
              const finalImages = rowImages.length > 0 ? [...new Set(rowImages)] : allChainImages;

              resultEntries.push({
                id: rowId,
                text: singleResult,
                source: `批量 ${i + 1}/${ud.batchResults.length}`,
                timestamp: Date.now(),
                status: isError ? 'error' : 'success',
              });

              const fields: Record<string, string> = {};
              if (singleResult.includes('|||')) {
                const fieldParts = singleResult.split('|||').map((s: string) => s.trim());
                fieldParts.forEach((p: string, fi: number) => {
                  fields[`field-${fi}`] = p;
                });
              } else {
                fields['result'] = singleResult;
              }

              tableRows.push({
                id: rowId,
                images: finalImages,
                fields,
                timestamp: Date.now(),
                status: isError ? 'error' : 'success',
                error: isError ? singleResult : undefined,
              });
            }
          } else if (ud.result && typeof ud.result === 'string') {
            // 单次模式：保持原有逻辑
            const isError = ud.result.startsWith('[API 错误]') || ud.result.startsWith('[引擎错误]');
            const rowId = `result-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            // 每行关联的图片：优先该上游节点自身携带/透传的图片，兜底全链路图片
            const rowImages: string[] = [];
            if (ud._upstreamImages && Array.isArray(ud._upstreamImages) && ud._upstreamImages.length > 0) {
              rowImages.push(...ud._upstreamImages);
            }
            if (ud.images && Array.isArray(ud.images) && ud.images.length > 0) {
              rowImages.push(...ud.images);
            }
            const finalImages = rowImages.length > 0 ? [...new Set(rowImages)] : allChainImages;

            // Legacy entries（向后兼容）
            resultEntries.push({
              id: rowId,
              text: ud.result,
              source: '写描述词节点',
              timestamp: Date.now(),
              status: isError ? 'error' : 'success',
            });

            // 新表格行：支持 ||| 分列
            const fields: Record<string, string> = {};
            if (ud.result.includes('|||')) {
              const fieldParts = ud.result.split('|||').map((s: string) => s.trim());
              fieldParts.forEach((p: string, i: number) => {
                fields[`field-${i}`] = p;
              });
            } else {
              fields['result'] = ud.result;
            }

            tableRows.push({
              id: rowId,
              images: finalImages,
              fields,
              timestamp: Date.now(),
              status: isError ? 'error' : 'success',
              error: isError ? ud.result : undefined,
            });
          }
        });

        data.entries = resultEntries;
        data.tableRows = tableRows;
        nodeDataMap.set(nodeId, data);
        updateNodeData(nodeId, { entries: resultEntries, tableRows });
        break;
      }
    }
  }

  return { success: true, outputs: Object.fromEntries(nodeDataMap), aiLogs };
}
