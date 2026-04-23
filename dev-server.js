const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const port = Number(process.env.PORT || 5173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function resolvePath(urlPath) {
  const requestedPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^[/\\]+/, '');
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const directPath = path.resolve(root, safePath);

  // If user hits a clean URL like /login or /app, serve the matching html file.
  if (!path.extname(directPath)) {
    const htmlPath = `${directPath}.html`;
    if (fs.existsSync(htmlPath)) {
      return htmlPath;
    }
  }

  // If a directory is requested, default to index.html in that directory.
  if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
    const indexPath = path.join(directPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }

  return directPath;
}

http.createServer((request, response) => {
  const urlPath = decodeURIComponent((request.url || '/').split('?')[0]);
  const filePath = resolvePath(urlPath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    response.end(data);
  });
}).listen(port, () => {
  console.log(`Lumen Chat running at http://localhost:${port}`);
});
