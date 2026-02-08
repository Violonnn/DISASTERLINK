/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{html,js,svelte,ts}', 
  ],
  theme: {
    extend: {
      fontFamily: {
        playfairsc: ["'Playfair Display SC'", "serif"],
},
    },
  },
  plugins: [
    require('daisyui'), // your plugin
  ],
};
