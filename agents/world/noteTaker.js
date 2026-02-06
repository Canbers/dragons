const Region = require('../../db/models/Region');
const Settlement = require('../../db/models/Settlement');
const Plot = require('../../db/models/Plot');
const Quest = require('../../db/models/Quest');

// Function to save one or multiple quests to the Quest collection
const saveQuests = async (quests, region, originSettlement, plotId) => {
    try {
        if (quests.quests && Array.isArray(quests.quests)) {
            quests = quests.quests;
        } else if (!Array.isArray(quests)) {
            quests = [quests]; // Convert single quest to an array if it's not an array
        }

        const questsToSave = quests.map(quest => ({
            insertOne: {
                document: {
                    world: region.world._id,
                    questTitle: quest.questTitle,
                    description: quest.description,
                    objectives: quest.objectives || [], // Initialize objectives
                    currentObjective: quest.currentObjective || '',
                    status: 'Not started',
                    triggers: quest.triggers || { conditions: [] },
                    keyActors: quest.keyActors || { primary: [], secondary: [] },
                    locations: quest.locations || { 
                        primary: originSettlement ? originSettlement.name : '', // Use originSettlement name as primary location
                        secondary: []
                    },
                    outcomes: quest.outcomes || [],
                    consequences: quest.consequences || { immediate: '', longTerm: '' }
                }
            }
        }));

        const result = await Quest.bulkWrite(questsToSave);
        const savedQuests = quests.map((quest, index) => ({
            _id: result.insertedIds[index],
            questTitle: quest.questTitle,
            status: 'Not started'
        }));

        if (!Array.isArray(savedQuests)) {
            throw new Error('Failed to construct savedQuests array');
        }

        const regionUpdate = {
            $push: { quests: { $each: savedQuests.map(quest => ({ quest: quest._id, questTitle: quest.questTitle })) } }
        };
        await Region.findByIdAndUpdate(region._id, regionUpdate);

        const settlementUpdate = {
            $push: { quests: { $each: savedQuests.map(quest => ({ quest: quest._id, questTitle: quest.questTitle })) } }
        };
        await Settlement.findByIdAndUpdate(originSettlement, settlementUpdate);

        await questsToPlot(savedQuests, plotId);

        console.log("Saved Quests to be returned:", savedQuests);
        return savedQuests;
    } catch (e) {
        throw new Error('Failed to save quests: ' + e.message);
    }
};

// Function to add one or more quests to the Plot collection
const questsToPlot = async (quests, plotId) => {
    try {
        if (!Array.isArray(quests)) {
            throw new Error('Invalid quests input: Expected an array of quests');
        }

        const updatedPlot = await Plot.findByIdAndUpdate(
            plotId,
            { $push: { quests: { $each: quests.map(quest => ({
                quest: quest._id,
                questTitle: quest.questTitle,
                questStatus: quest.status,
                notes: [] // Initialize notes as an empty array
            })) } } },
            { new: true }
        );
        return updatedPlot;
    } catch (e) {
        throw new Error('Failed to add quests to plot: ' + e.message);
    }
};

module.exports = { saveQuests };
