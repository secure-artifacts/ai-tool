#!/usr/bin/env node
/**
 * Fix duplicate className attributes in TSX/JSX files
 * Handles both:
 * 1. className="foo" ... data-tip="x" className="tooltip-bottom"
 * 2. data-tip="x" className="tooltip-bottom" ... className={...}
 */

const fs = require('fs');
const path = require('path');

function findTsxFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(findTsxFiles(filePath));
        } else if (file.endsWith('.tsx')) {
            results.push(filePath);
        }
    });
    return results;
}

function fixDuplicateClassNames(content) {
    let changed = false;
    const lines = content.split('\n');
    const result = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Case 1: data-tip="x" className="tooltip-bottom" ... className={...}
        // Replace: data-tip="x" className="tooltip-bottom" -> data-tip="x"
        // And modify className={...} to include tooltip-bottom
        if (line.includes('className="tooltip-bottom"') && line.match(/className=\{/)) {
            // Remove className="tooltip-bottom"
            line = line.replace(/\s*className="tooltip-bottom"\s*/g, ' ');
            // Add tooltip-bottom to the dynamic className
            line = line.replace(/className=\{`([^`]+)`\}/g, (match, classes) => {
                if (!classes.includes('tooltip-bottom')) {
                    return `className={\`${classes} tooltip-bottom\`}`;
                }
                return match;
            });
            changed = true;
        }

        // Case 2: Same line - className="x" ... data-tip="y" className="tooltip-bottom"
        if (line.match(/className="[^"]+"\s+.*className="tooltip-bottom"/)) {
            // Remove the second className="tooltip-bottom"
            line = line.replace(/\s*className="tooltip-bottom"/g, '');
            // Add tooltip-bottom to the first className
            line = line.replace(/className="([^"]+)"/, (match, classes) => {
                if (!classes.includes('tooltip-bottom')) {
                    return `className="${classes} tooltip-bottom"`;
                }
                return match;
            });
            changed = true;
        }

        result.push(line);
    }

    return { content: result.join('\n'), changed };
}

// Main
const appsDir = path.join(__dirname, '..', 'apps');
const indexFile = path.join(__dirname, '..', 'index.tsx');
const files = findTsxFiles(appsDir);

// Also fix index.tsx
if (fs.existsSync(indexFile)) {
    files.push(indexFile);
}

let fixedCount = 0;

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const { content: fixed, changed } = fixDuplicateClassNames(content);
    if (changed) {
        fs.writeFileSync(file, fixed);
        console.log(`Fixed: ${path.relative(path.join(__dirname, '..'), file)}`);
        fixedCount++;
    }
});

console.log(`\nTotal files fixed: ${fixedCount}`);
