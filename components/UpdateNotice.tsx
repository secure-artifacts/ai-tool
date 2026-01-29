import React, { useState } from 'react';
import './UpdateNotice.css';

interface UpdateInfo {
    version: string;
    date: string;
    features: {
        en: string[];
        zh: string[];
    };
    fixes?: {
        en: string[];
        zh: string[];
    };
}

interface VersionInfo {
    version: string;
    date: string;
    description: string;
    url: string;
    isCurrent?: boolean;
}

interface UpdateNoticeProps {
    onClose: () => void;
    language: 'en' | 'zh';
}

// 历史版本列表（由新到旧）
const versionHistory: VersionInfo[] = [

    {
        version: 'v2.8.5',
        date: '2026-01-29',
        description: '反推提示词工具重大修复 + 全局复制粘贴修复',
        url: '#',
        isCurrent: true
    },
    {
        version: 'v2.7.0',
        date: '2026-01-17',
        description: '新增 AI 思维导图 测试版',
        url: '#'
    },
    {
        version: 'v2.6.11',
        date: '2026-01-10',
        description: '文案查重功能',
        url: 'https://ai.studio/apps/drive/1cqEr_cZdEGouAydqkKqY4Po_C5KLvIAb?fullscreenApplet=true'
    },
    {
        version: 'v2.6.10',
        date: '2026-01-08',
        description: '批量文案改写工具 + 数据分析优化',
        url: '#'
    },
    {
        version: 'v2.5.1',
        date: '2025-12-21',
        description: '版本切换功能 + 多设备记录同步',
        url: 'https://ai.studio/apps/drive/1q7sgI9FjAAB5tG8KaxxHt5Vj_Bxy8SU3?fullscreenApplet=true',  // 历史版本
    },
    {
        version: 'v2.4.7',
        date: '2025-12-17',
        description: '智能翻译批量模式大幅增强',
        url: 'https://ai.studio/apps/drive/1jTJqRHAbpiTgELfDKT7aOSjeBsj_qQs-?fullscreenApplet=true',  // 历史版本
    },
    {
        version: 'v2.4.6',
        date: '2025-12-12',
        description: '新增 Gyazo/Imgur/Facebook 图片链接兼容支持',
        url: '#',  // 历史版本
    },
    {
        version: 'v2.4.4',
        date: '2025-12-08',
        description: '界面UI简单优化调整',
        url: '#',  // 历史版本
    },
    {
        version: 'v2.4.3',
        date: '2025-12-07',
        description: '指令模版增强、AI图片识别新增创新功能、反推提示词简化'
        ,
        url: '#',  // 历史版本
    },



    {
        version: 'v2.4.2',
        date: '2025-12-05',
        description: '反推提示词新增精确/快速双模式'
        ,
        url: 'https://ai.studio/apps/drive/1EM4c9MPlHot5aZlwLHoK3-dfpdPxTqbN?fullscreenApplet=true',  // 当前版本，链接可以留空或指向当前页面

    },




    {
        version: 'v2.3.1',
        date: '2025-12-04',
        description: '升级部分功能，详情看更新说明',
        url: '#',  // 待贴链接
    },

    {
        version: 'v2.2.0',
        date: '2025-11-24',
        description: 'Gemini模型选择功能',
        url: 'https://ai.studio/apps/drive/1edblRYmMWJbBJZaqy5-rnF2HzrnRxRuA?fullscreenApplet=true',

    },
    {
        version: 'v2.1.0',
        date: '2025-11-21',
        description: '即时翻译与云端同步预设，新增输入api key功能，支持批量输入api key，开启api key自动循环使用功能',
        url: 'https://ai.studio/apps/drive/1CmxIlW7LEFIGPISjNwgxttVe1jrCvPn0?fullscreenApplet=true'  // 替换为实际链接
    },

    {
        version: '0.0.0',
        date: '/',
        description: '创艺魔盒',
        url: 'https://ai.studio/apps/drive/1EmWckgvKjDG_m619495BaeS9Qa1ko02j'  // 替换为实际链接
    },
    {
        version: '0.0.0',
        date: '/',
        description: '幻影迁移',
        url: 'https://ai.studio/apps/drive/1kCeJjjh6iE-YS69gjneHGrwrLjS4OYDO'  // 替换为实际链接
    },



];



