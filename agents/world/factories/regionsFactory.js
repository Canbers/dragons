const mongoose = require('mongoose');
const Ecosystem = require('../../../db/models/Ecosystem');
const Region = require('../../../db/models/Region');
const settlement = require('./settlementsFactory')
const {uuid} = require('uuidv4')
const create = (world, coordinates) => {

    return new Promise(async (resolve, reject) => {
        // Need to determine which ecosystem
    let ecosystems = await Ecosystem.find({
        world: world,
    })
    let ecosystem = ecosystems[Math.floor(Math.random()*ecosystems.length)];
    
    let region = await Region.create({
        name: uuid(),
        coordinates: coordinates,
        ecosystem: ecosystem._id,
        world: world
    })
    // Number of settlements and size
    let settlementCount = Math.floor(Math.random()*4) + 1;
    await settlement.create(region, settlementCount);
    resolve(region);
    // FUTURE: Reference neighboring regions (i.e coastline continuity)
    })
}

const describe = (region) => {

}

module.exports = {
    create,
    describe
}