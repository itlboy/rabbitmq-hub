<script setup>
// One cluster as an equipment rack: status LED, waiting messages, in/out rates, gauges, node units with a segmented RAM meter.
import { fmt, rate, bytes } from '../format.js';

const props = defineProps({ cluster: { type: Object, required: true }, selected: Boolean, index: { type: Number, default: 0 } });
defineEmits(['pick']);

function unit(n) {
  const pct = n.mem_limit ? Math.min(100, (n.mem_used / n.mem_limit) * 100) : 0;
  return { pct: Math.round(pct), lit: Math.round(pct / 5), bad: n.mem_alarm || n.disk_alarm || n.partitions?.length };
}
</script>

<template>
  <article role="button" tabindex="0" :aria-pressed="selected" @click="$emit('pick')" @keydown.enter.space.prevent="$emit('pick')"
    class="rack flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-panel text-left transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-18px_rgba(0,0,0,.45)]"
    :class="selected ? 'border-ink shadow-[0_0_0_1px_var(--ink)]' : 'border-rule'" :style="{ '--i': index }">
    <header class="flex items-center gap-2 border-b border-dashed border-rule px-3.5 py-2.5" :class="cluster.ok ? 'bg-panel-2' : 'bg-stop-soft'">
      <span class="led" :class="!cluster.ok && 'off'"></span>
      <h3 class="m-0 truncate text-[14px] font-bold tracking-tight">{{ cluster.name }}</h3>
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
        <div class="grid shrink-0 justify-items-end font-mono text-[11px] leading-snug text-ink-2">
          <span>in <b class="font-semibold" :class="(cluster.rates?.publish || 0) > 0 ? 'text-signal' : 'text-ink'">{{ rate(cluster.rates?.publish) }}</b>/s</span>
          <span>out <b class="font-semibold text-ink">{{ rate(cluster.rates?.deliver) }}</b>/s</span>
        </div>
      </div>

      <dl class="m-0 grid grid-cols-3 divide-x divide-rule rounded-lg border border-rule">
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">queues</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ fmt(cluster.totals?.queues) }}</dd></div>
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">conns</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ fmt(cluster.totals?.connections) }}</dd></div>
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">shovels</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ cluster.shovels ? `${cluster.shovels.running}/${cluster.shovels.total}` : '—' }}</dd></div>
      </dl>

      <div v-if="cluster.nodes?.length" class="grid gap-1">
        <div v-for="n in cluster.nodes" :key="n.name" class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 font-mono text-[11px]"
          :class="n.running ? 'text-ink-2' : 'text-stop'"
          :title="n.running ? `RAM ${bytes(n.mem_used)} / ${bytes(n.mem_limit)} watermark · disk free ${bytes(n.disk_free)}` : 'node stopped'">
          <span class="flex min-w-0 items-center gap-2 text-ink">
            <span class="led" :class="(!n.running || unit(n).bad) && 'off'"></span><span class="truncate">{{ n.name }}</span>
          </span>
          <span class="grid h-2.5 grid-cols-[repeat(20,1fr)] gap-0.5" :aria-label="`RAM ${unit(n).pct}% of watermark`">
            <i v-for="s in 20" :key="s" class="rounded-[1px]"
              :class="n.running && s <= unit(n).lit ? (s > 18 ? 'bg-stop' : s > 15 ? 'bg-caution' : 'bg-go') : 'bg-seg'"></i>
          </span>
          <span class="whitespace-nowrap tabular-nums">{{ n.running ? `${unit(n).pct}% · ${bytes(n.disk_free)} free` : 'stopped' }}</span>
        </div>
      </div>

      <div v-if="cluster.problems?.length" class="mt-auto grid rounded-r-md border-l-[3px] border-stop bg-stop-soft px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-stop">
        <span v-for="p in cluster.problems" :key="p">! {{ p }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.rack { animation: rise .5s cubic-bezier(.2, .7, .2, 1) both; animation-delay: calc(var(--i, 0) * 70ms); }
</style>
