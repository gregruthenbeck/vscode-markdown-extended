# Proposal: AI Conversation Container Support

## Overview

This proposal outlines the addition of a custom container type for rendering AI conversation data in markdown documents. The feature extends the existing markdown-it-container plugin to parse YAML-formatted AI conversation logs and render them in a visually distinct, framed format with markdown-rendered content.

## Feature Specification

### Syntax

Users can embed AI conversation data using the following markdown syntax:

```markdown
::: ai
versions:

- prompt: |
      Here's our prompt
  model: claude-3-5-sonnet
  response: |
      This is the response
:::
```

### Rendering Behavior

The AI container will render as:

1. **Framed Region**: A bordered fieldset with "ai" embedded in the top border
2. **Prompt Section**: The `prompt` field rendered as markdown
3. **Horizontal Separator**: Visual divider between prompt and response
4. **Response Section**: The last 10 lines of the `response` field rendered as markdown

### User-Facing Features

- **Markdown Support**: Both prompt and response fields are processed through the markdown renderer, supporting all extension features (bold, italic, code blocks, etc.)
- **Flexible Schema**: The YAML structure is validated loosely - missing fields or additional fields are handled gracefully
- **Visual Distinction**: The container has a distinct appearance making AI conversations easy to identify in rendered documents
- **Line Limiting**: Only the last 10 lines of the response are shown to prevent overwhelming the preview

### Use Cases

- Documenting LLM interactions during development
- Capturing prompt engineering iterations
- Creating examples for AI-assisted coding workflows
- Maintaining conversation logs in technical documentation
- Tracking model responses across versions

## Technical Implementation

### Architecture

The implementation leverages existing infrastructure:

1. **markdown-it-container**: Already integrated plugin for custom containers
2. **js-yaml**: Already available dependency for YAML parsing
3. **Recursive Markdown Rendering**: Use the existing markdown instance to render nested content

### File Modifications

#### 1. Container Plugin (`/src/plugin/markdownItContainer.ts`)

**Current Behavior**:
- Wraps all container content in a `<div class="[container-name]">`
- No special processing of content

**New Behavior**:
- Detect `ai` container type
- Parse YAML content
- Extract and render `prompt` and `response` fields
- Generate structured HTML with fieldset/legend
- Fall back to original behavior for non-ai containers

**Implementation Details**:

```typescript
import { MarkdownIt } from '../@types/markdown-it';
import * as container from 'markdown-it-container';
import * as yaml from 'js-yaml';

export function MarkdownItContainer(md: MarkdownIt) {
    md.use(container, "container", { validate: validate, render: render(md) });
}

function validate(): boolean {
    return true;
}

function render(md: MarkdownIt) {
    return function(tokens, idx): string {
        const containerName = tokens[idx].info.trim();

        if (tokens[idx].nesting === 1) {
            // Opening tag
            if (containerName === 'ai') {
                // Extract content between opening and closing tags
                let content = '';
                for (let i = idx + 1; i < tokens.length; i++) {
                    if (tokens[i].type === 'container_container_close') break;
                    if (tokens[i].type === 'inline') content += tokens[i].content;
                    if (tokens[i].type === 'fence') content += tokens[i].content;
                }

                try {
                    const data = yaml.load(content);
                    const versions = data?.versions?.[0] || data;
                    const prompt = versions.prompt || '';
                    const response = versions.response || '';

                    // Take last 10 lines of response
                    const responseLines = response.split('\n');
                    const last10Lines = responseLines.slice(-10).join('\n');

                    // Render markdown
                    const renderedPrompt = md.render(prompt);
                    const renderedResponse = md.render(last10Lines);

                    return `<fieldset class="ai-container">
  <legend>ai</legend>
  <div class="ai-prompt">${renderedPrompt}</div>
  <hr class="ai-separator">
  <div class="ai-response">${renderedResponse}</div>
`;
                } catch (e) {
                    // Fallback for invalid YAML
                    return `<div class="${escape(containerName)} ai-error">\n`;
                }
            } else {
                // Original behavior for other containers
                return `<div class="${escape(containerName)}">\n`;
            }
        } else {
            // Closing tag
            if (containerName === 'ai') {
                return '</fieldset>\n';
            } else {
                return '</div>\n';
            }
        }
    };
}

function escape(str: string): string {
    return str.replace(/"/g, '&quot;')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
```

**Key Design Decisions**:
- Use `<fieldset>` and `<legend>` for native "label in border" HTML semantics
- Parse YAML flexibly - support both `versions[0]` structure and direct fields
- Handle errors gracefully with fallback to error styling
- Preserve original container behavior for backward compatibility

#### 2. CSS Stylesheet (`/styles/markdown-it-ai-container.css`)

**New File** - Styling for AI containers:

