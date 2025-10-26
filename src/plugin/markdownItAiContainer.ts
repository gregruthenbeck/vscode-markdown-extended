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

    // Generate HTML from YAML content with source line mapping
    const htmlContent = generateAiContainerHTML(rawContent, state.md, state.env, startLine);

    // Create html_block token with our generated HTML
    let token = state.push('html_block', '', 0);
    token.content = htmlContent;
    token.map = [startLine, closingLine + 1];
    token.markup = markup;

    state.line = closingLine + 1;
    return true;
}

// Parsed AI data with line offsets for source mapping
interface ParsedAiField {
    content: string;
    lineOffset: number; // Line offset relative to start of rawContent
}

interface ParsedAiData {
    prompt: ParsedAiField;
    model: ParsedAiField;
    response: ParsedAiField;
}

/**
 * Parse AI container YAML-like content.
 * Tolerant of markdown content in literal blocks.
 * Supports both structures:
 *   1. versions: [{ prompt, model, response }]
 *   2. Direct { prompt, model, response }
 */
function parseAiYaml(content: string): ParsedAiData {
    // Check if using versions array structure
    const useVersions = /^\s*versions:\s*$/m.test(content);

    // Extract working content (either first version or direct content)
    let workingContent = content;
    let baseLineOffset = 0;

    if (useVersions) {
        // Find content after "- " (first array item)
        const versionMatch = content.match(/^\s*-\s+/m);
        if (versionMatch) {
            const beforeDash = content.substring(0, content.indexOf(versionMatch[0]));
            // Count newlines, not array length (the dash is on the SAME line as content after it)
            baseLineOffset = beforeDash.split('\n').length - 1;
            workingContent = content.substring(content.indexOf(versionMatch[0]) + versionMatch[0].length);
        }
    }

    // Extract fields with line offsets
    const prompt = extractLiteralBlockWithOffset(workingContent, 'prompt', baseLineOffset);
    const model = extractSimpleFieldWithOffset(workingContent, 'model', baseLineOffset);
    const response = extractLiteralBlockWithOffset(workingContent, 'response', baseLineOffset);

    return { prompt, model, response };
}

/**
 * Extract content from a literal block field (field: |) with line offset tracking
 */
function extractLiteralBlockWithOffset(content: string, fieldName: string, baseLineOffset: number): ParsedAiField {
    // Match "fieldName: |" followed by indented lines
    const regex = new RegExp(`^\\s*${fieldName}:\\s*\\|\\s*$`, 'm');
    const match = content.match(regex);

    if (!match) return { content: '', lineOffset: 0 };

    // Calculate line offset where this field appears
    const beforeMatch = content.substring(0, match.index!);
    const lineOffset = baseLineOffset + beforeMatch.split('\n').length - 1;

    // Determine the indent level of this field's key
    const keyLine = match[0];
    const keyIndent = (keyLine.match(/^(\s*)/) || ['', ''])[1].length;

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
        const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;

        // First non-empty line sets base indentation for content
        if (baseIndent === null) {
            if (indent === 0) break; // No indentation, not part of block
            baseIndent = indent;
            blockLines.push(line);
            continue;
        }

        // Stop if we hit a line with less indentation that looks like a YAML key
        // Pattern: any indentation + word characters + colon + space/end
        if (indent < baseIndent && /^\s*\w+:\s*/.test(line)) {
            break; // Stop at next YAML key
        }

        // Include line regardless of indentation (markdown content can have any indent)
        blockLines.push(line);
    }

    // Dedent and join
    return {
        content: dedentLines(blockLines),
        lineOffset
    };
}

/**
 * Extract a simple field value (field: value) with line offset tracking
 */
