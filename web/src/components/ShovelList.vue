<script setup>
import Spinner from './Spinner.vue';
defineProps({ shovels: { type: Array, default: () => [] }, error: String, loading: Boolean });
defineEmits(['open']);
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full border-collapse">
      <thead>
        <tr>
          <th v-for="h in ['Shovel', 'State', 'Node', 'From queue', 'To', 'Last error']" :key="h" scope="col"
            class="border-b border-rule bg-panel-2 px-3.5 py-2.5 text-left font-mono text-[10px] font-medium whitespace-nowrap uppercase tracking-[.08em] text-ink-3">{{ h }}</th>
        </tr>
      </thead>
      <tbody class="font-mono text-xs">
        <tr v-if="error"><td colspan="6" class="px-4 py-10 text-center text-stop">{{ error }}</td></tr>
        <tr v-else-if="loading && !shovels.length"><td colspan="6" class="px-4 py-10 text-center"><Spinner label="Loading shovels…" /></td></tr>
        <tr v-else-if="!shovels.length"><td colspan="6" class="px-4 py-10 text-center font-sans text-ink-3">No shovels on this cluster.</td></tr>
        <tr v-for="s in shovels" :key="s.vhost + s.name" class="border-b border-rule last:border-0"
          :class="s.state === 'running' ? 'hover:bg-panel-2' : 'bg-stop-soft'">
          <td class="px-3.5 py-2.5 font-medium whitespace-nowrap text-ink">{{ s.name }}</td>
          <td class="px-3.5 py-2.5 whitespace-nowrap">
            <span class="inline-flex items-center gap-1.5" :class="s.state === 'running' ? 'text-go' : 'text-stop'">
              <span class="led" :class="s.state !== 'running' && 'off'"></span>{{ s.state }}
            </span>
          </td>
          <td class="px-3.5 py-2.5 whitespace-nowrap text-ink-2">{{ s.node }}</td>
          <td class="px-3.5 py-2.5 whitespace-nowrap">
            <button v-if="s.src" type="button" class="text-signal underline-offset-2 hover:underline" @click="$emit('open', s.src)">{{ s.src }}</button>
          </td>
          <td class="max-w-64 truncate px-3.5 py-2.5 text-ink-2" :title="s.dest_uri">{{ s.dest }} <span class="text-ink-3">@ {{ s.dest_uri }}</span></td>
          <td class="max-w-80 px-3.5 py-2.5 whitespace-normal text-stop">{{ s.reason || '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
