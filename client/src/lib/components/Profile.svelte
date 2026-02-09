<script>
  import { onMount } from 'svelte';
  import { authenticated, user } from '../stores/authStore.js';
  import * as api from '../services/api.js';

  let { navigateTo } = $props();

  // Character list
  let characters = $state([]);
  let loading = $state(false);

  // Dropdown
  let createDropdownOpen = $state(false);

  // Modal state
  let activeModal = $state(null); // 'join-game' | 'new-plot' | 'new-world' | 'character-creator' | 'region-selection'

  // Join game
  let plotIdInput = $state('');
  let plotIdError = $state(false);

  // New plot (existing world)
  let worlds = $state([]);
  let selectedWorldId = $state('');
  let worldDescription = $state('');

  // New world
  let newWorldName = $state('');

  // Region selection
  let regions = $state([]);
  let regionHooks = $state({});
  let regionsLoading = $state(false);

  // Character creator
  let pendingPlotId = $state(null);
  let charName = $state('');
  let charAge = $state('');
  let charRace = $state('');
  let charClass = $state('');

  // Ecosystem colors
  const ecosystemColors = {
    'forest': '#2E8B57', 'desert': '#D2691E', 'mountain': '#708090',
    'plains': '#6B8E23', 'grassland': '#6B8E23', 'tundra': '#B0C4DE',
    'swamp': '#556B2F', 'marsh': '#556B2F', 'coastal': '#4682B4',
    'volcanic': '#8B0000', 'jungle': '#228B22', 'arctic': '#E0FFFF'
  };

  function assignBaseStats(race, cls) {
    const baseStats = {
      Human: { strength: 10, intelligence: 10, agility: 10 },
      Elf: { strength: 8, intelligence: 12, agility: 10 },
      Dwarf: { strength: 12, intelligence: 8, agility: 10 },
    };
    const classModifiers = {
      Warrior: { strength: 2, intelligence: 0, agility: 1 },
      Mage: { strength: 0, intelligence: 3, agility: 0 },
      Rogue: { strength: 1, intelligence: 0, agility: 2 },
    };
    const r = baseStats[race] || { strength: 10, intelligence: 10, agility: 10 };
    const c = classModifiers[cls] || { strength: 0, intelligence: 0, agility: 0 };
    return {
      strength: r.strength + c.strength,
      intelligence: r.intelligence + c.intelligence,
      agility: r.agility + c.agility,
    };
  }

  function getEcosystemColor(ecosystemName) {
    const lower = (ecosystemName || '').toLowerCase();
    const match = Object.entries(ecosystemColors).find(([key]) => lower.includes(key));
    return match ? match[1] : '#6366f1';
  }

  function closeModal() {
    activeModal = null;
    plotIdError = false;
  }

  function closeDropdown() {
    createDropdownOpen = false;
  }

  // Fetch characters on mount
  onMount(() => {
    fetchCharacters();
  });

  async function fetchCharacters() {
    loading = true;
    try {
      characters = await api.getCharacters() || [];
    } catch (e) {
      console.error('Error fetching characters:', e);
    }
    loading = false;
  }

  function selectCharacter(plotId, characterId) {
    if (plotId && plotId !== 'undefined' && characterId && characterId !== 'undefined') {
      navigateTo('game', { plotId, characterId });
    } else {
      alert('Invalid plot ID or character ID');
    }
  }

  async function deleteCharacter(id, name) {
    const confirmed = confirm(
      `DELETE CHARACTER: ${name}\n\n` +
      `This action CANNOT be undone.\n` +
      `All story progress for this character will be permanently lost.\n\n` +
      `Are you absolutely sure you want to delete this character?`
    );
    if (!confirmed) return;

    loading = true;
    try {
      await api.deleteCharacter(id);
      await fetchCharacters();
    } catch (e) {
      alert('Error deleting character. Please try again.');
      console.error('Error deleting character:', e);
    }
    loading = false;
  }

  // === Join Existing Game ===
  function openJoinGame() {
    closeDropdown();
    plotIdInput = '';
    plotIdError = false;
    activeModal = 'join-game';
  }

  async function validatePlotId() {
    loading = true;
    try {
      await api.getPlot(plotIdInput);
      closeModal();
      openCharacterCreator(plotIdInput);
    } catch {
      plotIdError = true;
    }
    loading = false;
  }

  // === New Plot in Existing World ===
  async function openNewPlot() {
    closeDropdown();
    selectedWorldId = '';
    worldDescription = '';
    activeModal = 'new-plot';
    loading = true;
    try {
      worlds = await api.getWorlds() || [];
      if (worlds.length > 0) {
        selectedWorldId = worlds[0]._id;
        await loadWorldDescription(selectedWorldId);
      }
    } catch (e) {
      console.error('Error fetching worlds:', e);
    }
    loading = false;
  }

  async function loadWorldDescription(worldId) {
    if (!worldId) return;
    try {
      const world = await api.getWorld(worldId);
      worldDescription = world?.description || '';
    } catch {
      worldDescription = '';
    }
  }

  async function handleWorldChange() {
    await loadWorldDescription(selectedWorldId);
  }

  async function selectWorldForPlot() {
    closeModal();
    await openRegionSelection(selectedWorldId);
  }

  // === Create New World ===
  function openNewWorld() {
    closeDropdown();
    newWorldName = '';
    activeModal = 'new-world';
  }

  async function generateNewWorld() {
    loading = true;
    try {
      const newWorld = await api.createWorld(newWorldName);
      closeModal();
      await openRegionSelection(newWorld._id);
    } catch (e) {
      console.error('Error generating world:', e);
    }
    loading = false;
  }

  // === Region Selection ===
  async function openRegionSelection(worldId) {
    regions = [];
    regionHooks = {};
    regionsLoading = true;
    activeModal = 'region-selection';

    try {
      regions = await api.getRegions(worldId) || [];
      regionsLoading = false;

      // Fetch hooks async in background
      api.getRegionHooks(worldId)
        .then(hooks => { regionHooks = hooks || {}; })
        .catch(() => { /* hooks failed — silent */ });
    } catch (e) {
      regionsLoading = false;
      console.error('Error loading regions:', e);
    }

    // Store worldId for region click handler
    regions._worldId = worldId;
  }

  async function selectRegion(region) {
    const worldId = regions._worldId;
    closeModal();
    loading = true;
    try {
      const plot = await api.createPlot(worldId, region._id);
      openCharacterCreator(plot._id);
    } catch (e) {
      console.error('Error creating plot:', e);
    }
    loading = false;
  }

  // === Character Creator ===
  function openCharacterCreator(plotId) {
    pendingPlotId = plotId;
    charName = '';
    charAge = '';
    charRace = '';
    charClass = '';
    activeModal = 'character-creator';
  }

  async function createCharacter() {
    const data = {
      name: charName,
      age: parseInt(charAge, 10),
      race: charRace,
      class: charClass,
      plot: pendingPlotId,
      stats: assignBaseStats(charRace, charClass),
    };
    loading = true;
    try {
      const newChar = await api.createCharacter(data);
      await api.assignCharacter(newChar._id, pendingPlotId);
      closeModal();
      navigateTo('game', { plotId: pendingPlotId, characterId: newChar._id });
    } catch (e) {
      console.error('Error creating character:', e);
    }
    loading = false;
  }

  // Close dropdown on outside click
  function handleWindowClick(e) {
    if (!e.target.closest('.dropdown')) {
      createDropdownOpen = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<!-- Header -->
<div class="profile-header">
  <div class="profile-header-content">
    <div class="profile-logo">
      <span class="dragon-icon">&#x1F409;</span>
      <h1>Dragons</h1>
    </div>
    <div class="header-actions">
      <span class="user-name">{$user?.name || 'Adventurer'}</span>
      <button class="btn-tertiary" onclick={() => window.location.href = '/logout'}>Logout</button>
    </div>
  </div>
</div>

<!-- Main Content -->
<div class="profile-container">
  <!-- User Info -->
  <div class="profile-card">
    <h2>Your Profile</h2>
    <div class="user-details">
      <p><strong>Name:</strong> {$user?.name || '—'}</p>
      <p><strong>Email:</strong> {$user?.email || '—'}</p>
    </div>
  </div>

  <!-- Characters -->
  <div class="profile-card">
    <div class="card-header">
      <h2>Your Characters</h2>
      <div class="dropdown">
        <button class="btn-primary" onclick={(e) => { e.stopPropagation(); createDropdownOpen = !createDropdownOpen; }}>
          + Create Character
        </button>
        {#if createDropdownOpen}
          <div class="dropdown-content">
            <button onclick={openJoinGame}>Join Existing Game</button>
            <button onclick={openNewPlot}>New Game in Existing World</button>
            <button onclick={openNewWorld}>Create New World and Game</button>
          </div>
        {/if}
      </div>
    </div>

    <div class="character-table-container">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Race</th>
            <th>Class</th>
            <th>World</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {#each characters as char}
            <tr>
              <td>{char.name}</td>
              <td>{char.race}</td>
              <td>{char.class}</td>
              <td>{char.plot?.world?.name || 'N/A'}</td>
              <td class="action-cell">
                <button class="btn-select" onclick={() => selectCharacter(char.plot?._id, char._id)}>Select</button>
                <button class="btn-delete" onclick={() => deleteCharacter(char._id, char.name)}>Delete</button>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="5" class="empty-row">No characters yet. Create one to start your adventure!</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Loading Spinner -->
{#if loading}
  <div class="spinner-overlay">
    <div class="spinner-content">
      <div class="loader"></div>
      <p>Loading...</p>
    </div>
  </div>
{/if}

<!-- Join Game Modal -->
{#if activeModal === 'join-game'}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal-overlay" onclick={closeModal} onkeydown={(e) => e.key === 'Escape' && closeModal()} role="dialog" tabindex="-1">
    <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
      <button class="modal-close" onclick={closeModal}>&times;</button>
      <h3>Join Existing Game</h3>
      <div class="modal-body">
        <label for="plot-id-input">Enter Plot ID:</label>
        <input type="text" id="plot-id-input" bind:value={plotIdInput} placeholder="69821ea9309bb226d2d9be72...">
        {#if plotIdError}
          <div class="error-message">Invalid Plot ID. Please try again.</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" onclick={validatePlotId}>Next</button>
      </div>
    </div>
  </div>
{/if}

<!-- New Plot Modal (Select World) -->
{#if activeModal === 'new-plot'}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal-overlay" onclick={closeModal} onkeydown={(e) => e.key === 'Escape' && closeModal()} role="dialog" tabindex="-1">
    <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
      <button class="modal-close" onclick={closeModal}>&times;</button>
      <h3>Select World</h3>
      <div class="modal-body">
        <label for="world-select">Choose a world:</label>
        <select id="world-select" bind:value={selectedWorldId} onchange={handleWorldChange}>
          {#each worlds as world}
            <option value={world._id}>{world.name}</option>
          {/each}
        </select>
        {#if worldDescription}
          <div class="world-description">{worldDescription}</div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" onclick={selectWorldForPlot}>Next</button>
      </div>
    </div>
  </div>
{/if}

<!-- New World Modal -->
{#if activeModal === 'new-world'}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal-overlay" onclick={closeModal} onkeydown={(e) => e.key === 'Escape' && closeModal()} role="dialog" tabindex="-1">
    <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
      <button class="modal-close" onclick={closeModal}>&times;</button>
      <h3>Create New World</h3>
      <div class="modal-body">
        <label for="new-world-name">World Name:</label>
        <input type="text" id="new-world-name" bind:value={newWorldName} placeholder="Enter a name for your world...">
      </div>
      <div class="modal-footer">
        <button class="btn-primary" onclick={generateNewWorld}>Create World</button>
      </div>
    </div>
  </div>
{/if}

<!-- Character Creator Modal -->
{#if activeModal === 'character-creator'}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal-overlay" onclick={closeModal} onkeydown={(e) => e.key === 'Escape' && closeModal()} role="dialog" tabindex="-1">
    <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
      <button class="modal-close" onclick={closeModal}>&times;</button>
      <h3>Create Your Character</h3>
      <div class="modal-body">
        <div class="form-group">
          <label for="char-name">Name:</label>
          <input type="text" id="char-name" bind:value={charName} placeholder="Your character's name">
        </div>
        <div class="form-group">
          <label for="char-age">Age:</label>
          <input type="number" id="char-age" bind:value={charAge} placeholder="25">
        </div>
        <div class="form-group">
          <label for="char-race">Race:</label>
          <select id="char-race" bind:value={charRace}>
            <option value="">Select a race...</option>
            <option value="Human">Human</option>
            <option value="Elf">Elf</option>
            <option value="Dwarf">Dwarf</option>
          </select>
        </div>
        <div class="form-group">
          <label for="char-class">Class:</label>
          <select id="char-class" bind:value={charClass}>
            <option value="">Select a class...</option>
            <option value="Warrior">Warrior</option>
            <option value="Mage">Mage</option>
            <option value="Rogue">Rogue</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-primary" onclick={createCharacter}>Create Character</button>
      </div>
    </div>
  </div>
{/if}

<!-- Region Selection Modal -->
{#if activeModal === 'region-selection'}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal-overlay" onclick={closeModal} onkeydown={(e) => e.key === 'Escape' && closeModal()} role="dialog" tabindex="-1">
    <div class="modal-box region-modal" onclick={(e) => e.stopPropagation()} onkeydown={() => {}} role="document">
      <button class="modal-close" onclick={closeModal}>&times;</button>
      <h3>Choose Your Starting Region</h3>
      <p class="region-subtitle">Where will your adventure begin?</p>

      {#if regionsLoading}
        <div class="region-loading">
          <div class="loader"></div>
          <p>Loading regions...</p>
        </div>
      {:else if regions.length === 0}
        <p class="error-message">Failed to load regions. Please try again.</p>
      {:else}
        <div class="region-cards-grid">
          {#each regions as region}
            <div
              class="region-card"
              style="border-left-color: {getEcosystemColor(region.ecosystem?.name)}"
              onclick={() => selectRegion(region)}
              role="button"
              tabindex="0"
              onkeydown={(e) => e.key === 'Enter' && selectRegion(region)}
            >
              <div class="region-card-header">
                <h4>{region.name}</h4>
                <span class="region-ecosystem">{region.ecosystem?.name || 'Unknown'}</span>
              </div>
              <p class="region-short">{region.short}</p>
              {#if regionHooks[region.name]}
                <p class="region-hook"><em>"{regionHooks[region.name]}"</em></p>
              {:else}
                <p class="region-hook"><em class="hook-loading">Uncovering adventure hooks...</em></p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Header */
  .profile-header {
    background: #12121a;
    border-bottom: 1px solid #333;
    padding: 1rem 2rem;
  }

  .profile-header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 1000px;
    margin: 0 auto;
  }

  .profile-logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .profile-logo h1 {
    font-size: 1.5rem;
    color: #f0c040;
    font-family: 'Crimson Text', serif;
  }

  .dragon-icon {
    font-size: 1.5rem;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .user-name {
    color: #ccc;
  }

  /* Container */
  .profile-container {
    max-width: 1000px;
    margin: 2rem auto;
    padding: 0 2rem;
  }

  .profile-card {
    background: #1a1a2e;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .profile-card h2 {
    color: #f0c040;
    margin-bottom: 1rem;
    font-family: 'Crimson Text', serif;
  }

  .user-details p {
    color: #ccc;
    margin-bottom: 0.5rem;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* Dropdown */
  .dropdown {
    position: relative;
  }

  .dropdown-content {
    position: absolute;
    right: 0;
    top: 100%;
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 0.5rem;
    min-width: 220px;
    z-index: 100;
  }

  .dropdown-content button {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    color: #e0e0e0;
    border: none;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .dropdown-content button:hover {
    background: #2a2a3e;
  }

  /* Table */
  .character-table-container {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid #333;
  }

  th {
    color: #aaa;
    font-weight: 600;
  }

  td {
    color: #e0e0e0;
  }

  .empty-row {
    color: #666;
    text-align: center;
    padding: 2rem;
  }

  .action-cell {
    display: flex;
    gap: 0.5rem;
  }

  .btn-select {
    background: #f0c040;
    color: #0a0a0f;
    border: none;
    padding: 0.4rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .btn-select:hover {
    background: #e0b030;
  }

  .btn-delete {
    background: transparent;
    color: #888;
    border: 1px solid #444;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .btn-delete:hover {
    background: #2a1a1a;
    color: #e74c3c;
    border-color: #e74c3c;
  }

  /* Buttons */
  .btn-primary {
    background: #f0c040;
    color: #0a0a0f;
    border: none;
    padding: 0.5rem 1.5rem;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .btn-primary:hover {
    background: #e0b030;
  }

  .btn-tertiary {
    background: transparent;
    color: #888;
    border: 1px solid #333;
    padding: 0.4rem 1rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-tertiary:hover {
    background: #1a1a2e;
  }

  /* Spinner */
  .spinner-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
  }

  .spinner-content {
    text-align: center;
    color: #e0e0e0;
  }

  .loader {
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top-color: #f0c040;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* Modals */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .modal-box {
    background: #1a1a2e;
    border: 1px solid #444;
    border-radius: 12px;
    padding: 2rem;
    max-width: 500px;
    width: 90%;
    position: relative;
  }

  .modal-box h3 {
    color: #f0c040;
    margin-bottom: 1rem;
    font-family: 'Crimson Text', serif;
  }

  .modal-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    color: #888;
    cursor: pointer;
    font-size: 1.5rem;
    background: none;
    border: none;
  }

  .modal-body {
    margin-bottom: 1.5rem;
  }

  .modal-body label {
    display: block;
    color: #aaa;
    margin-bottom: 0.5rem;
  }

  .modal-body input, .modal-body select {
    width: 100%;
    padding: 0.5rem;
    background: #0a0a0f;
    color: #e0e0e0;
    border: 1px solid #444;
    border-radius: 6px;
    font-size: 0.95rem;
  }

  .modal-footer {
    text-align: right;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .error-message {
    color: #e74c3c;
    font-size: 0.85rem;
    margin-top: 0.25rem;
  }

  /* Region selection */
  .region-modal {
    max-width: 700px;
  }

  .region-subtitle {
    color: #888;
    margin-bottom: 1rem;
  }

  .region-loading {
    text-align: center;
    padding: 2rem;
  }

  .region-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .region-card {
    background: #12121a;
    border: 1px solid #333;
    border-left: 4px solid #6366f1;
    border-radius: 8px;
    padding: 1rem;
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .region-card:hover {
    background: #1a1a30;
    border-color: #555;
  }

  .region-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .region-card-header h4 {
    color: #e0e0e0;
    margin: 0;
  }

  .region-ecosystem {
    color: #888;
    font-size: 0.8rem;
  }

  .region-short {
    color: #aaa;
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
  }

  .region-hook {
    color: #888;
    font-size: 0.8rem;
  }

  .hook-loading {
    color: #555;
  }

  /* World description */
  .world-description {
    margin-top: 0.5rem;
    color: #888;
    font-size: 0.9rem;
  }
</style>
