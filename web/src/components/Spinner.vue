<script setup>
defineProps({ size: { type: Number, default: 14 }, label: { type: String, default: '' } });
</script>

<template>
  <span class="inline-flex items-center gap-2 align-middle" role="status" :aria-label="label || 'Loading…'">
    <svg :width="size" :height="size" viewBox="0 0 24 24" class="animate-spin text-ink-3" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="var(--signal)" stroke-width="3" stroke-linecap="round" />
    </svg>
    <span v-if="label" class="text-[13px] text-ink-3">{{ label }}</span>
  </span>
</template>
