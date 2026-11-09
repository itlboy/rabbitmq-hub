<script setup>
// Compact one-row strip: edge chips → animated wire → hub chip. Wire dashes speed up with the edges' publish rate.
import { computed } from 'vue';
import { fmt, rate } from '../format.js';

const props = defineProps({ clusters: { type: Array, required: true }, colors: { type: Object, default: () => ({}) } });
const emit = defineEmits(['pick']);

const hub = computed(() => props.clusters.find((c) => props.clusters.some((x) => x.forwards_to === c.id)));
const sources = computed(() => (hub.value ? props.clusters.filter((c) => c.forwards_to === hub.value.id) : []));
const inbound = computed(() => sources.value.reduce((a, c) => a + (c.rates?.publish || 0), 0));
const healthy = (c) => c.ok && (!c.shovels || c.shovels.bad.length === 0);
const wire = computed(() => {
  const dead = sources.value.some((c) => !healthy(c));
  return { state: dead ? 'dead' : inbound.value > 0 ? 'live' : 'idle', dur: Math.max(0.5, 3 - Math.log10(1 + inbound.value) * 1.2).toFixed(2) + 's' };
});
</script>

<template>
  <section v-if="hub" class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-rule bg-panel px-3 py-2.5" aria-label="Message flow">
    <span class="label shrink-0 max-md:w-full">Flow</span>
    <div class="flex min-w-0 flex-wrap gap-2">
      <button v-for="c in sources" :key="c.id" type="button" @click="emit('pick', c.id)"
        class="flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors hover:border-ink-3"
        :class="healthy(c) ? 'border-rule' : 'border-stop/60 bg-stop-soft'"
        :style="healthy(c) ? { background: `color-mix(in srgb, ${colors[c.id]} 8%, var(--panel))` } : {}">
        <span class="led" :class="!c.ok && 'off'"></span>
        <span class="truncate text-[13px] font-semibold" :style="{ color: `color-mix(in srgb, ${colors[c.id]} 75%, var(--ink))` }">{{ c.name }}</span>
        <span class="whitespace-nowrap font-mono text-[11px] text-ink-2">
          {{ rate(c.rates?.publish) }}/s<template v-if="c.shovels"> · {{ c.shovels.running }}/{{ c.shovels.total }} sh</template>
        </span>
      </button>
    </div>
    <svg class="h-3 min-w-10 flex-1 max-md:hidden" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 6 H 100" vector-effect="non-scaling-stroke" fill="none" stroke-width="2" :class="wire.state" :style="{ '--dur': wire.dur }" />
      <path d="M94 1 L100 6 L94 11" vector-effect="non-scaling-stroke" fill="none" stroke-width="2" :class="wire.state === 'dead' ? 'tip-dead' : 'tip'" />
    </svg>
    <span class="font-mono text-xs text-signal md:hidden" aria-hidden="true">→</span>
    <button type="button" @click="emit('pick', hub.id)"
      class="flex items-center gap-2 rounded-md border border-rule px-2.5 py-1.5 text-left transition-colors hover:border-ink-3" :style="{ background: `color-mix(in srgb, ${colors[hub.id]} 10%, var(--panel))` }">
      <span class="led" :class="!hub.ok && 'off'"></span>
      <span class="text-[13px] font-semibold" :style="{ color: `color-mix(in srgb, ${colors[hub.id]} 75%, var(--ink))` }">{{ hub.name }}</span>
      <span class="font-mono text-[15px] font-semibold tabular-nums">{{ fmt(hub.messages?.messages) }}</span>
      <span class="font-mono text-[11px] text-ink-3">waiting · <b class="font-semibold text-out">{{ rate(hub.rates?.deliver) }}</b>/s out</span>
    </button>
    <span class="label ml-auto shrink-0 max-lg:hidden">{{ rate(inbound) }} msg/s in</span>
  </section>
</template>

<style scoped>
path { stroke: var(--seg); }
path.live { stroke: var(--signal); stroke-dasharray: 4 8; animation: flowdash var(--dur, 1.6s) linear infinite; }
path.dead { stroke: var(--stop); stroke-dasharray: 2 6; }
path.tip { stroke: var(--ink-3); }
path.tip-dead { stroke: var(--stop); }
</style>
