/**
 * Interactive Semantic Map Viewer
 * Displays locations, connections, and POIs with clickable interactions
 */

class MapViewer {
    constructor(containerId, plotId) {
        this.container = document.getElementById(containerId);
        this.plotId = plotId;
        this.currentData = null;
        this.selectedNode = null;
        this.currentZoom = 'local'; // 'region', 'local', 'scene'
        
        if (!this.container) {
            console.error('MapViewer: container not found:', containerId);
            return;
        }
    }
    
    /**
     * Load map data from API
     */
    async load() {
        try {
            const response = await fetch(`/api/plots/${this.plotId}/map`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.currentData = await response.json();
            this.render();
        } catch (error) {
            console.error('Error loading map data:', error);
            this.container.innerHTML = '<p style="color: #999; padding: 20px;">Map data unavailable</p>';
        }
    }
    
    /**
     * Main render function
     */
    render() {
        if (!this.currentData) {
            return;
        }
        
        this.container.innerHTML = '';
        
        // Render zoom tabs
        this.renderZoomTabs();
        
        // Render current zoom level
        switch(this.currentZoom) {
            case 'region':
                this.renderRegionView();
                break;
            case 'local':
                this.renderLocalView();
                break;
            case 'scene':
                this.renderSceneView();
                break;
        }
    }
    
    /**
     * Render zoom level tabs
     */
    renderZoomTabs() {
        const tabsDiv = document.createElement('div');
        tabsDiv.id = 'map-zoom-tabs';
        tabsDiv.innerHTML = `
            <button class="zoom-tab ${this.currentZoom === 'local' ? 'active' : ''}" data-zoom="local">Local</button>
            <button class="zoom-tab ${this.currentZoom === 'region' ? 'active' : ''}" data-zoom="region">Region</button>
            <button class="zoom-tab ${this.currentZoom === 'scene' ? 'active' : ''}" data-zoom="scene">Scene</button>
        `;
        
        tabsDiv.querySelectorAll('.zoom-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.currentZoom = tab.dataset.zoom;
                this.render();
            });
        });
        
        this.container.appendChild(tabsDiv);
    }
    
    /**
     * Region view - high level overview
     */
    renderRegionView() {
        const viewDiv = document.createElement('div');
        viewDiv.className = 'map-view region-view';
        viewDiv.innerHTML = `
            <div class="region-info">
                <h3>${this.currentData.region || 'Unknown Region'}</h3>
                ${this.currentData.settlement ? `<p>Settlement: ${this.currentData.settlement}</p>` : ''}
                <p class="current-marker">📍 You are at: <strong>${this.currentData.current.name}</strong></p>
            </div>
        `;
        this.container.appendChild(viewDiv);
    }
    
    /**
     * Local view - connected locations (main interactive map)
     */
    renderLocalView() {
        const viewDiv = document.createElement('div');
        viewDiv.className = 'map-view local-view';
        
        // Create SVG container
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '350');
        svg.setAttribute('viewBox', '-200 -175 400 350');
        
        // Calculate node positions
        const nodes = this.calculateNodePositions();
        
        // Render connection lines first (so they're behind nodes)
        nodes.forEach(node => {
            if (node.isCenter) return; // Center node has no parent line
            
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', 0);
            line.setAttribute('y1', 0);
            line.setAttribute('x2', node.x);
            line.setAttribute('y2', node.y);
            line.setAttribute('stroke', node.discovered ? '#666' : '#444');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-dasharray', node.discovered ? '0' : '5,5');
            svg.appendChild(line);
        });
        
        // Render nodes
        nodes.forEach(node => {
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('transform', `translate(${node.x}, ${node.y})`);
            group.style.cursor = 'pointer';
            
            // Circle
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', node.isCenter ? '20' : '15');
            circle.setAttribute('fill', node.isCenter ? '#FFD700' : '#4a4a4a');
            circle.setAttribute('stroke', node.isCenter ? '#FFF' : '#666');
            circle.setAttribute('stroke-width', node.isCenter ? '3' : '2');
            circle.setAttribute('opacity', node.discovered ? '1' : '0.4');
            
            // Hover effect
            group.addEventListener('mouseenter', () => {
                circle.setAttribute('fill', node.isCenter ? '#FFE44D' : '#5a5a5a');
            });
            group.addEventListener('mouseleave', () => {
                circle.setAttribute('fill', node.isCenter ? '#FFD700' : '#4a4a4a');
            });
            
            // Click handler
            group.addEventListener('click', () => {
                this.selectNode(node);
            });
            
            group.appendChild(circle);
            
            // Label
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('y', '35');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', '#ddd');
            text.setAttribute('font-size', '12');
            text.textContent = node.name.length > 15 ? node.name.substring(0, 12) + '...' : node.name;
            group.appendChild(text);
            
            svg.appendChild(group);
        });
        
        viewDiv.appendChild(svg);
        this.container.appendChild(viewDiv);
    }
    
    /**
     * Calculate positions for nodes in a radial layout
     */
    calculateNodePositions() {
        const nodes = [];
        const connections = this.currentData.current.connections || [];
        
        // Center node (current location)
        nodes.push({
            name: this.currentData.current.name,
            x: 0,
            y: 0,
            isCenter: true,
            discovered: true,
            type: 'location',
            data: this.currentData.current
        });
        
        // Connected locations
        const angleStep = (2 * Math.PI) / Math.max(connections.length, 1);
        connections.forEach((conn, index) => {
            const angle = angleStep * index;
            const radius = conn.distance === 'far' ? 120 : conn.distance === 'close' ? 90 : 70;
            
            nodes.push({
                name: conn.name,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius,
                isCenter: false,
                discovered: conn.discovered !== false,
                type: 'location',
                data: conn
            });
        });
        
        return nodes;
    }
    
    /**
     * Scene view - POIs in current location
     */
    renderSceneView() {
        const viewDiv = document.createElement('div');
        viewDiv.className = 'map-view scene-view';
        
        const pois = this.currentData.current.points_of_interest || [];
        
        if (pois.length === 0) {
            viewDiv.innerHTML = '<p style="color: #999; padding: 20px;">No points of interest discovered yet</p>';
        } else {
            viewDiv.innerHTML = '<div class="poi-list"></div>';
            const poiList = viewDiv.querySelector('.poi-list');
            
            pois.forEach(poi => {
                const poiCard = document.createElement('div');
                poiCard.className = 'poi-card';
                poiCard.innerHTML = `
                    <div class="poi-header">
                        <span class="poi-icon">${poi.icon || '📍'}</span>
                        <span class="poi-name">${poi.name}</span>
                        <span class="poi-type">${poi.type}</span>
                    </div>
                    ${poi.description ? `<p class="poi-description">${poi.description}</p>` : ''}
                `;
                
                poiCard.addEventListener('click', () => {
                    this.selectPOI(poi);
                });
                
                poiList.appendChild(poiCard);
            });
        }
        
        this.container.appendChild(viewDiv);
    }
    
    /**
     * Handle node selection (location clicked)
     */
    selectNode(node) {
        this.selectedNode = node;
        this.showActionPanel('location', node);
    }
    
    /**
     * Handle POI selection
     */
    selectPOI(poi) {
        this.showActionPanel('poi', poi);
    }
    
    /**
     * Show action panel with quick actions and custom input
     */
    showActionPanel(type, data) {
        // Remove existing panel if any
        const existingPanel = document.getElementById('map-action-panel');
        if (existingPanel) {
            existingPanel.remove();
        }
        
        const panel = document.createElement('div');
        panel.id = 'map-action-panel';
        panel.className = 'action-panel';
        
        if (type === 'location') {
            panel.innerHTML = this.renderLocationPanel(data);
        } else if (type === 'poi') {
            panel.innerHTML = this.renderPOIPanel(data);
        }
        
        this.container.appendChild(panel);
        
        // Attach event listeners
        this.attachPanelListeners();
    }
    
    /**
     * Render location action panel
     */
    renderLocationPanel(location) {
        const isCurrent = location.isCenter;
        
        return `
            <button class="close-panel" onclick="mapViewer.closePanel()">×</button>
            <h4>📍 ${location.name}</h4>
            ${location.data.description ? `<p class="panel-description">${location.data.description}</p>` : ''}
            
            <div class="quick-actions">
                ${!isCurrent && location.discovered ? `
                    <button class="action-btn" data-action="travel" data-target="${location.name}">
                        🚶 Travel to ${location.name}
                    </button>
                ` : ''}
                ${isCurrent ? '<p><em>📍 You are here</em></p>' : ''}
                
                ${location.discovered ? `
                    <button class="action-btn" data-action="info" data-target="${location.name}">
                        ℹ️ Learn more
                    </button>
                ` : ''}
                
                ${!isCurrent ? `
                    <button class="action-btn" data-action="scout" data-target="${location.name}">
                        🔍 Scout ahead
                    </button>
                ` : ''}
            </div>
            
            <div class="custom-action">
                <label>✨ Custom action:</label>
                <input type="text" 
                       class="custom-input" 
                       placeholder="Type your own action..."
                       data-target="${location.name}"
                       data-type="location">
                <button class="custom-submit" data-target="${location.name}" data-type="location">
                    Do it
                </button>
            </div>
        `;
    }
    
    /**
     * Render POI action panel
     */
    renderPOIPanel(poi) {
        const suggestedActions = poi.suggested_actions || [];
        
        return `
            <button class="close-panel" onclick="mapViewer.closePanel()">×</button>
            <h4>${poi.icon || '📍'} ${poi.name}</h4>
            <span class="poi-type-badge">${poi.type}</span>
            ${poi.description ? `<p class="panel-description">${poi.description}</p>` : ''}
            
            ${poi.interacted ? `<p class="interaction-note">✓ You've interacted with this before</p>` : ''}
            
            <div class="quick-actions">
                ${suggestedActions.map(action => `
                    <button class="action-btn" 
                            data-action="poi-action" 
                            data-prompt="${action.prompt}"
                            data-poi-id="${poi.poi_id}">
                        ${action.icon} ${action.label}
                    </button>
                `).join('')}
            </div>
            
            <div class="custom-action">
                <label>✨ Custom action:</label>
                <input type="text" 
                       class="custom-input" 
                       placeholder="Do something with ${poi.name}..."
                       data-target="${poi.name}"
                       data-poi-id="${poi.poi_id}"
                       data-type="poi">
                <button class="custom-submit" 
                        data-target="${poi.name}" 
                        data-poi-id="${poi.poi_id}"
                        data-type="poi">
                    Do it
                </button>
            </div>
        `;
    }
    
    /**
     * Attach event listeners to action panel buttons
     */
    attachPanelListeners() {
        // Quick action buttons
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                const target = btn.dataset.target;
                const prompt = btn.dataset.prompt;
                const poiId = btn.dataset.poiId;
                
                await this.executeQuickAction(action, target, prompt, poiId);
            });
        });
        
        // Custom action submit
        document.querySelectorAll('.custom-submit').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                const target = btn.dataset.target;
                const poiId = btn.dataset.poiId;
                const input = btn.previousElementSibling;
                
                if (input && input.value.trim()) {
                    this.executeCustomAction(type, target, input.value.trim(), poiId);
                }
            });
        });
        
        // Custom action on Enter key
        document.querySelectorAll('.custom-input').forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const type = input.dataset.type;
                    const target = input.dataset.target;
                    const poiId = input.dataset.poiId;
                    
                    if (input.value.trim()) {
                        this.executeCustomAction(type, target, input.value.trim(), poiId);
                    }
                }
            });
        });
    }
    
    /**
     * Execute quick action
     */
    async executeQuickAction(actionType, target, prompt, poiId) {
        try {
            const response = await fetch(`/api/plots/${this.plotId}/quick-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actionType,
                    target,
                    customPrompt: prompt,
                    poi_id: poiId
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            this.submitToChat(data.prompt);
        } catch (error) {
            console.error('Error executing quick action:', error);
        }
    }
    
    /**
     * Execute custom action
     */
    async executeCustomAction(type, target, userInput, poiId) {
        const actionType = type === 'poi' ? 'poi-custom' : 'location-custom';
        
        try {
            const response = await fetch(`/api/plots/${this.plotId}/quick-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actionType,
                    target,
                    customPrompt: userInput,
                    poi_id: poiId
                })
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            this.submitToChat(data.prompt);
        } catch (error) {
            console.error('Error executing custom action:', error);
        }
    }
    
    /**
     * Submit action to main chat input and trigger submission
     */
    submitToChat(prompt) {
        // Close action panel
        this.closePanel();
        
        // Inject into main chat input
        const chatBox = document.getElementById('chat-box');
        if (chatBox) {
            chatBox.value = prompt;
            
            // Trigger the main submit function
            if (typeof submitAction === 'function') {
                submitAction();
            } else {
                // Fallback: trigger submit button click
                const submitBtn = document.getElementById('submit-btn');
                if (submitBtn) submitBtn.click();
            }
        }
    }
    
    /**
     * Close action panel
     */
    closePanel() {
        const panel = document.getElementById('map-action-panel');
        if (panel) {
            panel.remove();
        }
        this.selectedNode = null;
    }
}

// Global instance (will be initialized in app.js)
let mapViewer = null;
