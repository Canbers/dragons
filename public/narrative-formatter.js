/**
 * narrative-formatter.js - Post-processes completed AI narratives
 *
 * Adds:
 * - Dialogue speech bubbles (NpcName: "words")
 * - Clickable entity links for NPCs, objects, locations
 * - Discovery cards for newly found entities
 * - Entity context menus with relevant actions
 */

window.NarrativeFormatter = (function () {

    // ========== DIALOGUE & ENTITY FORMATTING ==========

    /**
     * Post-process a completed narrative message.
     * Escapes HTML, detects dialogue, wraps entity names as clickable links.
     * @param {string} text - Raw narrative text
     * @param {object} sceneEntities - { npcs:[], objects:[], locations:[], currentLocation:'' }
     * @returns {string} Formatted HTML
     */
    function formatCompletedMessage(text, sceneEntities) {
        if (!text) return '';

        // Escape HTML
        let html = escapeHtml(text);

        // Detect dialogue: NpcName: "words" or NpcName: "words"
        // Handles multi-sentence dialogue within quotes
        html = html.replace(
            /^(\w[\w\s]*?):\s*["\u201C](.+?)["\u201D]\s*$/gm,
            function (match, speaker, speech) {
                return `<div class="nf-dialogue"><span class="nf-speaker">${speaker}</span><span class="nf-speech">\u201C${speech}\u201D</span></div>`;
            }
        );

        // Also detect inline dialogue (not at line start)
        html = html.replace(
            /(\w[\w\s]*?):\s*["\u201C](.+?)["\u201D]/g,
            function (match, speaker, speech) {
                // Skip if already wrapped
                if (match.includes('nf-dialogue')) return match;
                return `<span class="nf-dialogue-inline"><span class="nf-speaker">${speaker}</span>: <span class="nf-speech">\u201C${speech}\u201D</span></span>`;
            }
        );

        // Wrap entity names as clickable links
        if (sceneEntities) {
            // Collect all entity names with their types, sort longest first
            const entities = [];
            if (sceneEntities.npcs) {
                sceneEntities.npcs.forEach(n => entities.push({ name: n, type: 'npc' }));
            }
            if (sceneEntities.objects) {
                sceneEntities.objects.forEach(n => entities.push({ name: n, type: 'object' }));
            }
            if (sceneEntities.features) {
                sceneEntities.features.forEach(n => entities.push({ name: n, type: 'location' }));
            }
            if (sceneEntities.locations) {
                sceneEntities.locations.forEach(n => entities.push({ name: n, type: 'location' }));
            }
            // Sort longest first to avoid partial matches
            entities.sort((a, b) => b.name.length - a.name.length);

            for (const entity of entities) {
                if (!entity.name || entity.name.length < 2) continue;
                const escapedName = escapeHtml(entity.name);
                // Only match names not already inside HTML tags
                const regex = new RegExp(
                    `(?<!<[^>]*)\\b(${escapeRegex(escapedName)})\\b(?![^<]*>)`,
                    'g'
                );
                html = html.replace(regex, function (match) {
                    return `<span class="nf-entity-link" data-entity-type="${entity.type}" data-entity-name="${escapedName}">${match}</span>`;
                });
            }
        }

        // Convert line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    // ========== DISCOVERY CARDS ==========

    /**
     * Render inline discovery cards for newly found entities.
     * @param {Array} discoveries - [{ name, type, description }]
     * @returns {string} HTML string
     */
    function renderDiscoveryCards(discoveries) {
        if (!discoveries || discoveries.length === 0) return '';

        const typeIcons = {
            npc: '\uD83D\uDDE3\uFE0F',      // speaking head
            object: '\uD83D\uDD2E',  // crystal ball
            location: '\uD83D\uDDFA\uFE0F'   // world map
        };

        const cards = discoveries.map(d => {
            const icon = typeIcons[d.type] || '\u2728';
            return `<div class="ec-card" data-entity-type="${escapeHtml(d.type)}" data-entity-name="${escapeHtml(d.name)}">
                <span class="ec-icon">${icon}</span>
                <div class="ec-info">
                    <span class="ec-name">${escapeHtml(d.name)}</span>
                    <span class="ec-desc">${escapeHtml(d.description)}</span>
                </div>
                <span class="ec-badge">NEW</span>
            </div>`;
        }).join('');

        return `<div class="ec-discovery-row">${cards}</div>`;
    }

    // ========== ENTITY CONTEXT MENU ==========

    let activeMenu = null;

    /**
     * Show a floating context menu near a clicked entity.
     * @param {HTMLElement} element - The clicked element
     * @param {string} name - Entity name
     * @param {string} type - Entity type (npc, object, location)
     */
    function showEntityMenu(element, name, type) {
        hideEntityMenu();

        const actions = getEntityActions(name, type);
        if (actions.length === 0) return;

        const menu = document.createElement('div');
        menu.className = 'em-menu';
        menu.innerHTML = `<div class="em-header">${escapeHtml(name)}</div>` +
            actions.map(a =>
                `<button class="em-action" data-action="${escapeHtml(a.action)}">${a.icon} ${escapeHtml(a.label)}</button>`
            ).join('');

        document.body.appendChild(menu);
        activeMenu = menu;

        // Position near element
        const rect = element.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.left;

        // Keep within viewport
        if (top + menuRect.height > window.innerHeight) {
            top = rect.top - menuRect.height - 4;
        }
        if (left + menuRect.width > window.innerWidth) {
            left = window.innerWidth - menuRect.width - 8;
        }

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;

        // Click handler for actions
        menu.addEventListener('click', function (e) {
            const btn = e.target.closest('.em-action');
            if (btn && btn.dataset.action) {
                const inputField = document.getElementById('chat-box');
                if (inputField) {
                    inputField.value = btn.dataset.action;
                }
                const submitBtn = document.getElementById('submit-btn');
                if (submitBtn) {
                    submitBtn.click();
                }
                hideEntityMenu();
            }
        });

        // Dismiss on click outside or Escape
        setTimeout(() => {
            document.addEventListener('click', outsideClickHandler);
            document.addEventListener('keydown', escapeHandler);
        }, 0);
    }

    function hideEntityMenu() {
        if (activeMenu) {
            activeMenu.remove();
            activeMenu = null;
        }
        document.removeEventListener('click', outsideClickHandler);
        document.removeEventListener('keydown', escapeHandler);
    }

    function outsideClickHandler(e) {
        if (activeMenu && !activeMenu.contains(e.target) && !e.target.closest('.nf-entity-link') && !e.target.closest('.ec-card')) {
            hideEntityMenu();
        }
    }

    function escapeHandler(e) {
        if (e.key === 'Escape') {
            hideEntityMenu();
        }
    }

    function getEntityActions(name, type) {
        switch (type) {
            case 'npc':
                return [
                    { icon: '\uD83D\uDCAC', label: `Talk to ${name}`, action: `I speak to ${name}` },
                    { icon: '\uD83D\uDC41\uFE0F', label: `Observe ${name}`, action: `I observe ${name} carefully` },
                    { icon: '\u2753', label: `Ask about ${name}`, action: `I ask about ${name}` }
                ];
            case 'object':
                return [
                    { icon: '\uD83D\uDD0D', label: `Examine ${name}`, action: `I examine the ${name}` },
                    { icon: '\u270B', label: `Interact with ${name}`, action: `I interact with the ${name}` }
                ];
            case 'location':
                return [
                    { icon: '\uD83D\uDEB6', label: `Go to ${name}`, action: `I head to ${name}` },
                    { icon: '\uD83D\uDC40', label: `Look toward ${name}`, action: `I look toward ${name}` }
                ];
            default:
                return [];
        }
    }

    // ========== HELPERS ==========

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ========== PUBLIC API ==========

    return {
        formatCompletedMessage,
        renderDiscoveryCards,
        showEntityMenu,
        hideEntityMenu
    };

})();
