// RIGHT HAND WRIST - NodeMCU v3 (ESP8266MOD)
// Components: 2N2222A + coin motor + 1k resistor
// ESP-NOW receiver (no heartbeat traffic)

#include <ESP8266WiFi.h>
extern "C" {
  #include <espnow.h>
  #include <user_interface.h>
}

// Set this to your chest ESP32 MAC address
uint8_t CHEST_MAC[] = {0xEC, 0x64, 0xC9, 0x91, 0x09, 0x60};

// WiFi used only to lock RF channel with chest hotspot
#define WIFI_STA_SSID     "nick"
#define WIFI_STA_PASSWORD "12345678"
#define DEFAULT_CHANNEL    1

// Pins (NodeMCU labels)
#define MOTOR_PIN D5

// ESP-NOW packet from chest
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

volatile bool muted = false;
volatile uint8_t latestPattern = 0;
volatile uint8_t latestIntensity = 0;
volatile unsigned long lastRxAt = 0;
unsigned long lastStatusAt = 0;
uint8_t espNowChannel = DEFAULT_CHANNEL;
uint32_t recvCount = 0;
uint8_t lastPacketPattern = 0;
uint8_t lastPacketIntensity = 0;
bool lastRxFreshState = false;
bool pulseHigh = false;
unsigned long pulsePhaseAt = 0;
uint8_t pulseIntensity = 0;
uint8_t pulseDuty = 0;
bool pulseKickActive = false;
unsigned long pulseKickUntil = 0;

const unsigned long RX_TIMEOUT_MS = 800;
const unsigned long STATUS_LOG_MS = 2000;

static uint8_t intensityToDuty(uint8_t intensity) {
  static const uint8_t dutyTable[21] = {
    0, 120, 126, 132, 138, 144, 150, 158, 166, 174, 182,
    190, 198, 206, 214, 222, 230, 238, 244, 250, 255
  };
  if (intensity > 20) intensity = 20;
  return dutyTable[intensity];
}

static uint16_t intensityToOnMs(uint8_t intensity) {
  if (intensity == 0) return 0;
  if (intensity > 20) intensity = 20;
  return (uint16_t)(70 + (uint16_t)intensity * 8U);
}

static uint16_t intensityToOffMs(uint8_t intensity) {
  if (intensity == 0) return 0;
  if (intensity > 20) intensity = 20;
  return (uint16_t)(190 - (uint16_t)intensity * 7U);
}

static bool patternApplies(uint8_t pattern) {
  // 0x02 = right, 0x03 = front, 0x04 = danger
  return (pattern == 0x02 || pattern == 0x03 || pattern == 0x04);
}

static void setMotorDuty(uint8_t duty) {
  analogWrite(MOTOR_PIN, duty);
}

static void resetMotorPulse() {
  pulseHigh = false;
  pulsePhaseAt = millis();
  pulseIntensity = 0;
  pulseDuty = 0;
  pulseKickActive = false;
  pulseKickUntil = 0;
  setMotorDuty(0);
}

static void applyMotorPulse(uint8_t intensity, unsigned long now) {
  if (intensity == 0) {
    resetMotorPulse();
    return;
  }

  if (intensity != pulseIntensity) {
    pulseIntensity = intensity;
    pulseDuty = intensityToDuty(intensity);
    pulseHigh = true;
    pulsePhaseAt = now;
    pulseKickActive = true;
    pulseKickUntil = now + 85;
    setMotorDuty(255);
    return;
  }

  const unsigned long phaseElapsed = now - pulsePhaseAt;
  const uint16_t onMs = intensityToOnMs(intensity);
  const uint16_t offMs = intensityToOffMs(intensity);

  if (pulseHigh) {
    if (pulseKickActive) {
      if (now < pulseKickUntil) {
        setMotorDuty(255);
      } else {
        pulseKickActive = false;
        setMotorDuty(pulseDuty);
      }
    }
    if (phaseElapsed >= onMs) {
      pulseHigh = false;
      pulsePhaseAt = now;
      pulseKickActive = false;
      setMotorDuty(0);
    }
  } else if (phaseElapsed >= offMs) {
    pulseHigh = true;
    pulsePhaseAt = now;
    pulseKickActive = true;
    pulseKickUntil = now + 85;
    setMotorDuty(255);
  }
}

static void logStatus(const char *tag) {
  Serial.printf(
    "[%s] ch=%u rxAge=%lums rxCount=%lu pattern=0x%02X intensity=%u\n",
    tag,
    espNowChannel,
    millis() - lastRxAt,
    (unsigned long)recvCount,
    lastPacketPattern,
    lastPacketIntensity
  );
}

