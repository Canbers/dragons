/**
 * MapViewer.js - Interactive Semantic Map Component (v3)
 * 
 * Three zoom levels:
 * - Region: High-level overview of world regions (terrain map)
 * - Local: Connected locations within current settlement
 * - Scene: Points of interest at current location
 * 
 * Movement is now handled via dedicated movement API for deterministic results.
 */

class MapViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentZoom = 'local'; // 'region' | 'local' | 'scene'
    this.currentPlotId = null;
    this.currentCharacterId = null;
    this.mapData = null;
    this.isMoving = false; // Prevent double-clicks during movement
    
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
      // Use the new location endpoint for richer data
      const response = await fetch(`/api/plots/${this.currentPlotId}/location`);
      if (!response.ok) throw new Error('Failed to fetch location data');
      const locationData = await response.json();
      
      // Transform to expected mapData structure
      this.mapData = this.transformLocationData(locationData);
    } catch (error) {
      console.error('Error fetching map data:', error);
      this.mapData = this.getDefaultMapData();
    }
  }

  /**
   * Transform location API response to mapData structure
   */
  transformLocationData(data) {
    if (data.type === 'wilderness') {
      return {
        region: {
          name: data.region?.name || 'Unknown Region',
          description: data.region?.description || '',
          map: data.region?.map || null
        },
        local: {
          settlementName: 'Wilderness',
          current: 'Open terrain',
          currentDescription: 'You are traveling through the wilderness.',
          currentId: null,
          connections: [],
          discoveredLocations: []
        },
        scene: {
          location: 'Wilderness',
          description: '',
          pois: []
        }
      };
    }
    
    return {
      region: {
        name: data.region?.name || 'Unknown Region',
        description: data.region?.description || '',
        map: data.region?.map || null
      },
      local: {
        settlementName: data.settlement?.name || 'Unknown Settlement',
        current: data.location?.name || 'Unknown Location',
        currentDescription: data.location?.description || '',
        currentId: data.location?.id || null,
        currentType: data.location?.type || 'other',
        connections: (data.connections || []).map(c => ({
          name: c.name,
          direction: c.direction,
          description: c.description,
          distance: c.distance,
          targetId: c.targetId,
          discovered: c.discovered,
          type: c.type || 'other'
        })),
        discoveredLocations: data.discoveredLocations || []
      },
      scene: {
        location: data.location?.name || 'Unknown',
        description: data.location?.description || '',
        pois: data.pois || []
      }
    };
  }

  getDefaultMapData() {
    return {
      region: { name: 'Unknown Region', map: null, settlements: [] },
      local: { 
        settlementName: 'Unknown Settlement',
        current: 'Unknown Location', 
        currentDescription: '',
        currentId: null,
        connections: [], 
        discoveredLocations: [] 
      },
      scene: { location: 'Unknown', description: '', pois: [] }
    };
  }

  render() {
    if (!this.container) return;

    const loadingClass = this.isMoving ? 'loading' : '';

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
      <div class="map-content ${loadingClass}">
        ${this.isMoving ? '<div class="map-loading">🚶 Moving...</div>' : this.renderMapForZoom()}
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
    const discovered = local.discoveredLocations || [];

    const typeIcon = this.getLocationTypeIcon(local.currentType);

    if (discovered.length === 0) {
      return `
        <div class="local-view">
          <div class="current-location-header">
            <h3>${typeIcon} ${local.current || 'Unknown Location'}</h3>
            <p class="settlement-name">in ${local.settlementName || 'Unknown Settlement'}</p>
          </div>
          ${local.currentDescription ? `<p class="location-description">${local.currentDescription}</p>` : ''}
          <div class="map-placeholder">
            <p>No nearby locations discovered yet.</p>
            <p class="hint">Explore the settlement to reveal connections!</p>
          </div>
        </div>
      `;
    }

    const svgMap = this.buildSettlementSvg(local, discovered);

    return `
      <div class="local-view">
        <div class="current-location-header">
          <h3>${typeIcon} ${local.current || 'Unknown Location'}</h3>
          <p class="settlement-name">in ${local.settlementName || 'Unknown Settlement'}</p>
        </div>
        ${svgMap}
        <div class="discovered-count">
          <span>${discovered.length} location${discovered.length !== 1 ? 's' : ''} discovered</span>
        </div>
      </div>
    `;
  }

  getLocationTypeIcon(type) {
    const icons = {
      'gate': '🚪',
      'market': '🏪',
      'tavern': '🍺',
      'temple': '⛪',
      'plaza': '🏛️',
      'shop': '🛒',
      'residence': '🏠',
      'landmark': '🗿',
      'dungeon': '🕳️',
      'district': '🏘️',
      'docks': '⚓',
      'barracks': '⚔️',
      'palace': '🏰',
      'other': '📍'
    };
    return icons[type] || icons.other;
  }

  /**
   * Direction vectors for estimating fog node positions
   */
  static DIRECTION_VECTORS = {
    north: { x: 0, y: -1 }, south: { x: 0, y: 1 },
    east: { x: 1, y: 0 }, west: { x: -1, y: 0 },
    northeast: { x: 0.7, y: -0.7 }, northwest: { x: -0.7, y: -0.7 },
    southeast: { x: 0.7, y: 0.7 }, southwest: { x: -0.7, y: 0.7 },
    up: { x: 0.3, y: -0.5 }, down: { x: -0.3, y: 0.5 },
    inside: { x: 0.3, y: 0 }, outside: { x: -0.3, y: 0 }
  };

  static DISTANCE_SCALE = { adjacent: 1, close: 1.5, far: 2 };

  static TYPE_COLORS = {
    gate: '#8B4513', market: '#DAA520', tavern: '#CD853F', temple: '#9370DB',
    plaza: '#4682B4', shop: '#B8860B', residence: '#708090', landmark: '#CD5C5C',
    dungeon: '#483D8B', district: '#6B8E23', docks: '#4169E1', barracks: '#A0522D',
    palace: '#9932CC', other: '#808080'
  };

  /**
   * Build an SVG settlement map from discovered locations
   */
  buildSettlementSvg(local, discoveredLocations) {
    const SVG_W = 348;
    const SVG_H = 340;
    const PAD = 40;

    // 1. Collect all nodes: discovered + fog (undiscovered targets from connections)
    const discoveredMap = new Map(); // nameKey → location data
    for (const loc of discoveredLocations) {
      discoveredMap.set(loc.name.toLowerCase(), loc);
    }

    const fogNodes = new Map(); // nameKey → { x, y, name, type }
    for (const loc of discoveredLocations) {
      for (const conn of (loc.connections || [])) {
        if (!conn.locationName) continue;
        const targetKey = conn.locationName.toLowerCase();
        if (discoveredMap.has(targetKey) || fogNodes.has(targetKey)) continue;

        // Fog node: estimate position
        let fogX, fogY;
        if (conn.targetCoordinates) {
          fogX = conn.targetCoordinates.x;
          fogY = conn.targetCoordinates.y;
        } else {
          const srcCoords = loc.coordinates || { x: 0, y: 0 };
          const dir = MapViewer.DIRECTION_VECTORS[conn.direction] || { x: 0.5, y: 0.5 };
          const scale = MapViewer.DISTANCE_SCALE[conn.distance] || 1;
          fogX = srcCoords.x + dir.x * scale;
          fogY = srcCoords.y + dir.y * scale;
        }
        fogNodes.set(targetKey, {
          x: fogX, y: fogY,
          name: conn.locationName,
          type: conn.targetType || 'other',
          targetId: conn.targetId
        });
      }
    }

    // 2. Collect all positions for bounding box
    const allPoints = [];
    for (const loc of discoveredLocations) {
      const coords = loc.coordinates || { x: 0, y: 0 };
      allPoints.push({ x: coords.x, y: coords.y });
    }
    for (const fog of fogNodes.values()) {
      allPoints.push({ x: fog.x, y: fog.y });
    }

    if (allPoints.length === 0) return '';

    // 3. Compute bounding box → viewport transform
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of allPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const drawW = SVG_W - PAD * 2;
    const drawH = SVG_H - PAD * 2;
    const scale = Math.min(drawW / rangeX, drawH / rangeY);
    const offsetX = PAD + (drawW - rangeX * scale) / 2;
    const offsetY = PAD + (drawH - rangeY * scale) / 2;

    const tx = (x) => offsetX + (x - minX) * scale;
    const ty = (y) => offsetY + (y - minY) * scale;

    // 4. Build SVG layers
    let roadsHtml = '';
    let fogRoadsHtml = '';
    let fogNodesHtml = '';
    let markersHtml = '';

    // Roads between discovered locations
    const drawnRoads = new Set();
    for (const loc of discoveredLocations) {
      const srcCoords = loc.coordinates || { x: 0, y: 0 };
      for (const conn of (loc.connections || [])) {
        if (!conn.locationName) continue;
        const targetKey = conn.locationName.toLowerCase();
        const roadKey = [loc.name.toLowerCase(), targetKey].sort().join('|');
        if (drawnRoads.has(roadKey)) continue;
        drawnRoads.add(roadKey);

        if (discoveredMap.has(targetKey)) {
          // Solid road between two discovered locations
          const targetLoc = discoveredMap.get(targetKey);
          const tgtCoords = targetLoc.coordinates || { x: 0, y: 0 };
          roadsHtml += `<line class="road" x1="${tx(srcCoords.x)}" y1="${ty(srcCoords.y)}" x2="${tx(tgtCoords.x)}" y2="${ty(tgtCoords.y)}"/>`;
        } else if (fogNodes.has(targetKey)) {
          // Fog road to undiscovered target
          const fog = fogNodes.get(targetKey);
          fogRoadsHtml += `<line class="road fog-road" x1="${tx(srcCoords.x)}" y1="${ty(srcCoords.y)}" x2="${tx(fog.x)}" y2="${ty(fog.y)}"/>`;
        }
      }
    }

    // Fog node circles
    for (const [key, fog] of fogNodes) {
      const fx = tx(fog.x);
      const fy = ty(fog.y);
      fogNodesHtml += `
        <g class="fog-node">
          <circle cx="${fx}" cy="${fy}" r="12" class="fog-circle"/>
          <text x="${fx}" y="${fy + 4}" class="fog-label">?</text>
        </g>`;
    }

    // Location markers (discovered)
    for (const loc of discoveredLocations) {
      const coords = loc.coordinates || { x: 0, y: 0 };
      const cx = tx(coords.x);
      const cy = ty(coords.y);
      const icon = this.getLocationTypeIcon(loc.type);
      const color = MapViewer.TYPE_COLORS[loc.type] || MapViewer.TYPE_COLORS.other;
      const displayName = this.truncateName(loc.name, 16);
      const isConnected = (local.connections || []).some(c =>
        c.name?.toLowerCase() === loc.name.toLowerCase()
      );
      const isCurrent = loc.isCurrent;

      // Current location glow
      let glowHtml = '';
      if (isCurrent) {
        glowHtml = `<circle cx="${cx}" cy="${cy}" r="22" class="current-glow"/>`;
      }

      const markerClass = isCurrent ? 'marker current' : (isConnected ? 'marker connected' : 'marker');

      markersHtml += `
        <g class="location-marker ${isCurrent ? '' : 'clickable'}"
           data-location="${this.escapeHtml(loc.name)}"
           data-location-id="${loc.id || ''}"
           data-is-current="${isCurrent ? 'true' : 'false'}"
           data-is-connected="${isConnected ? 'true' : 'false'}">
          ${glowHtml}
          <circle cx="${cx}" cy="${cy}" r="16" class="${markerClass}" fill="${color}"/>
          <text x="${cx}" y="${cy + 5}" class="marker-icon">${icon}</text>
          <text x="${cx}" y="${cy + 30}" class="marker-label">${this.escapeHtml(displayName)}</text>
        </g>`;
    }

    return `
      <div class="settlement-map-container">
        <svg viewBox="0 0 ${SVG_W} ${SVG_H}" class="settlement-map" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" rx="8" class="map-bg"/>
          ${roadsHtml}
          ${fogRoadsHtml}
          ${fogNodesHtml}
          ${markersHtml}
        </svg>
      </div>`;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

    // SVG location marker clicks - use event delegation
    const mapContent = this.container.querySelector('.map-content');
    if (mapContent) {
      mapContent.addEventListener('click', (e) => {
        const marker = e.target.closest('.location-marker');
        if (marker && !this.isMoving) {
          const locationName = marker.dataset.location;
          const locationId = marker.dataset.locationId;
          const isCurrent = marker.dataset.isCurrent === 'true';
          if (!isCurrent) {
            this.showMapLocationActions(locationName, locationId);
          }
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
          this.executeCustomAction(action);
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

  /**
   * Show actions for a location clicked on the SVG map
   */
  showMapLocationActions(locationName, locationId) {
    const panel = this.container.querySelector('#action-panel');
    const title = this.container.querySelector('#action-panel-title');
    const body = this.container.querySelector('#action-panel-body');

    if (!panel || !title || !body) return;

    title.textContent = locationName;

    // Check if this location is directly connected to current
    const connection = (this.mapData.local?.connections || []).find(c =>
      c.name?.toLowerCase() === locationName.toLowerCase()
    );

    let actionsHtml = '';
    if (connection) {
      actionsHtml = `
        <button class="quick-action-btn primary" data-action="move" data-target-id="${connection.targetId || locationId}" data-target-name="${locationName}">
          Go to ${locationName}
        </button>
        <button class="quick-action-btn" data-action="look" data-target="${locationName}">
          Look toward ${locationName}
        </button>
        <button class="quick-action-btn" data-action="ask" data-target="${locationName}">
          What do I know about ${locationName}?
        </button>
      `;
    } else {
      actionsHtml = `
        <button class="quick-action-btn" data-action="look" data-target="${locationName}">
          Look toward ${locationName}
        </button>
        <button class="quick-action-btn" data-action="ask" data-target="${locationName}">
          What do I know about ${locationName}?
        </button>
      `;
    }

    body.innerHTML = actionsHtml;

    body.querySelectorAll('.quick-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'move') {
          await this.moveToLocation(btn.dataset.targetId, btn.dataset.targetName);
        } else if (action === 'look') {
          this.executeCustomAction(`I look toward ${btn.dataset.target}`);
        } else if (action === 'ask') {
          this.executeCustomAction(`What do I know about ${btn.dataset.target}?`);
        }
      });
    });

    panel.style.display = 'block';
  }

  /**
   * Move to a location using the movement API
   * This is deterministic - no AI interpretation needed
   */
  async moveToLocation(targetId, targetName) {
    if (this.isMoving) return;
    
    this.hideActionPanel();
    this.isMoving = true;
    this.render(); // Show loading state
    
    try {
      const response = await fetch(`/api/plots/${this.currentPlotId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetId: targetId || undefined,
          targetName: targetName
        })
      });
      
      const result = await response.json();
      
      if (!result.success) {
        this.showToast(`❌ ${result.error}`, 'error');
        return;
      }
      
      // Show narration in game log
      if (result.narration && window.appendToGameLog) {
        window.appendToGameLog('System', result.narration);
      } else if (result.narration) {
        // Fallback: add to game log element directly
        this.addNarrationToLog(result.narration);
      }
      
      // Show discovery toast
      if (result.discovered) {
        this.showToast(`🔍 Discovered: ${result.newLocation?.name}`, 'success');
      } else {
        this.showToast(`📍 Arrived at ${result.newLocation?.name}`, 'info');
      }
      
      // Refresh map data
      await this.fetchMapData();
      
      // Also refresh game info to update context bar
      if (window.refreshGameInfo) {
        window.refreshGameInfo();
      }
      
    } catch (error) {
      console.error('Movement error:', error);
      this.showToast(`❌ Failed to move: ${error.message}`, 'error');
    } finally {
      this.isMoving = false;
      this.render();
    }
  }

  /**
   * Add narration directly to game log (fallback)
   */
  addNarrationToLog(narration) {
    const gameLog = document.getElementById('game-log');
    if (!gameLog) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'message system';
    entry.innerHTML = `
      <div class="author">System:</div>
      <div class="systemText">
        ${narration}
        <span class="timestamp">${timestamp}</span>
      </div>
    `;
    gameLog.appendChild(entry);
    gameLog.scrollTop = gameLog.scrollHeight;
  }

  /**
   * Show a toast notification
   */
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
      console.log(`[Toast] ${type}: ${message}`);
      return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
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
        this.executeCustomAction(btn.dataset.action);
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

  /**
   * Execute a custom action through the main game flow
   * (For non-movement actions like looking, talking, etc.)
   */
  async executeCustomAction(actionText) {
    this.hideActionPanel();
    
    // Set input text
    const inputField = document.getElementById('chat-box');
    if (inputField) {
      inputField.value = actionText;
    }
    
    // Trigger submission
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
      submitBtn.click();
    }
  }

  async refresh() {
    await this.fetchMapData();
    this.render();
  }
}

// Export for use in app.js
window.MapViewer = MapViewer;
