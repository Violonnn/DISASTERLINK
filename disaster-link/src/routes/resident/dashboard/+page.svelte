<script lang="ts">
  /**
   * Resident Dashboard — authenticated map view for residents.
   * Shows the full map with barangay status layers (read-only).
   * Residents can view barangay profiles but cannot set status or provide assistance.
   */
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import MapDashboard from '$lib/components/MapDashboard.svelte';
  import { clearResidentLocation } from '$lib/services/resident-location-session';

  let isLoading = $state(true);
  let residentUserId = $state('');
  let residentBarangayId = $state('');
  let userLabel = $state('Resident');
  let userInitials = $state('');
  let residentBarangayName = $state('');
  /* Residents that can log in are treated as verified */
  let isEmailVerified = $state(true);

  const settingsIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" style="width:16px;height:16px"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>`;

  const logoutIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#1B2E3A" style="width:16px;height:16px"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" /></svg>`;

  /* Sign out the current resident and navigate to login */
  async function handleLogout() {
    // Clear any saved resident location when logging out.
    clearResidentLocation();
    await supabase.auth.signOut();
    goto('/login');
  }

  /* Profile dropdown: Profile (settings page) and Logout */
  const pfpMenuItems = [
    { label: 'Profile', href: '/resident/settings', icon: settingsIcon },
    { label: 'Logout',  action: handleLogout,        icon: logoutIcon   }
  ];

  /* Hamburger menu is intentionally empty for resident mode.
     Feed and Map are now in the toolbar; Map Legend is added internally by MapDashboard. */
  const hamburgerMenuItems: { label: string; href?: string; action?: () => void; icon?: string }[] = [];

  /* Read initial actions from the URL so the map can react (e.g. open report, focus a report). */
  const initialResidentAction = (() => {
    const action = $page.url.searchParams.get('action');
    return action === 'openReport' ? 'openReport' : null;
  })() as 'openReport' | null;

  const initialReportIdToFocus = (() => {
    const id = $page.url.searchParams.get('focusReportId');
    return id && id.length > 0 ? id : null;
  })() as string | null;

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      goto('/login');
      return;
    }

    /* Fetch the resident's profile */
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, role, barangay_id')
      .eq('id', session.user.id)
      .single();

    if (!profile || profile.role !== 'resident') {
      await supabase.auth.signOut();
      goto('/login');
      return;
    }

    residentUserId = session.user.id;

    const fn = profile.first_name ?? '';
    const ln = profile.last_name ?? '';
    userLabel    = [fn, ln].filter(Boolean).join(' ') || 'Resident';
    userInitials = (fn ? fn[0] : '') + (ln ? ln[0] : '') || 'R';

    /* If the resident has a barangay assigned, fetch its name and ID for reporting */
    if (profile.barangay_id) {
      residentBarangayId = profile.barangay_id;
      const { data: barangay } = await supabase
        .from('barangays')
        .select('name')
        .eq('id', profile.barangay_id)
        .single();
      residentBarangayName = barangay?.name ?? '';
    }

    isLoading = false;
  });
</script>

{#if isLoading}
  <div class="min-h-screen grid place-items-center bg-[#0C212F]">
    <svg class="animate-spin h-8 w-8 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
  </div>
{:else}
  <MapDashboard
    mode="resident"
    {userLabel}
    {userInitials}
    {pfpMenuItems}
    {hamburgerMenuItems}
    {residentUserId}
    {residentBarangayId}
    {residentBarangayName}
    {isEmailVerified}
      {initialResidentAction}
      {initialReportIdToFocus}
  />
{/if}
