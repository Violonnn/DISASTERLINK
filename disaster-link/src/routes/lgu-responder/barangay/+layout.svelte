<script lang="ts">
  /**
   * Barangay layout — restricts access to barangay_responder and lgu_responder roles.
   */
  let { children } = $props();
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';

  let allowed = $state(false);
  let checking = $state(true);

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      goto('/login');
      return;
    }
    const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
    const barangayRoles = ['barangay_responder', 'lgu_responder'];
    if (!data || !barangayRoles.includes(data.role)) {
      goto('/login');
      return;
    }
    allowed = true;
    checking = false;
  });
</script>

{#if checking}
  <div class="min-h-screen grid place-items-center bg-[#0C212F]">
    <svg class="animate-spin h-8 w-8 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
  </div>
{:else if allowed}
  {@render children()}
{/if}
