
import { GridData, ToolType, GridSelection, ProcessOptions } from '../types';

// --- Helper Functions ---

export function colToLetter(col: number): string {
  let temp = '';
  let c = col + 1;
  while (c > 0) {
    let rem = (c - 1) % 26;
    temp = String.fromCharCode(65 + rem) + temp;
    c = Math.floor((c - 1) / 26);
  }
  return temp;
}

// Helper: Remove leading empty lines from text
function trimLeadingEmptyLines(text: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  return lines.join('\n');
}

function splitThreeParts(text: string) {
  text = (text || '').toString().trim();
  if (!text) return { title: '', content: '', ending: '' };

  // Split into lines and filter out leading empty lines
  let lines = text.split(/\r?\n/);
  // Remove leading empty lines
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  if (lines.length > 1) {
    // Also filter content's leading empty lines
    const contentLines = lines.slice(1, -1);
    while (contentLines.length > 0 && contentLines[0].trim() === '') {
      contentLines.shift();
    }
    return {
      title: lines[0].trim(),
      content: contentLines.join('\n').trim(),
      ending: lines[lines.length - 1].trim()
    };
  } else {
    const sentences = text.match(/[^。！？?!]+[。！？?!]?/g);
    if (sentences && sentences.length > 1) {
      return {
        title: sentences[0].trim(),
        content: sentences.slice(1, -1).join('').trim(),
        ending: sentences[sentences.length - 1].trim()
      };
    } else {
      return { title: text.trim(), content: '', ending: '' };
    }
  }
}

function splitTwoParts(text: string) {
  text = (text || '').toString().trim();
  if (!text) return { title: '', content: '' };

  // Split into lines and filter out leading empty lines
  let lines = text.split(/\r?\n/);
  // Remove leading empty lines
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  if (lines.length > 1) {
    // Also filter content's leading empty lines
    const contentLines = lines.slice(1);
    while (contentLines.length > 0 && contentLines[0].trim() === '') {
      contentLines.shift();
    }
    return {
      title: lines[0].trim(),
      content: contentLines.join('\n').trim()
    };
  } else {
    const sentences = text.match(/[^。！？?!]+[。！？?!]?/g);
    if (sentences && sentences.length > 1) {
      return {
        title: sentences[0].trim(),
        content: sentences.slice(1).join('').trim()
      };
    } else {
      return { title: text.trim(), content: '' };
    }
  }
}

// --- Main Grid Processor ---

