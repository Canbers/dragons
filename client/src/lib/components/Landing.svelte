<script>
  import { authenticated, user } from '../stores/authStore.js';

  let { navigateTo } = $props();
</script>

<div class="landing-body">
  <div class="landing-hero">
    <div class="landing-content">
      <div class="landing-logo">
        <span class="dragon-icon">&#x1F409;</span>
        <h1>Dragons</h1>
      </div>
      <p class="landing-tagline">An AI-Powered Choose Your Own Adventure</p>
      <p class="landing-description">
        Step into a living, breathing world powered by AI. Your choices matter, consequences are real,
        and the story unfolds based on what you do—not what you're supposed to do.
      </p>

      <div class="landing-auth">
        {#if $authenticated}
          <div class="landing-user-menu">
            <span class="welcome-text">Welcome back, {$user?.name || 'Adventurer'}</span>
            <div class="landing-actions">
              <button class="landing-btn-secondary" onclick={() => navigateTo('profile')}>View Profile</button>
              <button class="landing-btn-tertiary" onclick={() => window.location.href = '/logout'}>Logout</button>
            </div>
          </div>
        {:else}
          <button class="landing-login-btn" onclick={() => window.location.href = '/login'}>
            <span>Login to Continue</span>
            <span class="btn-arrow">&rarr;</span>
          </button>
        {/if}
      </div>
    </div>

    <div class="landing-features">
      <div class="feature-card">
        <div class="feature-icon">&#x1F3B2;</div>
        <h3>The Indifferent World</h3>
        <p>The world doesn't revolve around you. It reacts logically to your actions—victories are earned, not given.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#x1F916;</div>
        <h3>AI Game Master</h3>
        <p>Powered by advanced AI that adapts to your choices in real-time. No two adventures are the same.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#x1F5FA;</div>
        <h3>Living Worlds</h3>
        <p>Procedurally generated worlds with persistent history. Every action shapes the world around you.</p>
      </div>
    </div>
  </div>
</div>

<style>
  .landing-body {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
  }

  .landing-hero {
    max-width: 900px;
    padding: 3rem 2rem;
    text-align: center;
  }

  .landing-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .landing-logo h1 {
    font-size: 3rem;
    color: #f0c040;
    font-family: 'Crimson Text', serif;
  }

  .dragon-icon {
    font-size: 3rem;
  }

  .landing-tagline {
    font-size: 1.3rem;
    color: #aaa;
    margin-bottom: 1rem;
  }

  .landing-description {
    color: #888;
    max-width: 600px;
    margin: 0 auto 2rem;
    line-height: 1.6;
  }

  .landing-features {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.5rem;
    margin-top: 2rem;
  }

  .feature-card {
    background: #1a1a2e;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 1.5rem;
  }

  .feature-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  .feature-card h3 {
    color: #f0c040;
    margin-bottom: 0.5rem;
  }

  .feature-card p {
    color: #999;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .landing-auth {
    margin: 2rem 0;
  }

  .landing-login-btn {
    background: #f0c040;
    color: #0a0a0f;
    border: none;
    padding: 0.75rem 2rem;
    font-size: 1.1rem;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
  }

  .landing-login-btn:hover {
    background: #e0b030;
  }

  .btn-arrow {
    margin-left: 0.5rem;
  }

  .landing-user-menu {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .welcome-text {
    color: #ccc;
    font-size: 1.1rem;
  }

  .landing-actions {
    display: flex;
    gap: 1rem;
  }

  .landing-btn-secondary {
    background: #2a2a3e;
    color: #e0e0e0;
    border: 1px solid #444;
    padding: 0.5rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .landing-btn-secondary:hover {
    background: #3a3a4e;
  }

  .landing-btn-tertiary {
    background: transparent;
    color: #888;
    border: 1px solid #333;
    padding: 0.5rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .landing-btn-tertiary:hover {
    background: #1a1a2e;
  }
</style>
