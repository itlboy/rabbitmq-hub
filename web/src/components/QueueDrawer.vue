<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
// Side panel for one queue: the same queue on every cluster (edge → hub path) + peek at message bodies.
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { fmt, rate } from '../format.js';
import Sparkline from './Sparkline.vue';
import Spinner from './Spinner.vue';
import { t } from '../i18n.js';

const props = defineProps({ queue: Object, cluster: Object, me: Object, rangeLabel: String, canPurge: Boolean });
const emit = defineEmits(['close', 'pick', 'purge']);

const across = ref([]);
const acrossError = ref('');
const acrossLoading = ref(false);
const peekCount = ref(5);
const peeked = ref(null);
const peekBusy = ref(false);
const peekError = ref('');
const open = ref(new Set());

const canPeek = computed(() => props.me?.can_peek && props.cluster?.allow_peek !== false);
const isQuorum = computed(() => props.queue?.type === 'quorum');
// Order the path: edges first, then the hub they forward to, then the rest.
const path = computed(() => {
  const a = across.value; const hubIds = new Set(a.map((x) => x.forwards_to).filter(Boolean));
  return [...a.filter((x) => x.forwards_to), ...a.filter((x) => hubIds.has(x.id)), ...a.filter((x) => !x.forwards_to && !hubIds.has(x.id))];
});

watch(() => props.queue?.name, async (name) => {
  peeked.value = null; peekError.value = ''; open.value = new Set(); across.value = []; acrossError.value = '';
  if (!name) return;
  acrossLoading.value = true;
  try { across.value = await api.across(name); } catch (e) { acrossError.value = e.message; }
  finally { acrossLoading.value = false; }
}, { immediate: true });

async function doPeek() {
  peekBusy.value = true; peekError.value = '';
  try {
    peeked.value = await api.peek(props.cluster.id, { vhost: props.queue.vhost, queue: props.queue.name, count: Number(peekCount.value) });
    open.value = new Set(peeked.value.length ? [0] : []);
  } catch (e) { peekError.value = e.message; }
  finally { peekBusy.value = false; }
}
function pretty(m) {
  if (m.encoding !== 'string') return m.payload;
  try { return JSON.stringify(JSON.parse(m.payload), null, 2); } catch { return m.payload; }
}
function jobName(m) {
  try { const j = JSON.parse(m.payload); return j.displayName || j.job || j.type || null; } catch { return null; }
}
function toggle(i) { const s = new Set(open.value); s.has(i) ? s.delete(i) : s.add(i); open.value = s; }
async function copy(text) { try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ } }
const onEsc = (e) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => window.addEventListener('keydown', onEsc));
onBeforeUnmount(() => window.removeEventListener('keydown', onEsc));
</script>

