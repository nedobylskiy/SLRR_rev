import { defineConfig, type Plugin } from 'vite';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './tools/game-files';
import { isSavedVehiclePath } from './src/assets';

const allowed = new Set(['.rpk', '.rdb', '.scx', '.scy', '.class', '.java', '.cfg', '.tex', '.dds', '.png', '.jpg', '.jpeg', '.tga', '.bmp']);
function gameAssets(): Plugin {
  let index: Promise<{ path: string; size: number }[]> | undefined;
  return {
    name: 'local-slrr-assets',
    configureServer(server) {
      server.middlewares.use('/api/game', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        const host = req.headers.host ?? '';
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { res.statusCode = 403; res.end(); return; }
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          res.setHeader('Cache-Control', 'no-store');
          if (url.pathname === '/index') {
            index ??= walk(gameRoot).then(files => Promise.all(files.filter(f => allowed.has(path.extname(f).toLowerCase()) || isSavedVehiclePath(relativeGamePath(f))).map(async f => ({ path: relativeGamePath(f), size: (await stat(f)).size }))));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await index));
          } else if (url.pathname === '/file') {
            const f = await safeGamePath(url.searchParams.get('path') ?? '');
            if (!allowed.has(path.extname(f).toLowerCase()) && !isSavedVehiclePath(relativeGamePath(f))) { res.statusCode = 403; res.end(); return; }
            if ((await stat(f)).size > 128 * 1024 * 1024) throw new Error('File exceeds 128 MiB browser import limit');
            res.setHeader('Content-Type', 'application/octet-stream'); res.end(await readFile(f));
          } else { res.statusCode = 404; res.end(); }
        } catch (e) { res.statusCode = 400; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(String(e)); }
      });
    }
  };
}
export default defineConfig({ plugins: [gameAssets()], server: { host: '127.0.0.1', port: 5173, strictPort: true } });
