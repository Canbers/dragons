const mongoose = require('mongoose');
const Ecosystem = require('../models/Ecosystem')
const Region = require('../../agents/world/factories/regionsFactory')
const World = require('../models/World')


mongoose.connect('mongodb://127.0.0.1:27017/dragons')
    .then(async () => {
        console.log('Connected!!');
        
        let worldResult = await World.create({
            name: 'World-1'
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
            }
        ]
        let ecoResult = await Ecosystem.insertMany(ecosystems);
        await Region.create(worldResult._id, [0,0]);

        process.exit();
    }
    
    );
