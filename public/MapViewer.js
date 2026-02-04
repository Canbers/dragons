/**
 * MapViewer.js - Interactive Semantic Map Component
 * 
 * Three zoom levels:
 * - Region: High-level overview of world regions
 * - Local: Connected locations from current position
 * - Scene: Points of interest in current location
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
      const data = await response.json();
      this.mapData = data.map_data || this.getDefaultMapData();
    } catch (error) {
      console.error('Error fetching map data:', error);
      this.mapData = this.getDefaultMapData();
    }
  }

  getDefaultMapData() {
    return {
      current_location: { name: 'Unknown Location', x: 0, y: 0, z: 0 },
      connections: [],
      points_of_interest: []
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
    return `
      <div class="region-view">
        <h3>🗺️ World Overview</h3>
        <p class="map-note">Region view coming soon - shows larger world structure</p>
        <div class="current-location-card">
          <h4>Current Location</h4>
          <p><strong>${this.mapData.current_location.name}</strong></p>
          <p class="coords">Grid: ${this.mapData.current_location.x}, ${this.mapData.current_location.y}, ${this.mapData.current_location.z}</p>
        </div>
      </div>
    `;
  }

  renderLocalView() {
    if (!this.mapData.connections || this.mapData.connections.length === 0) {
      return `
        <div class="local-view">
          <div class="map-placeholder">
            <p>No nearby locations discovered yet.</p>
            <p class="hint">Explore the world to reveal connections!</p>
          </div>
        </div>
      `;
    }

    // Radial layout for connections
    const svg = this.createRadialGraph();
    
    return `
      <div class="local-view">
        ${svg}
      </div>
    `;
  }

  createRadialGraph() {
    const width = 600;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 180;

    // Current location in center
    const currentLoc = this.mapData.current_location;
    const connections = this.mapData.connections || [];

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
    let svgContent = `<svg width="${width}" height="${height}" class="map-graph">`;

    // Draw connections (lines)
    nodes.forEach(node => {
      const opacity = node.connection.discovered ? 1 : 0.3;
      const strokeDash = node.connection.discovered ? 'none' : '5,5';
      svgContent += `
        <line 
          x1="${centerX}" 
          y1="${centerY}" 
          x2="${node.x}" 
          y2="${node.y}" 
          stroke="#666" 
          stroke-width="2" 
          stroke-dasharray="${strokeDash}"
          opacity="${opacity}"
        />
      `;
    });

    // Draw current location (center node)
    svgContent += `
      <circle 
        cx="${centerX}" 
        cy="${centerY}" 
        r="40" 
        fill="#4CAF50" 
        stroke="#fff" 
        stroke-width="3"
        class="location-node current"
      />
      <text 
        x="${centerX}" 
        y="${centerY - 50}" 
        text-anchor="middle" 
        fill="#fff" 
        font-weight="bold"
        font-size="14"
      >
        📍 You Are Here
      </text>
      <text 
        x="${centerX}" 
        y="${centerY + 60}" 
        text-anchor="middle" 
        fill="#ccc" 
        font-size="12"
      >
        ${currentLoc.name}
      </text>
    `;

    // Draw connected location nodes
    nodes.forEach((node, index) => {
      const conn = node.connection;
      const opacity = conn.discovered ? 1 : 0.5;
      const fill = conn.discovered ? '#2196F3' : '#666';
      
      svgContent += `
        <circle 
          cx="${node.x}" 
          cy="${node.y}" 
          r="30" 
          fill="${fill}" 
          stroke="#fff" 
          stroke-width="2"
          opacity="${opacity}"
          class="location-node"
          data-location="${conn.name}"
          data-index="${index}"
          style="cursor: pointer;"
        />
        <text 
          x="${node.x}" 
          y="${node.y + 45}" 
          text-anchor="middle" 
          fill="#ddd" 
          font-size="12"
          pointer-events="none"
        >
          ${conn.direction || ''}
        </text>
        <text 
          x="${node.x}" 
          y="${node.y + 60}" 
          text-anchor="middle" 
          fill="#fff" 
          font-size="11"
          pointer-events="none"
        >
          ${conn.name}
        </text>
        ${conn.distance ? `
          <text 
            x="${node.x}" 
            y="${node.y + 75}" 
            text-anchor="middle" 
            fill="#999" 
            font-size="10"
            pointer-events="none"
          >
            ${conn.distance}
          </text>
        ` : ''}
      `;
    });

    svgContent += '</svg>';
    return svgContent;
  }

  renderSceneView() {
    const pois = this.mapData.points_of_interest || [];
    
    if (pois.length === 0) {
      return `
        <div class="scene-view">
          <div class="map-placeholder">
            <p>No points of interest here.</p>
            <p class="hint">Interact with the world to discover NPCs, objects, and landmarks!</p>
          </div>
        </div>
      `;
    }

    const poiList = pois.map((poi, index) => {
      const icon = this.getPoiIcon(poi.type);
      return `
        <div class="poi-card" data-poi-id="${poi.id}" data-poi-index="${index}">
          <div class="poi-header">
            <span class="poi-icon">${icon}</span>
            <h4>${poi.name}</h4>
          </div>
          <p class="poi-description">${poi.description || 'No description available.'}</p>
          ${poi.interaction_count ? `<p class="poi-meta">Interactions: ${poi.interaction_count}</p>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="scene-view">
        <h3>🔍 Points of Interest</h3>
        <div class="poi-list">
          ${poiList}
        </div>
      </div>
    `;
  }

  getPoiIcon(type) {
    const icons = {
      npc: '👤',
      object: '📦',
      landmark: '🏛️',
      creature: '🐉',
      item: '⚔️',
      door: '🚪',
      default: '📍'
    };
    return icons[type] || icons.default;
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

    // Location node clicks (SVG)
    const nodes = this.container.querySelectorAll('.location-node:not(.current)');
    nodes.forEach(node => {
      node.addEventListener('click', (e) => {
        const locationName = e.target.dataset.location;
        const index = parseInt(e.target.dataset.index);
        this.showLocationActions(locationName, index);
      });
    });

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
    const connection = this.mapData.connections[connectionIndex];
    const panel = this.container.querySelector('#action-panel');
    const title = this.container.querySelector('#action-panel-title');
    const body = this.container.querySelector('#action-panel-body');

    title.textContent = locationName;

    const actions = [
      { label: '🚶 Travel here', action: `Travel to ${locationName}` },
      { label: '🔭 Scout ahead', action: `Scout ${locationName} from a distance` },
      { label: '❓ Learn more', action: `What do I know about ${locationName}?` }
    ];

    if (!connection.discovered) {
      actions.unshift({ label: '👁️ Investigate', action: `Investigate the path toward ${locationName}` });
    }

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
    const poi = this.mapData.points_of_interest[poiIndex];
    const panel = this.container.querySelector('#action-panel');
    const title = this.container.querySelector('#action-panel-title');
    const body = this.container.querySelector('#action-panel-body');

    title.textContent = poi.name;

    const actions = poi.suggested_actions || [
      { label: '🔍 Examine', action: `Examine ${poi.name}` },
      { label: '💬 Interact', action: `Interact with ${poi.name}` }
    ];

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
