const cp = require('child_process');
const fs = require('fs');
const path = require('path');

// Safe rmSync fallback for older Node.js versions
function rmSyncSafe(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  
  if (fs.rmSync) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (e) {
      // Fallback
    }
  }
  
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        rmSyncSafe(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    }
    fs.rmdirSync(dirPath);
  } catch (e) {
    console.warn(`rmSyncSafe fallback warning for ${dirPath}:`, e);
  }
}

// Safe cpSync fallback for older Node.js versions
function cpSyncSafe(src, dest) {
  if (fs.cpSync) {
    try {
      fs.cpSync(src, dest, { recursive: true });
      return;
    } catch (e) {
      // Fallback
    }
  }
  
  try {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      const files = fs.readdirSync(src);
      for (const file of files) {
        cpSyncSafe(path.join(src, file), path.join(dest, file));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  } catch (e) {
    console.error(`cpSyncSafe failed for ${src} -> ${dest}:`, e);
    throw e;
  }
}

const isLocal = process.platform === 'darwin' || process.env.LOCAL_DEV === 'true';
const isCloud = !isLocal;

if (isCloud) {
  console.log('Detected cloud container environment. Starting vite preview...');
  try {
    const src = path.resolve(__dirname, 'prebuilt-dist');
    const dest = path.resolve(__dirname, 'dist');
    
    // Always restore dist from prebuilt-dist in cloud mode to keep assets fresh
    if (fs.existsSync(src)) {
      console.log('Restoring dist from prebuilt-dist...');
      if (fs.existsSync(dest)) {
        rmSyncSafe(dest);
      }
      cpSyncSafe(src, dest);
      console.log('Successfully restored prebuilt assets in dev runner.');
    }
  } catch (err) {
    console.warn('Failed to restore dist in dev runner:', err);
  }
  
  const port = process.env.PORT || '3000';
  console.log(`Starting vite preview on port ${port}...`);
  const child = cp.spawn('npx', ['vite', 'preview', '--port', port, '--host', '0.0.0.0'], {
    stdio: 'inherit',
    shell: true
  });
  child.on('exit', (code) => process.exit(code || 0));
} else {
  console.log('Detected local environment. Starting vite dev server...');
  const child = cp.spawn('npx', ['vite'], {
    stdio: 'inherit',
    shell: true
  });
  child.on('exit', (code) => process.exit(code || 0));
}
