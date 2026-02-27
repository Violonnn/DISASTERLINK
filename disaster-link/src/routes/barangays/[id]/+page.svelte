<script lang="ts">
  /**
   * Barangay details page — displays barangay information.
   * Placeholder for now; content to be added later.
   */
  import { page } from '$app/stores';

  const barangayId = $derived($page.params.id);

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/guest-dashboard';
    }
  }
</script>

<div class="min-h-screen bg-[#0C212F] text-white p-6 md:p-8">
  <div class="max-w-2xl mx-auto">
    <button
      type="button"
      onclick={goBack}
      class="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm mb-6 transition cursor-pointer bg-transparent border-none"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
      </svg>
      Back to map
    </button>

    <div class="bg-white/5 rounded-xl border border-white/10 p-6 md:p-8">
      <p class="text-white/50 text-sm mb-2">Barangay ID: {barangayId}</p>
      <h1 class="text-xl font-semibold text-white mb-4">Barangay Information</h1>
      <p class="text-white/60 text-sm">Content placeholder — details to be added.</p>
    </div>
  </div>
</div>
