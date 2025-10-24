# Implementation Analysis: AI Container Feature

## Critical Issue Identified

### Problem: markdown-it-container Processes Content as Markdown

The existing `markdown-it-container` plugin (v4.0.0) is designed to **process the content between `:::` markers as markdown**. This means:

```markdown
::: ai
versions:
- prompt: foo
:::
```

Would be parsed as:
- Text: "versions:"
- List item: "- prompt: foo"

**This breaks YAML parsing** because the content is tokenized as markdown, not preserved as raw text.

### Solution: Custom Block Parser

Instead of modifying the existing container plugin, we need to create a **custom block parser** (similar to admonitions) that:

1. Registers BEFORE the generic container rule
2. Specifically matches `::: ai` syntax
3. Extracts RAW content (not markdown-processed)
4. Parses as YAML
5. Renders HTML directly

## Implementation Approach

### Architecture Decision

**Create separate plugin: `/src/plugin/markdownItAiContainer.ts`**

This plugin will:
- Register custom block rule: `md.block.ruler.after('fence', 'ai_container', parseAiContainer)`
- Match `::: ai` at line start (colon marker: charCode 58)
- Extract raw source text until closing `:::`
- Parse YAML with `js-yaml`
- Render prompt/response as markdown (recursive `md.render()`)
- Create `html_block` token with generated HTML
- NOT call `state.md.block.tokenize()` (which would parse content as markdown)

### Token Generation Strategy

Unlike admonitions which tokenize content as markdown, we'll:

1. Extract raw text from `state.src` between markers
2. Parse YAML externally
3. Generate complete HTML string
4. Push as `html_block` token (allows raw HTML)
5. Renderer outputs the HTML as-is

```typescript
// Pseudo-code
const rawContent = state.src.slice(contentStart, contentEnd);
const data = yaml.load(rawContent);
const htmlString = generateAiContainerHTML(data, md, env);
const token = state.push('html_block', '', 0);
token.content = htmlString;
```

## Edge Cases & Solutions

### 1. Content Extraction

**Issue**: How to get raw content between `::: ai` and `:::`?

**Solution**: Use `state.src` (raw source) with line markers:
```typescript
const contentStart = state.bMarks[startLine + 1];
const contentEnd = state.bMarks[closingLine];
const rawContent = state.src.slice(contentStart, contentEnd);
```

### 2. Closing Marker Detection

**Issue**: What if no closing `:::`?

**Solution**:
- Loop through lines looking for closing marker
- If reached `endLine` without finding it, auto-close at document end
- Similar to admonition's approach (lines 100-116)

### 3. Nested Containers

**Issue**: What if user nests `::: ai` inside `::: ai`?

**Solution**:
- Close on FIRST `:::` encountered (no nesting support)
- This is acceptable - nested AI containers don't make sense
- User can use multiple sequential containers instead

### 4. Invalid YAML

**Issue**: Malformed YAML syntax

**Solution**:
```typescript
try {
  const data = yaml.load(rawContent);
  // ... process
} catch (e) {
  // Return error HTML
  return `<div class="ai-container ai-error">
    <p><strong>Error parsing AI container YAML:</strong></p>
    <pre>${escapeHtml(e.message)}</pre>
  </div>`;
}
```

### 5. Missing or Empty Fields

**Issue**: YAML missing `prompt` or `response` fields

**Solution**:
```typescript
const versions = data?.versions?.[0] || data || {};
const prompt = versions.prompt || '';
const response = versions.response || '';

// Even if empty, render empty divs (graceful degradation)
```

### 6. Line Counting for "Last 10 Lines"

**Issue**: How to count lines? What about different line endings?

**Solution**:
```typescript
// Normalize line endings and trim
const normalized = (response || '').trim();
const lines = normalized.split(/\r?\n/);

// Take last 10 (or fewer if response is shorter)
const last10 = lines.slice(-10);
const content = last10.join('\n');
```

**Edge cases**:
- Empty response: `lines = ['']`, last10 = `['']`, renders as empty div ✓
- 5-line response: Shows all 5 lines ✓
- 1-line response: Shows that 1 line ✓
- 15-line response: Shows lines 6-15 ✓

### 7. XSS and Security

**Issue**: User-provided YAML could contain malicious content

**Solutions**:
1. **YAML parsing**: js-yaml is safe, doesn't execute code
2. **Markdown rendering**: markdown-it escapes HTML by default
   - If prompt contains `<script>`, it becomes `&lt;script&gt;`
