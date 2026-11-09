<script setup>
// Plain-language detail for one RabbitMQ node: what each number means and what happens when it crosses its limit.
import { computed } from 'vue';
import { bytes } from '../format.js';

const props = defineProps({ node: Object, cluster: Object, color: String });
const emit = defineEmits(['close']);

const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
const ram = computed(() => pct(props.node?.mem_used, props.node?.mem_limit));
const load = computed(() => (props.node?.processors ? props.node.run_queue / props.node.processors : null));
const diskHeadroom = computed(() => (props.node?.disk_free_limit ? props.node.disk_free / props.node.disk_free_limit : null));
const level = (v, warn, crit) => (v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok');
const ramLevel = computed(() => (props.node?.mem_alarm ? 'crit' : level(ram.value, 75, 90)));
const diskLevel = computed(() => (props.node?.disk_alarm ? 'crit' : diskHeadroom.value === null ? 'ok' : diskHeadroom.value < 2 ? 'crit' : diskHeadroom.value < 5 ? 'warn' : 'ok'));
const cpuLevel = computed(() => (load.value === null ? 'ok' : load.value > 1 ? 'crit' : load.value > 0.7 ? 'warn' : 'ok'));
const verdict = computed(() => {
  const n = props.node; if (!n) return null;
  if (!n.running) return { level: 'crit', text: 'This node is stopped. The cluster keeps working on the other nodes if it has a majority, but it has lost redundancy.' };
  const issues = [];
  if (n.mem_alarm) issues.push('memory alarm — publishers are blocked');
  if (n.disk_alarm) issues.push('disk alarm — publishers are blocked');
  if (n.partitions?.length) issues.push('cut off from ' + n.partitions.join(', '));
  if (issues.length) return { level: 'crit', text: 'Needs attention: ' + issues.join('; ') + '.' };
  const warn = [ramLevel.value, diskLevel.value, cpuLevel.value].includes('warn');
  return warn ? { level: 'warn', text: 'Running, but one resource is getting close to its limit (see below).' } : { level: 'ok', text: 'Healthy — memory, disk and CPU are all well within their limits.' };
});
const tone = { ok: 'text-go', warn: 'text-caution', crit: 'text-stop' };
const bar = { ok: 'bg-go', warn: 'bg-caution', crit: 'bg-stop' };
function uptime(ms) {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}
</script>

<template>
  <Transition enter-from-class="translate-x-full" enter-active-class="transition duration-200" leave-to-class="translate-x-full" leave-active-class="transition duration-150">
    <aside v-if="node" class="fixed inset-y-0 right-0 z-[15] flex w-full max-w-[560px] flex-col border-l border-rule bg-panel shadow-[-20px_0_60px_-30px_rgba(0,0,0,.5)]"
      role="dialog" :aria-label="`Node ${node.name}`" @keydown.esc="emit('close')">
      <header class="flex items-start gap-3 border-b border-rule px-5 py-4" :style="{ background: `color-mix(in srgb, ${color} 8%, var(--panel))` }">
        <div class="min-w-0 flex-1">
          <span class="label">{{ cluster?.name }} · node</span>
          <h2 class="m-0 mt-0.5 font-mono text-[17px] font-semibold break-all">{{ node.name }}</h2>
        </div>
        <button type="button" class="btn" @click="emit('close')">Close</button>
      </header>

      <div class="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <p v-if="verdict" class="m-0 flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-[14px] leading-relaxed"
          :class="verdict.level === 'crit' ? 'bg-stop-soft' : verdict.level === 'warn' ? 'bg-caution-soft' : 'bg-panel-2'">
          <span class="led mt-1.5" :class="verdict.level === 'crit' && 'off'"></span>
          <span>{{ verdict.text }}</span>
        </p>

        <template v-if="node.running">
          <!-- RAM -->
          <section class="space-y-2">
            <div class="flex items-baseline justify-between gap-3">
              <h3 class="m-0 text-[14px] font-bold">Memory</h3>
              <span class="font-mono text-[13px] font-semibold" :class="tone[ramLevel]">{{ ram }}% of limit</span>
            </div>
            <div class="h-2.5 overflow-hidden rounded-full bg-seg"><i class="block h-full rounded-full" :class="bar[ramLevel]" :style="{ width: ram + '%' }"></i></div>
            <p class="m-0 font-mono text-xs text-ink-2">{{ bytes(node.mem_used) }} used · limit (watermark) {{ bytes(node.mem_limit) }}</p>
            <p class="m-0 text-[13px] leading-relaxed text-ink-2">When memory reaches the limit, RabbitMQ <b>stops accepting new messages</b> from publishers until it drops again — apps that publish will slow down or time out. Usually caused by a big backlog of messages waiting.</p>
          </section>

          <!-- Disk -->
          <section class="space-y-2">
            <div class="flex items-baseline justify-between gap-3">
              <h3 class="m-0 text-[14px] font-bold">Disk</h3>
              <span class="font-mono text-[13px] font-semibold" :class="tone[diskLevel]">{{ bytes(node.disk_free) }} free</span>
            </div>
            <p class="m-0 font-mono text-xs text-ink-2">free space on the data disk · blocks publishers below {{ bytes(node.disk_free_limit) }}</p>
            <p class="m-0 text-[13px] leading-relaxed text-ink-2">Messages are written to disk. If free space falls below the limit, RabbitMQ <b>blocks publishers</b> to protect its data. More than a few times the limit free is comfortable.</p>
          </section>

          <!-- CPU -->
          <section class="space-y-2">
            <div class="flex items-baseline justify-between gap-3">
              <h3 class="m-0 text-[14px] font-bold">CPU</h3>
              <span class="font-mono text-[13px] font-semibold" :class="tone[cpuLevel]">{{ node.processors ?? '—' }} cores · load {{ load === null ? '—' : load.toFixed(1) }}</span>
            </div>
            <p class="m-0 font-mono text-xs text-ink-2">run queue {{ node.run_queue ?? '—' }} (Erlang processes waiting for a CPU core)</p>
            <p class="m-0 text-[13px] leading-relaxed text-ink-2">RabbitMQ doesn't report CPU %. <b>Load</b> = processes waiting ÷ cores: below 1 means the CPU keeps up; above 1 means work is queuing for the CPU and messages are handled late.</p>
          </section>

          <!-- Connections / uptime -->
          <section class="grid grid-cols-3 gap-3 border-t border-rule pt-4">
            <div><span class="label">sockets</span><div class="font-mono text-[15px] font-semibold">{{ node.sockets_used ?? '—' }}<span v-if="node.sockets_total" class="text-xs font-normal text-ink-3"> / {{ node.sockets_total }}</span></div></div>
            <div><span class="label">open files</span><div class="font-mono text-[15px] font-semibold">{{ node.fd_used ?? '—' }}<span v-if="node.fd_total" class="text-xs font-normal text-ink-3"> / {{ node.fd_total }}</span></div></div>
            <div><span class="label">up for</span><div class="font-mono text-[15px] font-semibold">{{ uptime(node.uptime) }}</div></div>
          </section>
          <p class="m-0 text-[12px] text-ink-3">Sockets = client connections (apps, workers, shovels). If they reach the max, new connections are refused.</p>
        </template>
      </div>
    </aside>
  </Transition>
</template>
