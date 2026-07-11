# Project Rules

## AI Studio Packaging Rules (CRITICAL)
Whenever the user asks to "打包" or "打包 AI Studio 版本" (Package AI Studio version):
1. **Always run local build first**: You MUST run `npm run build` in the workspace root before zipping. This compiles the TypeScript assets and populates the `prebuilt-dist/` folder, which is what the cloud container serves. Skipping this step will result in outdated assets being uploaded.
2. **Always keep package.json secure**: You MUST NEVER modify the SheetJS CDN link (`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`) to use public registry versions, as those contain high-severity vulnerabilities.
3. **Use the exact lightweight zip command**: You MUST use the following command to exclude redundant directories and keep the ZIP size under 7MB:
   ```bash
   rm ~/Desktop/ai-toolkit-源码-v*.zip 2>/dev/null; \
   zip -r ~/Desktop/ai-toolkit-源码-v$(node -p "require('./package.json').version").zip . \
       -x "node_modules/*" \
       -x "**/node_modules/*" \
       -x ".git/*" \
       -x "dist/*" \
       -x "dist-electron/*" \
       -x "electron/*" \
       -x "functions/*" \
       -x "*.backup*" \
       -x "**/*.backup*" \
       -x ".playwright-mcp/*" \
       -x ".vscode/*" \
       -x ".DS_Store" \
       -x "*.log" \
       -x "*.dmg" \
       -x "*.blockmap" \
       -x "*.zip" \
       -x "AI创作工具包-*/*" \
       -x "ai-toolkit-*/*" \
       -x "版本归档/*" \
       -x "未命名文件夹/*" \
       -x "backups/*" \
       -x "docs/*" \
       -x "functions/node_modules/*"
   ```
