import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Intercept Cloud Build as early as possible to bypass memory-intensive Vite compilation
const isLocal = process.platform === 'darwin' || process.env.LOCAL_DEV === 'true';
const isCloud = !isLocal;
const isBuildCommand = process.argv.includes('build');

if (isCloud && isBuildCommand) {
  console.log('Vite Config: Cloud build environment detected. Bypassing compilation using prebuilt-dist...');
  try {
    let projectRoot = process.cwd();
    try {
      if (typeof __dirname !== 'undefined' && __dirname) {
        projectRoot = __dirname;
      }
    } catch (e) {}

    if (!fs.existsSync(path.resolve(projectRoot, 'package.json'))) {
      if (fs.existsSync(path.resolve(process.cwd(), 'package.json'))) {
        projectRoot = process.cwd();
      }
    }

    const src = path.resolve(projectRoot, 'prebuilt-dist');
    const dest = path.resolve(projectRoot, 'dist');
    if (fs.existsSync(src)) {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.cpSync(src, dest, { recursive: true });
      console.log('Vite Config: Prebuilt assets successfully copied to dist. Exiting builder process.');
      process.exit(0);
    } else {
      console.error('Vite Config: Error - prebuilt-dist folder not found!');
      process.exit(1);
    }
  } catch (err) {
    console.error('Vite Config: Failed to copy prebuilt assets:', err);
    process.exit(1);
  }
}

// 获取当前时间作为构建时间
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

// 图片代理插件（解决跨域）
function imageProxyPlugin(): Plugin {
  return {
    name: 'image-proxy',
    configureServer(server) {
      server.middlewares.use('/api/image-proxy', async (req, res) => {
        const url = new URL(req.url || '', 'http://localhost').searchParams.get('url');
        if (!url) {
          res.writeHead(400);
          res.end('Missing url parameter');
          return;
        }
        console.log('[DEBUG PROXY URL] ->', url);
        try {
          const response = await fetch(url);
          if (!response.ok) {
            res.writeHead(response.status);
            res.end(`Upstream error: ${response.status}`);
            return;
          }
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          const buffer = Buffer.from(await response.arrayBuffer());
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(buffer);
        } catch (err: any) {
          res.writeHead(500);
          res.end(`Proxy error: ${err.message}`);
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // 读取 package.json 中的版本号
  const pkg = require('./package.json');

  return {
    base: './', // 相对路径，Electron file:// 协议需要
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), imageProxyPlugin()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      '__APP_VERSION__': JSON.stringify(pkg.version),
      '__BUILD_TIME__': JSON.stringify(buildTime)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      minify: 'esbuild',
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true
        }
      }
    }
  };
});
