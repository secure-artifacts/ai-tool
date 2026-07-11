const fs = require('fs');
const cp = require('child_process');
const path = require('path');

// Paths
const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.resolve(rootDir, 'package.json');
const runnerPath = path.resolve(rootDir, 'dev-runner.cjs');

console.log('Step 1: Running local Vite production build...');
try {
  cp.execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  console.log('✓ Build completed successfully.');
} catch (err) {
  console.error('✗ Build failed:', err);
  process.exit(1);
}

// Backup package.json and dev-runner.cjs
const backupPkgPath = pkgPath + '.backup';
const backupRunnerPath = runnerPath + '.backup';
fs.writeFileSync(backupPkgPath, fs.readFileSync(pkgPath, 'utf8'), 'utf8');
fs.writeFileSync(backupRunnerPath, fs.readFileSync(runnerPath, 'utf8'), 'utf8');
console.log('✓ Original files backed up.');

try {
  // 1. Create a zero-dependency package.json for the ZIP
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = {};
  pkg.devDependencies = {};
  pkg.engines = { node: '>=18' };
  pkg.scripts = {
    "dev": "node dev-runner.cjs",
    "start": "node dev-runner.cjs",
    "build": "node build-runner.cjs",
    "preview": "node dev-runner.cjs"
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
  console.log('✓ Created zero-dependency package.json configuration.');

  // 2. Create a zero-dependency Node HTTP server in dev-runner.cjs for the ZIP
  const zeroDepRunnerContent = `const http = require('http');
const fs = require('fs');
const path = require('path');

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.worker.js': 'application/javascript'
};

const port = process.env.PORT || '3000';
const publicDir = path.resolve(__dirname, 'prebuilt-dist');

// Auto kill existing process on the port to prevent port collision and force reload
try {
  const cp = require('child_process');
  const pid = cp.execSync('lsof -t -i:' + port, { encoding: 'utf8' }).trim();
  if (pid) {
    console.log('Port ' + port + ' is occupied by PID ' + pid + '. Killing it to force reload...');
    cp.execSync('kill -9 ' + pid);
  }
} catch (e) {}

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  
  // Strip subpaths to support reverse proxy deployment (like AI Studio applet paths)
  const assetsIdx = urlPath.indexOf('/assets/');
  if (assetsIdx !== -1) {
    urlPath = urlPath.substring(assetsIdx);
  }

  let filePath = path.join(publicDir, urlPath);
  if (filePath === publicDir || filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(publicDir)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(publicDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(Number(port), '0.0.0.0', () => {
  console.log(\`Zero-dependency HTTP server running at http://0.0.0.0:\${port}/\`);
});
`;
  fs.writeFileSync(runnerPath, zeroDepRunnerContent, 'utf8');
  console.log('✓ Created zero-dependency dev-runner.cjs configuration.');

  // Verify that the prebuilt app is complete before creating a package that
  // cannot compile its source in AI Studio's zero-dependency environment.
  const prebuiltDir = path.resolve(rootDir, 'prebuilt-dist');
  const prebuiltIndex = path.resolve(prebuiltDir, 'index.html');
  if (!fs.existsSync(prebuiltIndex)) {
    throw new Error('prebuilt-dist/index.html is missing after the local build.');
  }
  const indexHtml = fs.readFileSync(prebuiltIndex, 'utf8');
  const referencedAssets = [...indexHtml.matchAll(/(?:src|href)=["']\.\/?([^"'#?]+)["']/g)]
    .map(match => match[1])
    .filter(asset => !asset.startsWith('http'));
  const missingAssets = referencedAssets.filter(asset => !fs.existsSync(path.resolve(prebuiltDir, asset)));
  if (missingAssets.length) {
    throw new Error(`prebuilt-dist has missing referenced assets: ${missingAssets.join(', ')}`);
  }
  console.log(`✓ Verified prebuilt-dist (${referencedAssets.length} referenced assets).`);

  // Run zip command
  console.log('Step 2: Zipping project for AI Studio...');
  const zipFile = process.env.AISTUDIO_ZIP_OUTPUT
    ? path.resolve(process.env.AISTUDIO_ZIP_OUTPUT)
    : path.resolve(process.env.HOME, 'Desktop', `ai-toolkit-源码-v${pkg.version}.zip`);
  
  if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
  }

  const exclusions = [
    "node_modules/*",
    "**/node_modules/*",
    ".git/*",
    "dist/*",
    "dist-electron/*",
    "electron/*",
    "functions/*",
    "package-lock.json",
    "docs/*",
    ".agents/*",
    ".gemini/*",
    ".github/*",
    ".agent/*",
    ".firebase/*",
    "google-apps-script/*",
    "scripts/*",
    "extensions/*",
    "*.zip",
    "*.dmg",
    "*.blockmap",
    "*.log",
    "*.backup*",
    "**/*.backup*",
    ".playwright-mcp/*",
    ".vscode/*",
    ".DS_Store",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "AI创作工具包-*/*",
    "ai-toolkit-*/*",
    "版本归档/*",
    "未命名文件夹/*",
    "backups/*",
    "*.rej",
    "*.py",
    "*.patch",
    "*.txt",
    "test_*",
    "test-*",
    "temp_*",
    "tsc_*",
    "fix_*",
    "format_*",
    "_move_*",
    "CopywritingView_diff*",
    "copywriting_diff*",
    "*.orig",
    "*.png"
  ];

  const exclusionArgs = exclusions.map(ex => `-x "${ex}"`).join(' ');
  const zipCmd = `zip -r "${zipFile}" . ${exclusionArgs}`;

  cp.execSync(zipCmd, { cwd: rootDir, stdio: 'inherit' });
  console.log(`✓ Zip package created successfully at: ${zipFile}`);

} catch (err) {
  console.error('✗ Packaging failed:', err);
  process.exitCode = 1;
} finally {
  // Restore original package.json and dev-runner.cjs
  if (fs.existsSync(backupPkgPath)) {
    fs.writeFileSync(pkgPath, fs.readFileSync(backupPkgPath, 'utf8'), 'utf8');
    fs.unlinkSync(backupPkgPath);
  }
  if (fs.existsSync(backupRunnerPath)) {
    fs.writeFileSync(runnerPath, fs.readFileSync(backupRunnerPath, 'utf8'), 'utf8');
    fs.unlinkSync(backupRunnerPath);
  }
  console.log('✓ Restored original files locally.');
}
