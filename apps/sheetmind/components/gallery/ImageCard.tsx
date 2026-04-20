import React, { memo } from 'react';
import { Check, Info, ExternalLink, Star } from 'lucide-react';
import { DataRow } from '../../types';

export interface ImageCardProps {
    row: DataRow;
    imageUrl: string;
    rowId: string;
    size: number;
    showMeta: boolean;
    compact: boolean;
    isSelected: boolean;
    favorited: boolean;
    selectMode: boolean;
    highlight: { color: string; borderWidth: number } | null;
    labels: string[];
    account: string;
    link: string;
    showLabelOverlay: boolean;
    thumbnailFit: 'cover' | 'contain';
    // Callbacks
    onSelect: (rowId: string) => void;
    onToggleSelect: (rowId: string) => void;
    onDoubleClick: (e: React.MouseEvent, rowId: string, link: string) => void;
    onToggleFavorite: (url: string, row: DataRow) => void;
    onViewDetail: (row: DataRow) => void;
    onOpenLink: (link: string) => void;
    onContextMenu?: (e: React.MouseEvent, row: DataRow, url: string) => void;
    onDragStart?: (e: React.DragEvent, row: DataRow, imageUrl: string) => void;
}

export const ImageCard = memo(function ImageCard({
    row,
    imageUrl,
    rowId,
    size,
    showMeta,
    compact,
    isSelected,
    favorited,
    selectMode,
    highlight,
    labels,
    account,
    link,
    showLabelOverlay,
    thumbnailFit,
    onSelect,
    onToggleSelect,
    onDoubleClick,
    onToggleFavorite,
    onViewDetail,
    onOpenLink,
    onContextMenu,
    onDragStart,
}: ImageCardProps) {
    const buttonSize = compact ? 12 : 16;
    const buttonPadding = compact ? 'p-1' : 'p-2';
    const overlayGap = compact ? 'gap-1' : 'gap-2';
    const title = !showMeta ? [account, ...labels].filter(Boolean).join(' · ') : '';

    return (
        <div
            className="relative group"
            style={{ width: size }}
            title={title || undefined}
            draggable={!selectMode}
            onClick={(e) => {
                if (!selectMode) return;
                if ((e.target as HTMLElement).closest('button')) return;
                onSelect(rowId);
            }}
            onDoubleClick={(e) => onDoubleClick(e, rowId, link)}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, row, imageUrl) : undefined}
            onDragStart={onDragStart ? (e) => onDragStart(e, row, imageUrl) : undefined}
        >
            <div
                className={`relative overflow-hidden rounded-lg bg-slate-50 transition-all ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                style={{
                    height: size,
                    border: isSelected ? '2px solid #3b82f6' : (highlight ? `${highlight.borderWidth}px solid ${highlight.color}` : '1px solid #e2e8f0'),
                    boxShadow: highlight ? `0 0 ${highlight.borderWidth * 2}px ${highlight.color}80` : 'none'
                }}
            >
                <img
                    src={imageUrl}
                    alt=""
                    className={`w-full h-full cursor-pointer`}
                    style={{ objectFit: thumbnailFit }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />

                {/* Selection checkbox - clickable in select mode */}
                {selectMode && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleSelect(rowId); }}
                        className={`absolute top-1 left-1 z-20 w-6 h-6 rounded border-2 flex items-center justify-center transition-all cursor-pointer hover:scale-110 ${isSelected
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'bg-white/90 border-slate-400 hover:border-blue-400'
                            }`}
                    >
                        {isSelected && <Check size={14} />}
                    </button>
                )}

                {/* Highlight badge - only show when not in select mode */}
                {!selectMode && highlight && (
                    <div
                        className="absolute top-1 left-1 w-3 h-3 rounded-full"
                        style={{ backgroundColor: highlight.color }}
                    />
                )}

                {/* Favorite button - visible on hover, stays above overlay (hidden in select mode) */}
                {!selectMode && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(imageUrl, row);
                        }}
                        className={`absolute top-1 right-1 p-1 rounded-full transition-all z-10 ${favorited
                            ? 'bg-amber-400 text-white opacity-100'
                            : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-amber-400'
                            }`}
                        title={favorited ? '取消收藏' : '添加收藏'}
                    >
                        <Star size={compact ? 10 : 12} fill={favorited ? 'currentColor' : 'none'} />
                    </button>
                )}

                {/* Hover overlay - hidden in select mode */}
                {!selectMode && (
                    <div className={`absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${overlayGap}`}>
                        <button
                            onClick={(e) => { e.stopPropagation(); onViewDetail(row); }}
                            className={`${buttonPadding} bg-white/20 rounded-full hover:bg-white/40 tooltip-bottom`}
                            data-tip="查看详情"
                        >
                            <Info size={buttonSize} className="text-white" />
                        </button>
                        {link && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onOpenLink(link); }}
                                className={`${buttonPadding} bg-white/20 rounded-full hover:bg-white/40 tooltip-bottom`}
                                data-tip="打开链接"
                            >
                                <ExternalLink size={buttonSize} className="text-white" />
                            </button>
                        )}
                    </div>
                )}
                {labels.length > 0 && (
                    <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 rounded-b-lg transition-opacity ${showLabelOverlay ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <div className="text-[11px] text-white truncate">
                            {labels.join(' · ')}
                        </div>
                    </div>
                )}
            </div>

            {/* Info overlay */}
            {showMeta && (
                <div className="mt-1 space-y-0.5">
                    {account && (
                        <div className="text-[9px] text-slate-600 truncate">👤 {account}</div>
                    )}
                    {labels.slice(0, 2).map((label, i) => (
                        <div key={i} className="text-[11px] text-slate-400 truncate">{label}</div>
                    ))}
                </div>
            )}
        </div>
    );
}, (prev, next) => {
    // Custom comparator: only re-render when these specific props change
    return prev.imageUrl === next.imageUrl
        && prev.rowId === next.rowId
        && prev.size === next.size
        && prev.isSelected === next.isSelected
        && prev.favorited === next.favorited
        && prev.selectMode === next.selectMode
        && prev.highlight === next.highlight
        && prev.showMeta === next.showMeta
        && prev.compact === next.compact
        && prev.showLabelOverlay === next.showLabelOverlay
        && prev.thumbnailFit === next.thumbnailFit
        && prev.account === next.account
        && prev.link === next.link
        && prev.labels.length === next.labels.length;
});
