require('dotenv').config();
const mongoose = require('mongoose');
const Ecosystem = require('../models/Ecosystem');
const regionFactory = require('../../agents/world/factories/regionsFactory');
const storyTeller = require('../../agents/world/storyTeller.js');
const noteTaker = require('../../agents/world/noteTaker.js');
const World = require('../models/World');
const Plot = require('../models/Plot');
const vectorService = require('../../services/vectorService');
const { prompt } = require('../../services/gptService');

mongoose.connect('mongodb://127.0.0.1:27017/dragons')
    .then(async () => {
        // Generate world name and description using GPT service
        const worldNameMessage = "Generate a unique fantasy world name for a Dungeons and Dragons style game. Respond in JSON with the format: {'worldName': 'name'}.";
        const worldDescriptionMessage = "Generate a description for a fantasy world filled with mystical beasts, brave knights, elves, and dwarves where adventure awaits behind every corner or tavern conversation. Please format it in a JSON.";

        try {
            let worldNameResponse = await prompt("gpt-3.5-turbo", worldNameMessage);
            let worldDescriptionResponse = await prompt("gpt-3.5-turbo", worldDescriptionMessage);

            console.log("World Name Response:", worldNameResponse);
            console.log("World Description Response:", worldDescriptionResponse);

            let worldName = JSON.parse(worldNameResponse.content).worldName;
            let worldDescription = JSON.parse(worldDescriptionResponse.content).description;

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
            let ecoResult = await Ecosystem.insertMany(ecosystems);
            let originRegion = await regionFactory.create(worldResult._id, [0,0]);

            let surroundingRegions = vectorService.getSurroundingVectors([0,0]);
            for(let i = 0; i < surroundingRegions.length; i++) {
                await regionFactory.create(worldResult._id, surroundingRegions[i]);
            }
            await regionFactory.describe(originRegion._id);

            let plotId = await Plot.create({ world: worldResult._id });
            console.log(`Created plot ${plotId}`);

            // Generate 3 possible quests
            let quests = await storyTeller.storyOptions(originRegion._id, plotId);

            process.exit();
        } catch (error) {
            console.error("Error generating world name or description:", error);
        }
    });