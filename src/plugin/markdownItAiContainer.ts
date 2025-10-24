import { MarkdownIt, Token } from "../@types/markdown-it";

const
    _marker = 58 /* ':' */,
    _minMarkerLen = 3,
    _containerName = 'ai';

export function MarkdownItAiContainer(md: MarkdownIt) {
    // Register BEFORE the generic container plugin so we catch ::: ai first
    md.block.ruler.before("fence", "ai_container", aiContainer, {
        alt: ["paragraph", "reference", "blockquote", "list"]
    });
}

function aiContainer(state: any, startLine: number, endLine: number, silent: boolean) {
    // if it's indented more than 3 spaces, it should be a code block
    if (state.tShift[startLine] - state.blkIndent >= 4) return false;

    let pos: number = state.bMarks[startLine] + state.tShift[startLine];
    let max: number = state.eMarks[startLine];

    // Check for opening marker :::
    if (state.src.charCodeAt(pos) !== _marker) return false;
    if (state.src.charCodeAt(pos + 1) !== _marker) return false;
    if (state.src.charCodeAt(pos + 2) !== _marker) return false;

    let mem = pos;
    pos = state.skipChars(pos, _marker);
    let len = pos - mem;
    if (len < _minMarkerLen) return false;

    let markup: string = state.src.slice(mem, pos);

    // Get container name (should be "ai")
    let params: string = state.src.slice(pos, max).trim();
    if (params !== _containerName) return false;

    // Since start is found, we can report success here in validation mode
    if (silent) return true;

    // Search for closing marker :::
    let nextLine = startLine;
    let closingLine = -1;

    for (; ;) {
        nextLine++;
        if (nextLine >= endLine) {
            // unclosed block should be autoclosed by end of document
            break;
        }

        pos = state.bMarks[nextLine] + state.tShift[nextLine];
        max = state.eMarks[nextLine];

        // Check if this line is the closing :::
        if (pos < max) {
            let lineContent = state.src.slice(pos, max).trim();
            if (lineContent === ':::') {
                closingLine = nextLine;
                break;
            }
        }
    }

    // If no closing marker found, auto-close at end
    if (closingLine < 0) {
        closingLine = nextLine;
    }

    // Extract raw content between opening and closing markers
    const contentStart = state.eMarks[startLine];
    const contentEnd = state.bMarks[closingLine];
    const rawContent = state.src.slice(contentStart, contentEnd).trim();

    // Generate HTML from YAML content
    const htmlContent = generateAiContainerHTML(rawContent, state.md, state.env);

    // Create html_block token with our generated HTML
    let token = state.push('html_block', '', 0);
    token.content = htmlContent;
    token.map = [startLine, closingLine + 1];
    token.markup = markup;

    state.line = closingLine + 1;
    return true;
}

/**
 * Parse AI container YAML-like content.
 * Tolerant of markdown content in literal blocks.
 * Supports both structures:
 *   1. versions: [{ prompt, model, response }]
 *   2. Direct { prompt, model, response }
 */
function parseAiYaml(content: string): { prompt: string, model: string, response: string } {
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

    // Extract fields
    const prompt = extractLiteralBlock(workingContent, 'prompt');
    const model = extractSimpleField(workingContent, 'model');
    const response = extractLiteralBlock(workingContent, 'response');

    return { prompt, model, response };
}

/**
 * Extract content from a literal block field (field: |)
 * Handles indented content and dedents it.
 */
function extractLiteralBlock(content: string, fieldName: string): string {
    // Match "fieldName: |" followed by indented lines
    const regex = new RegExp(`^\\s*${fieldName}:\\s*\\|\\s*$`, 'm');
    const match = content.match(regex);

    if (!match) return '';

    const startPos = match.index! + match[0].length;
    const lines = content.substring(startPos).split('\n');

    // Collect indented lines that belong to this literal block
    const blockLines: string[] = [];
    let baseIndent: number | null = null;

    for (const line of lines) {
        // Empty lines are part of the block
        if (line.trim() === '') {
            blockLines.push('');
            continue;
        }

        // Measure indentation
        const indent = line.match(/^(\s*)/)?.[1].length || 0;

        // First non-empty line sets base indentation
        if (baseIndent === null) {
            if (indent === 0) break; // No indentation, not part of block
            baseIndent = indent;
            blockLines.push(line);
            continue;
        }

        // If line has less indentation than base, block ends
        if (indent < baseIndent) break;

        blockLines.push(line);
    }

    // Dedent and join
    return dedentLines(blockLines);
}

/**
 * Extract a simple field value (field: value)
 */
function extractSimpleField(content: string, fieldName: string): string {
    const regex = new RegExp(`^\\s*${fieldName}:\\s*(.+?)\\s*$`, 'm');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
}

/**
 * Remove common indentation from lines
 */
function dedentLines(lines: string[]): string {
    if (lines.length === 0) return '';

    // Find minimum indentation (ignoring empty lines)
    let minIndent = Infinity;
    for (const line of lines) {
        if (line.trim() === '') continue;
        const indent = line.match(/^(\s*)/)?.[1].length || 0;
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

/**
 * Limit text to n lines from start or end
 * Returns limited text and count of skipped lines
 */
function limitLines(text: string, count: number, fromStart: boolean): { text: string, skipped: number } {
    if (!text) return { text: '', skipped: 0 };

    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    if (totalLines <= count) {
        return { text, skipped: 0 };
    }

    const limited = fromStart ? lines.slice(0, count) : lines.slice(-count);
    const skipped = totalLines - count;

    return { text: limited.join('\n'), skipped };
}

function generateAiContainerHTML(rawContent: string, md: MarkdownIt, env: any): string {
    // Handle empty content
    if (!rawContent) {
        return `<div class="ai-container ai-error">
  <p><strong>Empty AI container</strong> (no YAML content)</p>
</div>
`;
    }

    // Parse YAML-like content
    let aiData: { prompt: string, model: string, response: string };
    try {
        aiData = parseAiYaml(rawContent);
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        return `<div class="ai-container ai-error">
  <p><strong>Error parsing AI container YAML:</strong></p>
  <pre>${escapeHtml(errorMsg)}</pre>
</div>
`;
    }

    // Limit lines: first 10 of prompt, last 10 of response
    const promptResult = limitLines(aiData.prompt, 10, true);
    const responseResult = limitLines(aiData.response, 10, false);

    // Add skip indicators
    let promptContent = promptResult.text;
    if (promptResult.skipped > 0) {
        promptContent += `\n\n*... (${promptResult.skipped} more lines)*`;
    }

    let responseContent = responseResult.text;
    if (responseResult.skipped > 0) {
        responseContent = `*... (${responseResult.skipped} lines above)*\n\n${responseContent}`;
    }

    // Add two trailing spaces to each line for hard line breaks in markdown
    responseContent = responseContent.split('\n').map(line => line + '  ').join('\n');

    // Render markdown (recursive)
    const promptHtml = promptContent ? md.render(promptContent, env || {}) : '';
    const responseHtml = responseContent ? md.render(responseContent, env || {}) : '';

    // Generate fieldset HTML structure
    return `<fieldset class="ai-container">
  <legend>ai</legend>
  <div class="ai-prompt">${promptHtml}</div>
  <hr class="ai-separator">
  <div class="ai-response">${responseHtml}</div>
</fieldset>
`;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
