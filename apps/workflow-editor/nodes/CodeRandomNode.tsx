/**
 * 代码随机节点 — 用户直接输入 JS 代码来生成随机结果
 * 支持：数字范围、文字列表、权重分布、自定义代码
 * 代码在沙箱中运行，结果通过 return 语句返回
 * 也支持 Python 代码（自动转换为 JS 后执行）
 */

import React, { useCallback, useState, useMemo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import NodeHeader from './NodeHeader';
import { WfTextarea } from '../components/WfInputs';

const DEFAULT_CODE = `// 在这里编写随机代码，用 return 返回结果
// 可用变量：Math.random(), Date.now()
// 示例 1: 随机数字范围
// return Math.floor(Math.random() * 20) + 1;

// 示例 2: 随机文字列表
const items = ["A", "B", "C"];
return items[Math.floor(Math.random() * items.length)];`;

const CodeRandomNode: React.FC<NodeProps> = ({ data }) => {
  const { nodeId, updateNodeData, customLabel, customColor, nodeNote } = data as any;

  const [code, setCode] = useState<string>(() => (data as any).code || DEFAULT_CODE);
  const [lastResult, setLastResult] = useState<string>((data as any).lastResult || '');
  const [error, setError] = useState<string>('');
  const [resultHistory, setResultHistory] = useState<string[]>([]);

  // 阻止滚轮冒泡
  const stopWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // 保存代码
  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setCode(newCode);
    updateNodeData?.(nodeId, { code: newCode });
  }, [nodeId, updateNodeData]);

  // 将 Python 变量名清洁为合法 JS 标识符
  const sanitizeVarName = useCallback((name: string): string => {
    return name
      .replace(/\s+/g, '')                                          // 移除空白/换行
      .replace(/[\uff08\u00ab(]/g, '_').replace(/[\uff09\u00bb)]/g, '') // 中英文括号
      .replace(/[/\uff0f]/g, '_')                                   // 斜杠 -> _
      .replace(/[^a-zA-Z0-9_\u4e00-\u9fff\u3400-\u4dbf]/g, '_')    // 其他特殊字符
      .replace(/_+/g, '_')                                           // 合并连续 _
      .replace(/^_|_$/g, '');                                        // 去首尾 _
  }, []);

  // 检测并转换 Python 代码为 JS
  const pythonToJs = useCallback((src: string): string => {
    const isPython = /^import\s+random/m.test(src)
      || /random\.(randint|choice|uniform|sample|shuffle)\s*\(/m.test(src)
      || /\bprint\s*\(/m.test(src);
    if (!isPython) return src;

    const norm = src.replace(/\r\n/g, '\n');
    const rawLines = norm.split('\n');

    // 预处理：合并跨行语句（未闭合的括号 / 跨行变量名）
    const merged: string[] = [];
    let pendingLine = '';
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      // 如果下一行以 = random. 开头，合并（跨行变量名）
      if (i + 1 < rawLines.length && /^\s*=\s*random\./.test(rawLines[i + 1])) {
        merged.push(line.trim() + rawLines[i + 1]);
        i++;
        continue;
      }
      // 合并未闭合括号的行
      if (pendingLine) {
        pendingLine += line;
        const opens = (pendingLine.match(/\(/g) || []).length;
        const closes = (pendingLine.match(/\)/g) || []).length;
        if (opens <= closes) {
          merged.push(pendingLine);
          pendingLine = '';
        }
        continue;
      }
      // 检查当前行是否有未闭合的括号
      const opens = (line.match(/\(/g) || []).length;
      const closes = (line.match(/\)/g) || []).length;
      if (opens > closes) {
        pendingLine = line;
      } else {
        merged.push(line);
      }
    }
    if (pendingLine) merged.push(pendingLine);

    // 收集变量名映射: rawPythonName -> safeJsName
    const varMap = new Map<string, string>();
    for (const line of merged) {
      const m = line.match(/^(.+?)\s*=\s*random\./);
      if (m) {
        const raw = m[1].trim();
        if (raw && !raw.startsWith('import') && !raw.startsWith('#')) {
          varMap.set(raw, sanitizeVarName(raw));
        }
      }
    }
    // 也从 f-string {变量} 中收集
    const fVarRe = /\{([^}]+)\}/g;
    let fm;
    while ((fm = fVarRe.exec(norm)) !== null) {
      const raw = fm[1].trim();
      if (raw && !varMap.has(raw)) varMap.set(raw, sanitizeVarName(raw));
    }

    const hasPrint = /\bprint\s*\(/.test(norm);
    const out: string[] = [];
    if (hasPrint) out.push('const __results = [];');

    for (const line of merged) {
      const t = line.trim();
      if (!t || /^import\s+random/.test(t)) continue;
      if (t.startsWith('#')) { out.push('// ' + t.slice(1).trim()); continue; }

      // 赋值: X = random.randint(a, b)
      const ri = t.match(/^(.+?)\s*=\s*random\.randint\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (ri) {
        const sv = varMap.get(ri[1].trim()) || sanitizeVarName(ri[1].trim());
        const mn = parseInt(ri[2]), mx = parseInt(ri[3]);
        out.push(`let ${sv} = Math.floor(Math.random() * ${mx - mn + 1}) + ${mn};`);
        continue;
      }

      // 赋值: X = random.choice([...])
      const rc = t.match(/^(.+?)\s*=\s*random\.choice\((\[.*?\])\)/);
      if (rc) {
        const sv = varMap.get(rc[1].trim()) || sanitizeVarName(rc[1].trim());
        out.push(`let ${sv} = ((_a) => _a[Math.floor(Math.random() * _a.length)])(${rc[2]});`);
        continue;
      }

      // print(f'...')
      const pf = t.match(/^print\(\s*f(['"])(.*?)\1\s*\)$/);
      if (pf) {
        let tmpl = pf[2];
        tmpl = tmpl.replace(/\{([^}]+)\}/g, (_, rv: string) => {
          return '${' + (varMap.get(rv.trim()) || sanitizeVarName(rv.trim())) + '}';
        });
        out.push('__results.push(`' + tmpl + '`);');
        continue;
      }

      // print(简单)
      const ps = t.match(/^print\((.+)\)$/);
      if (ps) {
        let c = ps[1];
        for (const [rv, sv] of varMap) c = c.split(rv).join(sv);
        out.push(`__results.push(${c});`);
        continue;
      }

      // 其他赋值
      const ga = t.match(/^(.+?)\s*=\s*(.+)$/);
      if (ga) {
        const sv = varMap.get(ga[1].trim()) || sanitizeVarName(ga[1].trim());
        let val = ga[2];
        for (const [rv, svv] of varMap) val = val.split(rv).join(svv);
        out.push(`let ${sv} = ${val};`);
        continue;
      }

      out.push(t);
    }

    if (hasPrint) out.push('return __results.join("\\n");');
    return out.join('\n');
  }, [sanitizeVarName]);

  // 在沙箱中运行代码
  const runCode = useCallback(() => {
    try {
      setError('');
      const jsCode = pythonToJs(code);
      // 用 Function 构造器创建沙箱
      const fn = new Function(jsCode);
      const result = fn();
      const resultStr = String(result ?? '');
      setLastResult(resultStr);
      setResultHistory(prev => [resultStr, ...prev.slice(0, 9)]);
      updateNodeData?.(nodeId, {
        lastResult: resultStr,
        result: resultStr,
        combination: resultStr,
      });
    } catch (err: any) {
      const rawMsg = err.message || '代码运行出错';
      // 将常见英文错误翻译成中文
      const translateError = (msg: string): string => {
        if (/missing \) after argument list/i.test(msg)) return '❌ 语法错误：缺少右括号 )，请检查括号是否配对';
        if (/missing \( before/i.test(msg)) return '❌ 语法错误：缺少左括号 (';
        if (/unexpected token/i.test(msg)) return '❌ 语法错误：意外的符号，请检查代码格式';
        if (/unexpected end of input/i.test(msg)) return '❌ 语法错误：代码不完整，可能缺少括号或引号';
        if (/is not defined/i.test(msg)) {
          const varMatch = msg.match(/^(\S+)\s+is not defined/i);
          return varMatch ? `❌ 变量 "${varMatch[1]}" 未定义，请检查变量名是否正确` : '❌ 未定义的变量';
        }
        if (/is not a function/i.test(msg)) return '❌ 调用了不存在的函数，请检查函数名';
        if (/unterminated string/i.test(msg)) return '❌ 字符串未闭合，请检查引号是否配对';
        if (/invalid or unexpected token/i.test(msg)) return '❌ 无效的符号，代码中可能有特殊字符';
        if (/illegal return/i.test(msg)) return '❌ return 语句位置不正确';
        if (/assignment to undeclared/i.test(msg)) return '❌ 赋值给未声明的变量';
        return `❌ 代码错误：${msg}`;
      };
      setError(translateError(rawMsg));
      setLastResult('');
    }
  }, [code, nodeId, updateNodeData, pythonToJs]);

  // 快速模板
  const applyTemplate = useCallback((template: string) => {
    setCode(template);
    updateNodeData?.(nodeId, { code: template });
  }, [nodeId, updateNodeData]);

  const templates = useMemo(() => [
    {
      label: '💯 数字范围',
      code: `// 随机数字 (1-100)\nconst min = 1;\nconst max = 100;\nreturn Math.floor(Math.random() * (max - min + 1)) + min;`,
    },
    {
      label: '📝 文字列表',
      code: `// 随机从列表中选一个\nconst items = [\n  "选项A",\n  "选项B",\n  "选项C",\n  "选项D",\n];\nreturn items[Math.floor(Math.random() * items.length)];`,
    },
    {
      label: '🎯 权重随机',
      code: `// 带权重的随机选择\nconst items = [\n  { value: "常见", weight: 60 },\n  { value: "较少", weight: 30 },\n  { value: "稀有", weight: 10 },\n];\nconst totalWeight = items.reduce((s, i) => s + i.weight, 0);\nlet r = Math.random() * totalWeight;\nfor (const item of items) {\n  r -= item.weight;\n  if (r <= 0) return item.value;\n}\nreturn items[items.length - 1].value;`,
    },
    {
      label: '🔀 多维组合',
      code: `// 多维度随机组合\nconst pick = arr => arr[Math.floor(Math.random() * arr.length)];\n\nconst 场景 = pick(["室内", "室外", "水边"]);\nconst 风格 = pick(["写实", "动漫", "水彩"]);\nconst 光线 = pick(["日出", "正午", "黄昏", "夜晚"]);\n\nreturn [场景, 风格, 光线].map((v, i) => \n  ["【场景】", "【风格】", "【光线】"][i] + v\n).join("\\n");`,
    },
  ], []);

  return (
    <div className="wf-node code-random-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
      <NodeHeader
        icon="🎰" defaultLabel="代码随机" customLabel={customLabel} customColor={customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        trailing={lastResult ? (
          <span style={{ fontSize: '10px', color: '#c4b5fd', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            = {lastResult.substring(0, 20)}
          </span>
        ) : undefined}
      />
      <div className="wf-node-body">
        {/* 快速模板 */}
        <div>
          <div className="wf-node-label">快速模板</div>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
            {templates.map((t, i) => (
              <button
                key={i}
                className="wf-node-btn wf-node-btn-secondary"
                onClick={() => applyTemplate(t.code)}
                style={{ fontSize: '9px', padding: '2px 6px' }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 代码编辑区 */}
        <div>
          <div className="wf-node-label">JS / Python 代码（用 return 返回结果）</div>
          <WfTextarea
            value={code}
            onChangeContent={val => { setCode(val); updateNodeData?.(nodeId, { code: val }); }}
            onKeyDown={e => e.stopPropagation()}
            onWheelCapture={stopWheel}
            rows={8}
            style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              lineHeight: '1.5',
              tabSize: 2,
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              overflowX: 'auto',
            }}
            spellCheck={false}
          />
        </div>

        {/* 运行按钮 + 跳转按钮 */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="wf-node-btn wf-node-btn-primary"
            onClick={runCode}
            style={{ flex: 1 }}
          >
            ▶ 运行代码
          </button>
          <button
            className="wf-node-btn wf-node-btn-secondary"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('navigate-to-tool', {
                detail: { tool: 'skillGenerator', subTab: 'codegen' },
              }));
            }}
            title="跳转到模版指令的代码生成工具"
            style={{ padding: '4px 8px', fontSize: '10px', whiteSpace: 'nowrap' }}
          >
            🎲 代码工具 ↗
          </button>
        </div>

        {/* 错误信息 */}
        {error && (
          <div style={{
            padding: '6px 8px', borderRadius: '6px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
            fontSize: '11px', color: '#f87171',
          }}>
            ❌ {error}
          </div>
        )}

        {/* 运行结果 */}
        {lastResult && (
          <div>
            <div className="wf-node-label">当前结果</div>
            <div style={{
              padding: '8px 10px', borderRadius: '6px',
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
              fontSize: '12px', color: '#c4b5fd', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', maxHeight: '80px', overflow: 'auto',
            }}>
              {lastResult}
            </div>
          </div>
        )}

        {/* 历史（折叠） */}
        {resultHistory.length > 1 && (
          <div>
            <div className="wf-node-label" style={{ cursor: 'pointer', opacity: 0.6 }}>
              历史 ({resultHistory.length})
            </div>
            <div style={{ fontSize: '10px', color: '#64748b', maxHeight: '50px', overflow: 'auto' }}
              onWheelCapture={stopWheel}
            >
              {resultHistory.slice(1).map((r, i) => (
                <div key={i} style={{ padding: '1px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  {r.substring(0, 50)}{r.length > 50 ? '...' : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Top} id="target-top" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" />
      <Handle type="source" position={Position.Right} id="source-right" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Top} id="source-top" />
    </div>
  );
};

export default CodeRandomNode;
