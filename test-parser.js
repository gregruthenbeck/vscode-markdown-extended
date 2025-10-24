#!/usr/bin/env node

const fs = require('fs');

// Read the lesson file
const lessonPath = '/home/greg/mooc/courses/docs/course-04-trav/module-02/lesson01.md';
const content = fs.readFileSync(lessonPath, 'utf8');

// Extract first AI container
const aiContainerRegex = /:::\s*ai\s*\nversions:\s*\n([\s\S]*?)(?=\n:::|$)/;
const match = content.match(aiContainerRegex);

if (!match) {
  console.log('❌ No AI container found');
  process.exit(1);
}

const rawYaml = 'versions:\n' + match[1];

console.log('=' .repeat(80));
console.log('RAW YAML EXTRACTED');
console.log('='.repeat(80));
console.log(rawYaml.substring(0, 2000) + '\n... [truncated]\n');

// Parser functions (adapted from TypeScript)
function extractLiteralBlock(content, fieldName) {
  const regex = new RegExp(`^\\s*${fieldName}:\\s*\\|\\s*$`, 'm');
  const match = content.match(regex);

  if (!match) {
    console.log(`⚠️  No match for field: ${fieldName}`);
    return '';
  }

  // Determine the indent level of this field's key
  const keyLine = match[0];
  const keyIndent = (keyLine.match(/^(\s*)/) || ['', ''])[1].length;

  const startPos = match.index + match[0].length;
  const lines = content.substring(startPos).split('\n');

  const blockLines = [];
  let baseIndent = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Empty lines are part of the block
    if (line.trim() === '') {
      blockLines.push('');
      continue;
    }

    // Measure indentation
    const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;

    // First non-empty line sets base indentation for content
    if (baseIndent === null) {
      if (indent === 0) break; // No indentation, not part of block
      baseIndent = indent;
      blockLines.push(line);
      continue;
    }

    // Stop if we hit a line with less indentation that looks like a YAML key
    if (indent < baseIndent && /^\s*\w+:\s*/.test(line)) {
      console.log(`🛑 Block ended at line ${i}: found YAML key with less indent`);
      console.log(`   Line content: "${line}"`);
      console.log(`   Indent: ${indent} < baseIndent: ${baseIndent}`);
      break;
    }

    // Include line regardless of indentation (markdown content can have any indent)
    blockLines.push(line);
  }

  console.log(`📊 ${fieldName} block: ${blockLines.length} lines extracted`);
  return dedentLines(blockLines);
}

function dedentLines(lines) {
  if (lines.length === 0) return '';

  // Find minimum indentation (ignoring empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
    minIndent = Math.min(minIndent, indent);
  }

  if (minIndent === Infinity) return lines.join('\n').trim();

  // Remove common indentation
  const dedented = lines.map(line => {
    if (line.trim() === '') return '';
    return line.substring(minIndent);
  });

  return dedented.join('\n').trim();
}

function extractSimpleField(content, fieldName) {
  const regex = new RegExp(`^\\s*${fieldName}:\\s*(.+?)\\s*$`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}

function parseAiYaml(content) {
  // Check if using versions array structure
  const useVersions = /^\s*versions:\s*$/m.test(content);

  // Extract working content (either first version or direct content)
  let workingContent = content;
  if (useVersions) {
    // Find content after "- " (first array item)
    const versionMatch = content.match(/^\s*-\s+/m);
    if (versionMatch) {
      workingContent = content.substring(content.indexOf(versionMatch[0]) + versionMatch[0].length);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('PARSING FIELDS');
  console.log('='.repeat(80));

  // Extract fields
  const prompt = extractLiteralBlock(workingContent, 'prompt');
  const model = extractSimpleField(workingContent, 'model');
  const response = extractLiteralBlock(workingContent, 'response');

  return { prompt, model, response };
}

function parseResponseWithInterrupts(text) {
  if (!text) return '';

  const lines = text.split(/\r?\n/);
  const interruptMarker = /^\s*\*\*Interrupt:\*\*\s*$/;
  const aiMarker = /^\s*\*\*[A-Z][a-z]+:\*\*/;

  console.log('\n' + '='.repeat(80));
  console.log('INTERRUPT DETECTION');
  console.log('='.repeat(80));
  console.log(`Total lines: ${lines.length}\n`);

  // Find all interrupt positions
  const interrupts = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (interruptMarker.test(line)) {
      console.log(`✅ Found interrupt at line ${i}: "${line}"`);

      // Find next AI marker
      let markerLine = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (aiMarker.test(lines[j]) && lines[j] !== '**Interrupt:**') {
          console.log(`   Paired with marker at line ${j}: "${lines[j].trim()}"`);
          markerLine = j;
          break;
        }
      }
      interrupts.push({ interruptLine: i, markerLine });
    }
  }

  console.log(`\nTotal interrupts found: ${interrupts.length}`);

  return text; // Return original for now
}

// Run the parser
console.log('\n' + '='.repeat(80));
console.log('STARTING PARSE');
console.log('='.repeat(80));

const parsed = parseAiYaml(rawYaml);

console.log('\n' + '='.repeat(80));
console.log('PARSED RESULTS');
console.log('='.repeat(80));
console.log(`Prompt lines: ${parsed.prompt.split('\n').length}`);
console.log(`Model: ${parsed.model}`);
console.log(`Response lines: ${parsed.response.split('\n').length}`);

console.log('\n' + '='.repeat(80));
console.log('PROMPT (first 10 lines)');
console.log('='.repeat(80));
console.log(parsed.prompt.split('\n').slice(0, 10).join('\n'));

console.log('\n' + '='.repeat(80));
console.log('RESPONSE (last 20 lines)');
console.log('='.repeat(80));
const responseLines = parsed.response.split('\n');
console.log(responseLines.slice(-20).join('\n'));

// Test interrupt parsing
parseResponseWithInterrupts(parsed.response);

console.log('\n' + '='.repeat(80));
console.log('DONE');
console.log('='.repeat(80));