3. **HTML escaping**: Escape any raw HTML we generate
4. **CSP**: VS Code's preview has Content Security Policy

**Verify**: Test with malicious input:
```yaml
prompt: |
  <script>alert('xss')</script>
response: |
  <img src=x onerror=alert('xss')>
```

Should render escaped.

### 8. Recursive Markdown Rendering

**Issue**: What if prompt/response contain `::: ai`?

**Scenarios**:
```yaml
prompt: |
  Example:
  ::: ai
  nested
  :::
```

**Analysis**:
- We extract raw content BEFORE markdown parsing
- So the outer `::: ai` is handled by our parser
- The inner `::: ai` (in YAML string) gets passed to `md.render()`
- markdown-it would try to parse it, but it's already extracted from token stream
- Should be safe, but could cause confusion

**Solution**: Document that nesting isn't supported. If users need to show example AI containers, they should use code fences:

````markdown
::: ai
prompt: |
  Example:
  ```
  ::: ai
  example
  :::
  ```
::::
````

### 9. Environment Context

**Issue**: Recursive `md.render()` needs context for features like image resolution

**Solution**: Pass `env` object through:
```typescript
function generateHTML(data: any, md: MarkdownIt, env: any): string {
  const promptHtml = md.render(prompt, env);
  const responseHtml = md.render(last10Lines, env);
  // ...
}
```

The `env` object from the block parser state should be passed to renders.

### 10. YAML Structure Variations

**Issue**: Support both structures:
```yaml
# Structure A (from test.md)
versions:
- prompt: |
    text
  response: |
    text

# Structure B (simplified)
prompt: |
  text
response: |
  text
```

**Solution**:
```typescript
const parsed = yaml.load(rawContent);
let aiData;

if (parsed?.versions && Array.isArray(parsed.versions)) {
  // Structure A: take first version
  aiData = parsed.versions[0] || {};
} else {
  // Structure B: direct fields
  aiData = parsed || {};
}

const prompt = aiData.prompt || '';
const response = aiData.response || '';
const model = aiData.model || ''; // Future: could display this
```

### 11. Whitespace and Indentation

**Issue**: YAML `|` preserves whitespace, indented content

**Example**:
```yaml
response: |
      Indented content
      More content
```

**Behavior**: js-yaml handles this correctly:
- Returns string with appropriate indentation stripped based on first line
- Preserves relative indentation within the block

**Verification needed**: Test with various indentation levels

### 12. Empty YAML Block

**Issue**: What if `::: ai` has no content?

```markdown
::: ai
:::
```

**Solution**:
```typescript
const rawContent = state.src.slice(contentStart, contentEnd).trim();

if (!rawContent) {
  // Empty container
  return `<div class="ai-container ai-error">
    <p>Empty AI container (no YAML content)</p>
  </div>`;
}
```

### 13. Fieldset Browser Compatibility

**Issue**: `<fieldset>` and `<legend>` have browser-specific styling

**Solution**: CSS resets
```css
.ai-container {
  min-width: 0; /* Override browser default */
  border: 2px solid rgba(100, 150, 255, 0.6);
  padding: 1rem;
  margin: 1.5rem 0;
  /* ... */
}

.ai-container legend {
  padding: 0 0.5rem;
  /* ... */
}
```

### 14. Theme Compatibility

**Issue**: CSS must work in both light and dark VS Code themes

**Solution**: Use CSS variables from VS Code
```css
.ai-prompt,
.ai-response {
  color: var(--vscode-editor-foreground);
}

.ai-container {
  background-color: var(--vscode-textBlockQuote-background, rgba(100, 150, 255, 0.03));
  border-color: var(--vscode-textBlockQuote-border, rgba(100, 150, 255, 0.6));
}
```

### 15. Performance

**Issue**: Recursive `md.render()` calls could be slow

**Analysis**:
- Each `::: ai` block calls `md.render()` twice (prompt + response)
- Markdown-it is fast, but recursive rendering adds overhead
- Last 10 lines limits content size

**Mitigation**:
- Acceptable for reasonable documents (< 50 AI containers)
- If performance issues arise, could add caching or limits

### 16. Multi-line vs Single-line Strings

**Issue**: YAML supports multiple string formats

**Examples**:
```yaml
# Literal block scalar (preserves newlines)
response: |
  Line 1
  Line 2

# Folded block scalar (folds newlines)
response: >
  Line 1
  Line 2

# Plain scalar
response: Single line
```

**Solution**: js-yaml handles all formats correctly. No special handling needed.

### 17. Special Characters in YAML

