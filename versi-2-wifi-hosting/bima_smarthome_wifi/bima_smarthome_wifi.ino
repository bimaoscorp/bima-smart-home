/*
  BIMA SMART HOME (Versi 2: WiFi + hosting) - Arduino Uno + ESP-01
  ------------------------------------------------------------
  Arduino tersambung ke WiFi lewat modul ESP-01 (ESP8266). Tiap 2 detik
  Arduino menghubungi server BIMA di hosting sambil melaporkan keadaan:
      GET /alat?kunci=RAHASIA&l=100&t=28.5&h=75
  Server membalas satu baris: perintah (misalnya LAMPU1:ON) atau "-".
  Perintah juga tetap bisa diketik lewat Serial Monitor (kabel USB).
*/
#include <DHT.h>                // pustaka "DHT sensor library" (Adafruit)
#include <Wire.h>               // komunikasi I2C (bawaan Arduino)
#include <SSD1306Ascii.h>       // pustaka "SSD1306Ascii" (hemat memori)
#include <SSD1306AsciiWire.h>
#include <SoftwareSerial.h>     // serial tambahan untuk ESP-01
#include <WiFiEsp.h>            // pustaka "WiFiEsp"

// ---------- UBAH SESUAI WIFI DAN HOSTING ----------
char NAMA_WIFI[]  = "NAMA_WIFI";
char SANDI_WIFI[] = "SANDI_WIFI";
char SERVER[]     = "123.45.67.89";  // IP atau domain hosting Pterodactyl
const int PORT    = 25565;           // port yang diberikan hosting
const char KUNCI_ALAT[] = "ganti-kunci-rahasia";  // sama dengan server

// ---------- Pin yang dipakai ----------
const byte PIN_DHT      = 2;          // data sensor DHT11
const byte PIN_LAMPU[3] = {4, 5, 6};  // lampu ruang tamu, kamar tidur, teras
const byte PIN_ESP_RX   = A0;         // ke kaki TX modul ESP-01
const byte PIN_ESP_TX   = A1;         // ke kaki RX modul ESP-01
// OLED memakai pin SDA (A4) dan SCL (A5)

const unsigned long JEDA_SINKRON = 2000;  // hubungi server tiap 2 detik
const unsigned long JEDA_SENSOR  = 5000;  // baca sensor tiap 5 detik

DHT dht(PIN_DHT, DHT11);
SSD1306AsciiWire oled;
SoftwareSerial serialEsp(PIN_ESP_RX, PIN_ESP_TX);
WiFiEspClient klien;

// ---------- Keadaan ----------
bool lampu[3] = {false, false, false};
float suhu = NAN;
float lembap = NAN;
bool adaModul = false;     // modul ESP-01 terdeteksi
bool online = false;       // sinkron terakhir dengan server berhasil
unsigned long sinkronTerakhir = 0;
unsigned long sensorTerakhir = 0;

void setup() {
  Serial.begin(9600);
  for (byte i = 0; i < 3; i++) {
    pinMode(PIN_LAMPU[i], OUTPUT);
    digitalWrite(PIN_LAMPU[i], LOW);
  }
  dht.begin();

  Wire.begin();
  oled.begin(&Adafruit128x64, 0x3C);
  oled.setFont(System5x7);
  oled.clear();
  tampilkanOLED();

  serialEsp.begin(9600);               // ESP-01 harus diatur ke 9600 baud
  WiFi.init(&serialEsp);
  adaModul = (WiFi.status() != WL_NO_SHIELD);
  if (adaModul) sambungWiFi();
  else Serial.println(F("ERR MODUL ESP-01 TIDAK TERDETEKSI"));
  tampilkanOLED();

  Serial.println(F("SIAP BIMA-SMARTHOME-WIFI"));
}

void loop() {
  // 1) Perintah lewat kabel USB tetap bisa dipakai
  if (Serial.available() > 0) {
    String baris = Serial.readStringUntil('\n');
    baris.trim();
    baris.toUpperCase();
    if (baris.length() > 0) jalankan(baris);
  }

  // 2) Baca sensor berkala
  if (millis() - sensorTerakhir >= JEDA_SENSOR) {
    sensorTerakhir = millis();
    bacaSensor();
  }

  // 3) Sinkron dengan server di hosting
  if (adaModul && millis() - sinkronTerakhir >= JEDA_SINKRON) {
    sinkronTerakhir = millis();
    sinkron();
  }
}

void sambungWiFi() {
  for (byte coba = 0; coba < 3 && WiFi.status() != WL_CONNECTED; coba++) {
    Serial.print(F("Menyambung ke WiFi "));
    Serial.println(NAMA_WIFI);
    WiFi.begin(NAMA_WIFI, SANDI_WIFI);
  }
}

