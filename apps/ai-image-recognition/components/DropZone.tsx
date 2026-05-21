import React, { useCallback, useState, useEffect } from 'react';
import { Link as LinkIcon, FileUp, Upload, X, ImagePlus, FolderOpen } from 'lucide-react';
import { extractUrlsFromHtml } from '../utils';

interface DropZoneProps {
    onFilesDropped: (files: File[]) => void;
    onTextPasted: (text: string) => void;
    onHtmlPasted?: (urls: { originalUrl: string; fetchUrl: string }[]) => void;
    extraContent?: React.ReactNode;
    compact?: boolean;
    hideOverlay?: boolean; // 隐藏全局拖拽覆盖层（创新模式下使用卡片级拖拽）
}

const DropZone: React.FC<DropZoneProps> = ({ onFilesDropped, onTextPasted, onHtmlPasted, extraContent, compact, hideOverlay }) => {
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [textInput, setTextInput] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [dragCounter, setDragCounter] = useState(0);

    // Global drag and drop handlers
    useEffect(() => {
        const handleDragEnter = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragCounter(prev => prev + 1);
            if (e.dataTransfer?.types.includes('Files')) {
                setIsDragging(true);
            }
        };

        const handleDragLeave = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragCounter(prev => {
                const newCount = prev - 1;
                if (newCount === 0) {
                    setIsDragging(false);
                }
                return newCount;
            });
        };

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };

        // 递归遍历文件夹获取所有图片文件
        const traverseFileTree = (entry: FileSystemEntry): Promise<File[]> => {
            return new Promise((resolve) => {
                if (entry.isFile) {
                    (entry as FileSystemFileEntry).file((file) => {
                        if (file.type.startsWith('image/')) {
                            resolve([file]);
                        } else {
                            resolve([]);
                        }
                    }, () => resolve([]));
                } else if (entry.isDirectory) {
                    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
                    const allFiles: File[] = [];
                    const readEntries = () => {
                        dirReader.readEntries(async (entries) => {
                            if (entries.length === 0) {
                                resolve(allFiles);
                            } else {
                                for (const childEntry of entries) {
                                    const files = await traverseFileTree(childEntry);
                                    allFiles.push(...files);
                                }
                                readEntries(); // 继续读取（浏览器可能分批返回）
                            }
                        }, () => resolve(allFiles));
                    };
                    readEntries();
                } else {
                    resolve([]);
                }
            });
        };

        const handleDrop = async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
            setDragCounter(0);

            // 优先使用 webkitGetAsEntry 以支持文件夹拖拽
            const items = e.dataTransfer?.items;
            if (items && items.length > 0) {
                const allImageFiles: File[] = [];
                const entries: FileSystemEntry[] = [];
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry?.();
                    if (entry) entries.push(entry);
                }
                if (entries.length > 0) {
                    for (const entry of entries) {
                        const files = await traverseFileTree(entry);
                        allImageFiles.push(...files);
                    }
                    if (allImageFiles.length > 0) {
                        onFilesDropped(allImageFiles);
                    }
                    return;
                }
            }

            // 回退：普通文件拖拽
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                const imageFiles = Array.from(e.dataTransfer.files).filter(file =>
                    file.type.startsWith('image/')
                );
                if (imageFiles.length > 0) {
                    onFilesDropped(imageFiles);
                }
            }
        };

        // Add listeners to document for global drag and drop
        document.addEventListener('dragenter', handleDragEnter);
        document.addEventListener('dragleave', handleDragLeave);
        document.addEventListener('dragover', handleDragOver);
        document.addEventListener('drop', handleDrop);

        return () => {
            document.removeEventListener('dragenter', handleDragEnter);
            document.removeEventListener('dragleave', handleDragLeave);
            document.removeEventListener('dragover', handleDragOver);
            document.removeEventListener('drop', handleDrop);
        };
    }, [onFilesDropped]);

    const triggerFileSelect = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.onchange = (e: any) => {
            if (e.target.files?.length) {
                onFilesDropped(Array.from(e.target.files));
            }
        };
        input.click();
    };

    const triggerFolderSelect = () => {
        const input = document.createElement('input');
        input.type = 'file';
        (input as any).webkitdirectory = true;
        (input as any).directory = true;
        input.multiple = true;
        input.onchange = (e: any) => {
            if (e.target.files?.length) {
                const imageFiles = Array.from(e.target.files as FileList).filter((file: File) =>
                    file.type.startsWith('image/')
                );
                if (imageFiles.length > 0) {
                    onFilesDropped(imageFiles);
                }
            }
        };
        input.click();
    };

    const handleAddLinks = () => {
        if (!textInput.trim()) return;

        // 优先检查是否有 =IMAGE() 公式
        // 从 Google Sheets 复制单元格时，纯文本中的 URL 才是原始可用的 URL
        if (textInput.includes('=IMAGE')) {
            onTextPasted(textInput);
            setTextInput('');
            setShowLinkModal(false);
            return;
        }

        // Handle HTML paste if applicable
        const hasImages = /<img[^>]+src=["'][^"']+["'][^>]*>/i.test(textInput);

        if (hasImages && onHtmlPasted) {
            const urls = extractUrlsFromHtml(textInput);
            if (urls.length > 0) {
                onHtmlPasted(urls);
                setTextInput('');
                setShowLinkModal(false);
                return;
            }
        }

        onTextPasted(textInput);
        setTextInput('');
        setShowLinkModal(false);
    };

    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <>
            {/* 紧凑按钮组 */}
            <div className={`flex items-start gap-2 ${compact ? 'items-center' : ''}`} ref={dropdownRef}>
                <div className="relative">
                    <button
                        onClick={() => setShowDropdown(!showDropdown)}
                        className={`flex items-center justify-center gap-1.5 tooltip-bottom ${compact ? 'w-8 h-8 p-0' : 'px-3 py-1.5'} bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 rounded-lg text-xs font-medium transition-colors h-8`}
                        data-tip="添加图片"
                    >
                        <ImagePlus size={16} />
                        {!compact && "添加图片"}
                    </button>

                    {showDropdown && (
                        <div className="absolute top-full mt-2 left-0 p-2 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-xl z-50 flex flex-col gap-2 min-w-[140px]">
                            <button
                                onClick={() => { setShowDropdown(false); triggerFileSelect(); }}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors text-left"
                            >
                                <Upload size={14} className="text-emerald-400" /> 上传本地图片
                            </button>
                            <button
                                onClick={() => { setShowDropdown(false); triggerFolderSelect(); }}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors text-left"
                            >
                                <FolderOpen size={14} className="text-amber-400" /> 上传文件夹
                            </button>
                            <button
                                onClick={() => { setShowDropdown(false); setShowLinkModal(true); }}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors text-left"
                            >
                                <LinkIcon size={14} className="text-blue-400" /> 粘贴链接/公式
                            </button>
                            <div className="border-t border-zinc-800 my-0.5"></div>
                            <div className="text-[10px] text-zinc-500 px-2 pb-1 text-center">
                                也支持直接拖拽/粘贴图片
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex relative items-center h-8">
                    {extraContent}
                </div>
            </div>

            {/* 全屏拖拽覆盖层 */}
            {isDragging && !hideOverlay && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center pointer-events-none">
                    <div className="border-4 border-dashed border-emerald-500 rounded-3xl p-16 bg-emerald-500/10">
                        <div className="flex flex-col items-center gap-4">
                            <ImagePlus size={64} className="text-emerald-400 animate-bounce" />
                            <p className="text-2xl font-bold text-white">释放以添加图片</p>
                            <p className="text-zinc-400">支持同时添加多张图片</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 链接输入模态框 */}
            {showLinkModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowLinkModal(false)}>
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 max-w-2xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <LinkIcon size={16} className="text-emerald-400" />
                                <h3 className="text-sm font-semibold text-white">批量添加图片链接</h3>
                            </div>
                            <button
                                onClick={() => setShowLinkModal(false)}
                                className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
                            >
                                <X size={16} className="text-zinc-500" />
                            </button>
                        </div>

                        <textarea
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.ctrlKey) {
                                    handleAddLinks();
                                }
                            }}
                            placeholder="粘贴图片链接、=IMAGE() 公式或表格单元格...&#10;支持多行批量添加&#10;&#10;示例：&#10;https://example.com/image.jpg&#10;=IMAGE(&quot;https://example.com/photo.png&quot;)"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none resize-none h-40 font-mono leading-relaxed"
                            autoFocus
                        />

                        <div className="flex items-center justify-between mt-3">
                            <div className="text-[0.625rem] text-zinc-600">
                                Ctrl+Enter 快速添加
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowLinkModal(false)}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleAddLinks}
                                    disabled={!textInput.trim()}
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    添加到队列
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default DropZone;
