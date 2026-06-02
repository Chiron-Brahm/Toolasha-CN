/**
 * Task Reroll Diagnostic Tool
 *
 * This script helps us understand the task reroll system by:
 * 1. Capturing all WebSocket messages related to tasks
 * 2. Monitoring DOM changes for reroll UI
 * 3. Tracking reroll button clicks and cost changes
 * 4. Logging all available task data
 *
 * USAGE:
 * 1. Build and install MWI Tools
 * 2. Open browser console
 * 3. Run: MWITools.diagnostics.startTaskRerollDiagnostic()
 * 4. Perform task reroll actions
 * 5. Run: MWITools.diagnostics.stopTaskRerollDiagnostic()
 * 6. Review logged data
 */

class TaskRerollDiagnostic {
    constructor() {
        this.isActive = false;
        this.capturedMessages = [];
        this.domObserver = null;
        this.clickListeners = [];
        this.taskData = {
            currentTasks: [],
            rerollCosts: [],
            uiElements: []
        };
    }

    /**
     * Start diagnostic monitoring
     */
    start() {
        if (this.isActive) {
            console.log('[Task Reroll Diagnostic] Already active');
            return;
        }

        console.log('[Task Reroll Diagnostic] Starting...');
        this.isActive = true;
        this.capturedMessages = [];

        // 1. Hook WebSocket messages
        this.hookWebSocket();

        // 2. Monitor DOM for reroll UI
        this.startDOMObserver();

        // 3. Capture current task state
        this.captureCurrentTaskState();

        console.log('[Task Reroll Diagnostic] Active! Perform task reroll actions now.');
        console.log('[Task Reroll Diagnostic] Call stopTaskRerollDiagnostic() when done to see results.');
    }

    /**
     * Stop diagnostic and display results
     */
    stop() {
        if (!this.isActive) {
            console.log('[Task Reroll Diagnostic] Not active');
            return;
        }

        console.log('[Task Reroll Diagnostic] Stopping...');
        this.isActive = false;

        // Stop DOM observer
        if (this.domObserver) {
            this.domObserver.disconnect();
            this.domObserver = null;
        }

        // Remove click listeners
        this.clickListeners.forEach(({ element, handler }) => {
            element.removeEventListener('click', handler);
        });
        this.clickListeners = [];

        // Display results
        this.displayResults();
    }

    /**
     * Hook WebSocket to capture task-related messages
     */
    hookWebSocket() {
        // Get the WebSocket hook instance
        const webSocketHook = window.MWITools?.websocket;
        if (!webSocketHook) {
            console.warn('[Task Reroll Diagnostic] WebSocket hook not available');
            return;
        }

        // Register wildcard handler to capture all messages
        this.wildcardHandler = (data) => {
            if (!this.isActive) return;

            // Check if message is task-related
            const messageStr = JSON.stringify(data).toLowerCase();
            if (messageStr.includes('task') ||
                messageStr.includes('reroll') ||
                messageStr.includes('cowbell')) {

                this.capturedMessages.push({
                    timestamp: new Date().toISOString(),
                    type: data.type,
                    data: data
                });

                console.log('[Task Reroll Diagnostic] Captured WebSocket message:', data.type);
                console.log(data);
            }
        };

        webSocketHook.on('*', this.wildcardHandler);
    }

