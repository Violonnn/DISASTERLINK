<script lang="ts">
  /**
   * BDRMMO signup — invite-only flow with municipality + barangay selection.
   */
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { fetchMunicipalities, fetchBarangaysByMunicipality } from '$lib/services/barangay-boundary';
  let { data } = $props();

  /* ── Form field state ── */
  let firstName = $state('');
  let lastName = $state('');
  let email = $state('');
  let phone = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let municipalityId = $state('');
  let barangayId = $state('');

  /* ── Data ── */
  let municipalities = $state<{ id: string; name: string }[]>([]);
  let barangayOptions = $state<{ id: string; name: string; hasBoundary: boolean }[]>([]);

  /* ── UI state ── */
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let showErrors = $state(false);

  /* ── Reactive validation ── */
  let errors = $derived({
    firstName: firstName.trim() === '' ? 'First name is required' : '',
    lastName: lastName.trim() === '' ? 'Last name is required' : '',
    email:
      email.trim() === ''
        ? 'Email is required'
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
          ? 'Enter a valid email address'
          : '',
    phone:
      phone.trim() === ''
        ? 'Contact number is required'
        : !/^(09\d{9}|\+639\d{9})$/.test(phone.replace(/[\s-]/g, ''))
          ? 'Enter a valid PH number (09XXXXXXXXX)'
          : '',
    password:
      password === ''
        ? 'Password is required'
        : password.length < 6
          ? 'Password must be at least 6 characters'
          : '',
    confirmPassword:
      confirmPassword === ''
        ? 'Please confirm your password'
        : confirmPassword !== password
          ? 'Passwords do not match'
          : '',
    municipality: municipalityId === '' ? 'Select your municipality' : '',
    barangay: barangayId === '' ? 'Select your barangay' : ''
  });

  let isFormValid = $derived(Object.values(errors).every((msg) => msg === ''));

  async function onMunicipalityChange(munId: string) {
    municipalityId = munId;
    barangayId = '';
    if (munId) {
      barangayOptions = await fetchBarangaysByMunicipality(munId);
    } else {
      barangayOptions = [];
    }
  }

  async function handleSignup(event: SubmitEvent) {
    event.preventDefault();
    showErrors = true;
    if (!isFormValid) return;

    isSubmitting = true;
    errorMessage = '';

    const { data: phoneTaken, error: phoneError } = await supabase.rpc('is_phone_taken', { check_phone: phone.trim() });
    if (phoneError) {
      isSubmitting = false;
      errorMessage = 'Unable to verify phone number. Please try again.';
      return;
    }
    if (phoneTaken) {
      isSubmitting = false;
      errorMessage = 'This phone number is already registered.';
      return;
    }

    const { data: signUpData, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          contact_phone: phone.trim(),
          role: 'bdrrmo',
          municipality_id: municipalityId,
          barangay_id: barangayId
        },
        emailRedirectTo: `${window.location.origin}/login`
      }
    });

    isSubmitting = false;
    if (error) {
      errorMessage = error.message;
      return;
    }
    if (signUpData.user?.identities?.length === 0) {
      errorMessage = 'This email is already registered. Please log in instead.';
      return;
    }

    // This marks the invitation as used so the same link cannot be reused.
    const consumeResponse = await fetch('/api/invitations/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: data.inviteToken,
        userId: signUpData.user?.id ?? '',
        expectedRole: 'bdrrmo'
      })
    });
    if (!consumeResponse.ok) {
      const consumePayload = (await consumeResponse.json().catch(() => ({}))) as { error?: string };
      errorMessage =
        consumePayload.error ??
        'Account was created, but the invitation could not be finalized. Please contact MDRMMO Admin.';
      return;
    }

    successMessage = 'BDRMMO account created successfully. You can proceed to login after email confirmation.';
    setTimeout(() => goto('/login'), 4000);
  }

  onMount(async () => {
    // This prevents already authenticated users from using invitation registration pages.
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      goto('/');
      return;
    }

    municipalities = await fetchMunicipalities();
    if (data.invitedMunicipalityId) {
      municipalityId = data.invitedMunicipalityId;
      barangayOptions = await fetchBarangaysByMunicipality(data.invitedMunicipalityId);
    }
  });
</script>

