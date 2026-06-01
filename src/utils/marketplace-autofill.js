/**
 * Marketplace Buy Modal Autofill Utility
 * Provides shared functionality for auto-filling quantity in marketplace buy modals
 * Used by missing materials features (actions, houses, etc.)
 */

import domObserver from '../core/dom-observer.js';

/**
 * Find the quantity input in the buy modal
 * For equipment items, there are multiple number inputs (enhancement level + quantity)
 * We need to find the correct one by checking parent containers for label text
 * @param {HTMLElement} modal - Modal container element
 * @returns {HTMLInputElement|null} Quantity input element or null
 */
function findQuantityInput(modal) {
    const allInputs = Array.from(modal.querySelectorAll('input[type="number"]'));

    if (allInputs.length === 0) return null;
    if (allInputs.length === 1) return allInputs[0];

    // Multiple inputs: the quantity input is the LAST number input
    // (enhancement level inputs come first, quantity is always last)
    return allInputs[allInputs.length - 1];
}

/**
 * Handle buy modal appearance and auto-fill quantity if available
 * @param {HTMLElement} modal - Modal container element
 * @param {number|null} activeQuantity - Static quantity to auto-fill (null if using pending fn)
 * @param {Function|null} pendingCalculation - Lazy fn that returns current quantity (takes priority)
 */
function handleBuyModal(modal, activeQuantity, pendingCalculation) {
    // Resolve quantity: prefer lazy recalculation over stored static value
    const quantity = pendingCalculation ? pendingCalculation() : activeQuantity;

    // Check if we have a quantity to fill
    if (!quantity || quantity <= 0) {
        return;
    }

    // Check if this is a buy modal (has a buy/confirm button)
    // A sell modal would have a sell button instead
    const isBuyModal = modal.querySelector('[class*="Button_buy"]');
    if (!isBuyModal) {
        return;
    }

    // Find the quantity input - need to be specific to avoid enhancement level input
    const quantityInput = findQuantityInput(modal);
    if (!quantityInput) {
        return;
    }

    // Set the quantity value
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(quantityInput, quantity.toString());

    // Trigger input event to notify React
    const inputEvent = new Event('input', { bubbles: true });
    quantityInput.dispatchEvent(inputEvent);
}

/**
 * Create an autofill manager instance
 * Manages storing quantity to autofill and observing buy modals
 * @param {string} observerId - Unique ID for this observer (e.g., 'MissingMats-Actions')
 * @returns {Object} Autofill manager with methods: setQuantity, setPendingCalculation, clearQuantity, initialize, cleanup
 */
export function createAutofillManager(observerId) {
    let activeQuantity = null;
    let pendingCalculation = null;
    let observerUnregister = null;

    return {
        /**
         * Set a static quantity to auto-fill in the next buy modal
         * @param {number} quantity - Quantity to auto-fill
         */
        setQuantity(quantity) {
            activeQuantity = quantity;
            pendingCalculation = null;
        },

        /**
         * Set a lazy calculation function that is called each time a buy modal opens.
         * Takes priority over setQuantity — quantity is recomputed fresh on every modal open,
         * so subsequent purchases within the same session always autofill the remaining needed amount.
         * @param {Function} fn - Function returning the current quantity to fill
         */
        setPendingCalculation(fn) {
            pendingCalculation = fn;
            activeQuantity = null;
        },

        /**
         * Clear the stored quantity (cancel autofill)
         */
        clearQuantity() {
            activeQuantity = null;
            pendingCalculation = null;
        },

        /**
         * Get the current active quantity
         * @returns {number|null} Current quantity or null
         */
        getQuantity() {
            return pendingCalculation ? pendingCalculation() : activeQuantity;
        },

        /**
         * Initialize buy modal observer
         * Sets up watching for buy modals to appear and auto-fills them
         */
        initialize() {
            observerUnregister = domObserver.onClass(observerId, 'Modal_modalContainer', (modal) => {
                handleBuyModal(modal, activeQuantity, pendingCalculation);
                // Clear static quantity after use (one-shot) — pendingCalculation persists intentionally
                if (activeQuantity !== null && !pendingCalculation) {
                    activeQuantity = null;
                }
            });
        },

        /**
         * Cleanup observer
         * Stops watching for buy modals and clears quantity
         */
        cleanup() {
            if (observerUnregister) {
                observerUnregister();
                observerUnregister = null;
            }
            activeQuantity = null;
            pendingCalculation = null;
        },
    };
}
