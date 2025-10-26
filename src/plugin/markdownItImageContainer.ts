import { MarkdownIt, Token } from "../@types/markdown-it";
import { MarkdownItEnv } from '../services/common/interfaces';
import * as path from 'path';
import * as fs from 'fs';
import imageSize from 'image-size';

/**
 * Plugin to wrap tall/mobile screenshot images in scrollable containers
 *
 * Detection method: Reads actual image dimensions and calculates aspect ratio
 * - Images with height/width ratio > 1.5 are wrapped in scrollable containers
 * - Opt-out: title="no-scroll"
 */

// Configuration
const MAX_HEIGHT = 380; // Maximum display height in pixels
const DEBUG = false; // Set to true to enable diagnostic output in preview

// Display modes for images
type ImageDisplayMode =
    | { mode: 'scale'; factor: 0.5 | 0.75 }
    | { mode: 'scroll' }
    | { mode: 'normal' }
    | { mode: 'opt-out' }
    | { mode: 'error'; error: string };

// Diagnostic tracking
interface ImageDiagnostics {
    src: string;
    title: string;
    resolvedPath?: string;
    fileExists?: boolean;
    dimensions?: { width: number; height: number };
    displayMode?: ImageDisplayMode;
    error?: string;
}

export function MarkdownItImageContainer(md: MarkdownIt) {
    // Debug logging (disabled): const logFile = '/tmp/md-image-debug.log';
    // fs.appendFileSync(logFile, `\n=== Plugin Registered at ${new Date().toISOString()} ===\n`);
    console.log('🔵 MarkdownItImageContainer plugin is being registered!');

    // Save the existing renderer (may be from html5-embed or markdown-it default)
    const defaultRenderer = (md.renderer.rules.image || function(tokens: any, idx: number, options: any, env: any, self: any): string {
        return self.renderToken(tokens, idx, options);
    }) as any;

    // Wrap the existing renderer to add tall image detection
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const src = token.attrGet('src') || '';
        const title = token.attrGet('title') || '';

        // Get line number for VSCode preview sync (images are inline, check parent block)
        let lineNumber: number | undefined;
        if (token.map) {
            lineNumber = token.map[0];
        } else if (idx > 0 && tokens[idx - 1]?.map) {
            // Image is inline, use containing block's line
            lineNumber = tokens[idx - 1].map[0];
        }

        // Debug logging (disabled):
        // fs.appendFileSync(logFile, `IMAGE: src="${src}" title="${title}"\n`);
        // fs.appendFileSync(logFile, `  env.htmlExporter=${env?.htmlExporter ? 'exists' : 'undefined'}\n`);
        // fs.appendFileSync(logFile, `  env.currentDocument=${env?.currentDocument || 'none'}\n`);
        console.log('🔵 IMAGE RENDERER CALLED! src:', src, 'title:', title);

        // Initialize diagnostics
        const diag: ImageDiagnostics = {
            src,
            title
        };

        // Check for opt-out
        if (title === 'no-scroll') {
            const normalImg = defaultRenderer(tokens, idx, options, env, self);
            diag.displayMode = { mode: 'opt-out' };
            return wrapWithDiagnostics(normalImg, diag);
        }

        // Determine display mode based on image dimensions
        const displayMode = getImageDisplayMode(src, env as MarkdownItEnv, diag);
        diag.displayMode = displayMode;

        // Handle different display modes
        if (displayMode.mode === 'error' || displayMode.mode === 'normal') {
            const normalImg = defaultRenderer(tokens, idx, options, env, self);
            return wrapWithDiagnostics(normalImg, diag);
        }

        if (displayMode.mode === 'scale') {
            // Render scaled image with inline width/height
            const scaleFactor = displayMode.factor;
            const dimensionsText = diag.dimensions
                ? `${diag.dimensions.width}×${diag.dimensions.height}`
                : 'unknown';

            // Get the img tag and add width style
            const imgTag = defaultRenderer(tokens, idx, options, env, self);
            const scaledWidth = diag.dimensions ? Math.round(diag.dimensions.width * scaleFactor) : 'auto';
            const styledImgTag = imgTag.replace('<img ', `<img style="width: ${scaledWidth}px; height: auto;" `);

            const dataLineAttr = lineNumber !== undefined ? ` data-line="${lineNumber}"` : '';
            const html = `
<div class="image-scale-container"${dataLineAttr}>
    ${DEBUG ? `<div class="image-debug-badge">SCALE: ${scaleFactor} (${dimensionsText})</div>` : ''}
    ${styledImgTag}
</div>`;
            return wrapWithDiagnostics(html, diag);
        }

        if (displayMode.mode === 'scroll') {
            // Render in scrollable container
            const imgTag = defaultRenderer(tokens, idx, options, env, self);
            const dimensionsText = diag.dimensions
                ? `${diag.dimensions.width}×${diag.dimensions.height}`
                : 'unknown';

            const dataLineAttr = lineNumber !== undefined ? ` data-line="${lineNumber}"` : '';
            const html = `
<div class="image-scroll-container"${dataLineAttr}>
    ${DEBUG ? `<div class="image-debug-badge">SCROLL (${dimensionsText})</div>` : ''}
    <div class="image-scroll-inner">
        ${imgTag}
    </div>
    <span class="image-scroll-hint">↕ Scroll to view full image</span>
</div>`;
            return wrapWithDiagnostics(html, diag);
        }

        // Fallback
        const normalImg = defaultRenderer(tokens, idx, options, env, self);
        return wrapWithDiagnostics(normalImg, diag);
    };
    console.log('🔵 Image renderer has been overridden with tall image detection!');
}

