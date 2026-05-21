const CONFIG = {
  SHEET_NAME: '', // 留空=当前激活工作表；可填固定表名
  HEADER_ROW: 2, // 第2行是标题行
  DATA_START_ROW: 3, // 默认数据起始行（未配置时）
  COL: {
    defaultPreview: '成品-单链接',
    reviewer: '审核人员1',
    reviewResult: '审核结果1',
    severity: '严重程度',
    shotLink: '建议截图链接',
    shotFormula: '建议截图公式',
    textAdvice: '文字建议'
  },
  DEFAULT_REVIEW_RESULT: '需修改'
};

// Gyazo token 读取优先级：
// 1) Apps Script Script Properties: GYAZO_ACCESS_TOKEN
// 2) 下面的默认 token（本地内置回退）
const GYAZO_ACCESS_TOKEN_FALLBACK = 'W0SHYCmn38FEoNQEdu7GwT1bOJP84TjQadGjlSgbG6I';

const SETTINGS_VERSION = 3;
const SETTINGS_PROPERTY_PREFIX = 'feedback_canvas_settings_v1_';
const PANEL_DEFAULT_HEADERS = ['提交人员', '成品-单链接'];
const ROW_STALE_ERROR_MESSAGE = '未能定位到原始记录（可能已被删除或内容被整体替换），本次为保护数据未写入。';
const UNIQUE_ID_COLUMN_LETTER = 'V';
const UNIQUE_ID_HEADER_CANDIDATES = ['ID', 'Id', 'id', '唯一ID', '唯一Id', '唯一id', 'rowId', 'RowId', 'ROW_ID'];

const COLUMN_FIELDS = [
  { key: 'preview', label: '预览来源列', defaultHeader: CONFIG.COL.defaultPreview },
  { key: 'reviewer', label: '审核人列', defaultHeader: CONFIG.COL.reviewer },
  { key: 'reviewerOptionsSource', label: '审核人选项来源', defaultHeader: CONFIG.COL.reviewer, optional: true, allowRange: true, defaultRange: '数据验证!A:A' },
  { key: 'reviewResult', label: '审核状态列', defaultHeader: CONFIG.COL.reviewResult },
  { key: 'reviewResultOptionsSource', label: '审核状态选项来源', defaultHeader: CONFIG.COL.reviewResult, optional: true, allowRange: true, defaultRange: '数据验证!C:C' },
  { key: 'severity', label: '严重程度列', defaultHeader: CONFIG.COL.severity, optional: true },
  { key: 'severityOptionsSource', label: '严重程度选项来源', defaultHeader: CONFIG.COL.severity, optional: true, allowRange: true, defaultRange: '数据验证!D:D' },
  { key: 'shotLink', label: '标注链接列', defaultHeader: CONFIG.COL.shotLink },
  { key: 'shotFormula', label: '缩略图列', defaultHeader: CONFIG.COL.shotFormula },
  { key: 'textAdvice', label: '建议反馈列', defaultHeader: CONFIG.COL.textAdvice }
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧾 反馈画布')
    .addItem('🖼 打开反馈弹框', 'openFeedbackDialog')
    .addToUi();
}

function openFeedbackDialog() {
  const html = HtmlService.createHtmlOutputFromFile('feedback_dialog')
    .setWidth(1240)
    .setHeight(920);
  SpreadsheetApp.getUi().showModelessDialog(html, '\u200B');
}

function openMiniDialog() {
  const html = HtmlService.createHtmlOutput('<div style="display:flex;height:100%;align-items:center;justify-content:center;font-family:sans-serif;background:#f7f8fb;"><button onclick="google.script.run.openFeedbackDialog();" style="padding:10px 20px;background:#2d4bd3;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;box-shadow:0 2px 5px rgba(0,0,0,0.2);">🖥️ 恢复完整审核窗口</button></div>')
    .setWidth(300)
    .setHeight(100);
  SpreadsheetApp.getUi().showModelessDialog(html, '迷你模式');
}

function normalizeHeaderRow_(value) {
  const n = Number(value || 0);
  if (!n || n < 1) return CONFIG.HEADER_ROW;
  if (n > 2000) return 2000;
  return Math.floor(n);
}

function getHeaderRowFromSettingsLike_(settingsLike) {
  return normalizeHeaderRow_(settingsLike && settingsLike.headerRow);
}

function getDataStartRowByHeaderRow_(headerRow) {
  const h = normalizeHeaderRow_(headerRow);
  return h + 1;
}

function resolveRuntimeContext_(sheet, incomingSettings) {
  const source = incomingSettings || getSavedSettings_(sheet);
  let headerRow = getHeaderRowFromSettingsLike_(source);
  let headers = getHeaders_(sheet, headerRow);
  let settings = getEffectiveSettings_(sheet, incomingSettings, headers, headerRow);

  if (settings.headerRow !== headerRow) {
    headerRow = settings.headerRow;
    headers = getHeaders_(sheet, headerRow);
    settings = getEffectiveSettings_(sheet, settings, headers, headerRow);
  }

  const map = getHeaderMap_(sheet, settings.headerRow);
  const cols = resolveColumns_(sheet, map, settings);
  return {
    settings: settings,
    headers: headers,
    map: map,
    cols: cols,
    dataStartRow: settings.dataStartRow
  };
}

/** 初始化：读取当前选中的行 + 表头 + 用户设置（快速骨架版，不含行数据） */
function getDialogInit() {
  var t0 = Date.now();
  const sheet = getTargetSheet_();
  const rawSettings = getSavedSettings_(sheet);
  const rawHeaderRow = getHeaderRowFromSettingsLike_(rawSettings);
  const headers0 = getHeaders_(sheet, rawHeaderRow);
  const settings = getEffectiveSettings_(sheet, null, headers0, rawHeaderRow);

  const headerRow = settings.headerRow;
  const dataStartRow = settings.dataStartRow;
  const headers = getHeaders_(sheet, headerRow);
  const headerOptions = getHeaderOptions_(sheet, headerRow);
  let selectedRows = getSelectedRows_(sheet, dataStartRow);
  if (!selectedRows.length) {
    throw new Error('请先选中一行或多行数据（第' + dataStartRow + '行及以后），再打开反馈弹框。');
  }
  
  // 安全限制：初始化最多只处理前 500 行，防止大数据量导致超长加载或崩溃
  const MAX_INIT_ROWS = 500;
  let isTruncated = false;
  if (selectedRows.length > MAX_INIT_ROWS) {
    selectedRows = selectedRows.slice(0, MAX_INIT_ROWS);
    isTruncated = true;
  }
  console.log('[Init] 准备阶段: ' + (Date.now() - t0) + 'ms, 选中 ' + selectedRows.length + ' 行');

  var t1 = Date.now();
  ensureUniqueIdsForRows_(sheet, selectedRows);
  console.log('[Init] ensureUniqueIds: ' + (Date.now() - t1) + 'ms');

  var t2 = Date.now();
  const map = getHeaderMap_(sheet, headerRow);
  const cols = resolveColumns_(sheet, map, settings);
  settings.panelHeaders = normalizePanelHeaders_(null, settings, headers, cols, map);
  console.log('[Init] resolveColumns: ' + (Date.now() - t2) + 'ms');

  // 快速返回：跳过 buildRowsBatchPayload_，让前端异步加载行数据
  console.log('[Init] 骨架返回（跳过行数据）, 总耗时: ' + (Date.now() - t0) + 'ms');

  return {
    sheetName: sheet.getName(),
    headerRow: headerRow,
    dataStartRow: dataStartRow,
    selectedRows: selectedRows,
    viewHeaders: headers,
    headerOptions: headerOptions,
    defaultViewHeader: '__CONFIG__',
    defaultReviewer: safeCurrentUserEmail_(),
    fieldDefs: COLUMN_FIELDS,
    settings: settings,
    rowsData: [],
    panelHeaders: settings.panelHeaders || [],
    panelHeaderCandidates: headers
  };
}

/** 保存列映射设置（支持按表头或按列字母） */
function saveDialogSettings(payload) {
  const sheet = getTargetSheet_(payload && payload.sheetName);
  const incoming = payload && payload.settings;
  let source = incoming || getSavedSettings_(sheet);
  if (incoming) {
    // 保存时先按“本次提交的列配置”解析，再由后续逻辑判断是否应回落为默认模式。
    source = JSON.parse(JSON.stringify(incoming));
    source.columnMappingMode = 'custom';
  }
  const rawHeaderRow = getHeaderRowFromSettingsLike_(source);
  const headers0 = getHeaders_(sheet, rawHeaderRow);
  const settings = normalizeSettings_(source, headers0, rawHeaderRow);
  const headers = getHeaders_(sheet, settings.headerRow);
  const map = getHeaderMap_(sheet, settings.headerRow);
  settings.columnMappingMode = inferColumnMappingMode_(sheet, map, settings);
  if (settings.columnMappingMode !== 'custom') {
    settings.columns = buildDefaultSettings_().columns;
  }
  const cols = resolveColumns_(sheet, map, settings);
  settings.panelHeaders = normalizePanelHeaders_(
    payload && payload.panelHeaders,
    settings,
    headers,
    cols,
    map
  );

  // 校验按范围配置是否可读取
  validateRangeOptionSettings_(sheet.getParent(), settings);

  saveUserSettings_(sheet, settings);
  return { ok: true, settings: settings };
}