export const processGrid = (
  grid: GridData,
  selection: GridSelection,
  tool: ToolType,
  options: ProcessOptions = {}
): { newGrid: GridData, updatedCols: number[] } => {
  const { clearSource = false } = options;

  // Deep copy grid
  const newGrid = grid.map(row => [...row]);
  const updatedCols: number[] = [];

  const minR = Math.min(selection.start.row, selection.end.row);
  const maxR = Math.max(selection.start.row, selection.end.row);
  const minC = Math.min(selection.start.col, selection.end.col);
  const maxC = Math.max(selection.start.col, selection.end.col);

  // Logic branch: In-place modification (Cleaning) vs Expansion (Split/Prompt)

  if (tool === ToolType.CleanBreaks) {
    // Apply to EVERY cell in the selection
    for (let r = minR; r <= maxR; r++) {
      if (!newGrid[r]) newGrid[r] = [];
      for (let c = minC; c <= maxC; c++) {
        const val = newGrid[r][c] || '';
        const cleaned = val.replace(/\r?\n+/g, ' ').replace(/ {2,}/g, ' ').trim();
        newGrid[r][c] = cleaned;
      }
    }
    // Mark these columns as updated
    for (let c = minC; c <= maxC; c++) updatedCols.push(c);
  }
  else if (tool === ToolType.ClearChinese) {
    // Delete cells that contain Chinese HANZI characters (only in selected area)
    // Only match actual Chinese characters (CJK Unified Ideographs), NOT punctuation
    const hanziRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
    // Chinese punctuation pattern (for detection only, not deletion)
    const chinesePunctuationRegex = /[\u3000-\u303f\uff00-\uffef\u2000-\u206f]/;

    let deletedCount = 0;
    let punctuationOnlyCount = 0;

    for (let r = minR; r <= maxR; r++) {
      if (!newGrid[r]) newGrid[r] = [];
      for (let c = minC; c <= maxC; c++) {
        const val = newGrid[r][c] || '';
        if (!val) continue;

        // Check if cell contains actual Chinese characters (hanzi)
        if (hanziRegex.test(val)) {
          newGrid[r][c] = '';
          deletedCount++;
        }
        // Check if cell only has Chinese punctuation (no hanzi)
        else if (chinesePunctuationRegex.test(val)) {
          punctuationOnlyCount++;
          // Don't delete - just count for reporting
        }
      }
    }
    // Mark these columns as updated
    for (let c = minC; c <= maxC; c++) updatedCols.push(c);

    // Store stats in a special way (we'll use a convention)
    // Add negative numbers at the end to signal stats: -deletedCount, -punctuationOnlyCount
    if (deletedCount > 0 || punctuationOnlyCount > 0) {
      updatedCols.push(-1000 - deletedCount);  // Signal: deleted count
      updatedCols.push(-2000 - punctuationOnlyCount);  // Signal: punctuation only count
    }
  }
  else {
    // Split/Prompt Logic:
    // For SplitThree/SplitTwo: Process EACH column in selection, output to its right side
    // For VideoPrompts: Only process leftmost column (special 3-row grouping logic)

    if (tool === ToolType.VideoPrompts) {
      // VideoPrompts: Only use leftmost column, group every 3 valid rows
      const sourceCol = minC;
      updatedCols.push(sourceCol + 1);

      const validRowIndices: number[] = [];
      for (let r = minR; r <= maxR; r++) {
        const val = newGrid[r]?.[sourceCol];
        if (val && val.trim() !== "") {
          validRowIndices.push(r);
        }
      }

      for (let i = 0; i < validRowIndices.length; i += 3) {
        const idx1 = validRowIndices[i];
        const idx2 = validRowIndices[i + 1];
        const idx3 = validRowIndices[i + 2];

        const left = newGrid[idx1][sourceCol] || "";
        const center = idx2 !== undefined ? (newGrid[idx2][sourceCol] || "") : "";
        const right = idx3 !== undefined ? (newGrid[idx3][sourceCol] || "") : "";

        const prompt =
          `16:9 widescreen video in a triple-split screen format showing three screens.\n` +
          `- **Left**: ${left}\n` +
          `- **Center**: ${center}\n` +
          `- **Right**: ${right}`;

        while (newGrid[idx1].length <= sourceCol + 1) newGrid[idx1].push('');
        newGrid[idx1][sourceCol + 1] = prompt;
      }
    }
    else {
      // SplitThree / SplitTwo: Process EACH selected column that HAS CONTENT
      // 
      // KEY LOGIC:
      // - "Source columns" = columns in selection that HAVE content (not empty)
      // - "Target columns" = empty columns where split results go
      // - When clearSource is enabled, ONLY delete source columns (columns that had content)

      // Step 1: Find which columns in selection actually have content
      const sourceColumnsWithContent: Set<number> = new Set();
      const originalContent: Map<number, string[]> = new Map();

      for (let c = minC; c <= maxC; c++) {
        const colContent: string[] = [];
        let hasAnyContent = false;

        for (let r = minR; r <= maxR; r++) {
          const cellVal = newGrid[r]?.[c] || '';
          colContent.push(cellVal);
          if (cellVal.trim() !== '') {
            hasAnyContent = true;
          }
        }

        // Only mark as source column if it has content
        if (hasAnyContent) {
          sourceColumnsWithContent.add(c);
          originalContent.set(c, colContent);
        }
      }

      // Step 2: Process source columns from RIGHT to LEFT
      const sortedSourceCols = Array.from(sourceColumnsWithContent).sort((a, b) => b - a);

      for (const srcCol of sortedSourceCols) {
        const colOriginal = originalContent.get(srcCol) || [];

        for (let r = minR; r <= maxR; r++) {
          if (!newGrid[r]) newGrid[r] = [];
          const cellContent = colOriginal[r - minR] || '';

          if (tool === ToolType.SplitThree) {
            const res = splitThreeParts(cellContent);
            while (newGrid[r].length <= srcCol + 3) newGrid[r].push('');
            newGrid[r][srcCol + 1] = res.title;
            newGrid[r][srcCol + 2] = res.content;
            newGrid[r][srcCol + 3] = res.ending;
            if (!updatedCols.includes(srcCol + 1)) updatedCols.push(srcCol + 1);
            if (!updatedCols.includes(srcCol + 2)) updatedCols.push(srcCol + 2);
            if (!updatedCols.includes(srcCol + 3)) updatedCols.push(srcCol + 3);
          }
          else if (tool === ToolType.SplitTwo) {
            const res = splitTwoParts(cellContent);
            while (newGrid[r].length <= srcCol + 2) newGrid[r].push('');
            newGrid[r][srcCol + 1] = res.title;
            newGrid[r][srcCol + 2] = res.content;
            if (!updatedCols.includes(srcCol + 1)) updatedCols.push(srcCol + 1);
            if (!updatedCols.includes(srcCol + 2)) updatedCols.push(srcCol + 2);
          }
        }
      }

      // Step 3: If clearSource, ONLY delete columns that originally had content
      if (clearSource) {
        for (const srcCol of sourceColumnsWithContent) {
          for (let r = minR; r <= maxR; r++) {
            if (newGrid[r]) {
              newGrid[r][srcCol] = '';
            }
          }
          if (!updatedCols.includes(srcCol)) updatedCols.push(srcCol);
        }
      }
    }
  }

  return { newGrid, updatedCols: Array.from(new Set(updatedCols)) };
};

// --- Clipboard Helpers ---

export const parsePasteData = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuote) {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++;
        } else {
          insideQuote = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuote = true;
      } else if (char === '\t') {
        currentRow.push(currentCell);
        currentCell = '';
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentCell);
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && lastRow[0] === '') {
      rows.pop();
    }
  }

  return rows;
};

export const formatForClipboard = (grid: GridData): string => {
  return grid.map(row => {
    return row.map(cell => {
      if (cell === null || cell === undefined) return '';
      if (/[\t\n\r"]/.test(cell)) {
        const escaped = cell.replace(/"/g, '""');
        return `"${escaped}"`;
      }
      return cell;
    }).join('\t');
  }).join('\n');
};
