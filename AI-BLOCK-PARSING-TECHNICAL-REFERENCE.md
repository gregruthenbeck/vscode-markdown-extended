# AI Block Parsing Technical Reference

## Overview

This document describes the custom YAML parser for `:::ai` markdown containers in the vscode-markdown-extended extension. The parser is designed to be **tolerant of markdown content** within YAML literal blocks, which breaks standard YAML parsers.

## YAML Structure

### Supported Formats

**Format 1: Versions Array**
```yaml
:::ai
versions:
  - prompt: |
      content (6 spaces from margin)
    model: model-name (4 spaces from margin)
    response: |
      content (6 spaces from margin)
:::
```

**Format 2: Direct Fields**
```yaml
:::ai
prompt: |
  content (2 spaces from margin)
response: |
  content (2 spaces from margin)
:::
```

### Critical Indentation Rules

- `versions:` - 0 spaces
- `- prompt:` - 2 spaces (list item)
- `model:` - 4 spaces (sibling to prompt)
- `response:` - 4 spaces (sibling to prompt)
- Content after `|` - 6 spaces (in versions array format)

## Why Not Use Standard YAML Parsers?

Standard YAML parsers (like `js-yaml`) fail on our content because:

1. **Markdown lists are interpreted as YAML lists**:
   ```yaml
   response: |
     - ✅ "Create a Decision Poll" heading
   ```
   `js-yaml` sees `- ✅` as a YAML list item, not markdown content.

2. **Indentation variations break parsing**:
   Code blocks, nested lists, and other markdown structures have varying indentation that confuses YAML parsers expecting consistent structure.

## Custom Parser Implementation

### Key Functions

#### `parseAiYaml(content: string)`

**Purpose**: Main entry point for parsing AI container YAML

**Algorithm**:
1. Detect if using `versions:` array structure
2. Extract working content (first version item or direct content)
3. Call field extractors for `prompt`, `model`, `response`

**Returns**: `{ prompt: string, model: string, response: string }`

#### `extractLiteralBlock(content: string, fieldName: string)`

**Purpose**: Extract content from a YAML literal block field (`field: |`)

**Key Challenge**: Distinguish between:
- Sibling YAML keys (should stop extraction)
- Markdown content with varying indentation (should continue extraction)

**Algorithm**:
```
1. Find "fieldName: |" using regex: /^\s*fieldName:\s*\|\s*$/m
2. Get first non-empty line → sets baseIndent (e.g., 6 spaces)
3. For each subsequent line:
   a. If empty → include (part of content)
   b. If indent < baseIndent AND matches /^\s*\w+:\s*/ → STOP (YAML key)
   c. Otherwise → include (markdown content, any indent OK)
4. Dedent all collected lines
5. Return trimmed result
```

**Critical Logic**:
```typescript
// Stop if we hit a line with less indentation that looks like a YAML key
if (indent < baseIndent && /^\s*\w+:\s*/.test(line)) {
    break; // Stop at next YAML key
}

// Include line regardless of indentation (markdown content can have any indent)
blockLines.push(line);
```

This allows markdown like:
```
      Some text
      - List item (0 indent after dedent)
      - Another item

      ```code
      block content
      ```
```

#### `dedentLines(lines: string[])`

**Purpose**: Remove common indentation from all lines

**Algorithm**:
1. Find minimum indentation (ignoring empty lines)
2. Subtract that from all lines
3. Return joined, trimmed result

#### `extractSimpleField(content: string, fieldName: string)`

**Purpose**: Extract simple key-value pairs like `model: claude-3-5-sonnet`

**Regex**: `/^\s*fieldName:\s*(.+?)\s*$/m`

## Truncation Strategy

### Prompt Field
- **Rule**: First 10 lines only
- **Indicator**: `*... (N more lines)*` appended if truncated

### Response Field (No Interrupts)
- **Rule**: Last 10 lines only
- **Indicator**: `*... (N lines above)*` prepended if truncated

### Response Field (With Interrupts)

When `**Interrupt:**` markers are detected, apply segmented truncation:

**Structure**:
```
[Initial response segment]
**Interrupt:**
[User's new instruction]
**Thinking:** (or **Edit:**, **Bash:**, etc.)
[AI's response to interrupt]
**Interrupt:**
[Another instruction]
...
```

**Truncation Rules**:

| Segment Type | Rule | Skip Indicator Position |
|--------------|------|------------------------|
| Pre-interrupt content | First 4 + last 8 lines | Middle: `*... (N lines)*` |
| Interrupt content (user) | First 10 lines | End: `*... (N more lines)*` |
| Post-interrupt content | First 4 + last 8 lines | Middle: `*... (N lines)*` |

**Implementation**: `parseResponseWithInterrupts(text: string)`

### Marker Detection

