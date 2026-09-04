#!/usr/bin/env node
/* =====================================================================
   CineLink BD Server — streaming portal with video upload + admin login
   ---------------------------------------------------------------------
   Run:      npm install   (first time only)
             npm start     →  http://localhost:3000   (admin: /admin)
   Default login: admin / admin123  — change it after first run:
             node server.js --set-password <new-password>
   Env vars: PORT, ADMIN_USER, ADMIN_PASSWORD, SESSION_SECRET, MAX_VIDEO_MB
   Storage:  data/movies.json  (catalog) · uploads/posters · uploads/videos
   ===================================================================== */

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------------------------- config ------------------------------ */
const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MOVIES_FILE = path.join(DATA_DIR, 'movies.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const UPLOAD_POSTERS = path.join(ROOT, 'uploads', 'posters');
const UPLOAD_VIDEOS = path.join(ROOT, 'uploads', 'videos');
const MAX_VIDEO_MB = parseInt(process.env.MAX_VIDEO_MB || '2048', 10); // max upload size
const MAX_POSTER_MB = 20;

[ DATA_DIR, UPLOAD_POSTERS, UPLOAD_VIDEOS ].forEach(d => fs.mkdirSync(d, { recursive: true }));

/* ---------------------------- storage ----------------------------- */
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let store = readJson(MOVIES_FILE, { items: {} });
if (!store.items) store.items = {};
function saveMovies() { writeJson(MOVIES_FILE, store); }

let admins = readJson(ADMINS_FILE, []);
if (!admins.length) {
  admins = [{ u: process.env.ADMIN_USER || 'admin', h: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10) }];
  writeJson(ADMINS_FILE, admins);
  console.log('[setup] admin account created → admin / admin123');
  console.log('[setup] CHANGE THE PASSWORD NOW:  node server.js --set-password <new-password>');
}

/* CLI: node server.js --set-password <pass> [--set-user <user>] */
if (process.argv.includes('--set-password')) {
  const idx = process.argv.indexOf('--set-password');
  const pass = process.argv[idx + 1];
  if (!pass) { console.log('usage: node server.js --set-password <password> [--set-user <username>]'); process.exit(1); }
  const ui = process.argv.indexOf('--set-user');
  const user = ui > -1 ? process.argv[ui + 1] : 'admin';
  admins = admins.filter(a => a.u !== user);
  admins.push({ u: user, h: bcrypt.hashSync(pass, 10) });
  writeJson(ADMINS_FILE, admins);
  console.log('✓ password updated for user "' + user + '"');
  process.exit(0);
}

/* -------------------------- helpers ------------------------------- */
function uid() { return 'm' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }
function str(x, d) { return (x === undefined || x === null) ? d : String(x).trim(); }
function num(x) { const n = parseFloat(x); return isNaN(n) ? null : Math.round(n * 10) / 10; }
function int(x, d) { const n = parseInt(x, 10); return isNaN(n) ? d : n; }
function truthy(x) { return x === true || x === 'true' || x === 'on' || x === '1'; }
function parseLang(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') return x.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}
function safeFile(p) { return p && p.indexOf('/uploads/') === 0 ? p : ''; }
function rmFile(p) { if (safeFile(p)) { const f = path.join(ROOT, p); try { fs.unlinkSync(f); } catch (e) {} } }

/* default demo-clip playlist (used when a movie has no uploaded video) */
const DEMO_VIDEOS = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
];

/* seed a few sample titles on first boot so the site is not empty */
if (!Object.keys(store.items).length) {
  const seeds = [
    { t: 'Shonar Hati', y: 2026, type: 'Movie', q: 'WEB-DL', a: 'Dual [Bangla–Hindi]', v: 817170, r: 7.8, g: 'Fantasy Drama', lang: ['Bangla', 'Hindi'], pin: true, p: '/uploads/posters/p1.png', src: '', d: 'A golden tiger leads a Sundarban ferryman into a drowned kingdom.' },
    { t: 'Ognikonna', y: 2025, type: 'Movie', q: 'HDRip', a: 'Bangla ORG', v: 412500, r: 7.1, g: 'Action', lang: ['Bangla'], pin: true, p: '/uploads/posters/p2.png', src: '', d: 'A girl who walked out of a jute-mill fire walks the road of revenge.' },
    { t: 'Vanavasi', y: 2025, type: 'Movie', q: 'WEB-DL', a: 'Dual [Tamil–Hindi]', v: 389200, r: 7.2, g: 'Adventure', lang: ['Tamil', 'Hindi'], pin: false, p: '/uploads/posters/p5.png', src: '', d: 'A city boy inherits a crumbling temple in the Western Ghats.' },
    { t: 'Sangrampur', y: 2025, type: 'Series', q: 'WEB-DL', a: 'Dual [Hindi–Bangla]', v: 512700, r: 7.9, g: 'Period Drama', lang: ['Hindi', 'Bangla'], pin: false, p: '/uploads/posters/p10.png', src: '', d: 'S01 • A zamindar\'s son arms a village against the Company.' }
  ];
  const now = Date.now();
  seeds.forEach((s, i) => { s.id = uid(); s.createdAt = now - i * 1000; store.items[s.id] = s; });
  saveMovies();
  console.log('[seed] 4 sample movies added (poster art loads from the network).');
}

