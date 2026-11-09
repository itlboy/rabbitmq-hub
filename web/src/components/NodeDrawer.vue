<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
// Every node of one cluster: memory, disk, CPU load, sockets, uptime — with one plain-language legend at the bottom.
import { computed } from 'vue';
import { bytes } from '../format.js';

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
  if (down) return { level: 'crit', text: `${down} of ${r.length} node(s) stopped. The cluster keeps serving if the rest still form a majority, but redundancy is reduced.` };
  if (r.some((n) => n.alerts.length)) return { level: 'crit', text: 'A node has an alarm: publishers are blocked until it clears.' };
  if (r.some((n) => [n.ramLevel, n.diskLevel, n.cpuLevel].includes('warn'))) return { level: 'warn', text: 'All nodes running; one resource is getting close to its limit.' };
  return { level: 'ok', text: `All ${r.length} node(s) running with plenty of headroom.` };
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
          <span class="label">nodes · RabbitMQ {{ cluster.version }}</span>
          <h2 class="m-0 mt-0.5 text-[17px] font-bold">{{ cluster.name }}</h2>
        </div>
        <button type="button" class="btn" @click="emit('close')">Close</button>
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
            <span class="font-mono text-[11px] text-ink-3">{{ n.running ? 'up ' + uptime(n.uptime) : 'stopped' }}</span>
          </div>
          <p v-if="n.alerts.length" class="m-0 font-mono text-xs text-stop">{{ n.alerts.join(' · ') }}</p>
          <dl v-if="n.running" class="m-0 grid grid-cols-[3.2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 font-mono text-xs">
            <dt class="label">RAM</dt>
            <dd class="m-0 h-2 overflow-hidden rounded-full bg-seg"><i class="block h-full rounded-full" :class="bar[n.ramLevel]" :style="{ width: Math.max(2, n.ram) + '%' }"></i></dd>
            <dd class="m-0 text-right whitespace-nowrap" :class="tone[n.ramLevel]"><b>{{ n.ram }}%</b> · {{ bytes(n.mem_used) }} / {{ bytes(n.mem_limit) }}</dd>
            <dt class="label">Disk</dt>
            <dd class="m-0 text-ink-3">free</dd>
            <dd class="m-0 text-right whitespace-nowrap" :class="tone[n.diskLevel]"><b>{{ bytes(n.disk_free) }}</b> · limit {{ bytes(n.disk_free_limit) }}</dd>
            <dt class="label">CPU</dt>
            <dd class="m-0 text-ink-3">{{ n.processors ?? '—' }} cores</dd>
            <dd class="m-0 text-right whitespace-nowrap" :class="tone[n.cpuLevel]">load <b>{{ n.load === null ? '—' : n.load.toFixed(1) }}</b></dd>
            <dt class="label">Conns</dt>
            <dd class="m-0 text-ink-3">sockets · files</dd>
            <dd class="m-0 text-right whitespace-nowrap text-ink-2">{{ n.sockets_used ?? '—' }} · {{ n.fd_used ?? '—' }}</dd>
          </dl>
        </article>

        <section class="space-y-2 border-t border-rule pt-4 text-[13px] leading-relaxed text-ink-2">
          <h3 class="label m-0">What these mean</h3>
          <p class="m-0"><span class="font-semibold text-go">Green</span> = well within limits · <span class="font-semibold text-caution">amber</span> = getting close · <span class="font-semibold text-stop">red</span> = at or over the limit, act now.
            Thresholds: RAM amber from 75%, red from 90% · Disk amber below 5× the limit, red below 2× · CPU load amber from 0.7, red from 1.</p>
          <p class="m-0"><b class="text-ink">RAM</b> — memory used as a share of the limit (watermark). At 100% RabbitMQ <b>stops accepting new messages</b> until memory drops; publishing apps slow down or time out. A big backlog is the usual cause.</p>
          <p class="m-0"><b class="text-ink">Disk</b> — free space for message data. Below the limit RabbitMQ <b>blocks publishers</b> to protect its data. Several times the limit free is comfortable.</p>
          <p class="m-0"><b class="text-ink">CPU load</b> — processes waiting for a CPU core ÷ number of cores (RabbitMQ has no CPU %). Under 1 the CPU keeps up; over 1 work queues for the CPU and messages are handled late. In Kubernetes the core count is the whole machine's.</p>
          <p class="m-0"><b class="text-ink">Conns</b> — open client connections (apps, workers, shovels) and open files.</p>
        </section>
      </div>
    </section>
    </div>
  </Transition>
</template>