function extractSimpleFieldWithOffset(content: string, fieldName: string, baseLineOffset: number): ParsedAiField {
    const regex = new RegExp(`^\\s*${fieldName}:\\s*(.+?)\\s*$`, 'm');
    const match = content.match(regex);

    if (!match) return { content: '', lineOffset: 0 };

    const beforeMatch = content.substring(0, match.index!);
    const lineOffset = baseLineOffset + beforeMatch.split('\n').length - 1;

    return {
        content: match[1].trim(),
        lineOffset
    };
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

/**
 * Truncate text showing first N and last M lines
 * Returns text with skip indicator in middle if truncated
 */
function truncateMiddle(text: string, first: number, last: number): string {
    if (!text) return '';

    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    if (totalLines <= first + last) {
        return text;
    }

    const firstLines = lines.slice(0, first);
    const lastLines = lines.slice(-last);
    const skipped = totalLines - first - last;

    return [...firstLines, `*... (${skipped} lines)*`, ...lastLines].join('\n');
}

/**
 * Process response field that may contain **Interrupt:** markers
 * Applies different truncation rules to different segments
 */
function parseResponseWithInterrupts(text: string): string {
    if (!text) return '';

    const lines = text.split(/\r?\n/);
    const interruptMarker = /^\s*\*\*Interrupt:\*\*\s*$/;
    const aiMarker = /^\s*\*\*[A-Z][a-z]+:\*\*/; // Matches **Thinking:**, **Edit:**, **Bash:**, etc.

    // Find all interrupt positions and their paired markers
    const interrupts: Array<{ interruptLine: number, markerLine: number }> = [];

    for (let i = 0; i < lines.length; i++) {
        if (interruptMarker.test(lines[i])) {
            // Find next AI marker after this interrupt
            let markerLine = -1;
            for (let j = i + 1; j < lines.length; j++) {
                if (aiMarker.test(lines[j]) && lines[j] !== '**Interrupt:**') {
                    markerLine = j;
                    break;
                }
            }
            interrupts.push({ interruptLine: i, markerLine });
        }
    }

    // If no interrupts, use simple last 10 lines truncation
    if (interrupts.length === 0) {
        const result = limitLines(text, 10, false);
        if (result.skipped > 0) {
            return `*... (${result.skipped} lines above)*\n\n${result.text}`;
        }
        return result.text;
    }

    // Build segments with appropriate truncation
    const segments: string[] = [];
    let currentPos = 0;

    for (let i = 0; i < interrupts.length; i++) {
        const { interruptLine, markerLine } = interrupts[i];

        // Segment before interrupt (first 4 + last 8)
        if (interruptLine > currentPos) {
            const segmentLines = lines.slice(currentPos, interruptLine);
            const segmentText = truncateMiddle(segmentLines.join('\n'), 4, 8);
            if (segmentText) segments.push(segmentText);
        }

        // Add the **Interrupt:** marker itself
        segments.push(lines[interruptLine]);

        // Interrupt content (first 10 lines)
        if (markerLine > 0) {
            const interruptContent = lines.slice(interruptLine + 1, markerLine);
            const contentText = interruptContent.join('\n').trim();
            if (contentText) {
                const truncated = limitLines(contentText, 10, true);
                let interruptSegment = truncated.text;
                if (truncated.skipped > 0) {
                    interruptSegment += `\n\n*... (${truncated.skipped} more lines)*`;
                }
                segments.push(interruptSegment);
            }

            // Add the marker (e.g., **Thinking:**)
            segments.push(lines[markerLine]);

            // Determine where next segment starts
            const nextInterruptLine = interrupts[i + 1]?.interruptLine ?? lines.length;

            // Content after marker until next interrupt or end (first 4 + last 8)
            if (nextInterruptLine > markerLine + 1) {
                const afterMarkerLines = lines.slice(markerLine + 1, nextInterruptLine);
                const afterMarkerText = truncateMiddle(afterMarkerLines.join('\n'), 4, 8);
                if (afterMarkerText) segments.push(afterMarkerText);
            }

            currentPos = nextInterruptLine;
        } else {
            // No marker found after interrupt, treat rest as interrupt content
            const remaining = lines.slice(interruptLine + 1);
            const remainingText = remaining.join('\n').trim();
            if (remainingText) {
                const truncated = limitLines(remainingText, 10, true);
                let interruptSegment = truncated.text;
                if (truncated.skipped > 0) {
                    interruptSegment += `\n\n*... (${truncated.skipped} more lines)*`;
                }
                segments.push(interruptSegment);
            }
            currentPos = lines.length;
        }
    }

    return segments.join('\n\n');
}

function generateAiContainerHTML(rawContent: string, md: MarkdownIt, env: any, sourceLine: number): string {
    // Handle empty content
    if (!rawContent) {
        return `<div class="ai-container ai-error" data-line="${sourceLine}">
  <p><strong>Empty AI container</strong> (no YAML content)</p>
</div>
`;
    }

    // Parse YAML-like content with line offsets
    let aiData: ParsedAiData;
    try {
        aiData = parseAiYaml(rawContent);
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        return `<div class="ai-container ai-error" data-line="${sourceLine}">
  <p><strong>Error parsing AI container YAML:</strong></p>
  <pre>${escapeHtml(errorMsg)}</pre>
</div>
`;
    }

    // Calculate absolute line numbers (sourceLine is opening :::, add 1 to skip it)
    const promptLine = sourceLine + 1 + aiData.prompt.lineOffset;
    const responseLine = sourceLine + 1 + aiData.response.lineOffset;

    // Limit lines: first 10 of prompt
    const promptResult = limitLines(aiData.prompt.content, 10, true);
    let promptContent = promptResult.text;
    if (promptResult.skipped > 0) {
        promptContent += `\n\n*... (${promptResult.skipped} more lines)*`;
    }

    // Find interrupt markers in original response for line mapping
    const interruptLines = findInterruptLineNumbers(aiData.response.content);

    // Process response with interrupt-aware truncation
    let responseContent = parseResponseWithInterrupts(aiData.response.content);

    // Add two trailing spaces to each line for hard line breaks in markdown
    responseContent = responseContent.split('\n').map(line => line + '  ').join('\n');

    // Render markdown (recursive)
    const promptHtml = promptContent ? md.render(promptContent, env || {}) : '';
    let responseHtml = responseContent ? md.render(responseContent, env || {}) : '';

    // Inject data-line attributes into Interrupt markers in rendered HTML
    responseHtml = addDataLineToInterrupts(responseHtml, interruptLines, responseLine);

    // Generate fieldset HTML structure with granular source line mapping for VSCode sync
    return `<fieldset class="ai-container" data-line="${sourceLine}">
  <legend>ai</legend>
  <div class="ai-prompt" data-line="${promptLine}">${promptHtml}</div>
  <hr class="ai-separator">
  <div class="ai-response" data-line="${responseLine}">${responseHtml}</div>
</fieldset>
`;
}

/**
 * Find line numbers of interrupt markers in response content
 */
function findInterruptLineNumbers(responseText: string): number[] {
    if (!responseText) return [];

    const lines = responseText.split(/\r?\n/);
    const interruptMarker = /^\s*\*\*Interrupt:\*\*\s*$/;
    const interruptLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (interruptMarker.test(lines[i])) {
            interruptLines.push(i); // Line offset within response content
        }
    }

    return interruptLines;
}

/**
 * Add data-line attributes to Interrupt markers in rendered HTML
 */
function addDataLineToInterrupts(html: string, interruptLineOffsets: number[], responseStartLine: number): string {
    if (interruptLineOffsets.length === 0) return html;

    // After markdown rendering, **Interrupt:** becomes <p><strong>Interrupt:</strong></p>
    // We need to add data-line to these elements

    // Replace each occurrence with a version that has data-line
    let modifiedHtml = html;
    let interruptIndex = 0;

    // Pattern to match <p><strong>Interrupt:</strong></p> or similar
    const interruptPattern = /(<p[^>]*>)<strong>Interrupt:<\/strong>(<\/p>)/g;

    modifiedHtml = modifiedHtml.replace(interruptPattern, (match, openTag, closeTag) => {
        if (interruptIndex < interruptLineOffsets.length) {
            const lineOffset = interruptLineOffsets[interruptIndex];
            const absoluteLine = responseStartLine + 1 + lineOffset; // +1 because responseLine points to "response:", content starts next line
            interruptIndex++;
            return `${openTag}<strong data-line="${absoluteLine}">Interrupt:</strong>${closeTag}`;
        }
        return match;
    });

    return modifiedHtml;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
