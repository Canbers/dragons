const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const Quest = new Schema(
    {
        world: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'World',
            required: true
        },
        questTitle: {
            type: String,
        },
        description: {
            type: String
        },
        objectives: {
            type: Array
        },
        currentObjective: {
            type: String
        },
        status: {
            type: String,
            enum: ['Not started', 'Active - In progress', 'Not Active - In progress', 'Completed'],
            default: 'Not started',
        },
        originSettlement: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Settlement',
            required: true
        }
    }
);
module.exports = mongoose.model('Quest', Quest);