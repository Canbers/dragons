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
    }
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
