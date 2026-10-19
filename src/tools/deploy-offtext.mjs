// 部署 offtext 到 https://shutonggui.cn/offtext/
//
// 用法：
//   node src/tools/deploy-offtext.mjs --check     # 只檢查遠端連線與目錄權限
//   node src/tools/deploy-offtext.mjs             # 上傳 build/ 靜態檔與 data/*.tsv
//
// 連線設定沿用 D:\2026\adb-converter\.local\server.env（HOST/PORT/USER/PASS/DOCROOT）
// 與 .local/hostkey.txt；帳密不會被印出。可用 --env/--hostkey/--docroot 覆寫。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOOLS = import.meta.dirname;
const ROOT = path.resolve(TOOLS, '../..');
const BUILD = path.join(ROOT, 'build');
const DATA = path.join(ROOT, 'data');
const PSCP = 'C:\\Program Files\\PuTTY\\pscp.exe';
const PLINK = 'C:\\Program Files\\PuTTY\\plink.exe';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const CHECK_ONLY = args.includes('--check');
const ENV_FILE = opt('env', 'D:\\2026\\adb-converter\\.local\\server.env');
const HOSTKEY_FILE = opt('hostkey', 'D:\\2026\\adb-converter\\.local\\hostkey.txt');
const DOCROOT = opt('docroot', '/var/www/html/offtext').replace(/\/+$/, '');
const BASE_URL = 'https://shutonggui.cn/offtext/';
const STAGE_REMOTE = DOCROOT + '.new';
const PREV_REMOTE = DOCROOT + '.prev';

function die(message) {
  console.error('✗ ' + message);
  process.exit(1);
}