void onRecv(uint8_t *mac, uint8_t *data, uint8_t len) {
  (void)mac;
  if (len < sizeof(Packet)) {
    Serial.printf("[WARN] Short packet received: len=%u\n", len);
    return;
  }
  if (data[0] != 0xAA) {
    Serial.printf("[WARN] Invalid packet header: 0x%02X\n", data[0]);
    return;
  }

  Packet pkt;
  memcpy(&pkt, data, sizeof(Packet));

  latestPattern = pkt.pattern;
  latestIntensity = pkt.intensity;
  muted = pkt.muted != 0;
  lastRxAt = millis();
  recvCount++;

  const bool changed = (lastPacketPattern != pkt.pattern) || (lastPacketIntensity != pkt.intensity);
  lastPacketPattern = pkt.pattern;
  lastPacketIntensity = pkt.intensity;

  if (changed) {
    Serial.printf(
      "[RX] pattern=0x%02X intensity=%u danger=%u muted=%u dist(L/C/R/F)=%u/%u/%u/%u\n",
      pkt.pattern,
      pkt.intensity,
      pkt.dangerLevel,
      pkt.muted,
      pkt.leftDist,
      pkt.centerDist,
      pkt.rightDist,
      pkt.frontDist
    );
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(MOTOR_PIN, OUTPUT);
  analogWriteRange(255);
  analogWriteFreq(180);
  resetMotorPulse();

  // Keep channel aligned with chest by joining same hotspot.
  Serial.printf("[INFO] Locking to hotspot SSID: %s\n", WIFI_STA_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);
  
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - wifiStart) < 10000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[OK] WiFi connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WARN] WiFi lock failed, using default ESP-NOW channel");
  }

  if (strlen(WIFI_STA_SSID) > 0) {
    espNowChannel = WiFi.channel();
    if (espNowChannel > 0) {
      Serial.printf("[OK] ESP-NOW channel locked to %u (WiFi channel)\n", espNowChannel);
    }
  }

  Serial.printf("[INFO] Right MAC: %s\n", WiFi.macAddress().c_str());

  // Initialize ESP-NOW for receiving sensor data only
  if (esp_now_init() != 0) {
    Serial.println("ESP-NOW init failed");
    return;
  }

  esp_now_set_self_role(ESP_NOW_ROLE_CONTROLLER);
  
  // Register chest peer for receiving sensor packets
  Serial.printf("[DEBUG] Registering peer MAC for RX: %02X:%02X:%02X:%02X:%02X:%02X on channel %u\n",
    CHEST_MAC[0], CHEST_MAC[1], CHEST_MAC[2], CHEST_MAC[3], CHEST_MAC[4], CHEST_MAC[5],
    espNowChannel);
  
  int peerResult = esp_now_add_peer(CHEST_MAC, ESP_NOW_ROLE_CONTROLLER, espNowChannel, NULL, 0);
  if (peerResult != 0) {
    Serial.printf("[WARN] Add peer failed: %d\n", peerResult);
  } else {
    Serial.println("[OK] Peer registered for RX");
  }
  
  esp_now_register_recv_cb(onRecv);
  
  delay(500);
  
  Serial.println("Right hand ready: ESP-NOW RX");
  logStatus("BOOT");
}

void loop() {
  const unsigned long now = millis();
  uint8_t patternSnapshot = 0;
  uint8_t intensitySnapshot = 0;
  bool mutedSnapshot = false;
  unsigned long lastRxSnapshot = 0;
  noInterrupts();
  patternSnapshot = latestPattern;
  intensitySnapshot = latestIntensity;
  mutedSnapshot = muted;
  lastRxSnapshot = lastRxAt;
  interrupts();

  const bool rxFresh = (now - lastRxSnapshot) < RX_TIMEOUT_MS;

  if (rxFresh != lastRxFreshState) {
    lastRxFreshState = rxFresh;
    Serial.printf("[INFO] RX stream is now %s\n", rxFresh ? "fresh" : "stale");
  }

  if (!rxFresh || mutedSnapshot) {
    if (!rxFresh && (now - lastStatusAt) > STATUS_LOG_MS) {
      Serial.printf("[WARN] RX stale for %lums\n", now - lastRxSnapshot);
      logStatus("STALE");
      lastStatusAt = now;
    }
    resetMotorPulse();
    return;
  }

  if (!patternApplies(patternSnapshot)) {
    if ((now - lastStatusAt) > STATUS_LOG_MS) {
      Serial.printf("[IDLE] Pattern 0x%02X ignored on right wrist\n", patternSnapshot);
      logStatus("IDLE");
      lastStatusAt = now;
    }
    resetMotorPulse();
    return;
  }

  const uint8_t clamped = intensitySnapshot > 20 ? 20 : intensitySnapshot;
  applyMotorPulse(clamped, now);

  if ((now - lastStatusAt) > STATUS_LOG_MS) {
    Serial.printf("[OK] Applying pulse duty=%u intensity=%u pattern=0x%02X on=%ums off=%ums\n",
      pulseDuty, clamped, patternSnapshot, intensityToOnMs(clamped), intensityToOffMs(clamped));
    logStatus("ACTIVE");
    lastStatusAt = now;
  }
}
