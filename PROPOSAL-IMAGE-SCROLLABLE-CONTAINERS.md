# Proposal: Auto-Scrollable Containers for Tall Images

## Problem Statement

Mobile screenshots and other tall-narrow images currently display at full height in markdown previews, consuming excessive vertical space and requiring extensive scrolling. This makes documents with many mobile screenshots difficult to navigate and review.

**Example Issues:**
- Mobile screenshot (375×812px) displays at ~812px height
- Multiple screenshots create very long documents
- Hard to scan/review content efficiently
- Preview becomes unwieldy with 5+ screenshots

## Proposed Solution

**Automatically detect and constrain tall images using CSS aspect-ratio detection**, without requiring manual class additions or markdown modifications.

### Key Features

1. **Automatic Detection**: CSS detects images with tall aspect ratios (height > width)
2. **Default Styling**: Tall images automatically get max-height constraint + scrollable overflow
3. **Zero Markdown Changes**: Works with standard `![alt](image.jpg)` syntax
4. **Responsive**: Adapts to preview width
5. **Visual Feedback**: Container styling indicates scrollability

## Technical Approach

### CSS-Based Aspect Ratio Detection

Modern CSS supports aspect-ratio detection via media queries on images:

```css
/* Target images where height > width (portrait orientation) */
img[src] {
  /* Check if image is tall (aspect-ratio < 1) */
  aspect-ratio: attr(width) / attr(height);
}

/* Alternative: Use container queries (newer approach) */
img {
  max-height: 100%;
  max-width: 100%;
}

/* Tall images: constrain height, enable scrolling */
img[style*="height"] {
  max-height: 600px;
  object-fit: contain;
}
```

**Limitation**: Pure CSS cannot reliably detect aspect ratio without JavaScript or explicit dimensions.

### Recommended Implementation: CSS Container Queries + Default Styles

**Strategy**: Apply scrollable container to ALL images by default, with specific styling for tall portraits.

```css
/* Wrap all images in constrained container */
.markdown-body img {
  max-width: 100%;
  height: auto;
}

/* For portrait images (tall), add scrollable frame */
.markdown-body img {
  max-height: 600px;
  object-fit: contain;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* Wrapper for scroll behavior */
.markdown-body p > img {
  display: block;
  max-height: 600px;
  overflow-y: auto;
  overflow-x: hidden;
}
```

