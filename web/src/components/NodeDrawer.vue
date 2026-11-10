<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
// Every node of one cluster: memory, disk, CPU load, sockets, uptime — with one plain-language legend at the bottom.
import { computed } from 'vue';
import { bytes } from '../format.js';
import { t } from '../i18n.js';

const props = defineProps({ cluster: Object, color: String });
const emit = defineEmits(['close']);

const lvl = (v, w, c) => (v >= c ? 'crit' : v >= w ? 'warn' : 'ok');
const rows = computed(() => (props.cluster?.nodes || []).map((n) => {
  const ram = n.mem_limit ? Math.min(100, Math.round((n.mem_used / n.mem_limit) * 100)) : 0;
  const load = n.processors ? n.run_queue / n.processors : null;
  const diskRatio = n.disk_free_limit ? n.disk_free / n.disk_free_limit : null;
  return {
    ...n, ram, load,
    ramLevel: n.mem_alarm ? 'crit' : lvl(ram, 75, 90),
    diskLevel: n.disk_alarm ? 'crit' : diskRatio === null ? 'ok' : diskRatio < 2 ? 'crit' : diskRatio < 5 ? 'warn' : 'ok',
    cpuLevel: load === null ? 'ok' : lvl(load, 0.7, 1),
    alerts: [n.mem_alarm && 'memory alarm — publishers blocked', n.disk_alarm && 'disk alarm — publishers blocked',
      n.partitions?.length && 'cut off from ' + n.partitions.join(', ')].filter(Boolean),
  };
}));
const summary = computed(() => {
  const r = rows.value; const down = r.filter((n) => !n.running).length;
  if (down) return { level: 'crit', text: t('nodes_down', { d: down, n: r.length }) };
  if (r.some((n) => n.alerts.length)) return { level: 'crit', text: t('node_alarm') };
  if (r.some((n) => [n.ramLevel, n.diskLevel, n.cpuLevel].includes('warn'))) return { level: 'warn', text: t('node_warn') };
  return { level: 'ok', text: t('nodes_ok', { n: r.length }) };
});
const tone = { ok: 'text-go', warn: 'text-caution', crit: 'text-stop' };
const bar = { ok: 'bg-go', warn: 'bg-caution', crit: 'bg-stop' };
function uptime(ms) {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}
const onEsc = (e) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onEsc));
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc));
</script>

<template>
  <Transition enter-from-class="opacity-0 [&>div]:scale-95" enter-active-class="transition duration-150" leave-to-class="opacity-0" leave-active-class="transition duration-100">
    <div v-if="cluster" class="fixed inset-0 z-[15] flex items-center justify-center bg-scrim p-3 sm:p-6" @click.self="emit('close')">
    <section class="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-rule bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,.5)] transition-transform duration-150"
      role="dialog" :aria-label="`Nodes of ${cluster.name}`" aria-modal="true">
      <header class="flex items-start gap-3 border-b border-rule bg-panel-2 px-5 py-4">
        <div class="min-w-0 flex-1">
          <span class="label">{{ t('nodes_title', { v: cluster.version }) }}</span>
          <h2 class="m-0 mt-0.5 text-[17px] font-bold">{{ cluster.name }}</h2>
        </div>
        <button type="button" class="btn" @click="emit('close')">{{ t('close') }}</button>
      </header>

      <div class="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <p class="m-0 flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-[14px] leading-relaxed"
          :class="summary.level === 'crit' ? 'bg-stop-soft' : summary.level === 'warn' ? 'bg-caution-soft' : 'bg-panel-2'">
          <span class="led mt-1.5" :class="summary.level === 'crit' && 'off'"></span><span>{{ summary.text }}</span>
        </p>

        <article v-for="n in rows" :key="n.name" class="space-y-2.5 rounded-lg border border-rule p-3.5" :class="!n.running && 'bg-stop-soft'">
          <div class="flex items-center gap-2">
            <span class="led" :class="(!n.running || n.alerts.length) && 'off'"></span>
            <b class="min-w-0 flex-1 truncate font-mono text-[13px]">{{ n.name }}</b>
            <span class="font-mono text-[11px] text-ink-3">{{ n.running ? t('up_for', { t: uptime(n.uptime) }) : t('stopped') }}</span>
          </div>
          <p v-if="n.alerts.length" class="m-0 font-mono text-xs text-stop">{{ n.alerts.join(' · ') }}</p>
          <dl v-if="n.running" class="m-0 grid grid-cols-[3.2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 font-mono text-xs">
            <dt class="label">RAM</dt>
            <dd class="m-0 h-2 overflow-hidden rounded-full bg-seg"><i class="block h-full rounded-full" :class="bar[n.ramLevel]" :style="{ width: Math.max(2, n.ram) + '%' }"></i></dd>
            <dd class="m-0 text-right whitespace-nowrap" :class="tone[n.ramLevel]"><b>{{ n.ram }}%</b> · {{ bytes(n.mem_used) }} / {{ bytes(n.mem_limit) }}</dd>
            <dt class="label">{{ t('disk') }}</dt>
            <dd class="m-0 text-ink-3">{{ t('free') }}</dd>
            <dd class="m-0 text-right whitespace-nowrap" :class="tone[n.diskLevel]"><b>{{ bytes(n.disk_free) }}</b> · {{ t('limit') }} {{ bytes(n.disk_free_limit) }}</dd>
            <dt class="label">CPU</dt>
            <dd class="m-0 text-ink-3">{{ t('cores', { n: n.processors ?? '—' }) }}</dd>
            <dd class="m-0 text-right whitespace-nowrap" :class="tone[n.cpuLevel]">{{ t('load') }} <b>{{ n.load === null ? '—' : n.load.toFixed(1) }}</b></dd>
            <dt class="label">{{ t('conns') }}</dt>
            <dd class="m-0 text-ink-3">{{ t('sockets_files') }}</dd>
            <dd class="m-0 text-right whitespace-nowrap text-ink-2">{{ n.sockets_used ?? '—' }} · {{ n.fd_used ?? '—' }}</dd>
          </dl>
        </article>

        <section class="space-y-2 border-t border-rule pt-4 text-[13px] leading-relaxed text-ink-2">
          <h3 class="label m-0">{{ t('what_mean') }}</h3>
          <p v-for="k in ['legend_colors', 'legend_ram', 'legend_disk', 'legend_cpu', 'legend_conns']" :key="k" class="m-0">{{ t(k) }}</p>
        </section>
      </div>
    </section>
    </div>
  </Transition>
</template>
