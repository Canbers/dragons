/**
 * MapViewer.js - Interactive Semantic Map Component (v2)
 * 
 * Three zoom levels:
 * - Region: High-level overview of world regions (terrain map)
 * - Local: Connected locations within current settlement
 * - Scene: Points of interest at current location
 * 
 * Data is seeded from settlement data and expanded through AI discoveries.
 */

class MapViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentZoom = 'local'; // 'region' | 'local' | 'scene'
    this.currentPlotId = null;
    this.currentCharacterId = null;
    this.mapData = null;
    
    this.render();
  }

  async initialize(plotId, characterId) {
    this.currentPlotId = plotId;
    this.currentCharacterId = characterId;
    await this.fetchMapData();
    this.render();
  }

  async fetchMapData() {
    if (!this.currentPlotId) return;
    
    try {
      const response = await fetch(`/api/plots/${this.currentPlotId}/map`);
      if (!response.ok) throw new Error('Failed to fetch map data');
      this.mapData = await response.json();
    } catch (error) {
      console.error('Error fetching map data:', error);
      this.mapData = this.getDefaultMapData();
    }
  }

  getDefaultMapData() {
    return {
      region: { name: 'Unknown Region', map: null, settlements: [] },
      local: { 
        settlementName: 'Unknown Settlement',
        current: 'Unknown Location', 
        currentDescription: '',
        connections: [], 
        discoveredLocations: [] 
      },
      scene: { location: 'Unknown', description: '', pois: [] }
    };
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="map-header">
        <div class="zoom-tabs">
          <button class="zoom-tab ${this.currentZoom === 'region' ? 'active' : ''}" data-zoom="region">
            🗺️ Region
          </button>
          <button class="zoom-tab ${this.currentZoom === 'local' ? 'active' : ''}" data-zoom="local">
            🧭 Local
          </button>
          <button class="zoom-tab ${this.currentZoom === 'scene' ? 'active' : ''}" data-zoom="scene">
            🔍 Scene
          </button>
        </div>
      </div>
      <div class="map-content">
        ${this.renderMapForZoom()}
      </div>
      <div class="action-panel" id="action-panel" style="display: none;">
        <div class="action-panel-header">
          <h3 id="action-panel-title">Actions</h3>
          <button class="close-panel" id="close-action-panel">✕</button>
        </div>
        <div class="action-panel-body" id="action-panel-body">
          <!-- Quick actions will be inserted here -->
        </div>
        <div class="custom-action">
          <input type="text" id="custom-action-input" placeholder="Or type your own action...">
          <button id="custom-action-submit">→</button>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderMapForZoom() {
    if (!this.mapData) {
      return '<div class="map-placeholder">Loading map...</div>';
    }

    switch (this.currentZoom) {
      case 'region':
        return this.renderRegionView();
      case 'local':
        return this.renderLocalView();
      case 'scene':
        return this.renderSceneView();
      default:
        return '<div class="map-placeholder">Invalid zoom level</div>';
    }
  }

  renderRegionView() {
    const region = this.mapData.region || {};
    
    return `
      <div class="region-view">
        <h3>🗺️ ${region.name || 'World Overview'}</h3>
        ${region.description ? `<p class="region-description">${region.description}</p>` : ''}
        <div class="region-map-placeholder">
          <p class="map-note">Region map view coming soon</p>
          <p class="hint">Shows terrain and settlement locations</p>
        </div>
        <div class="current-location-card">
          <h4>Current Settlement</h4>
          <p><strong>${this.mapData.local?.settlementName || 'Unknown'}</strong></p>
          <p class="location-detail">${this.mapData.local?.current || 'Unknown location'}</p>
        </div>
      </div>
    `;
  }

  renderLocalView() {
    const local = this.mapData.local || {};
    const connections = local.connections || [];
    const discovered = local.discoveredLocations || [];
    
    if (connections.length === 0 && discovered.length <= 1) {
      return `
        <div class="local-view">
          <div class="current-location-header">
            <h3>📍 ${local.current || 'Unknown Location'}</h3>
            <p class="settlement-name">in ${local.settlementName || 'Unknown Settlement'}</p>
          </div>
          <div class="map-placeholder">
            <p>No nearby locations discovered yet.</p>
            <p class="hint">Explore the settlement to reveal connections!</p>
          </div>
        </div>
      `;
    }

    // Render the radial connection graph
    const svg = this.createConnectionGraph(local);
    
    return `
      <div class="local-view">
        <div class="current-location-header">
          <h3>📍 ${local.current || 'Unknown Location'}</h3>
          <p class="settlement-name">in ${local.settlementName || 'Unknown Settlement'}</p>
        </div>
        ${local.currentDescription ? `<p class="location-description">${local.currentDescription}</p>` : ''}
        ${svg}
        <div class="discovered-count">
          <span>${discovered.length} location${discovered.length !== 1 ? 's' : ''} discovered</span>
        </div>
      </div>
    `;
  }

  createConnectionGraph(local) {
    const connections = local.connections || [];
    if (connections.length === 0) {
      return '';
    }

    const width = 500;
    const height = 400;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 140;

    // Calculate positions for connected locations
    const angleStep = (2 * Math.PI) / Math.max(connections.length, 1);
    const nodes = connections.map((conn, index) => {
      const angle = angleStep * index - Math.PI / 2; // Start at top
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        connection: conn
      };
    });

    // Build SVG
    let svgContent = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" class="map-graph">`;

    // Draw connections (lines)
    nodes.forEach(node => {
      svgContent += `
        <line 
          x1="${centerX}" 
          y1="${centerY}" 
          x2="${node.x}" 
          y2="${node.y}" 
          stroke="var(--border-color, #444)" 
          stroke-width="2"
          opacity="0.6"
        />
      `;
    });

    // Draw current location (center node)
    svgContent += `
      <circle 
        cx="${centerX}" 
        cy="${centerY}" 
        r="35" 
        fill="var(--accent-color, #4CAF50)" 
        stroke="var(--text-primary, #fff)" 
        stroke-width="3"
        class="location-node current"
      />
      <text 
        x="${centerX}" 
        y="${centerY - 45}" 
        text-anchor="middle" 
        fill="var(--text-primary, #fff)" 
        font-weight="bold"
        font-size="12"
      >
        📍 You Are Here
      </text>
    `;

    // Draw connected location nodes
    nodes.forEach((node, index) => {
      const conn = node.connection;
      const directionEmoji = this.getDirectionEmoji(conn.direction);
      
      svgContent += `
        <circle 
          cx="${node.x}" 
          cy="${node.y}" 
          r="28" 
          fill="var(--bg-secondary, #2a2a4a)" 
          stroke="var(--accent-secondary, #6366f1)" 
          stroke-width="2"
          class="location-node clickable"
          data-location="${conn.name}"
          data-index="${index}"
          style="cursor: pointer;"
        />
        <text 
          x="${node.x}" 
          y="${node.y - 38}" 
          text-anchor="middle" 
          fill="var(--text-muted, #999)" 
          font-size="11"
          pointer-events="none"
        >
          ${directionEmoji} ${conn.direction || ''}
        </text>
        <text 
          x="${node.x}" 
          y="${node.y + 45}" 
          text-anchor="middle" 
          fill="var(--text-primary, #fff)" 
          font-size="11"
          font-weight="500"
          pointer-events="none"
        >
          ${this.truncateName(conn.name, 15)}
        </text>
        ${conn.distance && conn.distance !== 'adjacent' ? `
          <text 
            x="${node.x}" 
            y="${node.y + 58}" 
            text-anchor="middle" 
            fill="var(--text-muted, #666)" 
            font-size="9"
            pointer-events="none"
          >
            (${conn.distance})
          </text>
        ` : ''}
      `;
    });

    svgContent += '</svg>';
    return svgContent;
  }

  getDirectionEmoji(direction) {
    const emojis = {
      'north': '⬆️', 'south': '⬇️', 'east': '➡️', 'west': '⬅️',
      'northeast': '↗️', 'northwest': '↖️', 'southeast': '↘️', 'southwest': '↙️',
      'up': '🔼', 'down': '🔽', 'inside': '🚪', 'outside': '🚪'
    };
    return emojis[direction] || '•';
  }

  truncateName(name, maxLength) {
    if (!name) return 'Unknown';
    return name.length > maxLength ? name.substring(0, maxLength - 2) + '...' : name;
  }

  renderSceneView() {
    const scene = this.mapData.scene || {};
    const pois = scene.pois || [];
    
    if (pois.length === 0) {
      return `
        <div class="scene-view">
          <div class="scene-header">
            <h3>🔍 ${scene.location || 'Current Location'}</h3>
          </div>
          ${scene.description ? `<p class="scene-description">${scene.description}</p>` : ''}
          <div class="map-placeholder">
            <p>No points of interest discovered here yet.</p>
            <p class="hint">Interact with the world to discover NPCs, objects, and landmarks!</p>
          </div>
        </div>
      `;
    }

    const poiList = pois.map((poi, index) => {
      const icon = poi.icon || this.getPoiIcon(poi.type);
      return `
        <div class="poi-card" data-poi-id="${poi.id}" data-poi-index="${index}">
          <div class="poi-header">
            <span class="poi-icon">${icon}</span>
            <div class="poi-info">
              <h4>${poi.name}</h4>
              <span class="poi-type">${poi.type}</span>
            </div>
          </div>
          <p class="poi-description">${poi.description || 'No description available.'}</p>
          ${poi.interactionCount > 0 ? `<p class="poi-meta">Interactions: ${poi.interactionCount}</p>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="scene-view">
        <div class="scene-header">
          <h3>🔍 ${scene.location || 'Current Location'}</h3>
        </div>
        ${scene.description ? `<p class="scene-description">${scene.description}</p>` : ''}
        <div class="poi-list">
          ${poiList}
        </div>
      </div>
    `;
  }

  getPoiIcon(type) {
    const icons = {
      'npc': '👤',
      'object': '📦',
      'entrance': '🚪',
      'landmark': '🏛️',
      'danger': '⚠️',
      'quest': '❗',
      'shop': '🛒',
      'other': '📍'
    };
    return icons[type] || icons.other;
  }

  attachEventListeners() {
    // Zoom tab clicks
    const tabs = this.container.querySelectorAll('.zoom-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.currentZoom = tab.dataset.zoom;
        this.render();
      });
    });

    // Location node clicks (SVG) - use event delegation
    const mapContent = this.container.querySelector('.map-content');
    if (mapContent) {
      mapContent.addEventListener('click', (e) => {
        const node = e.target.closest('.location-node.clickable');
        if (node) {
          const locationName = node.dataset.location;
          const index = parseInt(node.dataset.index);
          this.showLocationActions(locationName, index);
        }
      });
    }

    // POI card clicks
    const poiCards = this.container.querySelectorAll('.poi-card');
    poiCards.forEach(card => {
      card.addEventListener('click', () => {
        const poiIndex = parseInt(card.dataset.poiIndex);
        this.showPoiActions(poiIndex);
      });
    });

    // Action panel close
    const closeBtn = this.container.querySelector('#close-action-panel');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hideActionPanel();
      });
    }

    // Custom action submit
    const submitBtn = this.container.querySelector('#custom-action-submit');
    const input = this.container.querySelector('#custom-action-input');
    if (submitBtn && input) {
      submitBtn.addEventListener('click', () => {
        const action = input.value.trim();
        if (action) {
          this.executeAction(action);
          input.value = '';
        }
      });
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          submitBtn.click();
        }
      });
    }
  }

  showLocationActions(locationName, connectionIndex) {
    const connection = this.mapData.local?.connections?.[connectionIndex];
    const panel = this.container.querySelector('#action-panel');
    const title = this.container.querySelector('#action-panel-title');
    const body = this.container.querySelector('#action-panel-body');

    if (!panel || !title || !body) return;

    title.textContent = locationName;

    const direction = connection?.direction;
    const actions = [
      { label: `🚶 Go ${direction || 'there'}`, action: `I go to ${locationName}` },
      { label: '👀 Look toward', action: `I look toward ${locationName}` },
      { label: '❓ Ask about', action: `What do I know about ${locationName}?` }
    ];

    body.innerHTML = actions.map(a => `
      <button class="quick-action-btn" data-action="${a.action}">
        ${a.label}
      </button>
    `).join('');

    // Attach click handlers to new buttons
    body.querySelectorAll('.quick-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.executeAction(btn.dataset.action);
      });
    });

    panel.style.display = 'block';
  }

  showPoiActions(poiIndex) {
    const poi = this.mapData.scene?.pois?.[poiIndex];
    if (!poi) return;

    const panel = this.container.querySelector('#action-panel');
    const title = this.container.querySelector('#action-panel-title');
    const body = this.container.querySelector('#action-panel-body');

    if (!panel || !title || !body) return;

    title.textContent = poi.name;

    // Generate contextual actions based on POI type
    let actions = [];
    switch (poi.type) {
      case 'npc':
        actions = [
          { label: '💬 Talk to', action: `I approach and speak to ${poi.name}` },
          { label: '👀 Observe', action: `I observe ${poi.name} from a distance` },
          { label: '❓ Ask about', action: `What can I tell about ${poi.name}?` }
        ];
        break;
      case 'object':
      case 'landmark':
        actions = [
          { label: '🔍 Examine', action: `I examine ${poi.name} closely` },
          { label: '🖐️ Touch/Use', action: `I interact with ${poi.name}` },
          { label: '❓ Study', action: `What do I notice about ${poi.name}?` }
        ];
        break;
      case 'entrance':
        actions = [
          { label: '🚪 Enter', action: `I go through ${poi.name}` },
          { label: '👀 Peek', action: `I peek through ${poi.name}` },
          { label: '👂 Listen', action: `I listen at ${poi.name}` }
        ];
        break;
      case 'danger':
        actions = [
          { label: '⚠️ Assess', action: `I carefully assess ${poi.name}` },
          { label: '🏃 Avoid', action: `I try to avoid ${poi.name}` },
          { label: '💪 Confront', action: `I confront ${poi.name}` }
        ];
        break;
      default:
        actions = [
          { label: '🔍 Examine', action: `I examine ${poi.name}` },
          { label: '💬 Interact', action: `I interact with ${poi.name}` }
        ];
    }

    body.innerHTML = actions.map(a => `
      <button class="quick-action-btn" data-action="${a.action}">
        ${a.label}
      </button>
    `).join('');

    // Attach click handlers
    body.querySelectorAll('.quick-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.executeAction(btn.dataset.action);
      });
    });

    panel.style.display = 'block';
  }

  hideActionPanel() {
    const panel = this.container.querySelector('#action-panel');
    if (panel) {
      panel.style.display = 'none';
    }
  }

  async executeAction(actionText) {
    this.hideActionPanel();
    
    // Trigger the main game action submission
    if (window.submitAction) {
      window.submitAction(actionText);
    } else {
      console.error('submitAction not found in global scope');
    }
  }

  async refresh() {
    await this.fetchMapData();
    this.render();
  }
}

// Export for use in app.js
window.MapViewer = MapViewer;