**Interrupt Marker**:
```typescript
const interruptMarker = /^\s*\*\*Interrupt:\*\*\s*$/;
```

**AI Response Markers**:
```typescript
const aiMarker = /^\s*\*\*[A-Z][a-z]+:\*\*/;
```
Matches: `**Thinking:**`, `**Edit:**`, `**Bash:**`, `**Read:**`, etc.

**Critical**: Both regexes allow leading whitespace (`^\s*`) because content from literal blocks is dedented but may still have relative indentation.

## Rendering Pipeline

1. **Extract raw YAML** from `:::ai` block
2. **Parse** using `parseAiYaml()`
3. **Truncate prompt** (first 10 lines)
4. **Process response** with `parseResponseWithInterrupts()`
5. **Add hard line breaks**: Append `  ` (two spaces) to each line
6. **Render markdown**: Recursively process with markdown-it
7. **Generate HTML** fieldset structure

### HTML Output

```html
<fieldset class="ai-container">
  <legend>ai</legend>
  <div class="ai-prompt">${promptHtml}</div>
  <hr class="ai-separator">
  <div class="ai-response">${responseHtml}</div>
</fieldset>
```

## Edge Cases Handled

### 1. Markdown Lists in Response
**Problem**: `- ✅ Item` looks like YAML list
**Solution**: Custom parser treats literal block content as raw strings

### 2. Code Blocks with Zero Indentation
**Problem**: Dedented code blocks would stop extraction
**Solution**: Only stop on `indent < baseIndent AND /^\s*\w+:\s*/`

### 3. Multiple Interrupts
**Problem**: Need to handle N interrupts, not just one
**Solution**: Loop through all interrupt positions, apply rules to each

### 4. Interrupt Without Paired Marker
**Problem**: `**Interrupt:**` at end with no `**Thinking:**` after
**Solution**: Treat remaining content as interrupt content, apply first-10 rule

### 5. Empty Fields
**Problem**: `prompt: |` with no content
**Solution**: Returns empty string, doesn't break parsing

### 6. Very Long Responses (1000+ lines)
**Problem**: Performance and display
**Solution**: Truncation limits content to ~26 lines max (4+8+4+8+2 markers)

## Testing

### Diagnostic Tool

**File**: `/test-parser.js`

**Usage**:
```bash
node test-parser.js
```

**Output**:
- Raw YAML extracted
- Field extraction diagnostics
- Line counts
- Interrupt detection results
- Truncation preview

### Test Cases

**File**: `/test.md`

Contains 11 test cases covering:
1. Basic structure with versions array
2. Direct fields (no versions)
3. Long response (>10 lines)
4. Short response (<10 lines)
5. Empty response
6. Empty prompt
7. Markdown in content (bold, italic, code, links, lists, code blocks)
8. Invalid YAML (error handling)
9. Empty container (error handling)
10. Regular containers (should still work)
11. No closing marker (auto-close)

## Common Issues and Solutions

### Issue: Parser stops at markdown list

**Symptom**: Response shows only first few lines, stops at `- Item`

**Cause**: Indentation logic stopping too early

**Solution**: Ensure condition is:
```typescript
if (indent < baseIndent && /^\s*\w+:\s*/.test(line))
```
Not just:
```typescript
if (indent < baseIndent)
```

### Issue: Interrupt markers not detected

**Symptom**: No segmentation, response truncated as one block

**Cause**: Regex doesn't allow leading whitespace

**Solution**: Use `/^\s*\*\*Interrupt:\*\*\s*$/` not `/^\*\*Interrupt:\*\*\s*$/`

### Issue: Entire response is one line

**Symptom**: All content concatenated

**Cause**: Missing hard line breaks before markdown rendering

**Solution**: Add `  ` (two trailing spaces) to each line:
```typescript
responseContent.split('\n').map(line => line + '  ').join('\n')
```

## Performance Considerations

- **Regex compilation**: Compiled once per function call, acceptable
- **Line-by-line processing**: O(n) where n = content lines, acceptable for typical use
- **Truncation**: Reduces processing for very long responses
- **Markdown rendering**: Delegated to markdown-it (already optimized)

## Future Improvements

1. **Configurable truncation limits**: Allow users to set line limits
2. **Syntax highlighting**: For code blocks in responses
3. **Collapsible sections**: For very long segments
4. **Export functionality**: Copy raw YAML or rendered HTML
5. **Search within responses**: Find text across truncated content

## Changelog

### v1.1 (2025-10-24)
- Fixed literal block extraction to handle markdown lists
- Added interrupt-aware response truncation
- Implemented first-N + last-M truncation for segments
- Added skip line count indicators
- Fixed regex patterns to allow leading whitespace

### v1.0 (Initial)
- Basic YAML parsing with js-yaml (failed on production data)
- Simple last-10-lines truncation
- No interrupt handling
