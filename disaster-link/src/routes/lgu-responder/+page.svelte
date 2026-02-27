<script lang="ts">
  /**
   * LGU responder entry — redirects to municipal or barangay dashboard based on role.
   */
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { getLguDashboardPath } from '$lib/auth-redirect';

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      goto('/login');
      return;
    }

    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    const lguRoles = ['lgu_responder', 'municipal_responder', 'barangay_responder'];
    if (!data || !lguRoles.includes(data.role)) {
      goto('/login');
      return;
    }

    goto(getLguDashboardPath(data.role));
  });
</script>

<div class="min-h-screen grid place-items-center bg-[#0C212F]">
  <svg class="animate-spin h-8 w-8 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
  </svg>
</div>
