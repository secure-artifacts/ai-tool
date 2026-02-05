/**
 * 报告导出服务 - 生成 PDF 和 Google Docs 格式的审核报告
 * 增强版：支持图片、中英对照、参考图
 */

import { ImageReview, ImageGroup, ProjectInfo, REVIEW_STATUS_CONFIG, SEVERITY_CONFIG, FeedbackItem } from '../types';
import { compressBase64Image } from './imageCompressService';

/**
 * 获取可用的图片源 - 优先 Gyazo URL，然后 base64，最后 HTTP URL
 * blob URL 在导出后无法使用，所以返回空占位
 */
const getImageSrc = (img: ImageReview): string => {
    // 优先使用 Gyazo 永久链接（最可靠）
    if (img.gyazoUrl) {
        return img.gyazoUrl;
    }
    // 其次使用 base64 数据（离线可用但文件大）
    if (img.base64Data) {
        return img.base64Data;
    }
    // 如果是在线图片 URL（http/https），可以直接使用
    if (img.imageUrl && (img.imageUrl.startsWith('http://') || img.imageUrl.startsWith('https://'))) {
        return img.imageUrl;
    }
    // blob URL 或本地路径在导出后无法访问
    return '';
};

// 报告数据结构
interface ReportData {
    projectInfo: ProjectInfo;
    images: ImageReview[];
    summary: {
        total: number;
        approved: number;
        revision: number;
        rejected: number;
        pending: number;
        criticalIssues: number;
        majorIssues: number;
        minorIssues: number;
        suggestions: number;
    };
}

/**
 * 生成报告摘要统计
 */
export const generateReportSummary = (images: ImageReview[]): ReportData['summary'] => {
    const summary = {
        total: images.length,
        approved: 0,
        revision: 0,
        rejected: 0,
        pending: 0,
        criticalIssues: 0,
        majorIssues: 0,
        minorIssues: 0,
        suggestions: 0,
    };

    images.forEach(img => {
        switch (img.status) {
            case 'approved': summary.approved++; break;
            case 'revision': summary.revision++; break;
            case 'rejected': summary.rejected++; break;
            default: summary.pending++; break;
        }

        img.feedbackItems.forEach(item => {
            switch (item.severity) {
                case 'critical': summary.criticalIssues++; break;
                case 'major': summary.majorIssues++; break;
                case 'minor': summary.minorIssues++; break;
                case 'suggestion': summary.suggestions++; break;
            }
        });
    });

    return summary;
};

/**
 * 格式化单个反馈项为文本（中英对照版）
 */
const formatFeedbackItemBilingual = (item: FeedbackItem, index: number): string => {
    const severityConfig = SEVERITY_CONFIG[item.severity];
    const lines: string[] = [];

    lines.push(`  ${index + 1}. [${severityConfig.icon} ${severityConfig.label} / ${severityConfig.labelEn}]`);

    // 建议（中英对照）
    if (item.suggestionCn) {
        lines.push(`     📝 建议: ${item.suggestionCn}`);
        if (item.suggestionTranslation?.english) {
            lines.push(`     📝 Suggestion: ${item.suggestionTranslation.english}`);
        }
    }

    // 问题描述（中英对照）
    if (item.problemCn) {
        lines.push(`     ⚠️ 问题: ${item.problemCn}`);
        if (item.problemTranslation?.english) {
            lines.push(`     ⚠️ Problem: ${item.problemTranslation.english}`);
        }
    }

    // 颜色代码
    if (item.colorHex) {
        lines.push(`     🎨 颜色/Color: ${item.colorHex}`);
    }

    // 参考图提示
    if (item.referenceImageBase64 || item.referenceImageUrl) {
        lines.push(`     📎 [附参考图 / Reference Image Attached]`);
    }

    return lines.join('\n');
};

/**
 * 生成纯文本报告（中英对照版）
 */
export const generateTextReport = (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    useEnglish: boolean = true
): string => {
    // 默认生成中英对照版
    return generateBilingualTextReport(images, projectInfo);
};

