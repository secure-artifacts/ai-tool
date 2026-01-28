import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// 获取当前时间作为构建时间
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');

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
    plugins: [react()],
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
    }
  };
});
