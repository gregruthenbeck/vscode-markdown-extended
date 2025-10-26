import { MarkdownIt, Token } from "../@types/markdown-it";
import * as fs from 'fs';
import * as path from 'path';

// Debug logging configuration
const DEBUG_ENABLED = false;  // Set to true to enable debug logging
const DEBUG_LOG_FILE = path.join(__dirname, '../../debug-data-line.log');

function debugLog(message: string) {
    if (!DEBUG_ENABLED) return;

    const timestamp = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG_FILE, `[${timestamp}] ${message}\n`);
    console.log(message);  // Also log to console for convenience
}

// Clear log file on module load (only if debugging is enabled)
if (DEBUG_ENABLED) {
    try {
        fs.writeFileSync(DEBUG_LOG_FILE, `=== Debug Log Started at ${new Date().toISOString()} ===\n\n`);
    } catch (e) {
        console.error('Failed to initialize debug log file:', e);
    }
}

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

// Segment of truncated content with original line number tracking
interface TruncatedSegment {
    text: string;
    lineStart: number;  // Line number relative to content start (0-indexed), -1 for skip markers
    lineEnd: number;    // Line number relative to content start (inclusive), -1 for skip markers
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
 * Returns segments with original line number tracking
 */
function limitLines(text: string, count: number, fromStart: boolean): TruncatedSegment[] {
    if (!text) return [];

    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    if (totalLines <= count) {
        // No truncation needed
        return [{ text, lineStart: 0, lineEnd: totalLines - 1 }];
    }

    const skipped = totalLines - count;
    const segments: TruncatedSegment[] = [];

    if (fromStart) {
        // Keep first N lines
        const keptLines = lines.slice(0, count);
        segments.push({ text: keptLines.join('\n'), lineStart: 0, lineEnd: count - 1 });
        segments.push({ text: `*... (${skipped} more lines)*`, lineStart: -1, lineEnd: -1 });
    } else {
        // Keep last N lines
        const startLine = totalLines - count;
        const keptLines = lines.slice(-count);
        segments.push({ text: `*... (${skipped} lines above)*`, lineStart: -1, lineEnd: -1 });
        segments.push({ text: keptLines.join('\n'), lineStart: startLine, lineEnd: totalLines - 1 });
    }

    return segments;
}

/**
 * Truncate text showing first N and last M lines
 * Returns segments with original line number tracking
 */
function truncateMiddle(text: string, first: number, last: number): TruncatedSegment[] {
    if (!text) return [];

    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    if (totalLines <= first + last) {
        // No truncation needed
        return [{ text, lineStart: 0, lineEnd: totalLines - 1 }];
    }

    const firstLines = lines.slice(0, first);
    const lastStartLine = totalLines - last;
    const lastLines = lines.slice(-last);
    const skipped = totalLines - first - last;

    return [
        { text: firstLines.join('\n'), lineStart: 0, lineEnd: first - 1 },
        { text: `*... (${skipped} lines)*`, lineStart: -1, lineEnd: -1 },
        { text: lastLines.join('\n'), lineStart: lastStartLine, lineEnd: totalLines - 1 }
    ];
}

/**
 * Adjust segment line numbers by adding an offset
 * Used when processing sub-slices of content to map back to original line numbers
 */
function adjustSegmentLineNumbers(segments: TruncatedSegment[], offset: number): TruncatedSegment[] {
    return segments.map(seg => ({
        text: seg.text,
        lineStart: seg.lineStart >= 0 ? seg.lineStart + offset : -1,
        lineEnd: seg.lineEnd >= 0 ? seg.lineEnd + offset : -1
    }));
}

/**
 * Render markdown content with adjusted line numbers for nested rendering.
 *
 * VSCode's pluginSourceMap adds data-line attributes with relative line numbers (0, 1, 2...).
 * This function renders the content normally, then adjusts all data-line values by adding
 * the lineOffset to convert them to absolute file positions.
 *
 * @param md - The MarkdownIt instance
 * @param content - Markdown content to render
 * @param lineOffset - Absolute line number (zero-based) where content starts in the original file
 * @param env - Markdown-it environment object
 * @returns Rendered HTML with correct absolute data-line attributes
 */
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

/**
 * Render segments with correct line number offsets
 * Skip markers are rendered as plain HTML without data-line attributes
 */
function renderSegments(md: MarkdownIt, segments: TruncatedSegment[], baseLineOffset: number, env: any): string {
    debugLog(`\n🔵 renderSegments: baseLineOffset=${baseLineOffset}`);

    const htmlParts: string[] = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        debugLog(`  [${i}] lineStart=${segment.lineStart}`);

        if (segment.lineStart < 0) {
            // Skip marker - render as plain HTML without data-line
            debugLog(`    → Skip marker (no data-line)`);
            htmlParts.push(`<p class="truncation-marker">${escapeHtml(segment.text)}</p>`);
        } else {
            // Normal content - render with correct line offset
            const calculatedOffset = baseLineOffset + segment.lineStart;
            debugLog(`    → Offset: ${baseLineOffset} + ${segment.lineStart} = ${calculatedOffset}`);

            // Add trailing spaces for hard line breaks in markdown
            const textWithBreaks = segment.text.split('\n').map(line => line + '  ').join('\n');
            const html = renderWithLineOffset(md, textWithBreaks, calculatedOffset, env);

            // Extract and log all data-line values in the rendered HTML
            const dataLineMatches = html.match(/data-line="(\d+)"/g) || [];
            if (dataLineMatches.length > 0) {
                debugLog(`    → data-line values: ${dataLineMatches.join(', ')}`);
            } else {
                debugLog(`    → WARNING: No data-line attributes found in HTML!`);
            }

            htmlParts.push(html);
        }
    }