// 更新日志数据
const latestUpdate: UpdateInfo = {
    version: 'v2.8.5',
    date: '2026-01-29',
    features: {
        en: [
            'Image to Prompt: Major bug fixes and state preservation',
            'Global copy/paste functionality restored',
            'Electron menu support for macOS',
            'Mind Map keyboard shortcuts now scoped correctly'
        ],
        zh: [
            '✨如果更新版本使用有问题可从历史版本切换使用老版本',
            '-',
            '-',
            '26.01.29',
            '🔧 重大修复',
            '• 修复全局复制粘贴功能失效的问题（AI 思维导图快捷键导致）',
            '• 反推提示词工具：切换标签页后状态保持不丢失',
            '• 反推提示词工具：优化图片粘贴功能',
            '• 桌面版：添加 macOS 编辑菜单支持（Cmd+C/V 等快捷键）',
            '-',
            '上一版本2.7.0更新：',
            '• AI 思维导图 测试版',



            '上一版本2.6.11更新补充：',
            '• 批量改写文案',
            '• 批量文案专业查重工具',
            '• 批量文案多语言翻译',
            '• 数据分析模块更新新增部分功能',


            '12.21',
            '-',
            '🔄 新增版本切换功能',
            '• 一键切换网站版和 AI Studio 版',
            '• 网站版：支持 API Key 自动轮换',
            '• AI Studio 版：支持 AI 一键修图、AI 图片编辑器',
            '-',
            '☁️ 多设备记录同步',
            '• AI 图片识别、提示词工具、智能翻译三大功能区支持保存历史记录',
            '• 网站版和 AI Studio 版支持同步记录数据',
            '• 多设备、多浏览器登录，可实现记录同步',
            '• 登录账号邮箱即可同步所有数据',
            '-',
            '-',

            '12.18',
            '-',
            '🌐 网站版正式发布',
            '• 更新到最新的 Gemini 模型',
            '• 新增网站版本，支持在线访问：https://ai-toolkit-b2b78.web.app',
            '• ⚠️ 网站版暂不支持：AI 一键修图、AI 图片编辑器',
            '-',
            '🔐 新增登录模块',
            '• 登录账户后，可保存历史记录到云端',
            '• 真正支持 API Key 自动轮换',
            '• 多设备数据同步',
            '必须输入apikey才可使用',

            '-',
            '📝 历史记录功能',
            '• AI 图片识别工具支持保存历史记录',
            '• 反推提示词工具支持保存历史记录',
            '• 智能翻译工具支持保存历史记录',
            '-',
            '📁 AI 图片识别新增项目模式',
            '• 方便查看和管理识别记录',
            '• 支持项目分组和切换',
            '-',
            '📊 新增表格数据分析工具 (SheetMind)',
            '• 支持 Excel、CSV 文件上传分析',
            '• 支持 Google Sheets 链接直接加载',
            '• AI 智能数据分析对话',
            '• 多种可视化图表（柱图、饼图、折线图等）',
            '• 多工作表支持',
            '-',
            '🎚️ 新增界面缩放设置',
            '• 界面整体缩放调整（50%-400%）',
            '• 界面文字大小单独调整（80%-150%）',
            '• 设置自动保存，下次打开自动应用',
            '-',
            '-',
            '-',

            '12.17',
            '-',
            '📝 智能翻译：批量模式大幅增强',
            '• 新增 添加空条目 功能，可先创建空白条目再输入内容翻译',
            '• 图片识别优化查看结果方式',
            '-',
            '-',

            '12.12',
            '-',
            '🔗 图片链接兼容增强',
            '• 新增 Gyazo 分享页面链接支持（如 gyazo.com/xxx）',
            '• 新增 Imgur 分享页面链接支持（如 imgur.com/xxx）',
            '• 优化 Facebook CDN 图片链接处理（如 fbcdn.net/scontent...）',
            '• 自动转换为直接图片链接进行下载',
            '• 优化更好的兼容谷歌表格的插入单元格图片，粘贴值图片，谷歌云端链接图片',
            '• 已适配：AI 图片识别、反推提示词、智能翻译',
            '-',
            '-',
            '-',

            '12.08',
            '-',
            '🎨 界面 UI 简单优化调整',
            '-',
            '-',
            '-',

            '12.07',
            '-',
            '🔄 反推提示词：取消创新功能',
            '• 移除了批量反推+创新按钮',
            '• 移除了发送到创新面板',
            '• 界面更加简洁，专注于图片反推提示词功能',
            '-',
            '🚀 AI 图片识别：新增创新和聊天功能',
            '• 支持对识别结果进行创新扩写',
            '• 支持批导出识别结果到创新界面进行处理',
            '• 新增与图片的多轮对话功能，可持续优化描述',
            '-',
            '💡 提示词工具优化',
            '• 重新设计UI界面',
            '• 批量对成品提示词进行创新扩写',
            '• 优化处理流程和交互体验',
            '-',
            '📝 指令模版功能',
            '• 新增"普通指令模版设置"—简化的模版创建方式，只需填写名称和指令要求即可保存',
            '• 高级指令模版添加详细使用说明，帮助理解功能定位和使用方法',
            '• 默认显示简单模式，需要时可切换到高级模式',
            '-',
            '-',
            '-',

            '12.05',
            '-',
            '🎯 反推提示词：新增「精确/快速」双模式',
            '-',
            '为解决批量处理时可能出现的"图片内容串联"问题，现提供两种处理模式：',
            '-',
            '🎯 精确模式（默认）：',
            '• 逐张独立发送 API 请求',
            '• 100% 不会出现内容串联',
            '• 适合处理相似图片或对准确性要求高的场景',
            '• 注意：API 请求次数 = 图片数量，额度消耗较多',
            '-',
            '⚡ 快速模式：',
            '• 所有图片打包成一次请求',
            '• 速度更快，API 额度消耗少',
            '• 适合处理差异较大的图片',
            '• 注意：相似图片可能会出现内容串联',
            '-',
            '-',
            '-',

            '12.04',
            '-',
            '🚀 新增功能：AI 图片识别 (AI Image Recognition)',
            '一个专注于批量处理的高效图片分析工具。',
            '-',
            '核心能力：',
            '• 批量分类：快速对大量图片进行分类打标',
            '• AI 反推提示词：批量生成图片的描述词',
            '• OCR 文字提取：一键提取图片中的所有文字内容',
            '-',
            '高效体验：',
            '• 并发处理：支持多张图片同时下载与识别，大幅提升处理速度',
            '• 云端预设：支持将常用的 Prompt 预设保存到云端，多设备共享',
            '• 灵活视图：提供网格和列表两种视图，满足不同查看需求',
            '-',
            '与"反推提示词"工具的区别：',
            '• 本工具专注于单轮、批量的高效处理（如整理素材库）',
            '• 如需对单张图片的描述进行多轮对话修改或精细调整，请继续使用原有的"反推提示词"工具',
            '-',
            '-',
            '✨ 功能增强：图片链接粘贴支持',
            '大幅优化了图片链接的识别与导入体验，现已覆盖以下工具：反推提示词、智能批量翻译',
            '• 多种链接支持：不仅支持普通图片 URL，还完美支持 Google Sheets 中的 =IMAGE() 公式及单元格复制',
            '• 混合粘贴：支持一次性粘贴包含多个链接、HTML 内容或表格数据的混合文本，系统将自动提取所有有效图片',
            '-',
            '-',
            '-',

            '12.03',

            '✨ AI 一键修图升级：',
            '支持一键批量修图，另外可为每张图片单独设置自定义指令',
            '支持与图片编辑器联动，修图结果可直接导入编辑器二次创作',
            '-',

            '✨ AI 图片编辑器体验优化：',
            '支持拖拽多张图片批量添加图层。-',
            '支持直接点击画布中的图片选中图层，操作更直观。-',
            '-',
            '其他升级',
            '✨即时翻译功能升级',
            '✨反推提示词指令说明，可自定义反推提示词指令',
            '✨文本模型默认使用Gemini 3 pro',
            '-',

            '🐛 问题修复与稳定性提升：-',
            '修复切换工具后，图片编辑器图层丢失的问题。-',
            '修复切换工具后，智能翻译的批量任务丢失的问题。',





            '-',
            '-',
            '-',



            '11.24',
            '新增模型选择功能，可选择最新的Gemini 3 文本模型和图片模型（图片模型仅限付费API可以使用）',
            '如果更新版本使用有问题可从历史版本切换使用老版本',
            '其他小功能优化',
            '-',
            '-',
            '-',



            '11.21',
            '填写谷歌邮箱即可解锁云端同步保存预设功能和批量预设API KEY功能',
            '新增即时翻译功能 - 按需翻译文字和图片',
            '新增输入api key功能，支持批量输入api key，开启api key自动循环使用功能（测试使用，如果有问题及时反馈）',
            '新增帮助文档 - 快速上手使用指南'
        ]
    }
};

