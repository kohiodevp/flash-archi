#!/usr/bin/env node
// scripts/find-missing-braces.js — v2 corrigée
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src/middleware/db.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

const stack = [];

// Strip strings, comments, regex literals pour ne compter que les vraies accolades
function strip(line) {
  return line
    .replace(/\/\/.*$/, '')                           // commentaires //
    .replace(/\/\*[\s\S]*?\*\//g, '')                 // commentaires /* */
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``')             // template literals (avec flag s pour multi-ligne)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')              // strings ""
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")              // strings ''
    .replace(/\/(?![*\/])(?:[^\/\\]|\\.)+\/[gimsuy]*/g, '/regex/'); // regex literals
}

lines.forEach((rawLine, idx) => {
  const line = strip(rawLine);
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '{') {
      stack.push({ 
        line: idx + 1, 
        col: i, 
        content: rawLine.trim(),
        indent: (rawLine.match(/^\s*/) || [''])[0].length
      });
    } else if (ch === '}') {
      if (stack.length > 0) stack.pop();
    }
  }
});

console.log('=== ACCOLADES { SANS FERMETURE CORRESPONDANTE ===\n');
console.log(`Total: ${stack.length} accolade(s) ouvrante(s) sans fermeture\n`);

// Trier par ligne pour lecture facile
stack.sort((a, b) => a.line - b.line);

stack.forEach((s, i) => {
  console.log(`[${i + 1}] Ligne ${s.line} (indent=${s.indent}):`);
  console.log(`    ${s.content}`);
  
  // Afficher 5 lignes de contexte après pour aider à localiser la fin du bloc
  const contextLines = lines.slice(s.line, Math.min(s.line + 5, lines.length));
  console.log('    Contexte:');
  contextLines.forEach((l, j) => {
    console.log(`      ${s.line + j + 1}: ${l}`);
  });
  console.log('');
});
