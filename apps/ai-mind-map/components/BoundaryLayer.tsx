import React, { useMemo } from 'react';
import type { Node } from '@xyflow/react';
import type { Boundary } from '../types';

interface BoundaryLayerProps {
    boundaries: Boundary[];
    nodes: Node[];
    onRemove: (id: string) => void;
}

export const BoundaryLayer: React.FC<BoundaryLayerProps> = ({ boundaries, nodes, onRemove }) => {
    const boundaryRects = useMemo(() => {
        if (!boundaries || boundaries.length === 0) return [];

        return boundaries.map((boundary) => {
            const boundaryNodes = nodes.filter(n => boundary.nodeIds.includes(n.id));
            if (boundaryNodes.length === 0) return null;

            const padding = 20;
            const minX = Math.min(...boundaryNodes.map(n => n.position.x)) - padding;
            const minY = Math.min(...boundaryNodes.map(n => n.position.y)) - padding;
            const maxX = Math.max(...boundaryNodes.map(n => n.position.x + ((n.style?.width as number) || 180))) + padding;
            const maxY = Math.max(...boundaryNodes.map(n => n.position.y + ((n.style?.height as number) || 50))) + padding;

            return {
                ...boundary,
                minX,
                minY,
                width: maxX - minX,
                height: maxY - minY,
            };
        }).filter(Boolean);
    }, [boundaries, nodes]);

    if (boundaryRects.length === 0) return null;

    return (
        <svg
            className="boundary-layer"
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
            {boundaryRects.map((rect) => rect && (
                <g key={rect.id}>
                    {/* 边界框 */}
                    <rect
                        x={rect.minX}
                        y={rect.minY}
                        width={rect.width}
                        height={rect.height}
                        rx={12}
                        ry={12}
                        fill={`${rect.color || '#6366f1'}15`}
                        stroke={rect.color || '#6366f1'}
                        strokeWidth={2}
                        strokeDasharray={rect.style === 'dashed' ? '8,4' : 'none'}
                        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        onClick={() => {
                            if (confirm(`删除边界 "${rect.label || '边界'}"？`)) {
                                onRemove(rect.id);
                            }
                        }}
                    />
                    {/* 边界标签 */}
                    {rect.label && (
                        <text
                            x={rect.minX + 8}
                            y={rect.minY - 6}
                            fill={rect.color || '#6366f1'}
                            fontSize={12}
                            fontWeight={500}
                        >
                            {rect.label}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    );
};
