const Settlement = require('../../../db/models/Settlement');
const { uuid } = require('uuidv4');
const gpt = require('../../../services/gptService');

const buffer = 5;

const create = (region, count = 1) => {

    return new Promise(async (resolve, reject) => {
        const settlements = [];

        for (let i = 0; i < count; i++) {
            settlements.push({
                id: uuid(),
                name: uuid(),
                region: region._id,
                size: getRandomSize(),
                coordinates: generateUniqueCoordinates(settlements),
            });
        }

        let commitedSettlments = await Settlement.insertMany(settlements)
        resolve(commitedSettlments);
    });
};

const getRandomSize = () => {
    const sizes = ['small', 'medium', 'large'];
    const randomIndex = Math.floor(Math.random() * sizes.length);
    return sizes[randomIndex];
};

const generateUniqueCoordinates = (settlements) => {
    const gridSize = 100;
    let coordinates;

    do {
        const x = getRandomInt(buffer, gridSize - buffer - 1);
        const y = getRandomInt(buffer, gridSize - buffer - 1);
        coordinates = [x, y];
    } while (
        settlements.some(
            (s) =>
                s.coordinates[0] >= coordinates[0] - buffer &&
                s.coordinates[0] <= coordinates[0] + buffer &&
                s.coordinates[1] >= coordinates[1] - buffer &&
                s.coordinates[1] <= coordinates[1] + buffer
        )
    );

    return coordinates;
};

const getRandomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const nameAndDescription = (settlement_id) => {
    return new Promise(async (resolve, reject) => {
        let settlement = await Settlement.findOne({ _id: settlement_id }).populate({ path: 'region', populate: { path: 'world' } }).exec();
        console.log("Prompting GPT for Settlement description...")
        let promptResult = await gpt.prompt('gpt-3.5-turbo', `You are managing a D&D style game in the world of ${settlement.region.world.name}: ${settlement.region.world.description}. Please create a setting for a part of the story which will take place in a ${settlement.size} settlement within the ${settlement.region.name} region. Include the name of the city where the story can take place and the name cannot be ${settlement.region.name}. Also include details about the inhabitants of the city and what kind of political and cultural influences we can expect there. Please format it in JSON as follow: { "name": "<The name of the city>", "description": "<The long, two paragraph description of the setting>", "short": "<A short, two sentance summary of the description>" }`);
        resolve(promptResult);
    });
}

// Settlments MUST be an array. If you only want to describe
// a single settlement then just use an array of one.
const describe = (settlements) => {
    return new Promise(async (resolve, reject) => {
        if(!Array.isArray(settlements)) return reject('Describe only takes arrays');
        let described_settlements = [];
        let failThreshold = 10;
        let failCount = 0;
        let count = 0;
        console.log(`There are ${settlements.length} settlements in the starting region`);
        do {
            try {
                let details = await nameAndDescription(settlements[count]);
                console.log('Parsing settlement details...');
                let p = JSON.parse(details.content);
                // let icon = await gpt.createImage({
                //     prompt: `An RPG videogame style map of the following settlement: ${p.short}`,
                //     n: 1,
                //     size: "1024x1024",
                // });
                await Settlement.findByIdAndUpdate(settlements[count], {
                //  image: icon.data[0].url,
                    described: true,
                    ...p
                });
                count++;
            } catch (e) {
                failCount++;
                if (failCount > failThreshold) {
                    console.log(`We have failed more than 10 time for settlement ${settlements[count]}. Moving on.`);
                    failCount = 0;
                    count++;
                }
            }
        } while (count < settlements.length);
        resolve();
    });
}

module.exports = { create, describe };
