<script lang="ts">
  /**
   * Municipal responder signup — municipality dropdown, proof upload, role municipal_responder.
   */
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';
  import { fetchMunicipalities } from '$lib/services/barangay-boundary';

  /* ── Form field state ── */
  let firstName = $state('');
  let lastName = $state('');
  let email = $state('');
  let phone = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let municipalityId = $state('');
  let proofFile: File | null = $state(null);
  let proofPreview = $state('');

  /* ── Data ── */
  let municipalities = $state<{ id: string; name: string }[]>([]);

  /* ── UI state ── */
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let showErrors = $state(false);

  /* ── File constraints ── */
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

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
    proof: (() => {
      if (!proofFile) return 'Proof of employment is required';
      const file = proofFile as File;
      if (!ALLOWED_TYPES.includes(file.type)) return 'Only JPG, PNG, or WebP images are allowed';
      if (file.size > MAX_FILE_SIZE) return 'File must be under 5 MB';
      return '';
    })()
  });

  let isFormValid = $derived(Object.values(errors).every((msg) => msg === ''));

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    proofFile = file;
    if (file && ALLOWED_TYPES.includes(file.type)) {
      const reader = new FileReader();
      reader.onload = (e) => (proofPreview = (e.target?.result as string) ?? '');
      reader.readAsDataURL(file);
    } else proofPreview = '';
  }

  async function handleSignup(event: SubmitEvent) {
    event.preventDefault();
    showErrors = true;
    if (!isFormValid || !proofFile) return;

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

    const fileExt = proofFile.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('proof-of-employment')
      .upload(fileName, proofFile, { contentType: proofFile.type });
    if (uploadError) {
      isSubmitting = false;
      errorMessage = 'Failed to upload proof of employment. Please try again.';
      return;
    }

    const { data: urlData } = supabase.storage.from('proof-of-employment').getPublicUrl(fileName);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          contact_phone: phone.trim(),
          role: 'municipal_responder',
          municipality_id: municipalityId,
          proof_of_employment_url: urlData.publicUrl
        },
        emailRedirectTo: `${window.location.origin}/login`
      }
    });

    isSubmitting = false;
    if (error) {
      errorMessage = error.message;
      return;
    }
    if (data.user?.identities?.length === 0) {
      errorMessage = 'This email is already registered. Please log in instead.';
      return;
    }
    successMessage =
      'Account created! Your proof of employment will be reviewed by an admin before you can log in.';
    setTimeout(() => goto('/login'), 4000);
  }

  onMount(async () => {
    municipalities = await fetchMunicipalities();
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
      <h1 class="relative text-[#2F4B5D] text-2xl font-bold text-center">Municipal Responder</h1>
      <span class="relative text-[#2F4B5D] font-light text-sm mt-1">Municipality-level access</span>

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
          <label for="FN" class="text-[10px] text-[#2F4B5D] ml-1">First Name</label>
          <input id="FN" name="firstName" type="text" placeholder="First Name" bind:value={firstName} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.firstName}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.firstName}</p>{/if}
        </div>
        <div class="relative pb-3">
          <label for="LN" class="text-[10px] text-[#2F4B5D] ml-1">Last Name</label>
          <input id="LN" name="lastName" type="text" placeholder="Last Name" bind:value={lastName} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.lastName}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.lastName}</p>{/if}
        </div>
        <!-- <div class="hidden md:block"></div> -->
        <div class="relative pb-3">
          <label for="PN" class="text-[10px] text-[#2F4B5D]">Contact</label>
          <input id="PN" name="phone" type="tel" placeholder="09XXXXXXXXX" bind:value={phone} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.phone}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.phone}</p>{/if}
        </div>


        <div class="relative pb-3 md:col-span-2 w-full text-left ml-1">
          <label for="EM" class="text-[10px] text-[#2F4B5D]">Email</label>
          <input id="EM" name="email" type="email" placeholder="Email" bind:value={email} class="md:col-span-2 w-91 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.email}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.email}</p>{/if}
        </div>
        

        <div class="relative pb-3 w-full text-left ml-1">
          <label for="MUN" class="text-[10px] text-[#2F4B5D]">Municipality</label>
          <select id="MUN" name="municipality" bind:value={municipalityId} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]">
            <option value="">— Select municipality —</option>
            {#each municipalities as m}<option value={m.id}>{m.name}</option>{/each}
          </select>
          {#if showErrors && errors.municipality}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.municipality}</p>{/if}
        </div>

        <div class="relative pb-3">
          <label for="PASS" class="text-[10px] text-[#2F4B5D] ml-1">Password</label>
          <input id="PASS" name="password" type="password" placeholder="Min 6 characters" bind:value={password} class="w-45 border p-1 rounded-lg text-xs text-[#0C212F]" />
          {#if showErrors && errors.password}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.password}</p>{/if}
        </div>
        <div class="relative pb-3">
          <label for="CPASS" class="text-[10px] text-[#2F4B5D] ml-1">Confirm</label>
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

        <div class="relative pb-3 md:col-start-2 w-full text-left ml-1 grid place-content-center">
          <label for="PROOF" class="text-[10px] text-[#2F4B5D]">Proof of Employment</label>
          <p class="text-[9px] text-[#2F4B5D]/60 ml-1 mb-1">JPG, PNG, WebP — max 5 MB</p>
          <label for="PROOF" class="flex items-center gap-2 w-91 border border-dashed border-[#2F4B5D]/40 rounded-lg p-2 cursor-pointer hover:border-[#2F4B5D] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="#2F4B5D" class="w-5 h-5 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span class="text-xs text-[#0C212F] truncate">{proofFile ? proofFile.name : 'Choose file…'}</span>
          </label>
          <input id="PROOF" type="file" accept="image/jpeg,image/png,image/webp" onchange={handleFileSelect} class="hidden" />
          {#if proofPreview}<img src={proofPreview} alt="Proof" class="mt-2 w-24 h-24 object-cover rounded-lg border" />{/if}
          {#if showErrors && errors.proof}<p class="absolute bottom-0 left-1 text-[9px] text-red-500">{errors.proof}</p>{/if}
        </div>

        
      </div>
    </div>
    <a href="/signup/lgu-responder" class="relative mt-4 block text-center text-[#2F4B5D] text-xs hover:underline">← Back to LGU options</a>
  </form>
</div>
