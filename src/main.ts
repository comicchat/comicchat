import '98.css';
import './style.css';
import { ArtStore } from './art/store';
import { App } from './ui/app';

async function boot() {
  const art = new ArtStore();
  await art.init();
  const app = new App(art);
  await app.init();
  // Debug hook for development tooling.
  (window as unknown as { ccApp: App }).ccApp = app;
}

boot().catch((e) => {
  document.body.innerHTML = `<div style="padding:2em;font-family:monospace;color:white">
    <h2>Boot failure</h2><pre>${e?.stack ?? e}</pre></div>`;
});
