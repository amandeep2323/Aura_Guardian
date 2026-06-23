import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const release = args.has('--release');
const gradleTask = release ? 'assembleRelease' : 'assembleDebug';

const run = (command, cwd = process.cwd()) => {
  execSync(command, {
    cwd,
    stdio: 'inherit',
  });
};

const getJavaMajorVersion = () => {
  try {
    const raw = execSync('java -version 2>&1').toString();
    const majorMatch = raw.match(/version\s+"(\d+)(?:\.(\d+))?/i);
    if (!majorMatch) return null;

    const major = Number(majorMatch[1]);
    const legacyMinor = Number(majorMatch[2] ?? 0);
    if (!Number.isFinite(major)) return null;

    if (major === 1 && Number.isFinite(legacyMinor) && legacyMinor > 0) {
      return legacyMinor;
    }

    return major;
  } catch {
    return null;
  }
};

const javaMajor = getJavaMajorVersion();
if (javaMajor === null) {
  throw new Error('Java not found. Install JDK 21 and set JAVA_HOME to build Android APK.');
}

if (javaMajor < 21) {
  throw new Error(`JDK 21 required for Capacitor 7 Android build. Detected Java ${javaMajor}. Install JDK 21 and set JAVA_HOME.`);
}

run('node scripts/wrap-mobile.mjs');

const androidDir = resolve('android');
if (!existsSync(androidDir)) {
  throw new Error('Android project not found. Run npm run mobile:wrap first.');
}

const gradleWrapperBat = resolve(androidDir, 'gradlew.bat');
const gradleWrapperSh = resolve(androidDir, 'gradlew');

if (existsSync(gradleWrapperBat)) {
  run('gradlew.bat ' + gradleTask, androidDir);
} else if (existsSync(gradleWrapperSh)) {
  run('./gradlew ' + gradleTask, androidDir);
} else {
  throw new Error('Gradle wrapper not found in android directory.');
}

const apkPath = release
  ? resolve('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
  : resolve('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

console.log('APK build complete:', apkPath);
