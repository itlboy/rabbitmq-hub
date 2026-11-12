<script setup>
// Tiny trend line (last ~10 min). Rising = the stroke turns to the warning colour so a growing backlog stands out.
// `axis`: show the scale — max on top, the floor (0 for counts) at the bottom, faint grid lines — so the height of
// the line can actually be read (used in the queue drawer; table rows stay bare).
import { computed } from 'vue';
import { fmt } from '../format.js';

const props = defineProps({
  values: { type: Array, default: () => [] },
  width: { type: Number, default: 120 },
  height: { type: Number, default: 28 },
  warnRising: { type: Boolean, default: true },
  color: { type: String, default: 'var(--signal)' },
  axis: { type: Boolean, default: false },
});
const uid = 'sp' + Math.random().toString(36).slice(2, 8);
const shape = computed(() => {
  const v = props.values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const vmax = Math.max(...v), vmin = Math.min(...v);
  // With a scale shown, anchor counts at 0 — otherwise 74→75 would fill the whole height and look like a spike.
  const lo = props.axis && vmin >= 0 ? 0 : vmin;
  const max = vmax, min = lo, span = max - min || 1, pad = 2;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * props.width, pad + (1 - (y - min) / span) * (props.height - pad * 2)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const first = v.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, v.length);
  const last = v.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, v.length);
  const rising = props.warnRising && vmax > 0 && last > first * 1.15 && last - first > 5;
  return {
    line, area: `${line} L ${props.width} ${props.height} L 0 ${props.height} Z`, end: pts[pts.length - 1], rising,
    flat: vmax === vmin, top: max, bottom: min, peak: vmax, low: vmin, pad,
  };
});
</script>

<template>
  <div v-if="shape && axis" class="flex items-stretch gap-2">
    <div class="flex flex-col justify-between text-right font-mono text-[10px] leading-none tabular-nums text-ink-3" :style="{ height: height + 'px' }">
      <span :title="`max ${fmt(shape.peak)}`">{{ fmt(shape.top) }}</span>
      <span :title="`min ${fmt(shape.low)}`">{{ fmt(shape.bottom) }}</span>
    </div>
    <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="block overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient :id="uid" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" :stop-color="shape.rising ? 'var(--caution)' : color" stop-opacity=".28" />
          <stop offset="1" :stop-color="shape.rising ? 'var(--caution)' : color" stop-opacity="0" />
        </linearGradient>
      </defs>
      <line :x1="0" :x2="width" :y1="shape.pad" :y2="shape.pad" stroke="var(--seg)" stroke-dasharray="2 3" stroke-width="1" />
      <line :x1="0" :x2="width" :y1="height / 2" :y2="height / 2" stroke="var(--seg)" stroke-dasharray="2 3" stroke-width="1" opacity=".5" />
      <line :x1="0" :x2="width" :y1="height - shape.pad" :y2="height - shape.pad" stroke="var(--seg)" stroke-width="1" />
      <path v-if="!shape.flat" :d="shape.area" :fill="`url(#${uid})`" />
      <path :d="shape.line" fill="none" stroke-width="1.5" stroke-linejoin="round" :stroke="shape.flat ? 'var(--seg)' : shape.rising ? 'var(--caution)' : color" />
      <circle :cx="shape.end[0]" :cy="shape.end[1]" r="2.2" :fill="shape.flat ? 'var(--ink-3)' : shape.rising ? 'var(--caution)' : color" />
    </svg>
  </div>
  <svg v-else-if="shape" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="block overflow-visible" aria-hidden="true">
    <defs>
      <linearGradient :id="uid" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" :stop-color="shape.rising ? 'var(--caution)' : color" stop-opacity=".28" />
        <stop offset="1" :stop-color="shape.rising ? 'var(--caution)' : color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path v-if="!shape.flat" :d="shape.area" :fill="`url(#${uid})`" />
    <path :d="shape.line" fill="none" stroke-width="1.5" stroke-linejoin="round" :stroke="shape.flat ? 'var(--seg)' : shape.rising ? 'var(--caution)' : color" />
    <circle :cx="shape.end[0]" :cy="shape.end[1]" r="2.2" :fill="shape.flat ? 'var(--ink-3)' : shape.rising ? 'var(--caution)' : color" />
  </svg>
  <span v-else class="block" :style="{ width: width + 'px', height: height + 'px' }"></span>
</template>
