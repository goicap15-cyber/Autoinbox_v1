const fs = require('fs');
const path = require('path');

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
  return isPackaged() ? path.join(process.resourcesPath, 'extension') : path.join(REPO_ROOT, 'src', 'extension');
}

function resolveBinRoot() {
  return isPackaged() ? process.resourcesPath : REPO_ROOT;
}

module.exports = { resolveExtensionPath, resolveBinRoot };