// Laporkan keadaan ke server, lalu jalankan perintah yang dititipkan
void sinkron() {
  bool sebelumnya = online;
  online = false;
  if (WiFi.status() != WL_CONNECTED) {
    sambungWiFi();
  } else if (klien.connect(SERVER, PORT)) {
    klien.print(F("GET /alat?kunci="));
    klien.print(KUNCI_ALAT);
    klien.print(F("&l="));
    for (byte i = 0; i < 3; i++) klien.print(lampu[i] ? '1' : '0');
    klien.print(F("&t="));
    if (isnan(suhu)) klien.print('-'); else klien.print(suhu, 1);
    klien.print(F("&h="));
    if (isnan(lembap)) klien.print('-'); else klien.print(lembap, 0);
    klien.print(F(" HTTP/1.0\r\nHost: "));
    klien.print(SERVER);
    klien.print(F("\r\nConnection: close\r\n\r\n"));

    char balasan[24];
    online = bacaBalasan(balasan, sizeof(balasan));
    klien.stop();
    if (online && strncmp(balasan, "LAMPU", 5) == 0) jalankan(String(balasan));
    else if (online && strcmp(balasan, "-") != 0) {
      Serial.print(F("Server: "));
      Serial.println(balasan);
    }
  }
  if (online != sebelumnya) tampilkanOLED();
}

// Lewati header HTTP, ambil baris pertama isi balasan
bool bacaBalasan(char *isi, byte ukuran) {
  unsigned long mulai = millis();
  byte pola = 0, n = 0;
  bool bagianIsi = false;
  while (millis() - mulai < 5000 && (klien.connected() || klien.available())) {
    while (klien.available()) {
      char c = klien.read();
      bool akhirBaris = (c == '\r' || c == '\n');
      if (!bagianIsi) {
        pola = akhirBaris ? pola + 1 : 0;   // "\r\n\r\n" = akhir header
        if (pola >= 4) bagianIsi = true;
      } else if (akhirBaris) {
        if (n > 0) { isi[n] = '\0'; return true; }
      } else if (n < ukuran - 1) {
        isi[n++] = c;
      }
    }
  }
  isi[n] = '\0';
  return bagianIsi;
}

// Mengartikan satu baris perintah berbentuk ALAT:AKSI
void jalankan(String perintah) {
  int pemisah = perintah.indexOf(':');
  String alat = (pemisah < 0) ? perintah : perintah.substring(0, pemisah);
  String aksi = (pemisah < 0) ? String("") : perintah.substring(pemisah + 1);
  bool saklar = (aksi == "ON" || aksi == "OFF");   // aksi yang sah
  bool nyala  = (aksi == "ON");

  if (alat == "STATUS") {
    bacaSensor();
    kirimStatus();
    return;
  }

  if (alat == "LAMPU" && saklar) {                  // semua lampu sekaligus
    for (byte i = 0; i < 3; i++) aturLampu(i, nyala);
  } else if (alat.length() == 6 && alat.startsWith("LAMPU") && saklar
             && alat[5] >= '1' && alat[5] <= '3') {
    aturLampu(alat[5] - '1', nyala);                // LAMPU1 sampai LAMPU3
  } else {
    Serial.print(F("ERR PERINTAH TIDAK DIKENAL: "));
    Serial.println(perintah);
    return;
  }

  tampilkanOLED();
  kirimStatus();
  Serial.print(F("OK "));
  Serial.println(perintah);
}

void aturLampu(byte nomor, bool nyala) {
  lampu[nomor] = nyala;
  digitalWrite(PIN_LAMPU[nomor], nyala ? HIGH : LOW);
}

void bacaSensor() {
  suhu   = dht.readTemperature();   // derajat Celsius
  lembap = dht.readHumidity();      // persen
  tampilkanOLED();
}

// 8 baris x 21 huruf: judul, status WiFi, suhu, kelembapan, lampu
void tampilkanOLED() {
  oled.setCursor(0, 0);
  oled.print(F("BIMA Smart Home"));
  oled.clearToEOL();
  oled.setCursor(0, 1);
  if (!adaModul) oled.print(F("WiFi: tanpa modul"));
  else if (online) oled.print(F("WiFi: online"));
  else oled.print(F("WiFi: menyambung"));
  oled.clearToEOL();

  oled.setCursor(0, 3);
  oled.print(F("Suhu   : "));
  if (isnan(suhu)) oled.print(F("--"));
  else { oled.print(suhu, 1); oled.print(F(" C")); }
  oled.clearToEOL();
  oled.setCursor(0, 4);
  oled.print(F("Lembap : "));
  if (isnan(lembap)) oled.print(F("--"));
  else { oled.print(lembap, 0); oled.print(F(" %")); }
  oled.clearToEOL();

  oled.setCursor(0, 6);                  // urutan: ruang tamu, kamar, teras
  oled.print(F("Lampu  :"));
  for (byte i = 0; i < 3; i++) oled.print(lampu[i] ? F(" ON") : F(" --"));
  oled.clearToEOL();
}

void kirimStatus() {
  Serial.print(F("STATUS L1="));  Serial.print(lampu[0]);
  Serial.print(F(";L2="));        Serial.print(lampu[1]);
  Serial.print(F(";L3="));        Serial.print(lampu[2]);
  Serial.print(F(";SUHU="));
  if (isnan(suhu)) Serial.print('-'); else Serial.print(suhu, 1);
  Serial.print(F(";LEMBAP="));
  if (isnan(lembap)) Serial.print('-'); else Serial.print(lembap, 0);
  Serial.println();
}