<template>
  <Transition enter-from-class="opacity-0 [&>div]:scale-95" enter-active-class="transition duration-150" leave-to-class="opacity-0" leave-active-class="transition duration-100">
    <div v-if="queue" class="fixed inset-0 z-[15] flex items-center justify-center bg-scrim p-3 sm:p-6" @click.self="emit('close')">
    <section class="flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-rule bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,.5)] transition-transform duration-150"
      role="dialog" :aria-label="`Queue ${queue.name}`" aria-modal="true">
      <header class="flex items-start gap-3 border-b border-rule px-5 py-4">
        <div class="min-w-0 flex-1">
          <span class="label">{{ cluster?.name }} · {{ queue.type }} · vhost {{ queue.vhost }}</span>
          <h2 class="m-0 mt-0.5 font-mono text-[17px] font-semibold break-all">{{ queue.name }}</h2>
        </div>
        <button type="button" class="btn" @click="emit('close')" :aria-label="t('close')">{{ t('close') }}</button>
      </header>

      <div class="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <!-- numbers + trend -->
        <section class="grid grid-cols-[auto_1fr] items-end gap-4">
          <div>
            <span class="label">{{ t('depth_now') }}</span>
            <div class="font-mono text-[28px] leading-none font-semibold tabular-nums">{{ fmt(queue.messages) }}</div>
            <div class="mt-1 font-mono text-[11px] text-ink-2">{{ t('in') }} {{ rate(queue.publish) }}/s · {{ t('out') }} {{ rate(queue.deliver) }}/s · {{ t('consumers_n', { n: fmt(queue.consumers) }) }}</div>
          </div>
          <div class="justify-self-end"><span class="label">{{ t('last', { r: rangeLabel || t('r1h') }) }}</span><Sparkline :values="queue.history" :width="220" :height="56" axis /><div class="mt-1 flex justify-between pl-7 font-mono text-[10px] text-ink-3"><span>−{{ rangeLabel || t('r1h') }}</span><span>{{ t('now') }}</span></div></div>
        </section>

        <!-- across clusters -->
        <section class="space-y-2">
          <h3 class="label m-0">{{ t('on_every_cluster') }}</h3>
          <p v-if="acrossError" class="m-0 font-mono text-xs text-stop">{{ acrossError }}</p>
          <div v-else-if="acrossLoading" class="py-2"><Spinner :label="t('checking_clusters')" /></div>
          <ol v-else class="m-0 grid list-none gap-1.5 p-0">
            <li v-for="c in path" :key="c.id">
              <button type="button" @click="emit('pick', c.id, queue.name)" :disabled="!c.found"
                class="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border px-3 py-2 text-left disabled:cursor-default"
                :class="c.id === cluster?.id ? 'border-ink' : 'border-rule hover:enabled:border-ink-3'">
                <span class="truncate text-[13px] font-semibold">{{ c.name }}
                  <span v-if="c.forwards_to" class="font-mono text-[11px] font-normal text-ink-3">→ {{ c.forwards_to }}</span></span>
                <span class="font-mono text-[11px] whitespace-nowrap text-ink-2">
                  <template v-if="c.error"><span class="text-stop">{{ c.error }}</span></template>
                  <template v-else-if="!c.found">{{ t('not_declared') }}</template>
                  <template v-else>{{ fmt(c.messages) }} {{ t('msg') }} · {{ fmt(c.consumers) }} cons</template>
                </span>
                <span class="font-mono text-[10px] whitespace-nowrap uppercase tracking-[.06em]"
                  :class="c.shovel === 'running' ? 'text-go' : c.shovel ? 'text-stop' : 'text-ink-3'">{{ c.shovel ? t('shovel_state', { s: c.shovel }) : c.forwards_to && c.found ? t('no_shovel') : '' }}</span>
              </button>
            </li>
          </ol>
        </section>

        <!-- peek -->
        <section class="space-y-3">
          <h3 v-if="peeked || peekError || !canPeek" class="label m-0">{{ t('read_messages') }}</h3>
          <p v-if="cluster?.allow_peek === false" class="m-0 rounded-md bg-panel-2 px-3 py-2 text-[13px] text-ink-2">{{ t('peek_off') }}</p>
          <p v-else-if="!me?.can_peek" class="m-0 rounded-md bg-panel-2 px-3 py-2 text-[13px] text-ink-2">{{ t('peek_role') }}</p>
          <template v-else>
            <p v-if="!queue.messages" class="m-0 text-[13px] text-ink-3">{{ t('queue_empty') }}</p>
            <p v-if="peekError" class="m-0 font-mono text-xs text-stop">{{ peekError }}</p>
            <p v-if="peeked && !peeked.length" class="m-0 text-[13px] text-ink-3">{{ t('none_back') }}</p>
            <ul v-if="peeked?.length" class="m-0 grid list-none gap-2 p-0">
              <li v-for="(m, i) in peeked" :key="i" class="overflow-hidden rounded-lg border border-rule">
                <button type="button" class="flex w-full items-center gap-3 bg-panel-2 px-3 py-2 text-left" @click="toggle(i)" :aria-expanded="open.has(i)">
                  <span class="font-mono text-[11px] text-ink-3">#{{ i + 1 }}</span>
                  <span class="min-w-0 flex-1 truncate font-mono text-xs font-medium">{{ jobName(m) || m.routing_key || t('no_type') }}</span>
                  <span v-if="m.redelivered" class="font-mono text-[10px] uppercase text-caution">redelivered</span>
                  <span class="font-mono text-[11px] text-ink-3">{{ fmt(m.bytes) }} B</span>
                  <span class="text-ink-3">{{ open.has(i) ? '▾' : '▸' }}</span>
                </button>
                <div v-if="open.has(i)" class="space-y-2 px-3 py-3">
                  <div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-2">
                    <span>{{ t('exchange') }}: {{ m.exchange || '(default)' }}</span><span>{{ t('routing_key') }}: {{ m.routing_key }}</span>
                    <span v-if="m.properties.content_type">{{ t('type') }}: {{ m.properties.content_type }}</span>
                    <span v-if="m.properties.delivery_mode">{{ t('mode') }}: {{ m.properties.delivery_mode === 2 ? t('persistent') : t('transient') }}</span>
                  </div>
                  <pre v-if="m.properties.headers && Object.keys(m.properties.headers).length" class="m-0 overflow-x-auto rounded bg-panel-2 p-2 font-mono text-[11px] text-ink-2">{{ JSON.stringify(m.properties.headers, null, 2) }}</pre>
                  <div class="relative">
                    <button type="button" class="btn absolute top-1.5 right-1.5 bg-panel" @click="copy(pretty(m))">{{ t('copy') }}</button>
                    <pre class="m-0 max-h-96 overflow-auto rounded bg-bg p-3 pr-16 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all text-ink">{{ pretty(m) }}</pre>
                  </div>
                  <p v-if="m.bytes > 65536" class="m-0 font-mono text-[11px] text-caution">{{ t('truncated', { n: fmt(m.bytes) }) }}</p>
                </div>
              </li>
            </ul>
          </template>
        </section>
      </div>

      <!-- action bar: read (safe, primary) on the left · empty (destructive, confirm) on the right -->
      <footer class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule bg-panel-2 px-5 py-3">
        <form v-if="canPeek" class="flex min-w-0 items-center gap-3" @submit.prevent="doPeek">
          <div class="inline-flex overflow-hidden rounded-lg shadow-[0_6px_18px_-10px_var(--signal)]">
            <button type="submit" :disabled="peekBusy || !queue.messages"
              class="inline-flex items-center gap-2 bg-signal px-3.5 py-2 text-[13px] font-semibold text-[#1a1206] transition hover:enabled:brightness-110 disabled:opacity-40">
              <Spinner v-if="peekBusy" :size="13" />
              <svg v-else class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              {{ peekBusy ? t('reading') : t('read_n', { n: peekCount }) }}
            </button>
            <label for="peek-count" class="sr-only">{{ t('show_first') }}</label>
            <select id="peek-count" v-model="peekCount" :disabled="peekBusy || !queue.messages"
              class="border-l border-black/20 bg-signal px-2 font-mono text-xs font-semibold text-[#1a1206] outline-none disabled:opacity-40">
              <option v-for="n in [1, 3, 5, 10].filter((n) => n <= (me.peek_max || 10))" :key="n" :value="n">{{ n }}</option>
            </select>
          </div>
          <span class="hidden max-w-[260px] text-[11.5px] leading-snug text-ink-3 sm:block">{{ t('peek_hint') }}</span>
        </form>

        <button v-if="canPurge" type="button" :disabled="!queue.messages" @click="emit('purge', queue)"
          class="ml-auto inline-flex items-center gap-2 rounded-lg bg-[#c62f2f] px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_6px_18px_-10px_#c62f2f] transition hover:enabled:bg-[#ad2525] disabled:opacity-35">
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
          {{ t('empty_queue') }}<span class="font-mono text-[11px] font-medium opacity-80">{{ fmt(queue.messages) }}</span>
        </button>
      </footer>
    </section>
    </div>
  </Transition>
</template>
