#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const imageSize = require('image-size').default || require('image-size');

console.log('='.repeat(80));
console.log('IMAGE DETECTION TEST');
console.log('='.repeat(80));

// Configuration
const ASPECT_RATIO_THRESHOLD = 1.5;

// Test image path
const testImageRelative = 'assets/trav-mod02-lesson01-image09-image-9.png';
const testImageAbsolute = '/home/greg/mooc/courses/docs/course-04-trav/module-02/assets/trav-mod02-lesson01-image09-image-9.png';
const testImageVscodeUri = 'vscode-resource:/home/greg/mooc/courses/docs/course-04-trav/module-02/assets/trav-mod02-lesson01-image09-image-9.png';

function testImageDetection(description, imagePath) {
    console.log('\n' + '-'.repeat(80));
    console.log(`TEST: ${description}`);
    console.log('-'.repeat(80));
    console.log(`Input path: ${imagePath}`);

    try {
        // Step 1: Decode vscode-resource URI if needed
        let resolvedPath = imagePath;
        if (imagePath.startsWith('vscode-resource:')) {
            resolvedPath = decodeURIComponent(imagePath.replace('vscode-resource:', ''));
            console.log(`✓ Decoded vscode-resource URI`);
            console.log(`  Resolved to: ${resolvedPath}`);
        }

        // Step 2: Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            console.log(`✗ File does not exist: ${resolvedPath}`);
            return false;
        }
        console.log(`✓ File exists: ${resolvedPath}`);

        // Step 3: Read file as buffer
        const buffer = fs.readFileSync(resolvedPath);
        console.log(`✓ Read file (${buffer.length} bytes)`);

        // Step 4: Get dimensions
        const dimensions = imageSize(buffer);
        console.log(`✓ Got dimensions: ${dimensions.width}×${dimensions.height}`);

        if (!dimensions.width || !dimensions.height) {
            console.log(`✗ Invalid dimensions`);
            return false;
        }

        // Step 5: Calculate aspect ratio
        const aspectRatio = dimensions.height / dimensions.width;
        console.log(`✓ Aspect ratio: ${aspectRatio.toFixed(2)} (height/width)`);

        // Step 6: Decision
        const isTall = aspectRatio > ASPECT_RATIO_THRESHOLD;
        console.log(`✓ Decision: ${isTall ? 'TALL (wrap in container)' : 'NORMAL (no container)'}`);
        console.log(`  Threshold: ${ASPECT_RATIO_THRESHOLD}, Actual: ${aspectRatio.toFixed(2)}`);

        return isTall;

    } catch (error) {
        console.log(`✗ ERROR: ${error.message}`);
        console.log(`  Stack: ${error.stack}`);
        return false;
    }
}

// Run tests
const results = [];

results.push({
    name: 'Absolute path',
    result: testImageDetection('Absolute path', testImageAbsolute)
});

results.push({
    name: 'vscode-resource URI',
    result: testImageDetection('vscode-resource URI', testImageVscodeUri)
});

// Summary
console.log('\n' + '='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
results.forEach(r => {
    const status = r.result ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} - ${r.name}`);
});

const allPassed = results.every(r => r.result);
console.log('\n' + (allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'));
console.log('='.repeat(80));

process.exit(allPassed ? 0 : 1);
