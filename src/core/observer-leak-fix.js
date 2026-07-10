/**
 * MutationObserver Leak Fix
 *
 * The game creates redundant MutationObservers on MarketplacePanel_tabsComponent
 * on every React render without disconnecting old ones (251+ observed).
 * This patches observe() to deduplicate: same target + same options → keep newest 2.
 */
// ponytail: per-target-cap dedup, add per-checkbox observer pool if needed
const MAX_OBSERVERS = 2;

function serializeOptions(options) {
    const keys = [];
    for (const key of Object.keys(options)) {
        if (options[key] === true) keys.push(key);
    }
    if (options.attributeFilter && Array.isArray(options.attributeFilter)) {
        keys.push('af:' + options.attributeFilter.sort().join(','));
    }
    return keys.sort().join('|');
}

const targetRegistry = new WeakMap();

function install() {
    const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const pageMO = targetWindow.MutationObserver;
    if (!pageMO || pageMO.prototype.__toolashaObserverFixed) return;

    const originalObserve = pageMO.prototype.observe;

    pageMO.prototype.observe = function (target, options) {
        if (!(target instanceof Element)) {
            return originalObserve.call(this, target, options);
        }

        const key = serializeOptions(options);
        if (!key) return originalObserve.call(this, target, options);

        let optionsMap = targetRegistry.get(target);
        if (!optionsMap) {
            optionsMap = new Map();
            targetRegistry.set(target, optionsMap);
        }

        let observers = optionsMap.get(key);
        if (!observers) {
            observers = [];
            optionsMap.set(key, observers);
        }

        if (observers.length >= MAX_OBSERVERS) {
            const oldest = observers.shift();
            try {
                oldest.disconnect();
            } catch {
                /* already gone */
            }
        }

        observers.push(this);
        return originalObserve.call(this, target, options);
    };

    pageMO.prototype.__toolashaObserverFixed = true;
}

export default { install };
