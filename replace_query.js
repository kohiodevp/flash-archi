const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/middleware/db.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the async query function body
const newContent = content.replace(
  /(async query\(sql, params = \[\]\)\s*\{\s*)[\s\S]*?(\s*\},\s*)/,
  '$1return executeMemoryQuery(state, sql, params);\n$2'
);

fs.writeFileSync(filePath, newContent);
console.log('Replaced query function body');
