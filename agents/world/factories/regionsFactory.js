const mongoose = require('mongoose');
const Ecosystem = require('../../../db/models/Ecosystem');
const Region = require('../../../db/models/Region');
const settlement = require('./settlementsFactory');
const { uuid } = require('uuidv4');
const gpt = require('../../../services/gptService');
const Settlement = require('../../../db/models/Settlement');
const { generateHighLevelClusters, generateDetailedMap } = require('./mapFactory');

const create = (world, coordinates) => {
    return new Promise(async (resolve, reject) => {
        try {
            // Determine which ecosystem
            let ecosystems = await Ecosystem.find({ world: world });
            let ecosystem = ecosystems[Math.floor(Math.random() * ecosystems.length)];

            let region = await Region.create({
                name: uuid(),
                coordinates: coordinates,
                ecosystem: ecosystem._id,
                world: world,
                settlements: [],
            });

            // Number of settlements and size
            let settlementCount = Math.floor(Math.random() * 4) + 1;
            let newSettlements = await settlement.create(region, settlementCount);

            // Initialize settlements array
            let settlements = [];

            for (let i = 0; i < settlementCount; i++) {
                settlements.push(newSettlements[i]._id);
            }

            // Update the region's settlements array
            await Region.findByIdAndUpdate(region._id, { settlements: settlements });

            // Generate and describe the region map
            await generateAndDescribeRegionMap(region._id, ecosystem.name);

            // Describe the region
            await describe(region._id);

            resolve(region);
        } catch (error) {
            console.error(`Error in create function: ${error.message}`);
            reject(error);
        }
    });
};

const describe = async (region_id) => {
    return new Promise(async (resolve, reject) => {
        try {
            let region = await Region.findOne({ _id: region_id }).populate({ path: 'ecosystem' }).populate({ path: 'world' }).exec();
            console.log(`Prompting GPT for Region description for region with coordinates [${region.coordinates}]...`);

            let retries = 5; // Number of retries for unique name generation
            let attempt = 0;

            while (retries > 0) {
                attempt++;
                try {
                    let promptResult = await gpt.prompt('gpt-5-mini', `Create a region for the world "${region.world.name}": ${region.world.description}

This region is a ${region.ecosystem.name} area. Design it as part of an "Indifferent World" - a place that exists with its own history, conflicts, and daily life regardless of any hero.

Include:
- A distinctive, evocative name
- Hints at local power dynamics or tensions
- Details that suggest ongoing life (trade routes, local customs, recent events)
- Something dangerous or problematic about the region
- Something valuable or desirable about it

Format as JSON:
{
  "name": "<Evocative region name>",
  "description": "<Two paragraphs: first about the land itself, second about the people/conflicts/opportunities>",
  "short": "<Two sentences capturing the essence>"
}`);
                    let p = JSON.parse(promptResult.content);

                    await Region.findByIdAndUpdate(region_id, { described: true, ...p });
                    console.log(`Successfully described region (Attempt ${attempt}) with coordinates [${region.coordinates}]`);
                    return resolve(); // Successfully described the region, exit the loop

                } catch (e) {
                    if (e.code === 11000) { // Duplicate key error
                        console.log(`Duplicate region name detected on attempt ${attempt} for region with coordinates [${region.coordinates}]. Retrying...`);
                        retries--;
                    } else {
                        console.error(`Error on attempt ${attempt} for region with coordinates [${region.coordinates}]:`, e);
                        return reject(e); // Other error, exit the loop
                    }
                }
            }
            console.error(`Failed to generate a unique region name for region with coordinates [${region.coordinates}] after ${attempt} attempts.`);
            reject(new Error('Failed to generate a unique region name after multiple attempts.'));
        } catch (error) {
            console.error(`Failed to find region with ID ${region_id}:`, error);
            reject(error);
        }
    });
}

// New function to describe settlements when a region is explored
const describeSettlements = async (region_id) => {
    console.log(`[PARALLEL] Starting parallel settlement description for region ${region_id}...`);
    let settlements = await Settlement.find({ region: region_id });
    
    // Only describe settlements that haven't been described yet
    const undescribedSettlements = settlements.filter(s => !s.described);
    
    if (undescribedSettlements.length === 0) {
        console.log(`[PARALLEL] All settlements already described for region ${region_id}`);
        return;
    }
    
    console.log(`[PARALLEL] Found ${undescribedSettlements.length} undescribed settlements`);
    await settlement.describe(undescribedSettlements.map(s => s.id));
}

const generateAndDescribeRegionMap = async (regionId, ecosystem) => {
    try {
        const highLevelClusters = generateHighLevelClusters(ecosystem);
        const detailedMap = generateDetailedMap(highLevelClusters, ecosystem);

        // Update region with the generated maps
        await Region.findByIdAndUpdate(regionId, { highLevelMap: highLevelClusters, map: detailedMap }, { new: true });
        console.log(`Region map generated for region ID: ${regionId}`);
    } catch (error) {
        console.error(`Failed to generate region map: ${error.message}`);
    }
};

module.exports = {
    create,
    describe,
    describeSettlements
};