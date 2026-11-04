const path = require('path');
const asar = require(path.resolve(process.cwd(), 'node_modules', '@electron', 'asar'));
const asarPath = path.resolve(__dirname, 'out-app.asar');
const header = asar.getRawHeader(asarPath).header;
const names = [];
(function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files || {})) {
    if (child.files) walk(child, prefix + name + '/');
    else names.push(prefix + name);
  }
})(header, '');
console.log('total files:', names.length);
console.log(names.filter((n) => n.includes('server.js')).slice(0, 10).join('\n'));
console.log('---');
console.log(names.filter((n) => n.includes('index-l8lmiRjl')).join('\n'));
