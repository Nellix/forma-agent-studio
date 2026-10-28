import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.ts'],pool:'threads',maxWorkers:1,testTimeout:30000,hookTimeout:60000}});
