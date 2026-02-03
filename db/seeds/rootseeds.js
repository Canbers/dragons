require('dotenv').config();
const mongoose = require('mongoose');
const Ecosystem = require('../models/Ecosystem');
const regionFactory = require('../../agents/world/factories/regionsFactory');
const storyTeller = require('../../agents/world/storyTeller.js');
const World = require('../models/World');
const Plot = require('../models/Plot');
const Region = require('../models/Region'); // Ensure Region is properly imported
const vectorService = require('../../services/vectorService');
const { prompt } = require('../../services/gptService');

mongoose.connect('mongodb://127.0.0.1:27017/dragons')
    .then(async () => {
        // Generate world name and description using GPT service
        const worldMessage = "Generate a unique fantasy world name and description for a Dungeons and Dragons style game. Respond in JSON with the format: {'worldName': 'name', 'description': 'description'}.";

        try {
            let worldResponse = await prompt("gpt-5-mini", worldMessage);

            console.log("World Name Response:", worldResponse);

            let worldName = JSON.parse(worldResponse.content).worldName;
            let worldDescription = JSON.parse(worldResponse.content).description;

            let worldResult = await World.create({
                name: worldName,
                description: worldDescription
            });

            console.log(worldResult);

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

            // Describe the current region and its neighbors
            if (!originRegion.described) {
                await regionFactory.describe(originRegion._id);
            }
            for (let i = 0; i < surroundingRegions.length; i++) {
                let region = await Region.findOne({ world: worldResult._id, coordinates: surroundingRegions[i] });
                if (region && !region.described) {
                    await regionFactory.describe(region._id);
                }
            }

            let plotId = await Plot.create({ world: worldResult._id });
            console.log(`Created plot ${plotId}`);

            // Generate 3 possible quests for the starting region
            let quests = await storyTeller.storyOptions(originRegion._id, plotId);

            process.exit();
        } catch (error) {
            console.error("Error generating world name or description:", error);
        }
    });