/** 批量读取选中行数据（用于左侧面板和本地缓存，提升切换速度） */
function getRowsBatchData(payload) {
  const sheet = getTargetSheet_(payload && payload.sheetName);
  const incoming = payload && payload.settings;
  const rawHeaderRow = getHeaderRowFromSettingsLike_(incoming || getSavedSettings_(sheet));
  const headers0 = getHeaders_(sheet, rawHeaderRow);
  const settings = getEffectiveSettings_(sheet, incoming, headers0, rawHeaderRow);
  const headers = getHeaders_(sheet, settings.headerRow);
  var selectedRows = normalizeRows_(
    (payload && payload.rows) || getSelectedRows_(sheet, settings.dataStartRow),
    settings.dataStartRow
  );
  if (!selectedRows.length) {
    throw new Error('没有可读取的行。');
  }
  ensureUniqueIdsForRows_(sheet, selectedRows);

  // === UUID 行号重定位 ===
  // 当前端传入 rowIdMap（行号→UUID 映射）时，验证每行的 UUID 是否仍然正确
  // 如果有人插入/删除了行导致行号移位，自动定位到正确的行
  var rowMappings = [];
  var rowIdMap = payload && payload.rowIdMap;
  if (rowIdMap && typeof rowIdMap === 'object') {
    var idCol = getUniqueIdColumnIndex_(sheet, settings.headerRow);
    var lastRow = sheet.getLastRow();
    var allIds = null; // 延迟加载整列 UUID

    var relocatedRows = [];
    for (var ri = 0; ri < selectedRows.length; ri++) {
      var requestedRow = selectedRows[ri];
      var expectedId = String(rowIdMap[requestedRow] || '').trim();
      if (!expectedId) {
        relocatedRows.push(requestedRow);
        continue;
      }

      // 检查当前行的 UUID 是否匹配
      var currentId = '';
      if (idCol && requestedRow >= 1 && requestedRow <= lastRow) {
        currentId = String(sheet.getRange(requestedRow, idCol).getDisplayValue() || '').trim();
      }

      if (currentId === expectedId) {
        relocatedRows.push(requestedRow);
        continue;
      }

      // UUID 不匹配 → 搜索整列找到正确的行
      if (!allIds && idCol && lastRow >= settings.dataStartRow) {
        allIds = sheet.getRange(settings.dataStartRow, idCol, lastRow - settings.dataStartRow + 1, 1).getDisplayValues();
      }

      var found = 0;
      if (allIds) {
        for (var si = 0; si < allIds.length; si++) {
          if (String(allIds[si][0] || '').trim() === expectedId) {
            found = settings.dataStartRow + si;
            break;
          }
        }
      }

      if (found && found !== requestedRow) {
        console.log('[BatchData] 行 ' + requestedRow + ' UUID 移位到 ' + found);
        relocatedRows.push(found);
        rowMappings.push({ from: requestedRow, to: found });
      } else {
        relocatedRows.push(requestedRow);
      }
    }

    selectedRows = normalizeRows_(relocatedRows, settings.dataStartRow);
  }

  const map = getHeaderMap_(sheet, settings.headerRow);
  const cols = resolveColumns_(sheet, map, settings);
  const batch = buildRowsBatchPayload_(
    sheet,
    headers,
    selectedRows,
    settings,
    map,
    cols,
    payload && payload.panelHeaders,
    { skipDriveInfer: true }
  );

  return {
    rowsData: batch.rowsData,
    panelHeaders: batch.panelHeaders,
    panelHeaderCandidates: headers,
    headerOptions: getHeaderOptions_(sheet, settings.headerRow),
    headerRow: settings.headerRow,
    dataStartRow: settings.dataStartRow,
    settings: settings,
    rowMappings: rowMappings
  };
}

function buildRowsBatchPayload_(sheet, headers, selectedRows, settings, map, cols, panelHeadersInput, opts) {
  var skipDriveInfer = !!(opts && opts.skipDriveInfer);
  const panelHeaders = normalizePanelHeaders_(
    panelHeadersInput,
    settings,
    headers,
    cols,
    map
  );

  const rowsData = [];
  if (!selectedRows.length) {
    return { rowsData: rowsData, panelHeaders: panelHeaders };
  }
  const dataStartRow = Number(settings && settings.dataStartRow || getDataStartRowByHeaderRow_(CONFIG.HEADER_ROW));

  const lastCol = sheet.getLastColumn();
  const rowSegments = splitRowsToSegments_(selectedRows);
  const previewCol = cols.preview || 0;
  const optionMetaCache = {};
  const previewFileNameLookupCache = {};
  const uniqueIdCol = getUniqueIdColumnIndex_(sheet, settings && settings.headerRow);

  // 性能优化：提前为整个所选范围获取一次 API 数据，避免在循环段中重复发起网络请求
  let batchPreviewApiHints = {};
  if (previewCol && selectedRows.length > 0) {
    const minRow = selectedRows[0];
    const maxRow = selectedRows[selectedRows.length - 1];
    const totalSpan = maxRow - minRow + 1;
    // 降低阈值避免大范围 API 调用阻塞
    if (totalSpan <= 300) {
      var tApi = Date.now();
      try {
        const hints = getPreviewUrlsFromApiRange_(sheet, minRow, totalSpan, previewCol);
        for (var i = 0; i < (hints || []).length; i++) {
          if (hints[i]) batchPreviewApiHints[minRow + i] = hints[i];
        }
      } catch (e) {
        console.error('API 批量预取失败: ' + e);
      }
      console.log('[Batch] API预取: ' + (Date.now() - tApi) + 'ms, span=' + totalSpan);
    } else {
      console.log('[Batch] 跳过API预取, span=' + totalSpan + ' 超过300');
    }
  }

  for (var s = 0; s < rowSegments.length; s++) {
    const seg = rowSegments[s];
    const segSpan = seg.end - seg.start + 1;
    const fullDisplay = sheet.getRange(seg.start, 1, segSpan, lastCol).getDisplayValues();

    let previewRawValues = [];
    let previewFormulas = [];
    let previewRichTexts = [];
    let previewNotes = [];
    let previewResolvedUrls = [];
    let uniqueIdValues = [];
    if (previewCol) {
      const previewRange = sheet.getRange(seg.start, previewCol, segSpan, 1);
      previewRawValues = previewRange.getValues();
      previewFormulas = previewRange.getFormulas();
      previewRichTexts = previewRange.getRichTextValues();
      previewNotes = previewRange.getNotes();

      for (var p = 0; p < segSpan; p++) {
        const rowDisplay0 = fullDisplay[p] || [];
        const previewText0 = String(rowDisplay0[previewCol - 1] || '');
        const rawValue0 = previewRawValues[p] ? previewRawValues[p][0] : '';
        const formula0 = previewFormulas[p] ? previewFormulas[p][0] : '';
        const rich0 = previewRichTexts[p] ? previewRichTexts[p][0] : null;
        const note0 = previewNotes[p] ? previewNotes[p][0] : '';
        const baseUrl = extractPreviewUrlFromPrefetched_(previewText0, rawValue0, formula0, rich0, note0);
        previewResolvedUrls[p] = baseUrl || '';
      }
    }
    if (uniqueIdCol > 0) {
      uniqueIdValues = sheet.getRange(seg.start, uniqueIdCol, segSpan, 1).getDisplayValues();
    }

    for (var offset = 0; offset < segSpan; offset++) {
      const row = seg.start + offset;
      if (row < dataStartRow) continue;

      const rowDisplay = fullDisplay[offset] || [];
      const rowKey = buildRowIdentityKeyFromDisplay_(rowDisplay, cols);
      const cells = {};
      for (var h = 0; h < headers.length; h++) {
        const header = headers[h];
        const col = map[header];
        cells[header] = String(rowDisplay[col - 1] || '');
      }

      let previewText = '';
      let previewUrl = '';
      if (previewCol) {
        previewText = String(rowDisplay[previewCol - 1] || '');
        previewUrl = previewResolvedUrls[offset] || '';
        if (!previewUrl && batchPreviewApiHints[row]) {
          previewUrl = String(batchPreviewApiHints[row] || '');
        }
        if (!previewUrl && !skipDriveInfer) {
          previewUrl = inferDrivePreviewUrlFromFileName_(previewText, previewFileNameLookupCache);
        }
      }

      const severityCol = cols.severity || 0;
      const reviewerValidation = getOptionMetaBySetting_(
        sheet, row, settings, cols, 'reviewerOptionsSource', 'reviewer', optionMetaCache
      );
      const reviewResultValidation = getOptionMetaBySetting_(
        sheet, row, settings, cols, 'reviewResultOptionsSource', 'reviewResult', optionMetaCache
      );
      const severityValidation = getOptionMetaBySetting_(
        sheet, row, settings, cols, 'severityOptionsSource', 'severity', optionMetaCache
      );

      rowsData.push({
        row: row,
        rowId: uniqueIdValues[offset] ? String(uniqueIdValues[offset][0] || '').trim() : '',
        rowKey: rowKey,
        cells: cells,
        previewUrl: previewUrl,
        previewText: previewText,
        reviewer: String(rowDisplay[cols.reviewer - 1] || ''),
        reviewerOptions: reviewerValidation.options,
        reviewResult: String(rowDisplay[cols.reviewResult - 1] || ''),
        reviewResultOptions: reviewResultValidation.options,
        reviewResultStrict: reviewResultValidation.strict,
        severity: severityCol ? String(rowDisplay[severityCol - 1] || '') : '',
        severityOptions: severityValidation.options,
        severityStrict: severityValidation.strict,
        textAdvice: String(rowDisplay[cols.textAdvice - 1] || '')
      });
    }
  }

  return {
    rowsData: rowsData,
    panelHeaders: panelHeaders
  };
}

