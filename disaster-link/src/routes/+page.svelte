<script lang="ts">
  let heroSpotlightX = $state(50);
  let heroSpotlightY = $state(50);
  let textRippleAlpha = $state(0);
  let subtitleRippleAlpha = $state(0);

  let titleTopEl: HTMLElement | null = null;
  let titleBottomEl: HTMLElement | null = null;
  let subtitleEl: HTMLElement | null = null;

  function computeDistanceToRect(
    x: number,
    y: number,
    rect: { left: number; right: number; top: number; bottom: number }
  ): number {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    return Math.hypot(dx, dy);
  }

  // This converts distance to a smooth ripple strength (1 near, 0 far).
  function proximityAlpha(distance: number, range: number): number {
    if (distance >= range) return 0;
    const normalized = 1 - distance / range;
    return Math.max(0, Math.min(1, normalized));
  }

  // This updates the radial highlight center based on cursor position over the landing hero area.
  function updateHeroSpotlight(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    heroSpotlightX = ((event.clientX - bounds.left) / bounds.width) * 100;
    heroSpotlightY = ((event.clientY - bounds.top) / bounds.height) * 100;

    const titleTopDistance = titleTopEl
      ? computeDistanceToRect(event.clientX, event.clientY, titleTopEl.getBoundingClientRect())
      : Number.POSITIVE_INFINITY;
    const titleBottomDistance = titleBottomEl
      ? computeDistanceToRect(event.clientX, event.clientY, titleBottomEl.getBoundingClientRect())
      : Number.POSITIVE_INFINITY;
    const nearestTitleDistance = Math.min(titleTopDistance, titleBottomDistance);
    textRippleAlpha = Number.isFinite(nearestTitleDistance)
      ? proximityAlpha(nearestTitleDistance, 130)
      : 0;

    if (subtitleEl) {
      const rect = subtitleEl.getBoundingClientRect();
      const distance = computeDistanceToRect(event.clientX, event.clientY, rect);
      subtitleRippleAlpha = proximityAlpha(distance, 120);
    } else {
      subtitleRippleAlpha = 0;
    }

  }

  // This recenters the ripple when the cursor leaves the hero area.
  function resetHeroSpotlight(): void {
    heroSpotlightX = 50;
    heroSpotlightY = 50;
    textRippleAlpha = 0;
    subtitleRippleAlpha = 0;
  }
</script>

<div
  class="landing-marker-cursor min-h-screen flex flex-col items-center justify-center p-6 bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] relative"
  style={`--spotlight-x:${heroSpotlightX}%; --spotlight-y:${heroSpotlightY}%; --text-ripple-alpha:${textRippleAlpha}; --subtitle-ripple-alpha:${subtitleRippleAlpha};`}
  role="presentation"
  onmousemove={updateHeroSpotlight}
  onmouseleave={resetHeroSpotlight}
>
  <img src="/imgs/landing1.png" alt="" class="absolute inset-0 w-full h-full object-contain opacity-20 pointer-events-none" />

  <div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
    <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
      <h1 class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</h1>
      <div class="flex items-center space-x-3 md:space-x-6">
        <a href="signup" class="text-white text-xs md:sm font-medium hover:underline hover:cursor-pointer">Sign Up</a>
        <a href="login" class="bg-[#768391] text-black rounded px-4 md:px-5 text-xs md:text-sm hover:bg-gray-300 transition p-1 hover:cursor-pointer">Log In</a>
      </div>
    </div>
  </div>

  <h2 class="relative left-5 text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">
    DISASTERLINK
  </h2>

  <h1
    bind:this={titleTopEl}
    style="font-family: 'Playfair Display SC', serif"
    data-text="LOCALIZED DISASTER REPORT &"
    class="hero-ripple-text relative left-5 font-playfairsc text-xl md:text-5xl font-bold text-center text-[#ffffff] mb-1 opacity-80"
  >
    LOCALIZED DISASTER REPORT &
  </h1>
  <h1
    bind:this={titleBottomEl}
    style="font-family: 'Playfair Display SC', serif"
    data-text="COMMUNICATION HUB"
    class="hero-ripple-text relative left-5 font-playfairsc text-xl md:text-5xl font-bold text-center text-[#ffffff] mb-1 opacity-80"
  >
    COMMUNICATION HUB
  </h1>
  
  <p
    bind:this={subtitleEl}
    data-text="COORDINATION ● NEWS ● TRANSPARENCY"
    class="hero-ripple-subtext relative left-5 text-gray-300 text-center max-w-md mt-0 font-light"
  >
    COORDINATION ● NEWS ● TRANSPARENCY
  </p>

  <div class="flex flex-col items-center space-y-2">
    <a href="guest-dashboard" class="hero-ripple-button relative left-5 top-10 inline-flex min-w-[15rem] items-center justify-center gap-1.5 rounded px-4 py-2 text-xs shadow-md hover:cursor-pointer">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        class="h-4.5 w-4.5"
        aria-hidden="true"
      >
        <path d="M14.3 4.2a1 1 0 0 1 1.4.92v2.26l2.96 2.1a1 1 0 0 1 0 1.64l-2.96 2.1v2.26a1 1 0 0 1-1.5.86l-4.98-2.87H6.75A1.75 1.75 0 0 1 5 11.72V8.28A1.75 1.75 0 0 1 6.75 6.53h2.47L14.2 3.66a1 1 0 0 1 .1-.06z" />
        <path d="M8.1 13.5h1.7l1.05 4.05a.9.9 0 0 1-.87 1.13H8.7a.9.9 0 0 1-.87-.67L6.95 13.5h1.15z" />
      </svg>
      <span>Report Disaster</span>
    </a>
    <p class="relative left-5 top-10 max-w-[28rem] text-center text-[11px] text-white/75">
      Continue as guest to view real-time hazard information, explore guest features, and report incidents without creating an account.
    </p>
  </div>

  <!-- Small info cards (optional) -->
  <div class="relative grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 top-10">
    <div class="card p-4 shadow-sm bg-base-200"></div>
    <div class="card p-4 shadow-sm bg-base-200"></div>
    <div class="card p-4 shadow-sm bg-base-200"></div>
  </div>
