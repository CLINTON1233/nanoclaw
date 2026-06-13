#!/usr/bin/env node
/**
 * NanoClaw - Halaman QR WhatsApp 
 * -----------------------------------------------------------------------
 * Alur otomatis:
 *   1. Skrip menghentikan NanoClaw dulu (biar tidak rebutan sesi).
 *   2. Begitu di-scan & "Connected", skrip menutup koneksinya,
 *      menjalankan NanoClaw, lalu keluar sendiri.
 * Jalankan:  node nanoclaw-qr.mjs
 * Buka:      http://<IP-SERVER>:8088/nanoclaw_scan
 * Manual:    AUTO_HANDOFF=0 node nanoclaw-qr.mjs
 */

import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'

// ============== KONFIGURASI ==============
const PORT = Number(process.env.PORT || 8088)
const HOST = process.env.HOST || '0.0.0.0'
const AUTH_DIR = process.env.AUTH_DIR || './store/auth'
const DEVICE_NAME = process.env.DEVICE_NAME || 'NanoClaw'
const SERVICE = process.env.SERVICE || 'nanoclaw-v2-8bbc7032.service'
const AUTO_HANDOFF = process.env.AUTO_HANDOFF !== '0'
const LOGO_PATH = process.env.LOGO_PATH || './seatrium-logo.png'
const BRAND_NAME = process.env.BRAND_NAME || 'Seatrium'
const PRODUCT_NAME = process.env.PRODUCT_NAME || 'NanoClaw'
const PRODUCT_TAGLINE = process.env.PRODUCT_TAGLINE || 'WhatsApp Assistant'
const BASE_PATH = process.env.BASE_PATH || '/nanoclaw_scan'  // <-- path baru
// =========================================

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
}

const logger = {
  level: 'silent', child: () => logger,
  trace() { }, debug() { }, info() { }, warn() { }, error() { }, fatal() { },
}

const state = { phase: 'starting', qr: null, error: null }
let attempts = 0
let handedOff = false

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function connect() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  let version
  try { ({ version } = await fetchLatestBaileysVersion()) } catch { }

  const sock = makeWASocket({
    version, auth: authState, logger,
    browser: [DEVICE_NAME, 'Chrome', '1.0'],
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      try {
        state.qr = await QRCode.toDataURL(qr, {
          margin: 2, width: 360, color: { dark: '#15324f', light: '#ffffff' },
        })
        state.phase = 'qr'
        state.error = null
      } catch (e) { state.error = String(e) }
    }

    if (connection === 'open') {
      attempts = 0
      state.phase = 'connected'
      state.qr = null
      console.log('\n  WhatsApp tersambung.')

      if (AUTO_HANDOFF && !handedOff) {
        handedOff = true
        console.log('  Menyerahkan sesi ke NanoClaw (otomatis)...')
        setTimeout(async () => {
          try { sock.end(undefined) } catch { }
          await sleep(3000)
          console.log('  Menjalankan NanoClaw...')
          spawnSync('systemctl', ['--user', 'start', SERVICE], {
            stdio: 'inherit'
          })

          console.log('  NanoClaw berjalan. Halaman QR ditutup sebentar lagi.')
          // await sleep(8000)
          // process.exit(0)
          await sleep(8000)
          console.log('NanoClaw berjalan')
        }, 3000)
      } else {
        console.log('  (mode manual) Tekan Ctrl+C, lalu jalankan NanoClaw.\n')
      }
    }

    if (connection === 'close') {
      if (handedOff) {
        state.phase = 'connected'
        return
      }
      const code = lastDisconnect?.error?.output?.statusCode

      if (code === DisconnectReason.loggedOut) {
        try { await rm(AUTH_DIR, { recursive: true, force: true }) } catch { }
        state.phase = 'starting'
        state.qr = null
        if (attempts < 20) { attempts++; setTimeout(() => connect().catch(onFatal), 1500) }
      } else if (state.phase !== 'connected' && attempts < 20) {
        attempts++
        setTimeout(() => connect().catch(onFatal), 2000)
      }
    }
  })
}

