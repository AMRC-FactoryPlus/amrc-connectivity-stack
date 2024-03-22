/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

module.exports = {
  darkMode: 'class',
  content: [
    './storage/framework/views/*.php',
    './resources/**/*.blade.php',
    './stories/**/*.mdx',
    './resources/**/*.js',
    './stories/**/*.js',
    './resources/**/*.vue',
  ],
  theme: {
    height: theme => ({
      auto: 'auto',
      ...theme('spacing'),
      full: '100%',
      screen: '100vh',
      page: 'calc(100vh - 4rem)',
      content: 'calc(100vh - 10rem)',
    }),
    extend: {
      colors: {
        brand: '#3578e5',
      },
    },
  },
  variants: {
    extend: {},
  },
};
