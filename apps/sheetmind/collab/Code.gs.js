/**
 * SheetMind 协作 Web App — Google Apps Script 后端
 * 
 * 使用方法：
 * 1. 打开 Google Sheet → 扩展程序 → Apps Script
 * 2. 粘贴此代码
 * 3. 部署 → 新建部署 → Web 应用
 *    - 执行身份：我自己
 *    - 有权访问：任何人
 * 4. 复制部署 URL，在 SheetMind 中使用
 */

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────
var SM_COLUMNS = ['SM_ID', 'SM_分类', 'SM_备注', 'SM_标签', 'SM_用户'];

// ─────────────────────────────────────────────
// Web App 入口
// ─────────────────────────────────────────────

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'pull';
  var sheetName = (e && e.parameter && e.parameter.sheet) || '';

  try {
    switch (action) {
      case 'pull':
        return jsonResponse(pullData(sheetName));
      case 'sheets':
        return jsonResponse(listSheets());
      case 'ping':
        return jsonResponse({ ok: true, time: new Date().toISOString() });
      default:
        return jsonResponse({ error: '未知操作: ' + action }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    switch (action) {
      case 'update':
        return jsonResponse(updateRow(body));
      case 'batchUpdate':
        return jsonResponse(batchUpdateRows(body));
      case 'batchWriteColumn':
        return jsonResponse(batchWriteColumn(body));
      case 'pullSM':
        return jsonResponse(pullSMColumns(body.sheet));
      default:
        return jsonResponse({ error: '未知操作: ' + action }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: '服务错误：' + err.message, stack: err.stack || '' }, 500);
  }
}

// ─────────────────────────────────────────────
// 核心功能
// ─────────────────────────────────────────────

/**
 * 拉取指定 sheet 的全部数据（含 SM_ 列）
 */
function pullData(sheetName) {
  var sheet = getSheet(sheetName);
  ensureSMColumns(sheet);  // 确保 SM 列存在并生成 ID
  var data = sheet.getDataRange().getValues();

  if (data.length === 0) {
    return { columns: [], rows: [], sheetName: sheet.getName() };
  }

  var headers = data[0].map(function (h) { return String(h).trim(); });
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j] !== undefined && data[i][j] !== null
        ? String(data[i][j])
        : '';
    }
    row['__rowIndex'] = i + 1; // 仅供参考
    rows.push(row);
  }

  return {
    columns: headers,
    rows: rows,
    sheetName: sheet.getName(),
    smColumns: SM_COLUMNS,
    timestamp: new Date().toISOString()
  };
}

/**
 * 仅拉取 SM_ 列数据（轮询用，轻量）
 * 返回每行的 SM_ID + SM 数据
 */
function pullSMColumns(sheetName) {
  var sheet = getSheet(sheetName);
  var data = sheet.getDataRange().getValues();

  if (data.length === 0) {
    return { rows: [], timestamp: new Date().toISOString() };
  }

  var headers = data[0].map(function (h) { return String(h).trim(); });

  // 找到 SM_ 列的索引
  var smIndices = {};
  SM_COLUMNS.forEach(function (col) {
    var idx = headers.indexOf(col);
    if (idx >= 0) smIndices[col] = idx;
  });

  if (Object.keys(smIndices).length === 0) {
    return { rows: [], timestamp: new Date().toISOString() };
  }

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = { __rowIndex: i + 1 };
    var hasContent = false;
    for (var col in smIndices) {
      var val = data[i][smIndices[col]];
      row[col] = val !== undefined && val !== null ? String(val) : '';
      if (row[col] && col !== 'SM_ID') hasContent = true;
    }
    // 始终返回有 SM_ID 的行，即使其他 SM 列为空
    if (hasContent || row['SM_ID']) {
      rows.push(row);
    }
  }

  var rowsStr = JSON.stringify(rows);
  var hash = 0;
  for (var i = 0; i < rowsStr.length; i++) {
    hash = ((hash << 5) - hash) + rowsStr.charCodeAt(i);
    hash |= 0;
  }
  
  return {
    rows: rows,
    sheetName: sheet.getName(),
    timestamp: hash.toString()
  };
}

/**
 * 更新单行的 SM_ 列
 * 支持两种查找方式（优先 SM_ID，回退 rowIndex）：
 * body.id = SM_ID 值（可选）
 * body.rowIndex = 行号（可选，1-based）
 * body.updates = { SM_分类: "风景", SM_备注: "好看" }
 * body.sheet = sheet 名称
 * body.user = 用户名
 */