**Issue**: `<img>` elements themselves cannot have scroll overflow (they're replaced elements).

### Solution: JavaScript-Enhanced Detection

Since pure CSS cannot wrap images in scrollable containers, we need a markdown-it plugin:

**Plugin**: `markdownItImageContainer.ts`

**Algorithm**:
1. Hook into markdown-it image rendering
2. When rendering `![alt](src)`, check if special handling needed
3. For images matching tall-image pattern (by filename or explicit marker), wrap in scrollable `<div>`
4. Apply container class for CSS styling

**Detection Methods** (in priority order):

#### Method 1: Filename Pattern Detection
```markdown
![Screenshot](mobile-screenshot.jpg)
![UI](screenshot-375x812.jpg)
```

**Pattern**: `/(mobile|screenshot|portrait|tall).*\.(jpg|png)/i`

Pros:
- Zero markdown changes for typical naming
- Works immediately for existing files
- Convention-based

Cons:
- Relies on naming convention
- May miss some images
- May false-positive on some names

#### Method 2: Explicit Marker (Fallback)
```markdown
![Screenshot](image.jpg "tall")
![Screenshot](image.jpg "mobile-screenshot")
```

**Detection**: Check image title attribute for keywords

Pros:
- Explicit control
- No false positives
- Works with any filename

Cons:
- Requires markdown modification
- Manual per-image

#### Method 3: Hybrid (Recommended)
- Auto-detect by filename pattern (Method 1)
- Allow explicit override via title (Method 2)
- Provide opt-out: `![](image.jpg "no-scroll")`

## Implementation Plan

### Phase 1: Create Plugin (Filename Detection)

**File**: `/src/plugin/markdownItImageContainer.ts`

```typescript
export function MarkdownItImageContainer(md: MarkdownIt) {
  const defaultRender = md.renderer.rules.image ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    const title = token.attrGet('title') || '';
    const alt = token.content;

    // Check for opt-out
    if (title === 'no-scroll') {
      token.attrSet('title', ''); // Remove marker
      return defaultRender(tokens, idx, options, env, self);
    }

    // Check if this should be scrollable
    const shouldScroll =
      title === 'tall' ||
      title === 'mobile-screenshot' ||
      /\b(mobile|screenshot|portrait|tall)\b.*\.(jpg|jpeg|png|webp)$/i.test(src);

    if (!shouldScroll) {
      return defaultRender(tokens, idx, options, env, self);
    }

    // Wrap in scrollable container
    const imgHtml = defaultRender(tokens, idx, options, env, self);
    return `<div class="image-scroll-container" data-type="mobile-screenshot">
  <div class="image-scroll-inner">
    ${imgHtml}
  </div>
</div>`;
  };
}
```

### Phase 2: Create CSS Styling

**File**: `/styles/markdown-it-image-container.css`

```css
/* Scrollable image container for tall/mobile screenshots */
.image-scroll-container {
  max-height: 600px;
  max-width: 400px; /* Typical mobile width */
  margin: 1rem auto;
  border: 1px solid var(--vscode-panel-border, #ddd);
  border-radius: 8px;
  background: var(--vscode-editor-background, #fff);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.image-scroll-inner {
  max-height: 600px;
  overflow-y: auto;
  overflow-x: hidden;
}

.image-scroll-inner img {
  display: block;
  width: 100%;
  height: auto;
  margin: 0;
}

/* Dark mode support */
.vscode-dark .image-scroll-container {
  border-color: var(--vscode-panel-border, #444);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Scrollbar styling for better UX */
.image-scroll-inner::-webkit-scrollbar {
  width: 8px;
}

.image-scroll-inner::-webkit-scrollbar-track {
  background: var(--vscode-scrollbarSlider-background, #f1f1f1);
}

.image-scroll-inner::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-hoverBackground, #888);
  border-radius: 4px;
}

.image-scroll-inner::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-activeBackground, #555);
}

/* Indicator that content is scrollable */
.image-scroll-container::after {
  content: "↕ Scroll to view full image";
  display: block;
  text-align: center;
  padding: 0.5rem;
  font-size: 0.85rem;
  color: var(--vscode-descriptionForeground, #666);
  background: var(--vscode-editor-background, #fff);
  border-top: 1px solid var(--vscode-panel-border, #ddd);
}

/* Hide indicator if image fits without scrolling */
.image-scroll-inner:not([data-overflow="true"]) + .image-scroll-container::after {
  display: none;
}

/* Responsive: wider on larger screens */
@media (min-width: 768px) {
  .image-scroll-container {
    max-width: 450px;
  }
}

@media (min-width: 1024px) {
  .image-scroll-container {
    max-width: 500px;
  }
}
```

### Phase 3: Register Plugin and CSS

**File**: `/src/plugin/plugins.ts`

```typescript
import { MarkdownItImageContainer } from './markdownItImageContainer';

const myPlugins = {
    // ... existing plugins
    'markdown-it-image-container': MarkdownItImageContainer
};

const plugins = [
    // ... existing plugins
    $('markdown-it-image-container'), // Add before generic container
];
```

**File**: `/package.json`

```json
{
  "contributes": {
    "markdown": {
      "previewStyles": [
        "./styles/markdown-it-admonition.css",
        "./styles/markdown-it-kbd.css",
        "./styles/markdown-it-ai-container.css",
        "./styles/markdown-it-image-container.css"
      ]
    }
  }
}
```

## Usage Examples

### Auto-Detected (No Changes Required)

```markdown
# Mobile App Screenshots

Here's the login screen:

![Login screen](mobile-screenshot-login.jpg)

And the dashboard:

![Dashboard](screenshot-dashboard-375x812.png)
```

**Result**: Both images automatically wrapped in scrollable containers.

### Explicit Control

```markdown
<!-- Force scrollable container -->
![Some tall image](image.jpg "tall")

<!-- Prevent scrollable container -->
![Wide screenshot](landscape.jpg "no-scroll")
```

### Mixed Content

```markdown
# Design Review

## Mobile Views (auto-scrollable)
![Home](mobile-home.jpg)
![Profile](mobile-profile.jpg)

## Desktop Views (normal display)
![Desktop home](desktop-home.png "no-scroll")
```

## Configuration (Future Enhancement)

Add user settings in `package.json`:

```json
{
  "markdownExtended.imageScrollContainer": {
    "enabled": true,
    "maxHeight": 600,
    "maxWidth": 400,
    "detectPattern": "/(mobile|screenshot|portrait|tall).*\\.(jpg|png)/i",
    "showScrollIndicator": true
  }
}
```

## Benefits

1. **Zero Friction**: Works with existing markdown, no syntax changes
2. **Convention Over Configuration**: Smart defaults based on filename
3. **Flexibility**: Explicit control when needed
4. **Better UX**: Documents with many screenshots are scannable
5. **Consistent**: All mobile screenshots displayed uniformly

## Alternatives Considered

### Alternative 1: Manual Classes (markdown-it-attrs)
```markdown
![Screenshot](image.jpg){.mobile-screenshot}
```

**Rejected**: Requires manual work per image, breaks with copy-paste.

### Alternative 2: Container Syntax
```markdown
::: mobile-screenshot
![Screenshot](image.jpg)
:::
```

**Rejected**: Too verbose, unfamiliar syntax.

### Alternative 3: Pure CSS (No JavaScript)
```css
img { max-height: 600px; }
```

**Rejected**: Cannot wrap in scrollable div without DOM manipulation.

## Implementation Complexity

- **Simple**: ~100 lines of TypeScript
- **CSS**: ~80 lines
- **Testing**: Use existing test.md with image examples
- **Compatibility**: No breaking changes

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| False positives (wrong images wrapped) | Medium | Allow opt-out via `"no-scroll"` title |
| Pattern doesn't match all screenshots | Low | Document naming convention, allow explicit `"tall"` |
| Performance with many images | Low | Minimal overhead (simple string check per image) |
| Conflicts with other image plugins | Medium | Register plugin with correct priority |

## Success Metrics

- Documents with 10+ mobile screenshots are navigable
- No user-reported false positives
- 90%+ of mobile screenshots auto-detected correctly
- Zero markdown changes required for typical use

## Timeline

- **Phase 1** (Plugin): 2 hours
- **Phase 2** (CSS): 1 hour
- **Phase 3** (Integration): 30 minutes
- **Testing**: 1 hour
- **Total**: ~4.5 hours

## Next Steps

1. ✅ Review and approve proposal
2. ⬜ Implement `markdownItImageContainer.ts` plugin
3. ⬜ Create `markdown-it-image-container.css` styles
4. ⬜ Register plugin in `plugins.ts`
5. ⬜ Add CSS to `package.json`
6. ⬜ Test with real mobile screenshots
7. ⬜ Update `test.md` with image examples
8. ⬜ Document in README.md
