<script>
  import { createEventDispatcher } from 'svelte';
  import '../styles/landing.css';
  import FlagIcon from '../assets/flag.svg?raw';

  const dispatch = createEventDispatcher();

  function handleGetStarted() {
    dispatch('getstarted');
  }

  const features = [
    {
      icon: 'code',
      title: 'VS Code in the Cloud',
      description: 'Full-featured code editor accessible from any browser, no installation required.'
    },
    {
      icon: 'controls',
      title: 'Blender 3D',
      description: 'Create stunning 3D models and animations right from your browser.'
    },
    {
      icon: 'settings',
      title: 'KiCad PCB Design',
      description: 'Design professional circuit boards without any local setup.'
    },
    {
      icon: 'bolt',
      title: 'Instant Access',
      description: 'Launch your development environment in seconds from any device.'
    },
    {
      icon: 'private',
      title: 'Your Own Space',
      description: 'Each space is isolated and secure, with your files saved automatically.'
    },
    {
      icon: 'community',
      title: 'Club Integration',
      description: 'Share spaces with your Hack Club and collaborate with friends.'
    }
  ];
</script>

<a href="https://hackclub.com/">
  <img class="flag-banner" src="https://assets.hackclub.com/flag-orpheus-top.svg" alt="Hack Club"/>
</a>

<div class="landing">
  <section class="hero">
    <div class="hero-content">
      <div class="hero-logo" style="color: var(--red)">
        {@html FlagIcon}
      </div>
      <h1 class="hero-title">Hack Club Spaces</h1>
      <p class="hero-subtitle">
        Code from anywhere. Build anything. No powerful hardware required.
      </p>
      <p class="hero-description">
        Virtual development environments for teen hackers. VS Code, Blender, KiCad, and more, all running in the cloud.
      </p>
      <div class="hero-actions">
        <button class="btn-cta" on:click={handleGetStarted}>
          Get Started
        </button>
        <a href="https://hackclub.com" target="_blank" rel="noopener noreferrer" class="btn-outline">
          Learn About Hack Club
        </a>
      </div>
    </div>
    <div class="hero-visual">
      <div class="browser-mockup">
        <div class="browser-header">
          <div class="browser-dots">
            <span class="dot red"></span>
            <span class="dot yellow"></span>
            <span class="dot green"></span>
          </div>
          <div class="browser-url">spaces.hackclub.com</div>
        </div>
        <div class="browser-content">
          <div class="code-preview">
            <div class="code-line"><span class="keyword">const</span> <span class="variable">dream</span> = <span class="string">"build something amazing"</span>;</div>
            <div class="code-line"><span class="keyword">const</span> <span class="variable">tools</span> = [<span class="string">"VS Code"</span>, <span class="string">"Blender"</span>, <span class="string">"KiCad"</span>];</div>
            <div class="code-line"></div>
            <div class="code-line"><span class="keyword">async function</span> <span class="function">stopDreaming</span>() {"{"}</div>
            <div class="code-line">  <span class="keyword">&nbsp;&nbsp;await</span> <span class="function">joinHackClub</span>();</div>
            <div class="code-line">  <span class="keyword">&nbsp;&nbsp;return</span> <span class="variable">dream</span>;</div>
            <div class="code-line">{"}"}</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="features">
    <div class="features-container">
      <h2 class="section-title">Everything you need to build</h2>
      <p class="section-subtitle">Powerful tools, zero setup, accessible everywhere.</p>
      
      <div class="features-grid">
        {#each features as feature}
          <div class="feature-card">
            <img class="feature-icon" src="https://icons.hackclub.com/api/icons/ec3750/{feature.icon}" alt="" />
            <h3 class="feature-title">{feature.title}</h3>
            <p class="feature-description">{feature.description}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="code-section">
    <div class="code-section-container">
      <div class="code-section-content">
        <h2 class="section-title">Join the community</h2>
        <p class="section-subtitle">Connect with thousands of teen hackers on Slack, share your projects, and get help when you're stuck.</p>
        <a href="https://hackclub.com/slack" target="_blank" rel="noopener noreferrer" class="btn-cta">
          Join Hack Club Slack
        </a>
      </div>
      <div class="code-section-visual">
        <div class="code-block">
          <div class="code-block-header">
            <span class="code-filename">hackclub.js</span>
          </div>
          <div class="code-block-content">
            <div class="code-line"><span class="keyword">async function</span> <span class="function">joinHackClub</span>() {"{"}</div>
            <div class="code-line">  <span class="keyword">const</span> <span class="variable">slack</span> = <span class="string">"hackclub.com/slack"</span>;</div>
            <div class="code-line">  <span class="keyword">const</span> <span class="variable">friends</span> = <span class="keyword">await</span> <span class="function">fetch</span>(<span class="variable">slack</span>);</div>
            <div class="code-line"></div>
            <div class="code-line">  <span class="comment">// 50,000+ teen hackers</span></div>
            <div class="code-line">  <span class="comment">// Ship projects together</span></div>
            <div class="code-line">  <span class="comment">// Get help when stuck</span></div>
            <div class="code-line"></div>
            <div class="code-line">  <span class="keyword">return</span> <span class="variable">friends</span>;</div>
            <div class="code-line">{"}"}</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <div class="cta-container">
      <h2 class="cta-title">Ready to start building?</h2>
      <p class="cta-subtitle">Join thousands of teen hackers creating amazing projects.</p>
      <button class="btn-cta large" on:click={handleGetStarted}>
        Launch Your Space
      </button>
    </div>
  </section>

  <footer class="landing-footer">
    <div class="footer-content">
      <p>
        Made with 💖 by <a href="https://hackclub.com" target="_blank" rel="noopener noreferrer">Hack Club</a>
      </p>
      <p class="footer-links">
        <a href="https://github.com/hackclub/spaces" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://hackclub.com/slack" target="_blank" rel="noopener noreferrer">Slack</a>
        <a href="https://hackclub.com/clubs" target="_blank" rel="noopener noreferrer">Start a Club</a>
      </p>
    </div>
  </footer>
</div>
