const mongoose = require('mongoose');
const Ecosystem = require('../../db/models/Ecosystem');
const Region = require('../../db/models/Region');
const Settlement = require('../../db/models/Settlement');
const Plot = require('../../db/models/Plot');
const Quest = require('../../db/models/Quest');
const gpt = require('../../services/gptService');
const {uuid} = require('uuidv4');


const storyOptions = (region_id) => {
    return new Promise(async (resolve, reject) => {
        let region = await Region.findOne({ _id: region_id })
            .populate({ path: 'world' })
            .populate({ path: 'settlements' })
            .exec();

        // Get the length of the settlements array
        let settlementsLength = region.settlements.length;

        // Select a random starting settlement in the Region
        let pickedSettlement = Math.floor(Math.random() * settlementsLength);
        let startingSettlement = region.settlements[pickedSettlement];
        // Access the name and description string from the randomly selected settlement object
        let settlementName = startingSettlement.name;
        let settlementDescription = startingSettlement.description;

        let promptResult = await gpt.prompt('gpt-3.5-turbo', `You are a Dungeons and Dragons game master. The players are starting a new game in ${region.world.name}: ${region.world.description}. Please generate three possible initial quests that start in the settlement ${settlementName}: ${settlementDescription}. Please format it in a JSON array with each JSON object structured as follow: { "questTitle": "<Title of quest>", "description": "<The 3 to 5 sentence description of the quest>", "firstObjective": "<The first objective of the quest>"}`);

        try {
            // Parse the JSON string outside the loop
            let quests = JSON.parse(promptResult.content);
            console.log(quests)
            resolve(quests);
        } catch (e) {
            reject(e);
        }
    });
};



            // for (let i = 0; i < 3; i++)
            //     // Get the firstObjective property from the parsed p object
            //     let firstObjective = quests[i].firstObjective;

            //     await Quest.create({
            //         world: region.world._id,
            //         objectives: [firstObjective],
            //         currentObjective: firstObjective,
            //         ...quests[i]
            //     });


module.exports = { storyOptions };
