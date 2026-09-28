import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '../site-dist');
const port = Number(process.env.PORT || 4322);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.xml': 'application/xml' };
createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error('Invalid path');
    const info = await stat(file);
    if (info.isDirectory()) {
      if (!path.endsWith('/')) { response.writeHead(302, { Location: `${path}/` }); response.end(); return; }
      file = resolve(file, 'index.html');
    }
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); response.end(await readFile(resolve(root, '404.html'))); }
}).listen(port, '127.0.0.1', () => console.log(`Static Feedme preview: http://127.0.0.1:${port}`));
