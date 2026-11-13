/*
  ATUR KECEPATAN ESP-01 KE 9600 BAUD (cukup dijalankan satu kali)
  ------------------------------------------------------------
  ESP-01 biasanya bawaan pabrik 115200 baud, terlalu cepat untuk
  SoftwareSerial. Program ini mengirim AT+UART_DEF agar ESP-01 tersimpan
  pada 9600 baud. Rangkaian sama dengan BIMA versi 2 (TX ESP ke A0,
  RX ESP ke A1). Buka Serial Monitor 9600 baud, akhiran "Both NL & CR".
*/
#include <SoftwareSerial.h>

SoftwareSerial esp(A0, A1);   // RX, TX

void setup() {
  Serial.begin(9600);
  esp.begin(115200);                       // kecepatan bawaan ESP-01
  delay(1000);
  esp.println(F("AT+UART_DEF=9600,8,1,0,0"));
  delay(500);
  esp.begin(9600);                         // mulai sekarang 9600 baud
  delay(200);
  esp.println(F("AT"));                    // harus dibalas OK
  Serial.println(F("Selesai. Bila muncul OK, ESP-01 sudah 9600 baud."));
  Serial.println(F("Perintah AT lain boleh diketik di sini."));
}

void loop() {                              // penerus Serial Monitor <-> ESP
  if (esp.available()) Serial.write(esp.read());
  if (Serial.available()) esp.write(Serial.read());
}
