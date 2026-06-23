// BLINDGUARD CHEST BOX (2-Wrist Mode)
// Web Serial ready firmware for browser app integration
// 3x HC-SR04 + VL53L0X + MPU6050 + DHT11 + ESP-NOW

#include <WiFi.h>
#include <WebServer.h>
#include <esp_now.h>
#include <Wire.h>
#include <Adafruit_VL53L0X.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>

#define WIFI_STA_SSID      "nick"
#define WIFI_STA_PASSWORD  "12345678"
#define WIFI_STA_HOSTNAME  "esp32-910960"
#define WIFI_STATUS_PATH   "/api/system/status"
#define WIFI_SENSOR_PATH   "/api/sensor/current"

// Wrist MAC addresses
uint8_t leftWristMAC[]  = {0xEC, 0x64, 0xC9, 0x91, 0x91, 0x14};
uint8_t rightWristMAC[] = {0x5C, 0xCF, 0x7F, 0x8A, 0xCC, 0xC6};

// Pins
#define TRIG_L    16
#define ECHO_L    39
#define TRIG_R    17
#define ECHO_R    34
#define TRIG_F    25
#define ECHO_F    36
#define SDA_PIN   21
#define SCL_PIN   22
#define DHT_PIN   4
#define LED_PIN   2

// Settings
#define MAX_DIST       400.0f
#define US_TIMEOUT     25000
#define DANGER         50.0f
#define WARNING        100.0f
#define CAUTION        200.0f

// ESP-NOW packet
typedef struct __attribute__((packed)) {
  uint8_t header;        // 0xAA
  uint8_t leftDist;      // cm
  uint8_t centerDist;    // cm
  uint8_t rightDist;     // cm
  uint8_t frontDist;     // cm
  uint8_t pattern;       // haptic pattern
  uint8_t intensity;     // 0-20
  uint8_t dangerLevel;   // 0-3
  int8_t  temp;          // celsius
  uint8_t fallDetected;  // 1 = fall
  uint8_t muted;         // 1 = muted
  uint16_t stateSeq;     // mute toggle sequence
} Packet;

Packet pkt;
WebServer webServer(80);

Adafruit_VL53L0X tof = Adafruit_VL53L0X();
Adafruit_MPU6050 mpu;
DHT dht(DHT_PIN, DHT11);

float leftDist = 400, rightDist = 400;
float frontDist = 400, centerDist = 400;
float temperature = 25.0f;
float humidity = 50.0f;
float accelX = 0, accelY = 0, accelZ = 0;
float accelMag = 0;
uint16_t tofRawMm = 8190;

bool tofOK = false, imuOK = false;
bool tofValid = false;
bool imuLive = false;
bool dhtTempValid = false;
bool dhtHumValid = false;
bool espOK = false, peerOK = false;
bool isMuted = false;
uint16_t lastMuteSeq = 0;
uint8_t hapticMaxIntensity = 20;
unsigned long lastLeftHeartbeat = 0;
unsigned long lastRightHeartbeat = 0;
bool leftConnected = false;
bool rightConnected = false;
const unsigned long WRIST_TIMEOUT_MS = 1600;
unsigned long lastSosTriggerAt = 0;
const unsigned long SOS_ACTIVE_MS = 12000;
unsigned long lastImuRecoveryAt = 0;
unsigned long lastDhtRecoveryAt = 0;

float lBuf[3] = {MAX_DIST, MAX_DIST, MAX_DIST};
float rBuf[3] = {MAX_DIST, MAX_DIST, MAX_DIST};
float fBuf[3] = {MAX_DIST, MAX_DIST, MAX_DIST};
uint8_t bIdx = 0;

unsigned long tSend = 0, tDHT = 0, tPrint = 0, tLED = 0, tWeb = 0, tWifiRetry = 0;
unsigned long tTofLive = 0, tImuLive = 0, tDhtLive = 0;

enum Phase { P_LEFT, P_WAIT_L, P_RIGHT, P_WAIT_R, P_FRONT, P_WAIT_F, P_I2C, P_DONE };
Phase phase = P_LEFT;
unsigned long pTimer = 0;

