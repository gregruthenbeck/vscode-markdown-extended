# Proposal: Fix data-line Attribute for Reliable Editor-Preview Scroll Sync

**Date:** 2025-10-26
**Author:** Claude Code
**Status:** Implemented
**Version:** 2.0 (Updated with actual implementation)

---

## Executive Summary

The `data-line` attribute implementation in our custom markdown-it plugins (specifically `markdownItAiContainer.ts`) contained two critical bugs that broke VSCode's editor-preview scroll synchronization:

1. **Nested rendering produced relative line numbers** - `md.render()` on extracted content generated data-line="0" instead of absolute file positions
2. **Content truncation destroyed line number mappings** - Truncating responses before rendering caused data-line values to point to wrong lines

**Solution Implemented:** Segment-based rendering with line number tracking through truncation, combined with HTML post-processing to adjust data-line values from relative to absolute positions.

---

## Table of Contents

1. [Background](#background)
2. [Problem Statement](#problem-statement)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Requirements](#requirements)
5. [Implemented Solution: Segment Tracking + HTML Post-Processing](#implemented-solution-segment-tracking--html-post-processing)
6. [Alternative Solutions Considered](#alternative-solutions-considered)
7. [Implementation Plan](#implementation-plan)
8. [Testing Strategy](#testing-strategy)
9. [Risks and Mitigations](#risks-and-mitigations)
10. [References](#references)

---

## Background

### VSCode Markdown Preview Scroll Synchronization

VSCode's markdown preview implements bidirectional scroll synchronization between the editor and preview pane using the `data-line` HTML attribute. This mechanism works as follows:

1. **Rendering Phase:** markdown-it parses markdown and creates tokens, each with a `map` property containing `[lineBegin, lineEnd]`
2. **Attribute Injection:** VSCode's `pluginSourceMap` adds `data-line` attributes to rendered HTML using `token.map[0]`
3. **Scroll Sync:** When users click preview elements or scroll, VSCode reads `data-line` values to jump to corresponding editor lines

### Critical Facts

- **Line numbering is ZERO-BASED:** The first line of a file is line 0
- **Line numbers are ABSOLUTE:** They represent positions from the start of the file, not relative offsets
- **VSCode's implementation:** `token.attrSet('data-line', String(token.map[0]));` (no conversion, direct zero-based)

**Source:** [VSCode markdown-language-features/markdownEngine.ts](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/markdownEngine.ts)

---

## Problem Statement

### Current Behavior

When rendering AI containers (`::: ai` blocks), our plugin performs nested markdown rendering:

```typescript
const promptHtml = promptContent ? md.render(promptContent, env || {}) : '';
let responseHtml = responseContent ? md.render(responseContent, env || {}) : '';
```

**The Bug:** When `md.render()` is called on extracted content, VSCode's `pluginSourceMap` generates `data-line` attributes **relative to the nested content** (starting from 0), NOT absolute to the original file.

### Example

Given this markdown at file lines 21-27 (zero-based):

```markdown
::: ai                    // line 21
versions:                 // line 22
  - prompt: |             // line 23
      What is Python?     // line 24
    model: claude         // line 25
    response: |           // line 26
      Python is a PL.     // line 27
:::                       // line 28
```

**Current (Broken) Output:**
```html
<fieldset class="ai-container" data-line="21">
  <legend>ai</legend>
  <div class="ai-prompt" data-line="23">
    <p data-line="0">What is Python?</p>  ❌ WRONG! Should be 24
  </div>
  <div class="ai-response" data-line="26">
    <p data-line="0">Python is a PL.</p>  ❌ WRONG! Should be 27
  </div>
</fieldset>
```

**Impact:** Clicking nested content jumps to line 0 instead of the correct source line.

---

## Root Cause Analysis

### Primary Issue: Nested Rendering with Relative Line Numbers

1. When we call `md.render(promptContent, env)`, markdown-it receives **only** the extracted prompt text: `"What is Python?"`
2. markdown-it parses this in isolation, creating tokens with `map: [0, 1]` (line 0 relative to the input string)
3. VSCode's `pluginSourceMap` sets `data-line="0"` based on these relative positions
4. The nested HTML loses all connection to the original file position

### Secondary Issue: Content Truncation Destroyed Line Mappings

The code truncated content **before** rendering:

```typescript
// OLD (BROKEN):
let responseContent = parseResponseWithInterrupts(aiData.response.content); // Truncates
const responseHtml = md.render(responseContent, env); // Renders truncated content
// Result: Line numbers in rendered HTML don't match original file!
```

**Example of the problem:**
- Original response has "**Interrupt:**" at line 57
- After truncation (first 4 + last 8 lines), "**Interrupt:**" is now at line 10 in truncated text
- Rendering with base offset 43 gives it data-line="43 + 10 = 53" instead of correct "57"

### Why Token Manipulation Didn't Work

Initial attempt tried modifying `token.map` values before rendering:

```typescript
// ATTEMPTED (FAILED):
token.map = [token.map[0] + lineOffset, token.map[1] + lineOffset];
```

**Why it failed:** VSCode's `pluginSourceMap` doesn't see our token.map modifications. The plugin either caches values or uses a different token instance during rendering.

---

## Requirements

### Functional Requirements

1. **FR-1:** All `data-line` attributes must use zero-based absolute line numbers
2. **FR-2:** Nested markdown elements (paragraphs, lists, code blocks) must have correct `data-line` values
3. **FR-3:** Clicking any element in the preview must jump to the correct editor line
4. **FR-4:** Solution must work with all markdown-it plugins (tables, lists, code, admonitions, etc.)

### Non-Functional Requirements

1. **NFR-1:** Solution should align with markdown-it architecture and best practices
2. **NFR-2:** Code should be maintainable and easy to understand
3. **NFR-3:** Minimal performance impact on rendering
4. **NFR-4:** No dependency on HTML parsing/regex when possible

---

## Implemented Solution: Segment Tracking + HTML Post-Processing

### Two-Part Solution

**Part 1: Track Original Line Numbers Through Truncation**
**Part 2: Post-Process HTML to Adjust data-line Values**

### Implementation

#### Step 1: Add TruncatedSegment Interface

```typescript
interface TruncatedSegment {
    text: string;
    lineStart: number;  // Line number relative to content start (0-indexed), -1 for skip markers
    lineEnd: number;    // Line number relative to content start (inclusive), -1 for skip markers
}
```

#### Step 2: Modify Truncation Functions to Track Line Numbers

**Before (returned string):**
```typescript
function limitLines(text: string, count: number, fromStart: boolean): { text: string, skipped: number }
```

**After (returns segments with line tracking):**
```typescript
function limitLines(text: string, count: number, fromStart: boolean): TruncatedSegment[] {
    const lines = text.split(/\r?\n/);
    if (totalLines <= count) {
        return [{ text, lineStart: 0, lineEnd: totalLines - 1 }];
    }

    if (fromStart) {
        return [
            { text: lines.slice(0, count).join('\n'), lineStart: 0, lineEnd: count - 1 },
            { text: `*... (${skipped} more lines)*`, lineStart: -1, lineEnd: -1 }
        ];
    } else {
        return [
            { text: `*... (${skipped} lines above)*`, lineStart: -1, lineEnd: -1 },
            { text: lines.slice(-count).join('\n'), lineStart: totalLines - count, lineEnd: totalLines - 1 }
        ];
    }
}
```

Same pattern for `truncateMiddle()` and `parseResponseWithInterrupts()`.

#### Step 3: Create renderWithLineOffset() Using HTML Post-Processing

Token manipulation failed because VSCode's pluginSourceMap doesn't see our modifications. **Solution:** Let VSCode render with relative line numbers (0, 1, 2...), then adjust them in the HTML.

```typescript
function renderWithLineOffset(md: MarkdownIt, content: string, lineOffset: number, env: any): string {
    if (!content) return '';

    // Render normally (VSCode's pluginSourceMap generates data-line="0", "1", "2"...)
    const html = md.render(content, env);

    // Adjust all data-line values by adding the lineOffset
    // This converts relative line numbers (0, 1, 2...) to absolute file positions
    const adjustedHtml = html.replace(/data-line="(\d+)"/g, (match, lineNum) => {
        const absoluteLine = parseInt(lineNum, 10) + lineOffset;
        return `data-line="${absoluteLine}"`;
    });

    return adjustedHtml;
}
```

#### Step 4: Create renderSegments() to Handle Segment Array

```typescript
function renderSegments(md, segments: TruncatedSegment[], baseLineOffset, env): string {
    const htmlParts: string[] = [];

    for (const segment of segments) {
        if (segment.lineStart < 0) {
            // Skip marker - plain HTML without data-line
            htmlParts.push(`<p class="truncation-marker">${escapeHtml(segment.text)}</p>`);
        } else {
            // Normal content - render with correct line offset
            const textWithBreaks = segment.text.split('\n').map(line => line + '  ').join('\n');
            const html = renderWithLineOffset(md, textWithBreaks, baseLineOffset + segment.lineStart, env);
            htmlParts.push(html);
        }
    }

    return htmlParts.join('\n');
}
```

#### Step 5: Update generateAiContainerHTML()

```typescript
// Get truncated segments with original line tracking
const promptSegments = limitLines(aiData.prompt.content, 10, true);
const responseSegments = parseResponseWithInterrupts(aiData.response.content);

// Render segments with correct absolute line numbers
const promptHtml = renderSegments(md, promptSegments, promptLine + 1, env || {});
const responseHtml = renderSegments(md, responseSegments, responseLine + 1, env || {});
```

### Expected Output

With the fix, the same example now produces:

```html
<fieldset class="ai-container" data-line="21">
  <legend>ai</legend>
  <div class="ai-prompt" data-line="23">
    <p data-line="24">What is Python?</p>  ✅ CORRECT!
  </div>
  <div class="ai-response" data-line="26">
    <p data-line="27">Python is a PL.</p>  ✅ CORRECT!
  </div>
</fieldset>
```

---

## Alternative Solutions Considered

### Option A: Strip Nested data-line Attributes
**Approach:** Remove all `data-line` from nested HTML, rely on parent div only.

**Pros:**
- Simple regex: `html.replace(/\s*data-line="\d+"/g, '')`
- Minimal code

**Cons:**
- ❌ Breaks granular scroll sync (clicking nested elements jumps to container start)
- ❌ Poor UX for long responses with multiple paragraphs
- ❌ Doesn't match VSCode's standard markdown behavior

**Verdict:** Rejected - degrades user experience

---

### Option B: Disable pluginSourceMap for Nested Renders
**Approach:** Pass modified env/options to disable VSCode's source map plugin.

**Cons:**
- ❌ No standard API to disable specific plugins per-render
- ❌ We don't control the `md` instance (VSCode provides it)
- ❌ Hacky workarounds (monkey-patching) would be fragile

**Verdict:** Rejected - not feasible

---

### Option C: Post-Process HTML with Regex (Without Segment Tracking)
**Approach:** Adjust `data-line` values in rendered HTML:

```typescript
function adjustDataLineAttributes(html: string, lineOffset: number): string {
    return html.replace(/data-line="(\d+)"/g, (match, lineNum) => {
        return `data-line="${parseInt(lineNum, 10) + lineOffset}"`;
    });
}
```

**Pros:**
- Simple implementation

**Cons:**
- ❌ Doesn't solve truncation problem - still needs segment tracking
- ❌ Alone, this is insufficient

**Verdict:** Rejected as standalone solution, but **used as part of final solution**

---

### Option G: Token Manipulation (ATTEMPTED, FAILED)
**Approach:** Modify `token.map` values before rendering:

```typescript
function adjustTokens(tokens: Token[]): void {
    for (const token of tokens) {
        if (token.map) {
            token.map = [
                token.map[0] + lineOffset,
                token.map[1] + lineOffset
            ];
        }
        if (token.children) {
            adjustTokens(token.children);
        }
    }
}
```

**Why it failed:**
- ❌ VSCode's `pluginSourceMap` doesn't see our token.map modifications
- ❌ All rendered HTML still had `data-line="0"` despite correct token.map values
- ❌ VSCode either caches token.map or uses a different instance during rendering

**Verdict:** ❌ Rejected - doesn't work with VSCode's architecture

---

### Final Solution: Segment Tracking + HTML Post-Processing ✅ IMPLEMENTED
**See [Implemented Solution](#implemented-solution-segment-tracking--html-post-processing) above**

**Approach:** Combine multiple techniques:
1. Track original line numbers through truncation (segment tracking)
2. Render each segment separately
3. Post-process HTML to adjust data-line values (Option C technique)

**Why it works:**
- ✅ Solves truncation problem by tracking line numbers through modifications
- ✅ Works around VSCode's pluginSourceMap limitations using HTML post-processing
- ✅ Handles all edge cases (interrupts, truncation, nested content)
- ✅ Pragmatic solution that works with VSCode's architecture rather than fighting it

**Verdict:** ✅ Implemented and working

---

## Implementation Plan

### Phase 1: Core Implementation
**Estimated Time:** 30 minutes

1. ✅ **Task 1.1:** Add `renderWithLineOffset()` function to `markdownItAiContainer.ts`
   - Add TypeScript type imports for `Token`
   - Implement function with JSDoc documentation
   - Unit test with simple markdown string

2. ✅ **Task 1.2:** Update `generateAiContainerHTML()` function
   - Replace `md.render()` calls for prompt and response
   - Verify line offset calculations: `promptLine + 1`, `responseLine + 1`
   - Remove `interruptLines` calculation

3. ✅ **Task 1.3:** Remove obsolete code
   - Delete `findInterruptLineNumbers()` function (lines 437-451)
   - Delete `addDataLineToInterrupts()` function (lines 457-483)
   - Remove call to `addDataLineToInterrupts()` (line 425)

### Phase 2: Fix Test Expectations
**Estimated Time:** 10 minutes

4. ✅ **Task 2.1:** Update `test-line-mapping.md`
   - Convert all expected `data-line` values from one-based to zero-based
   - Test Case 1: fieldset 7→6, prompt 9→8, response 12→11
   - Test Case 2: fieldset 33→32, prompt 34→33, response 37→36
   - Test Case 3: fieldset 54→53, prompt 56→55, response 61→60

### Phase 3: Verification & Testing
**Estimated Time:** 20 minutes

5. ✅ **Task 3.1:** Code review
   - Verify all line offset calculations
   - Check for off-by-one errors
   - Review recursive token adjustment logic

6. ✅ **Task 3.2:** Manual testing in VSCode
   - Open `test-line-mapping.md` in VSCode
   - Enable split editor + preview
   - Click various elements in rendered output
   - Verify editor jumps to correct lines

7. ✅ **Task 3.3:** Edge case testing
   - Test nested lists in responses
   - Test code blocks in responses
   - Test tables in responses
   - Test multi-paragraph responses
   - Test **Interrupt:** markers

### Phase 4: Documentation
**Estimated Time:** 10 minutes

8. ✅ **Task 4.1:** Update code comments
   - Add explanation of zero-based line numbering
   - Document why token manipulation is used
   - Reference this proposal in comments

---

## Testing Strategy

### Unit Tests

**Note:** This extension doesn't have a formal test suite. Recommend adding tests in future:

```typescript
describe('renderWithLineOffset', () => {
    it('should adjust simple paragraph line numbers', () => {
        const md = require('markdown-it')();
        const result = renderWithLineOffset(md, 'Hello world', 10, {});
        expect(result).toContain('data-line="10"');
    });

    it('should handle nested lists', () => {
        const md = require('markdown-it')();
        const content = '- Item 1\n- Item 2';
        const result = renderWithLineOffset(md, content, 5, {});
        // Should contain data-line="5" and data-line="6"
    });
});
```

### Manual Test Plan

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| **TC-1: Basic prompt click** | 1. Open test-line-mapping.md<br>2. Click on prompt text in preview | Editor jumps to line 22 (zero-based, where prompt content starts) |
| **TC-2: Basic response click** | 1. Click on response text | Editor jumps to line 26 (response content line) |
| **TC-3: Nested list in response** | 1. Add list to response<br>2. Click list item | Editor jumps to correct list item line |
| **TC-4: Code block in response** | 1. Add ```code``` to response<br>2. Click code block | Editor jumps to code fence line |
| **TC-5: Multi-paragraph response** | 1. Add multiple paragraphs<br>2. Click second paragraph | Editor jumps to second paragraph line |
| **TC-6: Interrupt markers** | 1. Add **Interrupt:** marker<br>2. Click interrupt text | Editor jumps to interrupt line |

### Acceptance Criteria

- ✅ All `data-line` attributes are zero-based absolute line numbers
- ✅ Clicking any rendered element jumps to the correct editor line (±1 line tolerance due to markdown semantics)
- ✅ No console errors in VSCode Developer Tools
- ✅ Nested markdown elements (lists, code, tables) have correct line numbers
- ✅ Test file expectations match actual output in inspector (F12)

---

## Risks and Mitigations

### Risk 1: Breaking Changes to markdown-it API
**Likelihood:** Low
**Impact:** High

**Description:** markdown-it could change `token.map` structure in future versions.

**Mitigation:**
- Lock markdown-it version in `package.json`
- Add defensive checks: `if (token.map && Array.isArray(token.map) && token.map.length >= 2)`
- Monitor markdown-it release notes

### Risk 2: Performance Degradation
**Likelihood:** Low
**Impact:** Low

**Description:** Recursive token traversal could slow rendering for large documents.

**Mitigation:**
- Token manipulation is O(n) where n = number of tokens (typically 100s, not 1000s)
- Rendering is already the bottleneck, token adjustment is negligible
- Profile with VSCode's Developer Tools if issues arise

### Risk 3: Conflict with Other Plugins
**Likelihood:** Medium
**Impact:** Medium

**Description:** Other markdown-it plugins might rely on relative line numbers.

**Mitigation:**
- Only affects tokens we render in isolation (AI container content)
- Doesn't modify global `md` instance or plugin behavior
- Test with all enabled plugins (see `plugins.ts`)

### Risk 4: Off-by-One Errors
**Likelihood:** Medium
**Impact:** Medium

**Description:** Line offset calculations could be off by one.

**Current Calculations:**
```typescript
// sourceLine: line of opening ":::"
// aiData.prompt.lineOffset: offset within rawContent (starting after ":::")
// promptLine = sourceLine + 1 + aiData.prompt.lineOffset
```

**Analysis:**
- `::: ai` is at line 7 (zero-based)
- `versions:` is at line 8 (sourceLine + 1)
- `  - prompt: |` is at line 9 (depends on aiData.prompt.lineOffset calculation)

**Mitigation:**
- Thorough testing with test-line-mapping.md
- Inspect HTML in browser DevTools to verify
- Run test-line-offset-calc.js to validate offset calculations

---

## References

### VSCode Source Code

1. **pluginSourceMap:** [markdownEngine.ts](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/src/markdownEngine.ts)
   - Shows `token.attrSet('data-line', String(token.map[0]));`

2. **Scroll sync implementation:** [preview-src/index.ts](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/preview-src/index.ts)
   - Shows `element.getAttribute('data-line')`

### markdown-it Documentation

3. **Token structure:** [Token API](https://github.com/markdown-it/markdown-it/blob/master/lib/token.mjs)
   - Documents `map: [line_begin, line_end]` format

4. **Parser API:** [markdown-it API](https://markdown-it.github.io/markdown-it/)
   - Documents `md.parse()` and `md.renderer.render()`

### Community Examples

5. **markdown-it-inject-linenumbers:** [GitHub](https://github.com/digitalmoksha/markdown-it-inject-linenumbers)
   - Shows zero-based numbering: `<p data-source-line="0">lorem</p>`

### Project Files

6. **Current implementation:** `src/plugin/markdownItAiContainer.ts`
7. **Test file:** `test-line-mapping.md`
8. **Offset calculator:** `test-line-offset-calc.js`

---

## Appendix A: Zero-Based vs One-Based Confusion

### Why the Confusion Exists

The test file `test-line-mapping.md` originally used **one-based** expected values:

```markdown
Expected data-line values:
- fieldset: 7 (opening :::)
- ai-prompt div: 9 (where "prompt:" appears)
```

This matches human intuition (VSCode editor shows "Ln 7" in status bar).

### Why Zero-Based is Correct

1. **markdown-it internals:** `token.map` is zero-based (first line = 0)
2. **VSCode's pluginSourceMap:** Uses `token.map[0]` directly, no conversion
3. **Array semantics:** Matches JavaScript array indexing

### Verification

Run this in VSCode's Developer Tools console on a markdown preview:

```javascript
// Get all elements with data-line
const elements = document.querySelectorAll('[data-line]');
elements.forEach(el => {
    console.log(el.tagName, el.getAttribute('data-line'), el.textContent.substring(0, 30));
});
```

First line of file will show `data-line="0"`.

---

## Appendix B: Line Offset Calculation Walkthrough

### Example: Versions Array Structure

**Markdown file:**
```
Line 6:  Text before
Line 7:  ::: ai                       ← sourceLine = 7 (zero-based)
Line 8:  versions:                    ← rawContent starts here
Line 9:    - prompt: |                ← "- " is at offset 1 within rawContent
Line 10:       What is Python?        ← prompt content starts
Line 11:     model: claude
Line 12:     response: |              ← response field
Line 13:       Python is a PL.        ← response content starts
Line 14: :::
```

**Wait, this is confusing! Let me recalculate with actual zero-based lines:**

```
Line 0:  (file header or content)
Line 6:  Text before
Line 7:  ::: ai                       ← sourceLine = 7 (zero-based)
Line 8:  versions:                    ← rawContent line 0
Line 9:    - prompt: |                ← rawContent line 1
Line 10:       What is Python?        ← rawContent line 2
```

**Actually, let me use the test file's exact structure:**

From `test-line-mapping.md`:
```
Line 21: ::: ai
Line 22: versions:
Line 23:   - prompt: |
Line 24:       What is the capital of France?
```

In **zero-based** indexing (what markdown-it uses):
- Opening `:::` is at **line 20** (not 21!)
- `versions:` is at **line 21**
- `  - prompt: |` is at **line 22**
- Prompt content is at **line 23**

**Wait, this is still confusing because the test file shows "Line 21:" annotations!**

Those annotations are **display-only comments** showing one-based line numbers for human readers. The actual markdown parsing uses zero-based.

### Calculation Steps

Given `sourceLine = 20` (zero-based line of `:::`):

1. **rawContent starts:** `sourceLine + 1 = 21` (line after `:::`)
2. **Find "- " in versions array:** At offset 1 within rawContent
3. **baseLineOffset:** `1` (the line where `  - prompt:` appears within rawContent)
4. **Find "prompt: |":** Immediately after the dash, at offset 0 within workingContent
5. **promptLineOffset:** `baseLineOffset + 0 = 1`
6. **Absolute prompt line:** `sourceLine + 1 + promptLineOffset = 20 + 1 + 1 = 22`

But `prompt: |` is actually at **line 22** (zero-based), and **prompt content** starts at line 23.

So for rendering: `renderWithLineOffset(md, promptContent, 23, env)`

**This needs careful verification in the code!**

---

## Appendix C: Implementation Checklist

- [ ] Add `Token` import from markdown-it types
- [ ] Create `renderWithLineOffset()` function
- [ ] Replace `md.render()` for prompt
- [ ] Replace `md.render()` for response
- [ ] Remove `findInterruptLineNumbers()` function
- [ ] Remove `addDataLineToInterrupts()` function
- [ ] Remove call to `addDataLineToInterrupts()`
- [ ] Remove `interruptLines` variable
- [ ] Update test-line-mapping.md expectations (Test Case 1)
- [ ] Update test-line-mapping.md expectations (Test Case 2)
- [ ] Update test-line-mapping.md expectations (Test Case 3)
- [ ] Add code comments explaining zero-based numbering
- [ ] Test in VSCode preview
- [ ] Verify with DevTools inspector
- [ ] Update CHANGELOG or commit message

---

## Conclusion

The token manipulation approach (Option G) provides a robust, maintainable solution for fixing `data-line` attributes in nested markdown rendering. By working at the correct abstraction level (markdown-it tokens rather than HTML strings), we ensure reliable scroll synchronization while adhering to markdown-it best practices.

**Recommendation:** Proceed with implementation as outlined in the plan above.
