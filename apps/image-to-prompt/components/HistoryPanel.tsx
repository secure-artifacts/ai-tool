/**
 * History Panel Component
 * 会话历史面板
 */

import React from 'react';
import { Trash2 } from 'lucide-react';
import { Session } from '../types';

interface HistoryPanelProps {
    sessions: Session[];
    activeSessionId: string | null;
    onSelectSession: (sessionId: string) => void;
    onDeleteSession: (sessionId: string) => void;
    onNewSession: () => void;
    t: (key: string) => string;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
    sessions,
    activeSessionId,
    onSelectSession,
    onDeleteSession,
    onNewSession,
    t
}) => {
    return (
        <aside className="history-panel">
            <button className="new-session-btn" onClick={onNewSession}>
                {t('newSession') || '+ 新建会话'}
            </button>
            <div className="history-list">
                {sessions.map(session => (
                    <div
                        key={session.id}
                        className={`history-item ${session.id === activeSessionId ? 'active' : ''}`}
                        onClick={() => onSelectSession(session.id)}
                        aria-current={session.id === activeSessionId}
                    >
                        {session.images && session.images.length > 0 && (
                            <img
                                src={session.images[0].imageData.url}
                                alt="History thumbnail"
                            />
                        )}
                        <div className="history-item-info">
                            <span>{new Date(parseInt(session.id)).toLocaleString()}</span>
                            <span className="history-item-expert">
                                {session.experts.join(', ')}
                            </span>
                        </div>
                        <button
                            className="delete-session-btn tooltip-bottom"
                            onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                            data-tip={t('deleteSession') || '删除会话'}
                        >
                            &times;
                        </button>
                    </div>
                ))}
                {sessions.length === 0 && (
                    <div style={{
                        padding: '20px',
                        textAlign: 'center',
                        color: 'var(--text-muted-color)',
                        fontSize: '0.9rem'
                    }}>
                        {t('noSessions') || '暂无历史会话'}
                    </div>
                )}
            </div>
        </aside>
    );
};

export default HistoryPanel;
