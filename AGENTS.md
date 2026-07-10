# AGENTS.md - Toolasha Developer Guide

Guide for AI coding agents working on this Tampermonkey userscript for Milky Way Idle.

## Build, Lint, and Test Commands

```bash
npm install            # Install dependencies
npm run build:dev       # Build dev standalone → dist/Toolasha-dev.user.js
npm run build           # Build production bundles → dist/Toolasha.user.js + dist/libraries
npm run dev            # Watch mode (auto-rebuild)

npm run lint           # Lint code
npm run lint:fix       # Auto-fix lint issues
npm run format         # Prettier (JS/MD)

npm run lint:md        # Markdown lint
npm run lint:md:fix    # Auto-fix markdown
npm run lint:md:links  # Link check

npm test               # Run all tests
npm run test:watch     # Test watch mode

# Single test file
npm test -- src/utils/formatters.test.js

# Single test by pattern
npm test -- -t "numberFormatter"
```

**Pre-commit hooks:** ESLint + Prettier + tests + build run on commit.
**Manual testing:** Install `dist/Toolasha-dev.user.js` in Tampermonkey and open <https://www.milkywayidle.com/game>.

### Browser Testing via Chrome DevTools MCP

When user has remote debugging enabled, test directly in the running browser:

```bash
# 1. Build dev version
npm run build:dev

# 2. Check browser pages (game should be open)
# Use: chrome-devtools_list_pages

# 3. Select game page
# Use: chrome-devtools_select_page (pageId: N)

# 4. Verify script is loaded
# Use: chrome-devtools_evaluate_script
() => ({
    toolashaElements: document.querySelectorAll('[class*="mwi-"], [id*="mwi-"]').length,
    hasToolashaGlobal: typeof window.Toolasha !== 'undefined'
})

# 5. Check for errors
# Use: chrome-devtools_list_console_messages (types: ["error", "warn"])

# 6. Test specific features
# Navigate to relevant page, click elements, verify UI
```

### MANDATORY: Dev Build Testing

ALL code changes MUST be tested via dev build before marking tasks complete:

1. `npm run build:dev` — build must succeed
2. Inject into browser — reload page to load new script
3. Verify script loads — check `window.Toolasha` exists
4. Check console — no errors or warnings
5. Test affected feature — navigate to relevant page, verify functionality
6. Check memory — `performance.memory.usedJSHeapSize` should not spike

Skip testing = incomplete work.

### Feature Verification via Chrome DevTools

```bash
# Check script version and module structure
# Use: chrome-devtools_evaluate_script
() => ({
    version: window.Toolasha?.version,
    modules: Object.keys(window.Toolasha || {}),
    elementCount: document.querySelectorAll('[class*="mwi-"]').length
})

# Check specific feature module exists
# Use: chrome-devtools_evaluate_script
() => window.Toolasha?.UI?.taskRerollProtection?.isInitialized

# Verify fix is applied (e.g., max limit constant)
# Use: chrome-devtools_evaluate_script
() => window.Toolasha?.Chat?.mentionTracker?.MAX_MENTIONS_PER_CHANNEL === 500

# Check memory before/after feature use
# Use: chrome-devtools_evaluate_script
() => performance.memory.usedJSHeapSize

# Verify no console errors after changes
# Use: chrome-devtools_list_console_messages (types: ["error", "warn"])
```

### MANDATORY: Automated Modify → Build → Install → Test Cycle

ALL code changes MUST follow this complete autonomous cycle:

#### Phase 1: Build
```bash
npm run build:dev
# Verify: exit code 0, file created at dist/Toolasha-dev.user.js
```

#### Phase 2: Serve & Install
```bash
# Kill any existing server on port 8099
lsof -ti:8099 | xargs kill -9 2>/dev/null || true

# Start HTTP server in background
cd /Users/chiron/Object/Toolasha/dist && nohup python3 -m http.server 8099 > /dev/null 2>&1 &
sleep 2

# Verify server is running
curl -s -o /dev/null -w "%{http_code}" http://localhost:8099/Toolasha-dev.user.js
# Must return: 200
```

#### Phase 3: Trigger Tampermonkey Installation
```bash
# Use: chrome-devtools_new_page
# Open: http://localhost:8099/Toolasha-dev.user.js
# This triggers Tampermonkey's installation dialog

# Note: Tampermonkey dialog is an extension popup, not page DOM
# User must confirm installation manually (first time only)
# After first install, updates are automatic on page reload
```

#### Phase 4: Verify Installation
```bash
# Navigate to game page
# Use: chrome-devtools_select_page (game page)
# Use: chrome-devtools_navigate_page
# url: https://www.milkywayidle.com/game?characterId=371685

# Wait for page load and verify script
# Use: chrome-devtools_evaluate_script
() => new Promise(resolve => {
    const check = () => {
        if (document.readyState === 'complete' && window.Toolasha) {
            resolve({
                version: window.Toolasha.version,
                hasToolasha: true,
                modules: Object.keys(window.Toolasha)
            });
        } else if (document.readyState === 'complete') {
            resolve({ hasToolasha: false, error: 'Toolasha not loaded' });
        } else {
            setTimeout(check, 1000);
        }
    };
    check();
})
```

