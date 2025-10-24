import { MarkdownIt, Token } from "../@types/markdown-it";
import { MarkdownItEnv } from '../services/common/interfaces';
import * as path from 'path';
import * as fs from 'fs';
import imageSize = require('image-size');

/**
 * Plugin to wrap tall/mobile screenshot images in scrollable containers
 *
 * Detection method: Reads actual image dimensions and calculates aspect ratio
 * - Images with height/width ratio > 1.5 are wrapped in scrollable containers
 * - Opt-out: title="no-scroll"
 */

// Configuration
const ASPECT_RATIO_THRESHOLD = 1.5; // Images taller than this ratio get scrollable container

export function MarkdownItImageContainer(md: MarkdownIt) {
    // Store original image renderer
    const defaultRender = md.renderer.rules.image ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    // Override image rendering
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const src = token.attrGet('src') || '';
        const title = token.attrGet('title') || '';
        const alt = token.content;

        // Check for explicit opt-out
        if (title === 'no-scroll') {
            // Remove the marker and render normally
            token.attrSet('title', '');
            return defaultRender(tokens, idx, options, env, self);
        }

        // Check if this is a tall image based on actual dimensions
        const shouldScroll = isTallImage(src, env as MarkdownItEnv);

        if (!shouldScroll) {
            // Normal rendering for non-tall images
            return defaultRender(tokens, idx, options, env, self);
        }

        // Render the image element
        const imgHtml = defaultRender(tokens, idx, options, env, self);

        // Wrap in scrollable container
        return `<div class="image-scroll-container" data-image-type="tall">
  <div class="image-scroll-inner">
    ${imgHtml}
  </div>
  <div class="image-scroll-hint">↕ Scroll to view full image</div>
</div>`;
    };
}

/**
 * Determine if an image is "tall" based on its actual dimensions
 */
function isTallImage(src: string, env: MarkdownItEnv): boolean {
    try {
        // Resolve image path to absolute path
        const imagePath = resolveImagePath(src, env);
        if (!imagePath || !fs.existsSync(imagePath)) {
            return false;
        }

        // Read image file as buffer
        const buffer = fs.readFileSync(imagePath);

        // Read image dimensions
        const dimensions = imageSize(buffer);
        if (!dimensions.width || !dimensions.height) {
            return false;
        }

        // Calculate aspect ratio (height / width)
        const aspectRatio = dimensions.height / dimensions.width;

        // Consider "tall" if height is significantly greater than width
        return aspectRatio > ASPECT_RATIO_THRESHOLD;
    } catch (error) {
        // If we can't read the image, don't apply container
        return false;
    }
}

/**
 * Resolve relative image path to absolute path
 * Adapted from MarkdownItExportHelper.searchFile()
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

    // Build search paths: document directory and workspace folder
    const searchPaths: string[] = [];

    // Add document directory if available (used during export)
    if (env.htmlExporter?.uri?.fsPath) {
        searchPaths.push(path.dirname(env.htmlExporter.uri.fsPath));
    }

    // Add workspace folder if available (used during export)
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
