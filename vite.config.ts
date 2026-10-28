import { defineConfig, type Plugin } from 'vite';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { gameRoot, walk, relativeGamePath, safeGamePath } from './tools/game-files';

const audioTypes: Record<string, string> = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const allowed = new Set(['.rpk', '.rdb', '.scx', '.scy', '.class', '.java', '.cfg', '.tex', '.dds', '.png', '.jpg', '.jpeg', '.tga', '.bmp', ...Object.keys(audioTypes)]);
function gameAssets(): Plugin {
  let index: Promise<{ path: string; size: number }[]> | undefined;
  const videos = new Map<string, Promise<Buffer>>();
  function browserVideo(requested: string) {
    let video = videos.get(requested);
    if (!video) {
      video = (async () => {
        const binary = ffmpegPath;
        if (!binary) throw new Error('FFmpeg unavailable');
        const source = await safeGamePath(requested);
        if (!/\.(avi|mp4|webm)$/i.test(source)) throw new Error('Unsupported video source');
        return new Promise<Buffer>((resolve, reject) => {
          const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-i', source,
            '-vf', 'fps=15,scale=1280:720', '-an', '-c:v', 'libvpx-vp9', '-deadline', 'realtime',
            '-cpu-used', '8', '-b:v', '950k', '-f', 'webm', 'pipe:1'], { windowsHide: true });
          const chunks: Buffer[] = []; let size = 0;
          child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 32 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
          child.on('error', reject);
          child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`Video conversion failed (${code})`)));
        });
      })().catch(error => { videos.delete(requested); throw error; });
      videos.set(requested, video);
    }
    return video;
  }
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
            index ??= walk(gameRoot).then(files => Promise.all(files.map(async f => {
              const relative = relativeGamePath(f);
              const readable = allowed.has(path.extname(f).toLowerCase()) || relative.toLowerCase().startsWith('save/');
              return { path: relative, size: readable ? (await stat(f)).size : 0 };
            })));
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await index));
          } else if (url.pathname === '/video' || url.pathname === '/menu-video') {
            const hd = 'data/Fmv/background_motion_HD.avi';
            const sd = 'data/Fmv/background_motion.avi';
            const requested = url.pathname === '/menu-video'
              ? await stat(path.join(gameRoot, hd)).then(() => hd, () => sd)
              : url.searchParams.get('path') ?? '';
            const video = await browserVideo(requested);
            res.setHeader('Content-Type', 'video/webm'); res.setHeader('Content-Length', video.length); res.end(video);
          } else if (url.pathname === '/file') {
            const f = await safeGamePath(url.searchParams.get('path') ?? '');
            if (!allowed.has(path.extname(f).toLowerCase()) && !relativeGamePath(f).toLowerCase().startsWith('save/')) { res.statusCode = 403; res.end(); return; }
            const info = await stat(f), audioType = audioTypes[path.extname(f).toLowerCase()];
            if (audioType) {
              const range = req.headers.range;
              let start = 0, end = info.size - 1;
              if (range) {
                const match = /^bytes=(\d+)-(\d*)$/.exec(range);
                if (!match || Number(match[1]) >= info.size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${info.size}`); res.end(); return; }
                start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
                if (end < start) { res.statusCode = 416; res.end(); return; }
                res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
              }
              res.setHeader('Content-Type', audioType); res.setHeader('Accept-Ranges', 'bytes');
              res.setHeader('Content-Length', end - start + 1);
              createReadStream(f, { start, end }).pipe(res);
              return;
            }
            if (info.size > 128 * 1024 * 1024) throw new Error('File exceeds 128 MiB browser import limit');
            res.setHeader('Content-Type', 'application/octet-stream'); res.end(await readFile(f));
          } else { res.statusCode = 404; res.end(); }
        } catch (e) { res.statusCode = 400; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(String(e)); }
      });
    }
  };
}
export default defineConfig({
  plugins: [gameAssets()],
  resolve: { alias: [
    { find: /^slrr-jvm$/, replacement: path.resolve('packages/slrr-jvm/src/index.ts') },
    { find: /^slrr-jvm-compiler$/, replacement: path.resolve('src/runtime/jvm-compiler-browser.ts') },
  ] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
