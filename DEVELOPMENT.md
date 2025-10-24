# Development Guide

## Prerequisites

- **Node.js**: v18.x or later
- **npm**: Comes with Node.js
- **TypeScript**: Installed via devDependencies
- **VSCode**: Latest stable version

## Setup

### 1. Clone and Install Dependencies

```bash
cd /home/greg/vscode-markdown-extended
npm install
```

### 2. Compile TypeScript

```bash
npm run compile
```

This compiles all TypeScript files from `/src` to `/out`.

### 3. Watch Mode (Development)

For active development with auto-compilation:

```bash
npm run watch
```

This watches for file changes and recompiles automatically.

## Development Workflow

### Method 1: Extension Development Host (Recommended)

1. Open the project in VSCode
2. Press **F5** or Run → Start Debugging
3. A new VSCode window opens (Extension Development Host)
4. Open a markdown file to test your changes
5. Make code changes → Save → Reload window (Ctrl+R in Extension Host)

**Advantages**:
- Fast iteration
- No packaging required
- Debugging support with breakpoints

### Method 2: Install from VSIX (Production Testing)

Use this when you want to test the packaged extension:

1. **Compile**: `npm run compile`
2. **Package**: `npx vsce package`
3. **Install**: One of:
   - VSCode Command Palette → "Extensions: Install from VSIX"
   - Command line: `code --install-extension markdown-extended-1.1.4-geser.vsix`
4. **Reload VSCode**

## Project Structure

```
vscode-markdown-extended/
├── src/                          # TypeScript source
│   ├── plugin/                   # Markdown-it plugins
│   │   ├── markdownItAiContainer.ts  # Custom AI block parser
│   │   ├── markdownItContainer.ts    # Generic containers
│   │   ├── markdownItAdmonition.ts   # Admonitions
│   │   └── plugins.ts            # Plugin registration
│   ├── export/                   # Export functionality
│   └── extension.ts              # Main extension entry
├── out/                          # Compiled JavaScript (generated)
├── styles/                       # CSS for preview
│   └── markdown-it-ai-container.css
├── test.md                       # Test cases for AI blocks
├── test-parser.js                # Diagnostic tool for parser
└── package.json                  # Extension manifest
```

## Testing

### Manual Testing

1. Use `/test.md` for AI container test cases
2. Open in VSCode with extension loaded
3. View markdown preview (Ctrl+Shift+V)
4. Verify rendering matches expectations

### Diagnostic Tool

Test the AI block parser in isolation:

```bash
node test-parser.js
```

This shows:
- Field extraction diagnostics
- Line counts
- Interrupt detection
- Truncation results

### Test Against Production Data

```bash
# Edit test-parser.js to point to your file
node test-parser.js
```

## Key Files for AI Container Feature

| File | Purpose |
|------|---------|
| `src/plugin/markdownItAiContainer.ts` | Custom YAML parser and rendering logic |
| `src/plugin/plugins.ts` | Plugin registration |
| `styles/markdown-it-ai-container.css` | AI container styling |
| `test.md` | Test cases |
| `test-parser.js` | Parser diagnostic tool |
| `AI-BLOCK-PARSING-TECHNICAL-REFERENCE.md` | Technical documentation |

## Common Development Tasks

### Add a New Markdown-it Plugin

1. Install the plugin: `npm install markdown-it-plugin-name`
2. Add type definitions if needed: `npm install -D @types/markdown-it-plugin-name`
3. Register in `src/plugin/plugins.ts`:
   ```typescript
   import pluginName from 'markdown-it-plugin-name';

   const myPlugins = {
       'plugin-name': pluginName
   };
   ```
4. Add to plugins array: `$('plugin-name')`
5. Update `package.json` if it needs configuration

### Add Custom CSS

1. Create CSS file in `/styles/`
2. Register in `package.json` under `contributes.markdown.previewStyles`:
   ```json
   "contributes": {
     "markdown": {
       "previewStyles": [
         "./styles/your-style.css"
       ]
     }
   }
   ```

### Modify AI Container Parser

1. Edit `src/plugin/markdownItAiContainer.ts`
2. Run `npm run compile`
3. Test with `node test-parser.js`
4. Test in Extension Development Host (F5)
5. Verify against production data

## Packaging for Distribution

