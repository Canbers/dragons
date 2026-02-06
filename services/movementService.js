/**
 * movementService.js - Handles player movement between locations
 * 
 * This is the canonical source of truth for "where is the player".
 * Movement is deterministic - if a connection exists, movement succeeds.
 */

const Plot = require('../db/models/Plot');
const Settlement = require('../db/models/Settlement');
const { computeLayout } = require('./layoutService');

/**
 * Get the player's current location with full details
 * @param {string} plotId - The plot ID
 * @returns {Object} Location data including settlement, current location, connections, POIs
 */
async function getCurrentLocation(plotId) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.region')
        .populate('current_state.current_location.settlement');
    
    if (!plot) {
        throw new Error('Plot not found');
    }
    
    const settlement = plot.current_state.current_location.settlement;
    if (!settlement) {
        return {
            type: 'wilderness',
            region: plot.current_state.current_location.region,
            coordinates: plot.current_state.current_location.coordinates,
            location: null,
            connections: [],
            pois: []
        };
    }

    // Lazy migration: compute layout for old settlements that don't have it
    if (!settlement.layoutComputed && settlement.locations?.length > 0) {
        const positions = computeLayout(settlement.locations);
        for (const loc of settlement.locations) {
            const pos = positions.get(loc.name.toLowerCase());
            if (pos) {
                loc.coordinates = { x: pos.x, y: pos.y };
            }
        }
        settlement.layoutComputed = true;
        await settlement.save();
        console.log(`[Layout] Migrated layout for settlement: ${settlement.name}`);
    }

    // Find current location by locationId (preferred) or locationName (fallback)
    let currentLocation = null;
    const locationId = plot.current_state.current_location.locationId;
    const locationName = plot.current_state.current_location.locationName;
    
    if (locationId) {
        currentLocation = settlement.locations?.find(l => 
            l._id.toString() === locationId.toString()
        );
    }
    
    if (!currentLocation && locationName) {
        currentLocation = settlement.locations?.find(l => 
            l.name.toLowerCase() === locationName.toLowerCase()
        );
    }
    
    if (!currentLocation && settlement.locations?.length > 0) {
        // Fallback to starting location or first location
        currentLocation = settlement.locations.find(l => l.isStartingLocation) 
                       || settlement.locations[0];
    }
    
    // Get valid moves (discovered connections)
    const connections = currentLocation?.connections || [];
    const validMoves = connections.map(conn => {
        const targetLoc = settlement.locations?.find(l => 
            l.name.toLowerCase() === conn.locationName?.toLowerCase()
        );
        return {
            name: conn.locationName,
            direction: conn.direction,
            description: conn.description,
            distance: conn.distance,
            targetId: targetLoc?._id || null,
            discovered: targetLoc?.discovered || false,
            type: targetLoc?.type || null
        };
    });
    
    // Get POIs at current location
    const pois = (currentLocation?.pois || []).map(poi => ({
        id: poi._id,
        name: poi.name,
        type: poi.type,
        description: poi.description,
        icon: poi.icon,
        discovered: poi.discovered,
        interactionCount: poi.interactionCount || 0
    }));
    
    return {
        type: 'settlement',
        region: plot.current_state.current_location.region,
        settlement: {
            id: settlement._id,
            name: settlement.name,
            description: settlement.description,
            size: settlement.size
        },
        location: currentLocation ? {
            id: currentLocation._id,
            name: currentLocation.name,
            type: currentLocation.type,
            description: currentLocation.description,
            shortDescription: currentLocation.shortDescription,
            discovered: currentLocation.discovered
        } : null,
        connections: validMoves,
        pois: pois,
        // Include all discovered locations for map rendering (with connection graph)
        discoveredLocations: (settlement.locations || [])
            .filter(l => l.discovered)
            .map(l => ({
                id: l._id,
                name: l.name,
                type: l.type,
                shortDescription: l.shortDescription,
                coordinates: l.coordinates,
                isCurrent: currentLocation && l._id.toString() === currentLocation._id.toString(),
                connections: (l.connections || []).map(conn => {
                    const targetLoc = settlement.locations.find(t =>
                        t.name.toLowerCase() === conn.locationName?.toLowerCase()
                    );
                    return {
                        locationName: conn.locationName,
                        direction: conn.direction,
                        distance: conn.distance,
                        targetId: targetLoc?._id || null,
                        targetDiscovered: targetLoc?.discovered || false,
                        targetCoordinates: targetLoc?.coordinates || null,
                        targetType: targetLoc?.type || null
                    };
                })
            }))
    };
}

/**
 * Get list of valid moves from current location
 * @param {string} plotId - The plot ID
 * @returns {Array} List of valid move targets
 */
async function getValidMoves(plotId) {
    const locationData = await getCurrentLocation(plotId);
    return locationData.connections.filter(c => c.targetId !== null);
}

