const mongoose = require('mongoose');
const Ecosystem = require('../../../db/models/Ecosystem');
const Region = require('../../../db/models/Region');
const settlement = require('./settlementsFactory');
const {uuid} = require('uuidv4');
const gpt = require('../../../services/gptService');
const Settlement = require('../../../db/models/Settlement');

const create = (world, coordinates) => {
    return new Promise(async (resolve, reject) => {
        // Need to determine which ecosystem
        let ecosystems = await Ecosystem.find({
            world: world,
        });
        let ecosystem = ecosystems[Math.floor(Math.random() * ecosystems.length)];

        let region = await Region.create({
            name: uuid(),
            coordinates: coordinates,
            ecosystem: ecosystem._id,
            world: world,
            settlements: [],
        });
        // Number of settlements and size
        let settlementCount = Math.floor(Math.random() * 4) + 1;
        let newSettlements = await settlement.create(region, settlementCount);

        // Initialize settlements array
        let settlements = [];

        for (let i = 0; i < settlementCount; i++) {
            settlements.push(newSettlements[i]._id);
        }
        // Update the region's settlements array
        await Region.findByIdAndUpdate(region._id, { settlements: settlements });
        
        resolve(region);
        // FUTURE: Reference neighboring regions (i.e coastline continuity)
    });
};

const describe = (region_id) => {
    return new Promise( async (resolve, reject) => {
        let region = await Region.findOne({_id: region_id}).populate({path: 'ecosystem'}).populate({path: 'world'}).exec();
        console.log("Prompting GPT for Region description...");
        let promptResult = await gpt.prompt('gpt-3.5-turbo', `You are creating a region within the Dungeons & Dragons style world ${region.world.name}: ${region.world.description}. Please create a name and description for a region within this world which is located in the ${region.ecosystem.name}. Please format it in JSON as follow: { "name": "<The name of the region>", "description": "<The long, two paragraph description of the region>", "short": "<A short, two sentance summary of the description>"}`);
        try {
            console.log("Parsing Region Description...");
            let p = JSON.parse(promptResult.content);
            await Region.findByIdAndUpdate(region_id, { described: true,... p});
            // Describe settlements in region
            let settlements = await Settlement.find({region: region_id});
            await settlement.describe(settlements.map((settlement) => {return settlement.id}));
            resolve();
        } catch (e) {
            reject(e)
        }
    });
}

module.exports = {
    create,
    describe
}