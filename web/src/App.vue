<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, isMock } from './api.js';
import { fmt, store } from './format.js';
import ThemeToggle from './components/ThemeToggle.vue';
import FlowStrip from './components/FlowStrip.vue';
import ClusterRack from './components/ClusterRack.vue';
import QueueTable from './components/QueueTable.vue';
import PurgeDialog from './components/PurgeDialog.vue';

const REFRESH = 10;
const me = ref(null);
const fatal = ref('');
const clusters = ref([]);
const clustersError = ref('');
const selectedId = ref(store.get('hub.sel'));
const queues = ref([]);
const queuesError = ref('');
const updatedAt = ref('');
const tick = ref(0);
const purgeTarget = ref(null);
const purgeBusy = ref(false);
const purgeError = ref('');
const toast = ref('');

const selected = computed(() => clusters.value.find((c) => c.id === selectedId.value));
const unhealthy = computed(() => clusters.value.filter((c) => !c.ok).length);
const canPurge = computed(() => me.value?.role === 'admin' && !!selected.value?.allow_purge);

async function loadClusters() {
  try {
    clusters.value = await api.clusters();
    clustersError.value = '';
    if (!clusters.value.some((c) => c.id === selectedId.value)) selectedId.value = clusters.value[0]?.id;
    updatedAt.value = new Date().toLocaleTimeString('en-GB');
  } catch (e) { clustersError.value = e.message; }
}
async function loadQueues() {
  if (!selectedId.value) return;
  try { queues.value = await api.queues(selectedId.value); queuesError.value = ''; }
  catch (e) { queuesError.value = e.message; }
}
async function refresh() { await loadClusters(); await loadQueues(); }
function pick(id) { selectedId.value = id; store.set('hub.sel', id); queues.value = []; loadQueues(); }

function openPurge(q) { purgeError.value = ''; purgeTarget.value = q; }
async function confirmPurge(typed) {
  const q = purgeTarget.value; purgeBusy.value = true; purgeError.value = '';
  try {
    const r = await api.purge(selectedId.value, { vhost: q.vhost, queue: q.name, confirm: typed });
    purgeTarget.value = null;
    showToast(`Emptied ${q.name} · ${fmt(r.purged ?? 0)} messages deleted`);
    refresh();
  } catch (e) { purgeError.value = e.message; }
  finally { purgeBusy.value = false; }
}
let toastTimer;
function showToast(t) { toast.value = t; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.value = ''), 4500); }

let timer;
onMounted(async () => {
  try {
    me.value = await api.me();
    if (me.value.title) document.title = me.value.title;
  } catch (e) { fatal.value = e.message; return; }
  await refresh();
  timer = setInterval(() => {
    tick.value = (tick.value + 1) % REFRESH;
    if (tick.value === 0 && !purgeTarget.value) refresh();
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="fixed inset-x-0 top-0 z-10 h-[env(safe-area-inset-top,0px)] bg-panel"></div>
  <div v-if="isMock" class="gutter bg-caution-soft py-1.5 font-mono text-[11px] tracking-wide text-caution">
    MOCKUP · example data, not a real cluster · signed in as admin so the Empty button shows
  </div>

  <header class="sticky top-[env(safe-area-inset-top,0px)] z-[6] border-b border-rule bg-panel/90 backdrop-blur">
    <div class="gutter mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div class="flex items-center gap-2.5">
        <span class="grid size-7 grid-cols-[repeat(3,4px)] place-content-center gap-[3px] rounded-[7px] bg-ink" aria-hidden="true">
          <i v-for="n in 9" :key="n" class="size-1 rounded-[1px]" :class="n === 5 ? 'bg-signal' : 'bg-panel'"></i>
        </span>
        <b class="text-[15px] font-bold tracking-tight">{{ me?.title || 'RabbitMQ Hub' }}</b>
        <span class="label max-md:hidden">routing board</span>
      </div>
      <span v-if="clusters.length" class="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-xs font-medium"
        :class="unhealthy ? 'border-transparent bg-stop-soft text-stop' : 'border-rule bg-panel-2'">
        <span class="led" :class="unhealthy && 'off'"></span>
        {{ unhealthy ? `${unhealthy}/${clusters.length} need attention` : `${clusters.length}/${clusters.length} healthy` }}
      </span>
      <span class="flex-1"></span>
      <span class="inline-flex items-center gap-2 font-mono text-[11px] text-ink-3 max-md:hidden" :title="`Refreshes every ${REFRESH}s`">
        <span class="size-3.5 rounded-full" :style="{
          background: `conic-gradient(var(--signal) ${(tick / REFRESH) * 100}%, var(--seg) 0)`,
          mask: 'radial-gradient(circle, transparent 4px, #000 4.5px)', WebkitMask: 'radial-gradient(circle, transparent 4px, #000 4.5px)' }"></span>
        {{ updatedAt || 'connecting' }}
      </span>
      <ThemeToggle />
      <span v-if="me" class="inline-flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
        <span class="max-w-60 truncate max-sm:max-w-36">{{ me.email }}</span>
        <span class="rounded border px-1.5 py-1 font-mono text-[10px] leading-none font-semibold uppercase tracking-[.08em]"
          :class="me.role === 'admin' ? 'border-signal bg-signal text-white' : 'border-rule text-ink-2'">{{ me.role }}</span>
      </span>
    </div>
  </header>

  <main class="gutter mx-auto grid max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-4 pt-4 pb-10">
    <p v-if="fatal" class="m-0 font-mono text-[13px] text-stop">{{ fatal }}</p>
    <template v-else>
      <FlowStrip :clusters="clusters" @pick="pick" />
      <p v-if="clustersError" class="m-0 font-mono text-[13px] text-stop">{{ clustersError }}</p>
      <p v-else-if="!clusters.length" class="m-0 text-ink-3">Loading clusters…</p>
      <section class="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Clusters">
        <ClusterRack v-for="(c, i) in clusters" :key="c.id" :cluster="c" :index="i" :selected="c.id === selectedId" @pick="pick(c.id)" />
      </section>
      <QueueTable :cluster="selected" :queues="queues" :can-purge="canPurge" :error="queuesError" @purge="openPurge" />
    </template>
  </main>

  <PurgeDialog :target="purgeTarget" :cluster-name="selected?.name" :busy="purgeBusy" :error="purgeError"
    @cancel="purgeTarget = null" @confirm="confirmPurge" />

  <Transition enter-from-class="opacity-0 translate-y-2" enter-active-class="transition" leave-to-class="opacity-0" leave-active-class="transition">
    <div v-if="toast" role="status"
      class="fixed right-[max(16px,env(safe-area-inset-right,0px))] bottom-[max(16px,env(safe-area-inset-bottom,0px))] z-[21] rounded-lg bg-ink px-4 py-3 font-mono text-xs font-medium text-panel">
      {{ toast }}
    </div>
  </Transition>
</template>
