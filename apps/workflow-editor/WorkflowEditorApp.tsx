/**
 * 工作流编辑器 - 基于节点的自动化编排器
 * 将快捷模式中的流水线拆解为可拖拽拼装的节点
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { extractUrlsFromHtml, fetchImageBlob, convertBlobToBase64, parsePasteInput } from '../ai-image-recognition/utils';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel,
  Connection,
  Edge,
  Node,
  NodeChange,
  NodePositionChange,
  ReactFlowProvider,
  useReactFlow,
  NodeTypes,
  MarkerType,
  ConnectionMode,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import InputNode from './nodes/InputNode';
import RandomLibraryNode from './nodes/RandomLibraryNode';
import OverrideNode from './nodes/OverrideNode';
import PromptWriterNode from './nodes/PromptWriterNode';
import FileNode from './nodes/FileNode';
import OutputNode from './nodes/OutputNode';
import CodeRandomNode from './nodes/CodeRandomNode';
import JudgeNode from './nodes/JudgeNode';
import { runWorkflow, WorkflowResult, AiLogEntry } from './engine/WorkflowEngine';
import './WorkflowEditor.css';

// 节点类型注册
const nodeTypes: NodeTypes = {
  inputNode: InputNode,
  randomLibrary: RandomLibraryNode,
  codeRandom: CodeRandomNode,
  overrideNode: OverrideNode,
  judgeNode: JudgeNode,
  promptWriter: PromptWriterNode,
  fileNode: FileNode,
  outputNode: OutputNode,
};

// 节点库定义
const NODE_PALETTE = [
  { type: 'inputNode', label: '📝 输入节点', color: '#3b82f6', desc: '文本/图片输入',
    help: '💡 输入节点\n\n用途：输入文本需求或拖入参考图片。\n\n• 文本输入：写下你的创作需求（如"温馨壁炉场景"）\n• 图片输入：拖入参考图片，AI 会基于图片内容生成描述\n• 支持直接粘贴图片\n\n输出：将文本/图片传递给下游节点' },
  { type: 'fileNode', label: '📁 文件节点', color: '#ec4899', desc: '导入图片/文本文件',
    help: '💡 文件节点\n\n用途：从本地导入图片或文本文件。\n\n• 支持拖入多张图片\n• 支持导入 .txt 文本文件\n• 自动识别文件类型\n\n输出：将文件内容传递给写描述词节点' },
  { type: 'randomLibrary', label: '🎲 随机库', color: '#8b5cf6', desc: '从库中抽取词条',
    help: '💡 随机库节点\n\n用途：管理多个维度的随机词条库，每次运行随机抽取组合。\n\n• 打开设置：导入 Google 表格数据\n• 快速选库：一键切换不同总库\n• 预览组合：查看随机抽取结果\n• 支持配套指令：表格中的指令可自动传递给写描述词节点\n\n输出：随机生成的词条组合' },
  { type: 'codeRandom', label: '🎰 代码随机', color: '#a855f7', desc: '写代码生成随机值',
    help: '💡 代码随机节点\n\n用途：直接编写 JavaScript 代码生成随机结果。\n\n• 自定义代码：完全控制随机逻辑\n• 快速模板：数字范围、文字列表、权重随机、多维组合\n• 沙箱运行：代码安全执行\n• 用 return 返回结果\n\n输出：代码执行的返回值' },
  { type: 'overrideNode', label: '🎯 维度覆盖', color: '#f59e0b', desc: '覆盖/替换随机值',
    help: '💡 维度覆盖节点\n\n用途：手动指定或替换随机库中某些维度的值。\n\n• 选择要覆盖的维度\n• 输入固定值替代随机抽取\n• 其他未覆盖维度仍然随机\n\n适用场景：想固定"场景=壁炉"但其他元素随机变化' },
  { type: 'judgeNode', label: '⚖️ 判断节点', color: '#06b6d4', desc: '条件判断/替换',
    help: '💡 判断节点\n\n用途：根据上游输入按条件规则决定输出。\n\n• 优先替换：用户指定维度覆盖随机结果中同名维度\n• 关键词匹配：检测输入是否包含特定关键词\n• 非空判断：输入有内容就用输入，否则用随机结果\n• 自定义代码：写 JS 表达式进行判断\n\n适用场景：用户手动输入时覆盖随机值，没输入时用随机结果' },
  { type: 'promptWriter', label: '✨ 写描述词', color: '#10b981', desc: '汇总生成 Prompt',
    help: '💡 写描述词节点\n\n用途：汇总所有上游数据，调用 AI 生成最终 Prompt。\n\n• 手动输入：自己写指令模板\n• 从表格读取：自动使用随机库的配套指令\n• AI 会根据指令 + 上游素材生成描述词\n\n输出：AI 生成的描述词文本' },
  { type: 'outputNode', label: '📤 输出节点', color: '#22c55e', desc: '展示结果/复制',
    help: '💡 输出节点\n\n用途：展示所有生成结果，支持复制。\n\n• 平铺展示所有批次结果\n• 📊 复制到表格：粘贴到 Google 表格，一个结果一个单元格\n• 📋 单条复制：每条结果单独复制\n• 支持双击放大查看\n\n提示：运行多次会累积结果，可一次性复制全部' },
];

// 默认节点数据
const getDefaultNodeData = (type: string) => {
  switch (type) {
    case 'inputNode':
      return { text: '', images: [] as string[] };
    case 'fileNode':
      return { text: '', files: [] as any[] };
    case 'randomLibrary':
      return { randomLibraryConfig: null, combination: '' };
    case 'codeRandom':
      return { code: '', lastResult: '', result: '' };
    case 'overrideNode':
      return { overrides: {} as Record<string, any> };
    case 'judgeNode':
      return { judgeMode: 'priorityReplace', replaceRules: [], result: '', lastResult: '' };
    case 'promptWriter':
      return { instruction: '', result: '', isGenerating: false };
    case 'outputNode':
      return { entries: [] };
    default:
      return {};
  }
};

// ======== 流程持久化 ========
const STORAGE_KEY = 'workflow-editor-flows';
const ACTIVE_FLOW_KEY = 'workflow-editor-active';

interface SavedFlow {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];
  updatedAt: number;
}

function loadFlows(): SavedFlow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFlows(flows: SavedFlow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flows));
}

function getActiveFlowId(): string | null {
  return localStorage.getItem(ACTIVE_FLOW_KEY);
}

function setActiveFlowId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_FLOW_KEY, id);
  else localStorage.removeItem(ACTIVE_FLOW_KEY);
}

// ======== 流程预设 — Google Sheets 同步 ========
const FLOW_SHEET_CONFIG_KEY = 'workflow-editor-sheet-config';

interface FlowSheetConfig {
  sheetId: string;
  sheetName: string;   // 默认 "流程预设"
  autoRefresh: boolean; // 每次打开自动刷新
}

function getFlowSheetConfig(): FlowSheetConfig {
  try {
    const raw = localStorage.getItem(FLOW_SHEET_CONFIG_KEY);
    return raw ? JSON.parse(raw) : { sheetId: '', sheetName: '流程预设', autoRefresh: true };
  } catch { return { sheetId: '', sheetName: '流程预设', autoRefresh: true }; }
}

function saveFlowSheetConfig(cfg: FlowSheetConfig) {
  localStorage.setItem(FLOW_SHEET_CONFIG_KEY, JSON.stringify(cfg));
}

/** 从 Google Sheets 读取流程预设（A 列=流程 JSON, B 列=流程说明） */
async function fetchFlowPresetsFromSheet(cfg: FlowSheetConfig): Promise<{ flows: SavedFlow[]; error?: string }> {
  if (!cfg.sheetId) return { flows: [], error: '未配置表格 ID' };
  try {
    const sheetName = encodeURIComponent(cfg.sheetName || '流程预设');
    const url = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:json&sheet=${sheetName}&_=${Date.now()}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const json = JSON.parse(jsonStr);
    if (json.status === 'error') {
      throw new Error(json.errors?.[0]?.message || '表格返回错误');
    }
    const rows = (json.table?.rows || []) as any[];
    const flows: SavedFlow[] = [];
    for (const row of rows) {
      const cells = row.c || [];
      const flowJsonStr = (cells[0]?.v || '').trim();
      const flowDesc = (cells[1]?.v || '').trim();
      if (!flowJsonStr) continue;
      try {
        const parsed = JSON.parse(flowJsonStr);
        if (parsed.nodes && parsed.edges) {
          flows.push({
            id: parsed.id || `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: parsed.name || flowDesc || '表格流程',
            nodes: parsed.nodes,
            edges: parsed.edges,
            updatedAt: parsed.updatedAt || Date.now(),
          });
        }
      } catch {
        // 跳过无效 JSON 行
        console.warn('[FlowSheetSync] 跳过无效行:', flowJsonStr.substring(0, 80));
      }
    }
    return { flows };
  } catch (err: any) {
    return { flows: [], error: err.message || '读取失败' };
  }
}

/** 批量导出所有流程为单个 JSON 文件 */
function exportAllFlows(flows: SavedFlow[]) {
  const data = { exportedAt: new Date().toISOString(), flows };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `all-workflows-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 默认初始工作流布局
const initialNodes: Node[] = [
  {
    id: 'input-1',
    type: 'inputNode',
    position: { x: 50, y: 200 },
    data: getDefaultNodeData('inputNode'),
  },
  {
    id: 'random-1',
    type: 'randomLibrary',
    position: { x: 380, y: 80 },
    data: getDefaultNodeData('randomLibrary'),
  },
  {
    id: 'override-1',
    type: 'overrideNode',
    position: { x: 710, y: 200 },
    data: getDefaultNodeData('overrideNode'),
  },
  {
    id: 'writer-1',
    type: 'promptWriter',
    position: { x: 1050, y: 200 },
    data: getDefaultNodeData('promptWriter'),
  },
  {
    id: 'output-1',
    type: 'outputNode',
    position: { x: 1400, y: 200 },
    data: getDefaultNodeData('outputNode'),
  },
];

const initialEdges: Edge[] = [
  { id: 'e-random-override', source: 'random-1', target: 'override-1', sourceHandle: 'source-right', targetHandle: 'target-left', style: { stroke: '#f59e0b', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' } },
  { id: 'e-input-override', source: 'input-1', target: 'override-1', sourceHandle: 'source-right', targetHandle: 'target-left', style: { stroke: '#3b82f6', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' } },
  { id: 'e-override-writer', source: 'override-1', target: 'writer-1', sourceHandle: 'source-right', targetHandle: 'target-left', style: { stroke: '#10b981', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' } },
  { id: 'e-writer-output', source: 'writer-1', target: 'output-1', sourceHandle: 'source-right', targetHandle: 'target-left', style: { stroke: '#22c55e', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' } },
];

let nodeIdCounter = 10;

const NODE_DEFAULT_WIDTH = 280;
const NODE_DEFAULT_HEIGHT = 120;
const DEFAULT_NODE_LABEL_BY_TYPE: Record<string, string> = {
  inputNode: '输入节点',
  fileNode: '文件节点',
  randomLibrary: '随机库',
  codeRandom: '代码随机',
  overrideNode: '维度覆盖',
  judgeNode: '判断节点',
  promptWriter: '写描述词',
  outputNode: '输出节点',
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getDefaultNodeLabelByType = (nodeType?: string) => {
  if (!nodeType) return '节点';
  const mapped = DEFAULT_NODE_LABEL_BY_TYPE[nodeType];
  if (mapped) return mapped;
  const fromPalette = NODE_PALETTE.find((item) => item.type === nodeType)?.label
    ?.replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '')
    ?.trim();
  return fromPalette || nodeType;
};

const getNodeDisplayLabel = (node: Node) => {
  const nodeData = node.data as any;
  const customLabel = (nodeData?.customLabel || '').toString().trim();
  if (customLabel) return customLabel;
  return getDefaultNodeLabelByType(node.type as string | undefined);
};

const getUniqueNodeLabel = (baseLabel: string, existingLabels: Set<string>) => {
  const trimmedBase = baseLabel.trim() || '节点';
  if (!existingLabels.has(trimmedBase)) return trimmedBase;

  const stem = trimmedBase.replace(/\s+\d+$/, '').trim() || trimmedBase;
  const stemRegex = new RegExp(`^${escapeRegExp(stem)}(?:\\s+(\\d+))?$`);
  let maxSuffix = 1;

  existingLabels.forEach((label) => {
    const match = label.match(stemRegex);
    if (!match) return;
    const suffix = match[1] ? Number(match[1]) : 1;
    if (Number.isFinite(suffix)) {
      maxSuffix = Math.max(maxSuffix, suffix);
    }
  });

  let next = maxSuffix + 1;
  let candidate = `${stem} ${next}`;
  while (existingLabels.has(candidate)) {
    next += 1;
    candidate = `${stem} ${next}`;
  }
  return candidate;
};

interface WorkflowEditorAppProps {
  getAiInstance?: () => any;
}

type QuickConnectMode = 'handle' | 'batch-upstream' | 'batch-downstream';

interface QuickConnectState {
  mode: QuickConnectMode;
  x: number;
  y: number;
  sourceNodeIds: string[];
  anchorNodeId: string;
  sourceHandleId?: string;
  query: string;
}

interface WorkflowSnapshot {
  nodes: Node[];
  edges: Edge[];
}

const cloneValue = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const cloneSnapshot = (snapshot: WorkflowSnapshot): WorkflowSnapshot => ({
  nodes: cloneValue(snapshot.nodes),
  edges: cloneValue(snapshot.edges),
});

const snapshotKey = (snapshot: WorkflowSnapshot) => JSON.stringify([snapshot.nodes, snapshot.edges]);

const WorkflowEditorInner: React.FC<WorkflowEditorAppProps> = ({ getAiInstance }) => {
  const [nodes, setNodes, defaultOnNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  // 磁吸状态记录（用于 hysteresis 黏性）
  const snapStateRef = useRef<{ snapX: boolean; snapY: boolean; targetCenterX: number; targetCenterY: number }>({
    snapX: false, snapY: false, targetCenterX: 0, targetCenterY: 0,
  });

  // 自定义 onNodesChange: 拦截拖拽位置变化，加入中心磁吸对齐（带黏性）
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const SNAP_IN = 15;   // 吸入阈值
      const SNAP_OUT = 30;  // 脱开阈值（更大 = 更粘）

      // 检测多选状态：有多个节点被选中时，禁用磁吸避免叠加
      const selectedCount = nodes.filter(n => n.selected).length;
      const isMultiSelected = selectedCount > 1;

      const snappedChanges = changes.map(change => {
        if (change.type !== 'position' || !change.position) return change;
        
        // 如果是非拖拽（比如程序自动排版），直接放行
        if (change.dragging === undefined) return change;

        // 多选拖拽时跳过磁吸，避免节点叠在一起
        if (isMultiSelected) return change;

        const posChange = change as NodePositionChange;
        const draggedNode = nodes.find(n => n.id === posChange.id);
        if (!draggedNode) return change;

        const dw = draggedNode.measured?.width ?? 280;
        const dh = draggedNode.measured?.height ?? 120;
        const dCenterX = posChange.position!.x + dw / 2;
        const dCenterY = posChange.position!.y + dh / 2;

        let finalX = posChange.position!.x;
        let finalY = posChange.position!.y;
        const ss = snapStateRef.current;

        // 如果在拖拽途中，检查是否需要脱离当前吸附
        if (change.dragging) {
          if (ss.snapY && Math.abs(dCenterY - ss.targetCenterY) >= SNAP_OUT) {
            ss.snapY = false;
          }
          if (ss.snapX && Math.abs(dCenterX - ss.targetCenterX) >= SNAP_OUT) {
            ss.snapX = false;
          }
        }

        // 应用当前的吸附状态
        if (ss.snapY) finalY = ss.targetCenterY - dh / 2;
        if (ss.snapX) finalX = ss.targetCenterX - dw / 2;

        // 如果未吸附且正在拖拽，探测是否有可以吸附的节点
        if (change.dragging && (!ss.snapY || !ss.snapX)) {
          for (const node of nodes) {
            if (node.id === posChange.id) continue;
            const nw = node.measured?.width ?? 280;
            const nh = node.measured?.height ?? 120;
            const nCenterX = node.position.x + nw / 2;
            const nCenterY = node.position.y + nh / 2;

            if (!ss.snapY && Math.abs(dCenterY - nCenterY) < SNAP_IN) {
              finalY = nCenterY - dh / 2;
              ss.snapY = true;
              ss.targetCenterY = nCenterY;
            }
            if (!ss.snapX && Math.abs(dCenterX - nCenterX) < SNAP_IN) {
              finalX = nCenterX - dw / 2;
              ss.snapX = true;
              ss.targetCenterX = nCenterX;
            }
          }
        }

        // 拖拽松开的这一帧：清理状态，但需要把吸附好的 finalX/Y 坐标送出去
        if (change.dragging === false) {
          snapStateRef.current = { snapX: false, snapY: false, targetCenterX: 0, targetCenterY: 0 };
        }

        // 清空 positionAbsolute 以让 React Flow 使用覆盖后的 position
        return { ...posChange, position: { x: finalX, y: finalY }, positionAbsolute: undefined };
      });

      // --- 拦截删除操作：在 React Flow 删除节点前，先创建桥接边 ---
      const removeChanges = snappedChanges.filter(c => c.type === 'remove');
      if (removeChanges.length > 0) {
        const deletedIds = new Set(removeChanges.map(c => c.id));
        setEdges(currentEdges => {
          const bridgeEdges: Edge[] = [];
          for (const nodeId of deletedIds) {
            const incomingEdges = currentEdges.filter(
              e => e.target === nodeId && !deletedIds.has(e.source)
            );
            const outgoingEdges = currentEdges.filter(
              e => e.source === nodeId && !deletedIds.has(e.target)
            );
            for (const inEdge of incomingEdges) {
              for (const outEdge of outgoingEdges) {
                const exists = currentEdges.some(
                  e => e.source === inEdge.source && e.target === outEdge.target
                ) || bridgeEdges.some(
                  e => e.source === inEdge.source && e.target === outEdge.target
                );
                if (!exists) {
                  // 内联计算最佳 handle 方向
                  const sn = nodes.find(n => n.id === inEdge.source);
                  const tn = nodes.find(n => n.id === outEdge.target);
                  let sh = 'source-right', th = 'target-left';
                  if (sn && tn) {
                    const sw = sn.measured?.width ?? 280;
                    const shh = sn.measured?.height ?? 120;
                    const tw = tn.measured?.width ?? 280;
                    const thh = tn.measured?.height ?? 120;
                    const dx = (tn.position.x + tw / 2) - (sn.position.x + sw / 2);
                    const dy = (tn.position.y + thh / 2) - (sn.position.y + shh / 2);
                    if (Math.abs(dx) >= Math.abs(dy)) {
                      sh = dx >= 0 ? 'source-right' : 'source-left';
                      th = dx >= 0 ? 'target-left' : 'target-right';
                    } else {
                      sh = dy >= 0 ? 'source-bottom' : 'source-top';
                      th = dy >= 0 ? 'target-top' : 'target-bottom';
                    }
                  }
                  bridgeEdges.push({
                    id: `bridge-${inEdge.source}-${outEdge.target}-${Date.now()}`,
                    source: inEdge.source,
                    target: outEdge.target,
                    sourceHandle: sh,
                    targetHandle: th,
                  });
                }
              }
            }
          }
          if (bridgeEdges.length > 0) {
            return [...currentEdges, ...bridgeEdges];
          }
          return currentEdges;
        });
      }

      defaultOnNodesChange(snappedChanges);
    },
    [nodes, defaultOnNodesChange, setEdges]
  );
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<WorkflowResult | null>(null);
  const [batchCount, setBatchCount] = useState(1);
  const [runProgress, setRunProgress] = useState('');
  const [aiLogs, setAiLogs] = useState<AiLogEntry[]>([]);
  const [showAiLogModal, setShowAiLogModal] = useState(false);

  const [showFlowSidebar, setShowFlowSidebar] = useState(false);
  const [batchPanelCollapsed, setBatchPanelCollapsed] = useState(false);
  const [edgeStyle, setEdgeStyle] = useState<'default' | 'smoothstep' | 'straight'>('default');
  const [edgeAnimated, setEdgeAnimated] = useState(false);
  const [savedFlows, setSavedFlows] = useState<SavedFlow[]>(() => loadFlows());
  const [currentFlowName, setCurrentFlowName] = useState('未命名流程');
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(() => getActiveFlowId());
  const [flowSheetConfig, setFlowSheetConfig] = useState<FlowSheetConfig>(() => getFlowSheetConfig());
  const [sheetFlows, setSheetFlows] = useState<SavedFlow[]>([]);
  const [sheetSyncStatus, setSheetSyncStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [sheetSyncError, setSheetSyncError] = useState('');
  const [showSheetConfig, setShowSheetConfig] = useState(false);
  const [quickConnect, setQuickConnect] = useState<QuickConnectState | null>(null);
  const [connectionHoverNodeId, setConnectionHoverNodeId] = useState<string | null>(null);
  const [isDraggingConnection, setIsDraggingConnection] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; selectedNodeIds: string[] } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const dragConnectRef = useRef<{ sourceNodeId: string; sourceHandleId?: string } | null>(null);
  const historyPastRef = useRef<WorkflowSnapshot[]>([]);
  const historyFutureRef = useRef<WorkflowSnapshot[]>([]);
  const historyLastSnapshotRef = useRef<WorkflowSnapshot>(cloneSnapshot({ nodes: initialNodes, edges: initialEdges }));
  const historyLastSnapshotKeyRef = useRef<string>(snapshotKey(historyLastSnapshotRef.current));
  const historyPendingPrevRef = useRef<WorkflowSnapshot | null>(null);
  const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const historyApplyingRef = useRef(false);
  const historyReadyRef = useRef(false);
  const historySkipNextRef = useRef(0);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const clipboardNodesRef = useRef<Node[]>([]);
  const insertEdgeRef = useRef<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const detachNodeRef = useRef<boolean>(false);
  const shakeHistoryRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const { screenToFlowPosition, fitView, getNodes, getViewport } = useReactFlow();

  const syncHistoryAvailability = useCallback(() => {
    setCanUndo(historyPastRef.current.length > 0);
    setCanRedo(historyFutureRef.current.length > 0);
  }, []);

  const resetHistoryWithState = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
    historyPastRef.current = [];
    historyFutureRef.current = [];
    historyPendingPrevRef.current = null;
    const snapshot = cloneSnapshot({ nodes: nextNodes, edges: nextEdges });
    historyLastSnapshotRef.current = snapshot;
    historyLastSnapshotKeyRef.current = snapshotKey(snapshot);
    historyReadyRef.current = true;
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);

  const flushPendingHistoryCommit = useCallback(() => {
    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
    historyCommitTimerRef.current = undefined;
    const pendingPrev = historyPendingPrevRef.current;
    if (!pendingPrev) return;
    const current = historyLastSnapshotRef.current;
    if (snapshotKey(pendingPrev) !== snapshotKey(current)) {
      historyPastRef.current.push(cloneSnapshot(pendingPrev));
      if (historyPastRef.current.length > 80) {
        historyPastRef.current.shift();
      }
      historyFutureRef.current = [];
    }
    historyPendingPrevRef.current = null;
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);

  const applySnapshotToCanvas = useCallback((snapshot: WorkflowSnapshot) => {
    const cloned = cloneSnapshot(snapshot);
    historyApplyingRef.current = true;
    historyLastSnapshotRef.current = cloned;
    historyLastSnapshotKeyRef.current = snapshotKey(cloned);
    setNodes(cloned.nodes);
    setEdges(cloned.edges);
  }, [setEdges, setNodes]);

  const undoWorkflowChange = useCallback(() => {
    flushPendingHistoryCommit();
    const previous = historyPastRef.current.pop();
    if (!previous) return;
    const current = cloneSnapshot(historyLastSnapshotRef.current);
    historyFutureRef.current.push(current);
    applySnapshotToCanvas(previous);
    syncHistoryAvailability();
  }, [applySnapshotToCanvas, flushPendingHistoryCommit, syncHistoryAvailability]);

  const redoWorkflowChange = useCallback(() => {
    flushPendingHistoryCommit();
    const next = historyFutureRef.current.pop();
    if (!next) return;
    const current = cloneSnapshot(historyLastSnapshotRef.current);
    historyPastRef.current.push(current);
    applySnapshotToCanvas(next);
    syncHistoryAvailability();
  }, [applySnapshotToCanvas, flushPendingHistoryCommit, syncHistoryAvailability]);

  const clampOverlayPosition = useCallback((x: number, y: number, panelWidth: number, panelHeight: number) => {
    if (typeof window === 'undefined') return { x, y };
    const margin = 10;
    const maxX = Math.max(margin, window.innerWidth - panelWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - panelHeight - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  }, []);

  useEffect(() => {
    const currentSnapshot = cloneSnapshot({ nodes, edges });
    const currentKey = snapshotKey(currentSnapshot);

    if (!historyReadyRef.current) {
      historyReadyRef.current = true;
      historyLastSnapshotRef.current = currentSnapshot;
      historyLastSnapshotKeyRef.current = currentKey;
      syncHistoryAvailability();
      return;
    }

    if (historySkipNextRef.current > 0) {
      historySkipNextRef.current -= 1;
      historyPendingPrevRef.current = null;
      if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
      historyLastSnapshotRef.current = currentSnapshot;
      historyLastSnapshotKeyRef.current = currentKey;
      syncHistoryAvailability();
      return;
    }

    if (historyApplyingRef.current) {
      historyApplyingRef.current = false;
      historyPendingPrevRef.current = null;
      if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
      historyLastSnapshotRef.current = currentSnapshot;
      historyLastSnapshotKeyRef.current = currentKey;
      syncHistoryAvailability();
      return;
    }

    if (currentKey === historyLastSnapshotKeyRef.current) return;

    if (!historyPendingPrevRef.current) {
      historyPendingPrevRef.current = cloneSnapshot(historyLastSnapshotRef.current);
    }

    historyLastSnapshotRef.current = currentSnapshot;
    historyLastSnapshotKeyRef.current = currentKey;

    const isDragging = nodes.some((node) => Boolean((node as any).dragging));
    if (isDragging) {
      if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
      return;
    }

    if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
    historyCommitTimerRef.current = setTimeout(() => {
      flushPendingHistoryCommit();
    }, 220);
  }, [edges, flushPendingHistoryCommit, nodes, syncHistoryAvailability]);

  useEffect(() => {
    return () => {
      if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
    };
  }, []);

  // 加载已保存的活跃流程
  useEffect(() => {
    const activeId = getActiveFlowId();
    if (activeId) {
      const flows = loadFlows();
      const flow = flows.find((f) => f.id === activeId);
      if (flow) {
        historySkipNextRef.current += 1;
        resetHistoryWithState(flow.nodes, flow.edges);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setCurrentFlowName(flow.name);
        setCurrentFlowId(flow.id);
        setTimeout(() => fitView({ padding: 0.2 }), 200);
      }
    }
  }, [fitView, resetHistoryWithState, setEdges, setNodes]);

  // 自动保存：节点或连线变化时，防抖 3 秒后自动保存到 localStorage
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const initialLoadRef = useRef(true);
  useEffect(() => {
    // 跳过初始加载时的自动保存（避免覆盖刚加载的数据）
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      // 确保有活跃流程 ID，没有则自动创建一个
      const flowId = currentFlowId || `flow-${Date.now()}`;
      const flowName = currentFlowName || '未命名流程';
      const flow: SavedFlow = {
        id: flowId,
        name: flowName,
        nodes: nodes.map((n) => ({ ...n, data: { ...n.data, nodeId: undefined, updateNodeData: undefined } })),
        edges,
        updatedAt: Date.now(),
      };
      const flows = loadFlows();
      const idx = flows.findIndex((f) => f.id === flowId);
      if (idx >= 0) flows[idx] = flow;
      else flows.push(flow);
      saveFlows(flows);
      setSavedFlows(flows);
      if (!currentFlowId) {
        setCurrentFlowId(flowId);
        setCurrentFlowName(flowName);
        setActiveFlowId(flowId);
      }
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [nodes, edges]); // eslint-disable-line

  // 一键生成标准流程
  const generateStandardPipeline = useCallback(() => {
    const baseId = nodeIdCounter++;
    const newNodes: Node[] = [
      { id: `input-${baseId}`, type: 'inputNode', position: { x: 50, y: 200 }, data: getDefaultNodeData('inputNode') },
      { id: `random-${baseId}`, type: 'randomLibrary', position: { x: 380, y: 80 }, data: getDefaultNodeData('randomLibrary') },
      { id: `override-${baseId}`, type: 'overrideNode', position: { x: 710, y: 200 }, data: getDefaultNodeData('overrideNode') },
      { id: `writer-${baseId}`, type: 'promptWriter', position: { x: 1050, y: 200 }, data: getDefaultNodeData('promptWriter') },
      { id: `output-${baseId}`, type: 'outputNode', position: { x: 1400, y: 200 }, data: getDefaultNodeData('outputNode') },
    ];
    const newEdges: Edge[] = [
      { id: `e-ro-${baseId}`, source: `random-${baseId}`, sourceHandle: 'source-right', target: `override-${baseId}`, targetHandle: 'target-left', animated: true, style: { stroke: '#f59e0b' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' } },
      { id: `e-io-${baseId}`, source: `input-${baseId}`, sourceHandle: 'source-right', target: `override-${baseId}`, targetHandle: 'target-left', animated: true, style: { stroke: '#3b82f6' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' } },
      { id: `e-ow-${baseId}`, source: `override-${baseId}`, sourceHandle: 'source-right', target: `writer-${baseId}`, targetHandle: 'target-left', animated: true, style: { stroke: '#10b981' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' } },
      { id: `e-wo-${baseId}`, source: `writer-${baseId}`, sourceHandle: 'source-right', target: `output-${baseId}`, targetHandle: 'target-left', animated: true, style: { stroke: '#22c55e' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' } },
    ];
    setNodes(newNodes);
    setEdges(newEdges);
    // 延迟执行：先等 DOM 渲染，再触发按钮的 autoLayout
    setTimeout(() => {
      // 手动触发 toolbar 上的整理按钮逻辑
      const layoutBtn = document.querySelector('[title="自动整理节点位置"]') as HTMLButtonElement;
      if (layoutBtn) layoutBtn.click();
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    }, 200);
  }, [setNodes, setEdges, fitView]);

  // 统一的「带桥接删除节点」函数 — 所有删除路径共用
  const deleteNodesWithBridge = useCallback(
    (idsToDelete: string[]) => {
      const deletedIds = new Set(idsToDelete);
      // 先在当前 edges 中创建桥接，再删节点和旧边
      setEdges((currentEdges) => {
        const bridgeEdges: Edge[] = [];
        for (const nodeId of deletedIds) {
          const incomingEdges = currentEdges.filter(
            (e) => e.target === nodeId && !deletedIds.has(e.source)
          );
          const outgoingEdges = currentEdges.filter(
            (e) => e.source === nodeId && !deletedIds.has(e.target)
          );
          for (const inEdge of incomingEdges) {
            for (const outEdge of outgoingEdges) {
              const alreadyExists = currentEdges.some(
                (e) => e.source === inEdge.source && e.target === outEdge.target
              ) || bridgeEdges.some(
                (e) => e.source === inEdge.source && e.target === outEdge.target
              );
              if (!alreadyExists) {
                // 内联 handle 计算（避免依赖 getBestHandles 引用）
                const sn = nodes.find(n => n.id === inEdge.source);
                const tn = nodes.find(n => n.id === outEdge.target);
                let sh = 'source-right', th = 'target-left';
                if (sn && tn) {
                  const sw = sn.measured?.width ?? 280;
                  const shh = sn.measured?.height ?? 120;
                  const tw = tn.measured?.width ?? 280;
                  const thh = tn.measured?.height ?? 120;
                  const dx = (tn.position.x + tw / 2) - (sn.position.x + sw / 2);
                  const dy = (tn.position.y + thh / 2) - (sn.position.y + shh / 2);
                  if (Math.abs(dx) >= Math.abs(dy)) {
                    sh = dx >= 0 ? 'source-right' : 'source-left';
                    th = dx >= 0 ? 'target-left' : 'target-right';
                  } else {
                    sh = dy >= 0 ? 'source-bottom' : 'source-top';
                    th = dy >= 0 ? 'target-top' : 'target-bottom';
                  }
                }
                bridgeEdges.push({
                  id: `bridge-${inEdge.source}-${outEdge.target}-${Date.now()}`,
                  source: inEdge.source,
                  target: outEdge.target,
                  sourceHandle: sh,
                  targetHandle: th,
                });
              }
            }
          }
        }
        const remainingEdges = currentEdges.filter(
          (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)
        );
        return [...remainingEdges, ...bridgeEdges];
      });
      // 删除节点
      setNodes((nds) => nds.filter((n) => !deletedIds.has(n.id)));
    },
    [nodes, setEdges, setNodes]
  );

  // React Flow 的 onNodesDelete 回调 — 委托给统一函数
  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      deleteNodesWithBridge(deletedNodes.map(n => n.id));
    },
    [deleteNodesWithBridge]
  );

  // 根据两个节点的相对位置，计算最短路径的 handle 对
  const getBestHandles = useCallback(
    (sourceId: string, targetId: string, currentNodes?: Node[]) => {
      const nodeList = currentNodes || nodes;
      const sourceNode = nodeList.find(n => n.id === sourceId);
      const targetNode = nodeList.find(n => n.id === targetId);
      if (!sourceNode || !targetNode) return { sourceHandle: 'source-right', targetHandle: 'target-left' };

      const sw = NODE_DEFAULT_WIDTH, sh = NODE_DEFAULT_HEIGHT; // 节点大致尺寸
      const sx = (sourceNode.position?.x ?? 0) + sw / 2;
      const sy = (sourceNode.position?.y ?? 0) + sh / 2;
      const tx = (targetNode.position?.x ?? 0) + sw / 2;
      const ty = (targetNode.position?.y ?? 0) + sh / 2;

      const dx = tx - sx;
      const dy = ty - sy;

      // 根据方向选择最近的 handle 对
      if (Math.abs(dx) >= Math.abs(dy)) {
        // 水平方向为主
        if (dx >= 0) {
          return { sourceHandle: 'source-right', targetHandle: 'target-left' };
        } else {
          return { sourceHandle: 'source-left', targetHandle: 'target-right' };
        }
      } else {
        // 垂直方向为主
        if (dy >= 0) {
          return { sourceHandle: 'source-bottom', targetHandle: 'target-top' };
        } else {
          return { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
        }
      }
    },
    [nodes]
  );

  const connectNodes = useCallback((
    sourceId: string,
    targetId: string,
    options?: { sourceHandle?: string; targetHandle?: string; currentNodes?: Node[] }
  ) => {
    if (!sourceId || !targetId || sourceId === targetId) return;

    let sourceHandle = options?.sourceHandle;
    let targetHandle = options?.targetHandle;
    if (!sourceHandle || !targetHandle) {
      const best = getBestHandles(sourceId, targetId, options?.currentNodes);
      sourceHandle = sourceHandle || best.sourceHandle;
      targetHandle = targetHandle || best.targetHandle;
    }

    setEdges((eds) => {
      const exists = eds.some((edge) => edge.source === sourceId && edge.target === targetId);
      if (exists) return eds;
      return addEdge(
        {
          id: `e-${sourceId}-${targetId}-${Date.now()}`,
          source: sourceId,
          target: targetId,
          sourceHandle,
          targetHandle,
          type: edgeStyle === 'default' ? undefined : edgeStyle,
          animated: edgeAnimated,
          style: { stroke: '#6366f1', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
        },
        eds
      );
    });
  }, [edgeAnimated, edgeStyle, getBestHandles, setEdges]);

  const findNodeAtClientPosition = useCallback((clientX: number, clientY: number, excludeIds: string[] = []) => {
    const flowPoint = screenToFlowPosition({ x: clientX, y: clientY });
    const currentNodes = getNodes();
    for (let i = currentNodes.length - 1; i >= 0; i--) {
      const node = currentNodes[i];
      if (excludeIds.includes(node.id)) continue;
      const absolute = (node as any).positionAbsolute || node.position;
      const width = node.measured?.width || node.width || NODE_DEFAULT_WIDTH;
      const height = node.measured?.height || node.height || NODE_DEFAULT_HEIGHT;
      if (
        flowPoint.x >= absolute.x &&
        flowPoint.x <= absolute.x + width &&
        flowPoint.y >= absolute.y &&
        flowPoint.y <= absolute.y + height
      ) {
        return node;
      }
    }
    return null;
  }, [getNodes, screenToFlowPosition]);

  const getNodeTitle = useCallback((node: Node) => {
    const paletteLabel = NODE_PALETTE.find((item) => item.type === node.type)?.label || node.type || '节点';
    const nodeData = node.data as any;
    const customLabel = (nodeData?.customLabel || nodeData?.label || nodeData?.title || '').toString().trim();
    const inputText = (nodeData?.text || '').toString().trim().split('\n')[0];
    const detail = customLabel || inputText || node.id;
    return `${paletteLabel} · ${detail}`;
  }, []);

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      const currentNodes = getNodes();

      // --- 记录拖拽起点 ---
      if (!dragStartPosRef.current) {
        dragStartPosRef.current = { x: draggedNode.position.x, y: draggedNode.position.y };
      }

      // --- 智能边方向更新 ---
      setEdges(eds => {
        let changed = false;
        const newEdges = eds.map(edge => {
          if (edge.source !== draggedNode.id && edge.target !== draggedNode.id) return edge;

          const sn = currentNodes.find((n: Node) => n.id === edge.source);
          const tn = currentNodes.find((n: Node) => n.id === edge.target);
          if (!sn || !tn) return edge;

          const sw = sn.measured?.width ?? NODE_DEFAULT_WIDTH, sh = sn.measured?.height ?? NODE_DEFAULT_HEIGHT;
          const tw = tn.measured?.width ?? NODE_DEFAULT_WIDTH, th = tn.measured?.height ?? NODE_DEFAULT_HEIGHT;
          const dx = (tn.position.x + tw / 2) - (sn.position.x + sw / 2);
          const dy = (tn.position.y + th / 2) - (sn.position.y + sh / 2);

          let bestSource: string, bestTarget: string;
          if (Math.abs(dx) >= Math.abs(dy)) {
            if (dx >= 0) { bestSource = 'source-right'; bestTarget = 'target-left'; }
            else { bestSource = 'source-left'; bestTarget = 'target-right'; }
          } else {
            if (dy >= 0) { bestSource = 'source-bottom'; bestTarget = 'target-top'; }
            else { bestSource = 'source-top'; bestTarget = 'target-bottom'; }
          }

          if (edge.sourceHandle !== bestSource || edge.targetHandle !== bestTarget) {
            changed = true;
            return { ...edge, sourceHandle: bestSource, targetHandle: bestTarget };
          }
          return edge;
        });
        return changed ? newEdges : eds;
      });

      // --- 拖拽节点插入连线检测 ---
      const dw = draggedNode.measured?.width ?? NODE_DEFAULT_WIDTH;
      const dh = draggedNode.measured?.height ?? NODE_DEFAULT_HEIGHT;
      const dcx = draggedNode.position.x + dw / 2;
      const dcy = draggedNode.position.y + dh / 2;
      const EDGE_INSERT_THRESHOLD = 50;
      let bestEdgeId: string | null = null;
      let bestDist = EDGE_INSERT_THRESHOLD;

      setEdges(eds => {
        for (const edge of eds) {
          // 不检测自身已连接的边
          if (edge.source === draggedNode.id || edge.target === draggedNode.id) continue;
          const sn = currentNodes.find((n: Node) => n.id === edge.source);
          const tn = currentNodes.find((n: Node) => n.id === edge.target);
          if (!sn || !tn) continue;
          const sw = sn.measured?.width ?? NODE_DEFAULT_WIDTH;
          const sh = sn.measured?.height ?? NODE_DEFAULT_HEIGHT;
          const tw = tn.measured?.width ?? NODE_DEFAULT_WIDTH;
          const th = tn.measured?.height ?? NODE_DEFAULT_HEIGHT;
          const sx = sn.position.x + sw / 2, sy = sn.position.y + sh / 2;
          const tx = tn.position.x + tw / 2, ty = tn.position.y + th / 2;
          // 点到线段距离
          const ldx = tx - sx, ldy = ty - sy;
          const lenSq = ldx * ldx + ldy * ldy;
          if (lenSq === 0) continue;
          const t = Math.max(0, Math.min(1, ((dcx - sx) * ldx + (dcy - sy) * ldy) / lenSq));
          const px = sx + t * ldx, py = sy + t * ldy;
          const dist = Math.sqrt((dcx - px) * (dcx - px) + (dcy - py) * (dcy - py));
          if (dist < bestDist) {
            bestDist = dist;
            bestEdgeId = edge.id;
          }
        }
        // 更新高亮
        const prevId = insertEdgeRef.current;
        insertEdgeRef.current = bestEdgeId;
        if (prevId !== bestEdgeId) {
          return eds.map(e => ({
            ...e,
            className: e.id === bestEdgeId ? 'wf-edge-insert-hover' : undefined,
          }));
        }
        return eds;
      });

      // --- 晃动脱离检测（即时执行） ---
      if (!detachNodeRef.current) {
        const now = Date.now();
        const pos = { x: draggedNode.position.x, y: draggedNode.position.y, t: now };
        const history = shakeHistoryRef.current;
        history.push(pos);
        // 只保留最近 1 秒内的记录
        const windowMs = 1000;
        while (history.length > 0 && now - history[0].t > windowMs) history.shift();

        // 计算方向反转次数（x 方向）
        let reversals = 0;
        for (let i = 2; i < history.length; i++) {
          const dx1 = history[i - 1].x - history[i - 2].x;
          const dx2 = history[i].x - history[i - 1].x;
          if ((dx1 > 0 && dx2 < 0) || (dx1 < 0 && dx2 > 0)) reversals++;
        }

        const SHAKE_REVERSALS = 3; // 1秒内来回≥3次 = 晃动
        if (reversals >= SHAKE_REVERSALS) {
          setEdges(eds => {
            const hasIncoming = eds.some(e => e.target === draggedNode.id);
            const hasOutgoing = eds.some(e => e.source === draggedNode.id);
            if (hasIncoming && hasOutgoing) {
              detachNodeRef.current = true;
              shakeHistoryRef.current = [];
              const inEdges = eds.filter(e => e.target === draggedNode.id);
              const outEdges = eds.filter(e => e.source === draggedNode.id);
              const otherEdges = eds.filter(e => e.source !== draggedNode.id && e.target !== draggedNode.id);

              const calcHandles = (from: Node, to: Node) => {
                const fw = from.measured?.width ?? NODE_DEFAULT_WIDTH;
                const fh = from.measured?.height ?? NODE_DEFAULT_HEIGHT;
                const tw = to.measured?.width ?? NODE_DEFAULT_WIDTH;
                const th = to.measured?.height ?? NODE_DEFAULT_HEIGHT;
                const dx = (to.position.x + tw / 2) - (from.position.x + fw / 2);
                const dy = (to.position.y + th / 2) - (from.position.y + fh / 2);
                if (Math.abs(dx) >= Math.abs(dy)) {
                  return dx >= 0
                    ? { sourceHandle: 'source-right', targetHandle: 'target-left' }
                    : { sourceHandle: 'source-left', targetHandle: 'target-right' };
                }
                return dy >= 0
                  ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
                  : { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
              };

              const newEdges: Edge[] = [];
              for (const inE of inEdges) {
                for (const outE of outEdges) {
                  const sn = currentNodes.find((n: Node) => n.id === inE.source);
                  const tn = currentNodes.find((n: Node) => n.id === outE.target);
                  if (!sn || !tn) continue;
                  const existsAlready = otherEdges.some(e => e.source === inE.source && e.target === outE.target);
                  if (existsAlready) continue;
                  const h = calcHandles(sn, tn);
                  newEdges.push({
                    id: `e-${inE.source}-${outE.target}`,
                    source: inE.source,
                    target: outE.target,
                    sourceHandle: h.sourceHandle,
                    targetHandle: h.targetHandle,
                  });
                }
              }
              return [...otherEdges, ...newEdges];
            }
            return eds;
          });
        }
      }
    },
    [getNodes, setEdges]
  );

  // 拖拽放下 — 插入连线
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      const edgeId = insertEdgeRef.current;
      insertEdgeRef.current = null;
      dragStartPosRef.current = null;
      detachNodeRef.current = false;
      shakeHistoryRef.current = [];

      // 清除高亮
      setEdges(eds => eds.map(e => ({ ...e, className: undefined })));

      // --- 插入连线 ---
      if (!edgeId) return;

      const currentNodes = getNodes();
      setEdges(eds => {
        const targetEdge = eds.find(e => e.id === edgeId);
        if (!targetEdge) return eds;
        // 不要插入到自己的边上
        if (targetEdge.source === draggedNode.id || targetEdge.target === draggedNode.id) return eds;

        const sn = currentNodes.find((n: Node) => n.id === targetEdge.source);
        const dn = draggedNode;
        const tn = currentNodes.find((n: Node) => n.id === targetEdge.target);
        if (!sn || !tn) return eds;

        // 计算最佳 handle
        const calcHandles = (from: Node, to: Node) => {
          const fw = from.measured?.width ?? NODE_DEFAULT_WIDTH;
          const fh = from.measured?.height ?? NODE_DEFAULT_HEIGHT;
          const tw = to.measured?.width ?? NODE_DEFAULT_WIDTH;
          const th = to.measured?.height ?? NODE_DEFAULT_HEIGHT;
          const dx = (to.position.x + tw / 2) - (from.position.x + fw / 2);
          const dy = (to.position.y + th / 2) - (from.position.y + fh / 2);
          if (Math.abs(dx) >= Math.abs(dy)) {
            return dx >= 0
              ? { sourceHandle: 'source-right', targetHandle: 'target-left' }
              : { sourceHandle: 'source-left', targetHandle: 'target-right' };
          }
          return dy >= 0
            ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
            : { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
        };

        const h1 = calcHandles(sn, dn);
        const h2 = calcHandles(dn, tn);

        const newEdge1: Edge = {
          id: `e-${targetEdge.source}-${draggedNode.id}`,
          source: targetEdge.source,
          target: draggedNode.id,
          sourceHandle: h1.sourceHandle,
          targetHandle: h1.targetHandle,
        };
        const newEdge2: Edge = {
          id: `e-${draggedNode.id}-${targetEdge.target}`,
          source: draggedNode.id,
          target: targetEdge.target,
          sourceHandle: h2.sourceHandle,
          targetHandle: h2.targetHandle,
        };

        return [...eds.filter(e => e.id !== edgeId), newEdge1, newEdge2];
      });
    },
    [getNodes, setEdges]
  );

  // 连接节点 — 智能选择最短路径的连接点
  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      connectNodes(params.source, params.target, {
        sourceHandle: params.sourceHandle || undefined,
        targetHandle: params.targetHandle || undefined,
      });
    },
    [connectNodes]
  );

  const getClientPoint = (event: MouseEvent | TouchEvent | React.MouseEvent): { x: number; y: number } => {
    if ('touches' in event && event.touches.length > 0) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    if ('changedTouches' in event && event.changedTouches.length > 0) {
      return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
    }
    return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
  };

  const onConnectStart = useCallback((_event: MouseEvent | TouchEvent, params: { nodeId?: string; handleId?: string; handleType?: string }) => {
    if (params.handleType !== 'source' || !params.nodeId) {
      dragConnectRef.current = null;
      setIsDraggingConnection(false);
      return;
    }
    dragConnectRef.current = {
      sourceNodeId: params.nodeId,
      sourceHandleId: params.handleId,
    };
    setIsDraggingConnection(true);
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    const dragSource = dragConnectRef.current;
    dragConnectRef.current = null;
    setIsDraggingConnection(false);
    setConnectionHoverNodeId(null);
    if (!dragSource) return;

    const point = getClientPoint(event);
    const targetNode = findNodeAtClientPosition(point.x, point.y, [dragSource.sourceNodeId]);
    if (!targetNode) return;

    connectNodes(dragSource.sourceNodeId, targetNode.id, {
      sourceHandle: dragSource.sourceHandleId,
    });
  }, [connectNodes, findNodeAtClientPosition]);

  const openQuickConnectFromHandle = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const handleEl = target.closest('.react-flow__handle') as HTMLElement | null;
    if (!handleEl) return;
    const isSourceHandle = handleEl.classList.contains('source') || handleEl.classList.contains('react-flow__handle-source');
    if (!isSourceHandle) return;
    const nodeEl = handleEl.closest('.react-flow__node') as HTMLElement | null;
    const sourceNodeId = nodeEl?.getAttribute('data-id');
    if (!sourceNodeId) return;

    event.stopPropagation();
    const sourceHandleId = handleEl.getAttribute('data-handleid') || undefined;
    setContextMenu(null);
    setQuickConnect({
      mode: 'handle',
      x: event.clientX + 10,
      y: event.clientY + 10,
      sourceNodeIds: [sourceNodeId],
      anchorNodeId: sourceNodeId,
      sourceHandleId,
      query: '',
    });
  }, []);

  const createNodeForQuickConnect = useCallback((nodeType: string, config: QuickConnectState) => {
    const anchor = nodes.find((item) => item.id === config.anchorNodeId);
    const baseX = anchor?.position.x ?? 0;
    const baseY = anchor?.position.y ?? 0;
    const direction = config.mode === 'batch-upstream' ? -1 : 1;
    const x = baseX + direction * 360;
    const closeNodes = nodes.filter((item) => Math.abs(item.position.x - x) < 120);
    const existingLabels = new Set(nodes.map((node) => getNodeDisplayLabel(node)));
    const baseLabel = getDefaultNodeLabelByType(nodeType);
    const uniqueLabel = getUniqueNodeLabel(baseLabel, existingLabels);
    const nodeData = getDefaultNodeData(nodeType);
    const newNode: Node = {
      id: `${nodeType}-${nodeIdCounter++}`,
      type: nodeType,
      position: { x, y: baseY + closeNodes.length * 80 },
      data: {
        ...nodeData,
        customLabel: uniqueLabel === baseLabel ? undefined : uniqueLabel,
      },
      selected: false,
    };
    setNodes((nds) => nds.concat(newNode));
    return newNode;
  }, [nodes, setNodes]);

  const applyQuickConnectToNode = useCallback((targetNodeId: string, config: QuickConnectState) => {
    if (config.mode === 'batch-upstream') {
      config.sourceNodeIds.forEach((selectedId) => {
        connectNodes(targetNodeId, selectedId);
      });
      return;
    }
    if (config.mode === 'batch-downstream') {
      config.sourceNodeIds.forEach((selectedId) => {
        connectNodes(selectedId, targetNodeId);
      });
      return;
    }
    const sourceId = config.sourceNodeIds[0];
    connectNodes(sourceId, targetNodeId, { sourceHandle: config.sourceHandleId });
  }, [connectNodes]);

  const handleQuickConnectExisting = useCallback((targetNodeId: string) => {
    if (!quickConnect) return;
    applyQuickConnectToNode(targetNodeId, quickConnect);
    setQuickConnect(null);
  }, [applyQuickConnectToNode, quickConnect]);

  const handleQuickConnectCreate = useCallback((nodeType: string) => {
    if (!quickConnect) return;
    const newNode = createNodeForQuickConnect(nodeType, quickConnect);
    const nodesAfterCreate = [...nodes, newNode];

    if (quickConnect.mode === 'batch-upstream') {
      quickConnect.sourceNodeIds.forEach((selectedId) => {
        const best = getBestHandles(newNode.id, selectedId, nodesAfterCreate);
        connectNodes(newNode.id, selectedId, {
          sourceHandle: best.sourceHandle,
          targetHandle: best.targetHandle,
          currentNodes: nodesAfterCreate,
        });
      });
    } else if (quickConnect.mode === 'batch-downstream') {
      quickConnect.sourceNodeIds.forEach((selectedId) => {
        const best = getBestHandles(selectedId, newNode.id, nodesAfterCreate);
        connectNodes(selectedId, newNode.id, {
          sourceHandle: best.sourceHandle,
          targetHandle: best.targetHandle,
          currentNodes: nodesAfterCreate,
        });
      });
    } else {
      const sourceId = quickConnect.sourceNodeIds[0];
      const best = getBestHandles(sourceId, newNode.id, nodesAfterCreate);
      connectNodes(sourceId, newNode.id, {
        sourceHandle: quickConnect.sourceHandleId || best.sourceHandle,
        targetHandle: best.targetHandle,
        currentNodes: nodesAfterCreate,
      });
    }

    setQuickConnect(null);
  }, [connectNodes, createNodeForQuickConnect, getBestHandles, nodes, quickConnect]);

  useEffect(() => {
    if (!isDraggingConnection) return;
    const onPointerMove = (event: PointerEvent) => {
      const dragSource = dragConnectRef.current;
      if (!dragSource) {
        setConnectionHoverNodeId(null);
        return;
      }
      const targetNode = findNodeAtClientPosition(event.clientX, event.clientY, [dragSource.sourceNodeId]);
      setConnectionHoverNodeId(targetNode?.id || null);
    };
    window.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [findNodeAtClientPosition, isDraggingConnection]);

  // 更新节点数据 (子节点通过此函数上报数据变化)
  const updateNodeData = useCallback(
    (nodeId: string, newData: any) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, ...newData } } : node
        )
      );
    },
    [setNodes]
  );

  // 从面板拖入节点
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow');
      if (!nodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const existingLabels = new Set(nodes.map((node) => getNodeDisplayLabel(node)));
      const baseLabel = getDefaultNodeLabelByType(nodeType);
      const uniqueLabel = getUniqueNodeLabel(baseLabel, existingLabels);
      const nodeData = getDefaultNodeData(nodeType);
      const newNode: Node = {
        id: `${nodeType}-${nodeIdCounter++}`,
        type: nodeType,
        position,
        data: {
          ...nodeData,
          customLabel: uniqueLabel === baseLabel ? undefined : uniqueLabel,
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [nodes, screenToFlowPosition, setNodes]
  );

  // ======== 复制所选节点 ========
  const duplicateSelectedNodes = useCallback(() => {
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    const existingLabels = new Set(nodes.map((node) => getNodeDisplayLabel(node)));
    const newNodes: Node[] = selectedNodes.map((n) => {
      const newId = `${n.type}-${nodeIdCounter++}`;
      const sourceLabel = getNodeDisplayLabel(n);
      const uniqueLabel = getUniqueNodeLabel(sourceLabel, existingLabels);
      existingLabels.add(uniqueLabel);
      const defaultLabel = getDefaultNodeLabelByType(n.type as string | undefined);
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + 60, y: n.position.y + 60 },
        selected: false,
        data: {
          ...n.data,
          nodeId: undefined,
          updateNodeData: undefined,
          customLabel: uniqueLabel === defaultLabel ? undefined : uniqueLabel,
          // 清除输出结果但保留配置
          entries: n.type === 'outputNode' ? [] : n.data.entries,
          result: n.type === 'promptWriter' ? '' : n.data.result,
        },
      };
    });

    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })), // 取消原节点选中
      ...newNodes.map((n) => ({ ...n, selected: true })), // 选中新节点
    ]);
  }, [nodes, setNodes]);

  // 键盘快捷键：复制 / 撤销 / 前进
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete/Backspace: 优先删除选中节点（不管焦点在哪）
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
        
        const selectedIds = nodes.filter(n => n.selected).map(n => n.id);
        if (selectedIds.length > 0 && !isTyping) {
          e.preventDefault();
          e.stopPropagation();
          deleteNodesWithBridge(selectedIds);
          return;
        }
        // 焦点在输入框内时不拦截，让用户正常删字
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isTypingElement = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
        if (isTypingElement) return;
      }

      const hasModKey = e.metaKey || e.ctrlKey;
      if (!hasModKey) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoWorkflowChange();
        return;
      }
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoWorkflowChange();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelectedNodes();
      }

      // Ctrl/Cmd+C: 复制选中节点
      if (key === 'c') {
        const selected = nodes.filter(n => n.selected);
        if (selected.length > 0) {
          clipboardNodesRef.current = selected.map(n => ({ ...n, data: { ...n.data } }));
        }
        return;
      }

      // Ctrl/Cmd+V: 粘贴节点
      if (key === 'v') {
        const clipboard = clipboardNodesRef.current;
        if (clipboard.length === 0) return;
        e.preventDefault();
        const existingLabels = new Set(nodes.map(node => getNodeDisplayLabel(node)));
        const newNodes: Node[] = clipboard.map((n, idx) => {
          const newId = `${n.type}-${nodeIdCounter++}`;
          const sourceLabel = getNodeDisplayLabel(n);
          const uniqueLabel = getUniqueNodeLabel(sourceLabel, existingLabels);
          existingLabels.add(uniqueLabel);
          const defaultLabel = getDefaultNodeLabelByType(n.type as string | undefined);
          return {
            ...n,
            id: newId,
            position: { x: n.position.x + 80, y: n.position.y + 80 },
            selected: true,
            data: {
              ...n.data,
              nodeId: undefined,
              updateNodeData: undefined,
              customLabel: uniqueLabel === defaultLabel ? undefined : uniqueLabel,
            },
          };
        });
        // 取消旧节点选中
        setNodes(nds => [
          ...nds.map(n => ({ ...n, selected: false })),
          ...newNodes,
        ]);
        // 更新 clipboard 位置以便连续粘贴
        clipboardNodesRef.current = newNodes.map(n => ({ ...n, data: { ...n.data } }));
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [deleteNodesWithBridge, duplicateSelectedNodes, nodes, redoWorkflowChange, setNodes, undoWorkflowChange]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    event.stopPropagation();

    const selectedIds = nodes.filter((item) => item.selected).map((item) => item.id);
    const effectiveSelectedIds = selectedIds.includes(node.id) ? selectedIds : [node.id];

    if (!selectedIds.includes(node.id)) {
      setNodes((nds) => nds.map((item) => ({ ...item, selected: item.id === node.id })));
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
      selectedNodeIds: effectiveSelectedIds,
    });
    setQuickConnect(null);
  }, [nodes, setNodes]);

  // 双击节点 → 聚焦（平滑缩放到该节点）
  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    fitView({
      nodes: [{ id: node.id }],
      padding: 0.35,
      maxZoom: 1,
      duration: 400,
    });
  }, [fitView]);

  // 点击任意处关闭右键菜单
  useEffect(() => {
    if (!contextMenu && !quickConnect) return;
    const close = () => {
      setContextMenu(null);
      setQuickConnect(null);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu, quickConnect]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setContextMenu(null);
      setQuickConnect(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  // 一键整理节点布局
  const autoLayout = useCallback(() => {
    if (nodes.length === 0) return;

    // 拓扑排序，计算每个节点的"深度"（距离源节点的距离）
    const inDegree = new Map<string, number>();
    const outEdges = new Map<string, string[]>();
    nodes.forEach(n => { inDegree.set(n.id, 0); outEdges.set(n.id, []); });
    edges.forEach(e => {
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      outEdges.get(e.source)?.push(e.target);
    });

    const depth = new Map<string, number>();
    const queue: string[] = [];
    nodes.forEach(n => {
      if ((inDegree.get(n.id) || 0) === 0) {
        queue.push(n.id);
        depth.set(n.id, 0);
      }
    });

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const d = depth.get(nodeId) || 0;
      for (const target of (outEdges.get(nodeId) || [])) {
        const newDeg = (inDegree.get(target) || 0) - 1;
        inDegree.set(target, newDeg);
        depth.set(target, Math.max(depth.get(target) || 0, d + 1));
        if (newDeg === 0) queue.push(target);
      }
    }

    // 没有连线的节点放最后一列
    const maxDepth = Math.max(...Array.from(depth.values()), 0);
    nodes.forEach(n => { if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1); });

    // 按列分组
    const columns = new Map<number, string[]>();
    depth.forEach((d, nodeId) => {
      if (!columns.has(d)) columns.set(d, []);
      columns.get(d)!.push(nodeId);
    });

    const COL_GAP = 380;
    const VERTICAL_PAD = 40; // 节点之间的垂直间距

    // 测量每个节点的实际 DOM 高度
    const nodeHeights = new Map<string, number>();
    nodes.forEach(n => {
      const el = document.querySelector(`[data-id="${n.id}"]`) as HTMLElement;
      const h = el ? el.offsetHeight : 300; // 默认高度
      nodeHeights.set(n.id, h);
    });

    setNodes(nds => nds.map(n => {
      const col = depth.get(n.id) || 0;
      const colNodes = columns.get(col) || [];
      const rowIdx = colNodes.indexOf(n.id);

      // 计算该列总高度
      let totalHeight = 0;
      colNodes.forEach(nid => { totalHeight += (nodeHeights.get(nid) || 300) + VERTICAL_PAD; });
      totalHeight -= VERTICAL_PAD; // 最后一个不需要 pad

      // 从中心偏移
      let y = -(totalHeight / 2);
      for (let i = 0; i < rowIdx; i++) {
        y += (nodeHeights.get(colNodes[i]) || 300) + VERTICAL_PAD;
      }

      return {
        ...n,
        position: { x: col * COL_GAP + 80, y: y + 200 },
      };
    }));

    // 强置现有连线的出入口为标准从右到左，修正历史连线满天飞的问题
    setEdges(eds => eds.map(e => ({
      ...e,
      sourceHandle: 'source-right',
      targetHandle: 'target-left'
    })));

    setTimeout(() => fitView({ padding: 0.15, maxZoom: 0.85 }), 100);
  }, [nodes, edges, setNodes, setEdges, fitView]);

  // Toast 通知状态
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((msg: string, duration = 3000) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), duration);
  }, []);

  // 确认弹窗状态
  const [confirmDialog, setConfirmDialog] = useState<{ msg: string; onOk: () => void } | null>(null);
  const [promptDialog, setPromptDialog] = useState<{ msg: string; defaultValue: string; onOk: (val: string) => void } | null>(null);

  // 一键清理无用节点（没有连线的节点）
  const cleanUnusedNodes = useCallback(() => {
    const connectedIds = new Set<string>();
    edges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target); });
    const unused = nodes.filter(n => !connectedIds.has(n.id));
    if (unused.length === 0) {
      showToast('✅ 所有节点都已连线，没有可清理的节点');
      return;
    }
    setConfirmDialog({
      msg: `发现 ${unused.length} 个未连线节点，确定删除？`,
      onOk: () => {
        setNodes(nds => nds.filter(n => connectedIds.has(n.id)));
        showToast(`🧹 已清理 ${unused.length} 个节点`);
      },
    });
  }, [nodes, edges, setNodes, showToast]);

  // 一键清空所有批量数据
  const clearAllBatchData = useCallback(() => {
    const inputNodes = nodes.filter(n => n.type === 'inputNode');
    const hasData = inputNodes.some(n => {
      const imgs = ((n.data as any)?.images || []).length;
      const text = (n.data as any)?.text || '';
      return imgs > 0 || text;
    });
    if (!hasData) {
      showToast('没有需要清空的数据');
      return;
    }
    setConfirmDialog({
      msg: '确定清空所有输入节点的批量数据？',
      onOk: () => {
        inputNodes.forEach(n => updateNodeData(n.id, { images: [], text: '' }));
        showToast('🗑 已清空所有批量数据');
      },
    });
  }, [nodes, updateNodeData, showToast]);

  // 运行工作流（智能合批 + 配套批量）
  const handleRun = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);
    setLastResult(null);
    setRunProgress('');

    try {
      const allEntries: any[] = [];
      const allAiLogs: AiLogEntry[] = [];
      const inputNodes = nodes.filter(n => n.type === 'inputNode');

      // 配套模式：所有输入节点的「图片组」按行对齐
      const getImageGroups = (n: any): string[][] => {
        const groups = (n.data as any)?.imageGroups;
        if (groups && Array.isArray(groups) && groups.length > 0) return groups;
        const imgs = (n.data as any)?.images || [];
        return imgs.map((img: string) => [img]);
      };

      const maxRows = inputNodes.reduce((max, n) => {
        return Math.max(max, getImageGroups(n).length);
      }, 0);

      // ✨ 智能合批判断：有随机库或代码随机节点 + 无图片组 + 批量 > 1
      const hasRandomSource = nodes.some(n =>
        n.type === 'randomLibrary' || n.type === 'codeRandom'
      );
      const hasPromptWriter = nodes.some(n => n.type === 'promptWriter');
      const useSmartBatch = maxRows === 0 && batchCount > 1 && hasRandomSource && hasPromptWriter;

      if (useSmartBatch) {
        // ========== 智能合批路径 ==========
        // 一次运行，内部展开 N 个组合 → 1 次 AI 调用
        setRunProgress(`智能合批: 生成 ${batchCount} 个组合...`);

        const result = await runWorkflow(nodes, edges, updateNodeData, getAiInstance, batchCount);
        if (result.aiLogs) allAiLogs.push(...result.aiLogs);

        // 收集输出（输出节点已在引擎内展开为多行）
        if (result.outputs) {
          for (const [, data] of Object.entries(result.outputs)) {
            if ((data as any).entries && Array.isArray((data as any).entries)) {
              allEntries.push(...(data as any).entries);
            }
          }
        }
      } else {
        // ========== 传统循环路径 ==========
        // 有图片组 → 按行数运行; 无图片 → 使用批量计数
        const totalRuns = maxRows > 0 ? maxRows : batchCount;

        for (let i = 0; i < totalRuns; i++) {
          setRunProgress(`正在生成 ${i + 1}/${totalRuns}...`);

          // 配套模式：每个输入节点取第 i 组图片
          let originalImages: Map<string, string[]> | null = null;
          if (maxRows > 0) {
            originalImages = new Map();
            inputNodes.forEach(n => {
              const imgs = (n.data as any).images || [];
              originalImages!.set(n.id, imgs);
              const groups = getImageGroups(n);
              const slotImages = groups[i] || [];
              updateNodeData(n.id, { images: slotImages });
            });
            await new Promise(r => setTimeout(r, 50));
          }

          const result = await runWorkflow(nodes, edges, updateNodeData, getAiInstance);
          if (result.aiLogs) allAiLogs.push(...result.aiLogs);

          // 恢复原始图片
          if (originalImages) {
            originalImages.forEach((imgs, nid) => {
              updateNodeData(nid, { images: imgs });
            });
          }

          // 收集输出
          if (result.outputs) {
            for (const [, data] of Object.entries(result.outputs)) {
              if ((data as any).entries && Array.isArray((data as any).entries)) {
                const entries = (data as any).entries.map((entry: any) => ({
                  ...entry,
                  taskLabel: `第 ${i + 1}/${totalRuns} 组`,
                }));
                allEntries.push(...entries);
              }
            }
          }
        }
      }

      if (allEntries.length > 0) {
        const outputNodes = nodes.filter((n) => n.type === 'outputNode');
        outputNodes.forEach((outNode) => {
          const prevEntries = (outNode.data as any).entries || [];
          updateNodeData(outNode.id, { entries: [...prevEntries, ...allEntries] });
        });
      }

      setLastResult({ success: true });
      setRunProgress('');
      if (allAiLogs.length > 0) setAiLogs(prev => [...prev, ...allAiLogs]);
    } catch (err: any) {
      setLastResult({ success: false, error: err.message || '工作流执行失败' });
      setRunProgress('');
    } finally {
      setIsRunning(false);
    }
  }, [nodes, edges, updateNodeData, getAiInstance, isRunning, batchCount]);

  // ======== 流程持久化 ========
  const saveCurrentFlow = useCallback((name?: string) => {
    const flowName = name || currentFlowName || '未命名流程';
    const flowId = currentFlowId || `flow-${Date.now()}`;
    const flow: SavedFlow = {
      id: flowId,
      name: flowName,
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data, nodeId: undefined, updateNodeData: undefined } })),
      edges,
      updatedAt: Date.now(),
    };
    const flows = loadFlows();
    const idx = flows.findIndex((f) => f.id === flowId);
    if (idx >= 0) flows[idx] = flow;
    else flows.push(flow);
    saveFlows(flows);
    setSavedFlows(flows);
    setCurrentFlowId(flowId);
    setCurrentFlowName(flowName);
    setActiveFlowId(flowId);
  }, [nodes, edges, currentFlowId, currentFlowName]);

  const loadFlow = useCallback((flow: SavedFlow) => {
    historySkipNextRef.current += 1;
    resetHistoryWithState(flow.nodes, flow.edges);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setCurrentFlowName(flow.name);
    setCurrentFlowId(flow.id);
    setActiveFlowId(flow.id);
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [fitView, resetHistoryWithState, setEdges, setNodes]);

  const deleteFlow = useCallback((flowId: string) => {
    const flows = loadFlows().filter((f) => f.id !== flowId);
    saveFlows(flows);
    setSavedFlows(flows);
    if (currentFlowId === flowId) {
      setCurrentFlowId(null);
      setActiveFlowId(null);
    }
  }, [currentFlowId]);

  const exportFlow = useCallback(() => {
    const flow = {
      name: currentFlowName,
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data, nodeId: undefined, updateNodeData: undefined } })),
      edges,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${currentFlowName}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, currentFlowName]);

  const importFlow = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const flow = JSON.parse(reader.result as string);
          if (flow.nodes && flow.edges) {
            historySkipNextRef.current += 1;
            resetHistoryWithState(flow.nodes, flow.edges);
            setNodes(flow.nodes);
            setEdges(flow.edges);
            setCurrentFlowName(flow.name || '导入的流程');
            setCurrentFlowId(null);
            setTimeout(() => fitView({ padding: 0.2 }), 100);
          }
        } catch {
          alert('导入失败：文件格式不正确');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [fitView, resetHistoryWithState, setEdges, setNodes]);

  const newFlow = useCallback((name: string) => {
    historySkipNextRef.current += 1;
    resetHistoryWithState([], []);
    setNodes([]);
    setEdges([]);
    setCurrentFlowName(name);
    setCurrentFlowId(null);
    setActiveFlowId(null);
  }, [resetHistoryWithState, setEdges, setNodes]);

  // ======== 表格流程同步 ========
  const refreshSheetFlows = useCallback(async () => {
    if (!flowSheetConfig.sheetId) return;
    setSheetSyncStatus('loading');
    setSheetSyncError('');
    const { flows, error } = await fetchFlowPresetsFromSheet(flowSheetConfig);
    if (error) {
      setSheetSyncStatus('error');
      setSheetSyncError(error);
      return;
    }
    setSheetFlows(flows);
    setSheetSyncStatus('success');
    // 合并到本地（按 id 去重，表格覆盖本地同 id 的）
    if (flows.length > 0) {
      const local = loadFlows();
      const localMap = new Map(local.map(f => [f.id, f]));
      for (const sf of flows) {
        localMap.set(sf.id, sf); // sheet 覆盖同 id
      }
      const merged = [...localMap.values()];
      saveFlows(merged);
      setSavedFlows(merged);
    }
    setTimeout(() => setSheetSyncStatus('idle'), 2000);
  }, [flowSheetConfig]);

  // 自动刷新：首次打开时
  const sheetAutoRefreshedRef = useRef(false);
  useEffect(() => {
    if (flowSheetConfig.autoRefresh && flowSheetConfig.sheetId && !sheetAutoRefreshedRef.current) {
      sheetAutoRefreshedRef.current = true;
      refreshSheetFlows();
    }
  }, [flowSheetConfig, refreshSheetFlows]);

  // 批量导入所有流程
  const importAllFlows = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          const importedFlows: SavedFlow[] = data.flows || [];
          if (importedFlows.length === 0) {
            alert('文件中没有流程数据');
            return;
          }
          // 合并到本地
          const local = loadFlows();
          const localMap = new Map(local.map(f => [f.id, f]));
          for (const f of importedFlows) {
            localMap.set(f.id, f);
          }
          const merged = [...localMap.values()];
          saveFlows(merged);
          setSavedFlows(merged);
          alert(`成功导入 ${importedFlows.length} 个流程（合并后共 ${merged.length} 个）`);
        } catch {
          alert('导入失败：文件格式不正确');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const exportAllFlowsHandler = useCallback(() => {
    const flows = loadFlows();
    if (flows.length === 0) {
      alert('没有已保存的流程可导出');
      return;
    }
    exportAllFlows(flows);
  }, []);

  // 将 updateNodeData 传给每个节点
  const nodesWithCallbacks = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      className: [
        node.className,
        node.id === connectionHoverNodeId ? 'wf-connection-hover' : '',
      ].filter(Boolean).join(' '),
      data: {
        ...node.data,
        nodeId: node.id,
        updateNodeData,
      },
    }));
  }, [connectionHoverNodeId, nodes, updateNodeData]);

  const quickConnectCandidates = useMemo(() => {
    if (!quickConnect) return [];
    const excludedIds = new Set(quickConnect.sourceNodeIds);
    const normalizedQuery = quickConnect.query.trim().toLowerCase();
    return nodes
      .filter((node) => !excludedIds.has(node.id))
      .map((node) => ({ id: node.id, title: getNodeTitle(node), type: node.type || 'node' }))
      .filter((item) => !normalizedQuery || item.title.toLowerCase().includes(normalizedQuery));
  }, [getNodeTitle, nodes, quickConnect]);

  const quickConnectPalette = useMemo(() => {
    const normalizedQuery = quickConnect?.query.trim().toLowerCase() || '';
    return NODE_PALETTE.filter((item) => {
      if (!normalizedQuery) return true;
      return item.label.toLowerCase().includes(normalizedQuery) || item.desc.toLowerCase().includes(normalizedQuery);
    });
  }, [quickConnect]);

  const contextMenuPosition = useMemo(() => {
    if (!contextMenu) return null;
    return clampOverlayPosition(contextMenu.x, contextMenu.y, 220, 240);
  }, [clampOverlayPosition, contextMenu]);

  const quickConnectPosition = useMemo(() => {
    if (!quickConnect) return null;
    const estimatedHeight = typeof window === 'undefined'
      ? 560
      : Math.min(Math.round(window.innerHeight * 0.78), 620);
    return clampOverlayPosition(quickConnect.x, quickConnect.y, 340, estimatedHeight);
  }, [clampOverlayPosition, quickConnect]);

  // 批量面板：收集所有输入节点
  const inputNodesForPanel = useMemo(() => {
    return nodes.filter(n => n.type === 'inputNode');
  }, [nodes]);

  // 批量面板：图片添加
  const handleBatchAddImages = useCallback((inputNodeId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'));
      let loaded = 0;
      const newImages: string[] = [];
      fileArr.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          newImages.push(ev.target?.result as string);
          loaded++;
          if (loaded === fileArr.length) {
            const node = nodes.find(n => n.id === inputNodeId);
            const existing = (node?.data as any)?.images || [];
            updateNodeData(inputNodeId, { images: [...existing, ...newImages] });
          }
        };
        reader.readAsDataURL(file);
      });
    };
    input.click();
  }, [nodes, updateNodeData]);

  const handleBatchRemoveImage = useCallback((inputNodeId: string, imageIndex: number) => {
    const node = nodes.find(n => n.id === inputNodeId);
    const imgs = [...((node?.data as any)?.images || [])];
    imgs.splice(imageIndex, 1);
    updateNodeData(inputNodeId, { images: imgs });
  }, [nodes, updateNodeData]);

  const handleBatchClearImages = useCallback((inputNodeId: string) => {
    updateNodeData(inputNodeId, { images: [], imageGroups: [] });
  }, [updateNodeData]);

  // 计算总图片数
  const totalImageCount = useMemo(() => {
    return inputNodesForPanel.reduce((sum, n) => sum + ((n.data as any)?.images?.length || 0), 0);
  }, [inputNodesForPanel]);

  return (
    <div className="workflow-editor-app">
      {/* 顶部节点库（横排） */}
      <div className="workflow-node-palette">
        <div className="palette-title">节点库</div>
        {NODE_PALETTE.map((item) => (
          <div
            key={item.type}
            className="palette-item"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/reactflow', item.type);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => {
              // 点击在视窗中心添加节点
              const vp = getViewport();
              const wrapper = reactFlowWrapper.current;
              const w = wrapper?.clientWidth || 800;
              const h = wrapper?.clientHeight || 600;
              const centerX = (-vp.x + w / 2) / vp.zoom;
              const centerY = (-vp.y + h / 2) / vp.zoom;
              // 加一点随机偏移避免完全重叠
              const offset = (Math.random() - 0.5) * 80;
              const position = { x: centerX + offset, y: centerY + offset };
              const existingLabels = new Set(nodes.map((node) => getNodeDisplayLabel(node)));
              const baseLabel = getDefaultNodeLabelByType(item.type);
              const uniqueLabel = getUniqueNodeLabel(baseLabel, existingLabels);
              const nodeData = getDefaultNodeData(item.type);
              const newNode: Node = {
                id: `${item.type}-${nodeIdCounter++}`,
                type: item.type,
                position,
                data: {
                  ...nodeData,
                  customLabel: uniqueLabel === baseLabel ? undefined : uniqueLabel,
                },
              };
              setNodes((nds) => nds.concat(newNode));
            }}
            style={{ '--node-color': item.color, cursor: 'pointer' } as React.CSSProperties}
          >
            <div className="palette-item-label">{item.label}</div>
            <div className="palette-item-desc">{item.desc}</div>
          </div>
        ))}
      </div>

      {/* 主体区域 */}
      <div className="workflow-main-area">
        {/* 左侧批量数据面板 */}
        <div
          className={`workflow-batch-panel ${batchPanelCollapsed ? 'collapsed' : ''}`}
          onPaste={async (e) => {
            if (batchPanelCollapsed) return;
            if (inputNodesForPanel.length === 0) return;
            const html = e.clipboardData.getData('text/html');
            const text = e.clipboardData.getData('text/plain');

            console.log('[WF Paste] text/plain:', JSON.stringify(text?.slice(0, 500)));
            console.log('[WF Paste] text/html:', JSON.stringify(html?.slice(0, 1000)));
            console.log('[WF Paste] has =IMAGE in text:', text?.includes('=IMAGE'));
            console.log('[WF Paste] has data-sheets in html:', html?.includes('data-sheets'));
            console.log('[WF Paste] has <img in html:', html?.includes('<img'));

            // 1. 直接粘贴图片文件
            const clipItems = e.clipboardData.items;
            const imageFiles: File[] = [];
            for (let ci = 0; ci < clipItems.length; ci++) {
              if (clipItems[ci].type.startsWith('image/')) {
                const file = clipItems[ci].getAsFile();
                if (file) imageFiles.push(file);
              }
            }
            if (imageFiles.length > 0) {
              e.preventDefault();
              const targetNodeId = inputNodesForPanel[0].id;
              let loaded = 0;
              const newImages: string[] = [];
              imageFiles.forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  newImages.push(ev.target?.result as string);
                  loaded++;
                  if (loaded === imageFiles.length) {
                    const existing = (nodes.find(n => n.id === targetNodeId)?.data as any)?.images || [];
                    updateNodeData(targetNodeId, { images: [...existing, ...newImages] });
                    showToast(`📷 已粘贴 ${imageFiles.length} 张图片`);
                  }
                };
                reader.readAsDataURL(file);
              });
              return;
            }

            // 1.5 纯文本中的 =IMAGE() 公式（Google Sheets 粘贴的关键路径）
            if (text && text.includes('=IMAGE')) {
              e.preventDefault();
              const lines = text.split('\n').map(l => l.trim()).filter(l => l);
              const rows = lines.map(line => line.split('\t'));
              const colCount = Math.max(...rows.map(r => r.length));
              
              let imgCount = 0;
              let txtCount = 0;
              showToast('📥 正在解析图片公式...');
              
              // 按列分配到输入节点
              let nodeIdx = 0;
              for (let c = 0; c < colCount && nodeIdx < inputNodesForPanel.length; c++) {
                const colValues = rows.map(r => (r[c] || '').trim()).filter(v => v);
                if (colValues.length === 0) continue;
                
                const inputNode = inputNodesForPanel[nodeIdx];
                // 检测该列是否含 =IMAGE() 或 URL
                const hasFormula = colValues.some(v => /=IMAGE/i.test(v) || /^https?:\/\//i.test(v));
                
                if (hasFormula) {
                  // 图片列：用 parsePasteInput 提取 URL
                  const parsed = parsePasteInput(colValues.join('\n'));
                  if (parsed.length > 0) {
                    const existing = (inputNode.data as any)?.images || [];
                    const downloaded: string[] = [];
                    for (const item of parsed) {
                      try {
                        const { blob } = await fetchImageBlob(item.url);
                        const base64 = await convertBlobToBase64(blob);
                        const mimeType = blob.type || 'image/jpeg';
                        downloaded.push(`data:${mimeType};base64,${base64}`);
                      } catch (err) {
                        console.warn('下载图片失败:', item.url, err);
                      }
                    }
                    if (downloaded.length > 0) {
                      updateNodeData(inputNode.id, { images: [...existing, ...downloaded] });
                      imgCount += downloaded.length;
                    }
                  }
                } else {
                  // 纯文本列
                  const existingText = (inputNode.data as any)?.text || '';
                  const joined = colValues.join('\n');
                  updateNodeData(inputNode.id, { text: existingText ? existingText + '\n' + joined : joined });
                  txtCount += colValues.length;
                }
                nodeIdx++;
              }
              
              // 单节点时：如果只处理了图片列还没处理文本列，把剩余文本列也给它
              if (inputNodesForPanel.length === 1 && nodeIdx === 1 && colCount > 1) {
                const inputNode = inputNodesForPanel[0];
                for (let c = 1; c < colCount; c++) {
                  const colValues = rows.map(r => (r[c] || '').trim()).filter(v => v);
                  const hasFormula = colValues.some(v => /=IMAGE/i.test(v) || /^https?:\/\//i.test(v));
                  if (!hasFormula && colValues.length > 0) {
                    const existingText = (inputNode.data as any)?.text || '';
                    const joined = colValues.join('\n');
                    updateNodeData(inputNode.id, { text: existingText ? existingText + '\n' + joined : joined });
                    txtCount += colValues.length;
                  }
                }
              }
              
              const msgs: string[] = [];
              if (imgCount > 0) msgs.push(`${imgCount} 张图片`);
              if (txtCount > 0) msgs.push(`${txtCount} 条文本`);
              showToast(`✅ 已粘贴 ${msgs.join(' + ') || '数据'}`);
              return;
            }

            // 2. Google Sheets HTML → 提取图片 URL + 文本列
            if (html && (html.includes('data-sheets') || html.includes('google.com') || html.includes('=IMAGE') || html.includes('<img'))) {
              e.preventDefault();
              
              // 方法A: extractUrlsFromHtml（检查 data-sheets-formula / data-sheets-value）
              let imgUrls = extractUrlsFromHtml(html);
              
              // 方法B: 直接用 <img src="..."> 正则（和 AI 图片识别一样）
              if (imgUrls.length === 0) {
                const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
                const imgMatches = [...html.matchAll(imgRegex)];
                if (imgMatches.length > 0) {
                  const decodeHtml = (str: string): string => {
                    if (!str || !str.includes('&')) return str;
                    const ta = document.createElement('textarea');
                    ta.innerHTML = str;
                    const v = ta.value;
                    ta.remove();
                    return v;
                  };
                  imgUrls = imgMatches.map(m => {
                    const decoded = decodeHtml(m[1]);
                    return { originalUrl: decoded, fetchUrl: decoded };
                  });
                }
              }
              
              if (imgUrls.length > 0) {
                showToast(`📥 正在下载 ${imgUrls.length} 张图片...`);
                const targetNodeId = inputNodesForPanel[0].id;
                const existing = (nodes.find(n => n.id === targetNodeId)?.data as any)?.images || [];
                const downloaded: string[] = [];
                for (const pair of imgUrls) {
                  try {
                    const { blob } = await fetchImageBlob(pair.fetchUrl);
                    const base64 = await convertBlobToBase64(blob);
                    const mimeType = blob.type || 'image/jpeg';
                    downloaded.push(`data:${mimeType};base64,${base64}`);
                  } catch (err) {
                    console.warn('下载图片失败:', pair.fetchUrl, err);
                  }
                }
                if (downloaded.length > 0) {
                  updateNodeData(targetNodeId, { images: [...existing, ...downloaded] });
                  showToast(`✅ 已从表格导入 ${downloaded.length} 张图片`);
                } else {
                  showToast('⚠️ 图片下载失败，请检查链接');
                }

                // 处理文本列（text/plain 里非空的列就是文本）
                const textLines = (text || '').split('\n').map(l => l.trim()).filter(l => l);
                if (textLines.length > 0) {
                  const textRows = textLines.map(line => line.split('\t'));
                  const colCount = Math.max(...textRows.map(r => r.length));
                  // 找所有有内容的列（排除 =IMAGE 和 URL 列）
                  const textColumns: string[][] = [];
                  for (let c = 0; c < colCount; c++) {
                    const colValues = textRows.map(r => (r[c] || '').trim());
                    const nonEmpty = colValues.filter(v => v);
                    const isImg = nonEmpty.some(v => /=IMAGE/i.test(v) || /^https?:\/\//i.test(v));
                    // 如果该列大部分为空，可能是图片列（text/plain 里显示空）
                    const emptyRatio = (colValues.length - nonEmpty.length) / colValues.length;
                    if (!isImg && nonEmpty.length > 0 && emptyRatio < 0.8) {
                      textColumns.push(nonEmpty);
                    }
                  }
                  
                  if (textColumns.length > 0) {
                    if (inputNodesForPanel.length === 1) {
                      const existingText = (inputNodesForPanel[0].data as any)?.text || '';
                      const newText = textColumns[0].join('\n');
                      updateNodeData(inputNodesForPanel[0].id, {
                        text: existingText ? existingText + '\n' + newText : newText,
                      });
                    } else {
                      textColumns.forEach((texts, idx) => {
                        const targetNode = inputNodesForPanel[idx + 1];
                        if (targetNode) {
                          const existingText = (targetNode.data as any)?.text || '';
                          const newText = texts.join('\n');
                          updateNodeData(targetNode.id, {
                            text: existingText ? existingText + '\n' + newText : newText,
                          });
                        }
                      });
                    }
                  }
                }
                return;
              }
            }

            // 3. 纯文本 / 表格粘贴（非 Google Sheets HTML）
            if (text.trim()) {
              const lines = text.split('\n').map(l => l.trim()).filter(l => l);
              if (lines.length > 0) {
                e.preventDefault();
                const rows = lines.map(line => line.split('\t'));
                const colCount = Math.max(...rows.map(r => r.length));

                // 检查每列是否为图片 URL 列
                const isImageColumn = (colIdx: number) => {
                  const colVals = rows.map(r => (r[colIdx] || '').trim()).filter(v => v);
                  return colVals.some(v => v.startsWith('=IMAGE') || /^https?:\/\//i.test(v));
                };

                let addedCount = 0;
                let imageCount = 0;
                
                // 按列分配到各输入节点
                let nodeIdx = 0;
                for (let c = 0; c < colCount && nodeIdx < inputNodesForPanel.length; c++) {
                  const colValues = rows.map(r => (r[c] || '').trim()).filter(t => t);
                  if (colValues.length === 0) continue;

                  const inputNode = inputNodesForPanel[nodeIdx];
                  
                  if (isImageColumn(c)) {
                    // 图片列：提取 URL 并下载
                    const urls: string[] = [];
                    colValues.forEach(v => {
                      const formulaMatch = v.match(/=IMAGE\s*\(\s*["']([^"']+)["']/i);
                      if (formulaMatch) urls.push(formulaMatch[1]);
                      else if (/^https?:\/\//i.test(v)) urls.push(v);
                    });
                    if (urls.length > 0) {
                      showToast(`📥 正在下载 ${urls.length} 张图片...`);
                      const existing = (inputNode.data as any)?.images || [];
                      const downloaded: string[] = [];
                      for (const url of urls) {
                        try {
                          const { blob } = await fetchImageBlob(url);
                          const base64 = await convertBlobToBase64(blob);
                          const mimeType = blob.type || 'image/jpeg';
                          downloaded.push(`data:${mimeType};base64,${base64}`);
                        } catch (err) {
                          console.warn('下载失败:', url, err);
                        }
                      }
                      if (downloaded.length > 0) {
                        updateNodeData(inputNode.id, { images: [...existing, ...downloaded] });
                        imageCount += downloaded.length;
                      }
                    }
                  } else {
                    // 纯文本列
                    const existingText = (inputNode.data as any)?.text || '';
                    const joined = colValues.join('\n');
                    updateNodeData(inputNode.id, { text: existingText ? existingText + '\n' + joined : joined });
                    addedCount += colValues.length;
                  }
                  nodeIdx++;
                }
                
                const msgs: string[] = [];
                if (imageCount > 0) msgs.push(`${imageCount} 张图片`);
                if (addedCount > 0) msgs.push(`${addedCount} 条文本`);
                showToast(`📋 已粘贴 ${msgs.join(' + ') || '数据'}`);
              }
            }
          }}
        >
          <div className="wf-bp-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                className="wf-panel-toggle"
                onClick={() => setBatchPanelCollapsed(c => !c)}
                title={batchPanelCollapsed ? '展开' : '收起'}
              >{batchPanelCollapsed ? '▶' : '◀'}</button>
              {!batchPanelCollapsed && <span>📋 批量数据</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {totalImageCount > 0 && (
                <span style={{ fontSize: '10px', color: '#64748b' }}>{totalImageCount} 张</span>
              )}
              <button
                className="wf-node-btn"
                style={{ fontSize: '10px', padding: '2px 6px' }}
                title="从表格粘贴：列1→节点1，列2→节点2..."
                onClick={async () => {
                  try {
                    if (inputNodesForPanel.length === 0) return;
                    
                    let clipHtml = '';
                    let clipText = '';
                    
                    // 用 clipboard.read() 同时读取 HTML 和纯文本
                    try {
                      const items = await navigator.clipboard.read();
                      for (const item of items) {
                        if (item.types.includes('text/html')) {
                          const blob = await item.getType('text/html');
                          clipHtml = await blob.text();
                        }
                        if (item.types.includes('text/plain')) {
                          const blob = await item.getType('text/plain');
                          clipText = await blob.text();
                        }
                      }
                    } catch {
                      // fallback: 只读纯文本
                      clipText = await navigator.clipboard.readText();
                    }
                    
                    console.log('[WF Paste Btn] html:', clipHtml?.slice(0, 500));
                    console.log('[WF Paste Btn] text:', clipText?.slice(0, 300));
                    
                    if (!clipText.trim() && !clipHtml) return;
                    
                    let imgCount = 0;
                    let txtCount = 0;
                    
                    // 从 HTML 提取图片（Google Sheets <img> 标签）
                    if (clipHtml && (clipHtml.includes('data-sheets') || clipHtml.includes('<img'))) {
                      let imgUrls = extractUrlsFromHtml(clipHtml);
                      if (imgUrls.length === 0) {
                        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
                        const matches = [...clipHtml.matchAll(imgRegex)];
                        if (matches.length > 0) {
                          const ta = document.createElement('textarea');
                          imgUrls = matches.map(m => {
                            ta.innerHTML = m[1];
                            const decoded = ta.value;
                            return { originalUrl: decoded, fetchUrl: decoded };
                          });
                          ta.remove();
                        }
                      }
                      if (imgUrls.length > 0) {
                        showToast(`📥 正在下载 ${imgUrls.length} 张图片...`);
                        const targetNode = inputNodesForPanel[0];
                        const existing = (targetNode.data as any)?.images || [];
                        const downloaded: string[] = [];
                        for (const pair of imgUrls) {
                          try {
                            const { blob } = await fetchImageBlob(pair.fetchUrl);
                            const base64 = await convertBlobToBase64(blob);
                            const mimeType = blob.type || 'image/jpeg';
                            downloaded.push(`data:${mimeType};base64,${base64}`);
                          } catch (err) {
                            console.warn('下载失败:', pair.fetchUrl, err);
                          }
                        }
                        if (downloaded.length > 0) {
                          updateNodeData(targetNode.id, { images: [...existing, ...downloaded] });
                          imgCount = downloaded.length;
                        }
                      }
                    }
                    
                    // 从纯文本提取文本列 + =IMAGE() 公式
                    if (clipText.trim()) {
                      const lines = clipText.split('\n').map(l => l.trim()).filter(l => l);
                      const rows = lines.map(line => line.split('\t'));
                      const colCount = Math.max(...rows.map(r => r.length));
                      
                      // 如果还没有找到图片，检查文本中是否有 =IMAGE()
                      let nodeIdx = imgCount > 0 ? 0 : 0; // 从第一个节点开始
                      for (let c = 0; c < colCount; c++) {
                        const colValues = rows.map(r => (r[c] || '').trim()).filter(v => v);
                        if (colValues.length === 0) continue;
                        
                        const hasFormula = colValues.some(v => /=IMAGE/i.test(v) || /^https?:\/\//i.test(v));
                        
                        if (hasFormula && imgCount === 0) {
                          // 还未找到图片时，处理公式列
                          showToast('📥 正在下载图片...');
                          const parsed = parsePasteInput(colValues.join('\n'));
                          const targetNode = inputNodesForPanel[0];
                          const existing = (targetNode.data as any)?.images || [];
                          const downloaded: string[] = [];
                          for (const item of parsed) {
                            try {
                              const { blob } = await fetchImageBlob(item.url);
                              const base64 = await convertBlobToBase64(blob);
                              const mimeType = blob.type || 'image/jpeg';
                              downloaded.push(`data:${mimeType};base64,${base64}`);
                            } catch {}
                          }
                          if (downloaded.length > 0) {
                            updateNodeData(targetNode.id, { images: [...existing, ...downloaded] });
                            imgCount += downloaded.length;
                          }
                        } else if (!hasFormula) {
                          // 纯文本列：分配给对应节点
                          const targetNode = imgCount > 0
                            ? (inputNodesForPanel.length === 1 ? inputNodesForPanel[0] : inputNodesForPanel[nodeIdx + 1])
                            : inputNodesForPanel[nodeIdx];
                          if (targetNode) {
                            const existingText = (targetNode.data as any)?.text || '';
                            const joined = colValues.join('\n');
                            updateNodeData(targetNode.id, { text: existingText ? existingText + '\n' + joined : joined });
                            txtCount += colValues.length;
                          }
                        }
                        nodeIdx++;
                      }
                    }

                    const msgs: string[] = [];
                    if (imgCount > 0) msgs.push(`${imgCount} 张图片`);
                    if (txtCount > 0) msgs.push(`${txtCount} 条文本`);
                    showToast(`✅ 已粘贴 ${msgs.join(' + ') || '数据'}`);
                  } catch (err) {
                    console.error('[WF Paste Btn] Error:', err);
                    showToast('⚠️ 无法读取剪贴板');
                  }
                }}
              >
                📋 粘贴
              </button>
              <button
                className="wf-node-btn"
                style={{ fontSize: '10px', padding: '2px 6px', color: '#f87171' }}
                title="清空所有批量数据"
                onClick={clearAllBatchData}
              >
                🗑
              </button>
            </div>
          </div>
          {inputNodesForPanel.length === 0 ? (
            <div className="wf-bp-empty">
              添加输入节点后<br/>可在此批量管理数据<br/>
              <span style={{ fontSize: '10px', color: '#475569', marginTop: '4px', display: 'block' }}>
                支持从表格粘贴（Ctrl+V）<br/>列1→节点1、列2→节点2
              </span>
            </div>
          ) : (() => {
            // 使用 imageGroups: string[][] 来组织行
            // 向下兼容：没有 imageGroups 时从 images[] 自动生成
            const getGroups = (n: any): string[][] => {
              const groups = (n.data as any)?.imageGroups;
              if (groups && Array.isArray(groups) && groups.length > 0) return groups;
              const imgs = (n.data as any)?.images || [];
              if (imgs.length === 0) return [];
              return imgs.map((img: string) => [img]);
            };

            const nodeData = inputNodesForPanel.map(n => {
              const groups = getGroups(n);
              const textLines: string[] = ((n.data as any)?.text || '').split('\n').filter((l: string) => l.trim());
              return { node: n, groups, textLines };
            });
            const maxRows = nodeData.reduce((m, d) => Math.max(m, d.groups.length, d.textLines.length), 0);
            const nodeCount = inputNodesForPanel.length;
            const totalImages = nodeData.reduce((s, d) => s + d.groups.reduce((gs, g) => gs + g.length, 0), 0);

            // 添加图片到指定行
            const addImagesToRow = (nodeId: string, rowIdx: number) => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.multiple = true;
              input.onchange = (e) => {
                const files = (e.target as HTMLInputElement).files;
                if (!files) return;
                const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'));
                let loaded = 0;
                const newImages: string[] = [];
                fileArr.forEach(file => {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    newImages.push(ev.target?.result as string);
                    loaded++;
                    if (loaded === fileArr.length) {
                      const node = nodes.find(n => n.id === nodeId);
                      const currentGroups = getGroups(node);
                      const updated = [...currentGroups];
                      // 确保行存在
                      while (updated.length <= rowIdx) updated.push([]);
                      updated[rowIdx] = [...updated[rowIdx], ...newImages];
                      // 同步更新 imageGroups 和 images 平铺
                      updateNodeData(nodeId, {
                        imageGroups: updated,
                        images: updated.flat(),
                      });
                    }
                  };
                  reader.readAsDataURL(file);
                });
              };
              input.click();
            };

            // 添加新空行
            const addNewRow = (nodeId: string) => {
              addImagesToRow(nodeId, getGroups(nodes.find(n => n.id === nodeId)).length);
            };

            // 删除行内的某张图
            const removeImageFromRow = (nodeId: string, rowIdx: number, imgIdx: number) => {
              const node = nodes.find(n => n.id === nodeId);
              const currentGroups = [...getGroups(node).map(g => [...g])];
              if (currentGroups[rowIdx]) {
                currentGroups[rowIdx].splice(imgIdx, 1);
                // 如果该行删空了，移除整行
                if (currentGroups[rowIdx].length === 0) {
                  currentGroups.splice(rowIdx, 1);
                }
              }
              updateNodeData(nodeId, {
                imageGroups: currentGroups,
                images: currentGroups.flat(),
              });
            };

            // 删除整行
            const removeRow = (nodeId: string, rowIdx: number) => {
              const node = nodes.find(n => n.id === nodeId);
              const currentGroups = [...getGroups(node)];
              currentGroups.splice(rowIdx, 1);
              updateNodeData(nodeId, {
                imageGroups: currentGroups,
                images: currentGroups.flat(),
              });
            };

            return (
              <div className="wf-bp-table">
                {/* 表头 */}
                <div className="wf-bp-table-header" style={{ gridTemplateColumns: `repeat(${nodeCount}, 1fr)` }}>
                  {inputNodesForPanel.map(n => (
                    <div key={n.id} className="wf-bp-col-header">
                      <span className="wf-bp-col-name">📝 {(n.data as any)?.customLabel || (n.data as any)?.label || n.id}</span>
                      <div className="wf-bp-col-actions">
                        <button className="wf-bp-mini-btn" onClick={() => addNewRow(n.id)} title="添加新行">+</button>
                        {getGroups(n).length > 0 && (
                          <button className="wf-bp-mini-btn wf-bp-mini-danger" onClick={() => handleBatchClearImages(n.id)} title="清空">🗑</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 数据行 */}
                <div className="wf-bp-table-body">
                  {maxRows === 0 ? (
                    <div className="wf-bp-table-empty" style={{ gridColumn: `span ${nodeCount}` }}>
                      点击 + 添加图片或从表格粘贴
                    </div>
                  ) : (
                    Array.from({ length: maxRows }, (_, rowIdx) => (
                      <div key={rowIdx} className="wf-bp-table-row" style={{ gridTemplateColumns: `repeat(${nodeCount}, 1fr)` }}>
                        {nodeData.map(({ node: n, groups, textLines }) => {
                          const rowImages = groups[rowIdx] || [];
                          const txt = textLines[rowIdx];
                          return (
                            <div key={n.id} className="wf-bp-table-cell">
                              {rowImages.length > 0 ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                                  {rowImages.map((img, imgIdx) => (
                                    <div key={imgIdx} className="wf-bp-thumb-wrap">
                                      <img src={img} alt="" className="wf-bp-thumb" />
                                      <button
                                        className="wf-bp-thumb-remove"
                                        onClick={() => removeImageFromRow(n.id, rowIdx, imgIdx)}
                                      >✕</button>
                                    </div>
                                  ))}
                                  {/* 行内添加更多图片 */}
                                  <button
                                    onClick={() => addImagesToRow(n.id, rowIdx)}
                                    style={{
                                      width: '28px', height: '28px', border: '1px dashed rgba(255,255,255,0.15)',
                                      borderRadius: '4px', background: 'rgba(255,255,255,0.03)',
                                      color: '#64748b', fontSize: '14px', cursor: 'pointer',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                    title="添加更多图片到这一行"
                                  >+</button>
                                </div>
                              ) : null}
                              {txt ? (
                                <div className="wf-bp-cell-text" title={txt}>
                                  {txt.length > 30 ? txt.slice(0, 30) + '...' : txt}
                                </div>
                              ) : null}
                              {rowImages.length === 0 && !txt && (
                                <div className="wf-bp-empty-cell">—</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>

                {/* 底部统计 */}
                <div style={{ fontSize: '10px', color: '#475569', padding: '4px 6px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  共 {maxRows} 行
                  {totalImages > 0 && ` · ${totalImages} 张图`}
                  {nodeData.some(d => d.textLines.length > 0) && ` · ${nodeData.reduce((s, d) => s + d.textLines.length, 0)} 条文本`}
                </div>
              </div>
            );
          })()}
        </div>

        {/* 画布 */}
        <div className="workflow-canvas-wrapper" ref={reactFlowWrapper} onClickCapture={openQuickConnectFromHandle}>
        <ReactFlow
          nodes={nodesWithCallbacks}
          edges={edges}
          minZoom={0.05}
          maxZoom={2}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodesDelete={onNodesDelete}
          onNodeContextMenu={onNodeContextMenu}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={() => {
            setContextMenu(null);
            setQuickConnect(null);
          }}
          onEdgeClick={(_event, edge) => {
            setEdges((eds) => eds.filter((e) => e.id !== edge.id));
          }}
          nodeTypes={nodeTypes}
          connectionRadius={18}
          connectionMode={ConnectionMode.Loose}
          selectionOnDrag={false}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode="Shift"
          multiSelectionKeyCode="Shift"
          panOnDrag
          snapToGrid={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            animated: false,
            style: { strokeWidth: 2, cursor: 'pointer' },
            interactionWidth: 20,
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.05)" />
          <Controls position="bottom-right" />
          <MiniMap 
            nodeColor={(node) => {
              const palette = NODE_PALETTE.find(p => p.type === node.type);
              return palette?.color || '#6366f1';
            }}
            style={{ background: '#1a1a2e' }}
            maskColor="rgba(0,0,0,0.6)"
          />

          {/* 右键菜单 */}
          {contextMenu && contextMenuPosition && typeof document !== 'undefined' && createPortal((() => {
            const menuTargetIds = contextMenu.selectedNodeIds.length > 0
              ? contextMenu.selectedNodeIds
              : [contextMenu.nodeId];
            const isMultiSelection = menuTargetIds.length > 1;

            return (
              <div
                className="wf-context-menu"
                style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
                onClick={(e) => e.stopPropagation()}
              >
                {isMultiSelection && (
                  <div className="wf-context-menu-label">已选 {menuTargetIds.length} 个节点</div>
                )}

                <button
                  className="wf-context-menu-item"
                  onClick={() => {
                    const idSet = new Set(menuTargetIds);
                    setNodes((nds) => nds.map((n) => ({ ...n, selected: idSet.has(n.id) })));
                    setTimeout(() => duplicateSelectedNodes(), 50);
                    setContextMenu(null);
                  }}
                >
                  📋 复制节点
                  <span className="wf-context-menu-hint">⌘D</span>
                </button>

                <button
                  className="wf-context-menu-item"
                  onClick={() => {
                    setQuickConnect({
                      mode: 'batch-upstream',
                      x: contextMenu.x + 12,
                      y: contextMenu.y + 12,
                      sourceNodeIds: menuTargetIds,
                      anchorNodeId: contextMenu.nodeId,
                      query: '',
                    });
                    setContextMenu(null);
                  }}
                >
                  🔗 连接上游节点…
                </button>

                <button
                  className="wf-context-menu-item"
                  onClick={() => {
                    setQuickConnect({
                      mode: 'batch-downstream',
                      x: contextMenu.x + 12,
                      y: contextMenu.y + 12,
                      sourceNodeIds: menuTargetIds,
                      anchorNodeId: contextMenu.nodeId,
                      query: '',
                    });
                    setContextMenu(null);
                  }}
                >
                  🔗 连接下游节点…
                </button>

                <button
                  className="wf-context-menu-item danger"
                  onClick={() => {
                    deleteNodesWithBridge(menuTargetIds);
                    setContextMenu(null);
                  }}
                >
                  🗑️ 删除节点
                  <span className="wf-context-menu-hint">Del</span>
                </button>
              </div>
            );
          })(), document.body)}

          {quickConnect && quickConnectPosition && typeof document !== 'undefined' && createPortal((
            <div
              className="wf-quick-connect-panel"
              style={{ left: quickConnectPosition.x, top: quickConnectPosition.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="wf-quick-connect-title">
                {quickConnect.mode === 'handle' && '快速连接'}
                {quickConnect.mode === 'batch-upstream' && '批量连接上游'}
                {quickConnect.mode === 'batch-downstream' && '批量连接下游'}
              </div>
              <input
                className="wf-quick-connect-search"
                placeholder="可选：输入关键字筛选节点"
                value={quickConnect.query}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuickConnect((prev) => (prev ? { ...prev, query: value } : prev));
                }}
              />

              <div className="wf-quick-connect-section-label">当前节点</div>
              <div className="wf-quick-connect-list">
                {quickConnectCandidates.length === 0 ? (
                  <div className="wf-quick-connect-empty">没有匹配节点</div>
                ) : (
                  quickConnectCandidates.map((item) => (
                    <button
                      key={item.id}
                      className="wf-quick-connect-item"
                      onClick={() => handleQuickConnectExisting(item.id)}
                    >
                      <span className="wf-quick-connect-item-title">{item.title}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="wf-quick-connect-section-label">添加并连接</div>
              <div className="wf-quick-connect-list">
                {quickConnectPalette.map((item) => (
                  <button
                    key={item.type}
                    className="wf-quick-connect-item add"
                    onClick={() => handleQuickConnectCreate(item.type)}
                  >
                    <span className="wf-quick-connect-item-title">{item.label}</span>
                    <span className="wf-quick-connect-item-desc">{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ), document.body)}

          {/* 顶栏按钮区 */}
          <Panel position="top-right">
            <div className="workflow-toolbar">
              {/* 批量个数 */}
              <div className="wf-batch-control">
                <label>批量</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={batchCount}
                  onChange={(e) => setBatchCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                  className="wf-batch-input"
                />
                <span>条</span>
              </div>

              {/* 连线样式 */}
              <div className="wf-batch-control" style={{ gap: '4px' }}>
                <label>线型</label>
                <select
                  value={edgeStyle}
                  onChange={(e) => {
                    const newType = e.target.value as 'default' | 'smoothstep' | 'straight';
                    setEdgeStyle(newType);
                    setEdges(eds => eds.map(ed => ({ ...ed, type: newType === 'default' ? undefined : newType })));
                  }}
                  className="wf-batch-input"
                  style={{ width: '62px' }}
                >
                  <option value="default">曲线</option>
                  <option value="smoothstep">折线</option>
                  <option value="straight">直线</option>
                </select>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: '#94a3b8' }}>
                  <input
                    type="checkbox"
                    checked={edgeAnimated}
                    onChange={(e) => {
                      setEdgeAnimated(e.target.checked);
                      setEdges(eds => eds.map(ed => ({ ...ed, animated: e.target.checked })));
                    }}
                    style={{ width: '12px', height: '12px' }}
                  />
                  动画
                </label>
              </div>

              <button
                className="workflow-preset-btn"
                onClick={undoWorkflowChange}
                disabled={!canUndo}
                title="撤销 (Ctrl/Cmd+Z)"
              >
                ↶ 撤销
              </button>

              <button
                className="workflow-preset-btn"
                onClick={redoWorkflowChange}
                disabled={!canRedo}
                title="前进 (Ctrl+Y / Cmd+Shift+Z)"
              >
                ↷ 前进
              </button>

              <button
                className="workflow-preset-btn"
                onClick={generateStandardPipeline}
                title="一键生成：输入→随机→覆盖→写词→输出"
              >
                🚀 标准流程
              </button>

              <button
                className="workflow-preset-btn"
                onClick={autoLayout}
                title="自动整理节点位置"
              >
                🧩 整理布局
              </button>

              <button
                className="workflow-preset-btn"
                onClick={cleanUnusedNodes}
                title="删除没有连线的节点"
              >
                🧹 清理节点
              </button>

              <button
                className={`workflow-preset-btn ${showFlowSidebar ? 'active' : ''}`}
                onClick={() => setShowFlowSidebar(s => !s)}
                style={showFlowSidebar ? { borderColor: 'rgba(99,102,241,0.5)', color: '#a5b4fc' } : undefined}
              >
                📂 流程列表
              </button>

              {aiLogs.length > 0 && (
                <button
                  className="workflow-preset-btn"
                  onClick={() => setShowAiLogModal(true)}
                  title="查看 AI 对话记录"
                  style={{ position: 'relative' }}
                >
                  🔍 AI 记录
                  <span style={{
                    position: 'absolute', top: '-4px', right: '-4px',
                    background: '#f59e0b', color: '#000', fontSize: '9px',
                    borderRadius: '50%', width: '16px', height: '16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700,
                  }}>{aiLogs.length}</span>
                </button>
              )}

              <button
                className={`workflow-run-btn ${isRunning ? 'running' : ''}`}
                onClick={handleRun}
                disabled={isRunning}
              >
                {isRunning ? (
                  <>
                    <span className="wf-spinner" />
                    {runProgress || '执行中...'}
                  </>
                ) : (() => {
                    const maxImgs = nodes.filter(n => n.type === 'inputNode')
                      .reduce((max, n) => Math.max(max, ((n.data as any).images?.length || 0)), 0);
                    const hasRandomSource = nodes.some(n => n.type === 'randomLibrary' || n.type === 'codeRandom');
                    const hasWriter = nodes.some(n => n.type === 'promptWriter');
                    const isSmartBatch = maxImgs === 0 && batchCount > 1 && hasRandomSource && hasWriter;
                    const label = maxImgs > 0
                      ? `运行 ×${maxImgs} 组`
                      : (batchCount > 1
                        ? (isSmartBatch ? `⚡合批 ×${batchCount}` : `运行 ×${batchCount}`)
                        : '运行工作流');
                    return <><span className="wf-play-icon">▶</span>{label}</>;
                  })()}
              </button>
            </div>
          </Panel>

          {/* 状态提示 */}
          {lastResult && (
            <Panel position="bottom-left">
              <div className={`workflow-status-bar ${lastResult.success ? 'success' : 'error'}`}>
                {lastResult.success ? '✅ 工作流执行成功' : `❌ ${lastResult.error || '执行出错'}`}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

        {/* 右侧流程快捷列表侧边栏 */}
        {showFlowSidebar && (
          <div className="wf-flow-sidebar" onWheelCapture={e => e.stopPropagation()}>
            <div className="wf-flow-sidebar-header">
              <span>📋 流程列表</span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button
                  className="wf-panel-toggle"
                  onClick={() => setShowFlowSidebar(false)}
                  title="收起"
                >▶</button>
              </div>
            </div>
            {/* 操作栏 */}
            <div style={{ display: 'flex', gap: '4px', padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button 
                className="wf-node-btn wf-node-btn-primary" 
                style={{ flex: 1, padding: '4px' }}
                onClick={() => setPromptDialog({ msg: '新流程名称:', defaultValue: '新流程', onOk: newFlow })}
              >➕ 新建</button>
              <button 
                className="wf-node-btn wf-node-btn-secondary" 
                style={{ padding: '4px 8px' }}
                title="导入单个流程文件"
                onClick={importFlow}
              >📥</button>
              <button 
                className="wf-node-btn wf-node-btn-secondary" 
                style={{ padding: '4px 8px' }}
                title="导出当前流程为文件"
                onClick={exportFlow}
              >📤</button>
            </div>
            {/* 批量导入导出 + 表格同步 */}
            <div style={{ display: 'flex', gap: '4px', padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button 
                className="wf-node-btn wf-node-btn-secondary" 
                style={{ flex: 1, padding: '4px', fontSize: '10px' }}
                title="批量导入所有流程（合并到本地）"
                onClick={importAllFlows}
              >📥 批量导入</button>
              <button 
                className="wf-node-btn wf-node-btn-secondary" 
                style={{ flex: 1, padding: '4px', fontSize: '10px' }}
                title="导出所有已保存流程为单个文件"
                onClick={exportAllFlowsHandler}
              >📤 批量导出</button>
              <button
                className={`wf-node-btn ${showSheetConfig ? 'wf-node-btn-primary' : 'wf-node-btn-secondary'}`}
                style={{ padding: '4px 8px', fontSize: '10px' }}
                title="Google Sheets 流程预设同步"
                onClick={() => setShowSheetConfig(s => !s)}
              >📊</button>
            </div>

            {/* Google Sheets 配置面板 */}
            {showSheetConfig && (
              <div style={{
                padding: '8px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(15,23,42,0.5)',
              }}>
                <div style={{ fontSize: '10px', color: '#a5b4fc', fontWeight: 600, marginBottom: '6px' }}>
                  📊 Google Sheets 流程预设
                </div>
                <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '6px' }}>
                  A列 = 流程 JSON · B列 = 流程说明
                </div>
                <input
                  placeholder="表格 ID（从 URL 中提取）"
                  value={flowSheetConfig.sheetId}
                  onChange={e => {
                    const cfg = { ...flowSheetConfig, sheetId: e.target.value.trim() };
                    setFlowSheetConfig(cfg);
                    saveFlowSheetConfig(cfg);
                  }}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '4px 6px',
                    background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: '4px', color: '#e2e8f0', fontSize: '10px', marginBottom: '4px',
                    outline: 'none',
                  }}
                />
                <input
                  placeholder="分页名称（默认: 流程预设）"
                  value={flowSheetConfig.sheetName}
                  onChange={e => {
                    const cfg = { ...flowSheetConfig, sheetName: e.target.value };
                    setFlowSheetConfig(cfg);
                    saveFlowSheetConfig(cfg);
                  }}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '4px 6px',
                    background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: '4px', color: '#e2e8f0', fontSize: '10px', marginBottom: '6px',
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#94a3b8', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={flowSheetConfig.autoRefresh}
                      onChange={e => {
                        const cfg = { ...flowSheetConfig, autoRefresh: e.target.checked };
                        setFlowSheetConfig(cfg);
                        saveFlowSheetConfig(cfg);
                      }}
                      style={{ accentColor: '#6366f1' }}
                    />
                    打开时自动刷新
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="wf-node-btn wf-node-btn-primary"
                    style={{ flex: 1, padding: '4px', fontSize: '10px' }}
                    disabled={!flowSheetConfig.sheetId || sheetSyncStatus === 'loading'}
                    onClick={refreshSheetFlows}
                  >
                    {sheetSyncStatus === 'loading' ? '🔄 同步中...' :
                     sheetSyncStatus === 'success' ? '✅ 已同步' :
                     sheetSyncStatus === 'error' ? '❌ 重试' :
                     '🔄 立即刷新'}
                  </button>
                </div>
                {sheetSyncError && (
                  <div style={{ fontSize: '9px', color: '#f87171', marginTop: '4px' }}>
                    ❌ {sheetSyncError}
                  </div>
                )}
                {sheetSyncStatus === 'success' && sheetFlows.length > 0 && (
                  <div style={{ fontSize: '9px', color: '#22c55e', marginTop: '4px' }}>
                    ✅ 已从表格加载 {sheetFlows.length} 个流程
                  </div>
                )}
              </div>
            )}

            {/* 列表 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {savedFlows.length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '11px' }}>
                  暂无已保存的流程
                </div>
              ) : (
                savedFlows.map(flow => (
                  <div
                    key={flow.id}
                    className={`wf-flow-sidebar-item ${flow.id === currentFlowId ? 'active' : ''}`}
                    onClick={() => loadFlow(flow)}
                    title={flow.name}
                  >
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div className="wf-flow-sidebar-name">
                        {flow.id.startsWith('sheet-') && <span style={{ marginRight: '4px' }} title="来自表格预设">📊</span>}
                        {flow.name}
                      </div>
                      <div className="wf-flow-sidebar-meta">
                        {flow.nodes.length}节点 · {new Date(flow.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button 
                      className="wf-node-btn wf-node-btn-danger" 
                      style={{ padding: '2px 6px', fontSize: '10px' }}
                      title="删除流程"
                      onClick={(e) => { e.stopPropagation(); deleteFlow(flow.id); }}
                    >×</button>
                  </div>
                ))
              )}
            </div>
            {/* 保存按钮 */}
            <button
              className="wf-flow-sidebar-save"
              onClick={() => {
                setPromptDialog({
                  msg: '保存流程:',
                  defaultValue: currentFlowName,
                  onOk: (val) => saveCurrentFlow(val)
                });
              }}
            >
              💾 保存当前 / 另存为
            </button>
          </div>
        )}

      {/* end workflow-main-area */}
      </div>

      {/* 输入弹窗 (替换 prompt) */}
      {promptDialog && createPortal(
        <div className="wf-confirm-overlay" onClick={() => setPromptDialog(null)}>
          <div className="wf-confirm-box" onClick={e => e.stopPropagation()}>
            <div className="wf-confirm-msg">{promptDialog.msg}</div>
            <input
              type="text"
              autoFocus
              defaultValue={promptDialog.defaultValue}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  promptDialog.onOk(e.currentTarget.value);
                  setPromptDialog(null);
                }
              }}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '6px 10px',
                marginTop: '10px', marginBottom: '16px', borderRadius: '6px',
                border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(15,23,42,0.8)',
                color: '#e2e8f0', fontSize: '12px', outline: 'none'
              }}
            />
            <div className="wf-confirm-btns">
              <button className="wf-confirm-cancel" onClick={() => setPromptDialog(null)}>取消</button>
              <button className="wf-confirm-ok" onClick={(e) => {
                const input = (e.currentTarget.parentElement?.previousSibling as HTMLInputElement);
                if (input) promptDialog.onOk(input.value);
                setPromptDialog(null);
              }}>确定</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Toast 通知 */}
      {toastMsg && createPortal(
        <div className="wf-toast">{toastMsg}</div>,
        document.body
      )}

      {/* 确认弹窗 */}
      {confirmDialog && createPortal(
        <div className="wf-confirm-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="wf-confirm-box" onClick={e => e.stopPropagation()}>
            <div className="wf-confirm-msg">{confirmDialog.msg}</div>
            <div className="wf-confirm-btns">
              <button className="wf-confirm-cancel" onClick={() => setConfirmDialog(null)}>取消</button>
              <button className="wf-confirm-ok" onClick={() => { confirmDialog.onOk(); setConfirmDialog(null); }}>确定</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* AI 对话记录弹窗 */}
      {showAiLogModal && createPortal(
        <div className="wf-confirm-overlay" onClick={() => setShowAiLogModal(false)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1e1e2e', border: '1px solid #333', borderRadius: '12px',
              width: '90vw', maxWidth: '800px', maxHeight: '85vh',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: '1px solid #333',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>🔍</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>AI 对话记录</span>
                <span style={{
                  fontSize: '11px', color: '#94a3b8', background: '#333',
                  padding: '1px 8px', borderRadius: '10px',
                }}>{aiLogs.length} 条</span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className="wf-node-btn"
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => {
                    const text = aiLogs.map((log, i) =>
                      `=== #${i + 1} ${log.nodeLabel} (${new Date(log.timestamp).toLocaleTimeString()}) ===\n\n【Prompt】\n${log.prompt}\n\n【AI 回复】\n${log.response}`
                    ).join('\n\n' + '─'.repeat(50) + '\n\n');
                    navigator.clipboard.writeText(text);
                    showToast('✅ 已复制全部记录');
                  }}
                >📋 复制全部</button>
                <button
                  className="wf-node-btn"
                  style={{ fontSize: '10px', padding: '3px 8px', color: '#f87171' }}
                  onClick={() => { setAiLogs([]); setShowAiLogModal(false); }}
                >🗑 清空</button>
                <button
                  className="wf-node-btn"
                  style={{ fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => setShowAiLogModal(false)}
                >✕</button>
              </div>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {aiLogs.map((log, idx) => (
                <div key={idx} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '8px', overflow: 'hidden',
                }}>
                  {/* Entry Header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 12px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        fontSize: '10px', fontFamily: 'monospace', color: '#f59e0b',
                        background: 'rgba(245,158,11,0.1)', padding: '1px 6px', borderRadius: '3px',
                      }}>#{idx + 1}</span>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{log.nodeLabel}</span>
                      <span style={{ fontSize: '10px', color: '#475569' }}>
                        {new Date(log.timestamp).toLocaleTimeString()} · {log.model}
                      </span>
                    </div>
                    <button
                      className="wf-node-btn"
                      style={{ fontSize: '9px', padding: '1px 6px' }}
                      onClick={() => {
                        const text = `【Prompt】\n${log.prompt}\n\n【AI 回复】\n${log.response}`;
                        navigator.clipboard.writeText(text);
                        showToast(`✅ 已复制 #${idx + 1}`);
                      }}
                    >复制</button>
                  </div>
                  {/* Prompt */}
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '10px', color: '#60a5fa', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      📤 发送 Prompt <span style={{ fontWeight: 400, color: '#475569' }}>({log.prompt.length} 字符{log.images && log.images.length > 0 ? ` + ${log.images.length} 张图` : ''})</span>
                    </div>
                    <div style={{
                      fontSize: '11px', color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)',
                      padding: '8px', borderRadius: '4px', fontFamily: 'monospace', lineHeight: '1.5',
                      userSelect: 'text',
                    }}>{log.prompt}</div>
                  </div>
                  {/* 发送的图片 */}
                  {log.images && log.images.length > 0 && (
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.03)', background: 'rgba(96,165,250,0.03)' }}>
                      <div style={{ fontSize: '10px', color: '#60a5fa', fontWeight: 700, marginBottom: '4px' }}>
                        🖼️ 发送的图片 ({log.images.length} 张)
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {log.images.map((img, imgIdx) => (
                          <img
                            key={imgIdx}
                            src={img}
                            alt=""
                            style={{
                              width: '48px', height: '48px', objectFit: 'cover',
                              borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)',
                              cursor: 'pointer',
                            }}
                            onClick={() => window.open(img, '_blank')}
                            title="点击查看大图"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Response — AI 回复 */}
                  <div style={{ padding: '8px 12px', background: 'rgba(52, 211, 153, 0.05)', borderTop: '1px solid rgba(52, 211, 153, 0.1)' }}>
                    <div style={{ fontSize: '10px', color: '#34d399', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      📥 AI 回复 <span style={{ fontWeight: 400, color: '#475569' }}>({log.response ? log.response.length : 0} 字符)</span>
                    </div>
                    <div style={{
                      fontSize: '11px', color: '#f8fafc', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      maxHeight: '300px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)',
                      padding: '10px', borderRadius: '4px', fontFamily: 'monospace', lineHeight: '1.6',
                      userSelect: 'text', border: '1px solid rgba(52, 211, 153, 0.2)'
                    }}>{log.response || '（等待 AI 响应...）'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const WorkflowEditorApp: React.FC<WorkflowEditorAppProps> = (props) => {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
};

export default WorkflowEditorApp;
