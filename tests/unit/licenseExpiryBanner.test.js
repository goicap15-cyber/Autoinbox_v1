const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bannerPath = path.join(__dirname, '../../src/client/components/LicenseExpiryBanner.jsx');
const appPath = path.join(__dirname, '../../src/client/App.jsx');

test('license expiry banner warns exactly when 1..5 days remain', () => {
  const content = fs.readFileSync(bannerPath, 'utf8');
  assert.match(content, /export const LICENSE_EXPIRY_WARN_DAYS = 5/);
  assert.match(content, /daysLeft < 1 \|\| daysLeft > LICENSE_EXPIRY_WARN_DAYS/);
  assert.match(content, /return null;/);
});

test('banner computes remaining days from expiresAt with ceil and formats it vi-VN', () => {
  const content = fs.readFileSync(bannerPath, 'utf8');
  assert.match(content, /Math\.ceil\(\(expiresAtMs - now\) \/ 86400000\)/);
  assert.match(content, /Number\.isFinite\(expiresAtMs\)/);
  assert.match(content, /toLocaleDateString\('vi-VN'/);
});

test('marquee runs 18s linear, pauses on hover, respects reduced motion', () => {
  const content = fs.readFileSync(bannerPath, 'utf8');
  assert.match(content, /animation: license-expiry-marquee 18s linear infinite/);
  assert.match(content, /animation-play-state: paused/);
  assert.match(content, /@media \(prefers-reduced-motion: reduce\)/);
});

test('banner sits below modals (z-40) and above the app chrome', () => {
  const content = fs.readFileSync(bannerPath, 'utf8');
  assert.match(content, /z-index: 40;/);
  assert.match(content, /position: fixed;/);
  assert.match(content, /height: 28px;/);
  assert.match(content, /background: #DC2626;/);
});

test('app mounts banner only when licensed and reopens payment on click', () => {
  const content = fs.readFileSync(appPath, 'utf8');
  assert.match(content, /licenseStatus\?\.isLicensed \? computeLicenseDaysLeft\(licenseStatus\.expiresAt\) : null/);
  assert.match(content, /formatLicenseExpiryDate\(licenseStatus\?\.expiresAt\)/);
  assert.match(content, /licenseBannerDismissed/);
  assert.match(content, /onOpenPayment=\{\(\) => setActiveModal\('payment'\)\}/);
});

test('preview override never ships in production builds', () => {
  const content = fs.readFileSync(appPath, 'utf8');
  assert.match(content, /import\.meta\.env\.DEV/);
  assert.match(content, /_licensePreviewDays/);
});

test('dismiss is session-scoped (plain state, no persistence)', () => {
  const content = fs.readFileSync(appPath, 'utf8');
  assert.doesNotMatch(content, /licenseBannerDismissed.*localStorage|localStorage.*licenseBannerDismissed/);
});