```css
/* AI Container Base Styles */
.ai-container {
  border: 2px solid rgba(100, 150, 255, 0.6);
  border-radius: 8px;
  padding: 1rem;
  margin: 1.5rem 0;
  background-color: rgba(100, 150, 255, 0.03);
}

.ai-container legend {
  font-weight: bold;
  font-size: 0.9rem;
  color: rgba(100, 150, 255, 0.9);
  padding: 0 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Prompt Section */
.ai-prompt {
  margin-bottom: 0.5rem;
  color: var(--vscode-editor-foreground);
}

.ai-prompt p:first-child {
  margin-top: 0;
}

.ai-prompt p:last-child {
  margin-bottom: 0;
}

/* Separator */
.ai-separator {
  border: none;
  border-top: 1px solid rgba(100, 150, 255, 0.3);
  margin: 1rem 0;
}

/* Response Section */
.ai-response {
  margin-top: 0.5rem;
  color: var(--vscode-editor-foreground);
}

.ai-response p:first-child {
  margin-top: 0;
}

.ai-response p:last-child {
  margin-bottom: 0;
}

/* Error State */
.ai-error {
  border-color: rgba(255, 100, 100, 0.6);
  background-color: rgba(255, 100, 100, 0.05);
}

.ai-error::before {
  content: "Error parsing AI container YAML";
  display: block;
  color: rgba(255, 100, 100, 0.9);
  font-weight: bold;
  margin-bottom: 0.5rem;
}
```

**Design Principles**:
- Use VS Code theme variables for foreground colors (theme-aware)
- Subtle background tint for visual grouping
- Clear visual hierarchy between prompt and response
- Accessible color contrast ratios
- Consistent spacing with other markdown elements

#### 3. Package Configuration (`package.json`)

**Change**: Register the new CSS file in the `markdown.previewStyles` contribution.

**Before** (lines 341-344):
```json
"markdown.previewStyles": [
  "styles/markdown-it-admonition.css",
  "styles/markdown-it-kbd.css"
]
```

**After**:
```json
"markdown.previewStyles": [
  "styles/markdown-it-admonition.css",
  "styles/markdown-it-kbd.css",
  "styles/markdown-it-ai-container.css"
]
```

### Error Handling

The implementation handles several error cases:

1. **Invalid YAML**: Catches parse errors and renders error state
2. **Missing Fields**: Uses empty strings for missing prompt/response
3. **Short Responses**: If response has < 10 lines, shows all lines
4. **Malformed Structure**: Supports both `versions[0]` and direct field access

### Testing Strategy

1. **Manual Testing**:
   - Open `test.md` in Extension Development Host
   - Verify framed border with "ai" label renders correctly
   - Verify prompt markdown is processed (bold, italic, etc.)
   - Verify only last 10 lines of response appear
   - Verify separator renders between sections

2. **Edge Cases**:
   - Empty prompt field
   - Empty response field
   - Response with fewer than 10 lines
   - Invalid YAML syntax
   - Missing `versions` key
   - Additional fields in YAML (model, etc.)

3. **Regression Testing**:
   - Verify existing containers (`::: note`, etc.) still work
   - Verify other markdown features unaffected

## Benefits

1. **Minimal Changes**: Leverages existing infrastructure (js-yaml, markdown-it-container)
2. **Backward Compatible**: Doesn't affect existing container behavior
3. **Extensible**: Easy to add more AI-specific features later (model display, version toggles)
4. **Theme Aware**: Uses VS Code theme variables for consistent appearance
5. **Well-Scoped**: Single-purpose feature with clear boundaries

## Future Enhancements

Potential future improvements (not in initial implementation):

1. **Model Badge**: Display the `model` field in the legend
2. **Full Response Toggle**: Click to expand/collapse full response
3. **Version Navigation**: If multiple versions exist, add tabs/arrows to switch
4. **Copy Button**: Quick copy of prompt or response
5. **Syntax Highlighting**: Special highlighting for prompt engineering patterns
6. **Export Support**: Ensure AI containers export correctly to PDF/HTML/PNG

## Migration Path

No migration needed - this is a new feature. Existing markdown files without `::: ai` containers are unaffected.

Users can start using the feature immediately after the extension is updated by adding `::: ai` blocks to their markdown files.

## Dependencies

- **js-yaml** (^4.1.0): Already in dependencies
- **markdown-it-container**: Already integrated

No new dependencies required.

## Timeline

Implementation can be completed in a single development session:

1. Modify container plugin (30 minutes)
2. Create CSS stylesheet (15 minutes)
3. Update package.json (2 minutes)
4. Test and iterate (20 minutes)

**Total estimated time**: ~1 hour

## Conclusion

This proposal adds a valuable feature for documenting AI interactions while maintaining the extension's clean architecture and requiring minimal code changes. The implementation is straightforward, well-scoped, and builds naturally on existing infrastructure.