#### Phase 5: Feature-Specific Testing
```bash
# Check console for errors
# Use: chrome-devtools_list_console_messages
# types: ["error", "warn"]

# Test specific feature exists and is initialized
# Use: chrome-devtools_evaluate_script
() => ({
    mentionTracker: window.Toolasha?.UI?.mentionTracker?.initialized,
    remainingXP: window.Toolasha?.UI?.remainingXP?.initialized,
    // Add more features as needed
})

# Verify memory is stable
# Use: chrome-devtools_evaluate_script
() => performance.memory.usedJSHeapSize
```

#### Phase 6: Cleanup Server
```bash
# After testing, stop the server
lsof -ti:8099 | xargs kill -9 2>/dev/null || true
```

#### Quick Reference: Full Cycle Command
```bash
# One-shot: build + serve + verify server
npm run build:dev && \
lsof -ti:8099 | xargs kill -9 2>/dev/null; \
cd /Users/chiron/Object/Toolasha/dist && nohup python3 -m http.server 8099 > /dev/null 2>&1 & \
sleep 2 && \
curl -s -o /dev/null -w "Server: %{http_code}\n" http://localhost:8099/Toolasha-dev.user.js && \
echo "Ready: Open http://localhost:8099/Toolasha-dev.user.js in browser"
```

**Skip any phase = incomplete work.**

## Project Structure (High-Level)

```
src/
├── main.js           # Entry point
├── core/             # Core systems (storage, config, websocket, data-manager)
├── features/         # Feature modules (market, actions, combat, tasks, etc.)
├── api/              # External API integrations (marketplace)
└── utils/            # Shared utilities (formatters, dom, efficiency, profit-helpers)
```

Tests are co-located: `formatters.js` → `formatters.test.js`.

## Code Style & Conventions

### Imports

- **Always use `.js` extension** in imports.
- **Order:** core → api → features → utils.

```js
import config from '../core/config.js';
import marketAPI from '../api/marketplace.js';
import someFeature from '../features/foo/bar.js';
import { formatWithSeparator } from '../utils/formatters.js';
```

### Formatting

- 4 spaces indentation
- 120-char line length
- Single quotes, semicolons required
- Trailing commas (ES5), LF line endings

### Naming

- Files: `kebab-case.js`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### Async/Await

- **Use async/await** only (no `.then()` chains).

### Error Handling

- Use try/catch with module-prefixed logs.

```js
try {
    const result = await someAsyncOperation();
    return result;
} catch (error) {
    console.error('[ModuleName] Operation failed:', error);
    return null;
}
```

### JSDoc

- Document public functions and exported helpers with JSDoc.

## Architecture Patterns

### Singleton Core Modules

```js
class DataManager {
    constructor() {
        this.data = null;
    }
}
const dataManager = new DataManager();
export default dataManager;
```

### Feature Interface

```js
export default {
    name: 'Feature Name',
    initialize: async () => {
        /* setup */
    },
    cleanup: () => {
        /* teardown */
    },
};
```

### Data Access

```js
import dataManager from '../core/data-manager.js';
const itemDetails = dataManager.getItemDetails(itemHrid);
```

### Storage

```js
import storage from '../core/storage.js';
await storage.set('key', value, 'storeName');
const value = await storage.get('key', 'storeName', defaultValue);
```

## Lifecycle & Cleanup

- Prefer `createCleanupRegistry()` for timers/observers.
- Use `createTimerRegistry()` for intervals/timeouts.
- Remove observers/listeners on `cleanup()` or `disable()`.

## Anti-Patterns to Avoid

- ❌ `.then()` chains
- ❌ Direct `localStorage` access → use storage module
- ❌ Direct game data access → use dataManager
- ❌ `var`
- ❌ Mutating function parameters
- ❌ Missing `.js` in imports

## Key Files

- `src/main.js` (entry/init)
- `src/core/data-manager.js` (game data access)
- `src/core/storage.js` (IndexedDB)
- `src/core/websocket.js` (WS interception)
- `src/core/feature-registry.js` (feature bootstrapping)
- `src/utils/formatters.js` (number/time formatting)
- `src/utils/efficiency.js` (efficiency math)
- `src/utils/profit-helpers.js` (profit/rate helpers)

## Tooling Rules

- ESLint: no `var`, no `eval`, prefer `const`, no duplicate imports.

## Cursor / Copilot Rules

- No `.cursorrules` or `.github/copilot-instructions.md` found in this repo.

```

```
