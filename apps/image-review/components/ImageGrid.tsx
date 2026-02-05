/**
 * 图片网格组件 - 显示待审核图片列表
 */
import React, { useCallback } from 'react';
import { Check, X, Edit3, Ban, Clock, Trash2, FolderPlus } from 'lucide-react';
import { ImageReview, ReviewStatus, REVIEW_STATUS_CONFIG } from '../types';

interface ImageGridProps {
    images: ImageReview[];
    selectedIds: string[];
    activeImageId: string | null;
    onSelect: (id: string, multiSelect?: boolean) => void;
    onActivate: (id: string) => void;
    onDelete: (ids: string[]) => void;
    onCreateGroup: (ids: string[]) => void;
}

// 状态图标映射
const StatusIcon: React.FC<{ status: ReviewStatus; size?: number }> = ({ status, size = 14 }) => {
    switch (status) {
        case 'approved': return <Check size={size} className="text-emerald-400" />;
        case 'revision': return <Edit3 size={size} className="text-amber-400" />;
        case 'rejected': return <X size={size} className="text-red-400" />;
        default: return <Clock size={size} className="text-zinc-400" />;
    }
};

const ImageGrid: React.FC<ImageGridProps> = ({
    images,
    selectedIds,
    activeImageId,
    onSelect,
    onActivate,
    onDelete,
    onCreateGroup,
}) => {
    // 处理点击
    const handleClick = useCallback((e: React.MouseEvent, id: string) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
            // 多选
            onSelect(id, true);
        } else {
            // 单选并激活
            onSelect(id, false);
            onActivate(id);
        }
    }, [onSelect, onActivate]);

    // 处理双击
    const handleDoubleClick = useCallback((id: string) => {
        onActivate(id);
    }, [onActivate]);

    if (images.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-zinc-500">
                <div className="text-center">
                    <p className="text-lg mb-2">暂无图片</p>
                    <p className="text-sm">拖拽或粘贴图片到此处</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-4">
            {/* 批量操作栏 */}
            {selectedIds.length > 1 && (
                <div className="mb-4 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50 flex items-center justify-between">
                    <span className="text-sm text-zinc-300">
                        已选择 <span className="text-teal-400 font-medium">{selectedIds.length}</span> 张图片
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onCreateGroup(selectedIds)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm transition-colors"
                        >
                            <FolderPlus size={14} />
                            创建组
                        </button>
                        <button
                            onClick={() => onDelete(selectedIds)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 rounded-lg text-sm transition-colors"
                        >
                            <Trash2 size={14} />
                            删除
                        </button>
                    </div>
                </div>
            )}

            {/* 图片网格 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {images.map(image => {
                    const isSelected = selectedIds.includes(image.id);
                    const isActive = activeImageId === image.id;
                    const config = REVIEW_STATUS_CONFIG[image.status];

                    return (
                        <div
                            key={image.id}
                            onClick={(e) => handleClick(e, image.id)}
                            onDoubleClick={() => handleDoubleClick(image.id)}
                            className={`
                                relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all
                                ${isActive
                                    ? 'border-teal-500 ring-2 ring-teal-500/30'
                                    : isSelected
                                        ? 'border-blue-500'
                                        : 'border-transparent hover:border-zinc-600'
                                }
                            `}
                        >
                            {/* 图片 */}
                            <div className="aspect-square bg-zinc-800">
                                <img
                                    src={image.imageUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            </div>

                            {/* 状态角标 */}
                            <div className={`
                                absolute top-2 left-2 px-1.5 py-0.5 rounded-md flex items-center gap-1
                                bg-${config.color}-900/80 border border-${config.color}-600/50
                            `}
                                style={{
                                    backgroundColor: image.status === 'pending' ? 'rgba(63, 63, 70, 0.8)' :
                                        image.status === 'approved' ? 'rgba(6, 78, 59, 0.8)' :
                                            image.status === 'rejected' ? 'rgba(127, 29, 29, 0.8)' :
                                                image.status === 'revision' ? 'rgba(120, 53, 15, 0.8)' :
                                                    'rgba(51, 65, 85, 0.8)'
                                }}
                            >
                                <StatusIcon status={image.status} size={12} />
                                <span className="text-[10px] text-white">{config.label}</span>
                            </div>

                            {/* 选中指示器 */}
                            {isSelected && (
                                <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                                    <Check size={12} className="text-white" />
                                </div>
                            )}

                            {/* 反馈预览 */}
                            {image.feedbackItems.length > 0 && (
                                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                                    <p className="text-xs text-white line-clamp-2">
                                        {image.feedbackItems[0].problemCn || image.feedbackItems[0].suggestionCn}
                                        {image.feedbackItems.length > 1 && ` (+${image.feedbackItems.length - 1})`}
                                    </p>
                                </div>
                            )}

                            {/* 标注指示 */}
                            {image.annotations.length > 0 && !selectedIds.includes(image.id) && (
                                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-purple-600/80 rounded text-[10px] text-white">
                                    {image.annotations.length} 标注
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ImageGrid;
