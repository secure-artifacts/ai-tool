/**
 * Google Sheets 认证配置面板
 * 
 * 让用户选择和配置认证模式
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    Key, Upload, User, Shield, AlertCircle, Check, X, ExternalLink, Info, FileJson
} from 'lucide-react';
import {
    SheetsAuthMode,
    loadAuthConfig,
    setAuthMode,
    setServiceAccountCredentials,
    setCustomOAuthConfig,
    validateServiceAccountCredentials,
    validateCustomOAuthConfig,
    getAuthModeDisplayName,
    getAuthStatusSummary,
    ServiceAccountCredentials,
    CustomOAuthConfig,
} from '@/services/sheetsAuthService';

import './SheetsAuthConfig.css';

interface Props {
    onClose?: () => void;
    onConfigChanged?: () => void;
}

export const SheetsAuthConfig: React.FC<Props> = ({ onClose, onConfigChanged }) => {
    const [currentMode, setCurrentMode] = useState<SheetsAuthMode>('apiKey');
    const [status, setStatus] = useState(getAuthStatusSummary());
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showGasGuide, setShowGasGuide] = useState(false);

    // Service Account
    const [saCredentials, setSaCredentials] = useState<ServiceAccountCredentials | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Custom OAuth
    const [oauthClientId, setOauthClientId] = useState('');
    const [oauthClientSecret, setOauthClientSecret] = useState('');

    useEffect(() => {
        const config = loadAuthConfig();
        setCurrentMode(config.mode);
        if (config.serviceAccountCredentials) {
            setSaCredentials(config.serviceAccountCredentials);
        }
        if (config.customOAuthConfig) {
            setOauthClientId(config.customOAuthConfig.clientId);
            setOauthClientSecret(config.customOAuthConfig.clientSecret);
        }
        setStatus(getAuthStatusSummary());
    }, []);

    const handleModeChange = (mode: SheetsAuthMode) => {
        setCurrentMode(mode);
        setAuthMode(mode);
        setError(null);
        setSuccess(null);
        setStatus(getAuthStatusSummary());
        onConfigChanged?.();
    };

    // Service Account 密钥上传
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const json = JSON.parse(text);

            if (!validateServiceAccountCredentials(json)) {
                throw new Error('无效的 Service Account 密钥文件格式');
            }

            setSaCredentials(json);
            setServiceAccountCredentials(json);
            setSuccess(`已导入 Service Account: ${json.client_email}`);
            setError(null);
            setStatus(getAuthStatusSummary());
            onConfigChanged?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : '无法解析密钥文件');
            setSuccess(null);
        }

        // 清空 input 以便重复上传同一文件
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Custom OAuth 配置保存
    const handleSaveOAuthConfig = () => {
        const config: CustomOAuthConfig = {
            clientId: oauthClientId.trim(),
            clientSecret: oauthClientSecret.trim(),
        };

        if (!validateCustomOAuthConfig(config)) {
            setError('请填写完整的 Client ID 和 Client Secret');
            return;
        }

        setCustomOAuthConfig(config);
        setSuccess('OAuth 配置已保存');
        setError(null);
        setStatus(getAuthStatusSummary());
        onConfigChanged?.();
    };

    return (
        <div className="sheets-auth-config">
            <div className="sheets-auth-header">
                <h3>Google Sheets 认证配置</h3>
                {onClose && (
                    <button className="close-btn" onClick={onClose}>
                        <X size={18} />
                    </button>
                )}
            </div>

            {/* 状态提示 */}
            {error && (
                <div className="auth-message error">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}
            {success && (
                <div className="auth-message success">
                    <Check size={16} />
                    {success}
                </div>
            )}

            {/* 模式选择 */}
            <div className="auth-modes">
                {/* API Key 模式 */}
                <div
                    className={`auth-mode-card ${currentMode === 'apiKey' ? 'active' : ''}`}
                    onClick={() => handleModeChange('apiKey')}
                >
                    <div className="mode-icon">
                        <Key size={20} />
                    </div>
                    <div className="mode-info">
                        <div className="mode-title">API Key（只读）</div>
                        <div className="mode-desc">适合查看和分析公开表格，无需额外配置</div>
                    </div>
                    <div className="mode-badge readonly">只读</div>
                </div>

                {/* Service Account 模式 */}
                <div
                    className={`auth-mode-card ${currentMode === 'serviceAccount' ? 'active' : ''}`}
                    onClick={() => handleModeChange('serviceAccount')}
                >
                    <div className="mode-icon">
                        <FileJson size={20} />
                    </div>
                    <div className="mode-info">
                        <div className="mode-title">Service Account（读写）</div>
                        <div className="mode-desc">上传您自己的 Service Account 密钥，可读写共享的表格</div>
                    </div>
                    <div className="mode-badge readwrite">读写</div>
                </div>

                {/* Custom OAuth 模式 */}
                <div
                    className={`auth-mode-card ${currentMode === 'customOAuth' ? 'active' : ''}`}
                    onClick={() => handleModeChange('customOAuth')}
                >
                    <div className="mode-icon">
                        <User size={20} />
                    </div>
                    <div className="mode-info">
                        <div className="mode-title">自定义 OAuth（读写）</div>
                        <div className="mode-desc">导入您自己的 OAuth Client ID，无用户数限制</div>
                    </div>
                    <div className="mode-badge readwrite">读写</div>
                </div>

                {/* Built-in OAuth 测试模式 */}
                <div
                    className={`auth-mode-card ${currentMode === 'builtinOAuth' ? 'active' : ''}`}
                    onClick={() => handleModeChange('builtinOAuth')}
                >
                    <div className="mode-icon">
                        <Shield size={20} />
                    </div>
                    <div className="mode-info">
                        <div className="mode-title">内置 OAuth 测试（读写）</div>
                        <div className="mode-desc">需联系管理员添加邮箱，限 100 测试用户</div>
                    </div>
                    <div className="mode-badge test">测试</div>
                </div>

                {/* GAS 提示 */}
                <div className="gas-tip" style={{
                    marginTop: '12px',
                    padding: '10px 12px',
                    background: 'linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%)',
                    borderRadius: '8px',
                    border: '1px solid #c8e6c9',
                    fontSize: '12px',
                    color: '#2e7d32'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>💡</span>
                        <span>文案查重/文本库推荐</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#388e3c' }}>
                        使用 <strong>GAS (Google Apps Script)</strong> 方式，在文本库设置中配置 Web App URL 即可读写表格，无需复杂配置
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '10px' }}>
                        <button
                            onClick={() => setShowGasGuide(true)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#1565c0',
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                padding: 0,
                                fontSize: '10px'
                            }}
                        >
                            📖 查看 GAS 部署指南
                        </button>
                    </div>
                </div>
            </div>

            {/* 模式详细配置 */}
            <div className="auth-config-detail">
                {currentMode === 'apiKey' && (
                    <div className="config-section">
                        <div className="config-info">
                            <Info size={16} />
                            <span>API Key 模式无需额外配置，可直接读取公开的 Google Sheets。</span>
                        </div>
                        <div className="config-note">
                            <strong>注意：</strong>此模式只能读取，不能写入。如需写入功能（同步、入库等），请选择其他模式。
                        </div>
                    </div>
                )}

                {currentMode === 'serviceAccount' && (
                    <div className="config-section">
                        <div className="config-title">上传 Service Account 密钥</div>

                        {saCredentials && (
                            <div className="current-config">
                                <Check size={14} />
                                <span>已配置: {saCredentials.client_email}</span>
                            </div>
                        )}

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileUpload}
                            style={{ display: 'none' }}
                        />
                        <button
                            className="upload-btn"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload size={16} />
                            选择 JSON 密钥文件
                        </button>

                        <div className="config-help">
                            <a
                                href="https://console.cloud.google.com/iam-admin/serviceaccounts"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <ExternalLink size={12} />
                                如何创建 Service Account？
                            </a>
                        </div>

                        <div className="config-note">
                            <strong>使用步骤：</strong>
                            <ol>
                                <li>在 Google Cloud Console 创建 Service Account</li>
                                <li>生成并下载 JSON 密钥文件</li>
                                <li>将要操作的表格共享给 Service Account 邮箱</li>
                                <li>在此处上传密钥文件</li>
                            </ol>
                        </div>
                    </div>
                )}

                {currentMode === 'customOAuth' && (
                    <div className="config-section">
                        <div className="config-title">配置 OAuth Client</div>

                        <div className="config-form">
                            <label>
                                <span>Client ID</span>
                                <input
                                    type="text"
                                    value={oauthClientId}
                                    onChange={(e) => setOauthClientId(e.target.value)}
                                    placeholder="xxx.apps.googleusercontent.com"
                                />
                            </label>
                            <label>
                                <span>Client Secret</span>
                                <input
                                    type="password"
                                    value={oauthClientSecret}
                                    onChange={(e) => setOauthClientSecret(e.target.value)}
                                    placeholder="GOCSPX-xxx"
                                />
                            </label>
                            <button
                                className="save-btn"
                                onClick={handleSaveOAuthConfig}
                            >
                                保存配置
                            </button>
                        </div>

                        <div className="config-help">
                            <a
                                href="https://console.cloud.google.com/apis/credentials"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <ExternalLink size={12} />
                                如何创建 OAuth Client ID？
                            </a>
                        </div>

                        <div className="config-note">
                            <strong>使用步骤：</strong>
                            <ol>
                                <li>在 Google Cloud Console 创建 OAuth 2.0 Client ID</li>
                                <li>类型选择 "Web 应用"</li>
                                <li>添加授权重定向 URI: <code>{window.location.origin}/oauth-callback</code></li>
                                <li>复制 Client ID 和 Client Secret 填入上方</li>
                            </ol>
                        </div>
                    </div>
                )}

                {currentMode === 'builtinOAuth' && (
                    <div className="config-section">
                        <div className="config-info warning">
                            <AlertCircle size={16} />
                            <span>此模式仅限受邀测试用户使用</span>
                        </div>

                        <div className="config-note">
                            <strong>限制说明：</strong>
                            <ul>
                                <li>应用处于测试状态，最多支持 100 个测试用户</li>
                                <li>需要联系应用管理员将您的 Google 邮箱添加到白名单</li>
                                <li>Token 有效期 1 小时，过期需重新登录</li>
                            </ul>
                            <p style={{ marginTop: '12px' }}>
                                如果您需要长期使用写入功能，建议选择 <strong>Service Account</strong> 或 <strong>自定义 OAuth</strong> 模式。
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* 需要写入权限的功能说明 */}
            <div className="write-features-info">
                <div className="info-title">
                    <Info size={14} />
                    需要写入权限的功能
                </div>
                <ul>
                    <li><strong>数据分析</strong>：同步版本到表格、更新文件状态</li>
                    <li><strong>文案查重</strong>：入库、创建/重命名/删除分类</li>
                </ul>
                <div className="info-note">
                    如果不需要以上功能，使用默认的 <strong>API Key（只读）</strong> 模式即可。
                </div>
                <div className="info-note" style={{ marginTop: '8px', borderTop: '1px dashed #d4a574', paddingTop: '8px' }}>
                    <strong>💡 获取帮助：</strong>
                    <ul style={{ marginTop: '4px', marginBottom: '0' }}>
                        <li>需要创建 <strong>Service Account</strong> 或 <strong>OAuth</strong>？可联系技术员协助配置</li>
                        <li><strong>文案查重/文本库设置</strong>：推荐使用 <strong>GAS (Google Apps Script)</strong> 方式，在文本库设置中配置 Web App URL 即可读写表格，无需复杂认证</li>
                    </ul>
                </div>
            </div>

            {/* GAS 部署指南弹窗 */}
            {showGasGuide && (
                <div
                    className="gas-guide-overlay"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000
                    }}
                    onClick={() => setShowGasGuide(false)}
                >
                    <div
                        className="gas-guide-modal"
                        style={{
                            background: '#1e1e1e',
                            borderRadius: '12px',
                            width: '90%',
                            maxWidth: '700px',
                            maxHeight: '85vh',
                            overflow: 'auto',
                            padding: '20px',
                            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                            color: '#e0e0e0'
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #444', paddingBottom: '12px' }}>
                            <h3 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>📖 GAS (Google Apps Script) 部署指南</h3>
                            <button
                                onClick={() => setShowGasGuide(false)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa' }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                            <div style={{ background: 'rgba(76, 175, 80, 0.2)', padding: '12px', borderRadius: '8px', marginBottom: '16px', border: '1px solid rgba(76, 175, 80, 0.3)' }}>
                                <strong style={{ color: '#81c784' }}>✅ GAS 优势：</strong>
                                <span style={{ color: '#c8e6c9' }}>无需复杂认证配置，支持读写，适合个人使用</span>
                            </div>

                            <h4 style={{ margin: '16px 0 8px', color: '#64b5f6' }}>🔧 部署步骤</h4>
                            <ol style={{ paddingLeft: '20px', margin: 0, color: '#bbb' }}>
                                <li style={{ marginBottom: '8px' }}>在 Google Sheets 中点击 <code style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', color: '#ffd54f' }}>扩展程序</code> → <code style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', color: '#ffd54f' }}>Apps Script</code></li>
                                <li style={{ marginBottom: '8px' }}>删除默认代码，<strong style={{ color: '#fff' }}>粘贴下方脚本代码</strong></li>
                                <li style={{ marginBottom: '8px' }}>点击 <code style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', color: '#ffd54f' }}>部署</code> → <code style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', color: '#ffd54f' }}>新建部署</code> → <code style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', color: '#ffd54f' }}>Web 应用</code></li>
                                <li style={{ marginBottom: '8px' }}><span style={{ color: '#ef5350' }}>⚠️ 「谁可以访问」必须选择「任何人」</span></li>
                                <li style={{ marginBottom: '8px' }}>首次需授权：高级 → 转至 xxx → 允许</li>
                                <li>复制 Web App URL，粘贴到文案查重页面</li>
                            </ol>

                            <h4 style={{ margin: '20px 0 8px', color: '#64b5f6', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                📋 GAS 脚本代码
                                <button
                                    onClick={() => {
                                        const code = `/**
 * ITEN 文本库 GAS 服务 - 精简版
 * 部署为 Web App 后，将 URL 粘贴到文案查重中使用
 */

function doGet(e) {
  try {
    const action = e.parameter.action || 'read';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let result;
    
    if (action === 'list') {
      result = { success: true, data: { sheets: ss.getSheets().map(s => ({ name: s.getName(), rowCount: s.getLastRow() })) } };
    } else if (action === 'info') {
      result = { success: true, data: { id: ss.getId(), name: ss.getName(), sheets: ss.getSheets().map(s => s.getName()) } };
    } else {
      const sheetName = e.parameter.sheetName;
      const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
      if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '找不到工作表' })).setMimeType(ContentService.MimeType.JSON);
      const values = sheet.getDataRange().getValues();
      const headers = values[0] || [];
      const rows = values.slice(1).map((row, idx) => {
        const obj = { _rowIndex: idx + 2 };
        headers.forEach((h, i) => obj[h] = row[i]);
        return obj;
      });
      result = { success: true, data: { headers, rows } };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = data.action;
    let result;
    
    if (action === 'append') {
      let sheet = ss.getSheetByName(data.sheetName);
      if (!sheet) sheet = ss.insertSheet(data.sheetName);
      const lastRow = sheet.getLastRow();
      if (data.values && data.values.length > 0) {
        sheet.getRange(lastRow + 1, 1, data.values.length, data.values[0].length).setValues(data.values);
      }
      result = { success: true, message: '已追加 ' + data.values.length + ' 行' };
    } else if (action === 'createSheet') {
      if (ss.getSheetByName(data.sheetName)) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '已存在' })).setMimeType(ContentService.MimeType.JSON);
      const sheet = ss.insertSheet(data.sheetName);
      if (data.headers) sheet.getRange(1, 1, 1, data.headers.length).setValues([data.headers]);
      result = { success: true, message: '已创建' };
    } else if (action === 'renameSheet') {
      const sheet = ss.getSheetByName(data.oldName);
      if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '找不到' })).setMimeType(ContentService.MimeType.JSON);
      sheet.setName(data.newName);
      result = { success: true, message: '已重命名' };
    } else if (action === 'deleteSheet') {
      const sheet = ss.getSheetByName(data.sheetName);
      if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
      result = { success: true, message: '已删除' };
    } else if (action === 'deleteRows') {
      const sheet = ss.getSheetByName(data.sheetName);
      if (sheet && data.rowIndexes) {
        data.rowIndexes.sort((a,b) => b-a).forEach(idx => { if (idx > 0) sheet.deleteRow(idx); });
      }
      result = { success: true, message: '已删除行' };
    } else {
      result = { success: false, error: '未知操作' };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.message })).setMimeType(ContentService.MimeType.JSON);
  }
}`;
                                        navigator.clipboard.writeText(code);
                                        alert('✅ 脚本代码已复制到剪贴板！');
                                    }}
                                    style={{ padding: '4px 12px', background: '#4caf50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                                >
                                    复制代码
                                </button>
                            </h4>
                            <pre style={{
                                background: '#0d1117',
                                padding: '12px',
                                borderRadius: '8px',
                                fontSize: '10px',
                                overflow: 'auto',
                                maxHeight: '200px',
                                color: '#c9d1d9',
                                border: '1px solid #30363d'
                            }}>
                                {`/**
 * ITEN 文本库 GAS 服务 - 精简版
 * 部署为 Web App 后，将 URL 粘贴到文案查重中使用
 */

function doGet(e) {
  try {
    const action = e.parameter.action || 'read';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let result;
    
    if (action === 'list') {
      result = { success: true, data: { sheets: ss.getSheets().map(s => ({ name: s.getName(), rowCount: s.getLastRow() })) } };
    } else if (action === 'info') {
      result = { success: true, data: { id: ss.getId(), name: ss.getName(), sheets: ss.getSheets().map(s => s.getName()) } };
    } else {
      const sheetName = e.parameter.sheetName;
      const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
      if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '找不到工作表' })).setMimeType(ContentService.MimeType.JSON);
      const values = sheet.getDataRange().getValues();
      const headers = values[0] || [];
      const rows = values.slice(1).map((row, idx) => {
        const obj = { _rowIndex: idx + 2 };
        headers.forEach((h, i) => obj[h] = row[i]);
        return obj;
      });
      result = { success: true, data: { headers, rows } };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // ... 省略，点击复制获取完整代码
  } catch (e) { return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.message })).setMimeType(ContentService.MimeType.JSON); }
}`}
                            </pre>

                            <div style={{ marginTop: '16px', padding: '10px', background: 'rgba(255, 152, 0, 0.1)', borderRadius: '6px', border: '1px solid rgba(255, 152, 0, 0.3)', fontSize: '11px', color: '#ffb74d' }}>
                                ⚠️ 点击「复制代码」获取完整脚本，上方仅显示部分代码
                            </div>
                        </div>

                        <div style={{ marginTop: '20px', textAlign: 'right' }}>
                            <button
                                onClick={() => setShowGasGuide(false)}
                                style={{ padding: '8px 20px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SheetsAuthConfig;