bool fallDetected = false;
bool fallArmed = false;
bool stairsDetected = false;
bool roughSurface = false;
uint16_t stepCount = 0;
float pitchDeg = 0;
float accelMagLP = 9.81f;
unsigned long fallArmedAt = 0;
unsigned long lastStepAt = 0;
unsigned long stairsDetectedAt = 0;
unsigned long roughDetectedAt = 0;
unsigned long fallDetectedAt = 0;

float getForwardRiskDistance() {
  // Keep ToF and front US separate in telemetry; combine only for danger logic.
  const bool tofUsable = tofValid && centerDist >= 2.0f && centerDist <= MAX_DIST;
  if (!tofUsable) return frontDist;

  return min(frontDist, centerDist);
}

float getTofRawCm() {
  return (tofRawMm < 8000) ? (tofRawMm / 10.0f) : MAX_DIST;
}

static bool isSameMac(const uint8_t *a, const uint8_t *b) {
  return memcmp(a, b, 6) == 0;
}

// Wrist link status is inferred from ESP-NOW traffic and send success.

void addCorsHeaders() {
  webServer.sendHeader("Access-Control-Allow-Origin", "*");
  webServer.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  webServer.sendHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  webServer.sendHeader("Access-Control-Allow-Private-Network", "true");
  webServer.sendHeader("Cache-Control", "no-store");
}

void handleOptions() {
  addCorsHeaders();
  webServer.send(204);
}

int getBatteryPercent() {
  // Placeholder until dedicated battery ADC is wired.
  return 85;
}

void handleStatus() {
  addCorsHeaders();
  const bool sosTriggered = (millis() - lastSosTriggerAt) <= SOS_ACTIVE_MS;
  String payload = String("{")
    + "\"device\":\"AuraGuard-Chest\"," 
    + "\"ssid\":\"" WIFI_STA_SSID "\"," 
    + "\"espNow\":" + (espOK ? "true" : "false") + ","
    + "\"leftConnected\":" + (leftConnected ? "true" : "false") + ","
    + "\"rightConnected\":" + (rightConnected ? "true" : "false") + ","
    + "\"wristsConnected\":" + ((leftConnected || rightConnected) ? "true" : "false") + ","
    + "\"hapticMaxIntensity\":" + String(hapticMaxIntensity) + ","
    + "\"fallDetected\":" + (fallDetected ? "true" : "false") + ","
    + "\"sosTriggered\":" + (sosTriggered ? "true" : "false") + ","
    + "\"ip\":\"" + WiFi.localIP().toString() + "\"," 
    + "\"wifiConnected\":" + (WiFi.status() == WL_CONNECTED ? "true" : "false")
    + "}";
  webServer.send(200, "application/json", payload);
}

void handleSensorCurrent() {
  float forwardRisk = getForwardRiskDistance();
  unsigned long now = millis();
  float tofRawCm = getTofRawCm();
  const bool sosTriggered = (now - lastSosTriggerAt) <= SOS_ACTIVE_MS;

  const bool tofLiveNow = tofOK && tofValid && (now - tTofLive <= 1500);
  const bool imuLiveNow = imuOK && imuLive && (now - tImuLive <= 1500);
  const bool dhtLiveNow = (dhtTempValid || dhtHumValid) && (now - tDhtLive <= 12000);

  addCorsHeaders();
  char payload[768];
  snprintf(
    payload,
    sizeof(payload),
    "{\"left\":%.1f,\"center\":%.1f,\"right\":%.1f,\"front\":%.1f,\"far\":%.1f,\"forwardRisk\":%.1f,\"tofValid\":%s,\"tofRawMm\":%u,\"imuOk\":%s,\"imuLive\":%s,\"stairsDetected\":%s,\"roughSurface\":%s,\"stepCount\":%u,\"accelX\":%.2f,\"accelY\":%.2f,\"accelZ\":%.2f,\"accelMag\":%.2f,\"temperature\":%.1f,\"humidity\":%.1f,\"dhtLive\":%s,\"dhtTempValid\":%s,\"dhtHumValid\":%s,\"pattern\":%u,\"intensity\":%u,\"hapticMaxIntensity\":%u,\"dangerLevel\":%u,\"leftConnected\":%s,\"rightConnected\":%s,\"wristsConnected\":%s,\"fallDetected\":%s,\"sosTriggered\":%s,\"battery\":%d}",
    leftDist,
    centerDist,
    rightDist,
    frontDist,
    tofRawCm,
    forwardRisk,
    tofLiveNow ? "true" : "false",
    tofRawMm,
    imuOK ? "true" : "false",
    imuLiveNow ? "true" : "false",
    stairsDetected ? "true" : "false",
    roughSurface ? "true" : "false",
    (unsigned int)stepCount,
    accelX,
    accelY,
    accelZ,
    accelMag,
    temperature,
    humidity,
    dhtLiveNow ? "true" : "false",
    dhtTempValid ? "true" : "false",
    dhtHumValid ? "true" : "false",
    pkt.pattern,
    pkt.intensity,
    hapticMaxIntensity,
    pkt.dangerLevel,
    leftConnected ? "true" : "false",
    rightConnected ? "true" : "false",
    (leftConnected || rightConnected) ? "true" : "false",
    fallDetected ? "true" : "false",
    sosTriggered ? "true" : "false",
    getBatteryPercent()
  );
  webServer.send(200, "application/json", payload);
}

