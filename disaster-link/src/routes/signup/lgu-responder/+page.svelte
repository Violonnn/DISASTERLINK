<script lang="ts">
  /**
   * LGU responder signup choice — user selects Municipal or Barangay responder type.
   */
</script>

<div class="min-h-screen flex flex-col items-center justify-center p-6 bg-[linear-gradient(130deg,#0C212F_35%,#2F4B5D_100%)] relative cursor-default">
  <img src="/imgs/landing1.png" alt="" class="absolute inset-0 w-full h-full object-contain opacity-20 pointer-events-none" />

  <div class="fixed top-0 left-0 w-full bg-white/3-0 shadow-md z-50">
    <div class="max-w-screen-xl mx-auto flex justify-between items-center h-12 px-4 md:px-4">
      <a href="/" class="relative text-xs md:text-sm text-gray-500" style="font-family: 'Playfair Display SC', serif">DISASTERLINK</a>
    </div>
  </div>

  <div class="relative w-full flex flex-col items-center -mt-5">
    <h1 class="relative text-white text-4xl font-bold text-center">CHOOSE YOUR LGU RESPONDER TYPE</h1>
    <span class="relative right-7 top-5 text-white font-light -mt-5 text-sm" style="font-family: 'Playfair Display SC', serif">Already have an account?</span><a href="/login" class="relative left-23 text-white hover:underline hover:cursor-pointer text-sm" style="font-family: 'Playfair Display SC', serif">Login</a>
  </div>

  <div class="relative grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
    <a href="/signup/lgu-responder/municipal" class="card p-4 shadow-md bg-base-300 w-65 h-14 rounded-[8px] bg-[#2F4B5D]/70 grid place-content-center text-gray-500 text-sm">Municipal Responder</a>
    <a href="/signup/lgu-responder/barangay" class="card p-4 shadow-md bg-base-300 w-65 h-14 rounded-[8px] bg-[#2F4B5D]/70 grid place-content-center text-gray-500 text-sm">Barangay Responder</a>
  </div>

  <a href="/signup" class="relative mt-8 text-white/90 text-xs hover:underline" style="font-family: 'Playfair Display SC', serif">← Back to signup options</a>
</div>
