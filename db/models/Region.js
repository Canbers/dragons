const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Region = new Schema({
    name: String,
    coordinates: {
        type: [Number],
        required: true,
    },
    ecosystem: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ecosystem'
    },
    world: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'World',
        required: true
    },
    described: {
        type: Boolean,
        default: false
    },
    description: String,
    short: String,
    settlements: Array,
    quests: [
        {
            quest: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Quest',
            },
            questTitle: {
                type: String,
            }
        },
    ],
    highLevelMap: {
        type: [[String]], // 2D array to store the map grid
        default: [[]]
    },
    map: {
        type: [[String]], // 2D array to store the map grid
        default: [[]]
    }
});

Region.index({
    name: 1,
    world: 1,
    coordinates: 1
}, {
    unique: true
});

module.exports = mongoose.model('Region', Region);
