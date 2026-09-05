const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/middleware/db.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the start of the function signature
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

// Now find the matching closing brace
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

// The content inside the braces is from braceIndex+1 to endIndex (exclusive)
const indent = content.slice(0, braceIndex).match(/^\s*/)[0]; // indentation of the line containing the brace? Actually we want the indentation of the function body lines.
// We'll compute indentation from the line after the signature.
const lines = content.split('\n');
let indentSpaces = '';
for (let line of lines) {
  if (line.trim().startsWith('async query(sql, params = []) {')) {
    indentSpaces = line.match(/^\s*/)[0];
    break;
  }
}
const newBody = `${indentSpaces}  return executeMemoryQuery(state, sql, params);`;

// Build new content
const newContent = content.slice(0, braceIndex + 1) + '\n' + newBody + '\n' + content.slice(endIndex);

fs.writeFileSync(filePath, newContent);
console.log('Query function body replaced successfully');
