<script setup>
import { ref } from 'vue';
import { store } from '../format.js';
import { t } from '../i18n.js';

const options = [
  { id: 'light', label: 'theme_light', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
  { id: 'system', label: 'theme_system', icon: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 20h8M12 16v4' },
  { id: 'dark', label: 'theme_dark', icon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' },
];
const theme = ref(store.get('hub.theme') || 'system');
function set(t) {
  theme.value = t;
  store.set('hub.theme', t);
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
</script>

<template>
  <div class="inline-flex overflow-hidden rounded-md border border-rule bg-panel-2" role="group" aria-label="Theme">
    <button v-for="(o, i) in options" :key="o.id" type="button" :title="t(o.label)" :aria-label="t(o.label)" :aria-pressed="theme === o.id"
      class="grid place-items-center px-2 py-1.5 transition-colors"
      :class="[i && 'border-l border-rule', theme === o.id ? 'bg-seg text-signal' : 'text-ink-3 hover:text-ink']"
      @click="set(o.id)">
      <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path :d="o.icon" /></svg>
    </button>
  </div>
</template>