/**
 * Move player to a connected location
 * @param {string} plotId - The plot ID
 * @param {Object} options - Movement options
 * @param {string} options.targetId - Target location ObjectId (preferred)
 * @param {string} options.targetName - Target location name (fallback)
 * @param {string} options.direction - Direction to move (fallback)
 * @returns {Object} Result with new location data and narration
 */
async function moveToLocation(plotId, { targetId, targetName, direction }) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.settlement');
    
    if (!plot) {
        throw new Error('Plot not found');
    }
    
    const settlement = plot.current_state.current_location.settlement;
    if (!settlement) {
        return {
            success: false,
            error: 'Cannot move - not in a settlement',
            errorCode: 'NOT_IN_SETTLEMENT'
        };
    }
    
    // Ensure locations exist
    if (!settlement.locations || settlement.locations.length === 0) {
        return {
            success: false,
            error: 'Settlement has no locations defined',
            errorCode: 'NO_LOCATIONS'
        };
    }
    
    // Find current location
    const locationId = plot.current_state.current_location.locationId;
    const locationName = plot.current_state.current_location.locationName;
    
    let currentLocation = null;
    if (locationId) {
        currentLocation = settlement.locations.find(l => 
            l._id.toString() === locationId.toString()
        );
    }
    if (!currentLocation && locationName) {
        currentLocation = settlement.locations.find(l => 
            l.name.toLowerCase() === locationName.toLowerCase()
        );
    }
    if (!currentLocation) {
        currentLocation = settlement.locations.find(l => l.isStartingLocation) 
                       || settlement.locations[0];
    }
    
    // Find target location
    let targetLocation = null;
    let usedConnection = null;
    
    // Method 1: By targetId
    if (targetId) {
        targetLocation = settlement.locations.find(l => 
            l._id.toString() === targetId.toString()
        );
    }
    
    // Method 2: By targetName
    if (!targetLocation && targetName) {
        targetLocation = settlement.locations.find(l => 
            l.name.toLowerCase() === targetName.toLowerCase()
        );
    }
    
    // Method 3: By direction from current location
    if (!targetLocation && direction && currentLocation) {
        usedConnection = currentLocation.connections?.find(c => 
            c.direction?.toLowerCase() === direction.toLowerCase()
        );
        if (usedConnection) {
            targetLocation = settlement.locations.find(l => 
                l.name.toLowerCase() === usedConnection.locationName?.toLowerCase()
            );
        }
    }
    
    if (!targetLocation) {
        return {
            success: false,
            error: `Cannot find location: ${targetName || targetId || direction}`,
            errorCode: 'LOCATION_NOT_FOUND'
        };
    }
    
    // Validate connection exists (unless we're at the same location)
    if (currentLocation && currentLocation._id.toString() !== targetLocation._id.toString()) {
        if (!usedConnection) {
            usedConnection = currentLocation.connections?.find(c => 
                c.locationName?.toLowerCase() === targetLocation.name.toLowerCase()
            );
        }
        
        if (!usedConnection) {
            return {
                success: false,
                error: `No direct path from ${currentLocation.name} to ${targetLocation.name}`,
                errorCode: 'NO_CONNECTION',
                suggestion: 'You may need to find a route through other locations.'
            };
        }
    }
    
    // Mark target location as discovered if not already
    const wasDiscovered = targetLocation.discovered;
    if (!targetLocation.discovered) {
        await Settlement.updateOne(
            { _id: settlement._id, 'locations._id': targetLocation._id },
            { $set: { 'locations.$.discovered': true } }
        );
    }
    
    // Update player position
    plot.current_state.current_location.locationId = targetLocation._id;
    plot.current_state.current_location.locationName = targetLocation.name;
    plot.current_state.current_location.locationDescription = targetLocation.description;
    plot.current_state.current_location.description = targetLocation.description;
    
    // Update activity based on movement
    if (plot.current_state.current_activity === 'resting') {
        plot.current_state.current_activity = 'exploring';
    }
    
    await plot.save();
    
    // Build arrival narration
    const narration = buildArrivalNarration(targetLocation, usedConnection, wasDiscovered);
    
    // Reload to get fresh data
    const newLocationData = await getCurrentLocation(plotId);
    
    return {
        success: true,
        narration: narration,
        previousLocation: currentLocation ? {
            id: currentLocation._id,
            name: currentLocation.name
        } : null,
        newLocation: newLocationData.location,
        connections: newLocationData.connections,
        pois: newLocationData.pois,
        discovered: !wasDiscovered
    };
}

/**
 * Build a brief arrival narration for entering a location
 */
function buildArrivalNarration(location, connection, wasDiscovered) {
    const name = location.name;
    const type = location.type;
    const desc = location.shortDescription || location.description;
    
    let narration = '';
    
    // How did we get here?
    if (connection?.description) {
        narration += `You go ${connection.description}. `;
    } else if (connection?.direction) {
        narration += `You head ${connection.direction}. `;
    }
    
    // What do we see?
    if (!wasDiscovered) {
        narration += `You discover ${name}. `;
    } else {
        narration += `You arrive at ${name}. `;
    }
    
    // Brief description
    if (desc) {
        narration += desc;
    }
    
    return narration.trim();
}

