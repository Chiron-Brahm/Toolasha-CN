#!/usr/bin/env node

/**
 * Auto-apply Chinese i18n to source files after upstream sync.
 *
 * After merging upstream changes, run this script to:
 * 1. Scan for hardcoded English strings that exist in i18n-zh-CN.js
 * 2. Replace them with t('English') calls in HTML template contexts
 * 3. Report any new English strings NOT yet in i18n-zh-CN.js
 *
 * Usage:
 *   node scripts/sync-i18n.js [--dry-run] [--files src/features/actions/foo.js ...]
 *
 * Options:
 *   --dry-run    Preview changes without modifying files
 *   --files      Only process specified files (default: all changed in last merge)
 *   --report     Only report missing translations, don't modify files
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const SRC_DIR = join(rootDir, 'src');
const I18N_FILE = join(SRC_DIR, 'core', 'i18n-zh-CN.js');
const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', '.tmp'];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const REPORT_ONLY = args.includes('--report');
const filesArgIdx = args.indexOf('--files');
const rawFileArgs = filesArgIdx >= 0 ? args.slice(filesArgIdx + 1) : null;
const SPECIFIED_FILES = rawFileArgs
    ? rawFileArgs.filter((a) => !a.startsWith('--'))
    : null;

function loadI18nKeys() {
    try {
        const content = readFileSync(I18N_FILE, 'utf8');
        const keyRegex = /'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g;
        const keys = new Map();
        let match;
        while ((match = keyRegex.exec(content)) !== null) {
            keys.set(match[1], match[2]);
        }
        return keys;
    } catch (e) {
        console.error('❌ Failed to load i18n file:', e.message);
        process.exit(1);
    }
}

function getChangedFiles() {
    try {
        let diffCmd;
        try {
            execSync('git rev-parse MERGE_HEAD', { cwd: rootDir, stdio: 'pipe' });
            diffCmd = 'git diff --name-only --diff-filter=AM MERGE_HEAD -- src/';
        } catch {
            const mergeCommit = execSync('git log -1 --merges --format=%H', { cwd: rootDir, encoding: 'utf8' }).trim();
            if (mergeCommit) {
                diffCmd = `git diff --name-only --diff-filter=AM ${mergeCommit}^ ${mergeCommit} -- src/`;
            } else {
                diffCmd = 'git diff --name-only --diff-filter=AM upstream/main -- src/';
            }
        }
        const output = execSync(diffCmd, { cwd: rootDir, encoding: 'utf8' });
        return output
            .split('\n')
            .map((f) => f.trim())
            .filter((f) => f.endsWith('.js') && !EXCLUDE_DIRS.some((d) => f.includes(d)));
    } catch (e) {
        console.error('⚠️  Could not determine changed files:', e.message);
        return [];
    }
}

function isInsideBacktickTemplate(content, position) {
    let backtickCount = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplate = false;

    for (let i = 0; i < position; i++) {
        const ch = content[i];
        const prev = i > 0 ? content[i - 1] : '';

        if (ch === '\\') {
            i++;
            continue;
        }

        if (ch === "'" && !inDoubleQuote && !inTemplate) {
            inSingleQuote = !inSingleQuote;
        } else if (ch === '"' && !inSingleQuote && !inTemplate) {
            inDoubleQuote = !inDoubleQuote;
        } else if (ch === '`' && !inSingleQuote && !inDoubleQuote) {
            inTemplate = !inTemplate;
            if (inTemplate) backtickCount++;
        }
    }

    return inTemplate;
}

function findUntranslatedStrings(content, i18nKeys) {
    const results = [];
    const inlineLabelRegex = />([A-Z][A-Za-z /]+:?)</g;

    for (const match of content.matchAll(inlineLabelRegex)) {
        const label = match[1];
        const labelKeyNoColon = label.replace(/:$/, '');
        const i18nKey = i18nKeys.has(label) ? label : i18nKeys.has(labelKeyNoColon) ? labelKeyNoColon : null;
        if (!i18nKey) continue;

        if (!isInsideBacktickTemplate(content, match.index)) continue;

        const before = content.substring(Math.max(0, match.index - 30), match.index);
        if (before.includes('$t(') || before.includes('${t(')) continue;

        results.push({
            type: 'hardcoded-label',
            match: label,
            i18nKey,
            // ponytail: +1 offset matches the regex boundary in line 137 (>text< → keep the >)
            position: match.index + 1,
            line: content.substring(0, match.index).split('\n').length,
        });
    }

    const attrLabelRegex = /(?:title|placeholder|aria-label)="([A-Z][A-Za-z /:.?!-]{3,60})"/g;
    for (const match of content.matchAll(attrLabelRegex)) {
        const label = match[1];
        if (!i18nKeys.has(label)) continue;

        if (!isInsideBacktickTemplate(content, match.index)) continue;

        const before = content.substring(Math.max(0, match.index - 30), match.index);
        if (before.includes('t(')) continue;

        results.push({
            type: 'hardcoded-attr',
            match: label,
            i18nKey: label,
            // ponytail: +match[0].indexOf(label) skips the "title="/"placeholder="/"aria-label=" prefix
            position: match.index + match[0].indexOf(label),
            line: content.substring(0, match.index).split('\n').length,
        });
    }

    return results;
}

function applyReplacements(content, findings) {
    let modified = content;
    let offset = 0;

    for (const finding of findings) {
        const pos = finding.position + offset;
        const replacement = `\${t('${finding.i18nKey}')}`;

        const before = modified.substring(0, pos);
        const after = modified.substring(pos + finding.match.length);
        modified = before + replacement + after;
        offset += replacement.length - finding.match.length;
    }

    return modified;
}

function processFile(filePath, i18nKeys) {
    const fullPath = join(rootDir, filePath);
    let content;
    try {
        content = readFileSync(fullPath, 'utf8');
    } catch (e) {
        console.error(`  ⚠️  Cannot read ${filePath}:`, e.message);
        return { filePath, findings: [], changed: false };
    }

    const findings = findUntranslatedStrings(content, i18nKeys);

    if (findings.length === 0) {
        return { filePath, findings: [], changed: false };
    }

    const modified = applyReplacements(content, findings);

    return {
        filePath,
        findings,
        changed: modified !== content,
        modifiedContent: modified,
    };
}

function main() {
    console.log('🔍 sync-i18n - Auto-apply Chinese translations\n');

    const i18nKeys = loadI18nKeys();
    console.log(`📖 Loaded ${i18nKeys.size} translation keys from i18n-zh-CN.js\n`);

    let files;
    if (SPECIFIED_FILES) {
        files = SPECIFIED_FILES;
        console.log(`📂 Processing ${files.length} specified file(s)`);
    } else {
        files = getChangedFiles();
        if (files.length === 0) {
            console.log('📂 No changed files detected. Use --files to specify files.');
            return;
        }
        console.log(`📂 Found ${files.length} changed file(s) from merge`);
    }

    let totalFindings = 0;
    let totalChanged = 0;

    for (const file of files) {
        const result = processFile(file, i18nKeys);

        if (result.findings.length > 0) {
            console.log(`\n📄 ${file} - ${result.findings.length} issue(s):`);
            for (const f of result.findings) {
                console.log(`   Line ${f.line}: "${f.match}" → t('${f.i18nKey}')`);
            }

            if (result.changed && !REPORT_ONLY && !DRY_RUN) {
                const fullPath = join(rootDir, file);
                writeFileSync(fullPath, result.modifiedContent, 'utf8');
                console.log(`   ✅ Applied ${result.findings.length} replacement(s)`);
                totalChanged++;
            } else if (DRY_RUN) {
                console.log(`   🔍 DRY RUN - would apply ${result.findings.length} replacement(s)`);
            }
            totalFindings += result.findings.length;
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    if (totalFindings === 0) {
        console.log('✅ All strings already translated! No changes needed.');
    } else if (DRY_RUN) {
        console.log(`🔍 DRY RUN: ${totalFindings} strings would be replaced in ${totalChanged} file(s).`);
        console.log('   Run without --dry-run to apply changes.');
    } else if (REPORT_ONLY) {
        console.log(`📋 REPORT: ${totalFindings} untranslated strings found in ${totalChanged} file(s).`);
    } else {
        console.log(`✅ Applied ${totalFindings} translations across ${totalChanged} file(s).`);
    }

    console.log(`\n💡 Tip: To add new translations, edit src/core/i18n-zh-CN.js`);
    console.log(`   Run 'npm run lint' && 'npm run build' to verify after changes.\n`);
}

main();