function updateRow(body) {
  var sheet = getSheet(body.sheet);
  var smId = body.id || '';
  var directRowIndex = body.rowIndex || 0;
  var updates = body.updates;

  if ((!smId && !directRowIndex) || !updates) {
    return { error: '缺少 id/rowIndex 或 updates' };
  }

  // 自动添加用户名
  if (body.user) {
    updates['SM_用户'] = body.user;
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSMColumns(sheet);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    // 优先用 SM_ID 查找，否则用 rowIndex
    var rowIndex = -1;
    if (smId) {
      rowIndex = findRowBySmId(sheet, headers, smId);
    }
    if (rowIndex < 0 && directRowIndex > 1) {
      rowIndex = directRowIndex;
    }
    if (rowIndex < 0) {
      return { error: '找不到目标行 (id=' + smId + ', rowIndex=' + directRowIndex + ')' };
    }

    var updated = {};

    for (var colName in updates) {
      if (SM_COLUMNS.indexOf(colName) === -1 || colName === 'SM_ID') continue;

      var colIndex = headers.indexOf(colName);
      if (colIndex < 0) continue;

      var cell = sheet.getRange(rowIndex, colIndex + 1);
      var existingValue = String(cell.getValue() || '');
      var newValue = String(updates[colName] || '');

      var merged = mergeValue(existingValue, newValue);
      cell.setValue(merged);
      updated[colName] = merged;
    }

    return { ok: true, id: smId, rowIndex: rowIndex, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 批量更新多行的 SM_ 列
 * 支持 SM_ID 和 rowIndex 双模式
 * body.rows = [{ id?: "sm_xxx", rowIndex?: 5, updates: { SM_分类: "风景" } }, ...]
 * body.sheet = sheet 名称
 * body.user = 用户名
 */
function batchUpdateRows(body) {
  var sheet = getSheet(body.sheet);
  var rows = body.rows;
  var user = body.user || '';

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return { error: '缺少 rows 数据' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    ensureSMColumns(sheet);
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    var lastRow = sheet.getLastRow();

    // 建立 SM_ID → 行号映射（可选）
    var idToRow = {};
    var smIdColIdx = headers.indexOf('SM_ID');
    if (smIdColIdx >= 0 && lastRow > 1) {
      var smIdValues = sheet.getRange(2, smIdColIdx + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < smIdValues.length; i++) {
        var id = String(smIdValues[i][0] || '').trim();
        if (id) {
          idToRow[id] = i + 2; // 1-based, skip header
        }
      }
    }

    var results = [];

    rows.forEach(function (rowSpec) {
      var smId = rowSpec.id || '';
      var directRowIndex = rowSpec.rowIndex || 0;
      var updates = rowSpec.updates || {};

      if (user) {
        updates['SM_用户'] = user;
      }

      // 优先用 SM_ID 查找，否则用 rowIndex
      var rowIndex = -1;
      if (smId && idToRow[smId]) {
        rowIndex = idToRow[smId];
      }
      if (rowIndex < 0 && directRowIndex > 1 && directRowIndex <= lastRow) {
        rowIndex = directRowIndex;
      }
      if (rowIndex < 0) {
        results.push({ id: smId, rowIndex: directRowIndex, error: '找不到目标行' });
        return;
      }

      var updated = {};

      for (var colName in updates) {
        if (SM_COLUMNS.indexOf(colName) === -1 || colName === 'SM_ID') continue;

        var colIndex = headers.indexOf(colName);
        if (colIndex < 0) continue;

        var cell = sheet.getRange(rowIndex, colIndex + 1);
        var existingValue = String(cell.getValue() || '');
        var newValue = String(updates[colName] || '');
        var merged = mergeValue(existingValue, newValue);

        cell.setValue(merged);
        updated[colName] = merged;
      }

      results.push({ id: smId, rowIndex: rowIndex, updated: updated });
    });

    return { ok: true, count: results.length, results: results };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 批量写入指定列（任意列，不限于 SM_ 列）
 * 用于将分组/分类结果写回到用户指定的列
 * body.sheet = sheet 名称
 * body.targetColumn = 目标列名（如 "分类", "B" 等）
 * body.rows = [{ rowIndex: 2, value: "风景" }, ...]
 * body.overwrite = true (直接覆盖) 或 false (合并去重)
 */
function batchWriteColumn(body) {
  var sheet = getSheet(body.sheet);
  var targetColumnName = body.targetColumn;
  var rows = body.rows;
  var overwrite = body.overwrite !== false; // 默认覆盖

  if (!targetColumnName || !rows || !Array.isArray(rows) || rows.length === 0) {
    return { error: '缺少 targetColumn 或 rows 数据' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var maxCol = sheet.getMaxColumns();
    var lastCol = sheet.getLastColumn(); // Used for headers
    var headers = sheet.getRange(1, 1, 1, lastCol > 0 ? lastCol : 1).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var maxRow = sheet.getMaxRows();

    // 查找目标列：先按列名匹配，再按列字母匹配
    var colIndex = headers.indexOf(targetColumnName);
    if (colIndex < 0) {
      // 尝试按列字母匹配 (A=0, B=1, ...)
      if (/^[A-Z]{1,2}$/.test(targetColumnName)) {
        var letterIdx = 0;
        for (var c = 0; c < targetColumnName.length; c++) {
          letterIdx = letterIdx * 26 + (targetColumnName.charCodeAt(c) - 64);
        }
        colIndex = letterIdx - 1; // 0-based
        if (colIndex >= maxCol) {
          return { error: '列 ' + targetColumnName + ' 超出表格最大列数 (' + maxCol + ')' };
        }
      } else {
        // 如果不是列字母，且不存在该列名，则自动在末尾创建
        colIndex = maxCol;
        sheet.insertColumnAfter(maxCol);
        sheet.getRange(1, maxCol + 1).setValue(targetColumnName);
        headers.push(targetColumnName);
        maxCol++;
      }
    }

    // Build SM_ID to row index map
    var idToRow = {};
    var smIdColIdx = headers.indexOf('SM_ID');
    if (smIdColIdx >= 0 && maxRow > 1) {
      var smIdValues = sheet.getRange(2, smIdColIdx + 1, maxRow - 1, 1).getValues();
      for (var i = 0; i < smIdValues.length; i++) {
        var id = String(smIdValues[i][0] || '').trim();
        if (id) {
          idToRow[id] = i + 2; // Absolute row index
        }
      }
    }

    var successCount = 0;
    var results = [];

    // Find min and max rows to create a bounding box
    var minRow = Infinity;
    var currentMaxRow = -Infinity;
    var validRows = [];

    rows.forEach(function (rowSpec) {
      var rowIndex = rowSpec.rowIndex || 0;
      // If we have an id and the sheet has SM_ID column, resolve it dynamically
      if (rowSpec.id && idToRow[rowSpec.id]) {
        rowIndex = idToRow[rowSpec.id];
        rowSpec.rowIndex = rowIndex; // update it so memory writeback uses correct index
      }

      if (rowIndex >= 2 && rowIndex <= maxRow) {
        if (rowIndex < minRow) minRow = rowIndex;
        if (rowIndex > currentMaxRow) currentMaxRow = rowIndex;
        validRows.push(rowSpec);
      } else {
        results.push({ rowIndex: rowIndex, error: '行号超出范围(2-' + maxRow + ')' });
      }
    });

    if (validRows.length > 0) {
      var numRows = currentMaxRow - minRow + 1;
      var targetRange = sheet.getRange(minRow, colIndex + 1, numRows, 1);
      
      // If we are merging, we must fetch existing values
      var currentValues;
      if (!overwrite) {
        currentValues = targetRange.getValues();
      } else {
        // Just create an empty array of arrays if overwriting, but wait!
        // We might be sparsely overwriting (e.g. rows 2 and 5), we MUST preserve rows 3 and 4!
        currentValues = targetRange.getValues();
      }

      validRows.forEach(function (rowSpec) {
        var rowIndex = rowSpec.rowIndex;
        var arrayIndex = rowIndex - minRow;
        var value = rowSpec.value !== undefined ? String(rowSpec.value) : '';
        
        if (overwrite) {
          currentValues[arrayIndex][0] = value;
        } else {
          var existingValue = String(currentValues[arrayIndex][0] || '');
          currentValues[arrayIndex][0] = mergeValue(existingValue, value);
        }
        
        successCount++;
        results.push({ rowIndex: rowIndex, value: value });
      });

      // Write all changes back in one operation
      targetRange.setValues(currentValues);

      // Handle optional thumbnail writing
      var writeThumbnails = validRows.some(function(r) { return !!r.image; });
      if (writeThumbnails) {
        var thumbnailColName = 'SM_缩略图';
        var thumbnailColIndex = headers.indexOf(thumbnailColName);
        if (thumbnailColIndex < 0) {
          // Create the column if it doesn't exist
          thumbnailColIndex = maxCol;
          sheet.insertColumnAfter(maxCol);
          sheet.getRange(1, maxCol + 1).setValue(thumbnailColName);
          maxCol++; // Update maxCol just in case
        }
        
        var thumbnailRange = sheet.getRange(minRow, thumbnailColIndex + 1, numRows, 1);
        var currentThumbnails = thumbnailRange.getValues();
        
        validRows.forEach(function (rowSpec) {
          if (rowSpec.image) {
            var arrayIndex = rowSpec.rowIndex - minRow;
            currentThumbnails[arrayIndex][0] = String(rowSpec.image);
          }
        });
        
        thumbnailRange.setValues(currentThumbnails);
      }
    }

    return {
      ok: true,
      count: successCount,
      targetColumn: targetColumnName,
      colIndex: colIndex,
      results: results
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 列出所有 sheet 名
 */
function listSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  return {
    sheets: sheets.map(function (s) {
      return {
        name: s.getName(),
        rowCount: s.getLastRow(),
        colCount: s.getLastColumn()
      };
    })
  };
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 通过 SM_ID 查找行号（1-based）
 * 返回 -1 表示未找到
 */
function findRowBySmId(sheet, headers, smId) {
  var smIdColIdx = headers.indexOf('SM_ID');
  if (smIdColIdx < 0) return -1;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;

  var smIdCol = sheet.getRange(2, smIdColIdx + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < smIdCol.length; i++) {
    if (String(smIdCol[i][0]).trim() === smId) {
      return i + 2; // 1-based, skip header
    }
  }
  return -1;
}

/**
 * 生成唯一 SM_ID：行号 + 时间戳后4位
 */
function generateSmId(rowIndex) {
  var ts = Date.now().toString(36).slice(-4);
  var rand = Math.random().toString(36).slice(2, 5);
  return 'sm_' + rowIndex + '_' + ts + rand;
}

/**
 * 合并去重：相同值保留一个，不同值用逗号连接
 */
function mergeValue(existingValue, newValue) {
  if (!existingValue && !newValue) return '';
  if (!existingValue) return newValue;
  if (!newValue) return existingValue;

  // 拆分为数组（支持中英文逗号）
  var existing = existingValue.split(/[,，]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
  var incoming = newValue.split(/[,，]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);

  // 合并去重
  incoming.forEach(function (val) {
    if (existing.indexOf(val) === -1) {
      existing.push(val);
    }
  });

  return existing.join(', ');
}

/**
 * 确保 SM_ 列存在，不存在则自动创建
 * 同时为没有 SM_ID 的行自动生成唯一 ID
 */
function ensureSMColumns(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  var missing = [];
  SM_COLUMNS.forEach(function (col) {
    if (headers.indexOf(col) === -1) {
      missing.push(col);
    }
  });

  if (missing.length > 0) {
    var startCol = lastCol + 1;
    missing.forEach(function (colName, idx) {
      sheet.getRange(1, startCol + idx).setValue(colName);
    });
    // 刷新 headers
    lastCol = sheet.getLastColumn();
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });
  }

  // 为没有 SM_ID 的行自动生成
  var smIdColIdx = headers.indexOf('SM_ID');
  if (smIdColIdx < 0) return;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var smIdRange = sheet.getRange(2, smIdColIdx + 1, lastRow - 1, 1);
  var smIdValues = smIdRange.getValues();
  var needsUpdate = false;

  for (var i = 0; i < smIdValues.length; i++) {
    if (!smIdValues[i][0] || String(smIdValues[i][0]).trim() === '') {
      smIdValues[i][0] = generateSmId(i + 2);
      needsUpdate = true;
    }
  }

  if (needsUpdate) {
    smIdRange.setValues(smIdValues);
  }
}

/**
 * 获取 Sheet（按名称或默认第一个）
 */
function getSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('找不到工作表: ' + sheetName);
    return sheet;
  }
  return ss.getSheets()[0];
}

/**
 * 返回 JSON 响应
 */
function jsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
