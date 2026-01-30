import React, { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import type { Summary } from '../types';

interface SummaryLayerProps {
    summaries: Summary[];
    nodes: Node[];
    onRemove: (id: string) => void;
}

export const SummaryLayer: React.FC<SummaryLayerProps> = ({ summaries, nodes, onRemove }) => {
    const summaryData = useMemo(() => {
        if (!summaries || summaries.length === 0) return [];

        return summaries.map((summary) => {
            const summaryNodes = nodes.filter(n => summary.nodeIds.includes(n.id));
            if (summaryNodes.length === 0) return null;

            const padding = 8;
            const minY = Math.min(...summaryNodes.map(n => n.position.y)) - padding;
            const maxY = Math.max(...summaryNodes.map(n => n.position.y + ((n.style?.height as number) || 50))) + padding;
            const maxX = Math.max(...summaryNodes.map(n => n.position.x + ((n.style?.width as number) || 180))) + padding;

            const bracketX = maxX + 20;
            const bracketHeight = maxY - minY;
            const summaryBoxX = bracketX + 15;
            const summaryBoxY = minY + bracketHeight / 2 - 15;

            return {
                ...summary,
                minY,
                maxY,
                bracketX,
                bracketHeight,
                summaryBoxX,
                summaryBoxY,
            };
        }).filter(Boolean);
    }, [summaries, nodes]);

    if (summaryData.length === 0) return null;

    return (
        <svg
            className="summary-layer"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: -1,
                overflow: 'visible',
            }}
        >
            {summaryData.map((data) => data && (
                <g key={data.id}>
                    {/* 括号线 */}
                    <path
                        d={`M ${data.bracketX} ${data.minY} 
                            Q ${data.bracketX + 10} ${data.minY} ${data.bracketX + 10} ${data.minY + 10}
                            L ${data.bracketX + 10} ${data.minY + data.bracketHeight / 2 - 5}
                            L ${data.bracketX + 15} ${data.minY + data.bracketHeight / 2}
                            L ${data.bracketX + 10} ${data.minY + data.bracketHeight / 2 + 5}
                            L ${data.bracketX + 10} ${data.maxY - 10}
                            Q ${data.bracketX + 10} ${data.maxY} ${data.bracketX} ${data.maxY}`}
                        fill="none"
                        stroke={data.color || '#f59e0b'}
                        strokeWidth={2}
                    />
                    {/* 概括框 */}
                    <rect
                        x={data.summaryBoxX}
                        y={data.summaryBoxY}
                        width={Math.max(80, data.label.length * 14 + 16)}
                        height={30}
                        rx={6}
                        ry={6}
                        fill={`${data.color || '#f59e0b'}20`}
                        stroke={data.color || '#f59e0b'}
                        strokeWidth={1.5}
                        className="pointer-events-auto cursor-pointer"
                        onClick={() => {
                            if (confirm(`删除概括 "${data.label}"？`)) {
                                onRemove(data.id);
                            }
                        }}
                    />
                    {/* 概括文字 */}
                    <text
                        x={data.summaryBoxX + 8}
                        y={data.summaryBoxY + 20}
                        fill={data.color || '#f59e0b'}
                        fontSize={13}
                        fontWeight={600}
                    >
                        {data.label}
                    </text>
                </g>
            ))}
        </svg>
    );
};
