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
        <div className="cloud-sync-panel" style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'var(--surface-color)',
            borderRadius: '12px',
            padding: '1.5rem',
            minWidth: '320px',
            maxWidth: '400px',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
            zIndex: 10001
        }}>
            {/* 标题栏 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--on-surface-color)' }}>
                    {getStatusIcon()} 云同步
                </h3>
                <button
                    onClick={onClose}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: '1.2rem',
                        cursor: 'pointer',
                        color: 'var(--on-surface-color)',
                        opacity: 0.6
                    }}
                >
                    ×
                </button>
            </div>

            {/* 未登录提示 */}
            {!user && (
                <div style={{
                    padding: '1rem',
                    backgroundColor: 'rgba(255, 193, 7, 0.1)',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    textAlign: 'center'
                }}>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--on-surface-color)' }}>
                        请先登录以启用云同步
                    </p>
                    <button
                        onClick={() => { onClose(); onShowLogin?.(); }}
                        style={{
                            marginTop: '0.75rem',
                            padding: '0.5rem 1rem',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: 'var(--primary-color)',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '0.9rem'
                        }}
                    >
                        登录
                    </button>
                </div>
            )}

            {/* 已登录状态 */}
            {user && (
                <>
                    {/* 用户信息 */}
                    <div style={{
                        padding: '0.75rem',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        borderRadius: '8px',
                        marginBottom: '1rem'
                    }}>
                        <div className="flex items-center gap-2">
                            <span style={{ fontSize: '1.2rem' }}>👤</span>
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted-color)' }}>同步账号</div>
                                <div style={{ fontSize: '0.9rem', color: 'var(--on-surface-color)', fontWeight: 500 }}>
                                    {syncEmail}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 同步状态 */}
                    <div style={{
                        padding: '0.75rem',
                        backgroundColor: 'var(--background-color)',
                        borderRadius: '8px',
                        marginBottom: '1rem'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                            <span style={{ color: 'var(--text-muted-color)' }}>本地数据</span>
                            <span style={{ color: 'var(--on-surface-color)' }}>{images.length} 条</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                            <span style={{ color: 'var(--text-muted-color)' }}>云端数据</span>
                            <span style={{ color: 'var(--on-surface-color)' }}>
                                {cloudImageCount !== null ? `${cloudImageCount} 条` : '未知'}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                            <span style={{ color: 'var(--text-muted-color)' }}>上次同步</span>
                            <span style={{ color: 'var(--on-surface-color)' }}>{formatTime(lastSyncAt)}</span>
                        </div>
                    </div>

                    {/* 错误提示 */}
                    {error && (
                        <div style={{
                            padding: '0.5rem',
                            backgroundColor: 'rgba(244, 67, 54, 0.1)',
                            borderRadius: '6px',
                            marginBottom: '1rem',
                            fontSize: '0.8rem',
                            color: '#f44336'
                        }}>
                            ❌ {error}
                        </div>
                    )}

                    {/* 操作按钮 */}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={handlePull}
                            disabled={status === 'syncing'}
                            style={{
                                flex: 1,
                                padding: '0.6rem',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'transparent',
                                color: 'var(--on-surface-color)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                opacity: status === 'syncing' ? 0.6 : 1
                            }}
                        >
                            ⬇️ 拉取
                        </button>
                        <button
                            onClick={handlePush}
                            disabled={status === 'syncing'}
                            style={{
                                flex: 1,
                                padding: '0.6rem',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'transparent',
                                color: 'var(--on-surface-color)',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                opacity: status === 'syncing' ? 0.6 : 1
                            }}
                        >
                            ⬆️ 推送
                        </button>
                        <button
                            onClick={handleSync}
                            disabled={status === 'syncing'}
                            style={{
                                flex: 1,
                                padding: '0.6rem',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: 'var(--primary-color)',
                                color: 'white',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                opacity: status === 'syncing' ? 0.6 : 1
                            }}
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
