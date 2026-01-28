/**
 * ITEN AI 工具包 - 文本库 GAS 服务 (Google Apps Script)
 * 
 * 功能说明：
 * 此脚本提供一个 Web App API，用于读取和写入 Google Sheets 表格。
 * 主要用于"文案查重"模块的文本库功能。
 * 
 * 部署步骤：
 * 1. 打开 Google Sheets 表格（用于存储文本库）
 * 2. 点击菜单：扩展程序 > Apps Script
 * 3. 删除默认代码，粘贴此脚本的全部内容
 * 4. 点击"部署" > "新建部署"
 * 5. 选择类型"Web 应用"
 * 6. 设置：
 *    - 说明：输入描述，如"文本库服务"
 *    - 执行身份：选择"我（您的邮箱地址）"
 *    - 谁可以访问：选择"任何人"（重要！）
 * 7. 点击"部署"，复制生成的 Web App URL
 * 8. 将 URL 粘贴到 ITEN AI 工具包的"文本库设置"中
 * 
 * 注意事项：
 * - 每次修改脚本后需要重新部署新版本
 * - 更新部署：部署 > 管理部署 > 编辑 > 新版本
 * 
 * @version 1.0.0
 * @author ITEN AI Toolkit
 */

// ==================== 配置 ====================

// 默认使用当前活动的表格，也可以指定表格 ID
const SPREADSHEET_ID = null; // 留空使用当前表格，或填入具体 ID 如 "1BxiM..."

// ==================== Web App 入口 ====================

/**
 * 处理 GET 请求（用于读取数据）
 */
