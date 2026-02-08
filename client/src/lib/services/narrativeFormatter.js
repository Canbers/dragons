/**
 * narrativeFormatter.js — Pure function port of public/narrative-formatter.js
 * Post-processes AI narrative: dialogue bubbles, entity links, discovery cards
 */

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format a completed AI narrative message into HTML.
 * @param {string} text - Raw narrative text
 * @param {object} sceneEntities - { npcs[], objects[], features[], locations[] }
 * @returns {string} Formatted HTML string
 */
export function formatCompletedMessage(text, sceneEntities) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Markdown emphasis: **bold** then *italic*
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="nf-bold">$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em class="nf-emphasis">$1</em>');

  // Detect dialogue: NpcName: "words"
  html = html.replace(
    /^(\w[\w\s]*?):\s*[&quot;\u201C](.+?)[&quot;\u201D]\s*$/gm,
    (match, speaker, speech) =>
      `<div class="nf-dialogue"><span class="nf-speaker">${speaker}</span><span class="nf-speech">\u201C${speech}\u201D</span></div>`
  );

  // Inline dialogue
  html = html.replace(
    /(\w[\w\s]*?):\s*[&quot;\u201C](.+?)[&quot;\u201D]/g,
    (match, speaker, speech) => {
      if (match.includes('nf-dialogue')) return match;
      return `<span class="nf-dialogue-inline"><span class="nf-speaker">${speaker}</span>: <span class="nf-speech">\u201C${speech}\u201D</span></span>`;
    }
  );

  // Wrap entity names as clickable links
  if (sceneEntities) {
    const entities = [];
    if (sceneEntities.npcs) sceneEntities.npcs.forEach(n => entities.push({ name: n, type: 'npc' }));
    if (sceneEntities.objects) sceneEntities.objects.forEach(n => entities.push({ name: n, type: 'object' }));
    if (sceneEntities.features) sceneEntities.features.forEach(n => entities.push({ name: n, type: 'location' }));
    if (sceneEntities.locations) sceneEntities.locations.forEach(n => entities.push({ name: n, type: 'location' }));
    entities.sort((a, b) => b.name.length - a.name.length);

    for (const entity of entities) {
      if (!entity.name || entity.name.length < 2) continue;
      const escapedName = escapeHtml(entity.name);
      const regex = new RegExp(
        `(?<!<[^>]*)\\b(${escapeRegex(escapedName)})\\b(?![^<]*>)`,
        'g'
      );
      html = html.replace(regex, (match) =>
        `<span class="nf-entity-link" data-entity-type="${entity.type}" data-entity-name="${escapedName}">${match}</span>`
      );
    }
  }

  // Paragraphs
  const paragraphs = html.split(/\n\n+/);
  if (paragraphs.length > 1) {
    html = paragraphs
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => `<p class="nf-paragraph">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  } else {
    html = html.replace(/\n/g, '<br>');
  }

  return html;
}

/**
 * Render discovery cards HTML
 * @param {Array} discoveries - [{ name, type, description }]
 * @returns {string} HTML
 */
export function renderDiscoveryCards(discoveries) {
  if (!discoveries || discoveries.length === 0) return '';

  const typeIcons = { npc: '\uD83D\uDDE3\uFE0F', object: '\uD83D\uDD2E', location: '\uD83D\uDDFA\uFE0F' };

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

/**
 * Get actions available for an entity type
 * @param {string} name - Entity name
 * @param {string} type - 'npc' | 'object' | 'location'
 * @returns {Array} [{ icon, label, action }]
 */
export function getEntityActions(name, type) {
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

/**
 * Pick an emoji for an action label
 */
export function pickEmoji(label) {
  const lower = label.toLowerCase();
  if (lower.includes('talk') || lower.includes('speak') || lower.includes('ask') || lower.includes('greet') || lower.includes('chat')) return '\uD83D\uDCAC';
  if (lower.includes('fight') || lower.includes('attack') || lower.includes('strike') || lower.includes('combat')) return '\u2694\uFE0F';
  if (lower.includes('search') || lower.includes('examine') || lower.includes('inspect') || lower.includes('investigate')) return '\uD83D\uDD0D';
  if (lower.includes('buy') || lower.includes('shop') || lower.includes('trade') || lower.includes('sell') || lower.includes('purchase')) return '\uD83D\uDED2';
  if (lower.includes('steal') || lower.includes('sneak') || lower.includes('hide') || lower.includes('pickpocket')) return '\uD83E\uDD2B';
  if (lower.includes('eat') || lower.includes('drink') || lower.includes('food') || lower.includes('tavern')) return '\uD83C\uDF7A';
  if (lower.includes('read') || lower.includes('book') || lower.includes('scroll') || lower.includes('note')) return '\uD83D\uDCDC';
  if (lower.includes('open') || lower.includes('door') || lower.includes('enter') || lower.includes('go')) return '\uD83D\uDEAA';
  if (lower.includes('take') || lower.includes('pick up') || lower.includes('grab') || lower.includes('collect')) return '\u270B';
  if (lower.includes('use') || lower.includes('equip') || lower.includes('wield')) return '\uD83D\uDEE0\uFE0F';
  if (lower.includes('climb') || lower.includes('jump') || lower.includes('swim')) return '\uD83E\uDDD7';
  if (lower.includes('pray') || lower.includes('meditate') || lower.includes('temple') || lower.includes('shrine')) return '\uD83D\uDE4F';
  if (lower.includes('explore') || lower.includes('wander') || lower.includes('venture')) return '\uD83E\uDDED';
  if (lower.includes('listen') || lower.includes('eavesdrop') || lower.includes('hear')) return '\uD83D\uDC42';
  return '\u27A1\uFE0F';
}
