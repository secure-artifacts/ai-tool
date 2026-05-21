/**
 * CollabPanel — 协作连接面板
 * 显示在 Gallery 工具栏中，提供连接/断开、用户名设置、状态指示
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Users,
  Wifi,
  WifiOff,
  Settings2,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
} from 'lucide-react';
import {
  GASCollabService,
  getCollabService,
  loadCollabConfig,
  saveCollabConfig,
  clearCollabConfig,
  type CollabStatus,
  type SMRowData,
} from '../../services/gasCollabService';
import collabCodeStr from '../../collab/Code.gs.js?raw';

interface CollabPanelProps {
  /** 当 SM_ 数据变更时回调 */
  onSMDataChange?: (data: SMRowData[]) => void;
  /** 当连接状态变更时回调 */
  onStatusChange?: (status: CollabStatus) => void;
  /** 当前 Sheet 名称 */
  currentSheetName?: string;
  /** 是否处于多分页合并模式 */
  isMultiSheetMode?: boolean;
  /** 合并模式下选中的分页名称集合 */
  selectedSheets?: Set<string>;
}

const CollabPanel: React.FC<CollabPanelProps> = ({
  onSMDataChange,
  onStatusChange,
  currentSheetName,
  isMultiSheetMode,
  selectedSheets,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<CollabStatus>('disconnected');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [webAppUrl, setWebAppUrl] = useState('');
  const [userName, setUserName] = useState('');
  const [pollInterval, setPollInterval] = useState(5);
  const [connecting, setConnecting] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const serviceRef = useRef<GASCollabService | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // 初始化：加载保存的配置
  useEffect(() => {
    const saved = loadCollabConfig();
    if (saved.webAppUrl) setWebAppUrl(saved.webAppUrl);
    if (saved.userName) setUserName(saved.userName);
    if (saved.pollIntervalMs) setPollInterval(Math.round(saved.pollIntervalMs / 1000));
  }, []);

  // 初始化服务 & 注册监听
  useEffect(() => {
    const service = getCollabService();
    serviceRef.current = service;

    const unsubStatus = service.onStatusChange((newStatus, error) => {
      setStatus(newStatus);
      if (error) setErrorMsg(error);
      else setErrorMsg('');
      onStatusChange?.(newStatus);
    });

    const unsubSM = service.onSMChange((data) => {
      onSMDataChange?.(data);
    });

    // 如果有保存的配置且之前是连接状态，自动重连
    const saved = loadCollabConfig();
    if (saved.webAppUrl) {
      service.setConfig({
        webAppUrl: saved.webAppUrl,
        userName: saved.userName || '匿名用户',
        sheetName: isMultiSheetMode ? undefined : currentSheetName,
        sheetNames: isMultiSheetMode && selectedSheets ? Array.from(selectedSheets) : undefined,
        pollIntervalMs: saved.pollIntervalMs || 5000,
      });
      // 自动连接
      service.connect().catch(console.warn);
    }

    return () => {
      unsubStatus();
      unsubSM();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sheet 名称变化时更新服务
  useEffect(() => {
    if (!serviceRef.current) return;
    if (isMultiSheetMode && selectedSheets && selectedSheets.size > 0) {
      // 合并模式：传递实际分页名称列表
      serviceRef.current.setConfig({
        sheetName: undefined,
        sheetNames: Array.from(selectedSheets),
      });
    } else if (currentSheetName) {
      // 单分页模式
      serviceRef.current.setConfig({
        sheetName: currentSheetName,
        sheetNames: undefined,
      });
    }
  }, [currentSheetName, isMultiSheetMode, selectedSheets]);

  // 连接
  const handleConnect = useCallback(async () => {
    if (!webAppUrl.trim()) {
      setErrorMsg('请输入 Web App URL');
      return;
    }

    setConnecting(true);
    setErrorMsg('');

    const service = getCollabService();
    service.setConfig({
      webAppUrl: webAppUrl.trim(),
      userName: userName.trim() || '匿名用户',
      sheetName: isMultiSheetMode ? undefined : currentSheetName,
      sheetNames: isMultiSheetMode && selectedSheets ? Array.from(selectedSheets) : undefined,
      pollIntervalMs: pollInterval * 1000,
    });

    const success = await service.connect();
    setConnecting(false);

    if (success) {
      setShowModal(false);
    }
  }, [webAppUrl, userName, currentSheetName, pollInterval, isMultiSheetMode, selectedSheets]);

  // 断开
  const handleDisconnect = useCallback(() => {
    const service = getCollabService();
    service.disconnect();
    clearCollabConfig();
    setStatus('disconnected');
  }, []);

  // 状态颜色
  const statusColor = {
    disconnected: 'var(--text-muted-color)',
    connecting: '#f59e0b',
    connected: '#22c55e',
    error: '#ef4444',
  }[status];

  const statusLabel = {
    disconnected: '未连接',
    connecting: '连接中...',
    connected: '协作中',
    error: '连接错误',
  }[status];

  return (
    <>
      {/* 工具栏按钮 */}
      <button
        ref={btnRef}
        onClick={() => setShowModal(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 10px',
          borderRadius: 6,
          border: status === 'connected'
            ? '1px solid #22c55e60'
            : '1px solid #8b5cf660',
          background: status === 'connected'
            ? 'linear-gradient(135deg, #22c55e20, #10b98120)'
            : 'linear-gradient(135deg, #8b5cf620, #6366f120)',
          color: status === 'connected' ? '#22c55e' : '#8b5cf6',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          transition: 'all 0.2s',
          boxShadow: status === 'connected'
            ? '0 0 8px rgba(34,197,94,0.15)'
            : '0 0 8px rgba(139,92,246,0.1)',
        }}
        title={`协作状态: ${statusLabel}`}
      >
        {status === 'connected' ? (
          <Wifi size={13} />
        ) : status === 'connecting' ? (
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <>👥</>
        )}
        {status === 'connected' ? '协作中' : '多人协作'}
        {status === 'connected' && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#22c55e',
              animation: 'pulse 2s infinite',
            }}
          />
        )}
      </button>

      {/* 设置弹窗 */}
      {showModal && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              background: 'var(--surface-color)',
              borderRadius: 14,
              padding: 24,
              width: 440,
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} style={{ color: 'var(--brand-color)' }} />
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-color)' }}>多人协作</span>
                <button
                  onClick={() => setShowHelp(!showHelp)}
                  style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                    border: `1px solid ${showHelp ? '#3b82f630' : 'var(--border-color)'}`,
                    background: showHelp ? '#3b82f615' : 'transparent',
                    color: showHelp ? '#3b82f6' : 'var(--text-muted-color)',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  {showHelp ? '返回设置' : '📖 使用帮助'}
                </button>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)', padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ========== 帮助文档 ========== */}
            {showHelp ? (
              <div style={{ fontSize: 12, color: 'var(--text-color)', lineHeight: 1.8 }}>
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#3b82f610', border: '1px solid #3b82f620', marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#3b82f6' }}>💡 协作原理</div>
                  <div style={{ fontSize: 11 }}>
                    协作基于 Google Sheet 作为共享数据库。每个用户的分类、备注、标签操作会写入 Sheet 末尾的专用列（SM_分类、SM_备注、SM_标签、SM_用户），
                    多人写入同一行时<strong>自动合并去重</strong>，不会覆盖。原始数据列不会被修改。
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>一、部署 GAS Web App（一次性设置）</div>
                <div style={{ paddingLeft: 8, marginBottom: 12 }}>
                  <div style={{ marginBottom: 6 }}><strong>步骤 1：</strong>打开你的 Google Sheet 表格</div>
                  <div style={{ marginBottom: 6 }}><strong>步骤 2：</strong>菜单栏点击 <code style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--bg-color)', fontSize: 11 }}>扩展程序 → Apps Script</code></div>
                  <div style={{ marginBottom: 6 }}><strong>步骤 3：</strong>将 Apps Script 编辑器中的默认代码<strong>全部删除</strong>，粘贴协作脚本代码</div>
                  <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--bg-color)', border: '1px solid var(--border-color)', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted-color)' }}>后端脚本：<code>Code.gs.js</code></span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(collabCodeStr);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      }}
                      style={{
                        padding: '4px 8px', borderRadius: 6, background: copiedCode ? '#10b981' : '#3b82f6', color: '#fff', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s'
                      }}
                    >
                      {copiedCode ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                      {copiedCode ? '已复制' : '一键复制代码'}
                    </button>
                  </div>
                  <div style={{ marginBottom: 6 }}><strong>步骤 4：</strong>点击右上角 <code style={{ padding: '1px 4px', borderRadius: 3, background: 'var(--bg-color)', fontSize: 11 }}>部署 → 新建部署</code></div>
                  <div style={{ marginBottom: 6, paddingLeft: 12 }}>
                    • 类型选择：<strong>Web 应用</strong><br/>
                    • 执行身份：<strong>我自己</strong><br/>
                    • 有权访问：<strong>任何人</strong>
                  </div>
                  <div style={{ marginBottom: 6 }}><strong>步骤 5：</strong>点击「部署」，复制生成的 URL</div>
                  <div style={{ padding: '6px 10px', borderRadius: 6, background: '#22c55e10', border: '1px solid #22c55e20', fontSize: 10 }}>
                    URL 格式：<code>https://script.google.com/macros/s/AKfycb.../exec</code>
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>二、连接协作</div>
                <div style={{ paddingLeft: 8, marginBottom: 12 }}>
                  <div style={{ marginBottom: 4 }}>1. 点击左上角的「<strong>📖 使用帮助</strong>」按钮返回设置页面</div>
                  <div style={{ marginBottom: 4 }}>2. 将复制的 URL 粘贴到「GAS Web App URL」输入框</div>
                  <div style={{ marginBottom: 4 }}>3. 填写你的名称（用于标识谁做了什么操作）</div>
                  <div style={{ marginBottom: 4 }}>4. 点击「连接协作」，状态变绿即成功</div>
                </div>

                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>三、协作中的操作</div>
                <div style={{ paddingLeft: 8, marginBottom: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                    <div style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                      <strong>🗂 分类</strong><br/>拖拽/点击分类 → 写入 SM_分类
                    </div>
                    <div style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                      <strong>📝 备注</strong><br/>添加备注 → 写入 SM_备注
                    </div>
                    <div style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                      <strong>🏷 标签</strong><br/>打标签 → 写入 SM_标签
                    </div>
                    <div style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                      <strong>👤 用户</strong><br/>自动记录 → 写入 SM_用户
                    </div>
                  </div>
                </div>

                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f59e0b10', border: '1px solid #f59e0b20', fontSize: 11 }}>
                  <strong>⚠️ 注意事项：</strong><br/>
                  • 多人同时修改同一行的同一列时，值会<strong>自动合并</strong>（如：风景 + 人像 → 风景, 人像）<br/>
                  • 同步间隔默认 5 秒，可在设置中调整<br/>
                  • 修改 GAS 代码后需要重新部署（部署 → 管理部署 → 编辑 → 更新版本）
                </div>
              </div>
            ) : (
            <>

            {/* 连接状态 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                background: status === 'connected' ? '#22c55e15' : status === 'error' ? '#ef444415' : 'var(--bg-color)',
                marginBottom: 16,
                border: `1px solid ${status === 'connected' ? '#22c55e30' : status === 'error' ? '#ef444430' : 'var(--border-color)'}`,
              }}
            >
              {status === 'connected' ? (
                <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
              ) : status === 'error' ? (
                <AlertCircle size={14} style={{ color: '#ef4444' }} />
              ) : status === 'connecting' ? (
                <Loader2 size={14} style={{ color: '#f59e0b', animation: 'spin 1s linear infinite' }} />
              ) : (
                <WifiOff size={14} style={{ color: 'var(--text-muted-color)' }} />
              )}
              <span style={{ fontSize: 12, color: statusColor, fontWeight: 500 }}>
                {statusLabel}
              </span>
              {errorMsg && (
                <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 'auto' }}>
                  {errorMsg}
                </span>
              )}
            </div>

            {/* Web App URL */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted-color)', display: 'block', marginBottom: 4 }}>
                GAS Web App URL
              </label>
              <input
                type="text"
                value={webAppUrl}
                onChange={(e) => setWebAppUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                disabled={status === 'connected'}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted-color)', marginTop: 4 }}>
                在 Google Sheet 中部署 Apps Script 后获取此 URL
              </div>
            </div>

            {/* 用户名 */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted-color)', display: 'block', marginBottom: 4 }}>
                你的名称（写入 SM_用户 列）
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="输入你的名字"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-color)',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* 轮询间隔 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted-color)', display: 'block', marginBottom: 4 }}>
                同步频率（秒）
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range"
                  min={2}
                  max={30}
                  value={pollInterval}
                  onChange={(e) => setPollInterval(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-color)', minWidth: 30, textAlign: 'center' }}>
                  {pollInterval}s
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted-color)', marginTop: 2 }}>
                间隔越短越实时，但会增加 GAS 调用次数
              </div>
            </div>

            {/* SM 列说明 */}
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--bg-color)',
                marginBottom: 16,
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted-color)', marginBottom: 6 }}>
                📋 协作将在 Sheet 末尾自动创建以下列：
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11 }}>
                <span style={{ color: 'var(--text-color)' }}>• <strong>SM_ID</strong> — 唯一标识（自动）</span>
                <span style={{ color: 'var(--text-color)' }}>• <strong>SM_分类</strong> — 分组分类</span>
                <span style={{ color: 'var(--text-color)' }}>• <strong>SM_备注</strong> — 行备注</span>
                <span style={{ color: 'var(--text-color)' }}>• <strong>SM_标签</strong> — 标签</span>
                <span style={{ color: 'var(--text-color)' }}>• <strong>SM_用户</strong> — 操作者</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted-color)', marginTop: 6 }}>
                多人写入同一行时会自动合并去重，原始数据列不会被修改
              </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 8 }}>
              {status === 'connected' ? (
                <button
                  onClick={handleDisconnect}
                  style={{
                    flex: 1,
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: '1px solid #ef4444',
                    background: '#ef444415',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  断开连接
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={connecting || !webAppUrl.trim()}
                  style={{
                    flex: 1,
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    background: connecting ? 'var(--border-color)' : 'var(--brand-color)',
                    color: '#fff',
                    cursor: connecting ? 'wait' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: !webAppUrl.trim() ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  {connecting && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                  {connecting ? '连接中...' : '连接协作'}
                </button>
              )}
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--control-bg-color)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                关闭
              </button>
            </div>
            </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* CSS animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};

export default CollabPanel;
