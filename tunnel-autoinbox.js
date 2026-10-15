const { spawn } = require('child_process');
const path = require('path');

const cloudflared = path.join(__dirname, 'cloudflared.exe');
const token = 'eyJhIjoiMWEyNGI5NzM3YTQ4YjMzMDgwNTRiZjVlODcxM2QxYWUiLCJ0IjoiZjZlZmI4MTUtMWViOC00ZGJiLWExNDQtYmFmNjAzNWExNDQ3IiwicyI6Ik9Ua3dNamsyTkRZdFpHUmhOQzAwWkRZekxUa3lPREl0WXpVMFpUVmhOV00zT1RrNSJ9';

console.log('Starting cloudflared tunnel auto-inbox...');
const child = spawn(cloudflared, ['tunnel', 'run', '--token', token], {
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log('Tunnel exited with code', code);
  process.exit(code || 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