function onFatal(err) {
  state.phase = 'error'
  state.error = String(err?.message || err)
  console.error('Error:', err)
}

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${PRODUCT_NAME} · Link WhatsApp</title>
<link rel="icon" href="${BASE_PATH}/logo" />
<style>
  :root {
    --blue:#1c6fd0; --blue-deep:#134a8e; --blue-soft:#e9f2fc;
    --ink:#16283b; --muted:#6b7c8f; --line:#e3edf8; --green:#1faa54;
    --scan:#f4f9ff;
  }
  * { box-sizing:border-box; }
  html,body { height:100%; }
  body {
    margin:0; min-height:100vh; display:flex; flex-direction:column;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink);
    background:
      radial-gradient(1000px 560px at 50% -8%, #e7f1fe 0%, rgba(231,241,254,0) 62%),
      linear-gradient(180deg,#f6fbff 0%,#eef5fc 100%);
  }

  /* ---- watermark logo di belakang ---- */
  .bg-logo {
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    width:720px; max-width:120vw; opacity:.045; pointer-events:none; z-index:0;
  }

  /* ---- header bar ---- */
  .topbar {
    position:relative; z-index:2; width:100%; padding:16px 26px;
    display:flex; align-items:center;
    background:rgba(255,255,255,.72); backdrop-filter:blur(8px);
    border-bottom:1px solid var(--line);
  }
  .topbar .bar-logo { height:30px; max-width:150px; object-fit:contain; }
  .topbar .divider { width:1px; height:26px; background:var(--line); margin:0 14px; }
  .bar-title { font-size:16px; font-weight:800; color:var(--blue-deep); letter-spacing:-.3px; line-height:1.1; }
  .bar-sub { font-size:12px; color:var(--muted); margin-top:1px; }

  /* ---- konten ---- */
  .main { position:relative; z-index:1; flex:1; display:flex; align-items:center; justify-content:center; padding:32px 22px; }
  .card {
    position:relative; width:100%; max-width:880px; background:#fff; border-radius:24px;
    padding:40px 40px 30px; border:1px solid var(--line);
    box-shadow:0 1px 0 #fff inset, 0 22px 60px rgba(20,74,142,.14); overflow:hidden;
  }
  .card::before {
    content:""; position:absolute; top:0; left:0; right:0; height:4px;
    background:linear-gradient(90deg,var(--blue-deep),var(--blue),#5fa0e8);
  }
  .card-head { text-align:center; margin-bottom:30px; }
  .title { margin:0 0 6px; font-size:26px; font-weight:800; color:var(--blue-deep); letter-spacing:-.5px; }
  .subtitle { margin:0; font-size:14px; color:var(--muted); min-height:20px; }

  .grid { display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:center; }

  /* ---- kolom kiri: langkah ---- */
  .col-left { min-width:0; }
  .step { display:flex; gap:14px; margin-bottom:22px; }
  .step:last-child { margin-bottom:0; }
  .badge { flex:0 0 30px; width:30px; height:30px; border-radius:50%; background:var(--blue);
    color:#fff; font-weight:700; font-size:14px; display:flex; align-items:center; justify-content:center;
    box-shadow:0 5px 12px rgba(28,111,208,.30); }
  .step .st { font-size:15.5px; font-weight:700; color:var(--ink); margin-bottom:3px; }
  .step .sd { font-size:13.5px; color:var(--muted); line-height:1.55; }
  .step b { color:var(--blue-deep); }
  .note { margin-top:24px; background:#f3f8ff; border:1px solid var(--line); border-radius:12px;
    padding:13px 15px; font-size:12.5px; color:#4a6076; line-height:1.55; }
  .note b { color:var(--blue-deep); }

  /* ---- kolom kiri: state sukses ---- */
  .done-block { display:none; }
  .done-block .dt { font-size:20px; font-weight:800; color:var(--blue-deep); margin-bottom:10px; }
  .done-block .dd { font-size:14px; color:var(--muted); line-height:1.6; }
  .done-block .dtick { display:inline-flex; align-items:center; gap:8px; margin-bottom:12px;
    color:var(--green); font-weight:700; font-size:13px; }
  .done-block .dtick svg { width:18px; height:18px; }

  /* ---- kolom kanan: scanner ---- */
  .col-right { display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .qrframe {
    position:relative; display:inline-block; padding:18px; border-radius:22px;
    background:linear-gradient(180deg,#fbfdff,#eef6ff);
    border:1px solid var(--line);
    box-shadow:0 1px 0 #fff inset, 0 10px 26px rgba(28,111,208,.10);
  }
  .qrbox {
    position:relative; width:250px; height:250px; border-radius:16px;
    display:flex; align-items:center; justify-content:center; overflow:hidden;
    background:var(--scan);
    box-shadow:inset 0 0 0 1px var(--line), inset 0 2px 10px rgba(20,74,142,.05);
    transition:background .45s ease;
  }
  .qrbox img { width:100%; height:100%; display:block; border-radius:10px; }
  .corner { position:absolute; width:24px; height:24px; border:3px solid var(--blue);
    transition:border-color .45s ease; z-index:2; }
  .corner.tl { top:9px; left:9px; border-right:0; border-bottom:0; border-top-left-radius:9px; }
  .corner.tr { top:9px; right:9px; border-left:0; border-bottom:0; border-top-right-radius:9px; }
  .corner.bl { bottom:9px; left:9px; border-right:0; border-top:0; border-bottom-left-radius:9px; }
  .corner.br { bottom:9px; right:9px; border-left:0; border-top:0; border-bottom-right-radius:9px; }
  .qrframe.done .corner { border-color:var(--green); }
  .qrframe.done .qrbox { background:#eefaf2; box-shadow:inset 0 0 0 1px #cdeed9; }

  .spinner { width:40px; height:40px; border:4px solid #e3edf8; border-top-color:var(--blue);
    border-radius:50%; animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }

  .success { position:relative; display:flex; align-items:center; justify-content:center; }
  .ring { position:absolute; width:104px; height:104px; border-radius:50%; background:var(--green);
    opacity:.16; animation:ringPulse 1.9s ease-out infinite; }
  @keyframes ringPulse { 0%{transform:scale(.75);opacity:.26} 70%{transform:scale(1.55);opacity:0} 100%{opacity:0} }
  .check { width:88px; height:88px; position:relative; z-index:1; }
  .check circle { fill:var(--green); }
  .check path { stroke:#fff; stroke-width:7; fill:none; stroke-linecap:round; stroke-linejoin:round;
    stroke-dasharray:62; stroke-dashoffset:62; animation:draw .5s ease forwards .15s; }
  @keyframes draw { to { stroke-dashoffset:0; } }

  .pill { display:inline-flex; align-items:center; gap:8px; margin-top:20px; padding:9px 18px;
    border-radius:999px; font-size:13px; font-weight:600; background:var(--blue-soft); color:var(--blue-deep); }
  .pill .led { width:8px; height:8px; border-radius:50%; background:#e0a200; animation:pulse 1.4s ease-in-out infinite; }
  .pill.ok { background:#e8f7ee; color:#137a3f; }
  .pill.ok .led { background:var(--green); animation:none; }
  .pill.bad { background:#fdeeee; color:#c0392b; }
  .pill.bad .led { background:#c0392b; animation:none; }
  @keyframes pulse { 50% { opacity:.3; } }

  .foot { margin-top:30px; padding-top:18px; border-top:1px solid var(--line);
    text-align:center; font-size:11.5px; color:#9fb0c0; letter-spacing:.2px; }

  /* ---- responsif ---- */
  @media (max-width:760px) {
    .card { padding:30px 22px 22px; }
    .grid { grid-template-columns:1fr; gap:28px; }
    .col-right { order:1; }
    .col-left { order:2; }
    .qrbox { width:230px; height:230px; }
  }
  @media (prefers-reduced-motion: reduce){ *{ animation:none !important; transition:none !important; } }
</style>
</head>
<body>
  <img class="bg-logo" src="${BASE_PATH}/logo" alt="" aria-hidden="true"
       onerror="this.style.display='none'">

  <header class="topbar">
    <img class="bar-logo" src="${BASE_PATH}/logo" alt="${BRAND_NAME}"
         onerror="this.style.display='none'">
    <span class="divider"></span>
    <div>
      <div class="bar-title">${PRODUCT_NAME}</div>
      <div class="bar-sub">${PRODUCT_TAGLINE}</div>
    </div>
  </header>

  <main class="main">
    <div class="card">
      <div class="card-head">
        <h1 class="title">Connect WhatsApp</h1>
        <p class="subtitle" id="sub">Link your WhatsApp to activate the assistant</p>
      </div>

      <div class="grid">
        <!-- KIRI: langkah / sukses -->
        <div class="col-left">
          <div id="steps">
            <div class="step">
              <span class="badge">1</span>
              <div>
                <div class="st">Open WhatsApp</div>
                <div class="sd">Open <b>WhatsApp</b> on the phone you want to link to the assistant.</div>
              </div>
            </div>
            <div class="step">
              <span class="badge">2</span>
              <div>
                <div class="st">Go to Linked Devices</div>
                <div class="sd">Tap <b>Settings</b> &rarr; <b>Linked Devices</b>, then <b>Link a Device</b>.</div>
              </div>
            </div>
            <div class="step">
              <span class="badge">3</span>
              <div>
                <div class="st">Scan the code</div>
                <div class="sd">Point your camera at the QR code on the right to finish linking.</div>
              </div>
            </div>
            <div class="note">
              <b>Pairs automatically.</b> Once your phone connects, ${PRODUCT_NAME} takes over the
              session and this page closes by itself — no extra steps needed.
            </div>
          </div>

          <div class="done-block" id="leftDone">
            <div class="dtick">
              <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#1faa54"/><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Device linked
            </div>
            <div class="dt">You're all set</div>
            <div class="dd">
              ${PRODUCT_NAME} is now connected to WhatsApp and starting up. You can close this
              window — the assistant keeps running in the background.
            </div>
          </div>
        </div>

        <!-- KANAN: scanner -->
        <div class="col-right">
          <div class="qrframe" id="qrframe">
            <span class="corner tl"></span><span class="corner tr"></span>
            <span class="corner bl"></span><span class="corner br"></span>
            <div class="qrbox" id="qrbox"><div class="spinner"></div></div>
          </div>
          <div class="pill" id="pill"><span class="led"></span><span id="pilltext">Starting...</span></div>
        </div>
      </div>

      <div class="foot">${BRAND_NAME} · ${PRODUCT_NAME} ${PRODUCT_TAGLINE}</div>
    </div>
  </main>
<script>
  var qrbox=document.getElementById('qrbox'),qrframe=document.getElementById('qrframe'),
      pill=document.getElementById('pill'),pilltext=document.getElementById('pilltext'),
      sub=document.getElementById('sub'),steps=document.getElementById('steps'),
      leftDone=document.getElementById('leftDone'),lastQR=null;
  var basePath = "${BASE_PATH}";
  function setPill(t,c){pilltext.textContent=t;pill.className='pill'+(c?' '+c:'');}
  function showLeft(done){steps.style.display=done?'none':'';leftDone.style.display=done?'block':'none';}
  function showCheck(){qrframe.classList.add('done');showLeft(true);qrbox.innerHTML='<div class="success"><span class="ring"></span><svg class="check" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><path d="M30 52 L44 66 L72 36"/></svg></div>';}
  function showSpinner(){qrframe.classList.remove('done');showLeft(false);qrbox.innerHTML='<div class="spinner"></div>';}
  function showQR(s){qrframe.classList.remove('done');showLeft(false);if(s!==lastQR){qrbox.innerHTML='<img alt="WhatsApp QR" src="'+s+'">';lastQR=s;}}
  async function tick(){
    try{
      var r=await fetch(basePath+'/qr',{cache:'no-store'});var d=await r.json();
      if(d.phase==='qr'&&d.qr){showQR(d.qr);setPill('Waiting for scan');sub.textContent='Link your WhatsApp to activate the assistant';}
      else if(d.phase==='connected'){showCheck();setPill('Connected to WhatsApp','ok');sub.textContent='Your assistant is now online';}
      else if(d.phase==='error'){showSpinner();setPill('Error','bad');sub.textContent=d.error||'Something went wrong';}
      else{showSpinner();setPill('Starting...');lastQR=null;}
    }catch(e){}
  }
  tick();setInterval(tick,1500);
</script>
</body>
</html>`

function serveLogo(res) {
  try {
    const buf = readFileSync(LOGO_PATH)
    res.writeHead(200, {
      'Content-Type': MIME[extname(LOGO_PATH).toLowerCase()] || 'image/png',
      'Cache-Control': 'no-store',
    })
    res.end(buf)
  } catch {
    res.writeHead(404); res.end()
  }
}

createServer((req, res) => {
  const url = req.url

  // Handle base path + logo
  if (url === `${BASE_PATH}/logo`) {
    serveLogo(res);
    return
  }

  // Handle base path + qr endpoint
  if (url === `${BASE_PATH}/qr`) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ phase: state.phase, qr: state.qr, error: state.error }))
    return
  }

  // Handle base path exactly
  if (url === BASE_PATH || url === `${BASE_PATH}/`) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(PAGE)
    return
  }

  // Handle redirect from root to base path
  if (url === '/' || url === '') {
    res.writeHead(302, { 'Location': BASE_PATH })
    res.end()
    return
  }

  // 404 for other paths
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
}).listen(PORT, HOST, () => {
  console.log('\n  NanoClaw QR page berjalan.')
  console.log('  Auth dir     : ' + AUTH_DIR)
  console.log('  Logo file    : ' + LOGO_PATH)
  console.log('  Auto-handoff : ' + (AUTO_HANDOFF ? 'ON' : 'OFF'))
  console.log('  Base path    : ' + BASE_PATH)
  const ips = []
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address)
    }
  }
  console.log('  Buka di browser:')
  console.log('    http://localhost:' + PORT + BASE_PATH)
  for (const ip of ips) console.log('    http://' + ip + ':' + PORT + BASE_PATH)
  console.log('')
})

if (AUTO_HANDOFF) {
  console.log('  Mode otomatis: menghentikan NanoClaw dulu untuk pairing bersih...')
  spawnSync('systemctl', ['--user', 'stop', SERVICE], { stdio: 'inherit' })
}

connect().catch(onFatal)