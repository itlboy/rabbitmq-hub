<script setup>
import { computed, ref } from 'vue';
import { fmt, rate } from '../format.js';
import Sparkline from './Sparkline.vue';
import ShovelList from './ShovelList.vue';
import Spinner from './Spinner.vue';

const props = defineProps({ cluster: Object, queues: { type: Array, default: () => [] }, canPurge: Boolean, error: String,
  tab: { type: String, default: 'queues' }, color: { type: String, default: 'var(--signal)' }, shovels: { type: Array, default: () => [] }, shovelsError: String, shovelsLoading: Boolean, activeQueue: String, loading: Boolean });
const emit = defineEmits(['purge', 'open', 'tab']);

const filter = ref('');
const hideMinor = ref(true);
const onlyWithMessages = ref(false);
const sortKey = ref('messages');
const sortDesc = ref(true);
const columns = [
  { k: 'name', label: 'Queue', left: true }, { k: 'type', label: 'Type', left: true }, { k: 'messages', label: 'Depth' }, { k: 'ready', label: 'Ready' },
  { k: 'unacked', label: 'Unacked' }, { k: 'consumers', label: 'Consumers' }, { k: 'publish', label: 'In/s' }, { k: 'deliver', label: 'Out/s' },
];

const rows = computed(() => {
  const f = filter.value.toLowerCase();
  const r = props.queues.filter((q) => (!f || q.name.toLowerCase().includes(f)) && (!hideMinor.value || !q.minor) && (!onlyWithMessages.value || q.messages > 0));
  const k = sortKey.value;
  return r.sort((a, b) => { const x = a[k], y = b[k]; const d = typeof x === 'string' ? x.localeCompare(y) : x - y; return sortDesc.value ? -d : d; });
});
const max = computed(() => Math.max(1, ...rows.value.map((q) => q.messages)));
// Waiting messages, no consumer and nothing being taken out: probably no worker at all.
const stuck = (q) => !q.consumers && q.messages > 0 && !q.deliver && !q.minor;
function sortBy(k) { sortDesc.value = sortKey.value === k ? !sortDesc.value : k !== 'name'; sortKey.value = k; }
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-rule bg-panel" aria-label="Queues">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-rule px-4 py-3.5">
      <div class="flex items-center gap-1 rounded-md border border-rule bg-panel-2 p-0.5" role="tablist">
        <button v-for="t in [{ id: 'queues', label: 'Queues', n: queues.length }, ...(cluster?.shovels ? [{ id: 'shovels', label: 'Shovels', n: cluster.shovels.total, bad: cluster.shovels.bad.length }] : [])]" :key="t.id"
          type="button" role="tab" :aria-selected="tab === t.id" @click="emit('tab', t.id)"
          class="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[13px] font-semibold transition-colors"
          :class="tab === t.id ? 'bg-panel text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-ink-3 hover:text-ink'">
          {{ t.label }} <span class="font-mono text-[11px] font-normal" :class="t.bad ? 'text-stop' : 'text-ink-3'">{{ t.bad ? `${t.bad}!` : t.n }}</span>
        </button>
      </div>
      <span v-if="cluster" class="text-[13px] font-medium text-ink-3">{{ cluster.name }}</span>
      <span v-if="cluster && !cluster.allow_purge" class="rounded bg-caution-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[.08em] text-caution">read-only</span>
      <div v-if="tab === 'queues'" class="flex w-full flex-wrap items-center gap-3 md:ml-auto md:w-auto">
        <label class="relative w-full md:w-64">
          <svg class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input v-model="filter" id="queue-filter" type="search" placeholder="filter queues" aria-label="Filter queues"
            class="w-full rounded-md border border-rule bg-panel-2 py-1.5 pr-2.5 pl-8 font-mono text-xs text-ink outline-none focus:border-signal">
        </label>
        <label class="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2 select-none"><input id="hide-minor" v-model="hideMinor" type="checkbox" class="accent-[var(--signal)]"> Hide minor</label>
        <label class="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2 select-none"><input id="only-msgs" v-model="onlyWithMessages" type="checkbox" class="accent-[var(--signal)]"> With messages</label>
        <span class="font-mono text-[11px] text-ink-3">{{ rows.length }}/{{ queues.length }}</span>
      </div>
    </div>

    <ShovelList v-if="tab === 'shovels'" :shovels="shovels" :error="shovelsError" :loading="shovelsLoading" @open="(n) => emit('open', n)" />
    <div v-else class="overflow-x-auto">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th v-for="c in columns" :key="c.k" @click="sortBy(c.k)" scope="col"
              class="cursor-pointer border-b border-rule bg-panel-2 px-3 py-2 font-mono text-[10px] font-medium whitespace-nowrap uppercase tracking-[.08em] select-none"
              :class="[c.left ? 'text-left' : 'text-right', sortKey === c.k ? 'text-ink' : 'text-ink-3']">
              {{ c.label }}<span v-if="sortKey === c.k" class="ml-1 text-signal">{{ sortDesc ? '▼' : '▲' }}</span>
            </th>
            <th class="border-b border-rule bg-panel-2" aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody class="font-mono text-xs tabular-nums">
          <tr v-if="error"><td colspan="9" class="px-4 py-10 text-center text-stop">{{ error }}</td></tr>
          <tr v-else-if="loading && !queues.length"><td colspan="9" class="px-4 py-10 text-center"><Spinner label="Loading queues…" /></td></tr>
          <tr v-else-if="!rows.length"><td colspan="9" class="px-4 py-10 text-center font-sans text-ink-3">{{ queues.length ? 'No queues match these filters.' : cluster ? 'This cluster has no queues yet.' : 'Pick a cluster to read its queues.' }}</td></tr>
          <tr v-for="(q, i) in rows" :key="q.vhost + q.name" class="group cursor-pointer border-b border-rule/60 last:border-0"
            :class="[(q.hot ?? q.messages > 1000) ? 'bg-caution-soft/70' : i % 2 ? 'bg-[color-mix(in_srgb,var(--seg)_45%,var(--panel))] hover:bg-seg/70' : 'hover:bg-seg/70', activeQueue === q.name && '!bg-seg/70']"
            tabindex="0" @click="emit('open', q.name)" @keydown.enter="emit('open', q.name)">
            <td class="max-w-[28rem] truncate px-3 py-1.5 font-medium whitespace-nowrap text-ink" :title="q.name">{{ q.name }}</td>
            <td class="px-3 py-1.5">
              <span class="rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[.06em]" :class="q.type === 'quorum' ? 'bg-quorum/12 text-quorum' : q.type === 'classic' ? 'bg-classic/12 text-classic' : 'bg-panel-2 text-ink-2'">{{ q.type }}</span>
            </td>
            <td class="px-3 py-1.5 text-right whitespace-nowrap">
              <span class="inline-flex items-center justify-end gap-2.5">
                <Sparkline v-if="q.history?.length" :values="q.history" :width="72" :height="18" :color="color" class="max-md:hidden" />
                <span v-else-if="q.messages" class="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-seg"><i class="block h-full bg-signal" :style="{ width: Math.max(4, (q.messages / max) * 100) + '%' }"></i></span>
                <span :class="!q.messages && 'text-ink-3/60'">{{ fmt(q.messages) }}</span>
              </span>
            </td>
            <td class="px-3 py-1.5 text-right" :class="!q.ready && 'text-ink-3/60'">{{ fmt(q.ready) }}</td>
            <td class="px-3 py-1.5 text-right" :class="!q.unacked && 'text-ink-3/60'">{{ fmt(q.unacked) }}</td>
            <td class="px-3 py-1.5 text-right" :class="!q.consumers ? (stuck(q) ? 'font-semibold text-stop' : 'text-ink-3/60') : ''" :title="stuck(q) ? 'Messages waiting, no consumer and nothing taken out — is any worker running?' : !q.consumers && q.deliver ? 'No consumer attached, but messages are being taken out (workers polling with basic.get)' : ''">{{ fmt(q.consumers) }}<span v-if="stuck(q)" class="ml-1">!</span></td>
            <td class="px-3 py-1.5 text-right" :class="q.publish ? 'text-signal' : 'text-ink-3/60'">{{ rate(q.publish) }}</td>
            <td class="px-3 py-1.5 text-right" :class="q.deliver ? 'text-out' : 'text-ink-3/60'">{{ rate(q.deliver) }}</td>
            <td class="w-px py-1 pr-3 pl-1">
              <button v-if="canPurge" type="button" class="btn !py-0.5 hover:enabled:border-stop hover:enabled:bg-stop-soft hover:enabled:text-stop"
                :disabled="!q.messages" @click.stop="emit('purge', q)">Empty</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
