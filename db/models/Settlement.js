const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const Settlement = new Schema(
    {
        name: {
            type: String,
            required: true,
        },
        region: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Region'
        },
        coordinates: {
            type: [[Number]], // Change to an array of coordinate arrays
            required: true,
        },
        size: {
            type: String,
            enum: ['small', 'medium', 'large'],
            default: 'small',
            required: true
        },
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
        described: {
            type: Boolean,
            default: false
        },
        description: String,
        short: String,
        image: String
    }
);

Settlement.index({
    name: 1,
    region: 1,
    coordinates: 1,
}, {
    unique: true
});

module.exports = mongoose.model('Settlement', Settlement);
