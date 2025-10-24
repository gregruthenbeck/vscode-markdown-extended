import { MarkdownIt, Token } from "../@types/markdown-it";
import * as yaml from 'js-yaml';

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

function generateAiContainerHTML(rawContent: string, md: MarkdownIt, env: any): string {
    // Handle empty content
    if (!rawContent) {
        return `<div class="ai-container ai-error">
  <p><strong>Empty AI container</strong> (no YAML content)</p>
</div>
`;
    }

    // Parse YAML
    let aiData: any;
    try {
        const parsed = yaml.load(rawContent);

        // Support both structures:
        // 1. versions: [{ prompt, response }]
        // 2. Direct { prompt, response }
        if (parsed && typeof parsed === 'object') {
            if (parsed.versions && Array.isArray(parsed.versions) && parsed.versions.length > 0) {
                aiData = parsed.versions[0];
            } else {
                aiData = parsed;
            }
        } else {
            throw new Error('YAML must contain an object');
        }
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        return `<div class="ai-container ai-error">
  <p><strong>Error parsing AI container YAML:</strong></p>
  <pre>${escapeHtml(errorMsg)}</pre>
</div>
`;
    }

    // Extract prompt and response
    const prompt = aiData?.prompt || '';
    const response = aiData?.response || '';

    // Take last 10 lines of response
    const responseLines = normalizeAndSplitLines(response);
    const last10Lines = responseLines.slice(-10);
    const responseContent = last10Lines.join('\n');

    // Render markdown (recursive)
    const promptHtml = prompt ? md.render(prompt, env || {}) : '';
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

function normalizeAndSplitLines(text: string): string[] {
    if (!text) return [''];
    const normalized = text.trim();
    if (!normalized) return [''];
    return normalized.split(/\r?\n/);
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
