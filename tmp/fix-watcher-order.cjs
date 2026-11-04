const fs = require('fs');
const P = 'src/server/services/PageApiService.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const OLD = [
  '    const updated = new Date(conv.updated_time).getTime();',
  '    if (state.get(conv.id) === updated) continue; // kh\u00F4ng \u0111\u1ED5i \u2014 b\u1ECF qua',
  '    state.set(conv.id, updated);',
  "    const msgData = await graphGet(conv.id + '/messages', {",
  "      fields: 'id,message,from,created_time,attachments{mime_type,image_url,video_url,audio_url,file_url}',",
  "      limit: '25',",
  '      access_token: token,',
  '    }, database);',
  '    if (msgData.error) continue;',
].join(NL);
const NEW = [
  '    const updated = new Date(conv.updated_time).getTime();',
  '    if (state.get(conv.id) === updated) continue; // kh\u00F4ng \u0111\u1ED5i \u2014 b\u1ECF qua',
  '    // L\u01AFU \u00DD: ch\u1EC9 \u0111\u00E1nh d\u1EA5u updated SAU khi k\u00E9o tin th\u00E0nh c\u00F4ng \u2014 k\u00E9o l\u1ED7i th\u00EC',
  '    // chu k\u1EF3 sau th\u1EED l\u1EA1i, tin kh\u00F4ng bao gi\u1EDD b\u1ECB b\u1ECF s\u00F3t (l\u1ED7i m\u1EA5t \u0110ikkj\u0111i 2026-10-06)',
  "    const msgData = await graphGet(conv.id + '/messages', {",
  "      fields: 'id,message,from,created_time,attachments{mime_type,image_url,video_url,audio_url,file_url}',",
  "      limit: '25',",
  '      access_token: token,',
  '    }, database);',
  '    if (msgData.error) continue;',
  '    state.set(conv.id, updated);',
].join(NL);
if (!src.includes(OLD)) { console.error('pattern not found'); process.exit(1); }
src = src.replace(OLD, NEW);
fs.writeFileSync(P, src);
console.log('watcher ordering fixed');
