// ============================================================
//  JEMBATAN BIMA <-> ARDUINO UNO            (Node.js 18 ke atas)
//  Menjalankan :  node jembatan-bima.mjs COM3
//  Tanpa alat  :  node jembatan-bima.mjs simulasi
//  Lalu buka   :  http://127.0.0.1:7700   (Chrome atau Edge)
// ============================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT_ARDUINO = process.argv[2] || 'COM3';
const PORT_WEB     = 7700;
const OLLAMA_URL   = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL_OTAK   = process.env.MODEL_OTAK || 'qwen3:4b';
const KUNCI_GEMINI = process.env.GEMINI_API_KEY || '';
const MODEL_SUARA  = process.env.MODEL_SUARA || 'gemini-3.8-flash-lite-tts';

const NAMA = {
  LAMPU1: 'lampu ruang tamu', LAMPU2: 'lampu kamar tidur',
  LAMPU3: 'lampu teras', LAMPU: 'semua lampu',
};
const KATA = { ON: 'dinyalakan', OFF: 'dimatikan' };
const PERINTAH_SAH = [
  'LAMPU1:ON', 'LAMPU1:OFF', 'LAMPU2:ON', 'LAMPU2:OFF',
  'LAMPU3:ON', 'LAMPU3:OFF', 'LAMPU:ON', 'LAMPU:OFF',
];

// Keadaan rumah terakhir yang dilaporkan Arduino
const status = {
  tersambung: false, simulasi: PORT_ARDUINO === 'simulasi',
  L1: 0, L2: 0, L3: 0, SUHU: null, LEMBAP: null,
};

// ------------------------------------------------------------
// 1. SAMBUNGAN KE ARDUINO (USB serial 9600 baud)
// ------------------------------------------------------------
let tulis = null;    // fungsi penulis satu baris ke Arduino
let tunggu = null;   // perintah yang sedang menunggu jawaban OK / ERR

function terimaBaris(baris) {
  baris = baris.trim();
  if (!baris) return;
  console.log('[Arduino]', baris);
  if (baris.startsWith('SIAP')) status.tersambung = true;
  if (baris.startsWith('STATUS ')) {
    status.tersambung = true;
    for (const bagian of baris.slice(7).split(';')) {
      const [nama, nilai] = bagian.split('=');
      if (!Object.hasOwn(status, nama)) continue;
      status[nama] = nilai === '-' ? null : Number(nilai);
    }
  }
  if (tunggu && baris.startsWith('OK ')) {
    tunggu.selesai();
    tunggu = null;
  }
  if (tunggu && baris.startsWith('ERR ')) {
    tunggu.gagal(new Error(baris));
    tunggu = null;
  }
}

async function sambungArduino() {
  if (status.simulasi) {            // Arduino tiruan, untuk mencoba tanpa alat
    tulis = (p) => setTimeout(() => arduinoTiruan(p), 50);
    terimaBaris('SIAP BIMA-SMARTHOME (simulasi)');
    return;
  }
  const { SerialPort } = await import('serialport');
  const { ReadlineParser } = await import('@serialport/parser-readline');
  const port = new SerialPort({ path: PORT_ARDUINO, baudRate: 9600 });
  port.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', terimaBaris);
  port.on('open', () => console.log('Port', PORT_ARDUINO, 'terbuka.'));
  port.on('error', (e) => console.error('Serial bermasalah:', e.message));
  port.on('close', () => {
    status.tersambung = false;
    console.log('Sambungan Arduino terputus.');
  });
  tulis = (p) => port.write(p + '\n');
}

function arduinoTiruan(p) {         // meniru jawaban sketch Arduino
  const [alat, aksi] = p.split(':');
  const s = status;
  const nyala = aksi === 'ON' ? 1 : 0;
  if (alat === 'LAMPU') s.L1 = s.L2 = s.L3 = nyala;
  else s['L' + alat[5]] = nyala;
  terimaBaris(`STATUS L1=${s.L1};L2=${s.L2};L3=${s.L3};SUHU=28.5;LEMBAP=75`);
  terimaBaris('OK ' + p);
}

// Kirim satu perintah, lalu tunggu jawaban paling lama 2 detik
function kirimSekali(perintah) {
  return new Promise((selesai, gagal) => {
    if (!status.tersambung) {
      return gagal(new Error('Arduino belum tersambung'));
    }
    const batas = setTimeout(() => {
      tunggu = null;
      gagal(new Error('Arduino tidak menjawab'));
    }, 2000);
    tunggu = {
      selesai: () => { clearTimeout(batas); selesai(); },
      gagal: (e) => { clearTimeout(batas); gagal(e); },
    };
    tulis(perintah);
  });
}

// Perintah dikirim satu per satu; bila gagal, diulang satu kali
let antrean = Promise.resolve();
function kirim(perintah) {
  const hasil = antrean.then(
    () => kirimSekali(perintah).catch(() => kirimSekali(perintah)));
  antrean = hasil.catch(() => {});
  return hasil;
}

