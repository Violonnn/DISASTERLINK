<script lang="ts">
  /**
   * LguDashboardPage — shared map dashboard for municipal and barangay LGU responders.
   * Uses MapDashboard in LGU mode with barangay management, status updates, and assistance.
   */
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import MapDashboard from './MapDashboard.svelte';
  import {
    fetchBarangayForResponder,
    fetchPendingBoundaryRequest,
    type BarangayInfo,
    type PendingBoundaryRequest
  } from '$lib/services/barangay-boundary';

  let isLoading = $state(true);
  let lguUserId = $state('');
  let lguRole = $state<string>('');
  let lguMunicipalityId = $state<string>('');
  let lguMunicipalityName = $state<string>('');
  let lguBarangayInfo = $state<BarangayInfo | null>(null);
  let pendingRequest = $state<PendingBoundaryRequest | null>(null);
  let userLabel = $state('LGU Responder');
  let userInitials = $state('');
  let locationLabel = $state('');

  async function loadBarangayInfo() {
    lguBarangayInfo = await fetchBarangayForResponder(lguUserId);
    pendingRequest = await fetchPendingBoundaryRequest(lguUserId);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    goto('/login');
  }

  const pfpMenuItems = [
    { label: 'Account Setting', action: () => {} },
    { label: 'Logout', action: handleLogout }
  ];

  const hamburgerMenuItems = [
    { label: 'Map', href: '#' }
  ];

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      goto('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, role, municipality_id')
      .eq('id', session.user.id)
      .single();

    if (profile?.role === 'municipal_responder' && profile.municipality_id) {
      lguMunicipalityId = profile.municipality_id;
      const { data: mun } = await supabase
        .from('municipalities')
        .select('name')
        .eq('id', profile.municipality_id)
        .single();
      lguMunicipalityName = mun?.name ?? '';
    }

    const lguRoles = ['lgu_responder', 'municipal_responder', 'barangay_responder'];
    if (!profile || !lguRoles.includes(profile.role)) {
      goto('/login');
      return;
    }

    lguUserId = session.user.id;
    lguRole = profile.role ?? '';
    userLabel = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'LGU Responder';
    const fn = profile.first_name ?? '';
    const ln = profile.last_name ?? '';
    userInitials = (fn ? fn[0] : '') + (ln ? ln[0] : '') || 'U';

    await loadBarangayInfo();
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
    mode="lgu"
    {userLabel}
    {userInitials}
    {locationLabel}
    pfpMenuItems={pfpMenuItems}
    hamburgerMenuItems={hamburgerMenuItems}
    {lguUserId}
    lguRole={lguRole}
    lguMunicipalityId={lguMunicipalityId}
    lguMunicipalityName={lguMunicipalityName}
    {lguBarangayInfo}
    {pendingRequest}
    onBoundaryRequestSubmitted={loadBarangayInfo}
    onBarangayInfoChanged={loadBarangayInfo}
  />
{/if}
