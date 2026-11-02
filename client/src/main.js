import './app.css'
import App from './App.svelte'
import { mount } from 'svelte';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { inject } from '@vercel/analytics';

injectSpeedInsights();
inject();

const app = mount(App, { target: document.getElementById("app") });

export default app
