const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Location schema (places within a settlement)
// POIs are now stored in the standalone Poi collection (see db/models/Poi.js)
const LocationSchema = new Schema({
    name: { type: String, required: true },
    type: {
        type: String,
        enum: ['gate', 'market', 'tavern', 'temple', 'plaza', 'shop', 'residence',
               'landmark', 'dungeon', 'district', 'docks', 'barracks', 'palace', 'other'],
        default: 'other'
    },
    description: String,
    shortDescription: String,                  // One-liner for map tooltips
    coordinates: {                             // Relative position within settlement grid
        x: { type: Number, default: 0 },
        y: { type: Number, default: 0 }
    },
    connections: [{                            // What this location connects to
        locationName: String,                  // Name of connected location
        direction: {
            type: String,
            enum: ['north', 'south', 'east', 'west', 'northeast', 'northwest',
                   'southeast', 'southwest', 'up', 'down', 'inside', 'outside']
        },
        description: String,                   // "through the archway", "down the alley"
        distance: {
            type: String,
            enum: ['adjacent', 'close', 'far'],
            default: 'adjacent'
        }
    }],
    discovered: { type: Boolean, default: false },
    generated: { type: Boolean, default: false },  // Has AI described it in detail?
    isStartingLocation: { type: Boolean, default: false }
}, { _id: true });

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
        image: String,
        // NEW: Internal locations within the settlement
        locations: [LocationSchema],
        locationsGenerated: { type: Boolean, default: false },
        layoutComputed: { type: Boolean, default: false }
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
