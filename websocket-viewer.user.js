// ==UserScript==
// @name         MWI WebSocket Viewer
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Debug tool to view WebSocket messages from Milky Way Idle
// @author       Celasha and Claude
// @license      CC-BY-NC-SA-4.0
// @run-at       document-start
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    class WebSocketViewer {
        constructor() {
            this.messages = [];
            this.maxMessages = 100;
            this.isHooked = false;
            this.isPaused = false;
            this.selectedFilter = 'all';
            this.searchTerm = '';
            this.isVisible = false;

            // Install hook immediately
            this.installHook();

            // Wait for DOM to add UI
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.createUI());
            } else {
                this.createUI();
            }
        }

        installHook() {
            if (this.isHooked) return;

            const viewer = this;
            const OriginalWebSocket = window.WebSocket;

            class WrappedWebSocket extends OriginalWebSocket {
                constructor(...args) {
                    super(...args);

                    if (this.url.startsWith("wss://api.milkywayidle.com/ws") ||
                        this.url.startsWith("wss://api-test.milkywayidle.com/ws")) {

                        this.addEventListener("message", (event) => {
                            viewer.onMessage(event.data);
                        });
                    }
                }
            }

            // Preserve static properties
            Object.defineProperty(WrappedWebSocket, 'CONNECTING', {
                value: OriginalWebSocket.CONNECTING,
                writable: false,
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(WrappedWebSocket, 'OPEN', {
                value: OriginalWebSocket.OPEN,
                writable: false,
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(WrappedWebSocket, 'CLOSED', {
                value: OriginalWebSocket.CLOSED,
                writable: false,
                enumerable: true,
                configurable: true
            });

            window.WebSocket = WrappedWebSocket;
            this.isHooked = true;
            console.log('[WebSocket Viewer] Hook installed');
        }

        onMessage(rawMessage) {
            if (this.isPaused) return;

            try {
                const data = JSON.parse(rawMessage);
                const message = {
                    timestamp: new Date(),
                    type: data.type || 'unknown',
                    data: data,
                    raw: rawMessage
                };

                this.messages.unshift(message);

                // Keep only last N messages
                if (this.messages.length > this.maxMessages) {
                    this.messages.pop();
                }

                // Update UI if visible
                if (this.isVisible) {
                    this.updateMessageList();
                    this.updateStats();
                }
            } catch (error) {
                console.error('[WebSocket Viewer] Failed to parse message:', error);
            }
        }

        createUI() {
            // Add styles
            const style = document.createElement('style');
            style.textContent = `
                #ws-viewer-toggle {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 10000;
                    background: #2d3748;
                    color: white;
                    border: none;
                    padding: 12px 20px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-family: monospace;
                    font-size: 14px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                }

                #ws-viewer-toggle:hover {
                    background: #4a5568;
                }

                #ws-viewer-panel {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 90%;
                    max-width: 1200px;
                    height: 80vh;
                    background: #1a202c;
                    border: 2px solid #4a5568;
                    border-radius: 12px;
                    z-index: 10001;
                    display: none;
                    flex-direction: column;
                    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
                }

                #ws-viewer-panel.visible {
                    display: flex;
                }

                .ws-header {
                    background: #2d3748;
                    padding: 16px 20px;
                    border-bottom: 1px solid #4a5568;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-radius: 12px 12px 0 0;
                }

                .ws-header h2 {
                    margin: 0;
                    color: #f7fafc;
                    font-size: 18px;
                    font-family: monospace;
                }

                .ws-controls {
                    padding: 12px 20px;
                    border-bottom: 1px solid #4a5568;
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    background: #2d3748;
                }

                .ws-controls select,
                .ws-controls input {
                    background: #1a202c;
                    color: #f7fafc;
                    border: 1px solid #4a5568;
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-family: monospace;
                    font-size: 13px;
                }

                .ws-controls button {
                    background: #4a5568;
                    color: white;
                    border: none;
                    padding: 6px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-family: monospace;
                    font-size: 13px;
                }

                .ws-controls button:hover {
                    background: #718096;
                }

                .ws-controls button.active {
                    background: #48bb78;
                }

                .ws-stats {
                    padding: 8px 20px;
                    background: #2d3748;
                    border-bottom: 1px solid #4a5568;
                    color: #cbd5e0;
                    font-family: monospace;
                    font-size: 12px;
                }

                .ws-message-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                    background: #1a202c;
                }

                .ws-message {
                    background: #2d3748;
                    border: 1px solid #4a5568;
                    border-radius: 6px;
                    margin-bottom: 10px;
                    overflow: hidden;
                }

                .ws-message-header {
                    padding: 10px 12px;
                    background: #374151;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                }

                .ws-message-header:hover {
                    background: #4b5563;
                }

                .ws-message-type {
                    font-weight: bold;
                    color: #60a5fa;
                    font-family: monospace;
                    font-size: 14px;
                }

                .ws-message-time {
                    color: #9ca3af;
                    font-family: monospace;
                    font-size: 12px;
                }

                .ws-message-body {
                    padding: 12px;
                    background: #1f2937;
                    display: none;
                    max-height: 400px;
                    overflow-y: auto;
                }

                .ws-message-body.expanded {
                    display: block;
                }

                .ws-message-body pre {
                    margin: 0;
                    color: #e5e7eb;
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                }

                .ws-copy-btn {
                    background: #3b82f6;
                    color: white;
                    border: none;
                    padding: 4px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                    font-family: monospace;
                    margin-left: 8px;
                }

                .ws-copy-btn:hover {
                    background: #2563eb;
                }

                .ws-close-btn {
                    background: #ef4444;
                    color: white;
                    border: none;
                    padding: 6px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                    font-family: monospace;
                }

                .ws-close-btn:hover {
                    background: #dc2626;
                }

                /* Scrollbar styling */
                .ws-message-list::-webkit-scrollbar,
                .ws-message-body::-webkit-scrollbar {
                    width: 8px;
                }

                .ws-message-list::-webkit-scrollbar-track,
                .ws-message-body::-webkit-scrollbar-track {
                    background: #1a202c;
                }

                .ws-message-list::-webkit-scrollbar-thumb,
                .ws-message-body::-webkit-scrollbar-thumb {
                    background: #4a5568;
                    border-radius: 4px;
                }

                .ws-message-list::-webkit-scrollbar-thumb:hover,
                .ws-message-body::-webkit-scrollbar-thumb:hover {
                    background: #718096;
                }
            `;
            document.head.appendChild(style);

            // Create toggle button
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'ws-viewer-toggle';
            toggleBtn.textContent = 'WebSocket Viewer';
            toggleBtn.onclick = () => this.toggle();
            document.body.appendChild(toggleBtn);

            // Create panel
            const panel = document.createElement('div');
            panel.id = 'ws-viewer-panel';
            panel.innerHTML = `
                <div class="ws-header">
                    <h2>WebSocket Message Viewer</h2>
                    <button class="ws-close-btn" onclick="document.getElementById('ws-viewer-panel').classList.remove('visible')">Close</button>
                </div>
                <div class="ws-controls">
                    <select id="ws-filter">
                        <option value="all">All Messages</option>
                    </select>
                    <input type="text" id="ws-search" placeholder="Search messages...">
                    <button id="ws-pause-btn">Pause</button>
                    <button id="ws-clear-btn">Clear</button>
                </div>
                <div class="ws-stats" id="ws-stats">
                    No messages captured yet
                </div>
                <div class="ws-message-list" id="ws-message-list">
                    <p style="color: #9ca3af; font-family: monospace; text-align: center; padding: 20px;">
                        Waiting for messages...
                    </p>
                </div>
            `;
            document.body.appendChild(panel);

            // Bind controls
            document.getElementById('ws-filter').onchange = (e) => {
                this.selectedFilter = e.target.value;
                this.updateMessageList();
            };

            document.getElementById('ws-search').oninput = (e) => {
                this.searchTerm = e.target.value.toLowerCase();
                this.updateMessageList();
            };

            document.getElementById('ws-pause-btn').onclick = () => {
                this.isPaused = !this.isPaused;
                const btn = document.getElementById('ws-pause-btn');
                btn.textContent = this.isPaused ? 'Resume' : 'Pause';
                btn.classList.toggle('active', this.isPaused);
            };

            document.getElementById('ws-clear-btn').onclick = () => {
                this.messages = [];
                this.updateMessageList();
                this.updateStats();
            };
        }

        toggle() {
            this.isVisible = !this.isVisible;
            const panel = document.getElementById('ws-viewer-panel');
            panel.classList.toggle('visible', this.isVisible);

            if (this.isVisible) {
                this.updateMessageTypes();
                this.updateMessageList();
                this.updateStats();
            }
        }

        updateMessageTypes() {
            // Get unique message types
            const types = new Set(this.messages.map(m => m.type));
            const filter = document.getElementById('ws-filter');

            // Keep "all" option, add others
            const currentValue = filter.value;
            filter.innerHTML = '<option value="all">All Messages</option>';

            Array.from(types).sort().forEach(type => {
                const option = document.createElement('option');
                option.value = type;
                option.textContent = type;
                filter.appendChild(option);
            });

            filter.value = currentValue;
        }

        updateMessageList() {
            const container = document.getElementById('ws-message-list');

            // Filter messages
            let filtered = this.messages;

            if (this.selectedFilter !== 'all') {
                filtered = filtered.filter(m => m.type === this.selectedFilter);
            }

            if (this.searchTerm) {
                filtered = filtered.filter(m =>
                    m.raw.toLowerCase().includes(this.searchTerm)
                );
            }

            if (filtered.length === 0) {
                container.innerHTML = '<p style="color: #9ca3af; font-family: monospace; text-align: center; padding: 20px;">No matching messages</p>';
                return;
            }

            // Render messages
            container.innerHTML = filtered.map((msg, idx) => `
                <div class="ws-message">
                    <div class="ws-message-header" onclick="document.getElementById('ws-body-${idx}').classList.toggle('expanded')">
                        <span class="ws-message-type">${this.escapeHtml(msg.type)}</span>
                        <div>
                            <span class="ws-message-time">${msg.timestamp.toLocaleTimeString()}</span>
                            <button class="ws-copy-btn" onclick="event.stopPropagation(); navigator.clipboard.writeText(${this.escapeQuotes(msg.raw)}); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy', 1000)">Copy</button>
                        </div>
                    </div>
                    <div class="ws-message-body" id="ws-body-${idx}">
                        <pre>${this.escapeHtml(JSON.stringify(msg.data, null, 2))}</pre>
                    </div>
                </div>
            `).join('');
        }

        updateStats() {
            const stats = document.getElementById('ws-stats');
            const types = {};
            this.messages.forEach(m => {
                types[m.type] = (types[m.type] || 0) + 1;
            });

            const typeStats = Object.entries(types)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([type, count]) => `${type}: ${count}`)
                .join(' | ');

            stats.textContent = `Total: ${this.messages.length} | ${typeStats}`;
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        escapeQuotes(text) {
            return JSON.stringify(text);
        }
    }

    // Initialize viewer
    new WebSocketViewer();
})();