/**
 * Wrap HTML with diagnostic comments
 */
function wrapWithDiagnostics(html: string, diag: ImageDiagnostics): string {
    if (!DEBUG) {
        return html;
    }

    const modeStr = diag.displayMode
        ? (diag.displayMode.mode === 'scale'
            ? `scale(${diag.displayMode.factor})`
            : diag.displayMode.mode)
        : 'unknown';

    const comments = [
        '<!-- IMAGE PLUGIN DEBUG -->',
        `<!-- src: ${diag.src} -->`,
        `<!-- title: "${diag.title}" -->`,
        diag.resolvedPath ? `<!-- resolved: ${diag.resolvedPath} -->` : '<!-- resolved: FAILED -->',
        diag.fileExists !== undefined ? `<!-- file exists: ${diag.fileExists} -->` : '',
        diag.dimensions ? `<!-- dimensions: ${diag.dimensions.width}×${diag.dimensions.height} -->` : '<!-- dimensions: FAILED -->',
        `<!-- display mode: ${modeStr} -->`,
        diag.error ? `<!-- error: ${diag.error} -->` : '',
        '<!-- /IMAGE PLUGIN DEBUG -->'
    ].filter(c => c).join('\n');

    return `${comments}\n${html}`;
}

/**
 * Determine optimal display mode for an image based on its dimensions
 * Logic:
 * - If height * 0.75 <= MAX_HEIGHT → scale to 0.75
 * - Else if height * 0.5 <= MAX_HEIGHT → scale to 0.5
 * - Else → scroll container
 */
function getImageDisplayMode(src: string, env: MarkdownItEnv, diag: ImageDiagnostics): ImageDisplayMode {
    try {
        // Resolve image path to absolute path
        const imagePath = resolveImagePath(src, env);
        diag.resolvedPath = imagePath || 'FAILED';

        if (!imagePath) {
            diag.error = 'Path resolution failed';
            return { mode: 'error', error: 'Path resolution failed' };
        }

        diag.fileExists = fs.existsSync(imagePath);
        if (!diag.fileExists) {
            diag.error = 'File does not exist';
            return { mode: 'error', error: 'File does not exist' };
        }

        // Read image file as buffer
        const buffer = fs.readFileSync(imagePath);

        // Read image dimensions
        const dimensions = imageSize(buffer);
        if (!dimensions.width || !dimensions.height) {
            diag.error = 'Invalid dimensions';
            return { mode: 'error', error: 'Invalid dimensions' };
        }

        diag.dimensions = { width: dimensions.width, height: dimensions.height };
        const height = dimensions.height;

        // Determine display mode based on height
        if (height * 0.75 <= MAX_HEIGHT) {
            return { mode: 'scale', factor: 0.75 };
        } else if (height * 0.5 <= MAX_HEIGHT) {
            return { mode: 'scale', factor: 0.5 };
        } else {
            return { mode: 'scroll' };
        }
    } catch (error) {
        // If we can't read the image, render normally
        diag.error = error instanceof Error ? error.message : String(error);
        return { mode: 'error', error: diag.error };
    }
}

/**
 * Resolve relative image path to absolute path
 * Works in both preview mode (env.currentDocument) and export mode (env.htmlExporter)
 */
function resolveImagePath(src: string, env: MarkdownItEnv): string | undefined {
    // Decode vscode-resource URI (used in preview)
    // Format: vscode-resource:/path/to/workspace/relative/image.png
    if (src.startsWith('vscode-resource:')) {
        const decodedPath = decodeURIComponent(src.replace('vscode-resource:', ''));
        return decodedPath;
    }

    // If already absolute, return as-is
    if (path.isAbsolute(src)) {
        return src;
    }

    // Build search paths
    const searchPaths: string[] = [];

    // PREVIEW MODE: Use currentDocument
    if ((env as any).currentDocument) {
        const currentDoc = (env as any).currentDocument;
        if (typeof currentDoc === 'string') {
            searchPaths.push(path.dirname(currentDoc));
        } else if (currentDoc.uri?.fsPath) {
            searchPaths.push(path.dirname(currentDoc.uri.fsPath));
        } else if (currentDoc.fsPath) {
            searchPaths.push(path.dirname(currentDoc.fsPath));
        }
    }

    // EXPORT MODE: Use htmlExporter
    if (env.htmlExporter?.uri?.fsPath) {
        searchPaths.push(path.dirname(env.htmlExporter.uri.fsPath));
    }

    if (env.htmlExporter?.workspaceFolder?.fsPath) {
        searchPaths.push(env.htmlExporter.workspaceFolder.fsPath);
    }

    // Search for the file in each path
    for (const basePath of searchPaths) {
        const fullPath = path.join(basePath, src);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }

    return undefined;
}