function doGet(e) {
  try {
    const params = e.parameter;
    const action = params.action || 'read';
    
    let result;
    switch (action) {
      case 'read':
        result = handleRead(params);
        break;
      case 'list':
        result = handleListSheets(params);
        break;
      case 'info':
        result = handleInfo(params);
        break;
      default:
        result = { success: false, error: '未知操作: ' + action };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 处理 POST 请求（用于写入数据）
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'write';
    
    let result;
    switch (action) {
      case 'write':
        result = handleWrite(data);
        break;
      case 'append':
        result = handleAppend(data);
        break;
      case 'createSheet':
        result = handleCreateSheet(data);
        break;
      case 'renameSheet':
        result = handleRenameSheet(data);
        break;
      case 'deleteSheet':
        result = handleDeleteSheet(data);
        break;
      case 'deleteRows':
        result = handleDeleteRows(data);
        break;
      case 'update':
        result = handleUpdate(data);
        break;
      default:
        result = { success: false, error: '未知操作: ' + action };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==================== 辅助函数 ====================

/**
 * 获取 Spreadsheet 对象
 */
function getSpreadsheet(spreadsheetId) {
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 获取或创建工作表
 */
function getOrCreateSheet(ss, sheetName, createIfNotExist = false) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet && createIfNotExist) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

// ==================== 读取操作 ====================

/**
 * 读取表格数据
 * @param {Object} params - 参数对象
 *   - spreadsheetId: 可选，表格 ID
 *   - sheetName: 可选，工作表名称（默认第一个工作表）
 *   - range: 可选，范围如 "A1:D10"
 *   - includeHeader: 可选，是否包含表头（默认 true）
 */
function handleRead(params) {
  const ss = getSpreadsheet(params.spreadsheetId);
  const sheetName = params.sheetName;
  const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
  
  if (!sheet) {
    return { success: false, error: '找不到工作表: ' + sheetName };
  }
  
  let values;
  if (params.range) {
    values = sheet.getRange(params.range).getValues();
  } else {
    values = sheet.getDataRange().getValues();
  }
  
  // 转换为对象数组（如果有表头）
  const includeHeader = params.includeHeader !== 'false';
  if (includeHeader && values.length > 0) {
    const headers = values[0];
    const rows = values.slice(1).map((row, idx) => {
      const obj = { _rowIndex: idx + 2 }; // 1-based row number
      headers.forEach((header, i) => {
        obj[header] = row[i];
      });
      return obj;
    });
    return { success: true, data: { headers, rows } };
  }
  
  return { success: true, data: { values } };
}

/**
 * 列出所有工作表
 */
function handleListSheets(params) {
  const ss = getSpreadsheet(params.spreadsheetId);
  const sheets = ss.getSheets().map(sheet => ({
    name: sheet.getName(),
    rowCount: sheet.getLastRow(),
    colCount: sheet.getLastColumn()
  }));
  return { success: true, data: { sheets } };
}

/**
 * 获取表格信息
 */
function handleInfo(params) {
  const ss = getSpreadsheet(params.spreadsheetId);
  return {
    success: true,
    data: {
      id: ss.getId(),
      name: ss.getName(),
      url: ss.getUrl(),
      sheets: ss.getSheets().map(s => s.getName())
    }
  };
}

// ==================== 写入操作 ====================

/**
 * 写入数据（覆盖指定区域）
 * @param {Object} data - 请求数据
 *   - spreadsheetId: 可选，表格 ID
 *   - sheetName: 工作表名称
 *   - range: 起始位置如 "A1"
 *   - values: 二维数组数据
 */
function handleWrite(data) {
  const ss = getSpreadsheet(data.spreadsheetId);
  const sheet = getOrCreateSheet(ss, data.sheetName, true);
  
  if (!data.values || !Array.isArray(data.values)) {
    return { success: false, error: '缺少有效的 values 数据' };
  }
  
  const range = data.range || 'A1';
  const numRows = data.values.length;
  const numCols = data.values[0]?.length || 1;
  
  sheet.getRange(range).offset(0, 0, numRows, numCols).setValues(data.values);
  
  return { 
    success: true, 
    message: `已写入 ${numRows} 行 ${numCols} 列数据`,
    data: { rowsWritten: numRows, colsWritten: numCols }
  };
}

/**
 * 追加数据（添加到表格末尾）
 * @param {Object} data - 请求数据
 *   - spreadsheetId: 可选，表格 ID
 *   - sheetName: 工作表名称
 *   - values: 二维数组数据
 */
function handleAppend(data) {
  const ss = getSpreadsheet(data.spreadsheetId);
  const sheet = getOrCreateSheet(ss, data.sheetName, true);
  
  if (!data.values || !Array.isArray(data.values)) {
    return { success: false, error: '缺少有效的 values 数据' };
  }
  
  const lastRow = sheet.getLastRow();
  const numRows = data.values.length;
  const numCols = data.values[0]?.length || 1;
  
  sheet.getRange(lastRow + 1, 1, numRows, numCols).setValues(data.values);
  
  return { 
    success: true, 
    message: `已追加 ${numRows} 行数据`,
    data: { rowsAppended: numRows, startRow: lastRow + 1 }
  };
}

/**
 * 更新特定行
 * @param {Object} data - 请求数据
 *   - spreadsheetId: 可选，表格 ID
 *   - sheetName: 工作表名称
 *   - rowIndex: 行号（1-based）
 *   - values: 一维数组（一行数据）
 */
function handleUpdate(data) {
  const ss = getSpreadsheet(data.spreadsheetId);
  const sheet = ss.getSheetByName(data.sheetName);
  
  if (!sheet) {
    return { success: false, error: '找不到工作表: ' + data.sheetName };
  }
  
  if (!data.rowIndex || !data.values) {
    return { success: false, error: '缺少 rowIndex 或 values' };
  }
  
  const numCols = data.values.length;
  sheet.getRange(data.rowIndex, 1, 1, numCols).setValues([data.values]);
  
  return { 
    success: true, 
    message: `已更新第 ${data.rowIndex} 行`,
    data: { updatedRow: data.rowIndex }
  };
}

/**
 * 删除行
 * @param {Object} data - 请求数据
 *   - spreadsheetId: 可选，表格 ID
 *   - sheetName: 工作表名称
 *   - rowIndexes: 行号数组（1-based），将按降序删除
 */
function handleDeleteRows(data) {
  const ss = getSpreadsheet(data.spreadsheetId);
  const sheet = ss.getSheetByName(data.sheetName);
  
  if (!sheet) {
    return { success: false, error: '找不到工作表: ' + data.sheetName };
  }
  
  if (!data.rowIndexes || !Array.isArray(data.rowIndexes)) {
    return { success: false, error: '缺少有效的 rowIndexes 数组' };
  }
  
  // 按降序删除，避免行号偏移
  const sortedIndexes = [...data.rowIndexes].sort((a, b) => b - a);
  sortedIndexes.forEach(idx => {
    if (idx > 0 && idx <= sheet.getLastRow()) {
      sheet.deleteRow(idx);
    }
  });
  
  return { 
    success: true, 
    message: `已删除 ${sortedIndexes.length} 行`,
    data: { deletedRows: sortedIndexes.length }
  };
}

// ==================== 工作表管理 ====================

/**
 * 创建新工作表
 * @param {Object} data - 请求数据
 *   - spreadsheetId: 可选，表格 ID
 *   - sheetName: 新工作表名称
 *   - headers: 可选，表头数组
 */
function handleCreateSheet(data) {
  const ss = getSpreadsheet(data.spreadsheetId);
  
  if (!data.sheetName) {
    return { success: false, error: '缺少工作表名称' };
  }
  
  // 检查是否已存在
  if (ss.getSheetByName(data.sheetName)) {
    return { success: false, error: '工作表已存在: ' + data.sheetName };
  }
  
  const sheet = ss.insertSheet(data.sheetName);
  
  // 如果提供了表头，写入表头
  if (data.headers && Array.isArray(data.headers)) {
    sheet.getRange(1, 1, 1, data.headers.length).setValues([data.headers]);
  }
  
  return { 
    success: true, 
    message: `已创建工作表: ${data.sheetName}`,
    data: { sheetName: data.sheetName }
  };
}

/**
 * 重命名工作表
 * @param {Object} data - 请求数据
 *   - spreadsheetId: 可选，表格 ID
 *   - oldName: 原名称
 *   - newName: 新名称
 */
function handleRenameSheet(data) {
  const ss = getSpreadsheet(data.spreadsheetId);
  const sheet = ss.getSheetByName(data.oldName);
  
  if (!sheet) {
    return { success: false, error: '找不到工作表: ' + data.oldName };
  }
  
  if (ss.getSheetByName(data.newName)) {
    return { success: false, error: '目标名称已存在: ' + data.newName };
  }
  
  sheet.setName(data.newName);
  
  return { 
    success: true, 
    message: `已重命名: ${data.oldName} -> ${data.newName}`,
    data: { oldName: data.oldName, newName: data.newName }
  };
}

/**
 * 删除工作表
 * @param {Object} data - 请求数据
 *   - spreadsheetId: 可选，表格 ID
 *   - sheetName: 要删除的工作表名称
 */
function handleDeleteSheet(data) {
  const ss = getSpreadsheet(data.spreadsheetId);
  const sheet = ss.getSheetByName(data.sheetName);
  
  if (!sheet) {
    return { success: false, error: '找不到工作表: ' + data.sheetName };
  }
  
  // 确保不是唯一的工作表
  if (ss.getSheets().length <= 1) {
    return { success: false, error: '不能删除唯一的工作表' };
  }
  
  ss.deleteSheet(sheet);
  
  return { 
    success: true, 
    message: `已删除工作表: ${data.sheetName}`,
    data: { deletedSheet: data.sheetName }
  };
}

// ==================== 测试函数 ====================

/**
 * 测试 GAS 服务是否正常工作
 * 在 Apps Script 编辑器中运行此函数进行测试
 */
function testService() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('表格名称: ' + ss.getName());
  Logger.log('表格 ID: ' + ss.getId());
  Logger.log('工作表数量: ' + ss.getSheets().length);
  Logger.log('工作表列表: ' + ss.getSheets().map(s => s.getName()).join(', '));
  Logger.log('\n✅ GAS 服务正常！');
}