function readEnv(file) {
  if (!fs.existsSync(file)) die('找不到 ' + file);
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    // server.env 的註解與 key 可能被黏在同一行（實際檔案就是這樣），
    // 所以不用 ^ 錨定，只抓 KEY=value 的值到空白為止。
    const m = /(?:^|\s)(HOST|PORT|USER|PASS|DOCROOT)=([^\s]+)/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = readEnv(ENV_FILE);
const HOST = env.HOST;
const PORT = env.PORT || '22';
const USER = env.USER;
const PASS = env.PASS;
if (!HOST || !USER || !PASS) die('server.env 缺少 HOST／USER／PASS');

if (!fs.existsSync(HOSTKEY_FILE)) die('找不到 ' + HOSTKEY_FILE);
const FINGERPRINT = fs.readFileSync(HOSTKEY_FILE, 'utf8').trim();
if (!/^SHA256:/.test(FINGERPRINT)) die('hostkey.txt 格式不正確');

if (!fs.existsSync(PSCP) || !fs.existsSync(PLINK)) die('找不到 PuTTY pscp.exe／plink.exe');

const pwFile = path.join(os.tmpdir(), '.offtext-deploy-pw-' + process.pid + '.tmp');
fs.writeFileSync(pwFile, PASS + '\n', { mode: 0o600 });

function run(cmd, label) {
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' });
  if (result.error) die(label + '：' + result.error.message);
  if (result.status !== 0) {
    const out = (result.stdout || '').trim();
    const err = (result.stderr || '').trim();
    die(label + '（exit ' + result.status + '）' + (out ? '\n' + out : '') + (err ? '\n' + err : ''));
  }
  return (result.stdout || '').trim();
}

function upload(local, remote) {
  run(
    [
      PSCP,
      '-batch',
      '-P',
      PORT,
      '-hostkey',
      FINGERPRINT,
      '-pwfile',
      pwFile,
      local,
      USER + '@' + HOST + ':' + remote,
    ],
    '上傳 ' + path.basename(local)
  );
}

function remote(script, label) {
  const scriptFile = path.join(os.tmpdir(), '.offtext-deploy-' + process.pid + '.sh');
  fs.writeFileSync(scriptFile, script);
  try {
    return run(
      [
        PLINK,
        '-batch',
        '-ssh',
        '-P',
        PORT,
        '-l',
        USER,
        '-hostkey',
        FINGERPRINT,
        '-pwfile',
        pwFile,
        '-m',
        scriptFile,
        HOST,
      ],
      label
    );
  } finally {
    fs.rmSync(scriptFile, { force: true });
  }
}

function shq(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

try {
  if (CHECK_ONLY) {
    const out = remote(
      [
        'set -e',
        'id',
        "ls -ld /var/www/html 2>/dev/null || true",
        'ls -ld ' + shq(DOCROOT) + " 2>/dev/null || true",
        'ls -ld ' + shq(STAGE_REMOTE) + " 2>/dev/null || true",
        'test -w /var/www/html && echo HTML_WRITABLE=yes || echo HTML_WRITABLE=no',
        'test -w ' + shq(DOCROOT) + ' && echo DOCROOT_WRITABLE=yes || echo DOCROOT_WRITABLE=no',
        'ls -la ' + shq(DOCROOT) + " 2>/dev/null | head -30 || true",
      ].join('\n'),
      '檢查遠端'
    );
    console.log(out);
    process.exit(0);
  }

  if (!fs.existsSync(BUILD) || !fs.existsSync(DATA)) die('找不到 build/ 或 data/');
  const staticFiles = fs
    .readdirSync(BUILD, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(html|css|js)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const dataFiles = fs
    .readdirSync(DATA, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.tsv'))
    .map((entry) => entry.name)
    .sort();
  if (!staticFiles.includes('index.html')) die('build/index.html 不存在，先跑 node src/tools/build.mjs');
  if (!dataFiles.length) die('data/ 沒有 TSV');

  console.log('部署目標：' + DOCROOT);
  console.log('靜態檔：' + staticFiles.join(', '));
  console.log('TSV：' + dataFiles.join(', '));

  // 先傳到 offtext.new，完整後再換上，避免上傳中斷留下半套網站。
  remote(
    [
      'set -e',
      'rm -rf ' + shq(STAGE_REMOTE),
      'mkdir -p ' + shq(STAGE_REMOTE + '/data'),
    ].join('\n'),
    '建立遠端暫存目錄'
  );

  for (const name of staticFiles) {
    upload(path.join(BUILD, name), STAGE_REMOTE + '/' + name);
  }
  for (const name of dataFiles) {
    upload(path.join(DATA, name), STAGE_REMOTE + '/data/' + name);
  }

  const swap = remote(
    [
      'set -e',
      'rm -rf ' + shq(PREV_REMOTE),
      '[ -d ' + shq(DOCROOT) + ' ] && mv ' + shq(DOCROOT) + ' ' + shq(PREV_REMOTE),
      'mv ' + shq(STAGE_REMOTE) + ' ' + shq(DOCROOT),
      'chmod -R a+rX ' + shq(DOCROOT),
      'echo DEPLOYED',
      'du -sh ' + shq(DOCROOT),
    ].join('\n'),
    '切換到新版本'
  );
  console.log(swap);

  // 從公開 HTTPS 驗證首頁、manifest 與一份 TSV。
  const stamp = Date.now();
  const checks = [
    BASE_URL + '?v=' + stamp,
    BASE_URL + 'tsv-manifest.js?v=' + stamp,
    BASE_URL + 'offtext-cm.js?v=' + stamp,
    BASE_URL + 'data/modern-chinese-history.tsv?v=' + stamp,
  ];
  for (const url of checks) {
    const res = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) die('驗證失敗 ' + url + ' → HTTP ' + res.status);
    if (url === checks[0] && !text.includes('巢式文字')) die('首頁內容不像 offtext');
    if (url === checks[0] && !text.includes('nestedtext.js')) die('首頁沒有載入 app');
    if (url === checks[1] && !text.includes('OFFTEXT_TSV_MANIFEST')) die('manifest 內容不正確');
    if (url === checks[2] && !text.includes('OfftextCM')) die('CM6 bundle 內容不正確');
    if (url === checks[3] && !text.includes('{id:"modern-chinese-history"')) die('TSV 內容不正確');
    console.log('✓ ' + url + '  HTTP ' + res.status + '  ' + Buffer.byteLength(text) + ' bytes');
  }
  console.log('完成：' + BASE_URL);
} finally {
  fs.rmSync(pwFile, { force: true });
}
