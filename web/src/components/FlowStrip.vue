<script setup>
// Edges (clusters with `forwards_to`) wired into their hub. Wire dashes speed up with the edge's publish rate.
import { computed } from 'vue';
import { fmt, rate } from '../format.js';

const props = defineProps({ clusters: { type: Array, required: true } });
const emit = defineEmits(['pick']);

const hub = computed(() => props.clusters.find((c) => props.clusters.some((x) => x.forwards_to === c.id)));
const sources = computed(() => (hub.value ? props.clusters.filter((c) => c.forwards_to === hub.value.id) : []));
const inbound = computed(() => sources.value.reduce((a, c) => a + (c.rates?.publish || 0), 0));
const wires = computed(() => sources.value.map((c, i, all) => {
  const y = all.length === 1 ? 50 : 10 + i * (80 / (all.length - 1));
  const healthy = c.ok && (!c.shovels || c.shovels.bad.length === 0);
  const pub = c.rates?.publish || 0;
  return {
    id: c.id, d: `M0 ${y} C 55 ${y}, 45 50, 100 50`,
    state: !healthy ? 'dead' : pub > 0 ? 'live' : 'idle',
    dur: Math.max(0.5, 3 - Math.log10(1 + pub) * 1.2).toFixed(2) + 's',
  };
}));
</script>

<template>
  <section v-if="hub" class="grid gap-3 overflow-hidden rounded-xl border border-rule bg-panel p-4" aria-label="Message flow">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <span class="label">Message flow · edges → hub</span>
      <span class="label">{{ rate(inbound) }} msg/s entering at the edges</span>
    </div>
    <div class="grid items-center gap-2 md:grid-cols-[minmax(0,440px)_minmax(48px,1fr)_minmax(0,260px)] md:gap-0">
      <div class="grid gap-2">
        <button v-for="c in sources" :key="c.id" type="button" @click="emit('pick', c.id)"
          class="flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-ink-3"
          :class="c.ok ? 'border-rule bg-panel-2' : 'border-stop bg-stop-soft'">
          <span class="led" :class="!c.ok && 'off'"></span>
          <span class="truncate text-[13px] font-semibold">{{ c.name }}</span>
          <span class="ml-auto whitespace-nowrap font-mono text-[11px] text-ink-2">
            {{ rate(c.rates?.publish) }}/s · {{ c.shovels ? `${c.shovels.running}/${c.shovels.total} shovels` : '—' }}
          </span>
        </button>
      </div>
      <div class="relative hidden self-stretch md:block" aria-hidden="true">
        <svg class="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path v-for="w in wires" :key="w.id" :d="w.d" vector-effect="non-scaling-stroke" fill="none" stroke-width="2"
            :class="w.state" :style="{ '--dur': w.dur }" />
        </svg>
      </div>
      <div class="text-center font-mono text-sm font-semibold text-signal md:hidden" aria-hidden="true">↓ shovels ↓</div>
      <button type="button" @click="emit('pick', hub.id)"
        class="flex flex-col items-start gap-1 rounded-lg border-2 border-ink bg-panel p-3.5 text-left">
        <span class="flex w-full items-center gap-2">
          <span class="led" :class="!hub.ok && 'off'"></span>
          <span class="truncate text-[13px] font-semibold">{{ hub.name }}</span>
          <span class="ml-auto whitespace-nowrap font-mono text-[11px] text-ink-2">{{ rate(hub.rates?.deliver) }}/s out</span>
        </span>
        <span class="font-mono text-[26px] font-semibold leading-tight tracking-tight tabular-nums">{{ fmt(hub.messages?.messages) }}</span>
        <span class="label">messages waiting for workers</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
path { stroke: var(--seg); }
path.live { stroke: var(--signal); stroke-dasharray: 4 8; animation: flowdash var(--dur, 1.6s) linear infinite; }
path.dead { stroke: var(--stop); stroke-dasharray: 2 6; }
</style>
