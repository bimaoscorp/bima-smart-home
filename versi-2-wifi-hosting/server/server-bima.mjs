// ============================================================
//  SERVER BIMA (Versi 2) - dijalankan di hosting Pterodactyl
//  Menjalankan :  node server-bima.mjs        (Node.js 18 ke atas)
//  Tanpa alat  :  node server-bima.mjs simulasi
//  Pengaturan  :  pengaturan.json di folder yang sama
// ============================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

// ------------------------------------------------------------
// 1. PENGATURAN (variabel lingkungan atau pengaturan.json)
// ------------------------------------------------------------
const berkasAtur = new URL('./pengaturan.json', import.meta.url);
const atur = existsSync(berkasAtur)
  ? JSON.parse(readFileSync(berkasAtur, 'utf8')) : {};
const ambil = (nama, bawaan = '') => process.env[nama] || atur[nama] || bawaan;

const PORT = Number(ambil('SERVER_PORT', ambil('PORT', '8080')));
const KATA_SANDI = ambil('KATA_SANDI');     // untuk membuka halaman BIMA
const KUNCI_ALAT = ambil('KUNCI_ALAT');     // sama dengan program Arduino
const AI_URL = ambil('AI_URL');             // alamat API token AI
const AI_KEY = ambil('AI_KEY');
const AI_MODEL = ambil('AI_MODEL');
const KUNCI_GEMINI = ambil('GEMINI_API_KEY');
const MODEL_SUARA = ambil('MODEL_SUARA', 'gemini-3.8-flash-lite-tts');
const BATAS_OFFLINE = Number(ambil('BATAS_OFFLINE_MS', '8000'));
const SIMULASI = process.argv[2] === 'simulasi';

if (!KATA_SANDI || !KUNCI_ALAT) {
  console.error('Isi KATA_SANDI dan KUNCI_ALAT di pengaturan.json dulu.');
  process.exit(1);
}

const NAMA = {
  LAMPU1: 'lampu ruang tamu', LAMPU2: 'lampu kamar tidur',
  LAMPU3: 'lampu teras', LAMPU: 'semua lampu',
};
const KATA = { ON: 'dinyalakan', OFF: 'dimatikan' };
const PERINTAH_SAH = [
  'LAMPU1:ON', 'LAMPU1:OFF', 'LAMPU2:ON', 'LAMPU2:OFF',
  'LAMPU3:ON', 'LAMPU3:OFF', 'LAMPU:ON', 'LAMPU:OFF',
];
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const sama = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ------------------------------------------------------------
// 2. ALAT (Arduino Uno + ESP-01) MENGHUBUNGI SERVER TIAP 2 DETIK
// ------------------------------------------------------------
const status = {
  simulasi: SIMULASI, terakhirDilihat: 0,
  L1: 0, L2: 0, L3: 0, SUHU: null, LEMBAP: null,
};
const antrean = [];   // perintah yang menunggu diambil alat
const angka = (v) => (v && v !== '-' && Number.isFinite(+v) ? +v : null);
const alatOnline = () => Date.now() - status.terakhirDilihat <= BATAS_OFFLINE;
const lihatStatus = () => ({ ...status, online: alatOnline() });

// Alat melapor keadaan; server membalas satu perintah atau "-"
function sinkronAlat(q) {
  const l = String(q.get('l') || '');
  if (/^[01]{3}$/.test(l)) [status.L1, status.L2, status.L3] = [...l].map(Number);
  status.SUHU = angka(q.get('t'));
  status.LEMBAP = angka(q.get('h'));
  status.terakhirDilihat = Date.now();
  return antrean.shift() || '-';
}

// Perintah dititipkan, lalu ditunggu sampai alat melaporkan keadaan baru
async function kirim(perintah) {
  if (!alatOnline()) throw new Error('Alat sedang tidak terhubung ke internet');
  const [alat, aksi] = perintah.split(':');
  const nilai = aksi === 'ON' ? 1 : 0;
  const kunci = alat === 'LAMPU' ? ['L1', 'L2', 'L3'] : ['L' + alat[5]];
  antrean.push(perintah);
  const batas = Date.now() + BATAS_OFFLINE + 2000;
  while (Date.now() < batas) {
    await tidur(200);
    const sudahDiambil = !antrean.includes(perintah);
    if (sudahDiambil && kunci.every((k) => status[k] === nilai)) return;
  }
  const i = antrean.indexOf(perintah);
  if (i >= 0) antrean.splice(i, 1);
  throw new Error('Alat tidak menjawab');
}

