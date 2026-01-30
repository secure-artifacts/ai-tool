/**
 * CloudSyncPanel - 云同步管理面板组件（简化版）
 * 
 * 改进：自动使用登录用户的邮箱，无需单独输入
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
    getSavedSyncEmail,
    saveSyncEmail,
    getSyncState,
    SyncStatus,
    pullFromCloud,
    pushToCloud,
    extractSyncableData,
    mergeCloudDataToImages,
} from '@/services/cloudSyncService';
import './CloudSyncPanel.css';

interface CloudSyncPanelProps {
    onClose: () => void;
    images: any[];
    onImagesUpdate: (images: any[]) => void;
    onSyncStatusChange?: (status: SyncStatus) => void;
    onShowLogin?: () => void;
}

const CloudSyncPanel: React.FC<CloudSyncPanelProps> = ({
    onClose,
    images,
    onImagesUpdate,
    onSyncStatusChange,
    onShowLogin
}) => {
    const { user } = useAuth();
    const [status, setStatus] = useState<SyncStatus>('idle');
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cloudImageCount, setCloudImageCount] = useState<number | null>(null);

    // 同步邮箱：优先使用登录邮箱
    const syncEmail = user?.email?.toLowerCase() || getSavedSyncEmail() || '';
    const isConnected = !!syncEmail;

    // 登录时自动保存同步邮箱
    useEffect(() => {
        if (user?.email) {
            saveSyncEmail(user.email);
        }
    }, [user?.email]);

    // 监听同步状态事件
    useEffect(() => {
        const handleSyncStatus = (e: CustomEvent) => {
            const detail = e.detail;
            if (detail.status) {
                setStatus(detail.status);
                onSyncStatusChange?.(detail.status);
            }
            if (detail.lastSyncAt) {
                setLastSyncAt(detail.lastSyncAt);
            }
            if (detail.error) {
                setError(detail.error);
            }
        };

        window.addEventListener('cloudSyncStatus', handleSyncStatus as EventListener);
        return () => {
            window.removeEventListener('cloudSyncStatus', handleSyncStatus as EventListener);
        };
    }, [onSyncStatusChange]);

    // 加载初始状态
    useEffect(() => {
        const state = getSyncState();
        if (state.lastSyncAt) {
            setLastSyncAt(state.lastSyncAt);
        }
    }, []);

    // 自动同步（首次打开时）
    useEffect(() => {
        if (isConnected && syncEmail) {
            handleSync();
        }
    }, []);

    // 同步数据
    const handleSync = useCallback(async () => {
        if (!syncEmail) return;

        setStatus('syncing');
        setError(null);

        try {
            // 尝试拉取云端数据
            const cloudData = await pullFromCloud(syncEmail);

            if (cloudData && cloudData.images && cloudData.images.length > 0) {
                setCloudImageCount(cloudData.images.length);

                // 合并数据
                const mergedImages = mergeCloudDataToImages(images, cloudData.images);
                onImagesUpdate(mergedImages);

                setStatus('success');
                setLastSyncAt(Date.now());
            } else {
                // 云端无数据，推送本地数据
                if (images.length > 0) {
                    await pushToCloud(syncEmail, {
                        images: extractSyncableData(images)
                    });
                }
                setCloudImageCount(images.length);
                setStatus('success');
                setLastSyncAt(Date.now());
            }
        } catch (err: any) {
            console.error('[CloudSyncPanel] 同步失败:', err);
            setError(err.message || '同步失败');
            setStatus('error');
        }
    }, [syncEmail, images, onImagesUpdate]);

    // 手动推送
    const handlePush = useCallback(async () => {
        if (!syncEmail) return;

        setStatus('syncing');
        setError(null);

        try {
            await pushToCloud(syncEmail, {
                images: extractSyncableData(images)
            });
            setCloudImageCount(images.length);
            setStatus('success');
            setLastSyncAt(Date.now());
        } catch (err: any) {
            setError(err.message || '推送失败');
            setStatus('error');
        }
    }, [syncEmail, images]);

    // 手动拉取
    const handlePull = useCallback(async () => {
        if (!syncEmail) return;

        setStatus('syncing');
        setError(null);

        try {
            const cloudData = await pullFromCloud(syncEmail);

            if (cloudData && cloudData.images && cloudData.images.length > 0) {
                setCloudImageCount(cloudData.images.length);
                const mergedImages = mergeCloudDataToImages(images, cloudData.images);
                onImagesUpdate(mergedImages);
                setStatus('success');
                setLastSyncAt(Date.now());
            } else {
                setCloudImageCount(0);
                setStatus('success');
            }
        } catch (err: any) {
            setError(err.message || '拉取失败');
            setStatus('error');
        }
    }, [syncEmail, images, onImagesUpdate]);

    const formatTime = (timestamp: number | null) => {
        if (!timestamp) return '从未';
        const date = new Date(timestamp);
        return date.toLocaleString();
    };

    const getStatusIcon = () => {
        switch (status) {
            case 'syncing': return '🔄';
            case 'success': return '✅';
            case 'error': return '❌';
            default: return '☁️';
        }
    };

    return (
        <div className="cloud-sync-panel">
            {/* 标题栏 */}
            <div className="cloud-sync-header">
                <h3 className="cloud-sync-title">
                    {getStatusIcon()} 云同步
                </h3>
                <button onClick={onClose} className="cloud-sync-close-btn">
                    ×
                </button>
            </div>

            {/* 未登录提示 */}
            {!user && (
                <div className="cloud-sync-login-prompt">
                    <p>请先登录以启用云同步</p>
                    <button
                        onClick={() => { onClose(); onShowLogin?.(); }}
                        className="cloud-sync-login-btn"
                    >
                        登录
                    </button>
                </div>
            )}

            {/* 已登录状态 */}
            {user && (
                <>
                    {/* 用户信息 */}
                    <div className="cloud-sync-user-card">
                        <div className="flex items-center gap-2">
                            <span className="cloud-sync-user-icon">👤</span>
                            <div>
                                <div className="cloud-sync-user-label">同步账号</div>
                                <div className="cloud-sync-user-email">{syncEmail}</div>
                            </div>
                        </div>
                    </div>

                    {/* 同步状态 */}
                    <div className="cloud-sync-status-card">
                        <div className="cloud-sync-status-row">
                            <span className="cloud-sync-status-label">本地数据</span>
                            <span className="cloud-sync-status-value">{images.length} 条</span>
                        </div>
                        <div className="cloud-sync-status-row">
                            <span className="cloud-sync-status-label">云端数据</span>
                            <span className="cloud-sync-status-value">
                                {cloudImageCount !== null ? `${cloudImageCount} 条` : '未知'}
                            </span>
                        </div>
                        <div className="cloud-sync-status-row">
                            <span className="cloud-sync-status-label">上次同步</span>
                            <span className="cloud-sync-status-value">{formatTime(lastSyncAt)}</span>
                        </div>
                    </div>

                    {/* 错误提示 */}
                    {error && (
                        <div className="cloud-sync-error">
                            ❌ {error}
                        </div>
                    )}

                    {/* 操作按钮 */}
                    <div className="cloud-sync-actions">
                        <button
                            onClick={handlePull}
                            disabled={status === 'syncing'}
                            className="cloud-sync-btn cloud-sync-btn-secondary"
                        >
                            ⬇️ 拉取
                        </button>
                        <button
                            onClick={handlePush}
                            disabled={status === 'syncing'}
                            className="cloud-sync-btn cloud-sync-btn-secondary"
                        >
                            ⬆️ 推送
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={status === 'syncing'}
                            className="cloud-sync-btn cloud-sync-btn-primary"
                        >
                            {status === 'syncing' ? '同步中...' : '🔄 同步'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

export default CloudSyncPanel;
