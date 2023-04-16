const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const Settlement = new Schema(
    {
        name: {
            type: String,
            required: true,
        },
        region: ObjectId,
        coordinates: {
            type: [Number],
            required: true,
        },
        size: {
            type: String,
            enum: ['small', 'medium', 'large'],
            default: 'small',
            required: true
        },
        described: {
            type: Boolean,
            default: false
        },
        description: String
    }
);
Settlement.index({
    name: 1,
    region: 1,
    coordinates: 1,
},
{
    unique: true
}
)
module.exports = mongoose.model('Settlement', Settlement);