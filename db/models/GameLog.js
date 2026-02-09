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
    messageType: {
        type: String,
        enum: ['normal', 'quick_action', 'world_reaction', 'summary'],
        default: 'normal'
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
        type: { type: String },
        description: String
    }],
    skillCheck: {
        action: String,
        type: { type: String },
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

GameLogSchema.index({ plotId: 1 });

module.exports = mongoose.model('GameLog', GameLogSchema);
