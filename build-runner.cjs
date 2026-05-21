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
      // Fallback if rmSync fails or behaves unexpectedly
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
      // Fallback if cpSync fails or behaves unexpectedly
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
  console.log('Detected cloud container environment.');
  try {
    const src = path.resolve(__dirname, 'prebuilt-dist');
    const dest = path.resolve(__dirname, 'dist');
    
    if (fs.existsSync(src)) {
      console.log('Copying prebuilt assets from prebuilt-dist to dist...');
      // Clean destination first
      if (fs.existsSync(dest)) {
        rmSyncSafe(dest);
      }
      cpSyncSafe(src, dest);
      console.log('Successfully restored prebuilt assets. Build bypassed!');
      process.exit(0);
    } else {
      console.error('Error: prebuilt-dist directory not found in zip!');
      process.exit(1);
    }
  } catch (err) {
    console.error('Failed to copy prebuilt assets:', err);
    process.exit(1);
  }
} else {
  console.log('Detected local environment. Running vite build...');
  try {
    cp.execSync('npx vite build', { stdio: 'inherit' });
    
    // Copy build output to prebuilt-dist for cloud packaging
    const src = path.resolve(__dirname, 'dist');
    const dest = path.resolve(__dirname, 'prebuilt-dist');
    console.log('Updating prebuilt-dist directory with new build...');
    if (fs.existsSync(dest)) {
      rmSyncSafe(dest);
    }
    if (fs.existsSync(src)) {
      cpSyncSafe(src, dest);
    }
    console.log('prebuilt-dist updated successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}
