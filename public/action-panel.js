/**
 * action-panel.js - Categorized action buttons with keyboard shortcuts
 *
 * Replaces flat suggested_actions with categorized panels:
 * movement, social, explore, combat
 * Plus keyboard shortcuts: 1-9 for actions, Enter for input, M for map, Escape to dismiss
 */

window.ActionPanel = (function () {

    const CATEGORY_META = {
        movement: { icon: '\uD83D\uDEB6', label: 'Move' },
        social:   { icon: '\uD83D\uDCAC', label: 'Social' },
        explore:  { icon: '\uD83D\uDD0D', label: 'Explore' },
        combat:   { icon: '\u2694\uFE0F', label: 'Combat' }
    };

    // Track current action list for keyboard shortcuts
    let currentActions = [];

    /**
     * Update #quick-actions with categorized action buttons.
     * @param {object} categories - { movement:[], social:[], explore:[], combat:[] }
     */
    function updateActions(categories) {
        const container = document.getElementById('quick-actions');
        if (!container) return;

        currentActions = [];
        let keyIndex = 1;
        let html = '';

        // Ordered categories
        const order = ['movement', 'social', 'explore', 'combat'];

        for (const cat of order) {
            const actions = categories[cat];
            if (!actions || actions.length === 0) continue;

            html += `<div class="ap-category">`;
            html += `<div class="ap-category-header">${CATEGORY_META[cat]?.icon || ''} ${CATEGORY_META[cat]?.label || cat}</div>`;
            html += `<div class="ap-actions">`;

            for (const action of actions) {
                const key = keyIndex <= 9 ? keyIndex : (keyIndex === 10 ? 0 : null);
                const keyBadge = key !== null ? `<span class="kb-hint">${key}</span>` : '';
                html += `<button class="ap-action quick-action" data-action="${escapeAttr(action.action)}">${keyBadge}${escapeHtml(action.label)}</button>`;
                currentActions.push(action);
                keyIndex++;
            }

            html += `</div></div>`;
        }

        // Always add Look to explore and Rest as utility
        html += `<div class="ap-category ap-utility">`;
        html += `<div class="ap-actions">`;

        // Look button
        const lookKey = keyIndex <= 9 ? keyIndex : (keyIndex === 10 ? 0 : null);
        const lookBadge = lookKey !== null ? `<span class="kb-hint">${lookKey}</span>` : '';
        html += `<button class="ap-action quick-action static-action" data-action="I look around carefully">${lookBadge}\uD83D\uDC40 Look</button>`;
        currentActions.push({ label: 'Look', action: 'I look around carefully' });
        keyIndex++;

        // Rest button
        const restKey = 0;
        html += `<button class="ap-action quick-action static-action" data-action="I find a safe spot to rest and catch my breath"><span class="kb-hint">${restKey}</span>\uD83D\uDCA4 Rest</button>`;
        // Rest is always key 0
        html += `</div></div>`;

        container.innerHTML = html;

        // Animate in
        container.querySelectorAll('.ap-action').forEach((btn, i) => {
            btn.style.animationDelay = `${i * 50}ms`;
            btn.classList.add('ap-pop');
        });
    }

    /**
     * Backward compat fallback for flat suggested_actions.
     * @param {Array} actions - [{ label, action }]
     */
    function updateFlatActions(actions) {
        if (!actions || actions.length === 0) return;

        const container = document.getElementById('quick-actions');
        if (!container) return;

        // Only update if we don't already have categorized actions displayed
        if (container.querySelector('.ap-category')) return;

        currentActions = [];
        const dynamicBtns = container.querySelectorAll('.dynamic-action');
        actions.forEach((action, i) => {
            if (dynamicBtns[i] && action.label && action.action) {
                const btn = dynamicBtns[i];
                btn.textContent = `${pickEmoji(action.label)} ${action.label}`;
                btn.dataset.action = action.action;
                btn.classList.add('dynamic-updating');
                setTimeout(() => btn.classList.remove('dynamic-updating'), 500);
                currentActions.push(action);
            }
        });
    }

    /**
     * Initialize global keyboard shortcuts.
     */
    function initKeyboard() {
        document.addEventListener('keydown', function (e) {
            // Skip when focus is in input/textarea
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                // Only handle Escape to blur
                if (e.key === 'Escape') {
                    document.activeElement.blur();
                    if (window.NarrativeFormatter) {
                        window.NarrativeFormatter.hideEntityMenu();
                    }
                }
                return;
            }

            // Number keys 1-9, 0
            if (e.key >= '1' && e.key <= '9') {
                e.preventDefault();
                const index = parseInt(e.key) - 1;
                clickActionByIndex(index);
                return;
            }
            if (e.key === '0') {
                e.preventDefault();
                // 0 = Rest
                const restBtn = document.querySelector('.ap-action[data-action*="rest"]');
                if (restBtn) {
                    restBtn.click();
                } else {
                    // Fallback: find rest in static actions
                    const staticRest = document.querySelector('[data-action*="rest"]');
                    if (staticRest) staticRest.click();
                }
                return;
            }

            // Enter → focus chat input
            if (e.key === 'Enter') {
                e.preventDefault();
                const inputField = document.getElementById('chat-box');
                if (inputField) inputField.focus();
                return;
            }

            // Escape → close entity menus, blur
            if (e.key === 'Escape') {
                if (window.NarrativeFormatter) {
                    window.NarrativeFormatter.hideEntityMenu();
                }
                return;
            }

            // M → cycle map zoom
            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                if (window.mapViewer && typeof window.mapViewer.cycleZoom === 'function') {
                    window.mapViewer.cycleZoom();
                } else if (window.mapViewer && typeof window.mapViewer.refresh === 'function') {
                    window.mapViewer.refresh();
                }
                return;
            }
        });
    }

    function clickActionByIndex(index) {
        const buttons = document.querySelectorAll('.ap-action');
        if (buttons[index]) {
            buttons[index].click();
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function pickEmoji(label) {
        const lower = label.toLowerCase();
        if (lower.includes('talk') || lower.includes('speak') || lower.includes('ask') || lower.includes('greet')) return '\uD83D\uDCAC';
        if (lower.includes('fight') || lower.includes('attack') || lower.includes('strike')) return '\u2694\uFE0F';
        if (lower.includes('search') || lower.includes('examine') || lower.includes('inspect')) return '\uD83D\uDD0D';
        if (lower.includes('go') || lower.includes('head') || lower.includes('move') || lower.includes('travel')) return '\uD83D\uDEB6';
        if (lower.includes('buy') || lower.includes('shop') || lower.includes('trade')) return '\uD83D\uDED2';
        if (lower.includes('read') || lower.includes('book') || lower.includes('scroll')) return '\uD83D\uDCDC';
        if (lower.includes('open') || lower.includes('door') || lower.includes('enter')) return '\uD83D\uDEAA';
        if (lower.includes('take') || lower.includes('pick') || lower.includes('grab')) return '\u270B';
        if (lower.includes('explore') || lower.includes('wander') || lower.includes('venture')) return '\uD83E\uDDED';
        if (lower.includes('listen') || lower.includes('eavesdrop')) return '\uD83D\uDC42';
        return '\u27A1\uFE0F';
    }

    // ========== PUBLIC API ==========

    return {
        updateActions,
        updateFlatActions,
        initKeyboard
    };

})();