### Build VSIX Package

```bash
# Ensure dependencies are clean
npm install

# Compile TypeScript
npm run compile

# Package extension
npx vsce package
```

Output: `markdown-extended-1.1.4-geser.vsix`

### Install Packaged Extension

```bash
code --install-extension markdown-extended-1.1.4-geser.vsix
```

Or via VSCode UI:
1. View → Extensions
2. "..." menu → Install from VSIX
3. Select the .vsix file

### Publish to Marketplace (Optional)

**Note**: This fork uses custom version suffix `-geser`, not intended for marketplace.

If publishing to VSCode Marketplace:
```bash
npx vsce publish
```

Requires publisher account and authentication token.

## Debugging

### Debug TypeScript Code

1. Set breakpoints in `.ts` files
2. Press **F5** to start debugging
3. Breakpoints hit in Extension Development Host
4. Use Debug Console for evaluation

### Debug Compiled JavaScript

- Breakpoints can be set in `/out/*.js` files
- Source maps link back to TypeScript

### Common Issues

**Issue**: Changes not reflected in preview
- **Solution**: Reload Extension Development Host window (Ctrl+R)

**Issue**: Compilation errors
- **Solution**: Run `npm run compile` and check terminal output

**Issue**: Extension not loading
- **Solution**: Check `package.json` activation events and plugin registration

**Issue**: Parser failing on production data
- **Solution**: Use `node test-parser.js` to diagnose, check indentation logic

## Configuration

### Extension Settings

Defined in `package.json` under `contributes.configuration`.

Example: Disable specific plugins
```json
"markdownExtended.disabledPlugins": "underline, toc"
```

### Markdown-it Plugin Configuration

See `src/plugin/plugins.ts` for plugin initialization and configuration.

## Version Management

Current version: `1.1.4-geser` (custom fork)

Update version in `package.json`:
```json
{
  "version": "1.1.4-geser"
}
```

The `-geser` suffix indicates this is a custom fork.

## Dependencies

### Runtime Dependencies

- `markdown-it` and plugins (see `package.json`)
- `js-yaml`: Used by other parts (AI container uses custom parser)
- `puppeteer`: For PDF/image export
- `clipboardy`: Clipboard operations

### Development Dependencies

- `typescript`: TypeScript compiler
- `@types/vscode`: VSCode API types
- `@types/node`: Node.js types

## CI/CD

The `vscode:prepublish` script runs before packaging:
```json
"vscode:prepublish": "find node_modules/puppeteer -name '.local*' | xargs rm -rf && npm run compile"
```

This cleans puppeteer cache and compiles TypeScript.

## Contributing Guidelines

### Code Style

- Use TypeScript strict mode
- Follow existing code formatting
- Add JSDoc comments for public functions
- Keep functions focused and testable

### AI Container Parser

When modifying the AI container parser:
1. Read `AI-BLOCK-PARSING-TECHNICAL-REFERENCE.md` first
2. Understand why we can't use standard YAML parsers
3. Test with `test-parser.js` before integration
4. Verify against production YAML files
5. Update technical reference if changing behavior

### Commit Messages

- Use descriptive commit messages
- Reference issue numbers if applicable
- Separate concerns (one feature per commit when possible)

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [markdown-it Documentation](https://github.com/markdown-it/markdown-it)
- [VSCE Documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

## Troubleshooting

### Extension Won't Load

1. Check `package.json` for errors
2. Verify `activationEvents` include your use case
3. Check Developer Tools console (Help → Toggle Developer Tools)
4. Look for errors in Output panel (View → Output → "Extension Host")

### Preview Not Updating

1. Ensure `npm run watch` is running
2. Reload Extension Development Host (Ctrl+R)
3. Check if markdown file is saved
4. Verify preview is actually using your extension (not another markdown extension)

### Parser Errors

1. Run `node test-parser.js` with problematic YAML
2. Check indentation carefully (use visible whitespace in editor)
3. Verify YAML structure matches expected format
4. Check `extractLiteralBlock` logic for boundary detection

## License

See `LICENSE.txt` for license information.

## Support

For issues with the original extension:
- [GitHub Issues](https://github.com/qjebbs/vscode-markdown-extended/issues)

For issues with AI container feature:
- This is a custom fork, maintain locally or create own repository