    /**
     * Start DOM observer to watch for reroll UI
     */
    startDOMObserver() {
        this.domObserver = new MutationObserver((mutations) => {
            if (!this.isActive) return;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    // Look for task-related elements
                    this.inspectElement(node);
                }
            }
        });

        this.domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Inspect element for task/reroll related content
     */
    inspectElement(element) {
        // Check for reroll options container by class name
        const className = element.className || '';

        // Look for reroll options container
        if (className.includes('rerollOptionsContainer') || className.includes('RandomTask_rerollOptionsContainer')) {
            console.log('[Task Reroll Diagnostic] Found reroll options container:');
            console.log('Classes:', element.className);
            console.log('Element:', element);

            // Find all buttons in this container
            const buttons = element.querySelectorAll('button');
            console.log(`[Task Reroll Diagnostic] Found ${buttons.length} buttons in reroll container`);

            buttons.forEach(button => {
                // Get button text and SVG info
                const buttonText = button.textContent || '';
                const svg = button.querySelector('svg use');
                const svgHref = svg ? svg.getAttribute('href') : null;

                console.log('[Task Reroll Diagnostic] Payment button found:');
                console.log('  Text:', buttonText);
                console.log('  SVG href:', svgHref);
                console.log('  Full button:', button);

                this.attachClickListener(button);
            });

            // Store UI element info
            this.taskData.uiElements.push({
                timestamp: new Date().toISOString(),
                className: element.className,
                html: element.outerHTML.substring(0, 1000) // First 1000 chars
            });
        }

        // Also check for individual payment buttons by class
        if (className.includes('Button_button') && element.querySelector('svg use')) {
            const svg = element.querySelector('svg use');
            const svgHref = svg ? svg.getAttribute('href') : null;

            // Only process if it has cowbell or gold icon
            if (svgHref && (svgHref.includes('cowbell') || svgHref.includes('gold'))) {
                console.log('[Task Reroll Diagnostic] Payment button detected:');
                console.log('  Text:', element.textContent);
                console.log('  Currency:', svgHref.includes('cowbell') ? 'Cowbell' : 'Gold');

                this.attachClickListener(element);
            }
        }
    }

    /**
     * Attach click listener to button
     */
    attachClickListener(button) {
        const handler = (e) => {
            if (!this.isActive) return;

            console.log('[Task Reroll Diagnostic] Button clicked:', button.textContent);
            console.log('Button element:', button);
            console.log('Parent element:', button.parentElement);

            // Capture state before click
            const beforeState = this.captureTaskState();

            // Wait for changes after click
            setTimeout(() => {
                const afterState = this.captureTaskState();

                console.log('[Task Reroll Diagnostic] State comparison:');
                console.log('Before:', beforeState);
                console.log('After:', afterState);

                this.taskData.rerollCosts.push({
                    timestamp: new Date().toISOString(),
                    buttonText: button.textContent,
                    beforeState,
                    afterState
                });
            }, 1000);
        };

        button.addEventListener('click', handler);
        this.clickListeners.push({ element: button, handler });
    }

    /**
     * Capture current task state from DOM
     */
    captureTaskState() {
        const state = {
            timestamp: new Date().toISOString(),
            rerollOptionsContainers: [],
            paymentButtons: [],
            rerollCosts: []
        };

        // Find reroll options containers
        document.querySelectorAll('[class*="rerollOptionsContainer"]').forEach(container => {
            state.rerollOptionsContainers.push({
                className: container.className,
                html: container.outerHTML.substring(0, 500)
            });
        });

        // Find payment buttons with SVG icons
        document.querySelectorAll('button').forEach(button => {
            const svg = button.querySelector('svg use');
            if (svg) {
                const href = svg.getAttribute('href');
                if (href && (href.includes('cowbell') || href.includes('gold'))) {
                    const buttonText = button.textContent || '';
                    const costMatch = buttonText.match(/(\d+)/);
                    const cost = costMatch ? parseInt(costMatch[1]) : null;
                    const currency = href.includes('cowbell') ? 'cowbell' : 'gold';

                    state.paymentButtons.push({
                        text: buttonText,
                        cost: cost,
                        currency: currency,
                        className: button.className,
                        svgHref: href
                    });

                    if (cost) {
                        state.rerollCosts.push({
                            cost: cost,
                            currency: currency
                        });
                    }
                }
            }
        });

        return state;
    }

    /**
     * Capture initial task state
     */
    captureCurrentTaskState() {
        console.log('[Task Reroll Diagnostic] Capturing initial task state...');

        const state = this.captureTaskState();
        this.taskData.currentTasks.push(state);

        console.log('Initial state:', state);
    }

    /**
     * Display diagnostic results
     */
    displayResults() {
        console.log('\n==============================================');
        console.log('TASK REROLL DIAGNOSTIC RESULTS');
        console.log('==============================================\n');

        console.log('1. CAPTURED WEBSOCKET MESSAGES:');
        console.log(`Total messages: ${this.capturedMessages.length}`);
        if (this.capturedMessages.length > 0) {
            console.log('\nMessage Types:');
            const messageTypes = {};
            this.capturedMessages.forEach(msg => {
                messageTypes[msg.type] = (messageTypes[msg.type] || 0) + 1;
            });
            console.table(messageTypes);

            console.log('\nAll Messages:');
            this.capturedMessages.forEach((msg, i) => {
                console.log(`\nMessage ${i + 1}:`, msg.type);
                console.log(msg.data);
            });
        } else {
            console.log('No task-related WebSocket messages captured.');
        }

        console.log('\n----------------------------------------------');
        console.log('2. REROLL COST TRACKING:');
        console.log(`Total reroll button clicks: ${this.taskData.rerollCosts.length}`);
        if (this.taskData.rerollCosts.length > 0) {
            this.taskData.rerollCosts.forEach((reroll, i) => {
                console.log(`\nReroll ${i + 1}:`, reroll.buttonText);
                console.log('Before:', reroll.beforeState);
                console.log('After:', reroll.afterState);
            });
        } else {
            console.log('No reroll actions captured.');
        }

        console.log('\n----------------------------------------------');
        console.log('3. UI ELEMENTS FOUND:');
        console.log(`Total UI elements: ${this.taskData.uiElements.length}`);
        if (this.taskData.uiElements.length > 0) {
            this.taskData.uiElements.forEach((elem, i) => {
                console.log(`\nElement ${i + 1}:`);
                console.log('Text:', elem.text);
                console.log('Class:', elem.className);
            });
        } else {
            console.log('No task/reroll UI elements found.');
        }

        console.log('\n==============================================');
        console.log('RECOMMENDATIONS:');
        console.log('==============================================');

        if (this.capturedMessages.length === 0) {
            console.log('❌ No WebSocket messages captured.');
            console.log('   Recommendation: Task reroll data may not be sent via WebSocket.');
            console.log('   Try checking browser Network tab for HTTP requests.');
        } else {
            console.log('✅ WebSocket messages captured!');
            console.log('   Review messages above for reroll cost data.');
        }

        if (this.taskData.rerollCosts.length === 0) {
            console.log('\n❌ No reroll button clicks captured.');
            console.log('   Recommendation: Click reroll buttons while diagnostic is running.');
        } else {
            console.log('\n✅ Reroll actions captured!');
            console.log('   Review state changes above for cost tracking.');
        }

        console.log('\n==============================================\n');

        // Export results to window for further inspection
        window.__taskRerollDiagnosticResults = {
            messages: this.capturedMessages,
            rerollCosts: this.taskData.rerollCosts,
            uiElements: this.taskData.uiElements
        };

        console.log('Results exported to: window.__taskRerollDiagnosticResults');
    }
}

// Export for use in browser console
export default TaskRerollDiagnostic;
