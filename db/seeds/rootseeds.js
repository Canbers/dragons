require('dotenv').config()
const mongoose = require('mongoose');
const Ecosystem = require('../models/Ecosystem')
const Region = require('../../agents/world/factories/regionsFactory')
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
        // let regResult = await Region.create({
        //     name: 'Scandanavia',
        //     ecosystem: ecoResult[0]._id,
        //     world: worldResult._id
        // });
        Region.create(worldResult._id, [0,0])
    }
    
    );
