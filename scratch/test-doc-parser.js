const path = require('path');
const fs = require('fs');
const { parseDocumentFile } = require('../src/main/parser/document-parser');

async function testParser() {
  console.log('--- Testing document-parser.js ---');

  // Test 1: Read source code file (document-parser.js itself)
  const codeFilePath = path.join(__dirname, '../src/main/parser/document-parser.js');
  const codeResult = await parseDocumentFile(codeFilePath);
  console.log('Code file parse result:', {
    success: codeResult.success,
    name: codeResult.name,
    ext: codeResult.ext,
    size: codeResult.size,
    lineCount: codeResult.lineCount,
    charCount: codeResult.charCount,
    truncated: codeResult.truncated,
    sampleText: codeResult.text ? codeResult.text.slice(0, 100) + '...' : null
  });

  // Test 2: Read README.md
  const readmePath = path.join(__dirname, '../README.md');
  const readmeResult = await parseDocumentFile(readmePath);
  console.log('README.md parse result:', {
    success: readmeResult.success,
    name: readmeResult.name,
    ext: readmeResult.ext,
    size: readmeResult.size,
    lineCount: readmeResult.lineCount,
    charCount: readmeResult.charCount
  });

  console.log('--- Test Complete ---');
}

testParser().catch(err => console.error('Test error:', err));
