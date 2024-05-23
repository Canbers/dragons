const fetch = require('node-fetch');
const https = require('https');
const { prompt } = require('../services/gptService');

const agent = new https.Agent({
    rejectUnauthorized: false // This allows self-signed certificates
});

const getRecentMessages = async (plotId, limit = 20, cookies) => {
    if (!plotId) {
        throw new Error('plotId is undefined');
    }
    const url = `https://localhost:3000/api/game-logs/recent/${plotId}?limit=${limit}`;
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

const interpret = async (input, actionType, plotId, cookies) => {
    try {
        console.log(`Interpreting input for plotId: ${plotId}, actionType: ${actionType}, input: ${input}`);
        const recentMessages = await getRecentMessages(plotId, 20, cookies);
        const context = recentMessages.map(msg => ({ role: msg.author === 'Player' ? 'user' : 'assistant', content: msg.content }));
        const contextString = context.map(c => `${c.role}: ${c.content}`).join('\n');

        let response;
        switch (actionType) {
            case 'action':
                response = await handleAction(input, contextString);
                break;
            case 'speak':
                response = await handleSay(input, contextString);
                break;
            case 'askGM':
                response = await handleAskGM(input, contextString);
                break;
            default:
                response = await badInput();
        }
        return { message: response };
    } catch (error) {
        console.error('Error handling input:', error);
        return { message: "Failed to generate response" };
    }
};

const handleAction = async (input, context) => {
    const message = `Immediate context: \n${context}\n Now the player wants to perform an action: "${input}". Respond in JSON format {"success": boolean, "outcome": "result of action", "feedback": "additional feedback"}.`;
    try {
        const response = await prompt("gpt-3.5-turbo", message);
        const parsedResponse = JSON.parse(response.content);
        return parsedResponse;
    } catch (error) {
        console.error('Error in handleAction:', error);
        return { success: false, outcome: "Error handling action", feedback: error.message };
    }
};

const handleSay = async (input, context) => {
    const message = `Immediate context: \n${context}\n Now the player says: "${input}". Generate a dialogue response for the character. Respond in JSON format {"response": "dialogue response"}.`;
    try {
        const response = await prompt("gpt-3.5-turbo", message);
        const parsedResponse = JSON.parse(response.content);
        return parsedResponse;
    } catch (error) {
        console.error('Error in handleSay:', error);
        return { response: "Error handling speech" };
    }
};

const handleAskGM = async (input, context) => {
    const message = `Immediate context: \n${context}\n Now the player asks the Game Master: "${input}". Provide the necessary information. Respond in JSON format {"response": "GM response"}.`;
    try {
        const response = await prompt("gpt-3.5-turbo", message);
        const parsedResponse = JSON.parse(response.content);
        return parsedResponse;
    } catch (error) {
        console.error('Error in handleAskGM:', error);
        return { response: "Error handling GM query" };
    }
};

const badInput = async () => {
    return { response: "Invalid action" };
};

module.exports = { interpret, handleAction, handleSay, handleAskGM, badInput };