function normalizeIdentityText_(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function getUniqueIdColumnIndex_(sheet, headerRow) {
  if (sheet) {
    const map = getHeaderMap_(sheet, headerRow || CONFIG.HEADER_ROW);
    for (var i = 0; i < UNIQUE_ID_HEADER_CANDIDATES.length; i++) {
      const col = findHeaderMapColumn_(map, UNIQUE_ID_HEADER_CANDIDATES[i]);
      if (col) return col;
    }
  }
  return columnLetterToIndex_(UNIQUE_ID_COLUMN_LETTER);
}

function generateUniqueRowId_() {
  return Utilities.getUuid();
}

function ensureUniqueIdsForRows_(sheet, rows) {
  const list = normalizeRows_(rows, 1);
  if (!list.length) return;
  const idCol = getUniqueIdColumnIndex_(sheet);
  if (!idCol) return;

  const segments = splitRowsToSegments_(list);
  for (var i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const span = seg.end - seg.start + 1;
    const range = sheet.getRange(seg.start, idCol, span, 1);
    const values = range.getDisplayValues();
    let changed = false;
    for (var offset = 0; offset < span; offset++) {
      const cur = String(values[offset] && values[offset][0] || '').trim();
      if (cur) continue;
      values[offset][0] = generateUniqueRowId_();
      changed = true;
    }
    if (changed) {
      range.setValues(values);
    }
  }
}

function buildRowIdentityKeyFromDisplay_(rowDisplay, cols) {
  const list = Array.isArray(rowDisplay) ? rowDisplay : [];
  const excluded = {};
  const skipCols = [
    cols && cols.reviewer,
    cols && cols.reviewResult,
    cols && cols.severity,
    cols && cols.textAdvice,
    cols && cols.shotLink,
    cols && cols.shotFormula
  ];
  for (var i = 0; i < skipCols.length; i++) {
    const colNum = Number(skipCols[i] || 0);
    if (colNum > 0) excluded[colNum] = true;
  }

  const tokens = [];
  for (var c = 0; c < list.length; c++) {
    const col = c + 1;
    if (excluded[col]) continue;
    const value = normalizeIdentityText_(list[c]);
    if (!value) continue;
    tokens.push(col + ':' + value);
  }
  return tokens.length ? tokens.join('\u001f') : '__ROW_EMPTY__';
}

function getRowIdentityKey_(sheet, row, cols) {
  const rowNum = Number(row || 0);
  if (!rowNum || rowNum < 1) return '';
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return '';
  const rowDisplay = sheet.getRange(rowNum, 1, 1, lastCol).getDisplayValues()[0] || [];
  return buildRowIdentityKeyFromDisplay_(rowDisplay, cols);
}

function findRowByUniqueId_(sheet, rowId, ctx, preferredRow, usedRows) {
  const id = String(rowId || '').trim();
  if (!id) return 0;
  const idCol = getUniqueIdColumnIndex_(sheet, ctx && ctx.settings && ctx.settings.headerRow);
  if (!idCol) return 0;
  const dataStartRow = Math.max(Number(ctx && ctx.dataStartRow || 1), 1);
  const lastRow = sheet.getLastRow();
  if (lastRow < dataStartRow) return 0;

  const values = sheet.getRange(dataStartRow, idCol, lastRow - dataStartRow + 1, 1).getDisplayValues();
  const candidates = [];
  for (var i = 0; i < values.length; i++) {
    const row = dataStartRow + i;
    if (usedRows && usedRows[row]) continue;
    const curId = String(values[i] && values[i][0] || '').trim();
    if (curId === id) candidates.push(row);
  }
  if (!candidates.length) return 0;

  const preferred = Number(preferredRow || 0);
  candidates.sort(function(a, b) {
    const da = preferred > 0 ? Math.abs(a - preferred) : a;
    const db = preferred > 0 ? Math.abs(b - preferred) : b;
    if (da !== db) return da - db;
    return a - b;
  });
  return candidates[0];
}

function getUniqueRowId_(sheet, row) {
  const rowNum = Number(row || 0);
  if (!rowNum || rowNum < 1) return '';
  const idCol = getUniqueIdColumnIndex_(sheet);
  if (!idCol) return '';
  return String(sheet.getRange(rowNum, idCol).getDisplayValue() || '').trim();
}

function findRowByIdentityKey_(sheet, rowKey, ctx, preferredRow, usedRows) {
  const key = String(rowKey || '').trim();
  if (!key) return 0;
  const dataStartRow = Math.max(Number(ctx && ctx.dataStartRow || 1), 1);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < dataStartRow || !lastCol) return 0;

  const values = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastCol).getDisplayValues();
  const candidates = [];
  for (var i = 0; i < values.length; i++) {
    const row = dataStartRow + i;
    if (usedRows && usedRows[row]) continue;
    const candidateKey = buildRowIdentityKeyFromDisplay_(values[i] || [], ctx && ctx.cols);
    if (candidateKey === key) candidates.push(row);
  }
  if (!candidates.length) return 0;

  const preferred = Number(preferredRow || 0);
  candidates.sort(function(a, b) {
    const da = preferred > 0 ? Math.abs(a - preferred) : a;
    const db = preferred > 0 ? Math.abs(b - preferred) : b;
    if (da !== db) return da - db;
    return a - b;
  });
  return candidates[0];
}

function resolvePayloadRow_(sheet, requestedRow, rowId, rowKey, ctx, usedRows) {
  const row = Number(requestedRow || 0);
  if (!row || row < Number(ctx && ctx.dataStartRow || 1)) {
    throw new Error('行号无效');
  }
  const id = String(rowId || '').trim();
  if (id) {
    const currentId = getUniqueRowId_(sheet, row);
    if (currentId === id) return row;
    const byId = findRowByUniqueId_(sheet, id, ctx, row, usedRows);
    if (byId) return byId;
  }
  const key = String(rowKey || '').trim();
  if (key) {
    const currentKey = getRowIdentityKey_(sheet, row, ctx && ctx.cols);
    if (currentKey === key) return row;
    const relocated = findRowByIdentityKey_(sheet, key, ctx, row, usedRows);
    if (relocated) return relocated;
  }
  if (!id && !key) return row;
  throw new Error(ROW_STALE_ERROR_MESSAGE);
}

function withDocumentLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 兼容旧调用：读取单行 */
function getRowData(payload) {
  const batch = getRowsBatchData({
    sheetName: payload && payload.sheetName,
    rows: [payload && payload.row],
    settings: payload && payload.settings,
    panelHeaders: payload && payload.panelHeaders
  });
  if (!batch.rowsData.length) throw new Error('无效行号');
  return batch.rowsData[0];
}

/** 自动保存（不上传截图） */
function autoSaveFeedbackDraft(payload) {
  if (!payload || !payload.row) throw new Error('参数错误：缺少 row');

  const sheet = getTargetSheet_(payload.sheetName);
  const ctx = resolveRuntimeContext_(sheet, payload.settings);
  const row = Number(payload.row);
  const cols = ctx.cols;

  const reviewer = String(payload.reviewer || '').trim();
  const reviewResult = String(payload.reviewResult || '').trim();
  const severity = String(payload.severity || '').trim();
  const textAdvice = String(payload.textAdvice || '').trim();
  const forceWrite = payload && payload.forceWrite !== undefined
    ? !!payload.forceWrite
    : true;

  const resolvedRow = withDocumentLock_(function() {
    const targetRow = resolvePayloadRow_(sheet, row, payload.rowId, payload.rowKey, ctx);
    if (!shouldApplyClientWrite_(sheet, payload, targetRow)) {
      return targetRow;
    }
    writeFeedbackTextOnly_(sheet, targetRow, cols, reviewer, reviewResult, severity, textAdvice, {
      forceWrite: forceWrite,
      settings: ctx.settings
    });
    return targetRow;
  });

  return {
    ok: true,
    row: resolvedRow,
    rowId: getUniqueRowId_(sheet, resolvedRow),
    requestedRow: row,
    rowRelocated: resolvedRow !== row,
    savedAt: new Date().toISOString()
  };
}

/** 提交反馈（含可选截图上传） */
function submitFeedback(payload) {
  if (!payload || !payload.row) throw new Error('参数错误：缺少 row');

  const sheet = getTargetSheet_(payload.sheetName);
  const ctx = resolveRuntimeContext_(sheet, payload.settings);
  const row = Number(payload.row);
  const cols = ctx.cols;

  const reviewer = String(payload.reviewer || '').trim();
  const reviewResult = String(payload.reviewResult || '').trim() || CONFIG.DEFAULT_REVIEW_RESULT;
  const severity = String(payload.severity || '').trim();
  const textAdvice = String(payload.textAdvice || '').trim();

  const screenshotItems = payload.screenshotItems || [];
  const gyazoItems = [];

  const resolvedRow = withDocumentLock_(function() {
    const targetRow = resolvePayloadRow_(sheet, row, payload.rowId, payload.rowKey, ctx);
    if (!shouldApplyClientWrite_(sheet, payload, targetRow)) {
      return targetRow;
    }
    writeFeedbackTextOnly_(sheet, targetRow, cols, reviewer, reviewResult, severity, textAdvice, {
      forceWrite: !!(payload && payload.forceWrite),
      settings: ctx.settings
    });

    if (screenshotItems.length) {
      for (var i = 0; i < screenshotItems.length; i++) {
        const item = screenshotItems[i];
        if (item.permalinkUrl && item.imageUrl) {
          // 已经上传过了，直接使用
          gyazoItems.push({
            permalinkUrl: item.permalinkUrl,
            imageUrl: item.imageUrl
          });
        } else if (item.dataUrl) {
          // 还没上传（或者上传失败了），在此补传
          const blob = dataUrlToBlob_(item.dataUrl, item.name || ('feedback_' + Date.now() + '_' + (i + 1) + '.png'));
          gyazoItems.push(uploadToGyazo_(blob));
        }
      }

      const links = gyazoItems.map(function (x) {
        return String(x.permalinkUrl || x.imageUrl || '').trim();
      }).filter(function (x) { return x; });

      // 全量更新一次，确保顺序和内容正确
      if (cols.shotLink > 0) sheet.getRange(targetRow, cols.shotLink).setValue(links.join('\n'));
      const firstImage = gyazoItems.length ? String(gyazoItems[0].imageUrl || '') : '';
      if (cols.shotFormula > 0) sheet.getRange(targetRow, cols.shotFormula).setValue(firstImage ? '=IMAGE("' + firstImage + '")' : '');
    } else if (payload.clearScreenshot === true) {
      if (cols.shotLink > 0) sheet.getRange(targetRow, cols.shotLink).setValue('');
      if (cols.shotFormula > 0) sheet.getRange(targetRow, cols.shotFormula).setValue('');
    }
    return targetRow;
  });

  return {
    ok: true,
    row: resolvedRow,
    rowId: getUniqueRowId_(sheet, resolvedRow),
    requestedRow: row,
    rowRelocated: resolvedRow !== row,
    gyazoPermalink: gyazoItems.length ? gyazoItems[0].permalinkUrl : '',
    gyazoImageUrl: gyazoItems.length ? gyazoItems[0].imageUrl : '',
    gyazoCount: gyazoItems.length
  };
}

