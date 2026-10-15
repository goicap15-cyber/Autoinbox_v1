const express = require('express');
const path = require('path');

const app = express();
const PORT = 3005;

// Phục vụ thư mục public-site tĩnh
app.use(express.static(path.join(__dirname, 'public-site')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public-site', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Public site is listening at http://localhost:${PORT}`);
});