**Issue**: YAML with quotes, colons, special chars

**Example**:
```yaml
prompt: |
  What is "markdown"?
  Key: value pairs
```

**Solution**: Using `|` literal block scalar avoids parsing issues. js-yaml handles this correctly.

### 18. Response Line Counting After Markdown

**Issue**: User said "last 10-lines (markdown rendered)"

**Interpretation**:
- Take last 10 lines of SOURCE (YAML string) ✓
- OR render everything, then take last 10 lines of HTML? ✗

**Decision**: Take last 10 source lines, THEN render. Reasons:
1. Markdown rendering changes line counts unpredictably
2. "10 lines" refers to source content
3. Simpler implementation

### 19. Backward Compatibility

**Issue**: Will this break existing documents?

**Analysis**:
- Generic `::: warning`, `::: note` etc. still handled by markdown-it-container
- Only `::: ai` uses new parser
- No existing documents have `::: ai` (new syntax)

**Solution**: No breaking changes. Safe to implement.

### 20. Testing Requirements

**Test cases needed**:

1. **Valid YAML, both structures**
   - versions[0] structure
   - Direct fields structure
2. **Invalid YAML** - should show error
3. **Missing fields** - should handle gracefully
4. **Empty container** - should show error
5. **Short response** (< 10 lines) - show all
6. **Long response** (> 10 lines) - show last 10
7. **Empty response** - empty div
8. **No closing :::** - should auto-close
9. **XSS attempts** - should escape
10. **Markdown in prompt/response** - should render (bold, code, etc.)
11. **Multiple AI containers** - should all render
12. **Mixed containers** (ai + warning) - should both work
13. **Theme switching** - should look good in light/dark
14. **Indented YAML** - should parse correctly

## Files to Create/Modify

### New Files

1. **`/src/plugin/markdownItAiContainer.ts`** (~150 lines)
   - Custom block parser
   - YAML parsing logic
   - HTML generation
   - Error handling

2. **`/styles/markdown-it-ai-container.css`** (~80 lines)
   - Fieldset styles with resets
   - Theme-aware colors
   - Error state styles

### Modified Files

1. **`/src/plugin/plugins.ts`**
   - Import: `import { MarkdownItAiContainer } from './markdownItAiContainer';`
   - Add to myPlugins: `'markdown-it-ai-container': MarkdownItAiContainer`
   - Add to plugins array: `$('markdown-it-ai-container')`

2. **`/package.json`**
   - Add to `markdown.previewStyles` array:
     ```json
     "markdown.previewStyles": [
       "styles/markdown-it-admonition.css",
       "styles/markdown-it-kbd.css",
       "styles/markdown-it-ai-container.css"
     ]
     ```

## Implementation Checklist

- [ ] Create markdownItAiContainer.ts with block parser
- [ ] Implement `::: ai` marker detection (colon charCode 58)
- [ ] Implement closing `:::` detection with auto-close
- [ ] Extract raw content from state.src
- [ ] Parse YAML with try/catch error handling
- [ ] Support both versions[0] and direct field structures
- [ ] Handle missing/empty fields gracefully
- [ ] Implement "last 10 lines" logic with line ending normalization
- [ ] Recursive markdown rendering with env context
- [ ] Generate HTML with fieldset/legend structure
- [ ] Create html_block token
- [ ] Register block rule in plugin
- [ ] Create CSS with fieldset resets
- [ ] Use VS Code theme variables
- [ ] Style error states
- [ ] Register plugin in plugins.ts
- [ ] Register CSS in package.json
- [ ] Test with all edge cases listed above
- [ ] Verify XSS protection
- [ ] Verify theme compatibility
- [ ] Verify backward compatibility with other containers

## Potential Future Enhancements

*(Not in initial implementation)*

1. Model display in legend: `<legend>ai · claude-3-5-sonnet</legend>`
2. Configurable line limit (setting: `markdownExtended.aiContainerLines`)
3. Expand/collapse for full response
4. Version navigation if multiple versions exist
5. Copy button for prompt/response
6. Diff view between versions
7. Syntax highlighting for prompt patterns

## Conclusion

This is a **medium-complexity feature** requiring:

- Deep understanding of markdown-it's block parser API
- Careful handling of raw content extraction
- Robust error handling for YAML parsing
- Theme-aware CSS styling
- Comprehensive edge case testing

**Estimated implementation time**: 2-3 hours including testing

**Risk level**: Medium - requires custom block parser, but pattern is well-established (admonitions)

**Recommendation**: Proceed with implementation following the outlined approach.