void handleHapticIntensity() {
  addCorsHeaders();

  int value = -1;
  if (webServer.hasArg("value")) {
    value = webServer.arg("value").toInt();
  } else if (webServer.hasArg("v")) {
    value = webServer.arg("v").toInt();
  }

  if (value >= 0) {
    hapticMaxIntensity = (uint8_t)constrain(value, 0, 20);
  }

  String payload = String("{")
    + "\"hapticMaxIntensity\":" + String(hapticMaxIntensity)
    + "}";
  webServer.send(200, "application/json", payload);
}

void handleHapticMute() {
  addCorsHeaders();

  int value = -1;
  if (webServer.hasArg("value")) {
    value = webServer.arg("value").toInt();
  } else if (webServer.hasArg("v")) {
    value = webServer.arg("v").toInt();
  }

  if (value >= 0) {
    isMuted = value > 0;
  }

  String payload = String("{")
    + "\"muted\":" + String(isMuted ? "true" : "false")
    + "}";
  webServer.send(200, "application/json", payload);
}

void handleSosTrigger() {
  addCorsHeaders();

  lastSosTriggerAt = millis();
  Serial.println("[SOS] Trigger received via Wi-Fi API");

  String payload = String("{")
    + "\"status\":\"ok\"," 
    + "\"sosTriggered\":true"
    + "}";
  webServer.send(200, "application/json", payload);
}

void setupWifiHttpApi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(WIFI_STA_HOSTNAME);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);

  Serial.printf("[..] Connecting to hotspot SSID: %s\n", WIFI_STA_SSID);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[OK] Wi-Fi connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WARN] Wi-Fi hotspot connect failed. API server still running, retrying in background.");
  }

  webServer.on(WIFI_STATUS_PATH, HTTP_OPTIONS, handleOptions);
  webServer.on(WIFI_SENSOR_PATH, HTTP_OPTIONS, handleOptions);
  webServer.on("/api/haptic/intensity", HTTP_OPTIONS, handleOptions);
  webServer.on("/api/haptic/mute", HTTP_OPTIONS, handleOptions);
  webServer.on("/api/sos", HTTP_OPTIONS, handleOptions);
  webServer.on(WIFI_STATUS_PATH, HTTP_GET, handleStatus);
  webServer.on(WIFI_SENSOR_PATH, HTTP_GET, handleSensorCurrent);
  webServer.on("/api/haptic/intensity", HTTP_GET, handleHapticIntensity);
  webServer.on("/api/haptic/intensity", HTTP_POST, handleHapticIntensity);
  webServer.on("/api/haptic/mute", HTTP_GET, handleHapticMute);
  webServer.on("/api/haptic/mute", HTTP_POST, handleHapticMute);
  webServer.on("/api/sos", HTTP_POST, handleSosTrigger);
  webServer.on("/", HTTP_GET, []() {
    addCorsHeaders();
    webServer.send(200, "text/plain", "AuraGuardian chest Wi-Fi API online");
  });
  webServer.onNotFound([]() {
    addCorsHeaders();
    webServer.send(404, "application/json", "{\"error\":\"not_found\"}");
  });

  webServer.begin();
  Serial.println("[OK] Wi-Fi HTTP API started");
}

void ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - tWifiRetry < 5000) return;
  tWifiRetry = now;

  Serial.println("[WARN] Wi-Fi disconnected, retrying hotspot connect...");
  WiFi.disconnect(false, false);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);
}