/* --------------------------- app setup ---------------------------- */
const app = express();
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* --------------------------- file upload --------------------------- */
const uploadFiles = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => cb(null, f.fieldname === 'poster' ? UPLOAD_POSTERS : UPLOAD_VIDEOS),
    filename: (req, f, cb) => cb(null, (f.fieldname === 'poster' ? 'p' : 'v') + Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + path.extname(f.originalname || (f.fieldname === 'poster' ? '.jpg' : '.mp4')).toLowerCase())
  }),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'not_logged_in' });
}

/* --------------------------- public API ---------------------------- */
app.get('/api/movies', (req, res) => {
  const list = Object.values(store.items).sort((a, b) =>
    ((b.pin ? 1 : 0) - (a.pin ? 1 : 0)) || ((b.createdAt || 0) - (a.createdAt || 0)));
  res.json(list);
});

app.post('/api/movies/:id/view', (req, res) => {
  const m = store.items[req.params.id];
  if (!m) return res.status(404).json({ error: 'not_found' });
  m.v = (m.v || 0) + 1;
  saveMovies();
  res.json({ v: m.v });
});

/* ------------------------------ auth ------------------------------- */
app.post('/api/auth/login', (req, res) => {
  const { u, p } = req.body || {};
  const a = admins.find(x => x.u === u);
  if (!a || !bcrypt.compareSync(p || '', a.h)) return res.status(401).json({ error: 'credential_error' });
  req.session.admin = { u: a.u };
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', (req, res) => res.json({ admin: !!(req.session && req.session.admin) }));

/* --------------------------- admin API ----------------------------- */
app.get('/api/admin/movies', requireAdmin, (req, res) => res.json(Object.values(store.items)));
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const list = Object.values(store.items);
  res.json({ movies: list.length, totalViews: list.reduce((s, m) => s + (m.v || 0), 0), uploads: Object.keys(store.items).length });
});

function collectMovie(req, prev) {
  const body = req.body || {};
  const files = req.files || {};
  const posterFile = files.poster && files.poster[0];
  const videoFile = files.video && files.video[0];
  return {
    t: str(body.t, 'Untitled'),
    y: int(body.y, new Date().getFullYear()),
    type: body.type === 'Series' ? 'Series' : 'Movie',
    q: str(body.q, 'WEB-DL'),
    a: str(body.a, ''),
    r: num(body.r),
    g: str(body.g, ''),
    lang: parseLang(body.lang),
    pin: truthy(body.pin),
    p: posterFile ? '/uploads/posters/' + posterFile.filename : (body.posterUrl !== undefined && body.posterUrl !== '' ? str(body.posterUrl, '') : (prev ? prev.p : '')),
    src: videoFile ? '/uploads/videos/' + videoFile.filename : (body.srcUrl !== undefined && body.srcUrl !== '' ? str(body.srcUrl, '') : (prev ? prev.src : '')),
    dl: str(body.dl, ''),
    d: str(body.d, ''),
    v: Math.max(0, int(body.v, 0))
  };
}

app.post('/api/admin/movies', requireAdmin, uploadFiles.fields([{name:'poster',maxCount:1},{name:'video',maxCount:1}]), (req, res) => {
  const movie = Object.assign({ id: uid(), createdAt: Date.now() }, collectMovie(req));
  store.items[movie.id] = movie;
  saveMovies();
  res.json({ ok: true, id: movie.id });
});

app.put('/api/admin/movies/:id', requireAdmin, uploadFiles.fields([{name:'poster',maxCount:1},{name:'video',maxCount:1}]), (req, res) => {
  const m = store.items[req.params.id];
  if (!m) return res.status(404).json({ error: 'not_found' });
  const files = req.files || {};
  const updated = collectMovie(req, m);
  if (files.poster && files.poster[0]) rmFile(m.p);         // replace old poster file
  if (files.video && files.video[0]) rmFile(m.src);         // replace old video file
  Object.assign(m, updated);
  saveMovies();
  res.json({ ok: true, id: m.id });
});

app.delete('/api/admin/movies/:id', requireAdmin, (req, res) => {
  const m = store.items[req.params.id];
  if (!m) return res.status(404).json({ error: 'not_found' });
  rmFile(m.p);
  rmFile(m.src);
  delete store.items[m.id];
  saveMovies();
  res.json({ ok: true });
});

/* --------------------------- static files -------------------------- */
app.use('/uploads', express.static(path.join(ROOT, 'uploads'), {
  acceptRanges: true,
  setHeaders: (res, p) => { if (/\.(mp4|webm|mkv|m4v)$/i.test(p)) res.setHeader('Accept-Ranges', 'bytes'); }
}));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

/* --------------------------- error handling ------------------------ */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
    return res.status(400).json({ error: err.code });
  }
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('──────────────────────────────────────────────');
  console.log('  CineLink BD server is running ✓');
  console.log('  Site:     http://localhost:' + PORT);
  console.log('  Admin:    http://localhost:' + PORT + '/admin');
  console.log('  Storage:  uploads/ (posters + videos), data/ (catalog)');
  console.log('──────────────────────────────────────────────');
});