</div>

<style>
  /* This applies a map-marker style cursor only on the landing page container. */
  .landing-marker-cursor {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24'%3E%3Cpath fill='%23facc15' stroke='%23ffffff' stroke-width='1.5' d='M12 2.5c-3.86 0-7 3.14-7 7c0 5.14 6.2 11.66 6.47 11.94a.75.75 0 0 0 1.06 0C12.8 21.16 19 14.64 19 9.5c0-3.86-3.14-7-7-7Z'/%3E%3Ccircle cx='12' cy='9.5' r='2.4' fill='%230C212F'/%3E%3C/svg%3E") 12 22, auto;
  }

  /* Keep obvious pointer feedback for clickable elements. */
  .landing-marker-cursor a {
    cursor: pointer;
  }

  /* This keeps original text visible and overlays a tighter, stronger gold ripple on the glyphs only. */
  .hero-ripple-text {
    color: #ffffff;
  }

  .hero-ripple-text::after {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      radial-gradient(
        150px 80px at var(--spotlight-x, 50%) var(--spotlight-y, 50%),
        rgba(255, 245, 176, calc(0.74 * var(--text-ripple-alpha, 0))) 0%,
        rgba(253, 224, 71, calc(0.62 * var(--text-ripple-alpha, 0))) 34%,
        rgba(245, 158, 11, calc(0.32 * var(--text-ripple-alpha, 0))) 58%,
        rgba(245, 158, 11, 0) 76%
      );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: 0 0 10px rgba(253, 224, 71, calc(0.16 * var(--text-ripple-alpha, 0)));
  }

  /* This mirrors the same text-only ripple on the subtitle with slightly smaller range. */
  .hero-ripple-subtext {
    color: #d1d5db;
  }

  .hero-ripple-subtext::after {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      radial-gradient(
        130px 52px at var(--spotlight-x, 50%) var(--spotlight-y, 50%),
        rgba(255, 239, 178, calc(0.58 * var(--subtitle-ripple-alpha, 0))) 0%,
        rgba(250, 204, 21, calc(0.42 * var(--subtitle-ripple-alpha, 0))) 38%,
        rgba(250, 204, 21, 0) 74%
      );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: 0 0 8px rgba(250, 204, 21, calc(0.12 * var(--subtitle-ripple-alpha, 0)));
  }

  /* Guest CTA uses a solid high-contrast style without ripple overlay. */
  .hero-ripple-button {
    background: linear-gradient(135deg, #0a1b28 0%, #133247 52%, #1d4258 100%);
    color: #ffffff;
    font-weight: 700;
    border: 1px solid rgba(160, 186, 204, 0.38);
    box-shadow:
      0 8px 18px rgba(0, 0, 0, 0.28),
      0 0 0 1px rgba(58, 102, 130, 0.35);
    overflow: hidden;
    isolation: isolate;
    transition: transform 140ms ease-out, box-shadow 140ms ease-out, filter 140ms ease-out;
  }

  .hero-ripple-button:hover {
    transform: translateY(-1px);
    filter: brightness(1.06);
    box-shadow:
      0 10px 22px rgba(0, 0, 0, 0.32),
      0 0 0 1px rgba(143, 177, 199, 0.46);
  }
</style>