<div class="min-h-screen flex flex-col items-center justify-center relative cursor-default">
  <img src="/imgs/landing2.png" alt="" class="absolute inset-0 w-full h-full opacity-70 object-contain pointer-events-none" />

  <div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
    <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
      <a href="/" class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</a>
      <a href="/login" class="bg-[#768391] text-black rounded px-4 md:px-5 text-xs text-white md:text-sm hover:bg-gray-300 transition p-1 hover:cursor-pointer">Log In</a>
    </div>
  </div>

  <form
    onsubmit={handleSignup}
    novalidate
    class="relative bg-[#2F4B5D]/4 w-full max-w-[680px] px-6 py-10 grid place-content-center rounded-[16px] shadow-lg"
  >
    <div class="relative w-full flex flex-col items-center">
      <h1 class="relative text-[#2F4B5D] text-2xl font-bold text-center">BDRMMO Registration</h1>
      <span class="relative text-[#2F4B5D] font-light text-sm mt-1">Role: {data.invitedRoleLabel}</span>
      {#if data.invitedMunicipalityName}
        <p class="mt-2 text-[11px] text-emerald-700">
          Invitation linked to the <span class="font-semibold text-emerald-800">Municipality of {data.invitedMunicipalityName}</span>
        </p>
      {/if}

      {#if successMessage}
        <div class="w-full md:w-140 mt-4 bg-green-100 border border-green-400 text-green-800 text-xs rounded-lg px-4 py-3 text-center">
          {successMessage}
          <p class="mt-1 text-[10px] text-green-600">Redirecting to login…</p>
        </div>
      {/if}
      {#if errorMessage}
        <div class="w-full md:w-140 mt-4 bg-red-100 border border-red-400 text-red-800 text-xs rounded-lg px-4 py-3 text-center">
          {errorMessage}
        </div>
      {/if}

      <div class="relative mt-8 grid grid-cols-1 md:grid-cols-3 w-full md:w-140 place-items-center gap-y-1">
        <div class="relative pb-3">
          <label for="FN" class="text-[10px] text-[#2F4B5D] ml-1">First Name <span class="text-red-500">*</span></label>
          <input id="FN" name="firstName" type="text" placeholder="First Name" bind:value={firstName} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.firstName}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.firstName}</p>{/if}
        </div>
        <div class="relative pb-3">
          <label for="LN" class="text-[10px] text-[#2F4B5D] ml-1">Last Name <span class="text-red-500">*</span></label>
          <input id="LN" name="lastName" type="text" placeholder="Last Name" bind:value={lastName} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.lastName}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.lastName}</p>{/if}
        </div>
        <div class="hidden md:block"></div>

        <div class="relative pb-3 md:col-span-2 w-full text-left ml-1">
          <label for="EM" class="text-[10px] text-[#2F4B5D]">Email <span class="text-red-500">*</span></label>
          <input id="EM" name="email" type="email" placeholder="Email" bind:value={email} class="md:col-span-2 w-91 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.email}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.email}</p>{/if}
        </div>
        <div class="relative pb-3">
          <label for="PN" class="text-[10px] text-[#2F4B5D] ml-1">Contact <span class="text-red-500">*</span></label>
          <input id="PN" name="phone" type="tel" placeholder="09XXXXXXXXX" bind:value={phone} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.phone}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.phone}</p>{/if}
        </div>

        <div class="relative pb-3 md:col-span-2 w-full text-left ml-1">
          <label for="MUN" class="text-[10px] text-[#2F4B5D]">Municipality <span class="text-red-500">*</span></label>
          <select
            id="MUN"
            name="municipality"
            bind:value={municipalityId}
            onchange={(e) => onMunicipalityChange((e.target as HTMLSelectElement).value)}
            disabled={!!data.invitedMunicipalityId}
            class="w-91 border p-1 rounded-lg text-xs text-[#0C212F] disabled:bg-gray-100 disabled:text-gray-500"
          >
            <option value="">— Select municipality —</option>
            {#each municipalities as m}<option value={m.id}>{m.name}</option>{/each}
          </select>
          {#if showErrors && errors.municipality}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.municipality}</p>{/if}
        </div>
        <div class="relative pb-3">
          <label for="BRG" class="text-[10px] text-[#2F4B5D] ml-1">Barangay <span class="text-red-500">*</span></label>
          <select
            id="BRG"
            name="barangay"
            bind:value={barangayId}
            disabled={!municipalityId}
            class="w-45 border p-1 rounded-lg text-xs text-[#0C212F] disabled:opacity-50"
          >
            <option value="">— Select —</option>
            {#each barangayOptions as b}<option value={b.id}>{b.name}</option>{/each}
          </select>
          {#if showErrors && errors.barangay}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.barangay}</p>{/if}
        </div>

        <div class="relative pb-3">
          <label for="PASS" class="text-[10px] text-[#2F4B5D] ml-1">Password <span class="text-red-500">*</span></label>
          <input id="PASS" name="password" type="password" placeholder="Min 6 characters" bind:value={password} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.password}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.password}</p>{/if}
        </div>
        <div class="relative pb-3">
          <label for="CPASS" class="text-[10px] text-[#2F4B5D] ml-1">Confirm <span class="text-red-500">*</span></label>
          <input id="CPASS" name="confirmPassword" type="password" placeholder="Re-enter" bind:value={confirmPassword} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.confirmPassword}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.confirmPassword}</p>{/if}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          class="w-full md:w-25 h-10 md:h-8 bg-gray-800 text-xs md:text-sm text-white rounded col-start-1 md:col-start-3 flex items-center justify-center mt-3 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700"
        >
          {#if isSubmitting}
            <svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          {:else}
            Sign Up
          {/if}
        </button>
      </div>
    </div>
  </form>
</div>