/**
 * 生成中英对照纯文本报告
 */
export const generateBilingualTextReport = (
    images: ImageReview[],
    projectInfo: ProjectInfo
): string => {
    const summary = generateReportSummary(images);
    const lines: string[] = [];

    // 标题
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('           图片审核报告 / IMAGE REVIEW REPORT');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`项目/Project: ${projectInfo.name}`);
    lines.push(`批次/Batch: ${projectInfo.batchNumber}`);
    lines.push(`审核人/Reviewer: ${projectInfo.reviewerName}`);
    lines.push(`日期/Date: ${projectInfo.reviewDate}`);
    if (projectInfo.notes) {
        lines.push(`备注/Notes: ${projectInfo.notes}`);
    }

    // 摘要
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('摘要统计 / SUMMARY');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('');
    lines.push(`总图片数/Total: ${summary.total}`);
    lines.push(`  ✅ 合格/Approved: ${summary.approved}`);
    lines.push(`  ✏️ 有建议/Has Suggestions: ${summary.revision}`);
    lines.push(`  ❌ 不合格/Not Qualified: ${summary.rejected}`);
    lines.push(`  ⏳ 待审/Pending: ${summary.pending}`);

    // 详细反馈
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('详细反馈 / DETAILED FEEDBACK');
    lines.push('───────────────────────────────────────────────────────────────');

    const statusOrder = ['rejected', 'revision', 'pending', 'approved'] as const;

    statusOrder.forEach(status => {
        const statusImages = images.filter(img => img.status === status);
        if (statusImages.length === 0) return;

        const statusConfig = REVIEW_STATUS_CONFIG[status];
        lines.push('');
        lines.push(`【${statusConfig.icon} ${statusConfig.label} / ${status.toUpperCase()}】(${statusImages.length})`);
        lines.push('');

        statusImages.forEach((img, imgIndex) => {
            const imgName = img.originalInput || `Image ${imgIndex + 1}`;
            lines.push(`━━━ 图片/Image: ${imgName} ━━━`);

            if (img.feedbackItems.length > 0) {
                img.feedbackItems.forEach((item, itemIndex) => {
                    lines.push(formatFeedbackItemBilingual(item, itemIndex));
                });
            } else {
                lines.push('  （无反馈 / No feedback）');
            }
            lines.push('');
        });
    });

    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('报告结束 / END OF REPORT');
    lines.push('═══════════════════════════════════════════════════════════════');

    return lines.join('\n');
};

/**
 * 生成带图片的 HTML 报告（中英对照版）
 */
export const generateHTMLReport = (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    useEnglish: boolean = true
): string => {
    // 默认生成带图片的中英对照版
    return generateBilingualHTMLReport(images, projectInfo);
};

/**
 * 生成带图片的中英对照 HTML 报告
 * @param mode 'online' = 使用Gyazo URL; 'offline' = 使用base64
 * @param groups 图片分组信息
 * @param language 'bilingual' = 中英对照; 'english' = 纯英文
 */
