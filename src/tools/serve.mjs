// 本機除錯用 HTTP 伺服器：靜態檔 ＋ data 目錄 TSV 清單 ＋ 寫回 TSV。
// 用法：node src/tools/serve.mjs [--port 8123]
//
// 只綁 127.0.0.1。GET /api/tsvs 列出 data/*.tsv；POST /api/tsv/<檔名> 寫回該檔。
// file:// 模式不經過這支伺服器；它仍用檔案選擇器與 File System Access API。
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const DATA = path.join(ROOT, 'data');
const HOST = '127.0.0.1';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT || 8123);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function parseMeta(text) {
  const first = String(text).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  const id = /id\s*:\s*"([^"]*)"/.exec(first);
  const name = /name\s*:\s*"([^"]*)"/.exec(first);
  const hidden = /hidden\s*:\s*"?([a-z]+)"?/.exec(first);
  const group = /group\s*:\s*"([^"]*)"/.exec(first);
  return {
    id: id ? id[1] : '',
    name: name ? name[1] : '',
    hidden: hidden ? hidden[1] === 'true' : false,
    group: group ? group[1] : '',
  };
}

function countEntries(text) {
  let n = 0;
  for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || /^\s*\{.*\}\s*$/.test(line)) continue;
    const tab = line.indexOf('\t');
    const key = (tab < 0 ? line : line.slice(0, tab)).trim();
    if (
      key &&
      key !== '_' &&
      !String(key).startsWith('@') &&
      !String(line.slice(tab + 1)).trim().startsWith('@')
    )
      n++;
  }
  return n;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function safeRel(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch (e) {
    return null;
  }
  const rel = decoded === '/' ? 'build/index.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

async function serveStatic(req, res, url) {
  const full = safeRel(url.pathname);
  if (!full) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  let target = full;
  try {
    let stat = await fsp.stat(target);
    if (stat.isDirectory()) {
      target = path.join(target, 'index.html');
      stat = await fsp.stat(target);
    }
    const body = await fsp.readFile(target);
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + url.pathname);
  }
}

async function listTsvs() {
  const files = (await fsp.readdir(DATA)).filter((name) => name.toLowerCase().endsWith('.tsv')).sort();
  const out = [];
  for (const file of files) {
    const full = path.join(DATA, file);
    const text = await fsp.readFile(full, 'utf8');
    const meta = parseMeta(text);
    const stat = await fsp.stat(full);
    out.push({
      file,
      id: meta.id || file.replace(/\.tsv$/i, ''),
      name: meta.name || meta.id || file.replace(/\.tsv$/i, ''),
      hidden: meta.hidden,
      group: meta.group,
      count: countEntries(text),
      size: stat.size,
    });
  }
  return out;
}

async function saveTsv(req, res, file) {
  let name;
  try {
    name = decodeURIComponent(file);
  } catch (e) {
    json(res, 400, { ok: false, error: 'bad file name' });
    return;
  }
  if (!/^[A-Za-z0-9._-]+\.tsv$/i.test(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
    json(res, 400, { ok: false, error: '只允許 data/ 下的 .tsv 檔名' });
    return;
  }
  const full = path.join(DATA, name);
  if (!full.startsWith(DATA + path.sep)) {
    json(res, 403, { ok: false, error: 'forbidden' });
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) {
      json(res, 413, { ok: false, error: '檔案太大' });
      return;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const meta = parseMeta(text);
  const stem = name.replace(/\.tsv$/i, '');
  if (!meta.id) {
    json(res, 400, { ok: false, error: 'TSV 第一行必須是 {id:"…",name:"…"} 的 meta' });
    return;
  }
  if (meta.id !== stem) {
    json(res, 400, { ok: false, error: `id「${meta.id}」與檔名「${stem}.tsv」不一致` });
    return;
  }

  const tmp = path.join(DATA, '.' + name + '.tmp');
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, full);
  json(res, 200, { ok: true, file: name, bytes: Buffer.byteLength(text) });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST + ':' + PORT}`);
  const started = Date.now();
  try {
    if (req.method === 'GET' && url.pathname === '/api/tsvs') {
      json(res, 200, { ok: true, files: await listTsvs() });
    } else if (req.method === 'POST' && url.pathname.startsWith('/api/tsv/')) {
      await saveTsv(req, res, url.pathname.slice('/api/tsv/'.length));
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      // 根目錄要轉到 /build/index.html；若直接回傳 index.html，
      // 相對路徑的 nestedtext.css／js 會解析成 /nestedtext.css，畫面就沒有樣式。
      if (url.pathname === '/') {
        // 保留查詢字串，否則 /?edit=1 轉址後會變成只讀（?edit=1 被丟掉）。
        res.writeHead(302, { location: '/build/index.html' + (url.search || '') });
        res.end();
      } else {
        await serveStatic(req, res, url);
      }
    } else {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('method not allowed');
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { ok: false, error: e.message || String(e) });
    else res.end();
  } finally {
    console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`offtext dev server: http://${HOST}:${PORT}/`);
  console.log(`  靜態根目錄：${ROOT}`);
  console.log(`  入口：http://${HOST}:${PORT}/build/index.html`);
  console.log(`  TSV 清單：http://${HOST}:${PORT}/api/tsvs`);
});
