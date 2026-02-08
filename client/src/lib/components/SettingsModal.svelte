<script>
  import Modal from './Modal.svelte';
  import { plotId } from '../stores/gameStore.js';
  import { activeModal } from '../stores/modalStore.js';
  import { closeModal } from '../stores/modalStore.js';
  import { showToast } from '../stores/toastStore.js';
  import * as api from '../services/api.js';

  let tone = $state('classic');
  let difficulty = $state('casual');

  const toneDescriptions = {
    classic: 'A world of adventure and wonder, with danger and consequence.',
    dark: 'Harsh and unforgiving. Life is cheap, trust is rare.',
    whimsical: 'Strange and often absurd, but internally consistent.'
  };

  const difficultyDescriptions = {
    casual: 'Failures result in setbacks, but rarely death.',
    hardcore: 'The world does not pull punches. Poor decisions can result in death.'
  };

  $effect(() => {
    if ($activeModal === 'settings') loadSettings();
  });

  async function loadSettings() {
    try {
      const settings = await api.getPlotSettings($plotId);
      if (settings) {
        tone = settings.tone || 'classic';
        difficulty = settings.difficulty || 'casual';
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  }

  async function save() {
    try {
      await api.savePlotSettings($plotId, { tone, difficulty });
      showToast(`Settings: ${tone} tone, ${difficulty} difficulty`, 'success');
      closeModal();
    } catch (e) {
      showToast('Failed to save settings', 'error');
    }
  }
</script>

<Modal name="settings" title="Game Settings">
  <div class="setting">
    <label for="tone"><strong>World Tone:</strong></label>
    <select id="tone" bind:value={tone}>
      <option value="classic">Classic Fantasy</option>
      <option value="dark">Dark & Gritty</option>
      <option value="whimsical">Whimsical</option>
    </select>
    <p class="desc">{toneDescriptions[tone]}</p>
  </div>

  <div class="setting">
    <label for="diff"><strong>Difficulty:</strong></label>
    <select id="diff" bind:value={difficulty}>
      <option value="casual">Casual</option>
      <option value="hardcore">Hardcore</option>
    </select>
    <p class="desc">{difficultyDescriptions[difficulty]}</p>
  </div>

  <button class="save-btn" onclick={save}>Save Settings</button>
</Modal>

<style>
  .setting { margin-bottom: 16px; }
  .setting label { display: block; margin-bottom: 6px; color: var(--text-secondary); }
  .setting select {
    width: 100%; padding: 10px; background: var(--bg-input);
    color: var(--text-primary); border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md); font-size: 0.95rem;
  }
  .desc { color: var(--text-muted); font-size: 0.85rem; margin-top: 4px; }
  .save-btn {
    padding: 10px 24px; background: var(--accent-gold); color: var(--bg-primary);
    border: none; border-radius: var(--radius-md); cursor: pointer;
    font-weight: 600; transition: all 0.2s;
  }
  .save-btn:hover { background: #e5c158; }
</style>
