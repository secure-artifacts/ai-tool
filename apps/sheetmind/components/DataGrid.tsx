import React, { useMemo, useState, useCallback, useEffect, useRef, memo, useDeferredValue } from 'react';
import { SheetData } from '../types';
import { extractImageFromFormula } from '../utils/parser';
import { Image, ExternalLink } from 'lucide-react';

interface DataGridProps {
  data: SheetData;
}

const DataGrid: React.FC<DataGridProps> = ({ data }) => {
  const [page, setPage] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [jumpToPage, setJumpToPage] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const rowsPerPage = 50;
  const rowHeight = 44;
  const overscan = 6;

  const totalPages = Math.ceil(data.rows.length / rowsPerPage);

  // Use deferred value for smoother transitions with large data
  const deferredPage = useDeferredValue(page);

  const currentRows = useMemo(() => {
    return data.rows.slice(deferredPage * rowsPerPage, (deferredPage + 1) * rowsPerPage);
  }, [data.rows, deferredPage, rowsPerPage]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateHeight = () => setViewportHeight(node.clientHeight);
    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(node);
      return () => observer.disconnect();
    }
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (node) node.scrollTop = 0;
    setScrollTop(0);
  }, [page, data.rows]);

  // Handle page jump
  const handlePageJump = useCallback(() => {
    const targetPage = parseInt(jumpToPage, 10);
    if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages) {
      setPage(targetPage - 1);
      setJumpToPage('');
    }
  }, [jumpToPage, totalPages]);

  // Helper to format dates
  const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Helper to detect if URL is an image (including Gyazo)
  const isImageUrl = (url: string): boolean => {
    const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i;
    const gyazoPattern = /^https?:\/\/(i\.)?gyazo\.com\//i;
    const imgurPattern = /^https?:\/\/(i\.)?imgur\.com\//i;
    const googleImagePattern = /googleusercontent\.com|drive\.google\.com/i;
    return imageExtensions.test(url) || gyazoPattern.test(url) || imgurPattern.test(url) || googleImagePattern.test(url);
  };

  const renderCellContent = (value: unknown, rowIndex: number, colIndex: number) => {
    // Handle Date objects
    if (value instanceof Date) {
      return <span className="text-slate-700">{formatDate(value)}</span>;
    }

    // Handle Excel date serial numbers (numbers between 1 and 99999 that aren't normal data)
    if (typeof value === 'number' && value > 25569 && value < 99999) {
      // Excel date serial: days since 1900-01-01 (with Excel bug for 1900)
      // 25569 = 1970-01-01, reasonable threshold for dates
      const excelEpoch = new Date(1899, 11, 30); // Excel epoch with bug correction
      const dateValue = new Date(excelEpoch.getTime() + value * 86400000);
      if (!isNaN(dateValue.getTime())) {
        return <span className="text-slate-700" title={`原始值: ${value}`}>{formatDate(dateValue)}</span>;
      }
    }

    const stringVal = String(value);
    const imageUrl = extractImageFromFormula(stringVal);
    const isImageFormula = /^=IMAGE\s*\(/i.test(stringVal);
    const cellKey = `${deferredPage}-${rowIndex}-${colIndex}`;

    if (imageUrl) {
      const showThumbnail = isImageFormula || isImageUrl(imageUrl);

      return (
        <div
          className="group relative inline-flex items-center gap-2"
          onMouseEnter={() => setHoveredCell(cellKey)}
          onMouseLeave={() => setHoveredCell(null)}
        >
          {showThumbnail ? (
            // Show thumbnail directly for image URLs
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              data-tip="点击在新窗口打开原图" className="tooltip-bottom"
            >
              <img
                src={`https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&w=80&h=80&fit=cover`}
                alt="缩略图"
                className="w-10 h-10 object-cover rounded border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  // Fallback to icon on error
                  (e.target as HTMLImageElement).style.display = 'none';
                  const parent = (e.target as HTMLImageElement).parentElement;
                  if (parent) {
                    parent.innerHTML = '<span class="text-blue-600 text-xs">[图片]</span>';
                  }
                }}
              />
            </a>
          ) : (
            // Show icon for non-image URLs with IMAGE formula
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800 cursor-pointer transition-colors"
              onClick={(e) => e.stopPropagation()}
              data-tip="点击在新窗口打开原图" className="tooltip-bottom"
            >
              <Image size={16} />
              <span className="text-xs truncate max-w-[100px] underline">图片链接</span>
            </a>
          )}
          {/* Hover Preview for larger view */}
          {hoveredCell === cellKey && (
            <div className="absolute z-50 bottom-full left-0 mb-2 p-1 bg-white border shadow-lg rounded-lg w-40 h-40 pointer-events-none">
              <img
                src={`https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&w=300`}
                alt="预览"
                className="w-full h-full object-cover rounded"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://placehold.co/100?text=无法加载";
                }}
              />
            </div>
          )}
        </div>
      );
    }

    // Detect generic image links (Gyazo, Imgur, etc.)
    if (stringVal.startsWith('http') && isImageUrl(stringVal)) {
      return (
        <div
          className="group relative inline-flex items-center gap-2"
          onMouseEnter={() => setHoveredCell(cellKey)}
          onMouseLeave={() => setHoveredCell(null)}
        >
          <a
            href={stringVal}
            target="_blank"
            rel="noopener noreferrer"
            className="block cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            data-tip="点击在新窗口打开原图" className="tooltip-bottom"
          >
            <img
              src={`https://images.weserv.nl/?url=${encodeURIComponent(stringVal)}&w=80&h=80&fit=cover`}
              alt="缩略图"
              className="w-10 h-10 object-cover rounded border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all"
              loading="lazy"
              decoding="async"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </a>
          {/* Hover Preview */}
          {hoveredCell === cellKey && (
            <div className="absolute z-50 bottom-full left-0 mb-2 p-1 bg-white border shadow-lg rounded-lg w-40 h-40 pointer-events-none">
              <img
                src={`https://images.weserv.nl/?url=${encodeURIComponent(stringVal)}&w=300`}
                alt="预览"
                className="w-full h-full object-cover rounded"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://placehold.co/100?text=无法加载";
                }}
              />
            </div>
          )}
        </div>
      );
    }

    // Detect generic links
    if (stringVal.startsWith('http')) {
      return (
        <a href={stringVal} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
          <span className="truncate max-w-[150px]">{stringVal}</span>
          <ExternalLink size={12} />
        </a>
      );
    }

    return <span className="truncate block max-w-[200px]" title={stringVal}>{stringVal}</span>;
  };

  const totalRows = currentRows.length;
  const canVirtualize = viewportHeight > 0 && totalRows > 0;
  const startIndex = canVirtualize ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan) : 0;
  const endIndex = canVirtualize
    ? Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)
    : totalRows;
  const visibleRows = currentRows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = (totalRows - endIndex) * rowHeight;

  const handleScroll = () => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const node = containerRef.current;
      if (node) setScrollTop(node.scrollTop);
    });
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
        <h3 className="font-semibold text-slate-700 flex items-center gap-2">
          <span className="bg-green-600 text-white text-xs px-2 py-1 rounded">表格</span>
          {data.fileName}
        </h3>
        <span className="text-xs text-slate-500">
          {data.rows.length} 行 • {data.columns.length} 列
        </span>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        <table className="w-full text-sm text-left text-slate-600">
          <thead className="text-xs text-slate-700 uppercase bg-slate-100 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 border-b border-slate-200 w-16 bg-slate-100">#</th>
              {data.columns.map((col, idx) => (
                <th key={idx} className="px-4 py-3 border-b border-slate-200 font-bold whitespace-nowrap bg-slate-100">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr style={{ height: topSpacerHeight }}>
                <td colSpan={data.columns.length + 1} />
              </tr>
            )}
            {visibleRows.map((row, rowIndex) => {
              const absoluteIndex = startIndex + rowIndex;
              return (
                <tr
                  key={`${deferredPage}-${absoluteIndex}`}
                  className="bg-white border-b hover:bg-slate-50 transition-colors"
                  style={{ height: rowHeight }}
                >
                  <td className="px-4 py-2 border-r border-slate-100 font-mono text-xs text-slate-400">
                    {deferredPage * rowsPerPage + absoluteIndex + 1}
                  </td>
                  {data.columns.map((col, colIndex) => (
                    <td key={colIndex} className="px-4 py-2 border-r border-slate-100 last:border-r-0">
                      {renderCellContent(row[col], absoluteIndex, colIndex)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {bottomSpacerHeight > 0 && (
              <tr style={{ height: bottomSpacerHeight }}>
                <td colSpan={data.columns.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination - Enhanced for large datasets */}
      <div className="p-3 border-t border-slate-200 flex justify-between items-center bg-slate-50 gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(0)}
            disabled={page === 0}
            className="px-2 py-1 bg-white border rounded hover:bg-slate-100 disabled:opacity-50 text-xs"
            data-tip="第一页" className="tooltip-bottom"
          >
            ««
          </button>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 bg-white border rounded hover:bg-slate-100 disabled:opacity-50 text-sm"
          >
            上一页
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            第 {page + 1} / {totalPages} 页
          </span>
          {totalPages > 10 && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={jumpToPage}
                onChange={(e) => setJumpToPage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePageJump()}
                placeholder="跳转"
                className="w-16 px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                min={1}
                max={totalPages}
              />
              <button
                onClick={handlePageJump}
                className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
              >
                GO
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 bg-white border rounded hover:bg-slate-100 disabled:opacity-50 text-sm"
          >
            下一页
          </button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 bg-white border rounded hover:bg-slate-100 disabled:opacity-50 text-xs"
            data-tip="最后一页" className="tooltip-bottom"
          >
            »»
          </button>
        </div>
      </div>
    </div>
  );
};

DataGrid.displayName = 'DataGrid';

export default memo(DataGrid);