export const UpdateNotice: React.FC<UpdateNoticeProps> = ({ onClose, language }) => {
    const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

    const t = (key: 'title' | 'features' | 'fixes' | 'dismiss' | 'details' | 'versionHistory' | 'currentVersion' | 'visitVersion') => {
        const translations = {
            en: {
                title: 'New Update',
                features: 'New Features',
                fixes: 'Bug Fixes',
                dismiss: 'Got it',
                details: 'View Details',
                versionHistory: 'Version History',
                currentVersion: 'Current',
                visitVersion: 'Visit'
            },
            zh: {
                title: '新版本更新',
                features: '新功能',
                fixes: '问题修复',
                dismiss: '知道了',
                details: '查看详情',
                versionHistory: '历史版本',
                currentVersion: '当前版本',
                visitVersion: '访问'
            }
        };
        return translations[language][key];
    };

    const features = latestUpdate.features[language];
    const fixes = latestUpdate.fixes?.[language];

    const handleVersionClick = (url: string, isCurrent?: boolean) => {
        if (isCurrent) return; // 当前版本不跳转
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="update-notice-overlay" onClick={onClose}>
            <div className="update-notice-panel" onClick={(e) => e.stopPropagation()}>
                <div className="update-notice-header">
                    <h3>
                        🎉 {t('title')} - {latestUpdate.version}
                    </h3>
                    <button className="update-notice-close" onClick={onClose}>×</button>
                </div>

                <div className="update-notice-content">
                    <div className="update-section">
                        <h4>✨ {t('features')}</h4>
                        <ul>
                            {features.map((feature, index) => (
                                <li key={index}>{feature}</li>
                            ))}
                        </ul>
                    </div>

                    {fixes && fixes.length > 0 && (
                        <div className="update-section">
                            <h4>🐛 {t('fixes')}</h4>
                            <ul>
                                {fixes.map((fix, index) => (
                                    <li key={index}>{fix}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* 历史版本区域 (Moved out of content) */}
                </div>

                <div className="version-history-section fixed-bottom">
                    <div
                        className="version-history-header"
                        onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                    >
                        <h4>📚 {t('versionHistory')}</h4>
                        <span className={`expand-icon ${isHistoryExpanded ? 'expanded' : ''}`}>
                            ▼
                        </span>
                    </div>

                    {isHistoryExpanded && (
                        <div className="version-history-list">
                            {versionHistory.map((version) => (
                                <div
                                    key={version.version}
                                    className={`version-item ${version.isCurrent ? 'current' : ''}`}
                                >
                                    <div className="version-info">
                                        <span className="version-number">{version.version}</span>
                                        <span className="version-date">{version.date}</span>
                                        <span className="version-description">{version.description}</span>
                                    </div>
                                    <button
                                        className={`version-btn ${version.isCurrent ? 'current' : ''}`}
                                        onClick={() => handleVersionClick(version.url, version.isCurrent)}
                                        disabled={version.isCurrent}
                                    >
                                        {version.isCurrent ? t('currentVersion') : t('visitVersion')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="update-notice-footer">
                    <button className="update-dismiss-btn" onClick={onClose}>
                        {t('dismiss')}
                    </button>
                </div>
            </div>
        </div>
    );
};

// 检查是否有新更新
export const hasNewUpdate = (): boolean => {
    const lastSeenVersion = localStorage.getItem('ai-toolkit-last-seen-version');
    return lastSeenVersion !== latestUpdate.version;
};

// 标记已查看
export const markUpdateAsSeen = (): void => {
    localStorage.setItem('ai-toolkit-last-seen-version', latestUpdate.version);
};
