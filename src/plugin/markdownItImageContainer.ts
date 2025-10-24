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
const ASPECT_RATIO_THRESHOLD = 1.5; // Images taller than this ratio get scrollable container
const DEBUG = false; // Set to true to enable diagnostic output in preview

// Diagnostic tracking
interface ImageDiagnostics {
    src: string;
    title: string;
    resolvedPath?: string;
    fileExists?: boolean;
    dimensions?: { width: number; height: number };
    aspectRatio?: number;
    decision: 'TALL' | 'NORMAL' | 'ERROR' | 'OPT-OUT';
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

        // Debug logging (disabled):
        // fs.appendFileSync(logFile, `IMAGE: src="${src}" title="${title}"\n`);
        // fs.appendFileSync(logFile, `  env.htmlExporter=${env?.htmlExporter ? 'exists' : 'undefined'}\n`);
        // fs.appendFileSync(logFile, `  env.currentDocument=${env?.currentDocument || 'none'}\n`);
        console.log('🔵 IMAGE RENDERER CALLED! src:', src, 'title:', title);

        // Initialize diagnostics
        const diag: ImageDiagnostics = {
            src,
            title,
            decision: 'NORMAL'
        };

        // Check for opt-out
        if (title === 'no-scroll') {
            diag.decision = 'OPT-OUT';
            // fs.appendFileSync(logFile, `  Decision: OPT-OUT\n`);
            const normalImg = defaultRenderer(tokens, idx, options, env, self);
            return wrapWithDiagnostics(normalImg, diag);
        }

        // Check if image is tall based on actual dimensions
        const { isTall } = checkIfTallImage(src, env as MarkdownItEnv, diag);

        // fs.appendFileSync(logFile, `  Decision: ${diag.decision} isTall=${isTall} aspectRatio=${diag.aspectRatio} error="${diag.error || 'none'}"\n`);

        // Render normal image if not tall or error
        if (!isTall) {
            const normalImg = defaultRenderer(tokens, idx, options, env, self);
            return wrapWithDiagnostics(normalImg, diag);
        }

        // Render tall image in scrollable container
        const imgTag = defaultRenderer(tokens, idx, options, env, self);
        const aspectRatioText = diag.aspectRatio ? diag.aspectRatio.toFixed(2) : '?';
        const dimensionsText = diag.dimensions
            ? `${diag.dimensions.width}×${diag.dimensions.height}`
            : 'unknown';

        const html = `
<div class="image-scroll-container">
    ${DEBUG ? `<div class="image-debug-badge">TALL: ${aspectRatioText} (${dimensionsText})</div>` : ''}
    <div class="image-scroll-inner">
        ${imgTag}
    </div>
    <span class="image-scroll-hint">↕ Scroll to view full image</span>
</div>`;

        return wrapWithDiagnostics(html, diag);
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

    const comments = [
        '<!-- IMAGE PLUGIN DEBUG -->',
        `<!-- src: ${diag.src} -->`,
        `<!-- title: "${diag.title}" -->`,
        diag.resolvedPath ? `<!-- resolved: ${diag.resolvedPath} -->` : '<!-- resolved: FAILED -->',
        diag.fileExists !== undefined ? `<!-- file exists: ${diag.fileExists} -->` : '',
        diag.dimensions ? `<!-- dimensions: ${diag.dimensions.width}×${diag.dimensions.height} -->` : '<!-- dimensions: FAILED -->',
        diag.aspectRatio !== undefined ? `<!-- aspect ratio: ${diag.aspectRatio.toFixed(2)} -->` : '',
        `<!-- decision: ${diag.decision} -->`,
        diag.error ? `<!-- error: ${diag.error} -->` : '',
        '<!-- /IMAGE PLUGIN DEBUG -->'
    ].filter(c => c).join('\n');

    return `${comments}\n${html}`;
}

/**
 * Determine if an image is "tall" based on its actual dimensions
 */
function checkIfTallImage(src: string, env: MarkdownItEnv, diag: ImageDiagnostics): { isTall: boolean } {
    try {
        // Resolve image path to absolute path
        const imagePath = resolveImagePath(src, env);
        diag.resolvedPath = imagePath || 'FAILED';

        if (!imagePath) {
            diag.error = 'Path resolution failed';
            diag.decision = 'ERROR';
            return { isTall: false };
        }

        diag.fileExists = fs.existsSync(imagePath);
        if (!diag.fileExists) {
            diag.error = 'File does not exist';
            diag.decision = 'ERROR';
            return { isTall: false };
        }

        // Read image file as buffer
        const buffer = fs.readFileSync(imagePath);

        // Read image dimensions
        const dimensions = imageSize(buffer);
        if (!dimensions.width || !dimensions.height) {
            diag.error = 'Invalid dimensions';
            diag.decision = 'ERROR';
            return { isTall: false };
        }

        diag.dimensions = { width: dimensions.width, height: dimensions.height };

        // Calculate aspect ratio (height / width)
        const aspectRatio = dimensions.height / dimensions.width;
        diag.aspectRatio = aspectRatio;

        // Consider "tall" if height is significantly greater than width
        const isTall = aspectRatio > ASPECT_RATIO_THRESHOLD;
        diag.decision = isTall ? 'TALL' : 'NORMAL';

        return { isTall };
    } catch (error) {
        // If we can't read the image, don't apply container
        diag.error = error instanceof Error ? error.message : String(error);
        diag.decision = 'ERROR';
        return { isTall: false };
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
