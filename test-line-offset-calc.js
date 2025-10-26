/**
 * Standalone test to verify line offset calculation logic
 * Run with: node test-line-offset-calc.js
 */

// Simulate the parsing logic
function parseAiYaml(content) {
    const lines = content.split('\n');

    console.log('=== Raw Content ===');
    lines.forEach((line, idx) => {
        console.log(`Line ${idx}: "${line}"`);
    });
    console.log('');

    // Check if using versions array structure
    const useVersions = /^\s*versions:\s*$/m.test(content);
    console.log(`Uses versions array: ${useVersions}`);
    console.log('');

    let workingContent = content;
    let baseLineOffset = 0;

    if (useVersions) {
        const versionMatch = content.match(/^\s*-\s+/m);
        if (versionMatch) {
            const beforeDash = content.substring(0, content.indexOf(versionMatch[0]));
            baseLineOffset = beforeDash.split('\n').length - 1; // FIX: count newlines, not array length
            workingContent = content.substring(content.indexOf(versionMatch[0]) + versionMatch[0].length);
            console.log(`Base line offset (after dash): ${baseLineOffset}`);
            console.log('Working content starts with:', workingContent.substring(0, 50));
            console.log('');
        }
    }

    // Find prompt field
    const promptRegex = /^\s*prompt:\s*\|\s*$/m;
    const promptMatch = workingContent.match(promptRegex);
    if (promptMatch) {
        const beforePrompt = workingContent.substring(0, promptMatch.index);
        const promptLineOffset = baseLineOffset + beforePrompt.split('\n').length - 1;
        console.log(`Prompt field found at offset: ${promptLineOffset}`);
        console.log(`  (baseLineOffset=${baseLineOffset} + lines before match=${beforePrompt.split('\n').length - 1})`);
    }

    // Find response field
    const responseRegex = /^\s*response:\s*\|\s*$/m;
    const responseMatch = workingContent.match(responseRegex);
    if (responseMatch) {
        const beforeResponse = workingContent.substring(0, responseMatch.index);
        const responseLineOffset = baseLineOffset + beforeResponse.split('\n').length - 1;
        console.log(`Response field found at offset: ${responseLineOffset}`);
        console.log(`  (baseLineOffset=${baseLineOffset} + lines before match=${beforeResponse.split('\n').length - 1})`);
    }
}

// Test Case 1: Versions array
console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║ TEST CASE 1: Versions Array Structure                    ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

const testCase1 = `versions:
  - prompt: |
      What is the capital of France?
    model: claude-3-5-sonnet
    response: |
      The capital of France is Paris.`;

console.log('Opening ::: is at line 7 in the markdown file');
console.log('So sourceLine = 7, and rawContent starts at line 8\n');

parseAiYaml(testCase1);

console.log('\n Expected absolute line numbers:');
console.log('  - Prompt should be at: 7 + 1 + promptOffset');
console.log('  - Response should be at: 7 + 1 + responseOffset');
console.log('');


// Test Case 2: Direct fields
console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║ TEST CASE 2: Direct Fields (No Versions)                 ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

const testCase2 = `prompt: |
  Tell me about markdown
model: test-model
response: |
  Markdown is great!`;

console.log('Opening ::: is at line 33 in the markdown file');
console.log('So sourceLine = 33, and rawContent starts at line 34\n');

parseAiYaml(testCase2);

console.log('\n Expected absolute line numbers:');
console.log('  - Prompt should be at: 33 + 1 + promptOffset');
console.log('  - Response should be at: 33 + 1 + responseOffset');
console.log('');


// Test Case 3: Multi-line
console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║ TEST CASE 3: Multi-line Content                          ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

const testCase3 = `versions:
  - prompt: |
      Line 1 of prompt
      Line 2 of prompt
      Line 3 of prompt
    model: claude
    response: |
      Line 1 of response
      Line 2 of response`;

console.log('Opening ::: is at line 54 in the markdown file');
console.log('So sourceLine = 54, and rawContent starts at line 55\n');

parseAiYaml(testCase3);

console.log('\n Expected absolute line numbers:');
console.log('  - Prompt should be at: 54 + 1 + promptOffset');
console.log('  - Response should be at: 54 + 1 + responseOffset');