void onSent(const wifi_tx_info_t *info, esp_now_send_status_t status) {
  if (info == nullptr || status != ESP_NOW_SEND_SUCCESS) {
    return;
  }

  const unsigned long now = millis();
  const uint8_t *dst = info->des_addr;
  if (isSameMac(dst, leftWristMAC)) {
    lastLeftHeartbeat = now;
    leftConnected = true;
  } else if (isSameMac(dst, rightWristMAC)) {
    lastRightHeartbeat = now;
    rightConnected = true;
  }
}

void onRecv(const esp_now_recv_info_t *esp_now_info, const uint8_t *data, int data_len) {
  if (esp_now_info != nullptr) {
    const uint8_t *src = esp_now_info->src_addr;
    const unsigned long now = millis();
    if (isSameMac(src, leftWristMAC)) {
      lastLeftHeartbeat = now;
      leftConnected = true;
    } else if (isSameMac(src, rightWristMAC)) {
      lastRightHeartbeat = now;
      rightConnected = true;
    }
  }

  if (data_len >= 2 && data[0] == 0xBD) {
    // Left wrist tactile SOS trigger over ESP-NOW fallback path.
    lastSosTriggerAt = millis();
    Serial.println("[SOS] Trigger received via ESP-NOW");
    return;
  }

  if (data_len >= 4 && data[0] == 0xBB) {
    const uint8_t desiredMute = data[1];
    const uint16_t seq = (uint16_t)data[2] | ((uint16_t)data[3] << 8);

    if (seq == lastMuteSeq) {
      return;
    }

    lastMuteSeq = seq;
    isMuted = desiredMute ? true : false;
    Serial.print("\n>>> MUTE REQUEST RECEIVED! System is now: ");
    Serial.println(isMuted ? "MUTED (Processing Silenced) <<<" : "ACTIVE <<<");
  }
}

void updateWristPresence() {
  unsigned long now = millis();
  leftConnected = (lastLeftHeartbeat > 0) && ((now - lastLeftHeartbeat) < WRIST_TIMEOUT_MS);
  rightConnected = (lastRightHeartbeat > 0) && ((now - lastRightHeartbeat) < WRIST_TIMEOUT_MS);
  peerOK = leftConnected || rightConnected;
}

void recoverImuIfNeeded() {
  unsigned long now = millis();
  if (now - lastImuRecoveryAt < 10000) return;
  if (imuLive && (now - tImuLive) < 2000) return;

  lastImuRecoveryAt = now;
  if (mpu.begin()) {
    mpu.setAccelerometerRange(MPU6050_RANGE_16_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    imuOK = true;
    Serial.println("[RECOVER] MPU6050 reinitialized");
  } else {
    imuOK = false;
    Serial.println("[RECOVER] MPU6050 init failed");
  }
}

void recoverDhtIfNeeded() {
  unsigned long now = millis();
  if (now - lastDhtRecoveryAt < 15000) return;
  if (dhtTempValid || dhtHumValid) return;
  if ((now - tDhtLive) < 15000) return;

  lastDhtRecoveryAt = now;
  dht.begin();
  Serial.println("[RECOVER] DHT11 reinitialized");
}

void handleSerialCommands() {
  static String buffer;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      buffer += c;
      if (buffer.length() < 64) continue;
    }

    buffer.trim();
    if (buffer.startsWith("HAPTIC_INTENSITY")) {
      int value = buffer.substring(16).toInt();
      hapticMaxIntensity = (uint8_t)constrain(value, 0, 20);
      Serial.printf("[OK] Haptic max intensity set to %u\n", hapticMaxIntensity);
    } else if (buffer.startsWith("HAPTIC_MUTE")) {
      int value = buffer.substring(11).toInt();
      isMuted = value > 0;
      Serial.printf("[OK] Haptic mute set to %s\n", isMuted ? "true" : "false");
    }

    buffer = "";
  }
}

float readUS(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);

  long dur = pulseIn(echo, HIGH, US_TIMEOUT);
  if (dur == 0) return MAX_DIST;

  float spd = 331.4f + (0.6f * temperature);
  float d = (dur * spd) / 20000.0f;
  return constrain(d, 2.0f, MAX_DIST);
}

