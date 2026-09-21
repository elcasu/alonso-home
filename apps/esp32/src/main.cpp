#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "config.h"

WiFiClient wifi;
PubSubClient mqtt(wifi);

int relayOnLevel() { return RELAY_ACTIVE_LOW ? LOW : HIGH; }
int relayOffLevel() { return RELAY_ACTIVE_LOW ? HIGH : LOW; }

void publishState(int channel, bool on) {
  char topic[64];
  snprintf(topic, sizeof(topic), "home/%s/state", DEVICE_ID);
  char payload[48];
  snprintf(payload, sizeof(payload), "{\"channel\":%d,\"on\":%s}", channel, on ? "true" : "false");
  mqtt.publish(topic, payload, false);
}

void applyChannel(int channel, bool on) {
  int idx = channel - 1;
  if (idx < 0 || idx >= RELAY_COUNT) return;
  digitalWrite(RELAY_PINS[idx], on ? relayOnLevel() : relayOffLevel());
  publishState(channel, on);
}

bool extractBool(const char *json, const char *key, bool fallback) {
  String needle = String("\"") + key + "\":";
  const char *found = strstr(json, needle.c_str());
  if (!found) return fallback;
  found += needle.length();
  while (*found == ' ') found++;
  return found[0] == 't' || found[0] == '1';
}

int extractInt(const char *json, const char *key, int fallback) {
  String needle = String("\"") + key + "\":";
  const char *found = strstr(json, needle.c_str());
  if (!found) return fallback;
  return atoi(found + needle.length());
}

void onMessage(char *topic, byte *payload, unsigned int length) {
  char json[192];
  unsigned int n = length < sizeof(json) - 1 ? length : sizeof(json) - 1;
  memcpy(json, payload, n);
  json[n] = 0;
  int channel = extractInt(json, "channel", 1);
  bool on = extractBool(json, "on", false);
  applyChannel(channel, on);
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
  }
}

void ensureMqtt() {
  if (mqtt.connected()) return;
  char topic[64];
  snprintf(topic, sizeof(topic), "home/%s/set", DEVICE_ID);
  if (mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASSWORD)) {
    mqtt.subscribe(topic, 1);
    for (int i = 0; i < RELAY_COUNT; i++) {
      publishState(i + 1, false);
    }
  }
}

void setup() {
  for (int i = 0; i < RELAY_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], relayOffLevel());
  }
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  ensureWifi();
  ensureMqtt();
}

void loop() {
  ensureWifi();
  if (WiFi.status() == WL_CONNECTED) {
    ensureMqtt();
    mqtt.loop();
  }
  delay(20);
}
