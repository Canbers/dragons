const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const Region = new Schema(
    {
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
        short: String
}
);
Region.index({
    name: 1,
    world: 1,
    coordinates: 1
},
{
    unique: true
}
)
module.exports = mongoose.model('Region', Region);