    return htmlParts.join('\n');
}

/**
 * Process response field that may contain **Interrupt:** markers
 * Applies different truncation rules to different segments with original line tracking
 */
function parseResponseWithInterrupts(text: string): TruncatedSegment[] {
    debugLog(`\n🟢 parseResponseWithInterrupts: ${text.length} chars, ${text.split(/\r?\n/).length} lines`);

    if (!text) return [];

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
        return limitLines(text, 10, false);
    }

    // Build segments with appropriate truncation
    const segments: TruncatedSegment[] = [];
    let currentPos = 0;

    for (let i = 0; i < interrupts.length; i++) {
        const { interruptLine, markerLine } = interrupts[i];

        // Segment before interrupt (first 4 + last 8)
        if (interruptLine > currentPos) {
            const segmentLines = lines.slice(currentPos, interruptLine);
            const segmentText = segmentLines.join('\n');
            const truncatedSegments = truncateMiddle(segmentText, 4, 8);
            segments.push(...adjustSegmentLineNumbers(truncatedSegments, currentPos));
        }

        // Add the **Interrupt:** marker itself
        segments.push({
            text: lines[interruptLine],
            lineStart: interruptLine,
            lineEnd: interruptLine
        });

        // Interrupt content (first 10 lines)
        if (markerLine > 0) {
            const interruptContentStart = interruptLine + 1;
            const interruptContent = lines.slice(interruptContentStart, markerLine);
            const contentText = interruptContent.join('\n').trim();
            if (contentText) {
                const truncatedSegments = limitLines(contentText, 10, true);
                segments.push(...adjustSegmentLineNumbers(truncatedSegments, interruptContentStart));
            }

            // Add the marker (e.g., **Thinking:**)
            segments.push({
                text: lines[markerLine],
                lineStart: markerLine,
                lineEnd: markerLine
            });

            // Determine where next segment starts
            const nextInterruptLine = interrupts[i + 1]?.interruptLine ?? lines.length;

            // Content after marker until next interrupt or end (first 4 + last 8)
            if (nextInterruptLine > markerLine + 1) {
                const afterMarkerStart = markerLine + 1;
                const afterMarkerLines = lines.slice(afterMarkerStart, nextInterruptLine);
                const afterMarkerText = afterMarkerLines.join('\n');
                const truncatedSegments = truncateMiddle(afterMarkerText, 4, 8);
                segments.push(...adjustSegmentLineNumbers(truncatedSegments, afterMarkerStart));
            }

            currentPos = nextInterruptLine;
        } else {
            // No marker found after interrupt, treat rest as interrupt content
            const remainingStart = interruptLine + 1;
            const remaining = lines.slice(remainingStart);
            const remainingText = remaining.join('\n').trim();
            if (remainingText) {
                const truncatedSegments = limitLines(remainingText, 10, true);
                segments.push(...adjustSegmentLineNumbers(truncatedSegments, remainingStart));
            }
            currentPos = lines.length;
        }
    }

    debugLog(`🟢 Created ${segments.length} segments: ${segments.map((s, i) => `[${i}]:${s.lineStart}`).join(', ')}`);

    return segments;
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

    // Get truncated segments with original line tracking
    const promptSegments = limitLines(aiData.prompt.content, 10, true);
    const responseSegments = parseResponseWithInterrupts(aiData.response.content);

    // Render segments with correct absolute line numbers
    // The +1 accounts for content starting the line after "prompt: |" / "response: |"
    const promptHtml = renderSegments(md, promptSegments, promptLine + 1, env || {});
    const responseHtml = renderSegments(md, responseSegments, responseLine + 1, env || {});

    // Generate fieldset HTML structure with granular source line mapping for VSCode sync
    return `<fieldset class="ai-container" data-line="${sourceLine}">
  <legend>ai</legend>
  <div class="ai-prompt" data-line="${promptLine}">${promptHtml}</div>
  <hr class="ai-separator">
  <div class="ai-response" data-line="${responseLine}">${responseHtml}</div>
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
