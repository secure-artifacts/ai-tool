// 文档解析服务
// 支持 PDF、Word (docx)、TXT 格式

import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// 设置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface DocumentParseResult {
    success: boolean;
    text?: string;
    title?: string;
    sections?: DocumentSection[];
    error?: string;
}

export interface DocumentSection {
    level: number;
    title: string;
    content: string;
}

export class DocumentService {
    /**
     * 解析各种格式的文档
     */
    async parseDocument(file: File): Promise<DocumentParseResult> {
        const fileName = file.name.toLowerCase();

        try {
            if (fileName.endsWith('.pdf')) {
                return await this.parsePDF(file);
            } else if (fileName.endsWith('.docx')) {
                return await this.parseDocx(file);
            } else if (fileName.endsWith('.txt')) {
                return await this.parseTxt(file);
            } else {
                return { success: false, error: '不支持的文件格式' };
            }
        } catch (error) {
            console.error('文档解析失败:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '文档解析失败',
            };
        }
    }

    /**
     * 解析 PDF 文档
     */
    private async parsePDF(file: File): Promise<DocumentParseResult> {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        const textParts: string[] = [];
        const sections: DocumentSection[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            let pageText = '';
            let lastY = -1;

            for (const item of textContent.items) {
                if ('str' in item) {
                    // 检测换行（Y坐标变化）
                    if (lastY !== -1 && Math.abs((item as any).transform[5] - lastY) > 5) {
                        pageText += '\n';
                    }
                    pageText += item.str;
                    lastY = (item as any).transform[5];
                }
            }

            textParts.push(pageText);
        }

        const fullText = textParts.join('\n\n');

        // 尝试提取标题和章节
        const lines = fullText.split('\n').filter(l => l.trim());
        const title = lines[0] || file.name.replace('.pdf', '');

        // 简单的章节识别
        let currentSection: DocumentSection | null = null;
        for (const line of lines) {
            const trimmed = line.trim();
            // 检测标题行（数字开头或特定格式）
            if (/^(\d+[\.\、]|[一二三四五六七八九十]+[\.\、])/.test(trimmed) ||
                /^(第[一二三四五六七八九十\d]+章|Chapter\s+\d+)/i.test(trimmed)) {
                if (currentSection) {
                    sections.push(currentSection);
                }
                currentSection = {
                    level: 1,
                    title: trimmed,
                    content: '',
                };
            } else if (currentSection) {
                currentSection.content += trimmed + '\n';
            }
        }
        if (currentSection) {
            sections.push(currentSection);
        }

        return {
            success: true,
            text: fullText,
            title,
            sections: sections.length > 0 ? sections : undefined,
        };
    }

    /**
     * 解析 Word 文档
     */
    private async parseDocx(file: File): Promise<DocumentParseResult> {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });

        const fullText = result.value;
        const lines = fullText.split('\n').filter(l => l.trim());
        const title = lines[0] || file.name.replace('.docx', '');

        // 章节识别
        const sections: DocumentSection[] = [];
        let currentSection: DocumentSection | null = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (/^(\d+[\.\、]|[一二三四五六七八九十]+[\.\、])/.test(trimmed)) {
                if (currentSection) {
                    sections.push(currentSection);
                }
                currentSection = {
                    level: 1,
                    title: trimmed,
                    content: '',
                };
            } else if (currentSection) {
                currentSection.content += trimmed + '\n';
            }
        }
        if (currentSection) {
            sections.push(currentSection);
        }

        return {
            success: true,
            text: fullText,
            title,
            sections: sections.length > 0 ? sections : undefined,
        };
    }

    /**
     * 解析纯文本文件
     */
    private async parseTxt(file: File): Promise<DocumentParseResult> {
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        const title = lines[0] || file.name.replace('.txt', '');

        return {
            success: true,
            text,
            title,
        };
    }
}

export const documentService = new DocumentService();
