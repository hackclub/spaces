import './app.css'
import DemoApp from './DemoApp.svelte'

const app = new DemoApp({
  target: document.getElementById('app')
})

export default app