/** 批量提交文本反馈（不含截图上传） */
function batchSubmitFeedback(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error('参数错误：缺少 items');
  }

  const sheet = getTargetSheet_(payload.sheetName);
  const ctx = resolveRuntimeContext_(sheet, payload.settings);
  const settings = ctx.settings;
  const cols = ctx.cols;
  const forceWrite = payload && payload.forceWrite !== undefined
    ? !!payload.forceWrite
    : true;

  const successRows = [];
  const rowMappings = [];
  const errors = [];
  let skipped = 0;

  withDocumentLock_(function() {
    const usedRows = {};
    for (var i = 0; i < payload.items.length; i++) {
      const item = payload.items[i] || {};
      const row = Number(item.row);
      if (!row || row < ctx.dataStartRow) {
        skipped++;
        continue;
      }

      const reviewer = String(item.reviewer || '').trim();
      const reviewResult = String(item.reviewResult || '').trim();
      const severity = String(item.severity || '').trim();
      const textAdvice = String(item.textAdvice || '').trim();
      if (!reviewer && !reviewResult && !severity && !textAdvice) {
        skipped++;
        continue;
      }

      try {
        const targetRow = resolvePayloadRow_(sheet, row, item.rowId, item.rowKey, ctx, usedRows);
        if (!shouldApplyClientWrite_(sheet, item, targetRow)) {
          usedRows[targetRow] = true;
          successRows.push(targetRow);
          rowMappings.push({
            requestedRow: row,
            requestedRowId: String(item.rowId || '').trim(),
            row: targetRow,
            rowId: getUniqueRowId_(sheet, targetRow),
            rowRelocated: targetRow !== row
          });
          continue;
        }
        writeFeedbackTextOnly_(sheet, targetRow, cols, reviewer, reviewResult, severity, textAdvice, {
          forceWrite: forceWrite,
          settings: settings
        });
        usedRows[targetRow] = true;
        successRows.push(targetRow);
        rowMappings.push({
          requestedRow: row,
          requestedRowId: String(item.rowId || '').trim(),
          row: targetRow,
          rowId: getUniqueRowId_(sheet, targetRow),
          rowRelocated: targetRow !== row
        });
      } catch (e) {
        errors.push({
          row: row,
          message: String(e && e.message ? e.message : e)
        });
      }
    }
  });

  return {
    ok: errors.length === 0,
    total: payload.items.length,
    successRows: successRows,
    rowMappings: rowMappings,
    skipped: skipped,
    errors: errors
  };
}

/** 实时单张截图上传并写入（由客户端触发） */
function uploadScreenshotImmediate(payload) {
  if (!payload || !payload.dataUrl) throw new Error('参数错误：缺少 dataUrl');
  const sheet = getTargetSheet_(payload.sheetName);
  const row = Number(payload.row);
  const dataUrl = payload.dataUrl;
  const fileName = payload.name || ('feedback_' + Date.now() + '.png');

  // 1. 上传到 Gyazo
  const blob = dataUrlToBlob_(dataUrl, fileName);
  const gyazo = uploadToGyazo_(blob);

  // 2. 如果提供了行号，尝试实时写入表格
  let resolvedRow = row;
  if (row > 0) {
    const ctx = resolveRuntimeContext_(sheet, payload.settings);
    const cols = ctx.cols;
    const permalink = String(gyazo.permalinkUrl || gyazo.imageUrl || '').trim();
    const image = String(gyazo.imageUrl || '').trim();

    resolvedRow = withDocumentLock_(function() {
      const targetRow = resolvePayloadRow_(sheet, row, payload.rowId, payload.rowKey, ctx);
      // 追加到现有链接中
      if (cols.shotLink > 0) {
        const cell = sheet.getRange(targetRow, cols.shotLink);
        const oldVal = String(cell.getValue() || '').trim();
        const newVal = oldVal ? (oldVal + '\n' + permalink) : permalink;
        cell.setValue(newVal);
      }
      // 更新首图公式
      if (cols.shotFormula > 0) {
        const cell = sheet.getRange(targetRow, cols.shotFormula);
        const oldVal = String(cell.getValue() || '').trim();
        if (!oldVal || oldVal.indexOf('=IMAGE') === -1) {
          cell.setValue('=IMAGE("' + image + '")');
        }
      }
      return targetRow;
    });
  }

  return {
    ok: true,
    row: resolvedRow,
    rowId: getUniqueRowId_(sheet, resolvedRow),
    requestedRow: row,
    rowRelocated: resolvedRow !== row,
    permalinkUrl: gyazo.permalinkUrl,
    imageUrl: gyazo.imageUrl
  };
}

function normalizeScreenshotDataUrls_(payload) {
  if (!payload) return [];
  const arr = [];
  if (Array.isArray(payload.screenshotDataUrls)) {
    for (var i = 0; i < payload.screenshotDataUrls.length; i++) {
      const one = String(payload.screenshotDataUrls[i] || '').trim();
      if (one) arr.push(one);
    }
  }
  const single = String(payload.screenshotDataUrl || '').trim();
  if (single) arr.push(single);

  const out = [];
  const seen = {};
  for (var j = 0; j < arr.length; j++) {
    if (seen[arr[j]]) continue;
    seen[arr[j]] = true;
    out.push(arr[j]);
  }
  return out;
}

function getOptionValue_(option) {
  if (typeof option === 'string') return String(option || '').trim();
  if (option && option.value !== undefined) return String(option.value || '').trim();
  return '';
}

