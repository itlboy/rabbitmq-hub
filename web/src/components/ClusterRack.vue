<script setup>
// One cluster as an equipment rack: status LED, waiting messages, in/out rates, gauges, node units with a segmented RAM meter.
import { fmt, rate, bytes } from '../format.js';
import Sparkline from './Sparkline.vue';
import { t } from '../i18n.js';

const props = defineProps({ cluster: { type: Object, required: true }, selected: Boolean, index: { type: Number, default: 0 }, color: { type: String, default: 'var(--hue-1)' }, rangeLabel: String });
defineEmits(['pick', 'nodes']);

import { computed } from 'vue';
// Whole-cluster summary: worst node per resource.
const resources = computed(() => {
  const ns = props.cluster.nodes || [];
  const up = ns.filter((n) => n.running);
  const ram = Math.max(0, ...up.map((n) => (n.mem_limit ? (n.mem_used / n.mem_limit) * 100 : 0)));
  const diskNode = up.reduce((m, n) => (m && m.disk_free <= n.disk_free ? m : n), null);
  const load = Math.max(0, ...up.map((n) => (n.processors ? n.run_queue / n.processors : 0)));
  const lvl = (v, w, c) => (v >= c ? 'crit' : v >= w ? 'warn' : 'ok');
  const diskRatio = diskNode?.disk_free_limit ? diskNode.disk_free / diskNode.disk_free_limit : 99;
  return [
    { label: t('nodes'), value: `${up.length}/${ns.length}`, level: up.length < ns.length ? 'crit' : 'ok', title: t('running_total') },
    { label: t('ram'), value: Math.round(ram) + '%', level: up.some((n) => n.mem_alarm) ? 'crit' : lvl(ram, 75, 90), title: t('ram_tip') },
    { label: t('disk'), value: diskNode ? bytes(diskNode.disk_free) : '—', level: up.some((n) => n.disk_alarm) ? 'crit' : diskRatio < 2 ? 'crit' : diskRatio < 5 ? 'warn' : 'ok', title: t('disk_tip') },
    { label: t('cpu'), value: load.toFixed(1), level: lvl(load, 0.7, 1), title: t('cpu_tip') },
  ];
});
function unit(n) {
  const pct = n.mem_limit ? Math.min(100, (n.mem_used / n.mem_limit) * 100) : 0;
  return { pct: Math.round(pct), lit: Math.round(pct / 5), bad: n.mem_alarm || n.disk_alarm || n.partitions?.length };
}
</script>

<template>
  <article role="button" tabindex="0" :aria-pressed="selected" @click="$emit('pick')" @keydown.enter.space.prevent="$emit('pick')"
    class="rack flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-panel text-left transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-18px_rgba(0,0,0,.45)]"
    :class="selected ? 'border-ink-3 shadow-[0_8px_24px_-16px_rgba(0,0,0,.35)]' : 'border-rule'" :style="{ '--i': index, '--cc': color }">
    <header class="flex items-center gap-2 border-b border-dashed border-rule px-3.5 py-2.5" :class="cluster.ok ? 'bg-panel-2' : 'bg-stop-soft'">
      <span class="led" :class="!cluster.ok && 'off'"></span>
      <h3 class="m-0 truncate text-[14px] font-bold tracking-tight">{{ cluster.name }}</h3>
      <span class="ml-auto whitespace-nowrap font-mono text-[11px] text-ink-3">{{ cluster.version ? 'v' + cluster.version : '' }}</span>
      <a v-if="cluster.ui_url" :href="cluster.ui_url" target="_blank" rel="noopener noreferrer" @click.stop @keydown.enter.stop :title="t('open_ui_tip')" :aria-label="t('open_ui')"
        class="-my-1 -mr-1 inline-flex rounded p-1 text-ink-3 transition-colors hover:bg-panel hover:text-ink">
        <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a>
    </header>

    <div class="flex flex-1 flex-col gap-3 p-3.5">
      <p v-if="cluster.role" class="m-0 truncate text-[12px] text-ink-2" :title="cluster.role">{{ cluster.role }}</p>

      <div class="flex items-end justify-between gap-3">
        <div class="min-w-0">
          <span class="label">{{ t('waiting') }}</span>
          <div class="font-mono text-[26px] font-semibold leading-none tracking-[-.04em] tabular-nums">
            {{ fmt(cluster.messages?.messages) }}<small class="ml-1 text-[11px] font-normal tracking-normal text-ink-3">{{ t('msg') }}</small>
          </div>
        </div>
        <Sparkline v-if="cluster.history?.messages?.length" :values="cluster.history.messages" :width="90" :height="26" :color="color" class="mb-0.5 min-w-0 flex-1" :title="t('last', { r: rangeLabel })" />
        <div class="grid shrink-0 justify-items-end font-mono text-[11px] leading-snug text-ink-2">
          <span>{{ t('in') }} <b class="font-semibold" :class="(cluster.rates?.publish || 0) > 0 ? 'text-signal' : 'text-ink'">{{ rate(cluster.rates?.publish) }}</b>/s</span>
          <span>{{ t('out') }} <b class="font-semibold" :class="(cluster.rates?.deliver || 0) > 0 ? 'text-out' : 'text-ink'">{{ rate(cluster.rates?.deliver) }}</b>/s</span>
        </div>
      </div>

      <dl class="m-0 grid grid-cols-3 divide-x divide-rule rounded-lg border border-rule">
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">{{ t('queues') }}</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ fmt(cluster.totals?.queues) }}</dd></div>
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">{{ t('conns') }}</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ fmt(cluster.totals?.connections) }}</dd></div>
        <div class="min-w-0 px-2.5 py-1.5"><dt class="label">{{ t('shovels') }}</dt><dd class="m-0 font-mono text-[14px] font-semibold tabular-nums">{{ cluster.shovels ? `${cluster.shovels.running}/${cluster.shovels.total}` : '—' }}</dd></div>
      </dl>

      <!-- One summary row for the whole cluster (worst node wins); click for every node -->
      <button v-if="cluster.nodes?.length" type="button" @click.stop="$emit('nodes')" :title="t('show_nodes')"
        class="grid grid-cols-4 divide-x divide-rule overflow-hidden rounded-lg border border-rule text-left transition-colors hover:border-ink-3">
        <span v-for="r in resources" :key="r.label" class="min-w-0 px-2.5 py-1.5" :class="r.level === 'crit' ? 'bg-stop-soft' : r.level === 'warn' ? 'bg-caution-soft' : 'bg-go-soft'">
          <span class="label block">{{ r.label }}</span>
          <span class="block truncate font-mono text-[14px] font-semibold tabular-nums" :class="r.level === 'crit' ? 'text-stop' : r.level === 'warn' ? 'text-caution' : 'text-go'" :title="r.title">{{ r.value }}</span>
        </span>
      </button>

      <div v-if="cluster.problems?.length" class="mt-auto grid rounded-md bg-stop-soft px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-stop">
        <span v-for="p in cluster.problems" :key="p">! {{ p }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.rack { animation: rise .5s cubic-bezier(.2, .7, .2, 1) both; animation-delay: calc(var(--i, 0) * 70ms); }
</style>
