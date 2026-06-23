// LEFT HAND WRIST - ESP32 DEVKIT
// Components: 2N2222A + coin motor + 1k resistor + tactile switch
// ESP-NOW receiver + mute toggle sender

#include <WiFi.h>
#include <esp_now.h>

// Set this to your chest ESP32 MAC address
uint8_t CHEST_MAC[] = {0xEC, 0x64, 0xC9, 0x91, 0x09, 0x60};

// Optional: connect to same Wi-Fi as chest to lock ESP-NOW channel
#define WIFI_STA_SSID     "nick"
#define WIFI_STA_PASSWORD "12345678"

// Pins
#define MOTOR_PIN   25
#define SWITCH_PIN  27

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
volatile uint16_t lastStateSeq = 0;
volatile uint8_t latestPattern = 0;
volatile uint8_t latestIntensity = 0;
volatile unsigned long lastRxAt = 0;

uint16_t pendingSeq = 0;
bool pendingToggle = false;
unsigned long pendingAt = 0;
uint8_t pendingRetries = 0;
bool buttonPressActive = false;
unsigned long buttonPressedAt = 0;
bool sosSentForCurrentHold = false;
bool pulseHigh = false;
unsigned long pulsePhaseAt = 0;
uint8_t pulseIntensity = 0;
uint8_t pulseDuty = 0;

// Debounce
bool lastButtonState = true;
unsigned long lastButtonChange = 0;

const unsigned long BUTTON_DEBOUNCE_MS = 45;
const unsigned long RX_TIMEOUT_MS = 800;
const unsigned long TOGGLE_RETRY_MS = 600;
const uint8_t MAX_TOGGLE_RETRIES = 3;
const unsigned long SOS_HOLD_MS = 5000;

static uint8_t intensityToDuty(uint8_t intensity) {
  static const uint8_t dutyTable[21] = {
    0, 26, 34, 42, 50, 60, 72, 84, 96, 110, 124,
    138, 152, 166, 180, 194, 208, 222, 234, 245, 255
  };
  if (intensity > 20) intensity = 20;
  return dutyTable[intensity];
}

static uint16_t intensityToOnMs(uint8_t intensity) {
  if (intensity == 0) return 0;
  if (intensity > 20) intensity = 20;
  return (uint16_t)(18 + (uint16_t)intensity * 6U);
}

static uint16_t intensityToOffMs(uint8_t intensity) {
  if (intensity == 0) return 0;
  if (intensity > 20) intensity = 20;
  return (uint16_t)(360 - (uint16_t)intensity * 14U);
}

static bool patternApplies(uint8_t pattern) {
  // 0x01 = left, 0x03 = front, 0x04 = danger
  return (pattern == 0x01 || pattern == 0x03 || pattern == 0x04);
}

static void setMotorDuty(uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(MOTOR_PIN, duty);
#else
  ledcWrite(0, duty);
#endif
}

static void resetMotorPulse() {
  pulseHigh = false;
  pulsePhaseAt = millis();
  pulseIntensity = 0;
  pulseDuty = 0;
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
    setMotorDuty(pulseDuty);
    return;
  }

  const unsigned long phaseElapsed = now - pulsePhaseAt;
  const uint16_t onMs = intensityToOnMs(intensity);
  const uint16_t offMs = intensityToOffMs(intensity);

  if (pulseHigh) {
    if (phaseElapsed >= onMs) {
      pulseHigh = false;
      pulsePhaseAt = now;
      setMotorDuty(0);
    }
  } else if (phaseElapsed >= offMs) {
    pulseHigh = true;
    pulsePhaseAt = now;
    setMotorDuty(pulseDuty);
  }
}

static void sendToggleRequest(uint8_t desiredMute, uint16_t seq) {
  uint8_t payload[4];
  payload[0] = 0xBB;
  payload[1] = desiredMute;
  payload[2] = (uint8_t)(seq & 0xFF);
  payload[3] = (uint8_t)((seq >> 8) & 0xFF);
  esp_now_send(CHEST_MAC, payload, sizeof(payload));
}

static void sendSosTrigger() {
  // ESP-NOW SOS trigger
  uint8_t payload[2];
  payload[0] = 0xBD;
  payload[1] = 1; // left source
  esp_now_send(CHEST_MAC, payload, sizeof(payload));
  Serial.println("[SOS] Left tactile SOS sent via ESP-NOW");
}

void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int data_len) {
  (void)info;
  if (data_len < (int)sizeof(Packet)) return;
  if (data[0] != 0xAA) return;

  Packet pkt;
  memcpy(&pkt, data, sizeof(Packet));

  latestPattern = pkt.pattern;
  latestIntensity = pkt.intensity;
  muted = pkt.muted != 0;
  lastStateSeq = pkt.stateSeq;
  lastRxAt = millis();

  if (pendingToggle && lastStateSeq == pendingSeq) {
    pendingToggle = false;
    pendingRetries = 0;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(SWITCH_PIN, INPUT_PULLUP);

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(MOTOR_PIN, 180, 8);
#else
  ledcSetup(0, 180, 8);
  ledcAttachPin(MOTOR_PIN, 0);
#endif
  resetMotorPulse();

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  delay(100);

  if (strlen(WIFI_STA_SSID) > 0) {
    WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - start) < 5000) {
      delay(100);
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[OK] Left Wi-Fi connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WARN] Left Wi-Fi lock failed; ESP-NOW will use default channel");
  }

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    return;
  }

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, CHEST_MAC, 6);
  peer.channel = 0;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  esp_now_register_recv_cb(onRecv);
  Serial.println("Left hand ready");
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

  bool buttonState = digitalRead(SWITCH_PIN) == LOW;
  if (buttonState != lastButtonState && (now - lastButtonChange) > BUTTON_DEBOUNCE_MS) {
    lastButtonState = buttonState;
    lastButtonChange = now;

    if (buttonState) {
      buttonPressActive = true;
      buttonPressedAt = now;
      sosSentForCurrentHold = false;
    } else {
      const unsigned long heldMs = buttonPressActive ? (now - buttonPressedAt) : 0;
      buttonPressActive = false;

      // Short press keeps legacy mute toggle. Long hold triggers SOS.
      if (heldMs < SOS_HOLD_MS && !sosSentForCurrentHold) {
        uint8_t desiredMute = mutedSnapshot ? 0 : 1;
        pendingSeq += 1;
        pendingToggle = true;
        pendingAt = now;
        pendingRetries = 0;
        sendToggleRequest(desiredMute, pendingSeq);
        resetMotorPulse();
      }
    }
  }

  if (buttonPressActive && !sosSentForCurrentHold && (now - buttonPressedAt) >= SOS_HOLD_MS) {
    sendSosTrigger();
    sosSentForCurrentHold = true;
    resetMotorPulse();
  }

  if (pendingToggle && (now - pendingAt) > TOGGLE_RETRY_MS && pendingRetries < MAX_TOGGLE_RETRIES) {
    uint8_t desiredMute = mutedSnapshot ? 0 : 1;
    sendToggleRequest(desiredMute, pendingSeq);
    pendingAt = now;
    pendingRetries += 1;
  }

  const bool rxFresh = (now - lastRxSnapshot) < RX_TIMEOUT_MS;
  if (!rxFresh || mutedSnapshot) {
    resetMotorPulse();
    return;
  }

  if (!patternApplies(patternSnapshot)) {
    resetMotorPulse();
    return;
  }

  const uint8_t clamped = intensitySnapshot > 20 ? 20 : intensitySnapshot;
  applyMotorPulse(clamped, now);
}
