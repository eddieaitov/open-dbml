#!/usr/bin/env node
/**
 * make-dmg.js — создаёт DMG-образ из собранного .app
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'release', 'Open DBML-darwin-arm64');
const APP_BUNDLE = path.join(APP_DIR, 'Open DBML.app');
const DMG_NAME = 'Open-DBML-1.0.0-arm64.dmg';
const DMG_OUT = path.join(ROOT, 'release', DMG_NAME);
const STAGING = path.join(ROOT, 'release', '_dmg-staging');

if (!fs.existsSync(APP_BUNDLE)) {
  console.error('❌ .app not found. Run "npm run build" first.');
  process.exit(1);
}

// Clean staging
if (fs.existsSync(STAGING)) fs.rmSync(STAGING, { recursive: true });
fs.mkdirSync(STAGING, { recursive: true });

// Copy .app into staging
console.log('  Copying app bundle...');
execSync(`cp -R "${APP_BUNDLE}" "${STAGING}/Open DBML.app"`, { cwd: ROOT });

// Symlink to /Applications
const appLink = path.join(STAGING, 'Applications');
fs.symlinkSync('/Applications', appLink);

// Remove old DMG
if (fs.existsSync(DMG_OUT)) fs.unlinkSync(DMG_OUT);

// Create DMG
console.log('  Creating DMG...');
execSync(
  `hdiutil create -volname "Open DBML" -srcfolder "${STAGING}" -ov -format UDZO "${DMG_OUT}"`,
  { cwd: ROOT, stdio: 'inherit' }
);

// Clean up
fs.rmSync(STAGING, { recursive: true });

const size = (fs.statSync(DMG_OUT).size / 1024 / 1024).toFixed(0);
console.log(`\n  ✅ ${DMG_NAME} (${size} MB)`);
console.log(`  📁 ${DMG_OUT}\n`);
