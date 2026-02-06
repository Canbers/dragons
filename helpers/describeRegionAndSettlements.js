const Region = require('../db/models/Region');
const regionFactory = require('../agents/world/factories/regionsFactory.js');

const describeRegionAndSettlements = async (regionId) => {
    const region = await Region.findById(regionId);
    if (!region.described) {
        await regionFactory.describe(regionId);
    }
    await regionFactory.describeSettlements(regionId);
};

module.exports = describeRegionAndSettlements;