function getOptionValues_(options) {
  const out = [];
  const seen = {};
  const list = Array.isArray(options) ? options : [];
  for (var i = 0; i < list.length; i++) {
    const v = getOptionValue_(list[i]);
    if (!v || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

function findOptionStyleByValue_(options, value) {
  const target = String(value || '').trim();
  if (!target) return null;
  const list = Array.isArray(options) ? options : [];
  for (var i = 0; i < list.length; i++) {
    const one = list[i];
    if (!one || typeof one === 'string') continue;
    if (String(one.value || '').trim() !== target) continue;
    return {
      bg: String(one.bg || '').trim(),
      fg: String(one.fg || '').trim()
    };
  }
  return null;
}

function applyOptionStyleToCell_(cell, style) {
  if (!cell || !style) return;
  const bg = String(style.bg || '').trim().toLowerCase();
  const fg = String(style.fg || '').trim().toLowerCase();
  const isWhiteBg = bg === '#fff' || bg === '#ffffff' || bg === 'white' || bg === 'rgb(255,255,255)';
  const isDefaultFg = fg === '#000' || fg === '#000000' || fg === 'black' || fg === 'rgb(0,0,0)';
  if (bg && !isWhiteBg) cell.setBackground(style.bg);
  if (fg && !isDefaultFg) cell.setFontColor(style.fg);
}

function writeFeedbackTextOnly_(sheet, row, cols, reviewer, reviewResult, severity, textAdvice, options) {
  const forceWrite = !!(options && options.forceWrite);
  const settings = options && options.settings ? options.settings : buildDefaultSettings_();
  const optionMetaCache = {};
  
  const reviewerValidation = getOptionMetaBySetting_(
    sheet, row, settings, cols, 'reviewerOptionsSource', 'reviewer', optionMetaCache
  );
  const reviewResultValidation = getOptionMetaBySetting_(
    sheet, row, settings, cols, 'reviewResultOptionsSource', 'reviewResult', optionMetaCache
  );
  const severityValidation = getOptionMetaBySetting_(
    sheet, row, settings, cols, 'severityOptionsSource', 'severity', optionMetaCache
  );
  const reviewerValues = getOptionValues_(reviewerValidation.options);
  const reviewResultValues = getOptionValues_(reviewResultValidation.options);
  const severityValues = getOptionValues_(severityValidation.options);

  if (!forceWrite &&
      cols.reviewer > 0 &&
      reviewerValues.length &&
      reviewerValues.indexOf(reviewer) === -1 &&
      reviewerValidation.strict) {
    throw new Error('“审核人”必须使用下拉选项：' + reviewerValues.join(' / '));
  }
  if (!forceWrite &&
      cols.reviewResult > 0 &&
      reviewResultValues.length &&
      reviewResultValues.indexOf(reviewResult) === -1 &&
      reviewResultValidation.strict) {
    throw new Error('“审核状态”必须使用下拉选项：' + reviewResultValues.join(' / '));
  }
  if (!forceWrite &&
      cols.severity > 0 &&
      severityValues.length &&
      severity &&
      severityValues.indexOf(severity) === -1 &&
      severityValidation.strict) {
    throw new Error('“严重程度”必须使用下拉选项：' + severityValues.join(' / '));
  }

  if (cols.reviewer > 0) {
    setCellValueWithValidationBypass_(
      sheet.getRange(row, cols.reviewer),
      reviewer,
      forceWrite,
      reviewerValidation,
      optionMetaCache
    );
  }
  if (cols.reviewResult > 0) {
    setCellValueWithValidationBypass_(
      sheet.getRange(row, cols.reviewResult),
      reviewResult,
      forceWrite,
      reviewResultValidation,
      optionMetaCache
    );
  }
  if (cols.severity > 0) {
    setCellValueWithValidationBypass_(
      sheet.getRange(row, cols.severity),
      severity || '',
      forceWrite,
      severityValidation,
      optionMetaCache
    );
  }
  if (cols.textAdvice > 0) sheet.getRange(row, cols.textAdvice).setValue(textAdvice);
  SpreadsheetApp.flush();
}

function setCellValueWithValidationBypass_(cell, value, forceWrite, validationMeta, cache) {
  const text = String(value || '').trim();
  const actualValidation = getValidationOptions_(cell, cache);
  const validation = validationMeta || actualValidation;
  const style = findOptionStyleByValue_(validation.options, text);

  // 用 App 配置的下拉选项覆盖单元格原有规则
  const optionValues = getOptionValues_(validation.options);
  if (optionValues.length > 0) {
    const newRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(optionValues, true)
      .setAllowInvalid(true)
      .build();
    cell.setDataValidation(newRule);
  }
  cell.setValue(text);
  applyOptionStyleToCell_(cell, style);
}

/** Gyazo 上传 */
function uploadToGyazo_(blob) {
  const tokenFromProp = PropertiesService.getScriptProperties().getProperty('GYAZO_ACCESS_TOKEN');
  const token = String(tokenFromProp || GYAZO_ACCESS_TOKEN_FALLBACK || '').trim();
  if (!token) {
    throw new Error('未配置 GYAZO_ACCESS_TOKEN（Apps Script > 项目设置 > 脚本属性）');
  }

  const res = UrlFetchApp.fetch('https://upload.gyazo.com/api/upload', {
    method: 'post',
    payload: {
      access_token: token,
      imagedata: blob.setName(blob.getName() || 'feedback.png'),
      access_policy: 'anyone'
    },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Gyazo 上传失败(' + code + '): ' + text);
  }

  const data = JSON.parse(text || '{}');
  const permalinkUrl = String(data.permalink_url || '');
  let imageUrl = String(data.url || '');

  if (!imageUrl && permalinkUrl) {
    const m = permalinkUrl.match(/gyazo\.com\/([a-f0-9]+)/i);
    if (m) {
      const ext = data.type || 'png';
      imageUrl = 'https://i.gyazo.com/' + m[1] + '.' + ext;
    }
  }

  if (!imageUrl) throw new Error('Gyazo 返回缺少图片直链');
  return { permalinkUrl: permalinkUrl, imageUrl: imageUrl };
}

/** ===== Settings ===== */

function buildDefaultSettings_() {
  const columns = {};
  for (var i = 0; i < COLUMN_FIELDS.length; i++) {
    const f = COLUMN_FIELDS[i];
    if (f.allowRange) {
      columns[f.key] = { mode: 'range', value: f.defaultRange || '' };
    } else {
      columns[f.key] = { mode: 'header', value: f.defaultHeader };
    }
  }
  return {
    version: SETTINGS_VERSION,
    columnMappingMode: 'default',
    headerRow: CONFIG.HEADER_ROW,
    dataStartRow: getDataStartRowByHeaderRow_(CONFIG.HEADER_ROW),
    columns: columns,
    panelHeaders: PANEL_DEFAULT_HEADERS.slice()
  };
}

function getSettingsPropertyKey_(sheet) {
  const ssId = sheet.getParent().getId();
  return SETTINGS_PROPERTY_PREFIX + ssId + '_' + sheet.getSheetId();
}

function getSavedSettings_(sheet) {
  const key = getSettingsPropertyKey_(sheet);
  const raw = PropertiesService.getUserProperties().getProperty(key);
  if (!raw) return buildDefaultSettings_();
  try {
    return JSON.parse(raw);
  } catch (e) {
    return buildDefaultSettings_();
  }
}

function saveUserSettings_(sheet, settings) {
  const key = getSettingsPropertyKey_(sheet);
  PropertiesService.getUserProperties().setProperty(key, JSON.stringify(settings));
}

function getEffectiveSettings_(sheet, incomingSettings, headers, headerRow) {
  const source = incomingSettings || getSavedSettings_(sheet);
  return normalizeSettings_(source, headers, headerRow);
}

function normalizeSettings_(raw, headers, headerRow) {
  const normalized = buildDefaultSettings_();
  const sourceColumns = raw && raw.columns ? raw.columns : {};
  const mappingMode = String(raw && raw.columnMappingMode || (raw && raw.useCustomColumns ? 'custom' : 'default')).toLowerCase();
  const useCustomColumns = mappingMode === 'custom';
  normalized.columnMappingMode = useCustomColumns ? 'custom' : 'default';
  const sourceVersion = Number(raw && raw.version || 0);
  const effectiveHeaderRow = normalizeHeaderRow_(
    raw && raw.headerRow ? raw.headerRow : (headerRow || CONFIG.HEADER_ROW)
  );
  normalized.headerRow = effectiveHeaderRow;
  normalized.dataStartRow = getDataStartRowByHeaderRow_(effectiveHeaderRow);

  if (useCustomColumns) {
    for (var i = 0; i < COLUMN_FIELDS.length; i++) {
      const f = COLUMN_FIELDS[i];
      const src = sourceColumns[f.key] || {};
      const allowRange = !!f.allowRange;
      const rawMode = String(src.mode || '').toLowerCase();

      let mode = rawMode;
      if (allowRange) {
        mode = 'range';
      } else {
        if (mode !== 'header' && mode !== 'letter') mode = 'header';
      }

      let value = String(src.value || '').trim();
      // 选项来源字段改为仅支持“按范围”，旧版 header/letter 值不再沿用，避免误判。
      if (allowRange && rawMode !== 'range') value = '';
      if (!value) value = allowRange ? (f.defaultRange || '') : f.defaultHeader;
      if (mode === 'letter') value = value.toUpperCase();

      normalized.columns[f.key] = { mode: mode, value: value };
    }
  }

  const srcPanel = raw && raw.panelHeaders;
  if (Array.isArray(srcPanel)) {
    normalized.panelHeaders = srcPanel
      .map(function (x) { return String(x || '').trim(); })
      .filter(function (x) { return x; });
  }

  // 兼容旧默认值迁移：旧版默认是 [成品-单链接, 审核结果1, 文字建议]
  // 若用户未显式改动，自动迁移到新默认 [提交人员, 成品-单链接]
  if (sourceVersion > 0 && sourceVersion < 2) {
    const oldDefault = ['成品-单链接', '审核结果1', '文字建议'];
    if (sameStringArray_(normalized.panelHeaders, oldDefault)) {
      normalized.panelHeaders = PANEL_DEFAULT_HEADERS.slice();
    }
  }

  if (!normalized.panelHeaders || !normalized.panelHeaders.length) {
    normalized.panelHeaders = PANEL_DEFAULT_HEADERS.slice();
  }

  return normalized;
}

function inferColumnMappingMode_(sheet, headerMap, settings) {
  const columns = settings && settings.columns ? settings.columns : {};
  for (var i = 0; i < COLUMN_FIELDS.length; i++) {
    const f = COLUMN_FIELDS[i];
    const actual = columns[f.key] || {};
    const actualMode = String(actual.mode || '').toLowerCase();
    const actualValue = String(actual.value || '').trim();

    if (f.allowRange) {
      const defaultRange = String(f.defaultRange || '').trim();
      if (actualMode !== 'range') return 'custom';
      if (actualValue !== defaultRange) return 'custom';
      continue;
    }

    const defaultCfg = { mode: 'header', value: String(f.defaultHeader || '') };
    const actualCol = resolveOneColumn_(sheet, headerMap, actual, f);
    const defaultCol = resolveOneColumn_(sheet, headerMap, defaultCfg, f);
    if (actualCol !== defaultCol) return 'custom';
  }
  return 'default';
}

function sameStringArray_(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (String(a[i]) !== String(b[i])) return false;
  }
  return true;
}

function normalizePanelHeaders_(panelHeadersInput, settings, headers, cols, map) {
  const source = Array.isArray(panelHeadersInput) && panelHeadersInput.length
    ? panelHeadersInput
    : (settings.panelHeaders || []);

  const valid = [];
  const seen = {};
  for (var i = 0; i < source.length; i++) {
    const h = String(source[i] || '').trim();
    if (!h) continue;
    if (headers.indexOf(h) === -1) continue;
    if (seen[h]) continue;
    seen[h] = true;
    valid.push(h);
  }

  if (valid.length) return valid;

  const defaultValid = [];
  for (var d = 0; d < PANEL_DEFAULT_HEADERS.length; d++) {
    const h0 = PANEL_DEFAULT_HEADERS[d];
    if (headers.indexOf(h0) >= 0 && defaultValid.indexOf(h0) === -1) {
      defaultValid.push(h0);
    }
  }
  if (defaultValid.length) return defaultValid;

  const fallback = [];
  const hPreview = getHeaderByColIndex_(map, cols.preview);
  const hResult = getHeaderByColIndex_(map, cols.reviewResult);
  const hAdvice = getHeaderByColIndex_(map, cols.textAdvice);
  [hPreview, hResult, hAdvice].forEach(function (h) {
    if (h && fallback.indexOf(h) === -1) fallback.push(h);
  });
  if (fallback.length) return fallback;

  return headers.slice(0, Math.min(3, headers.length));
}

function resolveColumns_(sheet, headerMap, settings) {
  const resolved = {};
  for (var i = 0; i < COLUMN_FIELDS.length; i++) {
    const f = COLUMN_FIELDS[i];
    const cfg = settings.columns[f.key];
    const col = resolveOneColumn_(sheet, headerMap, cfg, f);
    // 必填列不允许静默降级为 0，否则会出现“提交成功但未写入”的假成功。
    if (!f.optional && !f.allowRange && col < 1) {
      throw new Error('缺少必填列映射：' + f.label + '。请在设置中重新选择。');
    }
    resolved[f.key] = col;
  }
  return resolved;
}

function resolveOneColumn_(sheet, headerMap, cfg, fieldDef) {
  const optional = !!(fieldDef && fieldDef.optional);
  const allowRange = !!(fieldDef && fieldDef.allowRange);
  const mode = String(cfg && cfg.mode || 'header').toLowerCase();
  const value = String(cfg && cfg.value || '').trim();

  if (allowRange && mode === 'range') {
    return 0;
  }

  if (mode === 'letter') {
    if (!value && optional) return 0;
    const idx = columnLetterToIndex_(value);
    if (!idx) {
      return 0;
    }
    if (idx > sheet.getLastColumn()) {
      return 0;
    }
    return idx;
  }

  const headerName = value || fieldDef.defaultHeader;
  const tokenCol = parseHeaderColumnToken_(headerName);
  if (tokenCol) {
    if (tokenCol > sheet.getLastColumn()) {
      return 0;
    }
    return tokenCol;
  }

  let col = findHeaderMapColumn_(headerMap, headerName);
  if (!col) {
    const candidates = [];
    const seen = {};
    function pushCandidate(name) {
      const text = String(name || '').trim();
      if (!text || seen[text]) return;
      seen[text] = true;
      candidates.push(text);
    }

    // 先尝试当前配置值及其常见数字后缀变体（兼容 审核人员 / 审核人员1）。
    pushCandidate(headerName);
    pushCandidate(headerName + '1');
    pushCandidate(headerName + '2');
    const tailNum = String(headerName || '').match(/^(.*?)(\d+)$/);
    if (tailNum && tailNum[1]) pushCandidate(tailNum[1]);

    // 再尝试字段默认名及后缀（兼容旧配置残留导致的映射失效）。
    const defaultHeader = String(fieldDef && fieldDef.defaultHeader || '').trim();
    pushCandidate(defaultHeader);
    pushCandidate(defaultHeader + '1');
    pushCandidate(defaultHeader + '2');

    for (var i = 0; i < candidates.length; i++) {
      col = findHeaderMapColumn_(headerMap, candidates[i]);
      if (col) break;
    }
  }

  return col || 0;
}

function findHeaderMapColumn_(headerMap, candidate) {
  const target = String(candidate || '').trim();
  if (!target) return 0;
  if (headerMap[target]) return headerMap[target];

  // 兼容表头中存在空格差异（如 "建议截图链接 1" vs "建议截图链接1"）。
  const normalizedTarget = target.replace(/\s+/g, '');
  const keys = Object.keys(headerMap || {});
  for (var i = 0; i < keys.length; i++) {
    const key = String(keys[i] || '').trim();
    if (!key) continue;
    if (key.replace(/\s+/g, '') === normalizedTarget) {
      return headerMap[key];
    }
  }
  return 0;
}

function parseHeaderColumnToken_(value) {
  const m = String(value || '').match(/^__COL__(\d+)$/);
  if (!m || !m[1]) return 0;
  const idx = Number(m[1]);
  return idx > 0 ? idx : 0;
}

function columnLetterToIndex_(letter) {
  const s = String(letter || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return 0;
  let n = 0;
  for (var i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n;
}

function indexToColumnLetter_(index) {
  let n = Number(index || 0);
  if (!n || n < 1) return '';
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function getHeaderOptions_(sheet, headerRow) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  const hr = normalizeHeaderRow_(headerRow || CONFIG.HEADER_ROW);
  const arr = sheet.getRange(hr, 1, 1, lastCol).getDisplayValues()[0];
  const out = [];
  for (var i = 0; i < arr.length; i++) {
    const header = String(arr[i] || '').trim();
    if (!header) continue;
    const col = i + 1;
    const letter = indexToColumnLetter_(col);
    out.push({
      header: header,
      col: col,
      letter: letter,
      token: '__COL__' + col,
      label: header + '（' + letter + '列）'
    });
  }
  return out;
}

/** ===== Helpers ===== */

function getTargetSheet_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (CONFIG.SHEET_NAME) {
    const fixed = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!fixed) throw new Error('找不到配置工作表：' + CONFIG.SHEET_NAME);
    return fixed;
  }
  if (sheetName) {
    const named = ss.getSheetByName(sheetName);
    if (named) return named;
  }
  return ss.getActiveSheet();
}

function getHeaders_(sheet, headerRow) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error('标题行为空');
  const hr = normalizeHeaderRow_(headerRow || CONFIG.HEADER_ROW);
  const arr = sheet.getRange(hr, 1, 1, lastCol).getDisplayValues()[0];
  const headers = [];
  for (var i = 0; i < arr.length; i++) {
    const h = String(arr[i] || '').trim();
    if (h) headers.push(h);
  }
  return headers;
}

function getHeaderMap_(sheet, headerRow) {
  const lastCol = sheet.getLastColumn();
  const hr = normalizeHeaderRow_(headerRow || CONFIG.HEADER_ROW);
  const headers = sheet.getRange(hr, 1, 1, lastCol).getDisplayValues()[0];
  const map = {};
  for (var i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (h && !map[h]) map[h] = i + 1;
  }
  return map;
}

function getHeaderByColIndex_(headerMap, colIndex) {
  const keys = Object.keys(headerMap);
  for (var i = 0; i < keys.length; i++) {
    if (headerMap[keys[i]] === colIndex) return keys[i];
  }
  return '';
}

function mustCol_(map, headerName) {
  const col = map[headerName];
  if (!col) throw new Error('缺少列标题：' + headerName);
  return col;
}

function normalizeRows_(rowsInput, dataStartRow) {
  const ds = Number(dataStartRow || CONFIG.DATA_START_ROW);
  const set = {};
  const rows = Array.isArray(rowsInput) ? rowsInput : [];
  for (var i = 0; i < rows.length; i++) {
    const row = Number(rows[i]);
    if (!row || row < ds) continue;
    set[row] = true;
  }
  const out = Object.keys(set).map(function (x) { return Number(x); });
  out.sort(function (a, b) { return a - b; });
  return out;
}

function splitRowsToSegments_(rows) {
  const out = [];
  if (!rows || !rows.length) return out;

  let start = rows[0];
  let prev = rows[0];
  for (var i = 1; i < rows.length; i++) {
    const current = rows[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    out.push({ start: start, end: prev });
    start = current;
    prev = current;
  }
  out.push({ start: start, end: prev });
  return out;
}

/** 支持单选/多选区域，返回去重后的行号 */
function getSelectedRows_(sheet, dataStartRow) {
  const ds = Number(dataStartRow || CONFIG.DATA_START_ROW);
  var ranges = [];
  var list = sheet.getActiveRangeList();
  if (list) ranges = list.getRanges();
  if (!ranges.length && sheet.getActiveRange()) ranges = [sheet.getActiveRange()];

  var set = {};
  for (var r = 0; r < ranges.length; r++) {
    var range = ranges[r];
    var start = range.getRow();
    var num = range.getNumRows();
    for (var i = 0; i < num; i++) {
      var row = start + i;
      if (row >= ds) set[row] = true;
    }
  }

  var rows = Object.keys(set).map(function (x) { return Number(x); });
  rows.sort(function (a, b) { return a - b; });
  return rows;
}

function extractPreviewFromCell_(cell) {
  const text = String(cell.getDisplayValue() || '').trim();
  const url = extractPreviewUrlFromPrefetched_(
    text,
    cell.getValue(),
    cell.getFormula(),
    cell.getRichTextValue(),
    cell.getNote()
  );
  return { url: url || '', text: text || '' };
}

function extractPreviewUrlFromPrefetched_(displayValue, rawValue, formula, rich, note) {
  const value = String(displayValue || '').trim();
  const raw = String(rawValue || '').trim();
  const f = String(formula || '').trim();

  if (f) {
    const imageMatch = f.match(/=IMAGE\("([^"]+)"(?:,[^)]+)?\)/i);
    if (imageMatch && imageMatch[1] && isUrlLike_(imageMatch[1])) return imageMatch[1];

    const hyperlinkMatch = f.match(/=HYPERLINK\("([^"]+)"/i);
    if (hyperlinkMatch && hyperlinkMatch[1] && isUrlLike_(hyperlinkMatch[1])) return hyperlinkMatch[1];

    // 兜底：支持 IF/LET 等包裹下的公式 URL 抽取
    const inFormula = extractFirstUrl_(f);
    if (inFormula) return inFormula;
  }

  if (rich) {
    const link = rich.getLinkUrl && rich.getLinkUrl();
    if (link) {
      const cleanedLink = sanitizeUrlCandidate_(link);
      if (isUrlLike_(cleanedLink)) return cleanedLink;
    }

    const runs = rich.getRuns ? rich.getRuns() : [];
    for (var i = 0; i < runs.length; i++) {
      const runLink = runs[i].getLinkUrl();
      if (runLink) {
        const cleanedRunLink = sanitizeUrlCandidate_(runLink);
        if (isUrlLike_(cleanedRunLink)) return cleanedRunLink;
      }
    }
  }

  const cleanedRaw = sanitizeUrlCandidate_(raw);
  const cleanedValue = sanitizeUrlCandidate_(value);
  if (isUrlLike_(cleanedRaw)) return cleanedRaw;
  if (isUrlLike_(cleanedValue)) return cleanedValue;

  const inRaw = extractFirstUrl_(raw);
  if (inRaw) return inRaw;
  const inValue = extractFirstUrl_(value);
  if (inValue) return inValue;

  const noteText = String(note || '').trim();
  const inNote = extractFirstUrl_(noteText);
  if (inNote) return inNote;

  return '';
}

/**
 * 兜底读取：支持 Google Sheets 文件智能芯片（chipRuns / hyperlink / textFormatRuns）
 * 仅在常规读取拿不到 URL 时使用。
 */
function getPreviewUrlsFromApiRange_(sheet, startRow, numRows, col) {
  const out = [];
  for (var i = 0; i < numRows; i++) out.push('');
  if (!sheet || !numRows || numRows < 1 || !col) return out;

  try {
    const ss = sheet.getParent();
    const colLetter = indexToColumnLetter_(col);
    const sheetName = String(sheet.getName() || '');
    const safeSheetName = "'" + sheetName.replace(/'/g, "''") + "'";
    const a1 = safeSheetName + '!' + colLetter + startRow + ':' + colLetter + (startRow + numRows - 1);
    const fields = 'sheets(data(rowData(values(hyperlink,note,userEnteredValue,effectiveValue))))';
    const url = 'https://sheets.googleapis.com/v4/spreadsheets/' +
      ss.getId() +
      '?includeGridData=true&ranges=' + encodeURIComponent(a1) +
      '&fields=' + encodeURIComponent(fields);
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
      }
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) return out;

    const data = JSON.parse(res.getContentText() || '{}');
    const rowData = (((data.sheets || [])[0] || {}).data || [])[0];
    const rows = rowData && Array.isArray(rowData.rowData) ? rowData.rowData : [];
    for (var r = 0; r < numRows; r++) {
      const cell = (rows[r] && rows[r].values && rows[r].values[0]) ? rows[r].values[0] : null;
      if (!cell) continue;
      const urls = extractUrlsFromApiCellData_(cell);
      out[r] = urls.length ? urls[0] : '';
    }
  } catch (e) {
    // 忽略 API 兜底失败，继续走原有逻辑
  }

  return out;
}

function extractUrlsFromApiCellData_(cell) {
  const out = [];
  if (!cell) return out;

  pushUniqueUrlCandidate_(out, cell.hyperlink);
  pushUniqueUrlCandidate_(out, extractFirstUrl_(cell.formattedValue || ''));
  pushUniqueUrlCandidate_(out, extractFirstUrl_(cell.note || ''));

  const ue = cell.userEnteredValue || {};
  if (ue.formulaValue) {
    const f = String(ue.formulaValue || '');
    const imageMatch = f.match(/=IMAGE\("([^"]+)"(?:,[^)]+)?\)/i);
    if (imageMatch && imageMatch[1]) pushUniqueUrlCandidate_(out, imageMatch[1]);
    const hyperlinkMatch = f.match(/=HYPERLINK\("([^"]+)"/i);
    if (hyperlinkMatch && hyperlinkMatch[1]) pushUniqueUrlCandidate_(out, hyperlinkMatch[1]);
    pushUniqueUrlCandidate_(out, extractFirstUrl_(f));
  }
  pushUniqueUrlCandidate_(out, ue.stringValue || '');

  const ev = cell.effectiveValue || {};
  pushUniqueUrlCandidate_(out, ev.stringValue || '');

  const runs = Array.isArray(cell.textFormatRuns) ? cell.textFormatRuns : [];
  for (var i = 0; i < runs.length; i++) {
    const uri = runs[i] &&
      runs[i].format &&
      runs[i].format.link &&
      runs[i].format.link.uri
      ? runs[i].format.link.uri
      : '';
    pushUniqueUrlCandidate_(out, uri);
  }

  const chipRuns = Array.isArray(cell.chipRuns) ? cell.chipRuns : [];
  for (var j = 0; j < chipRuns.length; j++) {
    const chip = chipRuns[j] && chipRuns[j].chip ? chipRuns[j].chip : {};
    const richUri = chip.richLinkProperties && chip.richLinkProperties.uri
      ? chip.richLinkProperties.uri
      : '';
    pushUniqueUrlCandidate_(out, richUri);
    const richUrl = chip.richLinkProperties && chip.richLinkProperties.url
      ? chip.richLinkProperties.url
      : '';
    pushUniqueUrlCandidate_(out, richUrl);

    const driveId = chip.driveFileProperties && chip.driveFileProperties.id
      ? String(chip.driveFileProperties.id || '')
      : '';
    if (driveId) {
      pushUniqueUrlCandidate_(out, 'https://drive.google.com/file/d/' + driveId + '/view');
    }
  }

  // 最后兜底：递归扫描整个 cell JSON，抓 URL 和 Drive 文件 ID
  collectUrlLikeStringsFromObject_(cell, out, 0, '');

  return out;
}

function pushUniqueUrlCandidate_(arr, candidate) {
  const cleaned = sanitizeUrlCandidate_(candidate);
  if (!cleaned) return;
  if (!isUrlLike_(cleaned)) return;
  if (arr.indexOf(cleaned) >= 0) return;
  arr.push(cleaned);
}

function pushDriveIdAsUrlCandidate_(arr, id) {
  const driveId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_-]{15,}$/.test(driveId)) return;
  pushUniqueUrlCandidate_(arr, 'https://drive.google.com/file/d/' + driveId + '/view');
}

