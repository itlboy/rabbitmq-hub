<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, isMock } from './api.js';
import { fmt, store } from './format.js';
import ThemeToggle from './components/ThemeToggle.vue';
import FlowStrip from './components/FlowStrip.vue';
import ClusterRack from './components/ClusterRack.vue';
import QueueTable from './components/QueueTable.vue';
import PurgeDialog from './components/PurgeDialog.vue';
import QueueDrawer from './components/QueueDrawer.vue';
import NodeDrawer from './components/NodeDrawer.vue';
import Spinner from './components/Spinner.vue';
import { t, lang, setLang, LANGS } from './i18n.js';

const REFRESH = 10;
const me = ref(null);
const fatal = ref('');
const clusters = ref([]);
const clustersError = ref('');
const selectedId = ref(store.get('hub.sel'));
const queues = ref([]);
const queuesError = ref('');
const tab = ref('queues');
const queuesLoading = ref(false);
const refreshing = ref(false);
const shovels = ref([]);
const shovelsError = ref('');
const shovelsLoading = ref(false);
const openQueueName = ref('');
const nodesClusterId = ref('');
const updatedAt = ref('');
const tick = ref(0);
const paused = ref(false);
const purgeTarget = ref(null);
const purgeBusy = ref(false);
const purgeError = ref('');
const toast = ref('');
const range = ref(['10m', '1h', '8h'].includes(store.get('hub.range')) ? store.get('hub.range') : '1h');
const rangeLabel = computed(() => t('r' + range.value));
function setRange(r) { range.value = r; store.set('hub.range', r); refresh(); }

const selected = computed(() => clusters.value.find((c) => c.id === selectedId.value));
// One neutral accent for every cluster (colour is reserved for status: green / amber / red).
const colors = computed(() => Object.fromEntries(clusters.value.map((c) => [c.id, 'var(--hue-1)'])));
const unhealthy = computed(() => clusters.value.filter((c) => !c.ok));
const canPurge = computed(() => me.value?.role === 'admin' && !!selected.value?.allow_purge);
const openQueue = computed(() => queues.value.find((q) => q.name === openQueueName.value) || null);
const nodesCluster = computed(() => clusters.value.find((c) => c.id === nodesClusterId.value) || null);
function showNodes(clusterId) { openQueueName.value = ''; writeHash(); nodesClusterId.value = clusterId; }

/* ---- deep links: #cluster or #cluster/queue (plain hash only) ---- */
function readHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!h) return;
  const [c, ...rest] = h.split('/');
  if (c) selectedId.value = c;
  openQueueName.value = rest.join('/') || '';
}
function writeHash() {
  const h = selectedId.value ? encodeURIComponent(selectedId.value) + (openQueueName.value ? '/' + encodeURIComponent(openQueueName.value) : '') : '';
  if (location.hash.replace(/^#/, '') !== h) history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

async function loadClusters() {
  try {
    clusters.value = await api.clusters(range.value);
    clustersError.value = '';
    if (!clusters.value.some((c) => c.id === selectedId.value)) selectedId.value = clusters.value[0]?.id;
    if (tab.value === 'shovels' && !selected.value?.shovels) tab.value = 'queues';
    updatedAt.value = new Date().toLocaleTimeString('en-GB');
  } catch (e) { clustersError.value = e.message; }
}
async function loadQueues() {
  if (!selectedId.value) return;
  const id = selectedId.value;
  queuesLoading.value = true;
  try { const q = await api.queues(id, range.value); if (id === selectedId.value) { queues.value = q; queuesError.value = ''; } }
  catch (e) { queuesError.value = e.message; }
  finally { if (id === selectedId.value) queuesLoading.value = false; }
}
async function loadShovels() {
  if (tab.value !== 'shovels' || !selectedId.value) return;
  shovelsLoading.value = true;
  try { shovels.value = await api.shovels(selectedId.value); shovelsError.value = ''; }
  catch (e) { shovelsError.value = e.message; }
  finally { shovelsLoading.value = false; }
}
async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true; tick.value = 0;
  try { await loadClusters(); await Promise.all([loadQueues(), loadShovels()]); }
  finally { refreshing.value = false; }
}
function pick(id, queueName = '') {
  if (id !== selectedId.value) { queues.value = []; shovels.value = []; }
  selectedId.value = id; store.set('hub.sel', id);
  openQueueName.value = queueName;
  if (queueName) tab.value = 'queues';
  writeHash(); loadQueues(); loadShovels();
}
function setTab(t) { tab.value = t; shovels.value = []; loadShovels(); }
function openQ(name) { nodesClusterId.value = ''; openQueueName.value = name; tab.value = 'queues'; writeHash(); }
function closeQ() { openQueueName.value = ''; writeHash(); }
function jumpToTrouble() { const c = unhealthy.value[0]; if (c) { pick(c.id); if (c.shovels?.bad?.length) setTab('shovels'); } }

function openPurge(q) { purgeError.value = ''; purgeTarget.value = q; }
async function confirmPurge(typed) {
  const q = purgeTarget.value; purgeBusy.value = true; purgeError.value = '';
  try {
    const r = await api.purge(selectedId.value, { vhost: q.vhost, queue: q.name, confirm: typed });
    purgeTarget.value = null;
    showToast(t('emptied', { q: q.name, n: fmt(r.purged ?? 0) }));
    // RabbitMQ's management stats lag ~5 s behind a purge: update the row right away (purge removes ready
    // messages only; unacked ones stay with their consumer), then re-read once the stats have caught up.
    const row = queues.value.find((x) => x.name === q.name && x.vhost === q.vhost);
    if (row) { const gone = row.ready; row.ready = 0; row.messages = row.unacked; row.hot = false;
      if (selected.value?.messages) selected.value.messages.messages = Math.max(0, (selected.value.messages.messages || 0) - gone); }
    setTimeout(refresh, 6000);
  } catch (e) { purgeError.value = e.message; }
  finally { purgeBusy.value = false; }
}
let toastTimer;
function showToast(t) { toast.value = t; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.value = ''), 4500); }

