const mongoose = require('mongoose');
const World = require('../../db/models/World');
const Ecosystem = require('../../db/models/Ecosystem');
const Region = require('../../db/models/Region');
const Settlement = require('../../db/models/Settlement');
const Plot = require('../../db/models/Plot');
const Quest = require('../../db/models/Quest');
const noteTaker = require('../world/noteTaker');
const gpt = require('../../services/gptService');
const { uuid } = require('uuidv4');

const questBuilder = async (questId) => {
    try {
        const quest = await Quest.findById(questId).populate('world');
        if (!quest) {
            throw new Error('Quest not found');
        }

        const { world, questTitle, description, locations } = quest;
        const primaryLocation = locations.primary;
        let regionName = 'unknown region';
        let regionDescription = '';
        let settlementDescription = '';

        if (primaryLocation) {
            const settlement = await Settlement.findOne({ name: primaryLocation });
            if (settlement) {
                const region = await Region.findById(settlement.region);
                if (region) {
                    regionName = region.name;
                    regionDescription = region.description;
                    settlementDescription = settlement.description;
                }
            }
        }

        const prompt = `
            You are a tabletop RPG game master. Create a detailed quest based on the following information:
            Title: ${questTitle}
            Description: ${description}
            Region: ${regionName} - ${regionDescription}
            Settlement: ${primaryLocation} - ${settlementDescription}
            
            Generate a JSON object with the following structure:
            {
                "questTitle": "${questTitle}", 
                "description": "${description}",
                "triggers": {
                    "conditions": ["<Trigger condition 1>", "<Trigger condition 2>"]
                },
                "keyActors": {
                    "primary": [
                        { "name": "<Primary actor 1>", "role": "<Role of primary actor 1>" },
                        { "name": "<Primary actor 2>", "role": "<Role of primary actor 2>" }
                    ],
                    "secondary": [
                        { "name": "<Secondary actor 1>", "role": "<Role of secondary actor 1>" },
                        { "name": "<Secondary actor 2>", "role": "<Role of secondary actor 2>" }
                    ]
                },
                "locations": {
                    "primary": "<Primary location>",
                    "secondary": ["<Secondary location 1>", "<Secondary location 2>"]
                },
                "outcomes": [
                    { "type": "A", "description": "<Description of outcome A>" },
                    { "type": "B", "description": "<Description of outcome B>" },
                    { "type": "C", "description": "<Description of outcome C>" }
                ],
                "consequences": {
                    "immediate": "<Immediate consequence>",
                    "longTerm": "<Long-term consequence>"
                }
            }
        `;
        
        const promptResult = await gpt.prompt('gpt-3.5-turbo', prompt);
        const detailedQuest = JSON.parse(promptResult.content);

        // Update the quest with the detailed information
        await Quest.findByIdAndUpdate(questId, {
            $set: {
                triggers: detailedQuest.triggers,
                keyActors: detailedQuest.keyActors,
                locations: detailedQuest.locations,
                outcomes: detailedQuest.outcomes,
                consequences: detailedQuest.consequences
            }
        });

        return detailedQuest;
    } catch (error) {
        console.error('Error building quest:', error);
        throw error;
    }
};

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
            You are a tabletop RPG game master. The players are starting a new game in the world of ${world.name}. Specifically in the region ${regionName}: ${regionDescription}.
            Please generate three possible initial quests that could only happen in the settlement ${settlementName}: ${settlementDescription}. 
            Please format it in a JSON array with each JSON object structured as follows: 
            { "questTitle": "<Title of quest>", "description": "<The 3 to 5 sentence description of the quest>" }
        `);

        const quests = JSON.parse(promptResult.content);
        console.log('Generated Quests:', quests);

        // Save initial quest stubs to the database
        const savedQuests = await noteTaker.saveQuests(quests, region, settlement._id, plotId);

        // Use questBuilder to flesh out each quest
        const detailedQuests = await Promise.all(savedQuests.map(async savedQuest => {
            return await questBuilder(savedQuest._id);
        }));

        console.log('Detailed Quests:', detailedQuests);
        return detailedQuests;
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

        // Save initial quest stubs to the database
        const savedQuests = await noteTaker.saveQuests(quests, region, settlement._id);

        // Use questBuilder to flesh out each quest
        const detailedQuests = await Promise.all(savedQuests.map(async savedQuest => {
            return await questBuilder(savedQuest._id);
        }));
        
        return detailedQuests;
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

module.exports = { storyOptions, createQuestInCurrentSettlement, getWorldAndRegionDetails, getInitialQuests, questBuilder };