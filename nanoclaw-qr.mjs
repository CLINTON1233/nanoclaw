#!/usr/bin/env node
/**
 * NanoClaw - Halaman QR WhatsApp 
 * -----------------------------------------------------------------------
 * Alur otomatis:
 *   1. Skrip menghentikan NanoClaw dulu (biar tidak rebutan sesi).
 *   2. Menampilkan QR di browser (tema putih + biru lembut + logo Seatrium).
 *   3. Begitu di-scan & "Connected", skrip menutup koneksinya,
 *      menjalankan NanoClaw, lalu keluar sendiri.
 * Jalankan:  node nanoclaw-qr.mjs
 * Buka:      http://<IP-SERVER>:8088
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
// =========================================

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
}

const logger = {
  level: 'silent', child: () => logger,
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
}

const state = { phase: 'starting', qr: null, error: null }
let attempts = 0
let handedOff = false

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function connect() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  let version
  try { ({ version } = await fetchLatestBaileysVersion()) } catch {}

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
          try { sock.end(undefined) } catch {}
          await sleep(3000)
          console.log('  Menjalankan NanoClaw...')
          spawnSync('systemctl', ['--user', 'start', SERVICE], { stdio: 'inherit' })
          console.log('  NanoClaw berjalan. Halaman QR ditutup sebentar lagi.')
          await sleep(8000)
          process.exit(0)
        }, 3000)
      } else {
        console.log('  (mode manual) Tekan Ctrl+C, lalu jalankan NanoClaw.\n')
      }
    }

    if (connection === 'close') {
      if (handedOff) return
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        try { await rm(AUTH_DIR, { recursive: true, force: true }) } catch {}
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
<title>${BRAND_NAME} · Link WhatsApp</title>
<link rel="icon" href="/logo" />
<style>
  :root {
    --blue:#1c6fd0; --blue-deep:#134a8e; --blue-soft:#e9f2fc;
    --ink:#1f2d3d; --muted:#6b7c8f; --line:#e7eef7; --green:#1faa54;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink); padding:24px;
    background:
      radial-gradient(1200px 600px at 50% -10%, #eaf3fe 0%, rgba(234,243,254,0) 60%),
      linear-gradient(180deg,#f7fbff 0%,#ffffff 100%);
  }
  .card {
    position:relative; width:100%; max-width:430px; background:#fff; border-radius:26px;
    padding:38px 34px 30px; border:1px solid var(--line);
    box-shadow:0 24px 60px rgba(28,111,208,.12); text-align:center; overflow:hidden;
  }
  .card::before {
    content:""; position:absolute; top:0; left:0; right:0; height:5px;
    background:linear-gradient(90deg,var(--blue),#4f93e3);
  }
  .brand { margin-bottom:4px; min-height:44px; display:flex; align-items:center; justify-content:center; }
  .brand img { max-height:42px; max-width:220px; object-fit:contain; }
  .brand .txt { font-weight:800; font-size:24px; color:var(--blue-deep); letter-spacing:-.3px; }
  .sub { color:var(--muted); font-size:14px; margin:6px 0 26px; }
  .qrwrap { padding:14px; display:inline-block; border-radius:22px;
    background:linear-gradient(180deg,#f4f9ff,#ffffff); border:1px solid var(--line); }
  .qrbox { width:286px; height:286px; border-radius:14px; display:flex; align-items:center; justify-content:center;
    background:#fff; overflow:hidden; }
  .qrbox img { width:100%; height:100%; }
  .spinner { width:42px; height:42px; border:4px solid #e6eef7; border-top-color:var(--blue); border-radius:50%; animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .check { width:96px; height:96px; }
  .check circle { fill:var(--green); }
  .check path { stroke:#fff; stroke-width:6; fill:none; stroke-linecap:round; stroke-linejoin:round;
    stroke-dasharray:48; stroke-dashoffset:48; animation:draw .5s ease forwards .1s; }
  @keyframes draw { to { stroke-dashoffset:0; } }
  .pill { display:inline-flex; align-items:center; gap:8px; margin-top:22px; padding:9px 18px; border-radius:999px;
    font-size:13px; font-weight:600; background:var(--blue-soft); color:var(--blue-deep); }
  .pill .led { width:8px; height:8px; border-radius:50%; background:#e0a200; animation:pulse 1.4s ease-in-out infinite; }
  .pill.ok { background:#e8f7ee; color:#137a3f; }
  .pill.ok .led { background:var(--green); animation:none; }
  .pill.bad { background:#fdeeee; color:#c0392b; }
  .pill.bad .led { background:#c0392b; animation:none; }
  @keyframes pulse { 50% { opacity:.3; } }
  .steps { margin:22px auto 0; padding:0; max-width:300px; list-style:none; text-align:left; font-size:13.5px; color:#43596d; }
  .steps li { display:flex; gap:10px; padding:5px 0; }
  .steps b { color:var(--blue); }
  .foot { margin-top:24px; font-size:12px; color:#9fb0c0; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img id="logo" src="/logo" alt="${BRAND_NAME}"
           onerror="this.style.display='none';document.getElementById('brandtxt').style.display='block'">
      <span class="txt" id="brandtxt" style="display:none">${BRAND_NAME}</span>
    </div>
    <div class="sub" id="sub">Link your WhatsApp to get started</div>

    <div class="qrwrap"><div class="qrbox" id="qrbox"><div class="spinner"></div></div></div>

    <div class="pill" id="pill"><span class="led"></span><span id="pilltext">Starting...</span></div>

    <ul class="steps" id="steps">
      <li><span>1.</span><span>Open <b>WhatsApp</b> on your phone</span></li>
      <li><span>2.</span><span>Tap <b>Settings</b> &rarr; <b>Linked Devices</b></span></li>
      <li><span>3.</span><span>Tap <b>Link a Device</b> and scan this code</span></li>
    </ul>

    <div class="foot">${BRAND_NAME} · WhatsApp Assistant</div>
  </div>
<script>
  var qrbox=document.getElementById('qrbox'),pill=document.getElementById('pill'),
      pilltext=document.getElementById('pilltext'),sub=document.getElementById('sub'),
      steps=document.getElementById('steps'),lastQR=null;
  function setPill(t,c){pilltext.textContent=t;pill.className='pill'+(c?' '+c:'');}
  function showCheck(){qrbox.innerHTML='<svg class="check" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/><path d="M30 52 L45 67 L72 36"/></svg>';}
  function showSpinner(){qrbox.innerHTML='<div class="spinner"></div>';}
  function showQR(s){if(s!==lastQR){qrbox.innerHTML='<img alt="WhatsApp QR" src="'+s+'">';lastQR=s;}}
  async function tick(){
    try{
      var r=await fetch('/qr',{cache:'no-store'});var d=await r.json();
      if(d.phase==='qr'&&d.qr){showQR(d.qr);setPill('Waiting for scan');sub.textContent='Link your WhatsApp to get started';steps.style.display='';}
      else if(d.phase==='connected'){showCheck();setPill('Connected to WhatsApp','ok');sub.textContent='Your assistant is now online';steps.style.display='none';}
      else if(d.phase==='error'){showSpinner();setPill('Error','bad');sub.textContent=d.error||'Something went wrong';steps.style.display='none';}
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
  if (req.url === '/logo') { serveLogo(res); return }
  if (req.url === '/qr') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ phase: state.phase, qr: state.qr, error: state.error }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(PAGE)
}).listen(PORT, HOST, () => {
  console.log('\n  NanoClaw QR page berjalan.')
  console.log('  Auth dir     : ' + AUTH_DIR)
  console.log('  Logo file    : ' + LOGO_PATH)
  console.log('  Auto-handoff : ' + (AUTO_HANDOFF ? 'ON' : 'OFF'))
  const ips = []
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address)
    }
  }
  console.log('  Buka di browser:')
  console.log('    http://localhost:' + PORT)
  for (const ip of ips) console.log('    http://' + ip + ':' + PORT)
  console.log('')
})

if (AUTO_HANDOFF) {
  console.log('  Mode otomatis: menghentikan NanoClaw dulu untuk pairing bersih...')
  spawnSync('systemctl', ['--user', 'stop', SERVICE], { stdio: 'inherit' })
}

connect().catch(onFatal)
