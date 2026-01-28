# Google Sheets 认证配置指南

本指南将帮助您配置 Google Sheets 的认证方式，以便使用应用的读写功能。

## 目录

- [认证模式选择](#认证模式选择)
- [API Key 模式（只读）](#api-key-模式只读)
- [Service Account 模式（读写）](#service-account-模式读写)
- [自定义 OAuth 模式（读写）](#自定义-oauth-模式读写)
- [常见问题](#常见问题)

---

## 认证模式选择

| 模式 | 权限 | 难度 | 推荐场景 |
|------|------|------|----------|
| **API Key** | 只读 | ⭐ 简单 | 仅需查看/分析数据 |
| **Service Account** | 读写 | ⭐⭐ 中等 | 自动化操作、长期使用 |
| **自定义 OAuth** | 读写 | ⭐⭐⭐ 较难 | 需要用户级别的权限 |

### 需要写入权限的功能

以下功能需要配置写入权限（Service Account 或 OAuth）：

**数据分析模块：**
- 同步版本到 Google Sheets（创建新分页）
- 更新文件状态

**专业文案查重：**
- 入库（添加文案到表格）
- 创建/重命名/删除分类

**如果您不需要以上功能，使用默认的 API Key（只读）模式即可。**

---

## API Key 模式（只读）

这是默认模式，无需任何配置。

**要求：** 您的 Google Sheets 需要设置为"知道链接的任何人可查看"。

**设置步骤：**
1. 打开您的 Google Sheets
2. 点击右上角"共享"按钮
3. 点击"更改"链接限制
4. 选择"知道链接的任何人"
5. 权限选择"查看者"
6. 点击"完成"

---

## Service Account 模式（读写）

Service Account 是一个专门用于程序访问的账号，适合长期稳定使用。

### 步骤 1：创建 Google Cloud 项目

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 如果没有项目，点击顶部的项目选择器 → "新建项目"
3. 输入项目名称（如 "我的表格工具"）
4. 点击"创建"
5. 等待项目创建完成，确保已选中该项目

### 步骤 2：启用 Google Sheets API

1. 在左侧菜单中选择 "API 和服务" → "库"
2. 在搜索框中输入 "Google Sheets API"
3. 点击搜索结果中的 "Google Sheets API"
4. 点击蓝色的 "启用" 按钮
5. 等待 API 启用

### 步骤 3：创建 Service Account

1. 在左侧菜单中选择 "API 和服务" → "凭据"
2. 点击顶部的 "+ 创建凭据" → "服务账号"
3. 填写服务账号详细信息：
   - 服务账号名称：如 "sheets-writer"
   - 服务账号 ID：自动生成
   - 描述：可选
4. 点击 "创建并继续"
5. 跳过角色选择（可选），点击 "继续"
6. 点击 "完成"

### 步骤 4：生成密钥文件

1. 在"服务账号"列表中，点击刚创建的账号
2. 切换到 "密钥" 标签页
3. 点击 "添加密钥" → "创建新密钥"
4. 选择 "JSON" 格式
5. 点击 "创建"
6. **密钥文件会自动下载到您的电脑**（请妥善保管）

### 步骤 5：共享表格给 Service Account

1. 打开 JSON 密钥文件，找到 `client_email` 字段
   - 例如：`sheets-writer@your-project.iam.gserviceaccount.com`
2. 打开您想要操作的 Google Sheets
3. 点击右上角 "共享" 按钮
4. 在输入框中粘贴 Service Account 邮箱
5. 权限选择 "编辑者"
6. 点击 "发送"（不需要发送通知邮件）

### 步骤 6：导入密钥到应用

1. 在应用中打开 "Sheets 认证配置"
2. 选择 "Service Account（读写）" 模式
3. 点击 "选择 JSON 密钥文件"
4. 选择之前下载的 JSON 文件
5. 看到"已导入"提示即表示成功

---

## 自定义 OAuth 模式（读写）

这种模式适合需要完整用户权限的场景，配置相对复杂。

### 步骤 1：创建 Google Cloud 项目

（同 Service Account 步骤 1）

### 步骤 2：启用 Google Sheets API

（同 Service Account 步骤 2）

### 步骤 3：配置 OAuth 同意屏幕

1. 在左侧菜单中选择 "API 和服务" → "OAuth 同意屏幕"
2. 用户类型选择 "外部"，点击 "创建"
3. 填写应用信息：
   - 应用名称：如 "我的表格工具"
   - 用户支持电子邮件：选择您的邮箱
   - 开发者联系信息：填写您的邮箱
4. 点击 "保存并继续"
5. 在"范围"页面，点击 "添加或移除范围"
6. 搜索并选择 `https://www.googleapis.com/auth/spreadsheets`
7. 点击 "更新" 和 "保存并继续"
8. 添加测试用户（您自己的邮箱）
9. 点击 "保存并继续" 和 "返回信息中心"

### 步骤 4：创建 OAuth Client ID

1. 在左侧菜单中选择 "API 和服务" → "凭据"
2. 点击 "+ 创建凭据" → "OAuth 客户端 ID"
3. 应用类型选择 "Web 应用"
4. 名称：如 "我的表格工具 Web"
5. 在 "已授权的重定向 URI" 中添加：
   - `https://ai-toolkit-b2b78.web.app/oauth-callback`
   - `http://localhost:5173/oauth-callback`（开发用）
6. 点击 "创建"
7. **复制并保存 Client ID 和 Client Secret**

### 步骤 5：导入配置到应用

1. 在应用中打开 "Sheets 认证配置"
2. 选择 "自定义 OAuth（读写）" 模式
3. 填写 Client ID 和 Client Secret
4. 点击 "保存配置"
5. 然后进行 OAuth 登录授权

---

## 常见问题

### Q: 密钥文件丢失了怎么办？

A: Service Account 密钥无法重新下载，但可以创建新的密钥：
1. 进入 Google Cloud Console → 凭据
2. 点击 Service Account
3. 删除旧密钥，创建新密钥

### Q: 提示"没有权限访问此表格"？

A: 确保您已将表格共享给 Service Account 邮箱，并给予"编辑者"权限。

### Q: OAuth 登录失败？

A: 检查：
1. OAuth 同意屏幕是否配置完成
2. 重定向 URI 是否正确
3. 如果是测试模式，确保您的邮箱在测试用户列表中

### Q: 哪种模式最推荐？

A: 
- **日常使用**：Service Account 最稳定
- **只需查看**：API Key 最简单
- **需要完整权限**：自定义 OAuth

### Q: 密钥安全吗？

A: 
- 密钥仅存储在您的浏览器本地（localStorage）
- 不会上传到任何服务器
- 建议定期轮换密钥