// ------------------------------------------------------------
// 2. OTAK BIMA: mengubah kalimat menjadi perintah
// ------------------------------------------------------------
// Cara utama: bertanya kepada model bahasa BIMA (Ollama)
async function tanyaOtak(teks) {
  const sistem = [
    'Kamu adalah BIMA, asisten AI pribadi berbahasa Indonesia yang sopan,',
    'tenang, dan ringkas. Kamu mengendalikan lampu rumah lewat Arduino Uno',
    'dan dapat membaca suhu serta kelembapan ruangan.',
    'Lampu: LAMPU1 = lampu ruang tamu, LAMPU2 = lampu kamar tidur,',
    'LAMPU3 = lampu teras, LAMPU = semua lampu.',
    'Perintah yang boleh dipakai: ' + PERINTAH_SAH.join(', ') + '.',
    'Keadaan sekarang (L1-L3: 1 = menyala, 0 = mati; SUHU dalam derajat',
    'Celsius; LEMBAP dalam persen): ' + JSON.stringify(status) + '.',
    'Isi "perintah" hanya bila pengguna meminta lampu dinyalakan atau',
    'dimatikan. Untuk pertanyaan, jawab dari keadaan sekarang dan kosongkan',
    '"perintah". "jawaban" adalah satu atau dua kalimat pendek yang akan',
    'diucapkan.',
  ].join('\n');
  const bentukJawaban = {
    type: 'object',
    required: ['jawaban', 'perintah'],
    properties: {
      jawaban: { type: 'string' },
      perintah: {
        type: 'array', items: { type: 'string', enum: PERINTAH_SAH },
      },
    },
  };
  const r = await fetch(OLLAMA_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: MODEL_OTAK, stream: false, think: false,
      options: { temperature: 0 },
      format: bentukJawaban,
      messages: [
        { role: 'system', content: sistem },
        { role: 'user', content: teks },
      ],
    }),
  });
  if (!r.ok) throw new Error('Ollama menjawab ' + r.status);
  return JSON.parse((await r.json()).message.content);
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
// 3. MULUT BIMA: mengubah jawaban menjadi suara (Gemini TTS)
// ------------------------------------------------------------
async function buatSuara(teks) {
  if (!KUNCI_GEMINI) return null;   // tanpa kunci: pakai suara bawaan peramban
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
    return null;                    // gagal: pakai suara bawaan peramban
  }
}

// ------------------------------------------------------------
// 4. ALUR UTAMA: kalimat -> perintah -> Arduino -> jawaban
// ------------------------------------------------------------
async function prosesUcapan(teks) {
  let hasil;
  let otak = MODEL_OTAK;
  try {
    hasil = await tanyaOtak(teks);
  } catch {
    hasil = tafsirKataKunci(teks);
    otak = 'kata kunci';
  }

  // Pengaman: hanya perintah di daftar sah yang diteruskan ke Arduino
  const usulan = Array.isArray(hasil.perintah) ? hasil.perintah : [];
  const perintah = usulan.filter((p) => PERINTAH_SAH.includes(p));
  let jawaban = String(hasil.jawaban || 'Baik.');
  try {
    for (const p of perintah) await kirim(p);
  } catch (e) {
    jawaban = `Maaf, perintah belum bisa dijalankan. ${e.message}.`;
  }
  const audio = await buatSuara(jawaban);
  return { jawaban, perintah, otak, status, audio };
}

// ------------------------------------------------------------
// 5. SERVER KECIL untuk halaman BIMA (hanya untuk laptop ini)
// ------------------------------------------------------------
const HOST_SAH = ['127.0.0.1:' + PORT_WEB, 'localhost:' + PORT_WEB];

const server = http.createServer(async (req, res) => {
  const jawab = (isi, kode = 200) => {
    res.writeHead(kode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(isi));
  };
  try {
    if (!HOST_SAH.includes(req.headers.host)) {
      return jawab({ galat: 'ditolak' }, 403);
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await readFile(new URL('./rumah.html', import.meta.url)));
    }
    if (req.method === 'GET' && req.url === '/api/status') {
      return jawab(status);
    }
    const json = req.headers['content-type'] === 'application/json';
    if (req.method === 'POST' && json) {
      let isi = '';
      for await (const potongan of req) isi += potongan;
      const data = JSON.parse(isi);
      if (req.url === '/api/ucapan' && typeof data.teks === 'string') {
        return jawab(await prosesUcapan(data.teks.slice(0, 300)));
      }
      if (req.url === '/api/tombol' && PERINTAH_SAH.includes(data.perintah)) {
        await kirim(data.perintah);
        return jawab({ status });
      }
    }
    jawab({ galat: 'permintaan tidak dikenal' }, 404);
  } catch (e) {
    jawab({ galat: e.message, status }, 500);
  }
});

await sambungArduino();
server.listen(PORT_WEB, '127.0.0.1', () => {
  console.log(`BIMA Smart Home siap: http://127.0.0.1:${PORT_WEB}`);
});
