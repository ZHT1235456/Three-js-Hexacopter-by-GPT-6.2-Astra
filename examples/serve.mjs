import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const three = join(root, 'node_modules', 'three');
const files = new Map([
  ['/', join(root, 'examples', 'preview.html')],
  ['/hexacopter.mjs', join(root, 'hexacopter.mjs')],
  ['/reference-components.png', join(root, 'docs', 'reference', 'components-multiview.png')],
  ['/three.module.js', join(three, 'build', 'three.module.js')],
  ['/three.core.js', join(three, 'build', 'three.core.js')],
  ['/orbit.js', join(three, 'examples', 'jsm', 'controls', 'OrbitControls.js')],
  ['/room.js', join(three, 'examples', 'jsm', 'environments', 'RoomEnvironment.js')],
]);

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (!files.has(path)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(files.get(path));
    let type = 'text/javascript; charset=utf-8';
    if (path === '/') type = 'text/html; charset=utf-8';
    if (path.endsWith('.png')) type = 'image/png';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(500).end('Preview asset unavailable');
  }
});

server.once('error', error => {
  if (error.code !== 'EADDRINUSE') throw error;
  server.listen(0, '127.0.0.1');
});
server.once('listening', () => console.log('http://127.0.0.1:' + server.address().port + '/'));
server.listen(5173, '127.0.0.1');
