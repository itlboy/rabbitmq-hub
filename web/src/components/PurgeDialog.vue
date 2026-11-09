<script setup>
// Empty-queue confirmation: the button only arms once the exact queue name is typed.
import { computed, nextTick, ref, watch } from 'vue';
import { fmt } from '../format.js';
import Spinner from './Spinner.vue';

const props = defineProps({ target: Object, clusterName: String, busy: Boolean, error: String });
const emit = defineEmits(['cancel', 'confirm']);
const typed = ref('');
const input = ref(null);
const armed = computed(() => props.target && typed.value === props.target.name);

watch(() => props.target, async (t) => { typed.value = ''; if (t) { await nextTick(); input.value?.focus(); } });
function onKey(e) { if (e.key === 'Escape') emit('cancel'); }
</script>

<template>
  <div v-if="target" class="fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4" @click.self="emit('cancel')" @keydown="onKey">
    <form role="dialog" aria-modal="true" aria-labelledby="purge-title" @submit.prevent="armed && emit('confirm', typed)"
      class="grid w-full max-w-[500px] gap-3.5 rounded-xl border border-t-4 border-rule border-t-stop bg-panel p-6 text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,.5)]">
      <h4 id="purge-title" class="m-0 text-lg font-bold tracking-tight">Empty this queue?</h4>
      <p class="m-0 text-ink-2">Every message waiting in this queue is deleted. Consumers keep running. This cannot be undone.</p>
      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-panel-2 p-3 font-mono text-xs">
        <dt class="text-ink-3">cluster</dt><dd class="m-0 break-all">{{ clusterName }}</dd>
        <dt class="text-ink-3">queue</dt><dd class="m-0 break-all">{{ target.name }}</dd>
        <dt class="text-ink-3">messages</dt><dd class="m-0">{{ fmt(target.messages) }}</dd>
      </dl>
      <label for="purge-confirm" class="label">Type the queue name to confirm</label>
      <input id="purge-confirm" ref="input" v-model="typed" autocomplete="off" spellcheck="false"
        class="rounded-md border bg-bg px-3 py-2.5 font-mono text-[13px] text-ink outline-none" :class="armed ? 'border-stop' : 'border-rule'">
      <p class="m-0 min-h-4 font-mono text-xs text-stop">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn px-3.5 py-2" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="btn border-stop bg-stop px-3.5 py-2 text-white hover:enabled:border-stop hover:enabled:text-white hover:enabled:brightness-110" :disabled="!armed || busy">
          <Spinner v-if="busy" :size="12" /> {{ busy ? 'Emptying…' : 'Empty queue' }}
        </button>
      </div>
    </form>
  </div>
</template>
