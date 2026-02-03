const World = require('../../../db/models/World');
const Ecosystem = require('../../../db/models/Ecosystem');
const Region = require('../../../db/models/Region');
const regionFactory = require('./regionsFactory');
const vectorService = require('../../../services/vectorService');
const { prompt } = require('../../../services/gptService');

async function generateWorld(worldName) {
    const worldMessage = `Generate a unique description for an "Indifferent World" fantasy setting called "${worldName}".

This is a world that:
- Exists independently of any "chosen one" or hero
- Has ongoing conflicts, power struggles, and problems
- Contains factions with competing interests
- Rewards clever players and punishes foolish ones
- Feels lived-in, with history and consequence

Create a 2-3 sentence evocative description that hints at the world's character without spelling everything out.

Respond in JSON: {"description": "your description"}`;

    let worldResponse = await prompt("gpt-5-mini", worldMessage);

    let worldDescription = JSON.parse(worldResponse.content).description;

    let worldResult = await World.create({
        name: worldName,
        description: worldDescription
    });

    let ecosystems = [
        { name: 'Desert', world: worldResult._id },
        { name: 'Forest', world: worldResult._id },
        { name: "Plains", world: worldResult._id },
        { name: "Coastal", world: worldResult._id },
        { name: "Marsh", world: worldResult._id },
        { name: "Mountains", world: worldResult._id }
    ];
    await Ecosystem.insertMany(ecosystems);

    let originRegion = await regionFactory.create(worldResult._id, [0, 0]);

    let surroundingRegions = vectorService.getSurroundingVectors([0, 0]);
    for (let i = 0; i < surroundingRegions.length; i++) {
        await regionFactory.create(worldResult._id, surroundingRegions[i]);
    }

    if (!originRegion.described) {
        await regionFactory.describe(originRegion._id);
    }
    for (let i = 0; i < surroundingRegions.length; i++) {
        let region = await Region.findOne({ world: worldResult._id, coordinates: surroundingRegions[i] });
        if (region && !region.described) {
            await regionFactory.describe(region._id);
        }
    }

    return worldResult;
}

module.exports = { generateWorld };
