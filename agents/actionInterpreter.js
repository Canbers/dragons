const fetch = require('node-fetch');
const https = require('https');
const Plot = require('../db/models/Plot');
const Region = require('../db/models/Region');
const Settlement = require('../db/models/Settlement');
const regionFactory = require('../agents/world/factories/regionsFactory');
const { prompt } = require('../services/gptService');

// Load environment variables
require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || 'https://localhost:3000';

const agent = new https.Agent({
    rejectUnauthorized: false // This allows self-signed certificates
});

const getRecentMessages = async (plotId, limit = 20, cookies) => {
    if (!plotId) {
        throw new Error('plotId is undefined');
    }
    const url = `${API_BASE_URL}/api/game-logs/recent/${plotId}?limit=${limit}`;
    try {
        const response = await fetch(url, { 
            method: 'GET', 
            headers: { 
                'Content-Type': 'application/json',
                'Cookie': cookies 
            }, 
            agent 
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.messages;
    } catch (error) {
        console.error(`Error fetching recent messages: ${error.message}`);
        throw error;
    }
};

const ensureDescription = async (regionId, settlementId) => {
    const region = await Region.findById(regionId);
    if (!region.described) {
        await regionFactory.describe(regionId);
    }
    if (settlementId) {
        const settlement = await Settlement.findById(settlementId);
        if (!settlement.described) {
            await regionFactory.describeSettlements(regionId);
        }
    }
};

const interpret = async (input, inputType, plotId, cookies) => {
    try {
        const recentMessages = await getRecentMessages(plotId, 20, cookies);
        let plot = await Plot.findById(plotId)
            .populate('current_state.current_location.region')
            .populate('current_state.current_location.settlement');

        // Ensure region and settlement are described
        if (plot.current_state.current_location.region._id) {
            await ensureDescription(plot.current_state.current_location.region._id, plot.current_state.current_location.settlement?._id);
        }

        const context = recentMessages.map(msg => ({
            role: msg.author === 'Player' ? 'user' : 'assistant',
            content: msg.content
        }));

        const currentStateContext = `
            Activity: ${plot.current_state.current_activity || 'unknown'}, 
            Location: ${plot.current_state.current_location.description || (plot.current_state.current_location.settlement ? plot.current_state.current_location.settlement.name : plot.current_state.current_location.region ? plot.current_state.current_location.region.name : 'unknown')}, 
            Time: ${plot.current_state.current_time || 'unknown'}, 
            Conditions: ${plot.current_state.environment_conditions || 'unknown'}, 
            Mood: ${plot.current_state.mood_tone || 'unknown'}
        `;

        const contextString = `Current State: ${currentStateContext.trim().replace(/\s+/g, ' ')}. Recent Game Log: ${context.map(c => `${c.role}: ${c.content}`).join('\n')}`;

        let response;
        switch (inputType) {
            case 'action':
                response = await handleAction(input, contextString);
                break;
            /* ADD THIS BACK IN WHEN YOU WANT TO HANDLE TRAVLE AGAIN
                const actionTypeResponse = await actionType(input, context);
                if (actionTypeResponse.travel) {
                    response = await handleTravel(input, contextString, plot);
                } else {
                    response = await handleAction(input, contextString);
                }
                break;
                */
            case 'speak':
                response = await handleSay(input, contextString);
                break;
            case 'askGM':
                response = await handleAskGM(input, contextString);
                break;
            default:
                response = await badInput();
        }

        if (response.stateChangeRequired) {
            await updateCurrentState(plot, input, response);
        }

        return { message: response };
    } catch (error) {
        console.error('Error handling input:', error);
        return { message: "Failed to generate response" };
    }
};

// Determine if the action involves travel
/*  VERY PROBLEMATIC ---------- NEED TO FIGURE OUT BETTER METHOD OF TRAVELING
const actionType = async (input, context) => {
    const message = `Recent game log: ${context}. Player action: "${input}". Is the player trying to travel a long distance from their current location? Respond with JSON {"travel": boolean}`;
    try {
        const response = await prompt("gpt-4o-mini", message);
        const parsedResponse = JSON.parse(response.content);
        return parsedResponse;
    } catch (error) {
        console.error('Error in actionType:', error);
        return { travel: false }; // Default to false in case of an error
    }
};
*/

// Handle non-travel actions
const handleAction = async (input, context) => {
    const message = `${context}\nPlayer action: "${input}".\nGenerate the result in JSON format: {"success": boolean, "outcome": "result of action", "stateChangeRequired": boolean}. Set "stateChangeRequired" to true only if the result of the action significantly changes the activity, location, time, conditions, or mood.`;
    try {
        const response = await prompt("gpt-4o-mini", message);
        const parsedResponse = JSON.parse(response.content);
        return parsedResponse;
    } catch (error) {
        console.error('Error in handleAction:', error);
        return { success: false, outcome: "Error handling action", feedback: error.message, stateChangeRequired: false };
    }
};

// Handle travel actions
const handleTravel = async (input, context, plot) => {
    try {
        // Check if plot and its properties are defined
        if (!plot || !plot.current_state || !plot.current_state.current_location) {
            throw new Error('Plot current state or location is not defined');
        }

        // Fetch the current coordinates and region map
        const currentCoords = plot.current_state.current_location.coordinates;
        if (!currentCoords) {
            throw new Error('Current coordinates are not defined');
        }

        const regionId = plot.current_state.current_location.region;
        if (!regionId) {
            throw new Error('Region ID is not defined');
        }

        const region = await Region.findById(regionId);
        if (!region) {
            throw new Error('Region not found');
        }

        const map = region.map;
        if (!map) {
            throw new Error('Region map not found');
        }

        // Fetch settlements in the region
        const settlements = await Settlement.find({ region: regionId });

        // Determine the new coordinates based on input direction
        const newCoords = getNewCoordinates(currentCoords, input);
        console.log('Current Coordinates:', currentCoords);
        console.log('New Coordinates:', newCoords);

        // Fetch the tile type at the new coordinates
        const tileType = map[newCoords[1]] && map[newCoords[1]][newCoords[0]];
        if (!tileType) {
            return { success: false, outcome: "Cannot travel in that direction.", stateChangeRequired: false };
        }

        // Check if the new coordinates overlap with a settlement
        const settlement = settlements.find(s => 
            s.coordinates.some(coord => coord[0] === newCoords[0] && coord[1] === newCoords[1])
        );

        let travelMessage;
        if (settlement) {
            // If the player has traveled into a settlement, modify the travel message
            travelMessage = `Previous Context: ${context}\n The player is now in the settlement of ${settlement.name}. ${settlement.description}. Respond in JSON format: {"success": boolean, "outcome": "result of travel", "newLocation": "description of new location", "stateChangeRequired": true, "newCoords": [${newCoords}]}.`;
        } else {
            // Use the current travel message if the player is not in a settlement
            travelMessage = `Previous Context: ${context}\n The player has just traveled into a ${tileType} region. Describe the new location the player has traveled to and any interactions they have. Respond in JSON format: {"success": boolean, "outcome": "result of travel", "newLocation": "description of new location", "stateChangeRequired": true, "newCoords": [${newCoords}]}.`;
        }

        // Prompt the AI with the travel context
        const response = await prompt("gpt-4o-mini", travelMessage);
        const parsedResponse = JSON.parse(response.content);

        if (parsedResponse.success && parsedResponse.stateChangeRequired) {
            // Update the character's location and the plot's state with the new location
            await updateCurrentState(plot, input, parsedResponse);
        }

        return parsedResponse;
    } catch (error) {
        console.error('Error in handleTravel:', error);
        return { success: false, outcome: `Error handling travel: ${error.message}`, stateChangeRequired: false };
    }
};


// Calculate new coordinates based on direction
const getNewCoordinates = (currentCoords, direction) => {
    const [x, y] = currentCoords;
    const lowerDirection = direction.toLowerCase();

    if (lowerDirection.includes('north')) {
        return [x, y - 1];
    }
    if (lowerDirection.includes('south')) {
        return [x, y + 1];
    }
    if (lowerDirection.includes('east')) {
        return [x + 1, y];
    }
    if (lowerDirection.includes('west')) {
        return [x - 1, y];
    }

    console.log('direction of travel not confirmed');
    return currentCoords; // If no valid direction found, return the original coordinates
};

// Handle player dialogue actions
const handleSay = async (input, context) => {
    const message = `Current State: ${context}\nPlayer says: "${input}".\nGenerate a dialogue response for the character in JSON format: {"response": "dialogue response", "stateChangeRequired": boolean}. Set "stateChangeRequired" to true only if the dialogue significantly changes the activity, location, time, conditions, or mood.`;
    try {
        const response = await prompt("gpt-4o-mini", message);
        const parsedResponse = JSON.parse(response.content);
        return parsedResponse;
    } catch (error) {
        console.error('Error in handleSay:', error);
        return { response: "Error handling speech", stateChangeRequired: false };
    }
};

// Handle player questions to the GM
const handleAskGM = async (input, context) => {
    const message = `Current State: ${context}\nPlayer asks: "${input}".\nProvide the GM response in JSON format: {"response": "GM response", "stateChangeRequired": false}.`;
    try {
        const response = await prompt("gpt-4o-mini", message);
        const parsedResponse = JSON.parse(response.content);
        return parsedResponse;
    } catch (error) {
        console.error('Error in handleAskGM:', error);
        return { response: "Error handling GM query", stateChangeRequired: false };
    }
};

// Update the plot's current state
const updateCurrentState = async (plot, input, result) => {
    try {
        const newCoords = result.newCoords || plot.current_state.current_location.coordinates;
        const newLocationDescription = result.newLocation || plot.current_state.current_location.description;

        // Fetch the current region and settlements
        const region = await Region.findById(plot.current_state.current_location.region);
        const settlements = await Settlement.find({ region: region._id });

        // Determine if the new coordinates are within any settlement
        let newSettlement = null;
        for (const settlement of settlements) {
            if (settlement.coordinates.some(coord => coord[0] === newCoords[0] && coord[1] === newCoords[1])) {
                newSettlement = settlement;
                break;
            }
        }

        // Update the current location
        plot.current_state.current_location = {
            region: region._id,
            settlement: newSettlement ? newSettlement._id : null,
            coordinates: newCoords,
            description: newSettlement ? newSettlement.description : newLocationDescription
        };

        // Update other state details if provided
        const currentStateJSON = JSON.stringify(plot.current_state);
        const contextWithInput = `Current State: ${currentStateJSON}\nPlayer input: "${input}". Result: ${JSON.stringify(result)}`;
        const stateUpdateMessage = `Based on the following context: ${contextWithInput}, determine the updated current state. Provide a response in JSON format {"activity": "new activity", "location": "new location", "time": "new time", "conditions": "new conditions", "mood": "new mood"}. Possible values for activity: ["conversation", "exploring", "in combat", "resting", "traveling"]. conditions should be generalized things (e.g "raining", "sunny", "hot", "cold").`;
        const allowedActivities = ['conversation', 'exploring', 'in combat', 'resting', 'traveling'];

        const aiResponse = await prompt("gpt-4o-mini", stateUpdateMessage);
        const parsedResponse = JSON.parse(aiResponse.content);

        // Validate and update current activity
        if (allowedActivities.includes(parsedResponse.activity)) {
            plot.current_state.current_activity = parsedResponse.activity;
        } else {
            console.warn(`Invalid activity received: ${parsedResponse.activity}. Keeping the existing activity.`);
        }

        plot.current_state.current_location.description = parsedResponse.location || plot.current_state.current_location.description;
        plot.current_state.current_time = parsedResponse.time || plot.current_state.current_time;
        plot.current_state.environment_conditions = parsedResponse.conditions || plot.current_state.environment_conditions;
        plot.current_state.mood_tone = parsedResponse.mood || plot.current_state.mood_tone;

        await plot.save(); // Save updated plot state to the database
        console.log("Updated current state with new location and other details:", plot.current_state);
    } catch (error) {
        console.error('Error updating current state:', error);
    }
};


// Handle invalid actions
const badInput = async () => {
    return { response: "Invalid action" };
};

module.exports = { interpret, handleAction, handleSay, handleAskGM, badInput, handleTravel, getNewCoordinates };