function extractDriveIdsFromText_(text) {
  const t = String(text || '');
  const out = [];
  const seen = {};
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{15,})/ig,
    /\/d\/([a-zA-Z0-9_-]{15,})/ig,
    /[?&]id=([a-zA-Z0-9_-]{15,})/ig
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m;
    while ((m = patterns[p].exec(t))) {
      const id = m[1];
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
  }
  return out;
}

function collectUrlLikeStringsFromObject_(obj, out, depth, keyPath) {
  if (!obj || depth > 8) return;
  if (typeof obj === 'string') {
    pushUniqueUrlCandidate_(out, obj);
    pushUniqueUrlCandidate_(out, extractFirstUrl_(obj));
    const ids = extractDriveIdsFromText_(obj);
    for (var d = 0; d < ids.length; d++) {
      pushDriveIdAsUrlCandidate_(out, ids[d]);
    }
    return;
  }

  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      collectUrlLikeStringsFromObject_(obj[i], out, depth + 1, keyPath + '[' + i + ']');
    }
    return;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      const key = keys[k];
      const value = obj[key];
      const fullKey = keyPath ? (keyPath + '.' + key) : key;

      if (typeof value === 'string') {
        pushUniqueUrlCandidate_(out, value);
        pushUniqueUrlCandidate_(out, extractFirstUrl_(value));

        if (/(^|\.)(id|fileId|driveFileId|docId)$/i.test(fullKey)) {
          pushDriveIdAsUrlCandidate_(out, value);
        }
        const ids = extractDriveIdsFromText_(value);
        for (var t = 0; t < ids.length; t++) {
          pushDriveIdAsUrlCandidate_(out, ids[t]);
        }
      } else {
        collectUrlLikeStringsFromObject_(value, out, depth + 1, fullKey);
      }
    }
  }
}

