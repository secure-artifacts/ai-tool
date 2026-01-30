/**
 * Google Sheets 认证配置面板
 * 
 * 让用户选择和配置认证模式
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    Key, Upload, User, Shield, AlertCircle, Check, X, ExternalLink, Info, FileJson, Lightbulb, BookOpen, Clipboard, Wrench, AlertTriangle
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
                <div className="gas-tip">
                    <div className="gas-tip-header">
                        <Lightbulb size={14} className="inline" />
                        <span>文案查重/文本库推荐</span>
                    </div>
                    <div className="gas-tip-desc">
                        使用 <strong>GAS (Google Apps Script)</strong> 方式，在文本库设置中配置 Web App URL 即可读写表格，无需复杂配置
                    </div>
                    <div className="gas-tip-link">
                        <button
                            onClick={() => setShowGasGuide(true)}
                            className="gas-tip-btn"
                        >
                            <BookOpen size={14} className="inline mr-1" /> 查看 GAS 部署指南
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
                            className="d-none"
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
                            <p className="mt-3">
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
                <div className="info-note info-note-separator">
                    <Lightbulb size={14} className="inline mr-1" /><strong>获取帮助：</strong>
                    <ul className="mt-1 mb-0">
                        <li>需要创建 <strong>Service Account</strong> 或 <strong>OAuth</strong>？可联系技术员协助配置</li>
                        <li><strong>文案查重/文本库设置</strong>：推荐使用 <strong>GAS (Google Apps Script)</strong> 方式，在文本库设置中配置 Web App URL 即可读写表格，无需复杂认证</li>
                    </ul>
                </div>
            </div>

            {/* GAS 部署指南弹窗 */}
            {showGasGuide && (
                <div
                    className="gas-guide-overlay"
                    onClick={() => setShowGasGuide(false)}
                >
                    <div
                        className="gas-guide-modal"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="gas-guide-header">
                            <h3 className="gas-guide-title"><BookOpen size={16} className="inline mr-1" /> GAS (Google Apps Script) 部署指南</h3>
                            <button
                                onClick={() => setShowGasGuide(false)}
                                className="gas-guide-close-btn"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="gas-guide-content">
                            <div className="gas-advantage-box">
                                <strong className="gas-advantage-label">✅ GAS 优势：</strong>
                                <span className="gas-advantage-text">无需复杂认证配置，支持读写，适合个人使用</span>
                            </div>

                            <h4 className="gas-section-title"><Wrench size={14} className="inline mr-1" /> 部署步骤</h4>
                            <ol className="gas-steps-list">
                                <li className="mb-2">在 Google Sheets 中点击 <code className="gas-code-highlight">扩展程序</code> → <code className="gas-code-highlight">Apps Script</code></li>
                                <li className="mb-2">删除默认代码，<strong className="text-white">粘贴下方脚本代码</strong></li>
                                <li className="mb-2">点击 <code className="gas-code-highlight">部署</code> → <code className="gas-code-highlight">新建部署</code> → <code className="gas-code-highlight">Web 应用</code></li>
                                <li className="mb-2"><AlertTriangle size={12} className="inline mr-1 text-amber-400" /><span className="gas-warning-text">「谁可以访问」必须选择「任何人」</span></li>
                                <li className="mb-2">首次需授权：高级 → 转至 xxx → 允许</li>
                                <li>复制 Web App URL，粘贴到文案查重页面</li>
                            </ol>

                            <h4 className="gas-code-title">
                                <Clipboard size={14} className="inline mr-1" /> GAS 脚本代码
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
                                    className="gas-copy-btn"
                                >
                                    复制代码
                                </button>
                            </h4>
                            <pre className="gas-code-block">
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

                            <div className="gas-warning-box">
                                <AlertTriangle size={14} className="inline mr-1" /> 点击「复制代码」获取完整脚本，上方仅显示部分代码
                            </div>
                        </div>

                        <div className="gas-guide-footer">
                            <button
                                onClick={() => setShowGasGuide(false)}
                                className="gas-close-btn"
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
