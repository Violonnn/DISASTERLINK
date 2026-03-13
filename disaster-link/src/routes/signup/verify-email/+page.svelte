<script lang="ts">
  import { page } from '$app/stores';

  const email = $derived($page.url.searchParams.get('email') ?? '');
</script>

<div class="min-h-screen flex flex-col items-center justify-center relative cursor-default">
  <img src="/imgs/landing2.png" alt="" class="absolute inset-0 w-full h-full opacity-70 object-contain pointer-events-none" />

  <div class="fixed top-0 left-0 w-full bg-white/30 shadow-md z-50">
    <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
      <a href="/" class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</a>
      <div class="flex items-center space-x-3 md:space-x-6">
        <a href="/login" class="bg-[#768391] text-black rounded px-4 md:px-5 text-xs text-white md:text-sm hover:bg-gray-300 transition p-1 hover:cursor-pointer">Log In</a>
      </div>
    </div>
  </div>

  <div class="relative bg-[#2F4B5D]/4 w-full max-w-[520px] px-6 py-10 grid place-content-center rounded-[16px] shadow-lg">
    <img src="/imgs/login1.png" alt="" class="absolute inset-0 w-full h-full object-cover pointer-events-none" />
    <div class="relative w-full flex flex-col items-center text-center">
      <h1 class="text-[#2F4B5D] text-2xl font-bold mb-2">Verify your email</h1>
      <p class="text-[#2F4B5D] text-sm max-w-xs">
        We sent a confirmation link to
        <span class="font-semibold">{email || 'your email address'}</span>. Open your inbox and click the link to activate your account.
      </p>
      <p class="text-[#2F4B5D]/80 text-xs mt-4 max-w-xs">
        After confirming, you will be redirected to the login page where you can sign in.
      </p>
    </div>
  </div>
</div>

