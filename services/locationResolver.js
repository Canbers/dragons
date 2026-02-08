/**
 * locationResolver.js - Shared utility for resolving the player's current location.
 *
 * Eliminates the copy-pasted "find current location" pattern across
 * gameAgent, movementService, actionInterpreter, and routes/plots.
 */

const Plot = require('../db/models/Plot');
const Settlement = require('../db/models/Settlement');

/**
 * Find the current location subdoc within a settlement, given a plot.
 * Uses locationId (preferred), then locationName (fallback), then starting location.
 *
 * @param {Object} plot - Mongoose Plot document (with settlement populated or as ID)
 * @param {Object} settlement - Mongoose Settlement document with locations[]
 * @returns {{ location: Object|null, locationId: ObjectId|null }}
 */
function getCurrentLocation(plot, settlement) {
    if (!settlement?.locations?.length) {
        return { location: null, locationId: null };
    }

    const locId = plot.current_state?.current_location?.locationId;
    const locName = plot.current_state?.current_location?.locationName;

    let location = null;

    if (locId) {
        location = settlement.locations.find(l => l._id.toString() === locId.toString());
    }
    if (!location && locName) {
        location = settlement.locations.find(l => l.name.toLowerCase() === locName.toLowerCase());
    }
    if (!location) {
        location = settlement.locations.find(l => l.isStartingLocation) || settlement.locations[0];
    }

    return {
        location: location || null,
        locationId: location?._id || null
    };
}

/**
 * Load a plot with populated settlement and resolve the current location.
 * Convenience wrapper that does the DB query + resolution in one call.
 *
 * @param {string} plotId
 * @returns {{ plot: Object, settlement: Object|null, location: Object|null }}
 */
async function getSettlementAndLocation(plotId) {
    const plot = await Plot.findById(plotId)
        .populate('current_state.current_location.region')
        .populate('current_state.current_location.settlement');

    if (!plot) throw new Error('Plot not found');

    const settlement = plot.current_state?.current_location?.settlement || null;
    const { location } = getCurrentLocation(plot, settlement);

    return { plot, settlement, location };
}

module.exports = { getCurrentLocation, getSettlementAndLocation };
