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
        triggers: {
            conditions: [
                {
                    type: String
                }
            ]
        },
        keyActors: {
            primary: [
                {
                    name: { type: String },
                    role: { type: String }
                }
            ],
            secondary: [
                {
                    name: { type: String },
                    role: { type: String }
                }
            ]
        },
        locations: {
            primary: {
                type: String,
                coordinates: {
                    type: [[Number]]
                }
            },
            secondary: [
                {
                    type: String,
                    coordinates: {
                        type: [[Number]]
                    }
                }
            ]
        },
        outcomes: [
            {
                type: { type: String },
                description: { type: String }
            }
        ],
        consequences: {
            immediate: { type: String },
            longTerm: { type: String }
        }
    }
);

module.exports = mongoose.model('Quest', Quest);
