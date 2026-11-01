const { extractFile, listPackage } = require('@electron/asar');
const { execSync } = require('child_process');
const fs = require('fs');

const base = 'C:/Users/Admin/AppData/Local/Temp/crm_build_release/win-unpacked';
const asarPath = base + '/resources/app.asar';

const files = listPackage(asarPath).filter(f => f.toLowerCase().includes('background.js') || f.toLowerCase().includes('content.js'));
console.log('ASAR FILES:', files.join(' | '));

const rel = files.find(f => f.includes('background.js')).replace(/^[\\/]+/, '');
const bg = extractFile(asarPath, rel).toString('utf8');
console.log('asar bg 11c:', bg.includes('2026-10-11c'), '| inReplyQuote count:', (bg.match(/inReplyQuote/g) || []).length);

const relCt = files.find(f => f.includes('content.js')).replace(/^[\\/]+/, '');
const ct = extractFile(asarPath, relCt).toString('utf8');
console.log('asar content inReplyQuote count:', (ct.match(/inReplyQuote/g) || []).length);

const loose = base + '/resources/extension/background.js';
const distBg = fs.readFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/dist/extension/background.js');
console.log('loose bg === dist bg:', Buffer.compare(loose ? fs.readFileSync(loose) : Buffer.alloc(0), distBg) === 0);
console.log('loose bg has 11c:', fs.readFileSync(loose, 'utf8').includes('2026-10-11c'));