if (SIMULASI) {            // alat tiruan, untuk mencoba tanpa Arduino
  setInterval(() => {
    const s = status;
    const q = new URLSearchParams(`l=${s.L1}${s.L2}${s.L3}&t=28.5&h=75`);
    const p = sinkronAlat(q);
    if (p === '-') return;
    const [alat, aksi] = p.split(':');
    const n = aksi === 'ON' ? 1 : 0;
    if (alat === 'LAMPU') s.L1 = s.L2 = s.L3 = n;
    else s['L' + alat[5]] = n;
  }, 1000);
}

// ------------------------------------------------------------
// 3. OTAK BIMA: token AI (format OpenAI) atau kata kunci
// ------------------------------------------------------------
async function tanyaOtak(teks) {
  if (!AI_URL || !AI_KEY || !AI_MODEL) throw new Error('token AI belum diatur');
  const sistem = [
    'Kamu adalah BIMA, asisten AI pribadi berbahasa Indonesia yang sopan,',
    'tenang, dan ringkas. Kamu mengendalikan lampu rumah lewat Arduino Uno',
    'dan dapat membaca suhu serta kelembapan ruangan.',
    'Lampu: LAMPU1 = lampu ruang tamu, LAMPU2 = lampu kamar tidur,',
    'LAMPU3 = lampu teras, LAMPU = semua lampu.',
    'Perintah yang boleh dipakai: ' + PERINTAH_SAH.join(', ') + '.',
    'Keadaan sekarang (L1-L3: 1 = menyala, 0 = mati; SUHU derajat Celsius;',
    'LEMBAP persen): ' + JSON.stringify(lihatStatus()) + '.',
    'Balas HANYA dengan JSON: {"jawaban": "...", "perintah": ["..."]}.',
    'Isi "perintah" hanya bila pengguna meminta lampu dinyalakan atau',
    'dimatikan. "jawaban" berisi satu atau dua kalimat pendek.',
  ].join('\n');
  const r = await fetch(AI_URL.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + AI_KEY,
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: AI_MODEL, temperature: 0,
      messages: [
        { role: 'system', content: sistem },
        { role: 'user', content: teks },
      ],
    }),
  });
  if (!r.ok) throw new Error('API AI menjawab ' + r.status);
  const isi = (await r.json()).choices?.[0]?.message?.content || '';
  const json = isi.match(/\{[\s\S]*\}/);    // ambil bagian JSON saja
  if (!json) throw new Error('jawaban AI bukan JSON');
  return JSON.parse(json[0]);
}

// Cara cadangan: mencocokkan kata kunci
function tafsirKataKunci(teks) {
  const t = teks.toLowerCase();
  const perintah = [];
  const bertanya = /\b(apakah|apa|berapa|bagaimana|gimana)\b/.test(t);
  const mati = /\b(matikan|padamkan|mati|padam)\b/.test(t);
  const nyala = /\b(nyalakan|hidupkan|nyala|hidup)\b/.test(t);
  if (mati && nyala) {
    return { perintah,
      jawaban: 'Maaf, tolong beri satu perintah dalam satu kalimat.' };
  }
  const aksi = mati ? 'OFF' : nyala ? 'ON' : null;

  if (!bertanya && aksi && t.includes('lampu')) {
    if (t.includes('tamu')) perintah.push('LAMPU1:' + aksi);
    if (t.includes('kamar')) perintah.push('LAMPU2:' + aksi);
    if (/teras|depan|luar/.test(t)) perintah.push('LAMPU3:' + aksi);
    if (perintah.length === 0 || t.includes('semua')) {
      perintah.splice(0, 3, 'LAMPU:' + aksi);       // tanpa nama ruang = semua
    }
  }
  if (perintah.length > 0) {
    const daftar = perintah.map((p) => {
      const [alat, kata] = p.split(':');
      return NAMA[alat] + ' ' + KATA[kata];
    });
    return { perintah, jawaban: 'Baik, ' + daftar.join(' dan ') + '.' };
  }
  if (/suhu|panas|gerah|dingin|lembap|lembab/.test(t)) {
    if (status.SUHU === null) {
      return { perintah, jawaban: 'Maaf, sensor suhu belum terbaca.' };
    }
    const suhu = String(status.SUHU).replace('.', ',');
    return { perintah, jawaban: `Suhu ruangan ${suhu} derajat Celsius `
      + `dengan kelembapan ${status.LEMBAP} persen.` };
  }
  if (bertanya && t.includes('lampu')) {
    const menyala = ['L1', 'L2', 'L3'].filter((k) => status[k])
      .map((k) => NAMA['LAMPU' + k[1]]);
    return { perintah, jawaban: menyala.length
      ? 'Yang menyala: ' + menyala.join(', ') + '.' : 'Semua lampu mati.' };
  }
  return { perintah, jawaban: 'Maaf, saya belum mengerti perintah itu.' };
}

