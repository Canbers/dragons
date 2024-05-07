
async function handlePlayerInput(inputText) {
    const gameLog = document.getElementById('game-log');
    const timestamp = new Date().toLocaleTimeString();
  
    gameLog.innerHTML += `
      <div class="message">
        <div class="author">Player:</div>
        <div class="userText">
          ${inputText}
          <span class="timestamp">${timestamp}</span>
        </div>
      </div>
    `;
    // Scroll to the bottom of the chat section
    gameLog.scrollTop = gameLog.scrollHeight;
  }

  function displayResponse(response) {
    const gameLog = document.getElementById('game-log');
    const timestamp = new Date().toLocaleTimeString();
    gameLog.innerHTML += `
      <div class="message">
        <div class="author">AI:</div>
        <div class="systemText">
        ${response.message}
          <span class="timestamp">${timestamp}</span>
        </div>
      </div>
    `;
    gameLog.scrollTop = gameLog.scrollHeight;
}
 
  document.addEventListener('DOMContentLoaded', () => {
    const inputField = document.getElementById('chat-box');
    const submitBtn = document.getElementById('submit-btn');
  
    inputField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitAction();
      }
    });
    
  
    submitBtn.addEventListener('click', submitAction);
  
    async function submitAction() {
      try {
        const inputText = inputField.value.trim();
        if (inputText) {
          handlePlayerInput(inputText); // Display player input
          const response = await fetch('/api/input', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ input: inputText })
          });
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} message: ${response.message}`);
          }
          const data = await response.json();
          displayResponse(data); // Display AI response
        }
      } catch (error) {
        console.error('Error while submitting action:', error);
        displayResponse({ description: `Error: ${error.message}` }); // Display error in game log
      } finally {
        inputField.value = ''; // Clear input field
      }
    }
  })

  async function fetchGameInfo(worldId) {
    try {
        const response = await fetch(`/api/game-info?worldId=${worldId}`);
        if (!response.ok) {
            throw new Error('Failed to fetch game info');
        }
        const plot = await response.json();
        displayGameInfo(plot);
    } catch (error) {
        console.error('Error fetching game info:', error);
    }
}

document.getElementById('start-game-btn').addEventListener('click', () => {
  // const worldId = 'worldId'; // This should be dynamically set based on game state
  // Temporarily hardcoding worldID to test returning Plot to front end  ----- DELETE THIS LATER!!!!!
  const worldId = '6639b942e2782d96faf0e704';
  fetchGameInfo(worldId);
});

async function fetchQuestDetails(questId) {
  try {
      const response = await fetch(`/api/quest-details?questId=${questId}`);
      if (!response.ok) {
          throw new Error('Failed to fetch quest details');
      }
      return await response.json();
  } catch (error) {
      console.error('Error fetching quest details:', error);
      return null; // Return null or handle as needed
  }
}

async function displayGameInfo(plot) {
  const questsTableContainer = document.getElementById('quests-table-container');
  let htmlContent = `
      <table>
          <thead>
              <tr>
                  <th>Quest</th>
                  <th>Description</th>
                  <th>Status</th>
              </tr>
          </thead>
          <tbody>`;

  if (Array.isArray(plot.quests)) {
    for (const quest of plot.quests) {
      const details = await fetchQuestDetails(quest._id);
      if (details) {
        htmlContent += `
            <tr>
                <td>${details.questTitle}</td>
                <td>${details.quest.description}</td>
                <td>${details.quest.status}</td>
            </tr>`;
      }
    }
  } else {
    console.error('plot.quests is not an array');
  }

  htmlContent += `</tbody></table>`;
  questsTableContainer.innerHTML = htmlContent;

  // Setup modal
  const modal = document.getElementById('quests-modal');
  const btn = document.getElementById('view-quests-btn');
  const span = document.getElementsByClassName('close')[0];

  btn.onclick = function() {
    modal.style.display = 'block';
  }

  span.onclick = function() {
    modal.style.display = 'none';
  }

  window.onclick = function(event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }
}