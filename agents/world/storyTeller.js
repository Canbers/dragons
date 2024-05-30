const mongoose = require('mongoose');
const World = require('../../db/models/World');
const Ecosystem = require('../../db/models/Ecosystem');
const Region = require('../../db/models/Region');
const Settlement = require('../../db/models/Settlement');
const Plot = require('../../db/models/Plot');
const Quest = require('../../db/models/Quest');
const noteTaker = require('../world/noteTaker')
const gpt = require('../../services/gptService');
const {uuid} = require('uuidv4');


const storyOptions = async (plotId) => {
    try {
        const plot = await Plot.findById(plotId).populate('world');
        if (!plot) {
            throw new Error('Plot not found');
        }

        const { world, current_state: { current_location: { region: regionId, settlement: settlementId } } } = plot;

        if (!world || !regionId || !settlementId) {
            throw new Error('Missing world, region, or settlement information in the plot.');
        }

        // Fetch region and settlement details from their IDs
        const region = await Region.findById(regionId);
        const settlement = await Settlement.findById(settlementId);

        if (!region || !settlement) {
            throw new Error('Region or settlement not found.');
        }

        const regionName = region.name;
        const regionDescription = region.description;
        const settlementName = settlement.name;
        const settlementDescription = settlement.description;

        console.log('Prompting GPT for 3 quests...');
        const promptResult = await gpt.prompt('gpt-3.5-turbo', `
            You are a Dungeons and Dragons game master. The players are starting a new game in the world of ${world.name}. Specifically in the region ${regionName}: ${regionDescription}.
            Please generate three possible initial quests that could only happen in the settlement ${settlementName}: ${settlementDescription}. 
            Please format it in a JSON array with each JSON object structured as follow: 
            { "questTitle": "<Title of quest>", "description": "<The 3 to 5 sentence description of the quest>", "firstObjective": "<The first objective of the quest>"}
        `);

        const quests = JSON.parse(promptResult.content);
        console.log(quests);

        await noteTaker.saveQuests(quests, region, settlement._id, plotId);

        return quests;
    } catch (error) {
        console.error('Error generating story options:', error);
        throw error;
    }
};

// Not used anywhere yet, for future reference when needing to create additional quests during gameplay.
const createQuestInCurrentSettlement = async (region_id, settlement_id) => {
    try {
        // Fetch the region and settlement
        let region = await Region.findById(region_id);
        let settlement = await Settlement.findById(settlement_id);
        
        if (!region || !settlement) {
            throw new Error('Region or Settlement not found.');
        }

        // Generate quests (this is just an example, adjust as needed)
        let promptResult = await gpt.prompt('gpt-3.5-turbo', `Generate a quest for the settlement ${settlement.name} in the region ${region.name}.`);
        let quests = JSON.parse(promptResult.content);

        // Save the quests
        await noteTaker.saveQuests(quests, region, settlement._id);
        
        return quests;
    } catch (error) {
        throw new Error('Failed to create quest: ' + error.message);
    }
};


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

async function getInitialQuests(plotId) {
    try {
        const plot = await Plot.findById(plotId).populate('current_state.current_location.region');
        if (!plot) {
            throw new Error('Plot not found');
        }
        const { current_state: { current_location: { region } } } = plot;
        const quests = await storyOptions(plotId);
        return quests;
    } catch (error) {
        console.error('Error getting initial quests:', error);
        throw error;
    }
}


module.exports = { storyOptions, createQuestInCurrentSettlement, getWorldAndRegionDetails, getInitialQuests };
