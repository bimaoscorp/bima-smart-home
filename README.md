# BIMA Smart Home

Rumah pintar berbasis **Arduino Uno** yang dikendalikan asisten AI **BIMA** dengan perintah suara.
BIMA dapat menyalakan dan mematikan tiga lampu (LED), membaca suhu dan kelembapan (DHT11),
dan menampilkan keadaan rumah di OLED 0,96". Project akhir mata pelajaran Informatika,
SMA Negeri 1 Tabanan, 2026.

Repositori ini berisi dua versi:

| Folder | Versi | Cara Arduino terhubung ke BIMA |
|---|---|---|
| [`versi-1-usb`](versi-1-usb) | Versi 1 | Kabel USB ke laptop. Program jembatan Node.js di laptop + model bahasa lewat Ollama. |
| [`versi-2-wifi-hosting`](versi-2-wifi-hosting) | Versi 2 | Modul WiFi ESP-01. Server BIMA di hosting Pterodactyl + token AI (API berformat OpenAI). |

## Rangkaian

Komponen yang sama dipakai di kedua versi:

| Komponen | Pin Arduino Uno |
|---|---|
| DHT11 (VCC / DATA / GND) | 5V / D2 / GND |
| OLED SSD1306 (GND / VCC / SCL / SDA) | GND / 5V / A5 / A4 |
| LED ruang tamu, kamar tidur, teras (lewat resistor 220 Ω) | D4, D5, D6 |
| ESP-01 pada adaptor 5 V (VCC / GND / TX / RX), **versi 2 saja** | 5V / GND / A0 / A1 |

Rangkaian dapat dibuka di simulator [Wokwi](https://wokwi.com) dengan berkas `diagram.json` di folder `wokwi` pada tiap versi.

Perintah ke Arduino berupa satu baris teks `ALAT:AKSI`:
`LAMPU1:ON`, `LAMPU1:OFF`, `LAMPU2:ON`, `LAMPU2:OFF`, `LAMPU3:ON`, `LAMPU3:OFF`,
`LAMPU:ON`, `LAMPU:OFF`, dan `STATUS`.

## Versi 1 (USB)

```
versi-1-usb/
├── bima_smarthome/bima_smarthome.ino   program Arduino Uno
├── jembatan-bima.mjs                   program jembatan (Node.js) di laptop
├── rumah.html                          halaman BIMA (telinga + mulut)
└── wokwi/                              rangkaian untuk simulator Wokwi
```

1. Pasang pustaka Arduino **DHT sensor library**, **Adafruit SSD1306**, dan **Adafruit GFX Library**, lalu unggah `bima_smarthome.ino`.
2. Di laptop: `npm install serialport`, lalu `node jembatan-bima.mjs COM3`.
   Alamat Ollama diatur lewat `OLLAMA_URL`, model lewat `MODEL_OTAK`, suara Gemini lewat `GEMINI_API_KEY` (pilihan).
3. Buka `http://127.0.0.1:7700` di Chrome atau Edge.

Tanpa Arduino: `node jembatan-bima.mjs simulasi`.

## Versi 2 (WiFi + hosting)

```
versi-2-wifi-hosting/
├── atur_baud_esp01/atur_baud_esp01.ino           jalankan sekali: ESP-01 ke 9600 baud
├── bima_smarthome_wifi/bima_smarthome_wifi.ino   program Arduino Uno + ESP-01
├── server/
│   ├── server-bima.mjs                           server BIMA (Node.js 18+, tanpa pustaka tambahan)
│   ├── rumah.html                                halaman BIMA
│   ├── package.json
│   └── pengaturan.contoh.json                    salin menjadi pengaturan.json lalu isi
└── wokwi/                                        rangkaian Wokwi + custom chip ESP-01
```

1. Unggah `atur_baud_esp01.ino`, buka Serial Monitor 9600 baud (*Both NL & CR*), pastikan muncul `OK`.
2. Di hosting Pterodactyl (egg Node.js): unggah isi folder `server`, buat `pengaturan.json`:

   | Kunci | Isi |
   |---|---|
   | `KATA_SANDI` | kata sandi untuk membuka halaman BIMA |
   | `KUNCI_ALAT` | kunci rahasia, sama dengan `KUNCI_ALAT` di program Arduino |
   | `AI_URL` | alamat API dari penyedia token AI (berakhiran `/v1` atau sejenisnya) |
   | `AI_KEY` | token AI, **jangan pernah diunggah ke GitHub** |
   | `AI_MODEL` | nama model |
   | `GEMINI_API_KEY` | pilihan, untuk suara Gemini TTS |
   | `PORT` | hanya bila panel tidak memberi `SERVER_PORT` |

   Atur berkas utama `server-bima.mjs`, lalu *Start*.
3. Di `bima_smarthome_wifi.ino` ubah `NAMA_WIFI`, `SANDI_WIFI`, `SERVER`, `PORT`, `KUNCI_ALAT`.
   Pasang pustaka **DHT sensor library**, **SSD1306Ascii**, **WiFiEsp**, lalu unggah.
4. OLED menampilkan `WiFi: online`. Buka alamat server di Chrome, masukkan kata sandi.
   Mikrofon hanya aktif bila halaman dibuka lewat HTTPS; tanpa HTTPS perintah tetap bisa diketik.

Tanpa Arduino: `node server-bima.mjs simulasi`. ESP-01 hanya mendukung WiFi 2,4 GHz.

## Keamanan

- `pengaturan.json` berisi token dan kata sandi, sudah dicantumkan di `.gitignore` agar tidak ikut terunggah.
- Semua perintah dari AI disaring dengan daftar perintah sah sebelum sampai ke Arduino.
- LED dipakai sebagai miniatur lampu. Untuk lampu 220 V pakai modul relay dan minta pendampingan orang yang paham kelistrikan.
