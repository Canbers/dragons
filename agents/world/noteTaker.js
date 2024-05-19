const mongoose = require('mongoose');
const Ecosystem = require('../../db/models/Ecosystem');
const Region = require('../../db/models/Region');
const Settlement = require('../../db/models/Settlement');
const Plot = require('../../db/models/Plot');
const Quest = require('../../db/models/Quest');
const gpt = require('../../services/gptService');
const {uuid} = require('uuidv4');


/* temporary function that will automatically pick a quest ---DISABLED
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
*/

// Function to save one or multiple quests to the Quest collection
const saveQuests = async (quests, region, originSettlement, plotId) => {
    try {
        // Check if quests is wrapped in an object with a 'quests' property
        if (quests.quests && Array.isArray(quests.quests)) {
            quests = quests.quests;
        } else if (!Array.isArray(quests)) {
            quests = [quests]; // Convert single quest to an array if it's not an array
        }
        
        const questsToSave = quests.map(quest => ({
            insertOne: {
                document: {
                    world: region.world._id,
                    questTitle: quest.questTitle, // Ensure quest title is included
                    description: quest.description, // Ensure description is included
                    objectives: [quest.firstObjective], // Wrap firstObjective in an array
                    currentObjective: quest.firstObjective, // Set the first objective as the current objective
                    originSettlement: originSettlement,
                    status: 'Not started' // Set default status
                }
            }
        }));

        const result = await Quest.bulkWrite(questsToSave);
        const savedQuests = quests.map((quest, index) => ({
            _id: result.insertedIds[index], // Get the _id from the result of bulkWrite
            questTitle: quest.questTitle,
            status: 'Not started'
        }));

        // Ensure savedQuests is an array
        if (!Array.isArray(savedQuests)) {
            throw new Error('Failed to construct savedQuests array');
        }

        // Update Region and Settlement models to store reference to quests
        const regionUpdate = {
            $push: { quests: { $each: savedQuests.map(quest => ({ quest: quest._id, questTitle: quest.questTitle })) } }
        };
        await Region.findByIdAndUpdate(region._id, regionUpdate);

        const settlementUpdate = {
            $push: { quests: { $each: savedQuests.map(quest => ({ quest: quest._id, questTitle: quest.questTitle })) } }
        };
        await Settlement.findByIdAndUpdate(originSettlement, settlementUpdate);

        await questsToPlot(savedQuests, plotId); // Pass savedQuests instead of quests

        console.log("Saved Quests to be returned:", savedQuests);
        return savedQuests;
    } catch (e) {
        throw new Error('Failed to save quests: ' + e.message);
    }
};

// Function to add one or more quests to the Plot collection
const questsToPlot = async (quests, plotId) => {
    try {
        // Ensure quests is an array
        if (!Array.isArray(quests)) {
            throw new Error('Invalid quests input: Expected an array of quests');
        }

        const updatedPlot = await Plot.findByIdAndUpdate(
            plotId,
            { $push: { quests: { $each: quests.map(quest => ({
                quest: quest._id,
                questTitle: quest.questTitle,
                questStatus: quest.status
            })) } } },
            { new: true }
        );
        return updatedPlot;
    } catch (e) {
        throw new Error('Failed to add quests to plot: ' + e.message);
    }
};

module.exports = { saveQuests, questsToPlot };