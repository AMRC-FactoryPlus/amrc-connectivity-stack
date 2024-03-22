/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

declare global {
    namespace NodeJS {
      interface ProcessEnv {
        CONFIG_URL: string;
        DEBUG: string; 
        NODE_ID: string;
        PASSWORD: string;
        POLL_INT: string;
      }
    }
  }
  
  // If this file has no import/export statements (i.e. is a script)
  // convert it into a module by adding an empty export statement.
  export {}