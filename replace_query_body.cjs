const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/middleware/db.js');
let content = fs.readFileSync(filePath, 'utf8');

// We'll split by lines to find the function.
const lines = content.split('\n');
let inQuery = false;
let braceCount = 0;
let startLine = -1;
let endLine = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim().startsWith('async query(sql, params = []) {')) {
    inQuery = true;
    startLine = i;
    braceCount = 1; // we have seen the opening brace
    continue;
  }
  if (inQuery) {
    // Count braces in this line
    for (let ch of line) {
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    if (braceCount === 0) {
      endLine = i;
      break;
    }
  }
}

if (startLine === -1 || endLine === -1) {
  console.error('Could not locate query function bounds');
  process.exit(1);
}

// Replace lines from startLine+1 to endLine-1 with the new body
const indent = lines[startLine].match(/^\s*/)[0]; // indentation of the line
const newBody = `${indent}  return executeMemoryQuery(state, sql, params);`;
const newLines = [
  ...lines.slice(0, startLine + 1),
  newBody,
  ...lines.slice(endLine)
];

const newContent = newLines.join('\n');
fs.writeFileSync(filePath, newContent);
console.log(`Replaced query function body (lines ${startLine+1} to ${endLine})`);