float med3(float a, float b, float c) {
  if (a > b) { float t = a; a = b; b = t; }
  if (b > c) { float t = b; b = c; c = t; }
  if (a > b) { float t = a; a = b; b = t; }
  return b;
}

void updateSensors() {
  unsigned long now = millis();

  switch (phase) {
    case P_LEFT:
      lBuf[bIdx] = readUS(TRIG_L, ECHO_L);
      pTimer = now;
      phase = P_WAIT_L;
      break;

    case P_WAIT_L:
      if (now - pTimer >= 25) phase = P_RIGHT;
      break;

    case P_RIGHT:
      rBuf[bIdx] = readUS(TRIG_R, ECHO_R);
      pTimer = now;
      phase = P_WAIT_R;
      break;

    case P_WAIT_R:
      if (now - pTimer >= 25) phase = P_FRONT;
      break;

    case P_FRONT:
      fBuf[bIdx] = readUS(TRIG_F, ECHO_F);
      pTimer = now;
      phase = P_WAIT_F;
      break;

    case P_WAIT_F:
      if (now - pTimer >= 10) phase = P_I2C;
      break;

    case P_I2C:
      if (tofOK) {
        VL53L0X_RangingMeasurementData_t measure;
        tof.rangingTest(&measure, false);
        tofRawMm = measure.RangeMilliMeter;

        if (measure.RangeStatus != 4 && tofRawMm >= 30 && tofRawMm < 4000) {
          centerDist = tofRawMm / 10.0f;
          tofValid = true;
          tTofLive = now;
        } else if (now - tTofLive > 1500) {
          tofValid = false;
          centerDist = MAX_DIST;
        }
      }

      if (imuOK) {
        sensors_event_t a, g, tmp;
        mpu.getEvent(&a, &g, &tmp);

        if (!isnan(a.acceleration.x) && !isnan(a.acceleration.y) && !isnan(a.acceleration.z)) {
          accelX = a.acceleration.x;
          accelY = a.acceleration.y;
          accelZ = a.acceleration.z;
          accelMag = sqrtf(accelX * accelX + accelY * accelY + accelZ * accelZ);
          pitchDeg = atan2f(accelX, sqrtf(accelY * accelY + accelZ * accelZ)) * 57.2958f;
          imuLive = true;
          tImuLive = now;
        }
      }

      if (now - tImuLive > 1500) {
        imuLive = false;
      }

      phase = P_DONE;
      break;

    case P_DONE:
      leftDist  = med3(lBuf[0], lBuf[1], lBuf[2]);
      rightDist = med3(rBuf[0], rBuf[1], rBuf[2]);
      frontDist = med3(fBuf[0], fBuf[1], fBuf[2]);
      bIdx = (bIdx + 1) % 3;
      phase = P_LEFT;
      break;
  }
}

void updateDHT() {
  unsigned long now = millis();
  if (now - tDHT < 2000) return;
  tDHT = now;

  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) && isnan(h)) {
    delay(20);
    t = dht.readTemperature();
    h = dht.readHumidity();
  }

  bool gotAny = false;
  if (!isnan(t)) {
    temperature = t;
    dhtTempValid = true;
    gotAny = true;
  }

  if (!isnan(h)) {
    humidity = h;
    dhtHumValid = true;
    gotAny = true;
  }

  if (gotAny) {
    tDhtLive = now;
  } else if (now - tDhtLive > 12000) {
    dhtTempValid = false;
    dhtHumValid = false;
  }
}

void checkFall() {
  unsigned long now = millis();

  if (!imuLive) {
    stairsDetected = false;
    roughSurface = false;
    if (fallDetected && (now - fallDetectedAt > 5000)) {
      fallDetected = false;
    }
    return;
  }

  accelMagLP = 0.90f * accelMagLP + 0.10f * accelMag;
  float dynamicAccel = accelMag - accelMagLP;

  // Step: detect rising dynamic-acceleration peaks with refractory time.
  if (dynamicAccel > 1.10f && (now - lastStepAt) > 280) {
    stepCount++;
    lastStepAt = now;
  }

  // Rough surface: persistent high vibration envelope.
  if (fabsf(dynamicAccel) > 1.70f) {
    roughDetectedAt = now;
  }
  roughSurface = (now - roughDetectedAt) < 1500;

  // Stairs: recent stepping with sustained body pitch and oscillation.
  if ((now - lastStepAt) < 800 && fabsf(pitchDeg) > 14.0f && fabsf(dynamicAccel) > 0.70f) {
    stairsDetectedAt = now;
  }
  stairsDetected = (now - stairsDetectedAt) < 1200;

  // Fall: free-fall followed by impact spike in a short window.
  if (accelMag < 3.0f) {
    fallArmed = true;
    fallArmedAt = now;
  }

  if (fallArmed && accelMag > 18.0f && (now - fallArmedAt) < 1200) {
    fallDetected = true;
    fallDetectedAt = now;
    fallArmed = false;
    Serial.println(">>> FALL DETECTED! <<<");
  }

  if (fallArmed && (now - fallArmedAt) > 1500) {
    fallArmed = false;
  }

  if (fallDetected && (now - fallDetectedAt > 5000)) {
    fallDetected = false;
  }
}

