const fs = require('fs');
const path = require('path');
const url = require('url');

function isPackaged() {
  try {
    const electron = require('electron');
    if (electron && electron.app && electron.app.isPackaged) return true;
  } catch (_) {}
  try {
    if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'app.asar'))) {
      return true;
    }
  } catch (_) {}
  return false;
}

const REPO_ROOT = path.join(__dirname, '../../..');

function resolveExtensionPath() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'hot-update', 'dist', 'extension'));
    candidates.push(path.join(process.resourcesPath, 'extension'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'extension'));
  }
  candidates.push(path.join(REPO_ROOT, 'dist', 'extension'));
  candidates.push(path.join(REPO_ROOT, 'src', 'extension'));

  for (const dir of candidates) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'manifest.json'))) {
        return path.resolve(dir);
      }
    } catch (_) {}
  }

  return path.resolve(
    isPackaged() && process.resourcesPath
      ? path.join(process.resourcesPath, 'extension')
      : path.join(REPO_ROOT, 'src', 'extension')
  );
}

function resolveBinRoot() {
  if (process.resourcesPath) {
    const resWinChrome = path.join(process.resourcesPath, 'bin', 'chrome-win', 'chrome.exe');
    if (fs.existsSync(resWinChrome)) return process.resourcesPath;
  }
  const parentRes = path.resolve(REPO_ROOT, '..');
  if (fs.existsSync(path.join(parentRes, 'bin', 'chrome-win', 'chrome.exe'))) {
    return parentRes;
  }
  return isPackaged() && process.resourcesPath ? process.resourcesPath : REPO_ROOT;
}

function ensureVendorModulesForAsar() {
  try {
    const resRoot = process.resourcesPath
      || (fs.existsSync(path.resolve(REPO_ROOT, '..', 'app.asar')) ? path.resolve(REPO_ROOT, '..') : null);
    if (!resRoot) return;
    const asarBrowsersPkg = path.join(resRoot, 'app.asar', 'node_modules', '@puppeteer', 'browsers', 'package.json');
    if (fs.existsSync(asarBrowsersPkg)) return;
    const targetBrowsersPkg = path.join(resRoot, 'node_modules', '@puppeteer', 'browsers', 'package.json');
    if (fs.existsSync(targetBrowsersPkg)) return;
    const vendorSrc = path.join(resRoot, 'hot-update', 'vendor', 'node_modules');
    if (fs.existsSync(vendorSrc)) {
      const targetModules = path.join(resRoot, 'node_modules');
      fs.mkdirSync(targetModules, { recursive: true });
      fs.cpSync(vendorSrc, targetModules, { recursive: true, force: true });
    }
  } catch (_) {}
}

let puppeteerPromise = null;
function loadPuppeteer() {
  if (!puppeteerPromise) {
    puppeteerPromise = (async () => {
      ensureVendorModulesForAsar();
      const searchPaths = [
        __dirname,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'node_modules') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules') : null,
        path.resolve(REPO_ROOT, '..', 'app.asar', 'node_modules'),
        path.resolve(REPO_ROOT, '..', 'app.asar.unpacked', 'node_modules'),
        path.join(REPO_ROOT, 'node_modules'),
      ].filter(Boolean);

      let resolvedFile = null;
      try {
        resolvedFile = require.resolve('puppeteer-core', { paths: searchPaths });
      } catch (_) {
        for (const base of searchPaths) {
          const directCandidate = path.join(base, 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js');
          if (fs.existsSync(directCandidate)) {
            resolvedFile = directCandidate;
            break;
          }
        }
      }

      const target = resolvedFile ? url.pathToFileURL(resolvedFile).href : 'puppeteer-core';
      const mod = await import(target);
      return mod.default || mod;
    })().catch((err) => {
      puppeteerPromise = null;
      throw err;
    });
  }
  return puppeteerPromise;
}

module.exports = { resolveExtensionPath, resolveBinRoot, loadPuppeteer, isPackaged };
