/**
 * plotInitService.js - Plot initialization logic (GPT-heavy work).
 * Extracted from routes/plots.js POST /plot/:plotId/initialize.
 */

const Plot = require('../db/models/Plot');
const Region = require('../db/models/Region');
const Settlement = require('../db/models/Settlement');
const regionFactory = require('../agents/world/factories/regionsFactory');
const settlementsFactory = require('../agents/world/factories/settlementsFactory');
const movementService = require('./movementService');

/**
 * Initialize a newly created plot. Performs all GPT-heavy work:
 * describe region, generate locations, create opening narrative.
 *
 * @param {Object} plot - Mongoose Plot document
 * @param {Function} sendEvent - SSE event sender: (type, data) => void
 */
async function initializePlot(plot, sendEvent) {
    const regionId = plot.current_state.current_location.region;
    const settlementRef = plot.current_state.current_location.settlement;

    // Step 1: Describe region + starting settlement in parallel
    sendEvent('progress', { step: 1, total: 3, message: 'Describing the region...' });

    const region = await Region.findById(regionId);
    const needsRegionDescribe = !region.described;
    const settlementDoc = settlementRef ? await Settlement.findById(settlementRef) : null;
    const needsSettlementDescribe = settlementDoc && !settlementDoc.described;

    const parallelTasks = [];
    if (needsRegionDescribe) {
        parallelTasks.push(regionFactory.describe(regionId));
    }
    if (needsSettlementDescribe) {
        parallelTasks.push(settlementsFactory.describe([settlementRef._id || settlementRef]));
    }
    if (parallelTasks.length > 0) {
        await Promise.all(parallelTasks);
    }

    // Step 2: Generate locations in the starting settlement
    sendEvent('progress', { step: 2, total: 3, message: 'Generating locations...' });
    let startingLocationName = null;
    let settlement = null;
    if (settlementRef) {
        startingLocationName = await settlementsFactory.ensureLocations(settlementRef);
        settlement = await Settlement.findById(settlementRef);
    }

    // Step 3: Update plot with real names/coordinates, create game log
    sendEvent('progress', { step: 3, total: 3, message: 'Preparing your starting position...' });
    const freshRegion = await Region.findById(regionId);

    if (settlement) {
        plot.current_state.current_location.locationName = startingLocationName || settlement.name || 'Starting Settlement';
        plot.current_state.current_location.locationDescription = settlement.description || 'A place to begin your journey.';
        plot.current_state.current_location.description = settlement.description || 'A place to begin your journey.';
        if (settlement.coordinates && settlement.coordinates.length > 0) {
            const idx = Math.floor(Math.random() * settlement.coordinates.length);
            const coords = settlement.coordinates[idx] || [0, 0];
            plot.current_state.current_location.coordinates = coords;
        }
    } else if (freshRegion) {
        plot.current_state.current_location.locationName = freshRegion.name || 'Starting Region';
        plot.current_state.current_location.locationDescription = freshRegion.description || 'An unexplored land awaits.';
        plot.current_state.current_location.description = freshRegion.description || 'An unexplored land awaits.';
    }
    await plot.save();

    // Sync locationId if settlement has locations
    if (settlementRef) {
        await movementService.syncLocationId(plot._id);
    }

    // Reload plot to get synced data
    const updatedPlot = await Plot.findById(plot._id);
    const finalLocationName = updatedPlot.current_state.current_location.locationName;
    const locationDesc = updatedPlot.current_state.current_location.locationDescription;
    const settlementName = settlement ? settlement.name : (freshRegion ? freshRegion.name : 'the wilds');

    // Create opening narrative and game log
    const openingMessage = `You arrive at ${finalLocationName} in ${settlementName}.\n\n${locationDesc}\n\nThe world stretches before you—alive, indifferent, and full of possibility. What will you do?`;

    const gameLogService = require('./gameLogService');
    await gameLogService.saveMessage(plot._id, { author: 'AI', content: openingMessage });

    updatedPlot.status = 'ready';
    await updatedPlot.save();

    sendEvent('complete', { message: 'Your adventure is ready!', locationName: finalLocationName });

    // Fire-and-forget: describe remaining settlements in the region
    regionFactory.describeSettlements(regionId).catch(err => {
        console.error('[Init] Background settlement description failed:', err.message);
    });
}

module.exports = { initializePlot };
