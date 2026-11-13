/*
  BIMA SMART HOME - Program Arduino Uno
  ------------------------------------------------------------
  Arduino menjadi "tangan" BIMA. Perintah datang berupa teks
  lewat kabel USB (serial 9600 baud), misalnya:
      LAMPU1:ON    LAMPU2:OFF    LAMPU:ON  (semua lampu)    STATUS
  Setiap perintah dibalas dengan laporan keadaan, contoh:
      STATUS L1=1;L2=0;L3=0;SUHU=28.5;LEMBAP=75
      OK LAMPU1:ON
  Suhu, kelembapan, dan keadaan lampu juga tampil di OLED 0,96".
*/
#include <DHT.h>                // pustaka "DHT sensor library" (Adafruit)
#include <Wire.h>               // komunikasi I2C (bawaan Arduino)
#include <Adafruit_GFX.h>       // pustaka "Adafruit GFX Library"
#include <Adafruit_SSD1306.h>   // pustaka "Adafruit SSD1306"

// ---------- Pin yang dipakai ----------
const byte PIN_DHT      = 2;          // data sensor DHT11
const byte PIN_LAMPU[3] = {4, 5, 6};  // lampu ruang tamu, kamar tidur, teras
// OLED memakai pin SDA (A4) dan SCL (A5)

// ---------- Pengaturan ----------
const byte ALAMAT_OLED = 0x3C;          // sebagian modul memakai 0x3D
const unsigned long JEDA_LAPOR = 5000;  // baca sensor & lapor tiap 5 detik

DHT dht(PIN_DHT, DHT11);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);   // OLED 128x64 piksel

// ---------- Keadaan perangkat ----------
bool lampu[3] = {false, false, false};
float suhu = NAN;
float lembap = NAN;
unsigned long laporTerakhir = 0;

void setup() {
  Serial.begin(9600);

  for (byte i = 0; i < 3; i++) {
    pinMode(PIN_LAMPU[i], OUTPUT);
    digitalWrite(PIN_LAMPU[i], LOW);
  }
  dht.begin();

  if (!oled.begin(SSD1306_SWITCHCAPVCC, ALAMAT_OLED)) {
    Serial.println(F("ERR OLED TIDAK TERDETEKSI"));
  }
  tampilkanOLED();

  Serial.println(F("SIAP BIMA-SMARTHOME"));
}

void loop() {
  // 1) Ada perintah dari BIMA?
  if (Serial.available() > 0) {
    String baris = Serial.readStringUntil('\n');
    baris.trim();
    baris.toUpperCase();
    if (baris.length() > 0) jalankan(baris);
  }

  // 2) Lapor berkala: baca sensor, perbarui OLED, kirim keadaan terbaru
  if (millis() - laporTerakhir >= JEDA_LAPOR) {
    laporTerakhir = millis();
    bacaSensor();
    kirimStatus();
  }
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

// Isi layar: judul, suhu, kelembapan, dan keadaan ketiga lampu
void tampilkanOLED() {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print(F("BIMA Smart Home"));
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  oled.setCursor(0, 18);
  oled.print(F("Suhu"));
  oled.setTextSize(2);
  oled.setCursor(46, 14);
  if (isnan(suhu)) oled.print(F("--"));
  else { oled.print(suhu, 1); oled.print((char)247); oled.print('C'); }

  oled.setTextSize(1);
  oled.setCursor(0, 38);
  oled.print(F("Lembap"));
  oled.setTextSize(2);
  oled.setCursor(46, 34);
  if (isnan(lembap)) oled.print(F("--"));
  else { oled.print(lembap, 0); oled.print('%'); }

  oled.setTextSize(1);                 // urutan: ruang tamu, kamar, teras
  oled.setCursor(0, 56);
  oled.print(F("Lampu:"));
  for (byte i = 0; i < 3; i++) oled.print(lampu[i] ? F(" ON") : F(" --"));
  oled.display();
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
