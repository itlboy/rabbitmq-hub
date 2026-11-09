<script setup>
// Tiny trend line (last ~10 min). Rising = the stroke turns to the warning colour so a growing backlog stands out.
import { computed } from 'vue';

const props = defineProps({
  values: { type: Array, default: () => [] },
  width: { type: Number, default: 120 },
  height: { type: Number, default: 28 },
  warnRising: { type: Boolean, default: true },
  color: { type: String, default: 'var(--signal)' },
});
const uid = 'sp' + Math.random().toString(36).slice(2, 8);
const shape = computed(() => {
  const v = props.values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const max = Math.max(...v), min = Math.min(...v), span = max - min || 1, pad = 2;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * props.width, pad + (1 - (y - min) / span) * (props.height - pad * 2)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const first = v.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, v.length);
  const last = v.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, v.length);
  const rising = props.warnRising && max > 0 && last > first * 1.15 && last - first > 5;
  return { line, area: `${line} L ${props.width} ${props.height} L 0 ${props.height} Z`, end: pts[pts.length - 1], rising, flat: max === min };
});
</script>

<template>
  <svg v-if="shape" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="block overflow-visible" aria-hidden="true">
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