let timer;
const onHash = () => { readHash(); loadQueues(); loadShovels(); };
onMounted(async () => {
  readHash();
  window.addEventListener('hashchange', onHash);
  try {
    me.value = await api.me();
    if (me.value.title) document.title = me.value.title;
    setLang(me.value.locale || 'en', false);
  } catch (e) { fatal.value = e.message; return; }
  await refresh();
  timer = setInterval(() => {
    if (paused.value) return;
    tick.value = (tick.value + 1) % REFRESH;
    if (tick.value === 0 && !purgeTarget.value) refresh();
  }, 1000);
});
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('hashchange', onHash); });
</script>

<template>
  <div class="fixed inset-x-0 top-0 z-10 h-[env(safe-area-inset-top,0px)] bg-panel"></div>
  <div v-if="isMock" class="gutter bg-caution-soft py-1.5 font-mono text-[11px] tracking-wide text-caution">
    MOCKUP · example data, not a real cluster · signed in as admin so the Empty button shows
  </div>

  <header class="sticky top-[env(safe-area-inset-top,0px)] z-[6] border-b border-rule bg-panel/90 backdrop-blur">
    <div class="gutter mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <a href="/" class="flex items-center gap-2.5 rounded-md text-ink no-underline transition-opacity hover:opacity-80" :title="t('home')">
        <span class="grid size-7 grid-cols-[repeat(3,4px)] place-content-center gap-[3px] rounded-[7px] bg-ink" aria-hidden="true">
          <i v-for="n in 9" :key="n" class="size-1 rounded-[1px]" :style="{ background: [1, 3, 7, 9].includes(n) ? 'var(--panel)' : `var(--hue-${[0, 0, 1, 0, 2, 3, 4, 0, 5, 0][n]})` }"></i>
        </span>
        <b class="text-[15px] font-bold tracking-tight">{{ me?.title || 'RabbitMQ Hub' }}</b>
      </a>
      <button v-if="clusters.length" type="button" @click="jumpToTrouble" :disabled="!unhealthy.length"
        :title="unhealthy.length ? t('jump_to', { names: unhealthy.map((c) => c.name).join(', ') }) : ''"
        class="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-xs font-medium disabled:cursor-default"
        :class="unhealthy.length ? 'border-transparent bg-stop-soft text-stop hover:border-stop' : 'border-rule bg-panel-2'">
        <span class="led" :class="unhealthy.length && 'off'"></span>
        {{ unhealthy.length ? t('attention', { bad: unhealthy.length, n: clusters.length }) : t('healthy', { n: clusters.length }) }}
      </button>
      <span class="flex-1"></span>
      <span class="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
        <button type="button" class="inline-flex items-center gap-2 rounded px-1.5 py-1 hover:text-ink" @click="refresh" :title="t('refresh_now', { s: REFRESH })" :aria-label="t('refresh_now', { s: REFRESH })">
          <Spinner v-if="refreshing" :size="14" />
          <span v-else class="size-3.5 rounded-full" :style="{
            background: paused ? 'var(--seg)' : `conic-gradient(var(--signal) ${(tick / REFRESH) * 100}%, var(--seg) 0)`,
            mask: 'radial-gradient(circle, transparent 4px, #000 4.5px)', WebkitMask: 'radial-gradient(circle, transparent 4px, #000 4.5px)' }"></span>
          <span class="max-md:hidden">{{ updatedAt || t('connecting') }}</span>
        </button>
        <button type="button" class="rounded border border-rule px-1.5 py-0.5 text-[10px] uppercase tracking-[.06em] hover:text-ink" :aria-pressed="paused" @click="paused = !paused"
          :class="paused && 'border-caution bg-caution-soft text-caution'">{{ paused ? t('paused') : t('pause') }}</button>
      </span>
      <div class="inline-flex overflow-hidden rounded-md border border-rule bg-panel-2 font-mono text-[11px]" role="group" :aria-label="t('range')" :title="t('range')">
        <button v-for="(r, i) in ['10m', '1h', '8h']" :key="r" type="button" :aria-pressed="range === r" @click="setRange(r)"
          class="px-2 py-1.5 transition-colors" :class="[i && 'border-l border-rule', range === r ? 'bg-seg text-signal' : 'text-ink-3 hover:text-ink']">{{ r }}</button>
      </div>
      <div class="inline-flex overflow-hidden rounded-md border border-rule bg-panel-2 font-mono text-[11px]" role="group" aria-label="Language">
        <button v-for="(label, code, i) in LANGS" :key="code" type="button" :aria-pressed="lang === code" @click="setLang(code)"
          class="px-2 py-1.5 transition-colors" :class="[i && 'border-l border-rule', lang === code ? 'bg-seg text-signal' : 'text-ink-3 hover:text-ink']">{{ label }}</button>
      </div>
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
      <FlowStrip :clusters="clusters" :colors="colors" @pick="pick" />
      <p v-if="clustersError" class="m-0 font-mono text-[13px] text-stop">{{ clustersError }}</p>
      <template v-else-if="!clusters.length">
        <div class="h-[54px] animate-pulse rounded-xl border border-rule bg-panel"></div>
        <section class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading clusters" aria-busy="true">
          <div v-for="n in 4" :key="n" class="grid h-[300px] animate-pulse content-start gap-3 overflow-hidden rounded-xl border border-rule bg-panel p-4">
            <div class="h-4 w-1/2 rounded bg-seg"></div><div class="h-3 w-2/3 rounded bg-seg"></div>
            <div class="mt-3 h-8 w-1/3 rounded bg-seg"></div><div class="h-12 rounded-lg bg-seg"></div><div class="h-12 rounded-lg bg-seg"></div>
          </div>
        </section>
        <Spinner :label="t('connecting_clusters')" />
      </template>
      <section class="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Clusters">
        <ClusterRack v-for="(c, i) in clusters" :key="c.id" :cluster="c" :index="i" :range-label="rangeLabel" :color="colors[c.id]" :selected="c.id === selectedId" @pick="pick(c.id)" @nodes="showNodes(c.id)" />
      </section>
      <QueueTable :cluster="selected" :color="colors[selectedId]" :queues="queues" :loading="queuesLoading" :can-purge="canPurge" :error="queuesError" :tab="tab" :shovels="shovels"
        :shovels-error="shovelsError" :shovels-loading="shovelsLoading" :active-queue="openQueueName"
        @purge="openPurge" @open="openQ" @tab="setTab" />
    </template>
  </main>

  <NodeDrawer :cluster="nodesCluster" :color="colors[nodesClusterId]" @close="nodesClusterId = ''" />
  <QueueDrawer :queue="openQueue" :cluster="selected" :me="me" :can-purge="canPurge" @purge="openPurge" :range-label="range === '8h' ? t('r1h') : rangeLabel" @close="closeQ" @pick="pick" />

  <PurgeDialog :target="purgeTarget" :cluster-name="selected?.name" :busy="purgeBusy" :error="purgeError"
    @cancel="purgeTarget = null" @confirm="confirmPurge" />

  <Transition enter-from-class="opacity-0 translate-y-2" enter-active-class="transition" leave-to-class="opacity-0" leave-active-class="transition">
    <div v-if="toast" role="status"
      class="fixed right-[max(16px,env(safe-area-inset-right,0px))] bottom-[max(16px,env(safe-area-inset-bottom,0px))] z-[21] rounded-lg bg-ink px-4 py-3 font-mono text-xs font-medium text-panel">
      {{ toast }}
    </div>
  </Transition>
</template>
