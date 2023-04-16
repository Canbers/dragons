require('dotenv').config()
const mongoose = require('mongoose');
const Ecosystem = require('../models/Ecosystem');
const regionFactory = require('../../agents/world/factories/regionsFactory');
const World = require('../models/World');
const vectorService = require('../../services/vectorService')


mongoose.connect('mongodb://127.0.0.1:27017/dragons')
    .then(async () => {
        
        let worldResult = await World.create({
            name: 'Keldaria',
            description: 'A fictional fantasy world filled with mystical beasts, brave nights, elves and dwarves where adventure awaits behind every corner or tavern conversation.'
        })

        let ecosystems = [
            {
                name: 'Desert',
                world: worldResult._id
            },
            {
                name: 'Forest',
                world: worldResult._id
            },
            {
                name: "Plains",
                world: worldResult._id
            },
            {
                name: "Coastal",
                world: worldResult._id
            },
            {
                name: "Marsh",
                world: worldResult._id
            },
            {
                name: "Mountains",
                world: worldResult._id
            }
        ]
        let ecoResult = await Ecosystem.insertMany(ecosystems);
        let originRegion = await regionFactory.create(worldResult._id, [0,0]);

        let surroundingRegions = vectorService.getSurroundingVectors([0,0]);
        for(let i = 0; i < surroundingRegions.length; i++) {
            await regionFactory.create(worldResult._id, surroundingRegions[i]);
        }

        await regionFactory.describe(originRegion._id);

        process.exit();
    }
    
    );