/**
 * 最后兜底：单元格只有“文件名”时，按文件名在 Drive 中查找同名文件并回填链接。
 * 仅用于智能芯片未返回 URL 的场景。
 */
function inferDrivePreviewUrlFromFileName_(previewText, cache) {
  const fileName = extractMediaFileNameCandidate_(previewText);
  if (!fileName) return '';

  const key = fileName.toLowerCase();
  if (cache && cache[key] !== undefined) return cache[key];

  let resolved = '';
  try {
    resolved = findDriveFileUrlByName_(fileName);
  } catch (e) {
    resolved = '';
  }

  if (cache) cache[key] = resolved || '';
  return resolved || '';
}

function extractMediaFileNameCandidate_(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return '';

  // 智能芯片通常是单行显示文件名，若有多行取第一行。
  t = String(t.split(/\r?\n/)[0] || '').trim();
  if (!t) return '';

  // 去掉前导符号/图标字符。
  t = t.replace(/^[^\w\u4e00-\u9fa5]+/, '');

  // 若包含路径，仅保留文件名部分。
  if (/[\/\\]/.test(t)) {
    const parts = t.split(/[\/\\]/);
    t = String(parts[parts.length - 1] || '').trim();
  }

  const m = t.match(/([^<>:"|?*\r\n]+?\.(?:mp4|mov|webm|m4v|ogg|png|jpe?g|gif|webp|bmp|svg))/i);
  if (!m || !m[1]) return '';
  return String(m[1] || '').trim().replace(/[>"'`，。；：！？、\]\)\}]+$/, '');
}

function findDriveFileUrlByName_(fileName) {
  const name = String(fileName || '').trim();
  if (!name) return '';

  const ext = String((name.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const wantVideo = /^(mp4|mov|webm|m4v|ogg)$/.test(ext);
  const wantImage = /^(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(ext);

  const files = DriveApp.getFilesByName(name);
  let best = null;
  let bestScore = -999;
  let checked = 0;
  const MAX_CHECK = 25;

  while (files.hasNext() && checked < MAX_CHECK) {
    checked++;
    const file = files.next();
    if (!file) continue;
    if (file.isTrashed && file.isTrashed()) continue;

    const mime = String(file.getMimeType() || '').toLowerCase();
    if (mime === 'application/vnd.google-apps.folder') continue;

    let score = 0;
    if (wantVideo && mime.indexOf('video/') === 0) score += 6;
    if (wantImage && mime.indexOf('image/') === 0) score += 6;
    if (!wantVideo && !wantImage) score += 1;

    // 同名匹配优先，随后按修改时间新者优先。
    const updated = file.getLastUpdated ? file.getLastUpdated().getTime() : 0;
    score += updated / 1e13;

    if (score > bestScore) {
      best = file;
      bestScore = score;
    }
  }

  if (!best) return '';
  return 'https://drive.google.com/file/d/' + best.getId() + '/view';
}

function extractUrlFromCell_(cell) {
  const value = String(cell.getDisplayValue() || '').trim();
  const raw = String(cell.getValue() || '').trim();
  const formula = String(cell.getFormula() || '').trim();

  if (formula) {
    const imageMatch = formula.match(/=IMAGE\("([^"]+)"(?:,[^)]+)?\)/i);
    if (imageMatch && imageMatch[1] && isUrlLike_(imageMatch[1])) return imageMatch[1];

    const hyperlinkMatch = formula.match(/=HYPERLINK\("([^"]+)"/i);
    if (hyperlinkMatch && hyperlinkMatch[1] && isUrlLike_(hyperlinkMatch[1])) return hyperlinkMatch[1];

    // 兜底：支持 IF/LET 等包裹下的公式 URL 抽取
    const inFormula = extractFirstUrl_(formula);
    if (inFormula) return inFormula;
  }

  const rich = cell.getRichTextValue();
  if (rich) {
    const link = rich.getLinkUrl();
    if (link) {
      const cleanedLink = sanitizeUrlCandidate_(link);
      if (isUrlLike_(cleanedLink)) return cleanedLink;
    }

    const runs = rich.getRuns();
    for (var i = 0; i < runs.length; i++) {
      const runLink = runs[i].getLinkUrl();
      if (runLink) {
        const cleanedRunLink = sanitizeUrlCandidate_(runLink);
        if (isUrlLike_(cleanedRunLink)) return cleanedRunLink;
      }
    }
  }

  const cleanedRaw = sanitizeUrlCandidate_(raw);
  const cleanedValue = sanitizeUrlCandidate_(value);
  if (isUrlLike_(cleanedRaw)) return cleanedRaw;
  if (isUrlLike_(cleanedValue)) return cleanedValue;

  const inRaw = extractFirstUrl_(raw);
  if (inRaw) return inRaw;
  const inValue = extractFirstUrl_(value);
  if (inValue) return inValue;

  const note = String(cell.getNote() || '').trim();
  const inNote = extractFirstUrl_(note);
  if (inNote) return inNote;

  return '';
}

function isUrlLike_(s) {
  return /^https?:\/\/\S+$/i.test(String(s || '').trim());
}

function extractFirstUrl_(s) {
  const text = String(s || '');
  const matches = text.match(/https?:\/\/[^\s"'<>]+/ig) || [];
  for (var i = 0; i < matches.length; i++) {
    const cleaned = sanitizeUrlCandidate_(matches[i]);
    if (isUrlLike_(cleaned)) return cleaned;
  }
  return '';
}

function sanitizeUrlCandidate_(input) {
  let url = String(input || '').trim();
  if (!url) return '';

  url = url
    .replace(/&amp;/gi, '&')
    .replace(/\u200B/g, '')
    .replace(/\uFEFF/g, '');

  // 去掉包裹符号
  url = url.replace(/^[<\[\(\{'"`]+/, '');
  // 去掉末尾常见标点（支持中英文）
  url = url.replace(/[>\]\)\}'"`.,;:!?，。；：！？、）】》]+$/, '');

  // 兼容 Google 跳转链接：https://www.google.com/url?q=<target>
  const redirect = url.match(/^https?:\/\/(?:www\.)?google\.[^/]+\/url\?(.*)$/i);
  if (redirect && redirect[1]) {
    const query = redirect[1];
    const q = getQueryParamValue_(query, 'q') || getQueryParamValue_(query, 'url');
    if (q) {
      try {
        const decoded = decodeURIComponent(q);
        if (/^https?:\/\//i.test(decoded)) url = decoded;
      } catch (e) {
        if (/^https?:\/\//i.test(q)) url = q;
      }
    }
  }

  return url.trim();
}

function getQueryParamValue_(query, key) {
  const m = String(query || '').match(new RegExp('(?:^|&)' + key + '=([^&]+)', 'i'));
  return m && m[1] ? m[1] : '';
}

/**
 * Performance: cache the column-level color scan so it runs once per column,
 * not once per cell. This eliminates ~150 redundant getBackgrounds/getFontColors calls.
 */
function getColumnColorMap_(sheet, col, cache) {
  var cacheKey = 'colColor:' + col;
  if (cache && cache[cacheKey]) return cache[cacheKey];
  var colorMap = {};
  var scanRows = Math.min(sheet.getLastRow(), 100);
  if (scanRows >= 1) {
    var scanRange = sheet.getRange(1, col, scanRows, 1);
    var vList = scanRange.getValues();
    var bgList = scanRange.getBackgrounds();
    var fgList = scanRange.getFontColors();
    for (var k = 0; k < vList.length; k++) {
      var v = String(vList[k][0] || '').trim();
      if (v && !colorMap[v] && bgList[k][0] !== '#ffffff') {
        colorMap[v] = { bg: bgList[k][0], fg: fgList[k][0] };
      }
    }
  }
  if (cache) cache[cacheKey] = colorMap;
  return colorMap;
}

function getValidationOptions_(cell, cache) {
  var rule = cell.getDataValidation();
  if (!rule) return { options: [], strict: false };

  var type = rule.getCriteriaType();
  var values = rule.getCriteriaValues() || [];
  var rawOpts = [];

  var typeName = String(type || '');
  var isList = typeName.indexOf('VALUE_IN_LIST') >= 0;
  var isRange = typeName.indexOf('VALUE_IN_RANGE') >= 0;

  if (isList && values.length) {
    var list = values[0];
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) {
        var vItem = String(list[i] || '').trim();
        if (vItem) rawOpts.push(vItem);
      }
    }
  }

  var sheet = cell.getSheet();
  var col = cell.getColumn();
  // Use cached column-level color map instead of scanning per cell
  var colorMap = getColumnColorMap_(sheet, col, cache);

  // Strategy A: range-based validation source colors
  if (isRange && values.length && values[0]) {
    var rangeA1 = '';
    try { rangeA1 = values[0].getA1Notation(); } catch(e) { rangeA1 = 'r' + col; }
    var rangeCacheKey = 'rangeValidation:' + rangeA1;
    if (cache && cache[rangeCacheKey]) {
      var cached = cache[rangeCacheKey];
      for (var rc = 0; rc < cached.rawOpts.length; rc++) rawOpts.push(cached.rawOpts[rc]);
      colorMap = Object.assign({}, colorMap, cached.colorMap);
    } else {
      var range = values[0];
      var sourceVals = range.getValues();
      var rangeRawOpts = [];
      var rangeColorMap = {};
      for (var rVal = 0; rVal < sourceVals.length; rVal++) {
        for (var cVal = 0; cVal < sourceVals[rVal].length; cVal++) {
          var vVal = String(sourceVals[rVal][cVal] || '').trim();
          if (vVal) rangeRawOpts.push(vVal);
        }
      }
      for (var rc2 = 0; rc2 < rangeRawOpts.length; rc2++) rawOpts.push(rangeRawOpts[rc2]);
      var sourceBgs = range.getBackgrounds();
      var sourceFgs = range.getFontColors();
      for (var r1 = 0; r1 < sourceVals.length; r1++) {
        for (var c1 = 0; c1 < sourceVals[r1].length; c1++) {
          var vr = String(sourceVals[r1][c1] || '').trim();
          if (vr && !rangeColorMap[vr]) {
            rangeColorMap[vr] = { bg: sourceBgs[r1][c1], fg: sourceFgs[r1][c1] };
          }
        }
      }
      colorMap = Object.assign({}, colorMap, rangeColorMap);
      if (cache) cache[rangeCacheKey] = { rawOpts: rangeRawOpts, colorMap: rangeColorMap };
    }
  }

  var result = [];
  var seen = {};
  for (var j = 0; j < rawOpts.length; j++) {
    var val = rawOpts[j];
    if (!seen[val]) {
      seen[val] = true;
      var style = colorMap[val] || { bg: '', fg: '' };
      result.push({ value: val, bg: style.bg, fg: style.fg });
    }
  }

  return {
    options: result,
    strict: !rule.getAllowInvalid()
  };
}

function getOptionMetaBySetting_(sheet, row, settings, cols, sourceKey, fallbackTargetKey, cache) {
  const cfg = settings && settings.columns ? (settings.columns[sourceKey] || {}) : {};
  const value = String(cfg.value || '').trim();
  const targetCol = cols[fallbackTargetKey] || 0;

  if (targetCol) {
    const targetKey = 'target:' + row + ':' + targetCol;
    let targetMeta = cache && cache[targetKey] ? cache[targetKey] : null;
    if (!targetMeta) {
      targetMeta = getValidationOptions_(sheet.getRange(row, targetCol));
      if (cache) cache[targetKey] = targetMeta;
    }
    if (targetMeta.options && targetMeta.options.length) return targetMeta;
  }

  // 选项来源仅按“范围”读取，不再从来源列推断。
  if (value) {
    const cacheKey = 'range:' + value;
    let meta = cache && cache[cacheKey] ? cache[cacheKey] : null;
    if (!meta) {
      try {
        meta = getOptionsFromRangeA1_(sheet.getParent(), value);
      } catch (e) {
        meta = { options: [], strict: false };
      }
      if (cache) cache[cacheKey] = meta;
    }
    if (meta.options && meta.options.length) return meta;
  }

  // 未配置范围或范围为空时，回退到目标列自身的数据验证。
  if (targetCol) return getValidationOptions_(sheet.getRange(row, targetCol));
  return { options: [], strict: false };
}

function getClientWriteToken_(payload) {
  const n = Number(payload && payload.clientWriteToken || 0);
  if (!n || !isFinite(n)) return 0;
  return Math.floor(n);
}

function getClientWriteStateKey_(sheet, payload, row) {
  const ssId = sheet.getParent().getId();
  const sheetId = sheet.getSheetId();
  const rowId = String(payload && payload.rowId || '').trim();
  const rowKey = String(payload && payload.rowKey || '').trim();
  if (rowId) return 'feedback_write_seq:' + ssId + ':' + sheetId + ':id:' + rowId;
  if (rowKey) return 'feedback_write_seq:' + ssId + ':' + sheetId + ':key:' + rowKey;
  return 'feedback_write_seq:' + ssId + ':' + sheetId + ':row:' + Number(row || 0);
}

function shouldApplyClientWrite_(sheet, payload, row) {
  const token = getClientWriteToken_(payload);
  if (!token) return true;
  const key = getClientWriteStateKey_(sheet, payload, row);
  const props = PropertiesService.getUserProperties();
  const current = Number(props.getProperty(key) || 0);
  if (current && current > token) return false;
  props.setProperty(key, String(token));
  return true;
}

function getOptionsFromRangeA1_(ss, a1Notation) {
  let range = null;
  try {
    range = ss.getRange(a1Notation);
  } catch (e) {
    throw new Error('选项来源范围无效：' + a1Notation);
  }

  range = shrinkOptionSourceRange_(range);
  const values = range.getDisplayValues();
  const bgs = range.getBackgrounds();
  const fgs = range.getFontColors();
  const opts = [];
  const seen = {};
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      const v = String(values[r][c] || '').trim();
      if (!v || seen[v]) continue;
      seen[v] = true;
      opts.push({
        value: v,
        bg: String((bgs[r] && bgs[r][c]) || '').trim(),
        fg: String((fgs[r] && fgs[r][c]) || '').trim()
      });
    }
  }
  return {
    options: opts,
    // 直接范围作为选项源时，默认按严格模式校验
    strict: opts.length > 0
  };
}

function shrinkOptionSourceRange_(range) {
  const sheet = range.getSheet();
  const startRow = range.getRow();
  const startCol = range.getColumn();
  const numRows = range.getNumRows();
  const numCols = range.getNumColumns();
  const maxRows = sheet.getMaxRows();
  const maxScanRows = 3000;

  // 若是整列/跨多整列（如 A:A 或 A:D），只读取到当前表最后使用行，避免整列读取过慢。
  if (numRows === maxRows) {
    const lastRow = Math.max(startRow, sheet.getLastRow());
    const needRows = Math.max(1, lastRow - startRow + 1);
    const scanRows = Math.min(needRows, maxScanRows);
    return sheet.getRange(startRow, startCol, scanRows, numCols);
  }
  return range;
}

function validateRangeOptionSettings_(ss, settings) {
  const keys = ['reviewerOptionsSource', 'reviewResultOptionsSource', 'severityOptionsSource'];
  for (var i = 0; i < keys.length; i++) {
    const key = keys[i];
    const cfg = settings && settings.columns ? settings.columns[key] : null;
    if (!cfg) continue;
    const value = String(cfg.value || '').trim();
    if (!value) continue;
    // 仅做可解析性校验
    getOptionsFromRangeA1_(ss, value);
  }
}

function dataUrlToBlob_(dataUrl, fileName) {
  const m = String(dataUrl).match(/^data:(.+);base64,(.+)$/);
  if (!m) throw new Error('截图数据格式错误（需要 data URL）');
  const contentType = m[1];
  const bytes = Utilities.base64Decode(m[2]);
  return Utilities.newBlob(bytes, contentType, fileName);
}

function safeCurrentUserEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}
