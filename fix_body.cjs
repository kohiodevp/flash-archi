const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/middleware/db.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the function signature
const signature = 'async query(sql, params = []) {';
const sigIndex = content.indexOf(signature);
if (sigIndex === -1) {
  console.error('Signature not found');
  process.exit(1);
}

// Find the opening brace after the signature
let braceIndex = content.indexOf('{', sigIndex);
if (braceIndex === -1) {
  console.error('Opening brace not found after signature');
  process.exit(1);
}

// Find the matching closing brace
let braceCount = 0;
let i = braceIndex;
let endIndex = -1;
for (; i < content.length; i++) {
  const ch = content[i];
  if (ch === '{') braceCount++;
  else if (ch === '}') {
    braceCount--;
    if (braceCount === 0) {
      endIndex = i;
      break;
    }
  }
}
if (endIndex === -1) {
  console.error('Matching closing brace not found');
  process.exit(1);
}

// Now we need to replace the content between braceIndex+1 and endIndex with the new body.
// Determine indentation: look at the line of the signature.
const lines = content.split('\n');
let indent = '';
for (let line of lines) {
  if (line.trim().startsWith('async query(sql, params = []) {')) {
    indent = line.match(/^\s*/)[0];
    break;
  }
}
const newBody = `${indent}  return executeMemoryQuery(state, sql, params);`;

const newContent = content.slice(0, braceIndex + 1) + '\n' + newBody + '\n' + content.slice(endIndex);

fs.writeFileSync(filePath, newContent);
console.log('Query function body replaced successfully');
