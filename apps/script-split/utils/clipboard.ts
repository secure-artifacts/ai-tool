import { GridData, GridStyles, cellKey } from '../types';

export type CopyResult = 'rich' | 'text' | 'failed';

const escapeHtml = (text: string) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
};

const escapeHtmlAttribute = (text: string) => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const buildGoogleSheetsHtml = (
  grid: GridData,
  options: {
    styles?: GridStyles;
    rowOffset?: number;
    colOffset?: number;
    includeEmptyRows?: boolean;
  } = {}
) => {
  const {
    styles,
    rowOffset = 0,
    colOffset = 0,
    includeEmptyRows = true
  } = options;

  let html = `<meta charset="utf-8"><google-sheets-html-origin><style type="text/css">
    table { border-collapse: collapse; }
    td { border: 1px solid #ccc; padding: 2px 4px; }
  </style><table>`;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];

    if (!includeEmptyRows) {
      const hasContent = row.some(cell => cell && cell.trim());
      let hasStyle = false;

      if (styles && !hasContent) {
        for (let c = 0; c < row.length; c++) {
          const style = styles.get(cellKey(r + rowOffset, c + colOffset));
          if (style?.bgColor) {
            hasStyle = true;
            break;
          }
        }
      }

      if (!hasContent && !hasStyle) {
        continue;
      }
    }

    html += '<tr>';
    for (let c = 0; c < row.length; c++) {
      const cellValue = row[c] ?? '';
      const style = styles?.get(cellKey(r + rowOffset, c + colOffset));
      const bgColor = style?.bgColor;
      const styleAttr = bgColor ? ` style="background-color:${bgColor};"` : '';
      const bgAttr = bgColor ? ` bgcolor="${bgColor}"` : '';
      const dataValue = cellValue
        ? ` data-sheets-value="${escapeHtmlAttribute(JSON.stringify({ 1: 2, 2: cellValue }))}"`
        : '';

      html += `<td${styleAttr}${bgAttr}${dataValue}>${escapeHtml(cellValue)}</td>`;
    }
    html += '</tr>';
  }

  html += '</table>';
  return html;
};

const copyWithExecCommand = (text: string, html?: string) => {
  if (typeof document === 'undefined') return false;

  const selection = window.getSelection();
  const range = document.createRange();
  const holder = document.createElement('span');
  holder.textContent = text || '';
  holder.style.position = 'fixed';
  holder.style.top = '-9999px';
  holder.style.left = '-9999px';
  holder.setAttribute('aria-hidden', 'true');
  document.body.appendChild(holder);

  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const handleCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    if (!event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    if (html) {
      event.clipboardData.setData('text/html', html);
    }
  };

  document.addEventListener('copy', handleCopy);
  const success = document.execCommand('copy');
  document.removeEventListener('copy', handleCopy);

  selection?.removeAllRanges();
  document.body.removeChild(holder);

  return success;
};

export const copyToClipboard = async (text: string, html?: string): Promise<CopyResult> => {
  if (html && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })
      ]);
      return 'rich';
    } catch (err) {
      console.warn('Rich clipboard write failed, falling back.', err);
    }
  }

  if (html && copyWithExecCommand(text, html)) {
    return 'rich';
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'text';
    } catch (err) {
      console.warn('Text clipboard write failed, falling back.', err);
    }
  }

  if (copyWithExecCommand(text)) {
    return 'text';
  }

  return 'failed';
};