bool isGlass() {
  if (!tofValid) return false;
  return (centerDist > 300 && frontDist < 150 && (centerDist - frontDist) > 150);
}

void analyze() {
  float forwardRisk = getForwardRiskDistance();

  pkt.pattern = 0x00;
  pkt.intensity = 0;
  pkt.dangerLevel = 0;
  pkt.fallDetected = fallDetected ? 1 : 0;

  if (fallDetected || isGlass()) {
    pkt.pattern = 0x04;
    pkt.intensity = hapticMaxIntensity;
    pkt.dangerLevel = 3;
    return;
  }

  float minFwd = forwardRisk;
  float minAll = min(leftDist, min(rightDist, minFwd));

  uint8_t intensity = 0;
  if (minAll <= DANGER) {
    intensity = 20;
  } else if (minAll < CAUTION) {
    float t = (CAUTION - minAll) / (CAUTION - DANGER);
    intensity = (uint8_t)roundf(t * 20.0f);
  }

  if (intensity > hapticMaxIntensity) {
    intensity = hapticMaxIntensity;
  }

  if (leftDist < DANGER && rightDist < DANGER && minFwd < DANGER) {
    pkt.pattern = 0x04;
    pkt.intensity = hapticMaxIntensity;
    pkt.dangerLevel = 3;
  } else if (minFwd < DANGER) {
    pkt.pattern = 0x03;
    pkt.intensity = intensity;
    pkt.dangerLevel = 3;
  } else if (leftDist < rightDist && leftDist < CAUTION) {
    pkt.pattern = 0x01;
    pkt.intensity = intensity;
    pkt.dangerLevel = (leftDist < DANGER) ? 3 : (leftDist < WARNING) ? 2 : 1;
  } else if (rightDist < leftDist && rightDist < CAUTION) {
    pkt.pattern = 0x02;
    pkt.intensity = intensity;
    pkt.dangerLevel = (rightDist < DANGER) ? 3 : (rightDist < WARNING) ? 2 : 1;
  } else if (minFwd < CAUTION) {
    pkt.pattern = 0x03;
    pkt.intensity = intensity;
    pkt.dangerLevel = 1;
  }
}

void sendData() {
  unsigned long now = millis();
  if (now - tSend < 50) return;
  tSend = now;
  if (!espOK) return;

  float forwardRisk = getForwardRiskDistance();

  pkt.header = 0xAA;
  pkt.leftDist = (uint8_t)min(leftDist, 255.0f);
  pkt.centerDist = (uint8_t)min(forwardRisk, 255.0f);
  pkt.rightDist = (uint8_t)min(rightDist, 255.0f);
  pkt.frontDist = (uint8_t)min(frontDist, 255.0f);
  pkt.temp = (int8_t)temperature;
  pkt.muted = isMuted ? 1 : 0;
  pkt.stateSeq = lastMuteSeq;

  esp_now_send(leftWristMAC, (uint8_t*)&pkt, sizeof(pkt));
  esp_now_send(rightWristMAC, (uint8_t*)&pkt, sizeof(pkt));
}

void updateLED() {
  unsigned long now = millis();
  unsigned long interval = peerOK ? 2000 : 300;
  if (isMuted) interval = 5000;

  if (now - tLED >= interval) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    tLED = now;
  }
}

