const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const Character = new Schema({
    name: {
        type: String,
        required: true
    },
    age: {
        type: Number,
        required: true
    },
    race: {
        type: String,
        required: true
    },
    class: {
        type: String,
        required: true
    },
    stats: {
        strength: {
            type: Number,
            default: 10
        },
        intelligence: {
            type: Number,
            default: 10
        },
        agility: {
            type: Number,
            default: 10
        }
    },
    currentStatus: {
        health: {
            type: Number,
            default: 100
        },
        mana: {
            type: Number,
            default: 0
        },
        location: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Settlement'
        },
        statusEffects: [String]
    },
    originLocation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Settlement'
    },
    inventory: [{
        itemName: String,
        quantity: Number
    }],
    plot: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Plot'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Character', Character);