export const generateBilingualHTMLReport = (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    mode: 'online' | 'offline' = 'online',
    groups: ImageGroup[] = [],
    language: 'bilingual' | 'english' = 'bilingual'
): string => {
    const summary = generateReportSummary(images);
    const statusOrder = ['rejected', 'revision', 'pending', 'approved'] as const;
    const isEnglishOnly = language === 'english';

    // 根据模式选择图片源获取函数
    const getImgSrc = (img: ImageReview): string => {
        if (mode === 'online') {
            // 优先 Gyazo URL
            if (img.gyazoUrl) return img.gyazoUrl;
            if (img.imageUrl && (img.imageUrl.startsWith('http://') || img.imageUrl.startsWith('https://'))) {
                return img.imageUrl;
            }
            return '';
        } else {
            // 优先 base64
            if (img.base64Data) return img.base64Data;
            if (img.gyazoUrl) return img.gyazoUrl;
            if (img.imageUrl && (img.imageUrl.startsWith('http://') || img.imageUrl.startsWith('https://'))) {
                return img.imageUrl;
            }
            return '';
        }
    };

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isEnglishOnly ? 'Image Review Report' : '图片审核报告 / Image Review Report'} - ${projectInfo.name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif; padding: 30px; background: #f5f5f5; color: #333; line-height: 1.6; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h1 { text-align: center; margin-bottom: 30px; color: #1a1a1a; border-bottom: 3px solid #0d9488; padding-bottom: 15px; font-size: 24px; }
        h1 small { display: block; font-size: 14px; color: #666; font-weight: normal; margin-top: 5px; }
        .project-info { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 20px; border-radius: 10px; margin-bottom: 30px; }
        .project-info p { margin: 6px 0; font-size: 14px; }
        .project-info strong { color: #374151; }
        .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .summary-card { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 20px; border-radius: 10px; }
        .summary-card h3 { color: #374151; margin-bottom: 12px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
        .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
        .stat-row:last-child { border-bottom: none; }
        .section-title { font-size: 18px; font-weight: 600; color: #1a1a1a; margin: 30px 0 15px; padding: 12px 15px; background: #f1f5f9; border-radius: 8px; border-left: 4px solid #0d9488; }
        
        /* 图片卡片样式 */
        .image-card { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 20px; overflow: hidden; }
        .image-card-header { display: flex; gap: 20px; padding: 20px; }
        .image-preview { width: 300px; min-height: 200px; max-height: 400px; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: #f0f0f0; display: flex; align-items: center; justify-content: center; }
        .image-preview img { max-width: 100%; max-height: 400px; object-fit: contain; }
        .image-info { flex: 1; }
        .image-name { font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 10px; word-break: break-all; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; }
        .status-approved { background: #d1fae5; color: #065f46; }
        .status-rejected { background: #fee2e2; color: #991b1b; }
        .status-revision { background: #fef3c7; color: #92400e; }
        /* removed abandoned status */
        .status-pending { background: #f3f4f6; color: #6b7280; }
        
        /* 反馈项样式 */
        .feedback-list { padding: 0 20px 20px; }
        .feedback-item { margin: 12px 0; padding: 15px; background: white; border-radius: 8px; border: 1px solid #e5e7eb; }
        .feedback-critical { border-left: 4px solid #ef4444; }
        .feedback-major { border-left: 4px solid #f59e0b; }
        .feedback-minor { border-left: 4px solid #3b82f6; }
        .feedback-suggestion { border-left: 4px solid #22c55e; }
        .severity-badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-bottom: 12px; }
        .severity-critical { background: #fef2f2; color: #dc2626; }
        .severity-major { background: #fffbeb; color: #d97706; }
        .severity-minor { background: #eff6ff; color: #2563eb; }
        .severity-suggestion { background: #f0fdf4; color: #16a34a; }
        
        /* 中英对照样式 */
        .bilingual-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 10px 0; }
        .bilingual-col { padding: 10px; background: #f8fafc; border-radius: 6px; }
        .bilingual-col.cn { border-left: 3px solid #f59e0b; }
        .bilingual-col.en { border-left: 3px solid #3b82f6; }
        .lang-label { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }
        .feedback-text { color: #374151; font-size: 14px; }
        
        /* 纯英文模式的单列样式 */
        .feedback-single { padding: 10px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #3b82f6; margin: 10px 0; }
        
        /* 参考图样式 */
        .reference-section { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e5e7eb; }
        .reference-label { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
        .reference-image { max-width: 150px; max-height: 150px; border-radius: 6px; border: 1px solid #e5e7eb; }
        
        /* 颜色代码样式 */
        .color-code { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: #f3f4f6; border-radius: 4px; font-size: 12px; font-family: monospace; margin-top: 8px; }
        .color-swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.1); }
        
        /* 分组网格样式 */
        .group-card { background: #f8f5ff; border: 2px solid #a855f7; border-radius: 12px; margin-bottom: 20px; overflow: hidden; }
        .group-header { background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%); color: white; padding: 15px 20px; }
        .group-name { font-size: 18px; font-weight: 600; }
        .group-info { font-size: 12px; opacity: 0.9; margin-top: 4px; }
        .group-images-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; padding: 15px; background: white; }
        .group-image-item { position: relative; border-radius: 8px; overflow: hidden; background: #f0f0f0; aspect-ratio: 1; }
        .group-image-item img { width: 100%; height: 100%; object-fit: cover; }
        .group-image-item .image-index { position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.6); color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
        .group-feedback { padding: 15px 20px; border-top: 1px solid #e5e7eb; background: white; }
        .group-feedback-title { font-size: 14px; font-weight: 600; color: #7c3aed; margin-bottom: 10px; }
        
        .no-feedback { color: #9ca3af; font-style: italic; padding: 10px; }
        .footer { text-align: center; margin-top: 40px; color: #9ca3af; font-size: 12px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
        
        @media print {
            body { padding: 0; background: white; }
            .container { box-shadow: none; padding: 20px; }
            .image-card { break-inside: avoid; page-break-inside: avoid; }
        }
        
        /* 手机适配 */
        @media (max-width: 768px) {
            body { padding: 10px; }
            .container { padding: 15px; border-radius: 8px; }
            h1 { font-size: 18px; padding-bottom: 10px; }
            h1 small { font-size: 12px; }
            .project-info { padding: 12px; }
            .project-info p { font-size: 12px; }
            .summary { grid-template-columns: 1fr; gap: 10px; }
            .summary-card { padding: 12px; }
            .summary-card h3 { font-size: 11px; }
            .stat-row { font-size: 12px; }
            .section-title { font-size: 14px; padding: 10px; }
            .image-card-header { flex-direction: column; gap: 12px; padding: 12px; }
            .image-preview { width: 100%; max-height: 500px; aspect-ratio: auto; }
            .image-name { font-size: 14px; }
            .feedback-list { padding: 0 12px 12px; }
            .feedback-item { padding: 10px; }
            .bilingual-row { grid-template-columns: 1fr; gap: 10px; }
            .bilingual-col { padding: 8px; }
            .feedback-text { font-size: 13px; }
            .reference-image { max-width: 100px; max-height: 100px; }
            .footer { font-size: 10px; margin-top: 20px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${isEnglishOnly ? '📋 Image Review Report' : '📋 图片审核报告<small>Image Review Report</small>'}</h1>
        
        <div class="project-info">
            <p><strong>${isEnglishOnly ? 'Project:' : '项目/Project:'}</strong> ${projectInfo.name || '-'}</p>
            <p><strong>${isEnglishOnly ? 'Batch:' : '批次/Batch:'}</strong> ${projectInfo.batchNumber || '-'}</p>
            <p><strong>${isEnglishOnly ? 'Reviewer:' : '审核人/Reviewer:'}</strong> ${projectInfo.reviewerName || '-'}</p>
            <p><strong>${isEnglishOnly ? 'Date:' : '日期/Date:'}</strong> ${projectInfo.reviewDate}</p>
            ${projectInfo.notes ? `<p><strong>${isEnglishOnly ? 'Notes:' : '备注/Notes:'}</strong> ${projectInfo.notes}</p>` : ''}
        </div>

        <div class="summary">
            <div class="summary-card">
                <h3>${isEnglishOnly ? 'Review Status' : '审核状态 / Review Status'}</h3>
                <div class="stat-row"><span>✅ ${isEnglishOnly ? 'Approved' : '合格/Approved'}</span><span><strong>${summary.approved}</strong></span></div>
                <div class="stat-row"><span>✏️ ${isEnglishOnly ? 'Has Suggestions' : '有建议/Has Suggestions'}</span><span><strong>${summary.revision}</strong></span></div>
                <div class="stat-row"><span>❌ ${isEnglishOnly ? 'Not Qualified' : '不合格/Not Qualified'}</span><span><strong>${summary.rejected}</strong></span></div>
                <div class="stat-row"><span>⏳ ${isEnglishOnly ? 'Pending' : '待审/Pending'}</span><span><strong>${summary.pending}</strong></span></div>
            </div>
        </div>

        ${(isEnglishOnly ? projectInfo.overallSummaryEn : (projectInfo.overallSummary || projectInfo.overallSummaryEn)) ? `
        <div class="section-title">📊 ${isEnglishOnly ? 'Overall Summary' : '整批问题汇总 / Overall Summary'}</div>
        ${isEnglishOnly ? `
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%); padding: 20px; border-radius: 10px; color: white; margin-bottom: 20px;">
            <p style="white-space: pre-wrap; line-height: 1.6; margin: 0; font-size: 14px;">${projectInfo.overallSummaryEn || ''}</p>
        </div>
        ` : `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
            ${projectInfo.overallSummary ? `
            <div style="background: linear-gradient(135deg, #134e4a 0%, #164e63 100%); padding: 16px; border-radius: 10px; color: white;">
                <div style="font-size: 12px; opacity: 0.8; margin-bottom: 8px;">中文 Chinese</div>
                <p style="white-space: pre-wrap; line-height: 1.6; margin: 0; font-size: 14px;">${projectInfo.overallSummary}</p>
            </div>` : ''}
            ${projectInfo.overallSummaryEn ? `
            <div style="background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%); padding: 16px; border-radius: 10px; color: white;">
                <div style="font-size: 12px; opacity: 0.8; margin-bottom: 8px;">English</div>
                <p style="white-space: pre-wrap; line-height: 1.6; margin: 0; font-size: 14px;">${projectInfo.overallSummaryEn}</p>
            </div>` : ''}
        </div>
        `}
        ` : ''}

        ${/* 先渲染分组（网格布局）*/
        groups.length > 0 ? `
        <div class="section-title">📁 图片分组 / Image Groups (${groups.length})</div>
        ${groups.map((group, groupIndex) => {
            const groupImages = images.filter(img => img.groupId === group.id);
            if (groupImages.length === 0) return '';

            return `
            <div class="group-card">
                <div class="group-header">
                    <div class="group-name">📁 ${group.name}</div>
                    <div class="group-info">${groupImages.length} 张图片 / ${groupImages.length} images</div>
                </div>
                <div class="group-images-grid">
                    ${groupImages.map((img, imgIdx) => {
                const imgSrc = getImgSrc(img);
                return `
                        <div class="group-image-item">
                            <span class="image-index">#${imgIdx + 1}</span>
                            ${imgSrc
                        ? `<img src="${imgSrc}" alt="${img.originalInput || 'Image'}" onerror="this.style.display='none'">`
                        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;">⚠️</div>`
                    }
                        </div>
                        `;
            }).join('')}
                </div>
                <div class="group-feedback">
                    <div class="group-feedback-title">📝 组反馈 / Group Feedback</div>
                    ${group.groupFeedbackCn
                    ? `<p style="color:#374151;margin-bottom:8px;">${group.groupFeedbackCn}</p>`
                    : '<p class="no-feedback">暂无组反馈 / No group feedback</p>'
                }
                </div>
            </div>
            `;
        }).join('')}
        ` : ''}

        ${statusOrder.map(status => {
            // 过滤掉已分组的图片，只显示未分组的
            const statusImages = images.filter(img => img.status === status && !img.groupId);
            if (statusImages.length === 0) return '';

            const statusConfig = REVIEW_STATUS_CONFIG[status];
            const statusLabel = isEnglishOnly ? status.charAt(0).toUpperCase() + status.slice(1) : `${statusConfig.label} / ${status.charAt(0).toUpperCase() + status.slice(1)}`;
            return `
                <div class="section-title">${statusConfig.icon} ${statusLabel} (${statusImages.length})</div>
                ${statusImages.map((img, imgIndex) => {
                const imgSrc = getImgSrc(img);
                return `
                    <div class="image-card">
                        <div class="image-card-header">
                            <div class="image-preview">
                                ${imgSrc
                        ? `<img src="${imgSrc}" alt="${img.originalInput || 'Image'}" onerror="this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:#999;\\'>${isEnglishOnly ? 'Image load failed' : '图片加载失败'}</div>'">`
                        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:12px;text-align:center;padding:10px;">${isEnglishOnly ? '⚠️ Image only visible in app' : '⚠️ 图片仅在应用内可视<br/>Image only visible in app'}</div>`
                    }
                            </div>
                            <div class="image-info">
                                <div class="image-name">#${imgIndex + 1} ${img.originalInput || ''}</div>
                                <span class="status-badge status-${status}">${statusConfig.icon} ${isEnglishOnly ? status : `${statusConfig.label} / ${status}`}</span>
                                ${img.annotations.length > 0 ? `<div style="margin-top: 8px; font-size: 12px; color: #6b7280;">📍 ${img.annotations.length} ${isEnglishOnly ? 'annotations' : '个标注 / annotations'}</div>` : ''}
                            </div>
                        </div>
                        <div class="feedback-list">
                            ${img.feedbackItems.length > 0 ? img.feedbackItems.map((item, itemIndex) => {
                        const severityConfig = SEVERITY_CONFIG[item.severity];
                        return `
                                    <div class="feedback-item feedback-${item.severity}">
                                        <span class="severity-badge severity-${item.severity}">${severityConfig.icon} ${isEnglishOnly ? severityConfig.labelEn : `${severityConfig.label} / ${severityConfig.labelEn}`}</span>
                                        
                                        ${isEnglishOnly ? `
                                            ${item.suggestionTranslation?.english ? `
                                                <div class="feedback-single">
                                                    <div class="lang-label">📝 Suggestion</div>
                                                    <div class="feedback-text">${item.suggestionTranslation.english}</div>
                                                </div>
                                            ` : (item.suggestionCn ? `
                                                <div class="feedback-single">
                                                    <div class="lang-label">📝 Suggestion</div>
                                                    <div class="feedback-text"><em style="color:#999">Translation pending</em></div>
                                                </div>
                                            ` : '')}
                                            
                                            ${item.problemTranslation?.english ? `
                                                <div class="feedback-single">
                                                    <div class="lang-label">⚠️ Problem</div>
                                                    <div class="feedback-text">${item.problemTranslation.english}</div>
                                                </div>
                                            ` : (item.problemCn ? `
                                                <div class="feedback-single">
                                                    <div class="lang-label">⚠️ Problem</div>
                                                    <div class="feedback-text"><em style="color:#999">Translation pending</em></div>
                                                </div>
                                            ` : '')}
                                        ` : `
                                            ${item.suggestionCn || item.suggestionTranslation ? `
                                                <div class="bilingual-row">
                                                    <div class="bilingual-col cn">
                                                        <div class="lang-label">📝 建议 (中文)</div>
                                                        <div class="feedback-text">${item.suggestionCn || '-'}</div>
                                                    </div>
                                                    <div class="bilingual-col en">
                                                        <div class="lang-label">📝 Suggestion (English)</div>
                                                        <div class="feedback-text">${item.suggestionTranslation?.english || '<em style="color:#999">未翻译 / Not translated</em>'}</div>
                                                    </div>
                                                </div>
                                            ` : ''}
                                            
                                            ${item.problemCn || item.problemTranslation ? `
                                                <div class="bilingual-row">
                                                    <div class="bilingual-col cn">
                                                        <div class="lang-label">⚠️ 问题 (中文)</div>
                                                        <div class="feedback-text">${item.problemCn || '-'}</div>
                                                    </div>
                                                    <div class="bilingual-col en">
                                                        <div class="lang-label">⚠️ Problem (English)</div>
                                                        <div class="feedback-text">${item.problemTranslation?.english || '<em style="color:#999">未翻译 / Not translated</em>'}</div>
                                                    </div>
                                                </div>
                                            ` : ''}
                                        `}
                                        
                                        ${item.colorHex ? `
                                            <div class="color-code">
                                                <span class="color-swatch" style="background-color: ${item.colorHex}"></span>
                                                ${isEnglishOnly ? 'Color:' : '颜色/Color:'} ${item.colorHex}
                                            </div>
                                        ` : ''}
                                        
                                        ${item.referenceImageBase64 || item.referenceImageUrl ? `
                                            <div class="reference-section">
                                                <div class="reference-label">📎 ${isEnglishOnly ? 'Reference Image:' : '参考图 / Reference Image:'}</div>
                                                <img class="reference-image" src="${item.referenceImageBase64 || item.referenceImageUrl}" alt="Reference" onerror="this.style.display='none'">
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
                    }).join('') : `<p class="no-feedback">${isEnglishOnly ? 'No feedback provided' : '无反馈 / No feedback provided'}</p>`}
                        </div>
                    </div>
                `}).join('')}
            `;
        }).join('')}

        <div class="footer">
            ${isEnglishOnly ? 'Generated by AI Creative Toolkit' : '由 AI 创作工具包生成 / Generated by AI Creative Toolkit'}<br>
            ${new Date().toLocaleString(isEnglishOnly ? 'en-US' : 'zh-CN')}
        </div>
    </div>
</body>
</html>
    `.trim();
};

/**
 * 下载 PDF 报告（使用浏览器打印功能）
 */
export const downloadPDFReport = async (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    useEnglish: boolean = true
): Promise<void> => {
    // 使用离线模式（base64）确保图片能在 PDF 中显示
    const html = generateBilingualHTMLReport(images, projectInfo, 'offline');

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        throw new Error('无法打开打印窗口，请检查浏览器弹窗设置');
    }

    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.onload = () => {
        printWindow.print();
    };
};

/**
 * 下载纯文本报告
 */
export const downloadTextReport = (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    useEnglish: boolean = true
): void => {
    const text = generateBilingualTextReport(images, projectInfo);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `review-report-${projectInfo.batchNumber || 'export'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
};

/**
 * 复制报告到剪贴板
 */
export const copyReportToClipboard = async (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    useEnglish: boolean = true
): Promise<void> => {
    const text = generateBilingualTextReport(images, projectInfo);
    await navigator.clipboard.writeText(text);
};

/**
 * 在新窗口中预览报告
 */
export const previewHTMLReport = (
    images: ImageReview[],
    projectInfo: ProjectInfo
): void => {
    const html = generateBilingualHTMLReport(images, projectInfo);
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
        previewWindow.document.write(html);
        previewWindow.document.close();
    }
};

/**
 * 获取在线版图片源（优先 Gyazo URL，其次 HTTP URL）
 */
const getOnlineImageSrc = (img: ImageReview): string => {
    if (img.gyazoUrl) return img.gyazoUrl;
    if (img.imageUrl && (img.imageUrl.startsWith('http://') || img.imageUrl.startsWith('https://'))) {
        return img.imageUrl;
    }
    return '';
};

/**
 * 获取离线版图片源（优先 base64，文件大但离线可用）
 */
const getOfflineImageSrc = (img: ImageReview): string => {
    if (img.base64Data) return img.base64Data;
    // 如果没有 base64，尝试使用在线链接
    return getOnlineImageSrc(img);
};

export type HTMLExportMode = 'online' | 'offline' | 'compressed' | 'compressed-english';

/**
 * 下载 HTML 网页报告
 * @param mode 'online' = 使用Gyazo URL; 'offline' = 使用base64; 'compressed' = 压缩后的base64; 'compressed-english' = 压缩后纯英文
 */
export const downloadHTMLReport = async (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    mode: HTMLExportMode = 'online'
): Promise<void> => {
    let processedImages = images;
    const isCompressed = mode === 'compressed' || mode === 'compressed-english';
    const isEnglishOnly = mode === 'compressed-english';

    // 如果是压缩模式，先压缩所有图片
    if (isCompressed) {
        processedImages = await Promise.all(images.map(async (img) => {
            if (img.base64Data) {
                try {
                    const compressed = await compressBase64Image(img.base64Data, {
                        maxWidth: 800,
                        maxHeight: 800,
                        quality: 0.7,
                        format: 'jpeg'
                    });
                    return { ...img, base64Data: compressed };
                } catch {
                    return img;
                }
            }
            return img;
        }));
    }

    const effectiveMode: 'online' | 'offline' = isCompressed ? 'offline' : (mode as 'online' | 'offline');
    const language: 'bilingual' | 'english' = isEnglishOnly ? 'english' : 'bilingual';
    const html = generateBilingualHTMLReport(processedImages, projectInfo, effectiveMode, [], language);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const modeLabel = mode === 'online' ? 'online' : mode === 'compressed-english' ? 'english' : mode === 'compressed' ? 'compressed' : 'offline';
    link.download = `review-report-${projectInfo.batchNumber || 'export'}-${modeLabel}.html`;
    link.click();
    URL.revokeObjectURL(url);
};

/**
 * 生成报告长图并上传到 Gyazo，返回分享链接
 */
export const generateReportImageAndUploadToGyazo = async (
    images: ImageReview[],
    projectInfo: ProjectInfo,
    uploadFn: (base64: string) => Promise<string | null>
): Promise<string | null> => {
    // 生成 HTML 报告（使用离线模式，用 base64 确保图片能显示）
    const html = generateBilingualHTMLReport(images, projectInfo, 'offline');

    // 创建隐藏的 iframe 来渲染报告
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;height:auto;border:none;';
    document.body.appendChild(iframe);

    try {
        // 写入 HTML 内容
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) throw new Error('Cannot access iframe document');

        iframeDoc.open();
        iframeDoc.write(html);
        iframeDoc.close();

        // 等待图片加载
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 使用 html2canvas 截图
        const html2canvas = (await import('html2canvas')).default;
        const container = iframeDoc.querySelector('.container') as HTMLElement || iframeDoc.body;

        console.log('[reportExportService] Container found:', !!container, 'size:', container?.offsetWidth, 'x', container?.offsetHeight);

        const canvas = await html2canvas(container, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#f9fafb',
            scale: 1.5, // 提高清晰度
            logging: true // 开启日志以便调试
        });

        console.log('[reportExportService] Canvas size:', canvas.width, 'x', canvas.height);

        // 验证 canvas 是否有效
        if (canvas.width === 0 || canvas.height === 0) {
            console.error('[reportExportService] Canvas is empty, html2canvas failed to render');
            throw new Error('截图失败：Canvas 为空');
        }

        // 压缩图片 - Gyazo 限制约 10MB
        let base64 = canvas.toDataURL('image/png');
        console.log('[reportExportService] Original image size:', Math.round(base64.length / 1024), 'KB');

        // 验证 base64 是否有效
        if (base64 === 'data:,' || base64.length < 100) {
            console.error('[reportExportService] toDataURL returned empty image');
            throw new Error('截图失败：图片数据为空');
        }

        // 如果太大，尝试用 JPEG 格式压缩
        if (base64.length > 5 * 1024 * 1024) { // 超过 5MB
            console.log('[reportExportService] Image too large, compressing to JPEG...');
            let quality = 0.8;
            base64 = canvas.toDataURL('image/jpeg', quality);

            // 继续压缩直到小于 5MB
            while (base64.length > 5 * 1024 * 1024 && quality > 0.3) {
                quality -= 0.1;
                base64 = canvas.toDataURL('image/jpeg', quality);
                console.log('[reportExportService] Compressed with quality:', quality, 'size:', Math.round(base64.length / 1024), 'KB');
            }
        }

        // 上传到 Gyazo
        const shareUrl = await uploadFn(base64);

        return shareUrl;
    } finally {
        // 清理 iframe
        document.body.removeChild(iframe);
    }
};