void printWebSerialFrame() {
  unsigned long now = millis();
  if (now - tWeb < 200) return;
  tWeb = now;

  float forwardRisk = getForwardRiskDistance();
  float tofRawCm = getTofRawCm();
  const bool tofLiveNow = tofOK && tofValid && (now - tTofLive <= 1500);
  const bool imuLiveNow = imuOK && imuLive && (now - tImuLive <= 1500);
  const bool dhtLiveNow = (dhtTempValid || dhtHumValid) && (now - tDhtLive <= 12000);
  const bool sosTriggered = (now - lastSosTriggerAt) <= SOS_ACTIVE_MS;

  Serial.printf(
    "SERIAL_FRAME {\"left\":%.1f,\"center\":%.1f,\"right\":%.1f,\"front\":%.1f,\"far\":%.1f,\"forwardRisk\":%.1f,\"tofRawMm\":%u,\"tofValid\":%s,\"imuLive\":%s,\"stairsDetected\":%s,\"roughSurface\":%s,\"stepCount\":%u,\"accelX\":%.2f,\"accelY\":%.2f,\"accelZ\":%.2f,\"accelMag\":%.2f,\"temperature\":%.1f,\"humidity\":%.1f,\"dhtLive\":%s,\"dhtTempValid\":%s,\"dhtHumValid\":%s,\"pattern\":%u,\"intensity\":%u,\"hapticMaxIntensity\":%u,\"dangerLevel\":%u,\"leftConnected\":%s,\"rightConnected\":%s,\"wristsConnected\":%s,\"fallDetected\":%s,\"sosTriggered\":%s}\n",
    leftDist,
    centerDist,
    rightDist,
    frontDist,
    tofRawCm,
    forwardRisk,
    tofRawMm,
    tofLiveNow ? "true" : "false",
    imuLiveNow ? "true" : "false",
    stairsDetected ? "true" : "false",
    roughSurface ? "true" : "false",
    (unsigned int)stepCount,
    accelX,
    accelY,
    accelZ,
    accelMag,
    temperature,
    humidity,
    dhtLiveNow ? "true" : "false",
    dhtTempValid ? "true" : "false",
    dhtHumValid ? "true" : "false",
    pkt.pattern,
    pkt.intensity,
    hapticMaxIntensity,
    pkt.dangerLevel,
    leftConnected ? "true" : "false",
    rightConnected ? "true" : "false",
    (leftConnected || rightConnected) ? "true" : "false",
    fallDetected ? "true" : "false",
    sosTriggered ? "true" : "false"
  );
}

