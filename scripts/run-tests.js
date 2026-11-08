const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, '..', 'dist', 'test');
const files = fs.existsSync(directory)
  ? fs.readdirSync(directory).filter((file) => file.endsWith('.test.js')).map((file) => path.join(directory, file))
  : [];

if (files.length === 0) {
  console.error('No compiled tests found. Run npm run build first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
