<script lang="ts">
  /**
   * Resident Settings — profile management for authenticated residents.
   * Lets residents view their account info and change their password.
   */
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import ResidentNavBar from '$lib/components/ResidentNavBar.svelte';

  let isLoading = $state(true);
  let isSaving = $state(false);

  /* Profile display fields (read-only from Supabase auth / profiles table) */
  let userLabel = $state('');
  let userInitials = $state('R');
  let residentBarangayName = $state('');
  let displayEmail = $state('');
  let displayPhone = $state('');
  let displayFirstName = $state('');
  let displayLastName = $state('');

  /* Password change fields */
  let newPassword = $state('');
  let confirmPassword = $state('');
  let showPasswordForm = $state(false);
  let passwordError = $state('');
  let passwordSuccess = $state('');
  let showErrors = $state(false);

  /* Reactive validation for the password change form */
  let passwordErrors = $derived({
    newPassword:
      newPassword === '' ? 'New password is required'
      : newPassword.length < 6 ? 'Password must be at least 6 characters'
      : '',
    confirmPassword:
      confirmPassword === '' ? 'Please confirm your password'
      : confirmPassword !== newPassword ? 'Passwords do not match'
      : ''
  });

  let isPasswordFormValid = $derived(
    Object.values(passwordErrors).every((m) => m === '')
  );

  onMount(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      goto('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name, last_name, role, barangay_id, phone')
      .eq('id', session.user.id)
      .single();

    if (!profile || profile.role !== 'resident') {
      await supabase.auth.signOut();
      goto('/login');
      return;
    }

    displayFirstName  = profile.first_name ?? '';
    displayLastName   = profile.last_name ?? '';
    displayEmail      = session.user.email ?? '';
    displayPhone      = profile.phone ?? '';


    const fn = displayFirstName;
    const ln = displayLastName;
    userLabel    = [fn, ln].filter(Boolean).join(' ') || 'Resident';
    userInitials = (fn ? fn[0] : '') + (ln ? ln[0] : '') || 'R';

    if (profile.barangay_id) {
      const { data: brgy } = await supabase
        .from('barangays')
        .select('name')
        .eq('id', profile.barangay_id)
        .single();
      residentBarangayName = brgy?.name ?? '';
    }

    isLoading = false;
  });

  /* Submit a new password via Supabase auth */
  async function handlePasswordChange(e: SubmitEvent) {
    e.preventDefault();
    showErrors = true;
    passwordError = '';
    passwordSuccess = '';

    if (!isPasswordFormValid) return;

    isSaving = true;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    isSaving = false;

    if (error) {
      passwordError = error.message;
    } else {
      passwordSuccess = 'Password updated successfully!';
      newPassword = '';
      confirmPassword = '';
      showErrors = false;
      showPasswordForm = false;
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    goto('/login');
  }
</script>

<ResidentNavBar
  {userLabel}
  {userInitials}
  {residentBarangayName}
  currentPath="/resident/settings"
/>

{#if isLoading}
  <div class="min-h-screen grid place-items-center bg-[#0C212F]">
    <svg class="animate-spin h-8 w-8 text-white/70" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
    </svg>
  </div>
{:else}

<div class="min-h-screen bg-[#0C212F] pt-12 md:pt-14">
  <div class="max-w-lg mx-auto px-4 py-10">

    <!-- Page title -->
    <div class="mb-8">
      <h1 class="text-white text-xl font-semibold">Account Settings</h1>
      <p class="text-white/40 text-sm mt-1">Manage your resident profile.</p>
    </div>

    <!-- Profile info card -->
    <div class="bg-[#1B2E3A] rounded-2xl border border-white/10 overflow-hidden shadow-lg mb-6">
      <div class="px-5 py-4 border-b border-white/10">
        <p class="text-white/60 text-xs font-semibold uppercase tracking-wider">Profile Information</p>
      </div>
      <div class="px-5 py-4 flex flex-col gap-4">

        <!-- Avatar + name row -->
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-full bg-[#2F4B5D] flex items-center justify-center text-white text-lg font-bold border border-white/10 shrink-0">
            {userInitials}
          </div>
          <div>
            <p class="text-white font-medium">{userLabel}</p>
            <p class="text-white/40 text-xs mt-0.5">Resident</p>
          </div>
        </div>

        <!-- Info fields (read-only display) -->
        <div class="grid grid-cols-1 gap-3">

          <div>
            <p class="text-white/50 text-[11px] uppercase tracking-wider mb-1">First Name</p>
            <p class="text-white/80 text-sm bg-[#0C212F]/40 rounded-lg px-3 py-2 border border-white/10">{displayFirstName || '—'}</p>
          </div>

          <div>
            <p class="text-white/50 text-[11px] uppercase tracking-wider mb-1">Last Name</p>
            <p class="text-white/80 text-sm bg-[#0C212F]/40 rounded-lg px-3 py-2 border border-white/10">{displayLastName || '—'}</p>
          </div>

          <div>
            <p class="text-white/50 text-[11px] uppercase tracking-wider mb-1">Email Address</p>
            <p class="text-white/80 text-sm bg-[#0C212F]/40 rounded-lg px-3 py-2 border border-white/10">{displayEmail || '—'}</p>
          </div>

          <div>
            <p class="text-white/50 text-[11px] uppercase tracking-wider mb-1">Contact Number</p>
            <p class="text-white/80 text-sm bg-[#0C212F]/40 rounded-lg px-3 py-2 border border-white/10">{displayPhone || '—'}</p>
          </div>

          {#if residentBarangayName}
            <div>
              <p class="text-white/50 text-[11px] uppercase tracking-wider mb-1">Barangay</p>
              <p class="text-white/80 text-sm bg-[#0C212F]/40 rounded-lg px-3 py-2 border border-white/10">{residentBarangayName}</p>
            </div>
          {/if}

        </div>
      </div>
    </div>

    <!-- Email is considered verified for any logged-in resident -->
    <div class="bg-[#1B2E3A] rounded-2xl border border-emerald-500/25 overflow-hidden shadow-lg mb-6">
      <div class="px-5 py-4 flex items-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-emerald-400 shrink-0">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <div class="flex-1">
          <p class="text-emerald-400 text-xs font-semibold uppercase tracking-wider">Email Verified</p>
          <p class="text-white/40 text-xs mt-0.5">{displayEmail}</p>
        </div>
      </div>
    </div>

    <!-- Password change card -->
    <div class="bg-[#1B2E3A] rounded-2xl border border-white/10 overflow-hidden shadow-lg mb-6">
      <div class="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <p class="text-white/60 text-xs font-semibold uppercase tracking-wider">Security</p>
        <button
          onclick={() => { showPasswordForm = !showPasswordForm; passwordError = ''; passwordSuccess = ''; showErrors = false; }}
          class="text-[#768391] hover:text-white text-xs transition cursor-pointer"
        >
          {showPasswordForm ? 'Cancel' : 'Change Password'}
        </button>
      </div>

      {#if showPasswordForm}
        <form onsubmit={handlePasswordChange} novalidate class="px-5 py-4 flex flex-col gap-3">

          {#if passwordError}
            <div class="bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg px-3 py-2">{passwordError}</div>
          {/if}
          {#if passwordSuccess}
            <div class="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-lg px-3 py-2">{passwordSuccess}</div>
          {/if}

          <div class="relative">
            <label for="new-pass" class="text-white/50 text-[11px] uppercase tracking-wider block mb-1">New Password</label>
            <input
              id="new-pass"
              type="password"
              placeholder="Min 6 characters"
              bind:value={newPassword}
              class="w-full bg-[#0C212F]/60 text-white placeholder-white/30 text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:border-white/30 transition"
            />
            {#if showErrors && passwordErrors.newPassword}
              <p class="text-red-400 text-[11px] mt-1">{passwordErrors.newPassword}</p>
            {/if}
          </div>

          <div class="relative">
            <label for="confirm-pass" class="text-white/50 text-[11px] uppercase tracking-wider block mb-1">Confirm New Password</label>
            <input
              id="confirm-pass"
              type="password"
              placeholder="Re-enter password"
              bind:value={confirmPassword}
              class="w-full bg-[#0C212F]/60 text-white placeholder-white/30 text-sm px-3 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:border-white/30 transition"
            />
            {#if showErrors && passwordErrors.confirmPassword}
              <p class="text-red-400 text-[11px] mt-1">{passwordErrors.confirmPassword}</p>
            {/if}
          </div>

          <button
            type="submit"
            disabled={isSaving}
            class="w-full bg-[#2F4B5D] hover:bg-[#3a5c72] text-white text-sm font-medium py-2.5 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-1"
          >
            {#if isSaving}
              <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Saving…
            {:else}
              Update Password
            {/if}
          </button>
        </form>
      {:else}
        <div class="px-5 py-4">
          <p class="text-white/40 text-sm">••••••••••••</p>
        </div>
      {/if}
    </div>

    <!-- Logout button -->
    <button
      onclick={handleLogout}
      class="w-full flex items-center justify-center gap-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-400 hover:text-red-300 text-sm font-medium py-3 rounded-2xl transition cursor-pointer"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
      </svg>
      Log Out
    </button>

  </div>
</div>

{/if}
