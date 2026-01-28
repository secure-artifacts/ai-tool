/**
 * 自定义边缘组件 - 支持多种连线样式
 */
import React from 'react';
import { BaseEdge, getSmoothStepPath, getBezierPath, EdgeProps, getStraightPath } from '@xyflow/react';

interface CustomEdgeData {
    lineStyle?: 'curve' | 'straight' | 'step' | 'bracket' | 'tree' | 'fishbone';
}

// 括号形边缘 - 使用大括号样式
export const BracketEdge: React.FC<EdgeProps> = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
}) => {
    // 计算括号形路径
    const midX = (sourceX + targetX) / 2;
    const curveOffset = 15;

    // 大括号形状路径
    const path = `
        M ${sourceX} ${sourceY}
        L ${midX - curveOffset} ${sourceY}
        Q ${midX} ${sourceY} ${midX} ${sourceY + (targetY > sourceY ? curveOffset : -curveOffset)}
        L ${midX} ${targetY + (targetY > sourceY ? -curveOffset : curveOffset)}
        Q ${midX} ${targetY} ${midX + curveOffset} ${targetY}
        L ${targetX} ${targetY}
    `;

    return (
        <BaseEdge
            id={id}
            path={path}
            style={style}
            markerEnd={markerEnd}
        />
    );
};

// 树形边缘 - 直角折线
export const TreeEdge: React.FC<EdgeProps> = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    style,
    markerEnd,
}) => {
    // 计算直角折线路径
    const midX = sourceX + (targetX - sourceX) * 0.3;

    const path = `
        M ${sourceX} ${sourceY}
        L ${midX} ${sourceY}
        L ${midX} ${targetY}
        L ${targetX} ${targetY}
    `;

    return (
        <BaseEdge
            id={id}
            path={path}
            style={style}
            markerEnd={markerEnd}
        />
    );
};

// 鱼骨边缘 - 斜线
export const FishboneEdge: React.FC<EdgeProps> = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    style,
    markerEnd,
}) => {
    // 斜线直接连接（鱼骨的骨架部分）
    const path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;

    return (
        <BaseEdge
            id={id}
            path={path}
            style={style}
            markerEnd={markerEnd}
        />
    );
};

// 边缘类型映射
export const customEdgeTypes = {
    bracket: BracketEdge,
    tree: TreeEdge,
    fishbone: FishboneEdge,
};

// 根据布局方向获取边缘类型
export function getEdgeTypeByLayout(layout: string, depth: number = 0): string {
    switch (layout) {
        case 'bracket-right':
        case 'bracket-left':
            return 'bracket';
        case 'tree-right':
        case 'tree-left':
            return 'tree';
        case 'timeline':
            return 'straight';
        case 'fishbone':
            return 'fishbone';
        case 'mindmap':
        case 'four-direction':
            return 'default'; // Bezier 曲线，四周发散
        case 'org-down':
        case 'org-up':
            return 'step'; // 阶梯折线
        case 'logic-right':
        case 'logic-left':
            return 'smoothstep'; // 直角折线
        case 'horizontal-right':
            return 'smoothstep'; // 水平直线
        default:
            return 'smoothstep';
    }
}
