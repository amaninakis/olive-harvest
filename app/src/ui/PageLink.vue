<script setup lang="ts">
import { inject } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { OPEN_PAGE } from './pageLink'

const props = defineProps<{ to: string }>()
/**
 * A link to another page that slides in like a tab of the bottom menu (see PageSwiper.open),
 * e.g. "Ημερολόγιο ›" on the home page. Ctrl- or middle-click still opens a new browser tab.
 */
defineOptions({ inheritAttrs: false })
const openPage = inject(OPEN_PAGE, undefined)
const router = useRouter()

function go(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return
  }
  event.preventDefault()
  if (openPage) {
    openPage(props.to)
  } else {
    void router.push(props.to)
  }
}
</script>

<template>
  <RouterLink v-slot="{ href }" :to="to" custom>
    <a v-bind="$attrs" :href="href" @click="go"><slot /></a>
  </RouterLink>
</template>
