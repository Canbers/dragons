const Region = require('../../db/models/Region');
const Settlement = require('../../db/models/Settlement');
const Plot = require('../../db/models/Plot');
const Quest = require('../../db/models/Quest');
const noteTaker = require('../world/noteTaker');
const gpt = require('../../services/gptService');

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
            You are designing a quest for an "Indifferent World" RPG - a world that exists independently of the player, where actions have real consequences.

            Quest Context:
            - Title: ${questTitle}
            - Description: ${description}
            - Region: ${regionName} - ${regionDescription}
            - Settlement: ${primaryLocation} - ${settlementDescription}

            Design Philosophy:
            - The quest exists because NPCs have their own problems, not to serve the player
            - Multiple valid approaches exist (help, hinder, ignore, exploit)
            - Outcomes affect the world whether the player participates or not
            - NPCs have their own motivations that may conflict
            - "Good" choices may have bad consequences; "bad" choices may have good ones

            Generate a JSON object:
            {
                "questTitle": "${questTitle}", 
                "description": "${description}",
                "triggers": {
                    "conditions": ["<How does the player learn of this?>", "<What draws attention to this problem?>"]
                },
                "keyActors": {
                    "primary": [
                        { "name": "<NPC name>", "role": "<Their stake in this>", "motivation": "<What they really want>" }
                    ],
                    "secondary": [
                        { "name": "<NPC name>", "role": "<Their involvement>", "motivation": "<Their angle>" }
                    ]
                },
                "locations": {
                    "primary": "<Where the main action happens>",
                    "secondary": ["<Related location>", "<Another related location>"]
                },
                "outcomes": [
                    { "type": "help_succeed", "description": "<If player helps and succeeds>" },
                    { "type": "help_fail", "description": "<If player helps but fails>" },
                    { "type": "ignore", "description": "<If player does nothing - quest resolves without them>" },
                    { "type": "exploit", "description": "<If player uses the situation for personal gain>" }
                ],
                "consequences": {
                    "immediate": "<What changes right after resolution>",
                    "longTerm": "<How the world remembers this>"
                }
            }
        `;
        
        const promptResult = await gpt.prompt('gpt-5-mini', prompt);
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
        const promptResult = await gpt.prompt('gpt-5-mini', `
            You are generating quest hooks for an "Indifferent World" RPG - a living world where things happen whether the player gets involved or not.

            Setting:
            - World: ${world.name}
            - Region: ${regionName} - ${regionDescription}
            - Settlement: ${settlementName} - ${settlementDescription}

            Generate 3 quest hooks that:
            1. Arise from local problems, conflicts, or opportunities that exist independently
            2. Have multiple possible approaches (not just "hero saves the day")
            3. Will resolve themselves (possibly badly) if the player ignores them
            4. Involve NPCs with their own agendas and motivations

            Avoid: chosen one narratives, world-ending threats, obvious good vs evil

            Format as JSON array:
            [
                { "questTitle": "<Short evocative title>", "description": "<2-3 sentences describing the situation, not the solution>" }
            ]
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

        // Generate quests using Indifferent World philosophy
        let promptResult = await gpt.prompt('gpt-5-mini', `Generate a quest hook for ${settlement.name} in ${region.name}. The quest should arise from local problems or conflicts, have multiple approaches, and will resolve itself if ignored. Format: { "questTitle": "<title>", "description": "<2-3 sentences>" }`);
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
        return await storyOptions(plotId);
    } catch (error) {
        console.error('Error getting initial quests:', error);
        throw error;
    }
}

module.exports = { storyOptions, getWorldAndRegionDetails, getInitialQuests };