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


const storyOptions = (region_id, plotId) => {
    return new Promise(async (resolve, reject) => {
        try {
            // Find the region with the given region_id
            let region = await Region.findOne({ _id: region_id });
            if (!region) {
                reject(new Error('Region not found.'));
                return;
            }
            // Fetch the world for this region
            let world = await World.findOne({ _id: region.world })
            .populate('name');
            if (!world) {
                reject(new Error('No world found for the region.'));
                return;
            }
            // Fetch all settlements for the region
            let settlements = await Settlement.find({ _id: { $in: region.settlements } })
            .populate(['name', 'description']);
            if (settlements.length === 0) {
                reject(new Error('No settlements found for the region.'));
                return;
            }

        // Get the length of the settlements array
        let settlementsLength = region.settlements.length;

        // Select a random starting settlement in the Region
        let pickedSettlement = Math.floor(Math.random() * settlementsLength);
        let startingSettlement = settlements[pickedSettlement];
        // Access the name and description string from the randomly selected settlement object
        let settlementName = startingSettlement.name;
        console.log(`Starting in the settlement: ${settlementName}`);
        let settlementDescription = startingSettlement.description;
        console.log('Prompting GPT for 3 quests...');
        let promptResult = await gpt.prompt('gpt-3.5-turbo', `You are a Dungeons and Dragons game master. The players are starting a new game in ${region.world.name}: ${region.world.description}. Please generate three possible initial quests that could only happen in the settlement ${settlementName}: ${settlementDescription}. Please format it in a JSON array with each JSON object structured as follow: { "questTitle": "<Title of quest>", "description": "<The 3 to 5 sentence description of the quest>", "firstObjective": "<The first objective of the quest>"}`);
        try {
            // Parse the JSON string outside the loop
            let quests = JSON.parse(promptResult.content);
            console.log(quests);
            
            // Save the quests and pass the starting settlement
            await noteTaker.saveQuests(quests, region, startingSettlement._id, plotId);
            
            resolve(quests);
        } catch (e) {
            reject(e);
        }
    } catch (error) {
        reject(error);
    }
});
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

module.exports = { storyOptions, createQuestInCurrentSettlement};
