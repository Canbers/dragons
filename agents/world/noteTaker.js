const mongoose = require('mongoose');
const Ecosystem = require('../../db/models/Ecosystem');
const Region = require('../../db/models/Region');
const Settlement = require('../../db/models/Settlement');
const Plot = require('../../db/models/Plot');
const Quest = require('../../db/models/Quest');
const gpt = require('../../services/gptService');
const {uuid} = require('uuidv4');


// temporary function that will automatically pick a quest
// WILL NEED TO BE REMOVED once frontend quest select inteface is implemented
// Should be able to salvage the save selected quest to database logic from this function
const questPicker = (quests, region) => {
    return new Promise(async (resolve, reject) => {
        // Select a random quest from the quests array
        let selectedQuestIndex = Math.floor(Math.random() * quests.length);
        let selectedQuest = quests[selectedQuestIndex];
        console.log("Selected Quest: ", selectedQuest);

        try {
            let firstObjective = selectedQuest.firstObjective;
            // Save quest to database    
            await Quest.create({
                world: region.world._id,
                objectives: [firstObjective],
                currentObjective: firstObjective,
                ...selectedQuest
            });
            resolve(selectedQuest);
        } catch (e) {
            reject(e);
        }
    })
}

// function to add quests to Plot collection
const questToPlot = (quest, plotId) => {
    return new Promise(async (resolve, reject) => {
        try {
            // Update the plot by adding the quest ID to the quests array
            const updatedPlot = await Plot.findByIdAndUpdate(
                plotId,
                { $push: { 
                    quests: {
                        quest: quest._id,
                        questTitle: quest.questTitle,
                        questStatus: quest.status
                        } 
                    }
                }
            );

            resolve(updatedPlot);
        } catch (e) {
            reject(e);
        }
    });
};

module.exports = { questPicker, questToPlot };