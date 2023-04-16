const Settlement = require('../../../db/models/Settlement');

const create = (region, count = 1) => {

    return new Promise( async (resolve, reject) => {
        const settlements = [];

        for (let i = 0; i < count; i++) {
            settlements.push({
                name: `Settlement ${i + 1}`,
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
    const buffer = 2;
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

const describe = (settlment) => {

}

module.exports = { create, describe };
