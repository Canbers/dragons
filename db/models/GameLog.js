const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MessageSchema = new Schema({
    author: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    sceneEntities: {
        npcs: [String],
        objects: [String],
        features: [String],
        locations: [String],
        currentLocation: String
    },
    discoveries: [{
        name: String,
        type: String,
        description: String
    }],
    skillCheck: {
        action: String,
        type: String,
        difficulty: String,
        roll: Number,
        minPass: Number,
        strongPass: Number,
        result: String
    },
    questUpdates: [{
        questId: String,
        title: String,
        status: String
    }]
});

const GameLogSchema = new Schema({
    plotId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Plot',
        required: true
    },
    messages: [MessageSchema],
    summary: {
        type: String
    }
});

module.exports = mongoose.model('GameLog', GameLogSchema);