/**
 * Check if a movement would be valid (without executing it)
 */
async function canMoveTo(plotId, { targetId, targetName, direction }) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.settlement');
    
    if (!plot?.current_state?.current_location?.settlement) {
        return { valid: false, reason: 'Not in a settlement' };
    }
    
    const settlement = plot.current_state.current_location.settlement;
    const locationId = plot.current_state.current_location.locationId;
    const locationName = plot.current_state.current_location.locationName;
    
    // Find current location
    let currentLocation = null;
    if (locationId) {
        currentLocation = settlement.locations?.find(l => 
            l._id.toString() === locationId.toString()
        );
    }
    if (!currentLocation && locationName) {
        currentLocation = settlement.locations?.find(l => 
            l.name.toLowerCase() === locationName.toLowerCase()
        );
    }
    if (!currentLocation) {
        return { valid: false, reason: 'Current location unknown' };
    }
    
    // Find target
    let targetLocation = null;
    if (targetId) {
        targetLocation = settlement.locations?.find(l => 
            l._id.toString() === targetId.toString()
        );
    }
    if (!targetLocation && targetName) {
        targetLocation = settlement.locations?.find(l => 
            l.name.toLowerCase() === targetName.toLowerCase()
        );
    }
    if (!targetLocation && direction) {
        const conn = currentLocation.connections?.find(c => 
            c.direction?.toLowerCase() === direction.toLowerCase()
        );
        if (conn) {
            targetLocation = settlement.locations?.find(l => 
                l.name.toLowerCase() === conn.locationName?.toLowerCase()
            );
        }
    }
    
    if (!targetLocation) {
        return { valid: false, reason: 'Target location not found' };
    }
    
    // Check connection
    const hasConnection = currentLocation.connections?.some(c => 
        c.locationName?.toLowerCase() === targetLocation.name.toLowerCase()
    );
    
    if (!hasConnection) {
        return { 
            valid: false, 
            reason: `No direct path to ${targetLocation.name}`,
            targetExists: true
        };
    }
    
    return { 
        valid: true, 
        target: {
            id: targetLocation._id,
            name: targetLocation.name,
            type: targetLocation.type
        }
    };
}

/**
 * Parse natural language for movement intent
 * Returns movement params if movement detected, null otherwise
 */
function parseMovementIntent(input) {
    const lowerInput = input.toLowerCase().trim();
    
    // Direct movement patterns
    const movePatterns = [
        /^(?:i\s+)?(?:go|walk|head|travel|move|run|proceed)\s+(?:to\s+)?(?:the\s+)?(.+)$/i,
        /^(?:i\s+)?(?:go|walk|head|travel|move|run|proceed)\s+(north|south|east|west|up|down|inside|outside)$/i,
        /^(?:i\s+)?(?:enter|leave|exit)\s+(?:the\s+)?(.+)$/i,
        /^(?:i\s+)?(?:go|head)\s+(north|south|east|west|northeast|northwest|southeast|southwest)$/i,
    ];
    
    for (const pattern of movePatterns) {
        const match = lowerInput.match(pattern);
        if (match) {
            const target = match[1].trim();
            
            // Check if it's a direction
            const directions = ['north', 'south', 'east', 'west', 'up', 'down', 
                              'northeast', 'northwest', 'southeast', 'southwest',
                              'inside', 'outside'];
            if (directions.includes(target.toLowerCase())) {
                return { direction: target.toLowerCase() };
            }
            
            // Otherwise it's a location name
            return { targetName: target };
        }
    }
    
    return null;
}

/**
 * Synchronize locationId from locationName if missing
 * Used for backward compatibility during migration
 */
async function syncLocationId(plotId) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.settlement');
    
    if (!plot) return null;
    
    const settlement = plot.current_state.current_location.settlement;
    if (!settlement?.locations?.length) return null;
    
    // If locationId exists and is valid, we're good
    if (plot.current_state.current_location.locationId) {
        const exists = settlement.locations.some(l => 
            l._id.toString() === plot.current_state.current_location.locationId.toString()
        );
        if (exists) return plot.current_state.current_location.locationId;
    }
    
    // Try to match by name
    const locationName = plot.current_state.current_location.locationName;
    if (locationName) {
        const match = settlement.locations.find(l => 
            l.name.toLowerCase() === locationName.toLowerCase()
        );
        if (match) {
            plot.current_state.current_location.locationId = match._id;
            await plot.save();
            return match._id;
        }
    }
    
    // Fall back to starting location
    const startLoc = settlement.locations.find(l => l.isStartingLocation) 
                  || settlement.locations[0];
    if (startLoc) {
        plot.current_state.current_location.locationId = startLoc._id;
        plot.current_state.current_location.locationName = startLoc.name;
        await plot.save();
        return startLoc._id;
    }
    
    return null;
}

module.exports = {
    getCurrentLocation,
    getValidMoves,
    moveToLocation,
    canMoveTo,
    parseMovementIntent,
    syncLocationId
};
