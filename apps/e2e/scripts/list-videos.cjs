'use strict';
/** `npm run videos` - lists every recorded video under apps/e2e/videos with its size. */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'videos');
if (!fs.existsSync(root)) {
  console.log('No videos yet. Run `npm run test:e2e` first.');
  process.exit(0);
}

let count = 0;
for (const spec of fs.readdirSync(root).sort()) {
  const dir = path.join(root, spec);
  if (!fs.statSync(dir).isDirectory()) continue;
  console.log(`\n${spec}/`);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).sort()) {
    const { size, mtime } = fs.statSync(path.join(dir, file));
    console.log(`  ${file}  (${(size / 1024).toFixed(0)} KB, ${mtime.toLocaleString()})`);
    count += 1;
  }
}
console.log(`\n${count} video(s) in ${root}`);
