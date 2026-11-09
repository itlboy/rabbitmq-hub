<script setup>
// One cluster as an equipment rack: status LED, waiting messages, in/out rates, gauges, node units with a segmented RAM meter.
import { fmt, rate, bytes } from '../format.js';
import Sparkline from './Sparkline.vue';

const props = defineProps({ cluster: { type: Object, required: true }, selected: Boolean, index: { type: Number, default: 0 }, color: { type: String, default: 'var(--hue-1)' } });
defineEmits(['pick', 'node']);

const cpuLoad = (n) => (n.processors ? (n.run_queue / n.processors).toFixed(1) : '—');
const cpuHot = (n) => n.processors && n.run_queue > n.processors;
function unit(n) {
  const pct = n.mem_limit ? Math.min(100, (n.mem_used / n.mem_limit) * 100) : 0;
  return { pct: Math.round(pct), lit: Math.round(pct / 5), bad: n.mem_alarm || n.disk_alarm || n.partitions?.length };
}
</script>

<template>
  <article role="button" tabindex="0" :aria-pressed="selected" @click="$emit('pick')" @keydown.enter.space.prevent="$emit('pick')"
    class="rack flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-panel text-left transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-18px_rgba(0,0,0,.45)]"
    :class="selected ? 'shadow-[0_8px_24px_-14px_var(--cc)]' : 'border-rule'" :style="{ '--i': index, '--cc': color, ...(selected ? { borderColor: color } : {}) }">
    <header class="flex items-center gap-2 border-b border-dashed border-rule px-3.5 py-2.5" :style="{ background: cluster.ok ? 'color-mix(in srgb, var(--cc) 10%, var(--panel))' : 'var(--stop-soft)' }">
      <span class="led" :class="!cluster.ok && 'off'"></span>
      <h3 class="m-0 truncate text-[14px] font-bold tracking-tight" style="color: color-mix(in srgb, var(--cc) 75%, var(--ink))">{{ cluster.name }}</h3>
      <span class="ml-auto whitespace-nowrap font-mono text-[11px] text-ink-3">{{ cluster.version ? 'v' + cluster.version : '' }}</span>
    </header>

    <div class="flex flex-1 flex-col gap-3 p-3.5">
      <p v-if="cluster.role" class="m-0 truncate text-[12px] text-ink-2" :title="cluster.role">{{ cluster.role }}</p>

      <div class="flex items-end justify-between gap-3">
        <div class="min-w-0">
          <span class="label">waiting</span>
          <div class="font-mono text-[26px] font-semibold leading-none tracking-[-.04em] tabular-nums">
            {{ fmt(cluster.messages?.messages) }}<small class="ml-1 text-[11px] font-normal tracking-normal text-ink-3">msg</small>
          </div>
        </div>
        <Sparkline v-if="cluster.history?.messages?.length" :values="cluster.history.messages" :width="90" :height="26" :color="color" class="mb-0.5 min-w-0 flex-1" />
        <div class="grid shrink-0 justify-items-end font-mono text-[11px] leading-snug text-ink-2">
          <span>in <b class="font-semibold" :class="(cluster.rates?.publish || 0) > 0 ? 'text-signal' : 'text-ink'">{{ rate(cluster.rates?.publish) }}</b>/s</span>
          <span>out <b class="font-semibold" :class="(cluster.rates?.deliver || 0) > 0 ? 'text-out' : 'text-ink'">{{ rate(cluster.rates?.deliver) }}</b>/s</span>
        </div>
      </div>

      <dl class="m-0 grid grid-cols-3 divide-x divide-rule rounded-lg border border-rule" style="background: color-mix(in srgb, var(--cc) 4%, var(--panel))">
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">queues</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ fmt(cluster.totals?.queues) }}</dd></div>
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">conns</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ fmt(cluster.totals?.connections) }}</dd></div>
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">shovels</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ cluster.shovels ? `${cluster.shovels.running}/${cluster.shovels.total}` : '—' }}</dd></div>
      </dl>

      <div v-if="cluster.nodes?.length" class="grid gap-2">
        <button v-for="n in cluster.nodes" :key="n.name" type="button" @click.stop="$emit('node', n.name)" :title="`Details for ${n.name}`"
          class="-mx-1.5 grid gap-1 rounded-md px-1.5 py-1 text-left font-mono text-[11px] transition-colors hover:bg-panel-2">
          <div class="flex items-center gap-2">
            <span class="led" :class="(!n.running || unit(n).bad) && 'off'"></span>
            <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ n.name }}</span>
            <span v-if="!n.running" class="text-stop">stopped</span>
            <span v-else-if="n.processors" class="whitespace-nowrap" :class="cpuHot(n) ? 'font-semibold text-stop' : 'text-ink-2'"
              :title="`Erlang run queue ${n.run_queue} on ${n.processors} cores — above the core count means CPU is saturated`">
              CPU {{ n.processors }}c · load {{ cpuLoad(n) }}
            </span>
          </div>
          <div v-if="n.running" class="grid grid-cols-[2.4rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 pl-4 text-ink-2">
            <span class="text-ink-3">RAM</span>
            <span class="grid h-2 grid-cols-[repeat(20,1fr)] gap-0.5" :aria-label="`RAM ${unit(n).pct}% of watermark`">
              <i v-for="s in 20" :key="s" class="rounded-[1px]" :class="s <= unit(n).lit ? (s > 18 ? 'bg-stop' : s > 15 ? 'bg-caution' : 'bg-go') : 'bg-seg'"></i>
            </span>
            <span class="text-right whitespace-nowrap tabular-nums" :class="n.mem_alarm && 'font-semibold text-stop'" :title="'used / memory watermark (publishers are blocked above it)'">
              {{ bytes(n.mem_used) }} / {{ bytes(n.mem_limit) }} · {{ unit(n).pct }}%
            </span>
            <span class="text-ink-3">DISK</span>
            <span class="text-ink-3">free</span>
            <span class="text-right whitespace-nowrap tabular-nums" :class="n.disk_alarm && 'font-semibold text-stop'" :title="'free space on the data disk / limit below which publishers are blocked'">
              {{ bytes(n.disk_free) }}<template v-if="n.disk_free_limit"> · limit {{ bytes(n.disk_free_limit) }}</template>
            </span>
          </div>
        </button>
      </div>

      <div v-if="cluster.problems?.length" class="mt-auto grid rounded-md bg-stop-soft px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-stop">
        <span v-for="p in cluster.problems" :key="p">! {{ p }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.rack { animation: rise .5s cubic-bezier(.2, .7, .2, 1) both; animation-delay: calc(var(--i, 0) * 70ms); }
</style>
