const Plot = require('../../db/models/Plot');

async function getWorldAndRegionDetails(plotId) {
    try {
        const plot = await Plot.findById(plotId).populate('world current_state.current_location.region current_state.current_location.settlement');
        if (!plot) {
            throw new Error('Plot not found');
        }
        const { world, current_state: { current_location: { region, settlement } } } = plot;
        return {
            world: {
                name: world.name,
                description: world.description
            },
            region: {
                name: region.name,
                description: region.description
            },
            settlement: {
                name: settlement.name,
                description: settlement.description
            }
        };
    } catch (error) {
        console.error('Error getting world and region details:', error);
        throw error;
    }
}

module.exports = { getWorldAndRegionDetails };
