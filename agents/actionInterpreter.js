const { toolPrompt } = require('../services/gptService');

const interpret = async (input) => {
    try {
        const response = await toolPrompt("gpt-3.5-turbo", 
        "The player has submitted " + input + ". You need to call the appropriate function to handle the player prompt. If it is not a character action, speech, or game/world information request, call the badInput function.",
        [
            {
                "type": "function",
                "function": {
                    "name": "handleAction",
                    "description": "Determine the outcome of a player's action in a fantasy game setting",
                    "parameters": {
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "handleSay",
                    "description": "Generate a dialogue response for what the character is saying",
                    "parameters": {
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "handleAskGM",
                    "description": "Provide information as a game master about the player's request",
                    "parameters": {
                    }
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "badInput",
                    "description": "The player has submitted an invalid action",
                    "parameters": {
                    }
                }
        }
        ]
        );
        console.log("actionInterpreter response: " + JSON.stringify(response));
        const toolCall = response.tool_calls[0].function.name;
        if (response.tool_calls) {
            const availableFunctions = {
                handleAction: handleAction,
                handleSay: handleSay,
                handleAskGM: handleAskGM,
                badInput: badInput
            };
            const chosenFunction = availableFunctions[toolCall];
            if (chosenFunction) {
                const functionResponse = await chosenFunction();
                console.log("functionResponse within actionInterpreter: " + functionResponse);
                return { message: functionResponse };
            } else {
                console.error('Error: Function not found');
                return { message: "Error: Function not found" };
            }
        }
        else{
            return { message: "Error: No function call" };
        }
    } catch (error) {
        console.error('Error calling OpenAI through gptService:', error);
        return { message: "Failed to generate response" };
    }
};



const handleAction = async () => {
    return "handleAction function called";
};

const handleSay = async () => {
    return "handleSay function called";
};

const handleAskGM = async () => {
    return "handleAskGM function called";
};

const badInput = async () => {
    return "badInput function called";
};

module.exports = { interpret, handleAction, handleSay, handleAskGM, badInput };