void printInfo() {
  unsigned long now = millis();
  if (now - tPrint < 1000) return;
  tPrint = now;

  float forwardRisk = getForwardRiskDistance();
  float tofRawCm = getTofRawCm();
  const bool tofLiveNow = tofOK && tofValid && (now - tTofLive <= 1500);
  const bool imuLiveNow = imuOK && imuLive && (now - tImuLive <= 1500);
  const bool dhtLiveNow = (dhtTempValid || dhtHumValid) && (now - tDhtLive <= 12000);

  if (isMuted) {
    Serial.println("  [ SYSTEM MUTED - STANDBY MODE ]");
    return;
  }

  Serial.println("------------------------------------------");
  Serial.printf("  LEFT:   %6.1fcm %s\n", leftDist,
    leftDist < 50 ? "DANGER!" : leftDist < 100 ? "WARNING" : leftDist < 200 ? "Caution" : "Clear");
  if (tofLiveNow) {
    Serial.printf("  TOF:    %6.1fcm %s (raw=%umm)\n", centerDist,
      centerDist < 50 ? "WARNING" : centerDist < 150 ? "CLEAR" : centerDist < 200 ? "CAUTION" : "CLEAR",
      tofRawMm);
  } else {
    Serial.printf("  TOF:    INVALID/STALE (raw=%umm, far=%.1fcm)\n", tofRawMm, tofRawCm);
  }
  Serial.printf("  RIGHT:  %6.1fcm %s\n", rightDist,
    rightDist < 50 ? "DANGER!" : rightDist < 100 ? "WARNING" : rightDist < 200 ? "Caution" : "Clear");
  Serial.printf("  FRONT:  %6.1fcm %s (US)\n", frontDist,
    frontDist < 50 ? "DANGER!" : frontDist < 100 ? "WARNING" : frontDist < 200 ? "Caution" : "Clear");
  Serial.printf("  FWD:    %6.1fcm %s (risk distance)\n", forwardRisk,
    forwardRisk < 50 ? "DANGER!" : forwardRisk < 100 ? "WARNING" : forwardRisk < 200 ? "Caution" : "Clear");
  Serial.printf("  IMU:    %s | ax=%5.2f ay=%5.2f az=%5.2f | |a|=%5.2f | stairs=%s rough=%s steps=%u\n",
    imuLiveNow ? "LIVE" : "STALE",
    accelX,
    accelY,
    accelZ,
    accelMag,
    stairsDetected ? "yes" : "no",
    roughSurface ? "yes" : "no",
    (unsigned int)stepCount);
  Serial.printf("  DHT11:  %s | Temp=%4.1fC Hum=%4.1f%% (T=%s H=%s)\n",
    dhtLiveNow ? "LIVE" : "STALE",
    temperature,
    humidity,
    dhtTempValid ? "ok" : "bad",
    dhtHumValid ? "ok" : "bad");

  if (isGlass()) Serial.println("  >>> GLASS DETECTED! <<<");
  if (fallDetected) Serial.println("  >>> FALL DETECTED! <<<");

  Serial.printf("  Haptic Max Intensity: %u\n", hapticMaxIntensity);
  Serial.printf("  Haptic: P=0x%02X I=%d | Danger:%d\n", pkt.pattern, pkt.intensity, pkt.dangerLevel);
  Serial.printf("  Wrists: left=%s right=%s\n",
    leftConnected ? "Connected" : "Disconnected",
    rightConnected ? "Connected" : "Disconnected");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n============================================");
  Serial.println("  BLINDGUARD CHEST BOX (Web Serial ready)");
  Serial.println("============================================");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  int trigs[] = {TRIG_L, TRIG_R, TRIG_F};
  int echos[] = {ECHO_L, ECHO_R, ECHO_F};
  for (int i = 0; i < 3; i++) {
    pinMode(trigs[i], OUTPUT);
    pinMode(echos[i], INPUT);
    digitalWrite(trigs[i], LOW);
  }
  Serial.println("[OK] HC-SR04 x3");

  Wire.begin(SDA_PIN, SCL_PIN);

  Serial.print("[..] VL53L0X...");
  if (tof.begin()) {
    tofOK = true;
    Serial.println(" OK!");
  } else {
    Serial.println(" FAIL!");
  }

  Serial.print("[..] MPU6050...");
  if (mpu.begin()) {
    mpu.setAccelerometerRange(MPU6050_RANGE_16_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    imuOK = true;
    Serial.println(" OK!");
  } else {
    Serial.println(" FAIL!");
  }

  dht.begin();
  Serial.println("[OK] DHT11");

  setupWifiHttpApi();

  Serial.print("[INFO] Chest MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.printf("[INFO] Wi-Fi channel: %d\n", WiFi.channel());

  if (esp_now_init() == ESP_OK) {
    esp_now_register_send_cb(onSent);
    esp_now_register_recv_cb(onRecv);

    esp_now_peer_info_t peer1 = {};
    memcpy(peer1.peer_addr, leftWristMAC, 6);
    peer1.channel = 0;
    peer1.encrypt = false;
    if (esp_now_add_peer(&peer1) == ESP_OK) {
      Serial.println("[OK] Left wrist peer added");
    }

    esp_now_peer_info_t peer2 = {};
    memcpy(peer2.peer_addr, rightWristMAC, 6);
    peer2.channel = 0;
    peer2.encrypt = false;
    if (esp_now_add_peer(&peer2) == ESP_OK) {
      Serial.println("[OK] Right wrist peer added");
    }

    espOK = true;
  } else {
    Serial.println("ESP-NOW Init FAIL!");
  }

  Serial.println("============================================\n");
  digitalWrite(LED_PIN, LOW);
}

void loop() {
  handleSerialCommands();
  webServer.handleClient();

  updateWristPresence();

  updateSensors();
  updateDHT();
  recoverImuIfNeeded();
  recoverDhtIfNeeded();

  if (!isMuted) {
    checkFall();
    analyze();
  } else {
    pkt.pattern = 0x00;
    pkt.intensity = 0;
    pkt.dangerLevel = 0;
    pkt.fallDetected = 0;
  }

  sendData();

  updateLED();
  ensureWifiConnected();
  webServer.handleClient();
  printWebSerialFrame();
  printInfo();
  yield();
}
