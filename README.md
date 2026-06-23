# Aura Guardian

Aura Guardian is a React + Vite safety and monitoring app for connecting AuraGuard ESP32 wearable devices, sharing alerts with guardians, and supporting Android navigation through Capacitor.

## Features

- User and guardian modes with Firebase authentication.
- Live ESP32 device status and sensor monitoring.
- Fall, geofence, SOS, and device connection alerts.
- Guardian push notifications through Firebase Cloud Messaging.
- Android app wrapper with native Mapbox walking navigation.
- Firebase Realtime Database rules and Cloud Functions for alert delivery.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Firebase Auth, Realtime Database, Messaging, and Functions
- Capacitor Android
- Mapbox Navigation SDK

## Getting Started

Install dependencies:

```bash
npm install
```

Start the web app:

```bash
npm run dev
```

Build the web app:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Environment And Secrets

API keys, tokens, signing files, and local config files must stay out of git. The `.gitignore` is configured to ignore common secret-bearing files, including `.env*`, Android Gradle properties, signing keys, Firebase service account files, and current Firebase config files that contain keys.

Create local environment files as needed, for example:

```env
VITE_ESP32_HOST=esp32.local
VITE_MAPMYINDIA_MAP_KEY=your_mapmyindia_key
VITE_FIREBASE_VAPID_KEY=your_firebase_vapid_key
```

For Android Mapbox setup, keep tokens in `android/gradle.properties` locally:

```properties
MAPBOX_DOWNLOADS_TOKEN=your_secret_downloads_token
MAPBOX_ACCESS_TOKEN=your_public_runtime_token
```

Do not commit real API keys, Firebase config containing live keys, service account JSON files, keystores, or generated local build artifacts.

## Firebase

Deploy Realtime Database rules:

```bash
npm run firebase:rules
```

Deploy Cloud Functions:

```bash
npm run firebase:functions
```

Functions live in `functions/` and send guardian push alerts when alert records are created in the database.

## Android

Prepare the Capacitor Android wrapper:

```bash
npm run mobile:wrap
```

Open the Android project:

```bash
npm run mobile:android
```

Build a debug APK:

```bash
npm run mobile:apk
```

Build a release APK:

```bash
npm run mobile:apk:release
```

The Android build script requires JDK 21.

## Project Structure

```text
src/          React app source
public/       Static web assets and service worker
functions/    Firebase Cloud Functions
android/      Capacitor Android project
scripts/      Mobile wrapping and APK build scripts
```

## Notes

- Keep the phone and ESP32 devices on the same Wi-Fi network.
- ESP32 device names are expected to include `AuraGuard`.
- Native Mapbox navigation is available only inside the Android build.
