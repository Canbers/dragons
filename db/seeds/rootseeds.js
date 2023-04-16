require('dotenv').config()
const mongoose = require('mongoose');
const Ecosystem = require('../models/Ecosystem')
const regionFactory = require('../../agents/world/factories/regionsFactory')
const World = require('../models/World')


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
        let regionResults = await regionFactory.create(worldResult._id, [0,0]);

        await regionFactory.describe(regionResults._id);

        process.exit();
    }
    
    );
