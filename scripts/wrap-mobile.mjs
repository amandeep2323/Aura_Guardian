import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const openAndroid = args.has('--open-android');

const run = (command) => {
  execSync(command, {
    stdio: 'inherit',
  });
};

const runSafe = (command) => {
  try {
    run(command);
    return true;
  } catch {
    return false;
  }
};

run('npm run build');

const androidProjectPath = resolve('android');
if (!existsSync(androidProjectPath)) {
  runSafe('npx cap add android');
}

run('npx cap sync android');

if (openAndroid) {
  run('npx cap open android');
}