// ------------------------------------------------------------
// 4. MULUT BIMA: suara dari Gemini TTS (boleh dikosongkan)
// ------------------------------------------------------------
async function buatSuara(teks) {
  if (!KUNCI_GEMINI) return null;   // tanpa kunci: pakai suara peramban
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'x-goog-api-key': KUNCI_GEMINI, 'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: MODEL_SUARA,
          input: [{
            type: 'user_input', content: [{ type: 'text', text: teks }],
          }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: 'Enceladus' }] },
        }),
      });
    const hasil = await r.json();
    const audio = hasil.steps
      .filter((langkah) => langkah.type === 'model_output')
      .flatMap((langkah) => langkah.content)
      .filter((isi) => isi.type === 'audio').pop();
    return audio.data;              // berkas WAV dalam bentuk base64
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// 5. ALUR UTAMA: kalimat -> perintah -> alat -> jawaban
// ------------------------------------------------------------
async function prosesUcapan(teks) {
  let hasil;
  let otak = AI_MODEL || 'token AI';
  try {
    hasil = await tanyaOtak(teks);
  } catch {
    hasil = tafsirKataKunci(teks);
    otak = 'kata kunci';
  }
  // Pengaman: hanya perintah di daftar sah yang dititipkan ke alat
  const usulan = Array.isArray(hasil.perintah) ? hasil.perintah : [];
  const perintah = usulan.filter((p) => PERINTAH_SAH.includes(p));
  let jawaban = String(hasil.jawaban || 'Baik.');
  try {
    for (const p of perintah) await kirim(p);
  } catch (e) {
    jawaban = `Maaf, perintah belum bisa dijalankan. ${e.message}.`;
  }
  const audio = await buatSuara(jawaban);
  return { jawaban, perintah, otak, status: lihatStatus(), audio };
}

// ------------------------------------------------------------
// 6. SERVER WEB: halaman BIMA, API halaman, dan jalur untuk alat
// ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://bima');
  const jawab = (isi, kode = 200) => {
    res.writeHead(kode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(isi));
  };
  try {
    if (req.method === 'GET' && url.pathname === '/alat') {
      res.setHeader('Content-Type', 'text/plain');
      if (!sama(url.searchParams.get('kunci') || '', KUNCI_ALAT)) {
        res.statusCode = 403;
        return res.end('ERR KUNCI\n');
      }
      return res.end(sinkronAlat(url.searchParams) + '\n');
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await readFile(new URL('./rumah.html', import.meta.url)));
    }
    if (url.pathname.startsWith('/api/')) {
      if (!sama(req.headers['x-kata-sandi'] || '', KATA_SANDI)) {
        await tidur(500);                    // memperlambat tebak sandi
        return jawab({ galat: 'kata sandi salah' }, 401);
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return jawab(lihatStatus());
      }
      const json = String(req.headers['content-type'])
        .startsWith('application/json');
      if (req.method === 'POST' && json) {
        let isi = '';
        for await (const potongan of req) {
          isi += potongan;
          if (isi.length > 10000) throw new Error('permintaan terlalu besar');
        }
        const data = JSON.parse(isi);
        if (url.pathname === '/api/ucapan' && typeof data.teks === 'string') {
          return jawab(await prosesUcapan(data.teks.slice(0, 300)));
        }
        if (url.pathname === '/api/tombol'
            && PERINTAH_SAH.includes(data.perintah)) {
          await kirim(data.perintah);
          return jawab({ status: lihatStatus() });
        }
      }
    }
    jawab({ galat: 'permintaan tidak dikenal' }, 404);
  } catch (e) {
    jawab({ galat: e.message, status: lihatStatus() }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server BIMA siap di port ${PORT}`
    + (SIMULASI ? ' (mode simulasi)' : ''));
});
