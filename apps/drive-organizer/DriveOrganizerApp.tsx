/**
 * 云端文件分拣器 (Drive File Organizer)
 * 读取 Google Drive 文件夹 → 设定目标文件夹 → 手动分类 → 批量移动
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
    FolderOpen, Search, Grid, List, Check, X, Plus, Trash2, RefreshCw,
    Loader2, FileText, Film, Image as ImageIcon, File, ArrowRight,
    CheckSquare, Square, ChevronDown, Key, FolderInput, Move, Folder, LogIn
} from 'lucide-react';
import './DriveOrganizer.css';

// Load Google Identity Services script
const GIS_SCRIPT_ID = 'google-identity-services';
function loadGisScript(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (document.getElementById(GIS_SCRIPT_ID)) { resolve(); return; }
        const s = document.createElement('script');
        s.id = GIS_SCRIPT_ID;
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('无法加载 Google 登录脚本'));
        document.head.appendChild(s);
    });
}

// ========== Types ==========

interface DriveFileItem {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    parents?: string[];
    folderPath?: string;       // relative path inside scanned tree
    thumbnailLink?: string;
    isFolder?: boolean;        // true if this is a subfolder
}

interface TargetFolder {
    id: string;
    name: string;
    folderId: string;   // Drive folder ID (empty = not yet linked)
    color: string;
}

type ViewMode = 'grid' | 'list';
type FileTypeFilter = 'all' | 'image' | 'video' | 'document' | 'folder' | 'other';

// ========== Constants ==========

const DRIVE_API_KEY_STORAGE = 'sheetmind_drive_api_key';
const TARGET_FOLDERS_STORAGE = 'drive_organizer_targets';
const CLASSIFICATION_STORAGE = 'drive_organizer_classification';
const OAUTH_TOKEN_STORAGE = 'drive_organizer_oauth_token';
const CLIENT_ID_STORAGE = 'drive_organizer_client_id';

const TARGET_COLORS = [
    '#27ae60', '#2980b9', '#e67e22', '#e74c3c', '#9b59b6',
    '#1abc9c', '#f39c12', '#3498db', '#e91e63', '#00bcd4',
];

const FILE_TYPE_ICONS: Record<string, React.ReactNode> = {
    video: <Film size={28} />,
    image: <ImageIcon size={28} />,
    document: <FileText size={28} />,
    folder: <Folder size={28} />,
    other: <File size={28} />,
};

// ========== Helpers ==========

function extractDriveFolderId(url: string): string | null {
    const m = url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    try {
        const parsed = new URL(url);
        const id = parsed.searchParams.get('id');
        if (id && /^[a-zA-Z0-9_-]{10,}$/.test(id)) return id;
    } catch { }
    return null;
}

function getFileTypeCategory(mimeType: string): 'image' | 'video' | 'document' | 'other' {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('application/pdf') ||
        mimeType.includes('document') ||
        mimeType.includes('spreadsheet') ||
        mimeType.includes('presentation') ||
        mimeType.startsWith('text/')) return 'document';
    return 'other';
}

function getThumbnailUrl(fileId: string): string {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
}

function formatFileSize(bytes?: string): string {
    if (!bytes) return '';
    const n = parseInt(bytes, 10);
    if (isNaN(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(1)} GB`;
}

// ========== Drive API: Move file ==========

async function moveFileToFolder(
    fileId: string,
    targetFolderId: string,
    oauthToken: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        // Step 1: Get current parents
        const metaRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
            { headers: { Authorization: `Bearer ${oauthToken}` } }
        );
        if (!metaRes.ok) {
            const err = await metaRes.json().catch(() => ({}));
            return { success: false, error: err?.error?.message || `HTTP ${metaRes.status}` };
        }
        const meta = await metaRes.json();
        const previousParents = (meta.parents || []).join(',');

        // Step 2: Move file (update parents)
        const moveRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${targetFolderId}&removeParents=${previousParents}&fields=id,parents`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${oauthToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        if (!moveRes.ok) {
            const err = await moveRes.json().catch(() => ({}));
            return { success: false, error: err?.error?.message || `HTTP ${moveRes.status}` };
        }
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message || String(e) };
    }
}

// ========== Drive API: List ==========

async function listDriveFilesRecursive(
    folderId: string,
    apiKey: string,
    recursive: boolean,
    onProgress: (msg: string) => void,
    signal: AbortSignal,
): Promise<DriveFileItem[]> {
    const results: DriveFileItem[] = [];
    const queue: { id: string; path: string }[] = [{ id: folderId, path: '' }];
    let folderCount = 0;

    while (queue.length > 0) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const current = queue.shift()!;
        folderCount++;
        onProgress(`正在扫描第 ${folderCount} 个文件夹… (已发现 ${results.length} 个文件)`);

        let pageToken: string | undefined;
        do {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const q = encodeURIComponent(`'${current.id}' in parents and trashed=false`);
            const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,modifiedTime,parents)');
            let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&key=${apiKey}`;
            if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

            const res = await fetch(url, { signal });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error?.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            const files: any[] = data.files || [];

            for (const f of files) {
                if (f.mimeType === 'application/vnd.google-apps.folder') {
                    // Always add folders to results so they can be selected as targets
                    results.push({
                        id: f.id,
                        name: f.name,
                        mimeType: f.mimeType,
                        parents: f.parents,
                        folderPath: current.path,
                        isFolder: true,
                    });
                    if (recursive) {
                        queue.push({ id: f.id, path: current.path ? `${current.path}/${f.name}` : f.name });
                    }
                } else {
                    results.push({
                        id: f.id,
                        name: f.name,
                        mimeType: f.mimeType,
                        size: f.size,
                        modifiedTime: f.modifiedTime,
                        parents: f.parents,
                        folderPath: current.path,
                    });
                }
            }
            pageToken = data.nextPageToken;
        } while (pageToken);
    }
    return results;
}

// ========== Component ==========

const DriveOrganizerApp: React.FC = () => {
    // ── Source folder ──
    const [folderUrl, setFolderUrl] = useState('');
    const [recursive, setRecursive] = useState(true);
    const [apiKey, setApiKey] = useState(() => localStorage.getItem(DRIVE_API_KEY_STORAGE) || '');
    const [oauthToken, setOauthToken] = useState(() => localStorage.getItem(OAUTH_TOKEN_STORAGE) || '');
    const [clientId, setClientId] = useState(() => localStorage.getItem(CLIENT_ID_STORAGE) || '');
    const [loginStatus, setLoginStatus] = useState<'none' | 'loading' | 'ready'>(
        () => localStorage.getItem(OAUTH_TOKEN_STORAGE) ? 'ready' : 'none'
    );
    const [showApiKey, setShowApiKey] = useState(false);

    // ── Move execution state ──
    const [showMoveConfirm, setShowMoveConfirm] = useState(false);
    const [moving, setMoving] = useState(false);
    const [moveProgress, setMoveProgress] = useState({ done: 0, total: 0, failed: 0 });
    const [moveLog, setMoveLog] = useState<string[]>([]);
    const moveAbortRef = useRef(false);

    // ── Scan state ──
    const [files, setFiles] = useState<DriveFileItem[]>([]);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState('');
    const [scanError, setScanError] = useState('');
    const abortRef = useRef<AbortController | null>(null);

    // ── Target folders ──
    const [targets, setTargets] = useState<TargetFolder[]>(() => {
        try {
            const saved = localStorage.getItem(TARGET_FOLDERS_STORAGE);
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [newTargetName, setNewTargetName] = useState('');
    const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
    const [editingTargetUrl, setEditingTargetUrl] = useState('');
    const [addingTarget, setAddingTarget] = useState(false);

    // ── Classification map: fileId → targetId ──
    const [classMap, setClassMap] = useState<Record<string, string>>(() => {
        try {
            const saved = localStorage.getItem(CLASSIFICATION_STORAGE);
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });

    // ── UI state ──
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
    const [draggedFileIds, setDraggedFileIds] = useState<string[]>([]);
    const [activeTargetFilter, setActiveTargetFilter] = useState<string | null>(null); // filter by target
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: DriveFileItem } | null>(null);

    // ── Persist ──
    useEffect(() => { localStorage.setItem(DRIVE_API_KEY_STORAGE, apiKey); }, [apiKey]);
    useEffect(() => { localStorage.setItem(OAUTH_TOKEN_STORAGE, oauthToken); }, [oauthToken]);
    useEffect(() => { localStorage.setItem(CLIENT_ID_STORAGE, clientId); }, [clientId]);
    useEffect(() => { localStorage.setItem(TARGET_FOLDERS_STORAGE, JSON.stringify(targets)); }, [targets]);
    useEffect(() => { localStorage.setItem(CLASSIFICATION_STORAGE, JSON.stringify(classMap)); }, [classMap]);

    // ── Google OAuth Login ──
    const handleGoogleLogin = useCallback(async () => {
        const cid = clientId.trim();
        if (!cid) { setScanError('请先输入 OAuth Client ID'); return; }
        setLoginStatus('loading');
        try {
            await loadGisScript();
            const google = (window as any).google;
            if (!google?.accounts?.oauth2) throw new Error('Google Identity Services 加载失败');

            const tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: cid,
                scope: 'https://www.googleapis.com/auth/drive',
                callback: (resp: any) => {
                    if (resp.error) {
                        setScanError(`登录失败: ${resp.error}`);
                        setLoginStatus('none');
                        return;
                    }
                    setOauthToken(resp.access_token);
                    setLoginStatus('ready');
                },
            });
            tokenClient.requestAccessToken();
        } catch (e: any) {
            setScanError(`Google 登录失败: ${e.message}`);
            setLoginStatus('none');
        }
    }, [clientId]);

    // ── Scan ──
    const handleScan = useCallback(async () => {
        const folderId = extractDriveFolderId(folderUrl);
        if (!folderId) { setScanError('无法解析文件夹链接，请粘贴有效的 Google Drive 文件夹 URL'); return; }
        if (!apiKey.trim()) { setScanError('请先设置 API Key'); setShowApiKey(true); return; }

        setScanError('');
        setScanning(true);
        setFiles([]);
        setSelectedIds(new Set());
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;

        try {
            const result = await listDriveFilesRecursive(folderId, apiKey.trim(), recursive, setScanProgress, ac.signal);
            setFiles(result);
            setScanProgress(`扫描完成，共 ${result.length} 个文件`);
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                setScanError(e.message || '扫描失败');
            }
        } finally {
            setScanning(false);
        }
    }, [folderUrl, apiKey, recursive]);

    const handleStopScan = useCallback(() => {
        abortRef.current?.abort();
        setScanning(false);
    }, []);

    // ── Target folders management ──
    const addTarget = useCallback(async () => {
        const input = newTargetName.trim();
        if (!input) return;

        // Check if it's a Drive folder URL
        const driveFolderId = extractDriveFolderId(input);
        if (driveFolderId && apiKey.trim()) {
            // Resolve folder name from Drive API
            setAddingTarget(true);
            try {
                const res = await fetch(
                    `https://www.googleapis.com/drive/v3/files/${driveFolderId}?fields=name,mimeType&key=${apiKey.trim()}`
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const folderName = data.name || driveFolderId;
                // Check if already added
                if (targets.some(t => t.folderId === driveFolderId)) {
                    setScanError(`文件夹「${folderName}」已存在`);
                } else {
                    const color = TARGET_COLORS[targets.length % TARGET_COLORS.length];
                    setTargets(prev => [...prev, { id: `t-${Date.now()}`, name: folderName, folderId: driveFolderId, color }]);
                }
            } catch (e: any) {
                setScanError(`无法获取文件夹信息: ${e.message}`);
            } finally {
                setAddingTarget(false);
            }
        } else if (driveFolderId) {
            // No API key, just use the folder ID as name
            if (!targets.some(t => t.folderId === driveFolderId)) {
                const color = TARGET_COLORS[targets.length % TARGET_COLORS.length];
                setTargets(prev => [...prev, { id: `t-${Date.now()}`, name: driveFolderId.slice(0, 12) + '...', folderId: driveFolderId, color }]);
            }
        } else {
            // Plain text name — create without binding (user can bind later)
            const color = TARGET_COLORS[targets.length % TARGET_COLORS.length];
            setTargets(prev => [...prev, { id: `t-${Date.now()}`, name: input, folderId: '', color }]);
        }
        setNewTargetName('');
    }, [newTargetName, targets, apiKey]);

    const removeTarget = useCallback((targetId: string) => {
        setTargets(prev => prev.filter(t => t.id !== targetId));
        setClassMap(prev => {
            const next = { ...prev };
            for (const k of Object.keys(next)) { if (next[k] === targetId) delete next[k]; }
            return next;
        });
    }, []);

    // ── Link target folder to Drive folder URL ──
    const linkTargetFolder = useCallback((targetId: string, url: string) => {
        const driveFolderId = extractDriveFolderId(url);
        if (!driveFolderId && url.trim()) return; // invalid URL, ignore
        setTargets(prev => prev.map(t =>
            t.id === targetId ? { ...t, folderId: driveFolderId || '' } : t
        ));
        setEditingTargetId(null);
        setEditingTargetUrl('');
    }, []);

    // ── Execute move ──
    const handleExecuteMove = useCallback(async () => {
        if (!oauthToken.trim()) {
            setScanError('请先设置 OAuth Token（用于移动文件）');
            setShowApiKey(true);
            return;
        }
        // Build move list: only files that have a classification AND target has a linked folderId
        const moves: { fileId: string; fileName: string; targetFolderId: string; targetName: string }[] = [];
        for (const [fileId, targetId] of Object.entries(classMap)) {
            const target = targets.find(t => t.id === targetId);
            if (!target || !target.folderId) continue;
            const file = files.find(f => f.id === fileId);
            if (!file) continue;
            moves.push({ fileId, fileName: file.name, targetFolderId: target.folderId, targetName: target.name });
        }
        if (moves.length === 0) {
            setScanError('没有可执行的移动操作。请确保目标文件夹已绑定 Drive 链接。');
            return;
        }

        setShowMoveConfirm(false);
        setMoving(true);
        setMoveProgress({ done: 0, total: moves.length, failed: 0 });
        setMoveLog([]);
        moveAbortRef.current = false;

        let done = 0, failed = 0;
        for (const move of moves) {
            if (moveAbortRef.current) break;
            const result = await moveFileToFolder(move.fileId, move.targetFolderId, oauthToken.trim());
            done++;
            if (result.success) {
                setMoveLog(prev => [...prev, `✅ ${move.fileName} → ${move.targetName}`]);
                // Remove from classMap and files list after successful move
                setClassMap(prev => { const n = { ...prev }; delete n[move.fileId]; return n; });
                setFiles(prev => prev.filter(f => f.id !== move.fileId));
            } else {
                failed++;
                setMoveLog(prev => [...prev, `❌ ${move.fileName}: ${result.error}`]);
            }
            setMoveProgress({ done, total: moves.length, failed });
            // Small delay to avoid rate limiting
            if (done < moves.length) await new Promise(r => setTimeout(r, 100));
        }
        setMoving(false);
    }, [oauthToken, classMap, targets, files]);

    // ── Classification ──
    const classifyFiles = useCallback((fileIds: string[], targetId: string) => {
        setClassMap(prev => {
            const next = { ...prev };
            for (const fid of fileIds) { next[fid] = targetId; }
            return next;
        });
        setSelectedIds(new Set());
    }, []);

    const unclassifyFiles = useCallback((fileIds: string[]) => {
        setClassMap(prev => {
            const next = { ...prev };
            for (const fid of fileIds) { delete next[fid]; }
            return next;
        });
    }, []);

    // ── Right-click: set folder as target ──
    const handleSetAsTarget = useCallback((file: DriveFileItem) => {
        if (!file.isFolder) return;
        // Check if already exists
        if (targets.some(t => t.folderId === file.id)) {
            setScanError(`文件夹「${file.name}」已是目标文件夹`);
            setContextMenu(null);
            return;
        }
        const color = TARGET_COLORS[targets.length % TARGET_COLORS.length];
        setTargets(prev => [...prev, { id: `t-${Date.now()}`, name: file.name, folderId: file.id, color }]);
        setContextMenu(null);
    }, [targets]);

    // Close context menu on click elsewhere
    useEffect(() => {
        const handler = () => setContextMenu(null);
        if (contextMenu) {
            window.addEventListener('click', handler);
            return () => window.removeEventListener('click', handler);
        }
    }, [contextMenu]);

    // ── Keyboard shortcuts (1-9 for targets) ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            const num = parseInt(e.key, 10);
            if (num >= 1 && num <= 9 && num <= targets.length && selectedIds.size > 0) {
                e.preventDefault();
                classifyFiles(Array.from(selectedIds), targets[num - 1].id);
            }
            if (e.key === 'Escape') { setSelectedIds(new Set()); }
            if (e.key === 'a' && (e.metaKey || e.ctrlKey) && files.length > 0) {
                e.preventDefault();
                setSelectedIds(new Set(filteredFiles.map(f => f.id)));
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [targets, selectedIds, files]);

    // ── Drag & Drop ──
    const handleDragStart = useCallback((fileId: string) => {
        const ids = selectedIds.has(fileId) ? Array.from(selectedIds) : [fileId];
        setDraggedFileIds(ids);
    }, [selectedIds]);

    const handleDropOnTarget = useCallback((targetId: string) => {
        if (draggedFileIds.length > 0) {
            classifyFiles(draggedFileIds, targetId);
        }
        setDraggedFileIds([]);
        setDragOverTarget(null);
    }, [draggedFileIds, classifyFiles]);

    // ── Filtered files ──
    const filteredFiles = useMemo(() => {
        let result = files;
        if (typeFilter === 'folder') {
            result = result.filter(f => f.isFolder);
        } else if (typeFilter !== 'all') {
            result = result.filter(f => !f.isFolder && getFileTypeCategory(f.mimeType) === typeFilter);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(f => f.name.toLowerCase().includes(q) || (f.folderPath || '').toLowerCase().includes(q));
        }
        if (activeTargetFilter === '__unclassified__') {
            result = result.filter(f => !f.isFolder && !classMap[f.id]);
        } else if (activeTargetFilter) {
            result = result.filter(f => classMap[f.id] === activeTargetFilter);
        }
        return result;
    }, [files, typeFilter, searchQuery, activeTargetFilter, classMap]);

    // ── Counts ──
    const targetCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const fid of Object.keys(classMap)) {
            const tid = classMap[fid];
            counts[tid] = (counts[tid] || 0) + 1;
        }
        return counts;
    }, [classMap]);

    const unclassifiedCount = files.length - Object.keys(classMap).filter(k => files.some(f => f.id === k)).length;

    // ── Toggle selection ──
    const toggleSelect = useCallback((fileId: string, e?: React.MouseEvent) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (e?.shiftKey) {
                // Range select not implemented yet, just toggle
            }
            if (next.has(fileId)) next.delete(fileId);
            else next.add(fileId);
            return next;
        });
    }, []);

    // ── Render ──
    const getTargetForFile = (fileId: string): TargetFolder | undefined => {
        const tid = classMap[fileId];
        return tid ? targets.find(t => t.id === tid) : undefined;
    };

    return (
        <div className="drive-organizer">
            {/* ── Top bar ── */}
            <div className="do-topbar">
                <div className="do-topbar-title">
                    <FolderOpen size={18} /> 云端文件分拣器
                </div>
                <div className="do-folder-input-group">
                    <input
                        className="do-folder-input"
                        placeholder="粘贴 Google Drive 文件夹链接..."
                        value={folderUrl}
                        onChange={e => setFolderUrl(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
                    />
                    <label className="do-toggle-row" onClick={() => setRecursive(!recursive)}>
                        <div className={`do-toggle-switch ${recursive ? 'on' : ''}`} />
                        <span>递归</span>
                    </label>
                    {scanning ? (
                        <button className="do-btn do-btn-danger" onClick={handleStopScan}>
                            <X size={14} /> 停止
                        </button>
                    ) : (
                        <button className="do-btn do-btn-primary" onClick={handleScan} disabled={!folderUrl.trim()}>
                            <Search size={14} /> 扫描
                        </button>
                    )}
                    <button className="do-btn" onClick={() => setShowApiKey(!showApiKey)} title="API Key / Token 设置">
                        <Key size={14} />
                    </button>
                </div>
            </div>

            {/* API Key + OAuth Client ID row */}
            {showApiKey && (
                <div className="do-api-key-row">
                    <Key size={14} />
                    <span>API Key：</span>
                    <input
                        type="password"
                        placeholder="Google Cloud API Key"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        style={{ maxWidth: 200 }}
                    />
                    <span style={{ margin: '0 8px', opacity: 0.4 }}>│</span>
                    <span>Client ID：</span>
                    <input
                        type="password"
                        placeholder="OAuth Client ID（用于文件移动授权）"
                        value={clientId}
                        onChange={e => setClientId(e.target.value)}
                        style={{ maxWidth: 260 }}
                    />
                    <button
                        className={`do-btn ${loginStatus === 'ready' ? 'do-btn-success' : 'do-btn-primary'}`}
                        onClick={handleGoogleLogin}
                        disabled={loginStatus === 'loading' || !clientId.trim()}
                        style={{ padding: '4px 12px', fontSize: 12 }}
                    >
                        {loginStatus === 'loading' ? <><Loader2 size={12} className="spinner" /> 登录中...</> :
                         loginStatus === 'ready' ? <><Check size={12} /> 已授权</> :
                         <><LogIn size={12} /> Google 登录</>}
                    </button>
                    <button className="do-btn" onClick={() => setShowApiKey(false)} style={{ padding: '3px 8px' }}>
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Scan status */}
            {scanning && (
                <div className="do-scan-status">
                    <Loader2 size={14} className="spinner" />
                    {scanProgress}
                </div>
            )}

            {/* Error */}
            {scanError && (
                <div className="do-scan-status" style={{ background: 'rgba(231,76,60,0.08)', color: '#e74c3c', borderColor: 'rgba(231,76,60,0.15)' }}>
                    ⚠️ {scanError}
                    <button className="do-btn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }} onClick={() => setScanError('')}>
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* Move progress */}
            {moving && (
                <div className="do-move-progress">
                    <Loader2 size={14} className="spinner" />
                    <span>正在移动文件 {moveProgress.done}/{moveProgress.total}</span>
                    {moveProgress.failed > 0 && <span style={{ color: '#e74c3c' }}>（{moveProgress.failed} 失败）</span>}
                    <div className="do-move-progress-bar">
                        <div className="do-move-progress-fill" style={{ width: `${(moveProgress.done / Math.max(1, moveProgress.total)) * 100}%` }} />
                    </div>
                    <button className="do-btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => { moveAbortRef.current = true; }}>
                        <X size={12} /> 停止
                    </button>
                </div>
            )}

            {/* ── Main body ── */}
            <div className="do-body">
                {/* ── Left sidebar: target folders ── */}
                <div className="do-sidebar">
                    <div className="do-sidebar-header">
                        <span>📁 目标文件夹</span>
                    </div>

                    {targets.map((t, idx) => (
                        <div key={t.id}>
                            <div
                                className={`do-target-item ${dragOverTarget === t.id ? 'drag-over' : ''} ${activeTargetFilter === t.id ? 'active' : ''}`}
                                onClick={() => setActiveTargetFilter(activeTargetFilter === t.id ? null : t.id)}
                                onDragOver={e => { e.preventDefault(); setDragOverTarget(t.id); }}
                                onDragLeave={() => setDragOverTarget(null)}
                                onDrop={e => { e.preventDefault(); handleDropOnTarget(t.id); }}
                                style={{ borderLeftColor: t.color }}
                            >
                                <div className="do-target-color" style={{ background: t.color }} />
                                <span className="do-target-name" title={t.name + (t.folderId ? ` (已绑定)` : ' (未绑定)')}>
                                    {t.name}
                                    {t.folderId ? ' ✓' : ''}
                                </span>
                                <span className="do-kbd">{idx + 1}</span>
                                <span className="do-target-count">{targetCounts[t.id] || 0}</span>
                                <span className="do-target-remove" title="绑定 Drive 文件夹" onClick={e => { e.stopPropagation(); setEditingTargetId(editingTargetId === t.id ? null : t.id); setEditingTargetUrl(''); }}>
                                    <FolderInput size={12} />
                                </span>
                                <span className="do-target-remove" onClick={e => { e.stopPropagation(); removeTarget(t.id); }}>
                                    <X size={12} />
                                </span>
                            </div>
                            {editingTargetId === t.id && (
                                <div className="do-add-target" style={{ paddingTop: 2, paddingBottom: 6 }}>
                                    <input
                                        placeholder={t.folderId ? `已绑定: ${t.folderId.slice(0, 12)}...` : '粘贴目标 Drive 文件夹链接...'}
                                        value={editingTargetUrl}
                                        onChange={e => setEditingTargetUrl(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') linkTargetFolder(t.id, editingTargetUrl); }}
                                        autoFocus
                                    />
                                    <button className="do-btn" onClick={() => linkTargetFolder(t.id, editingTargetUrl)} style={{ padding: '3px 6px' }}>
                                        <Check size={12} />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Unclassified */}
                    {files.length > 0 && (
                        <div
                            className={`do-target-item unclassified ${activeTargetFilter === '__unclassified__' ? 'active' : ''}`}
                            onClick={() => setActiveTargetFilter(activeTargetFilter === '__unclassified__' ? null : '__unclassified__')}
                        >
                            <div className="do-target-color" style={{ background: '#7f8c8d' }} />
                            <span className="do-target-name">未分类</span>
                            <span className="do-target-count">{unclassifiedCount}</span>
                        </div>
                    )}

                    {/* Add target */}
                    <div className="do-add-target">
                        <input
                            placeholder="粘贴 Drive 文件夹链接 或 输入名称..."
                            value={newTargetName}
                            onChange={e => setNewTargetName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addTarget(); }}
                            disabled={addingTarget}
                        />
                        <button className="do-btn" onClick={addTarget} disabled={!newTargetName.trim() || addingTarget} style={{ padding: '4px 6px' }}>
                            {addingTarget ? <Loader2 size={14} className="spinner" /> : <Plus size={14} />}
                        </button>
                    </div>
                </div>

                {/* ── Content ── */}
                <div className="do-content">
                    {files.length > 0 && (
                        <div className="do-toolbar">
                            <input
                                className="do-search-input"
                                placeholder="🔍 搜索文件名..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                            {(['all', 'image', 'video', 'document', 'folder', 'other'] as FileTypeFilter[]).map(ft => (
                                <button
                                    key={ft}
                                    className={`do-filter-chip ${typeFilter === ft ? 'active' : ''}`}
                                    onClick={() => setTypeFilter(ft)}
                                >
                                    {ft === 'all' ? '全部' : ft === 'image' ? '图片' : ft === 'video' ? '视频' : ft === 'document' ? '文档' : ft === 'folder' ? '文件夹' : '其他'}
                                </button>
                            ))}
                            <div style={{ flex: 1 }} />
                            <button className={`do-filter-chip ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
                                <Grid size={12} />
                            </button>
                            <button className={`do-filter-chip ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>
                                <List size={12} />
                            </button>
                            <span className="do-toolbar-info">
                                {filteredFiles.length} / {files.length} 个文件
                                {activeTargetFilter && <> · <button className="do-btn" style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => setActiveTargetFilter(null)}>清除筛选</button></>}
                            </span>
                        </div>
                    )}

                    {files.length === 0 && !scanning ? (
                        <div className="do-empty-state">
                            <FolderOpen />
                            <p>粘贴 Google Drive 文件夹链接并点击「扫描」，<br />即可加载所有文件进行分类整理。</p>
                            <p style={{ fontSize: 12, opacity: 0.6 }}>
                                提示：文件夹需要设为"知道链接的人可查看"，<br />或使用组织内部共享的文件夹。
                            </p>
                        </div>
                    ) : (
                        <div className={`do-file-grid ${viewMode === 'list' ? 'list-view' : ''}`}>
                            {filteredFiles.map(file => {
                                const isFolder = file.isFolder;
                                const cat = isFolder ? 'folder' : getFileTypeCategory(file.mimeType);
                                const isImage = cat === 'image';
                                const isVideo = cat === 'video';
                                const target = getTargetForFile(file.id);
                                const isSelected = selectedIds.has(file.id);
                                const isAlreadyTarget = isFolder && targets.some(t => t.folderId === file.id);

                                return (
                                    <div
                                        key={file.id}
                                        className={`do-file-card ${isSelected ? 'selected' : ''} ${target ? 'classified' : ''} ${draggedFileIds.includes(file.id) ? 'dragging' : ''} ${isFolder ? 'is-folder' : ''} ${isAlreadyTarget ? 'is-target' : ''}`}
                                        onClick={e => { if (!isFolder) toggleSelect(file.id, e); }}
                                        draggable={!isFolder}
                                        onDragStart={() => { if (!isFolder) handleDragStart(file.id); }}
                                        onDragEnd={() => { setDraggedFileIds([]); setDragOverTarget(null); }}
                                        onContextMenu={e => {
                                            if (isFolder) {
                                                e.preventDefault();
                                                setContextMenu({ x: e.clientX, y: e.clientY, file });
                                            }
                                        }}
                                    >
                                        {/* Category tag */}
                                        {target && (
                                            <span className="do-file-category-tag" style={{ background: target.color }}>
                                                {target.name}
                                            </span>
                                        )}

                                        {/* Folder target badge */}
                                        {isAlreadyTarget && (
                                            <span className="do-file-category-tag" style={{ background: '#27ae60' }}>
                                                ✓ 目标
                                            </span>
                                        )}

                                        {/* Checkbox (files only) */}
                                        {!isFolder && (
                                            <div className="do-file-checkbox">
                                                {isSelected && <Check size={14} />}
                                            </div>
                                        )}

                                        {/* Thumbnail */}
                                        {isFolder ? (
                                            <div className="do-file-thumb-placeholder" style={{ color: isAlreadyTarget ? '#27ae60' : '#f39c12' }}>
                                                <Folder size={32} />
                                            </div>
                                        ) : (isImage || isVideo) ? (
                                            <img
                                                className="do-file-thumb"
                                                src={getThumbnailUrl(file.id)}
                                                alt={file.name}
                                                loading="lazy"
                                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                        ) : (
                                            <div className="do-file-thumb-placeholder">
                                                {FILE_TYPE_ICONS[cat] || FILE_TYPE_ICONS.other}
                                            </div>
                                        )}

                                        {/* Info */}
                                        <div className="do-file-info">
                                            <div className="do-file-name" title={file.name}>{file.name}</div>
                                            <div className="do-file-meta">
                                                {isFolder ? '文件夹' : <>                                                    {file.folderPath && <>{file.folderPath} · </>}
                                                    {formatFileSize(file.size)}
                                                </>}
                                            </div>
                                        </div>

                                        {/* Quick action: set as target (for folders) */}
                                        {isFolder && !isAlreadyTarget && (
                                            <button
                                                className="do-folder-set-target-btn"
                                                onClick={e => { e.stopPropagation(); handleSetAsTarget(file); }}
                                                title="设为目标文件夹"
                                            >
                                                <Plus size={12} /> 设为目标
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Bottom action bar ── */}
            {(selectedIds.size > 0 || Object.keys(classMap).length > 0) && files.length > 0 && (
                <div className="do-action-bar">
                    {selectedIds.size > 0 && (
                        <>
                            <div className="do-action-bar-info">
                                <CheckSquare size={16} />
                                已选 {selectedIds.size} 个文件
                            </div>
                            <div className="do-action-targets">
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>移到：</span>
                                {targets.map((t, idx) => (
                                    <button
                                        key={t.id}
                                        className="do-action-target-btn"
                                        onClick={() => classifyFiles(Array.from(selectedIds), t.id)}
                                        title={`快捷键: ${idx + 1}`}
                                    >
                                        <div className="do-target-color" style={{ background: t.color }} />
                                        {t.name}
                                        <span className="do-kbd">{idx + 1}</span>
                                    </button>
                                ))}
                                {classMap[Array.from(selectedIds)[0]] && (
                                    <button
                                        className="do-action-target-btn"
                                        onClick={() => unclassifyFiles(Array.from(selectedIds))}
                                        style={{ borderColor: 'rgba(231,76,60,0.3)' }}
                                    >
                                        <X size={12} /> 取消分类
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                    <div className="do-action-spacer" />
                    {Object.keys(classMap).length > 0 && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 8 }}>
                            已分类 {Object.keys(classMap).filter(k => files.some(f => f.id === k)).length} / {files.length} 个文件
                        </span>
                    )}
                    {Object.keys(classMap).length > 0 && (
                        <button
                            className="do-btn"
                            onClick={() => { setClassMap({}); }}
                            style={{ fontSize: 12 }}
                        >
                            <Trash2 size={12} /> 清空分类
                        </button>
                    )}
                    {Object.keys(classMap).length > 0 && (
                        <button
                            className="do-btn do-btn-success"
                            onClick={() => setShowMoveConfirm(true)}
                            disabled={moving}
                            style={{ fontSize: 13, fontWeight: 600 }}
                        >
                            <Move size={14} /> 执行移动
                        </button>
                    )}
                </div>
            )}

            {/* ── Move confirmation modal ── */}
            {showMoveConfirm && (
                <div className="do-modal-overlay" onClick={() => setShowMoveConfirm(false)}>
                    <div className="do-modal" onClick={e => e.stopPropagation()}>
                        <h3>⚠️ 确认移动文件</h3>
                        <p>
                            即将移动 <strong>{Object.keys(classMap).filter(k => {
                                const tid = classMap[k];
                                const target = targets.find(t => t.id === tid);
                                return target && target.folderId && files.some(f => f.id === k);
                            }).length}</strong> 个文件到对应的目标文件夹。
                            此操作会将文件从原位置移走，请确认分类无误。
                        </p>
                        {targets.filter(t => t.folderId && targetCounts[t.id]).map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 }}>
                                <div className="do-target-color" style={{ background: t.color }} />
                                <span>{t.name}</span>
                                <span style={{ opacity: 0.5 }}>→</span>
                                <span style={{ fontSize: 11, opacity: 0.6 }}>{t.folderId.slice(0, 16)}...</span>
                                <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{targetCounts[t.id]} 个</span>
                            </div>
                        ))}
                        {targets.some(t => !t.folderId && targetCounts[t.id]) && (
                            <p style={{ color: '#e67e22', fontSize: 12 }}>
                                ⚠ 部分目标文件夹未绑定 Drive 链接，相关文件将被跳过。
                            </p>
                        )}
                        <div className="do-modal-actions">
                            <button className="do-btn" onClick={() => setShowMoveConfirm(false)}>取消</button>
                            <button className="do-btn do-btn-success" onClick={handleExecuteMove}>确认移动</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Move log modal ── */}
            {!moving && moveLog.length > 0 && (
                <div className="do-modal-overlay" onClick={() => setMoveLog([])}>
                    <div className="do-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '60vh', overflow: 'auto' }}>
                        <h3>移动完成</h3>
                        <p>成功 {moveProgress.done - moveProgress.failed} / {moveProgress.total}，失败 {moveProgress.failed}</p>
                        <div style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, lineHeight: 1.8 }}>
                            {moveLog.map((line, i) => <div key={i}>{line}</div>)}
                        </div>
                        <div className="do-modal-actions" style={{ marginTop: 12 }}>
                            <button className="do-btn do-btn-primary" onClick={() => setMoveLog([])}>关闭</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Right-click context menu for folders ── */}
            {contextMenu && (
                <div
                    className="do-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={e => e.stopPropagation()}
                >
                    {targets.some(t => t.folderId === contextMenu.file.id) ? (
                        <button className="do-context-menu-item" style={{ opacity: 0.5, cursor: 'default' }}>
                            <Check size={14} /> 已是目标文件夹
                        </button>
                    ) : (
                        <button className="do-context-menu-item" onClick={() => handleSetAsTarget(contextMenu.file)}>
                            <Plus size={14} /> 设为目标文件夹
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default DriveOrganizerApp;
