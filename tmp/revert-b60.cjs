const { execSync } = require('child_process');
execSync('git checkout HEAD -- src/server/server.js', { stdio: 'inherit' });
