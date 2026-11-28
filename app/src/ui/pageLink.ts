import type { InjectionKey } from 'vue'

/**
 * Opens a page the way the bottom menu does: on a phone it slides in from its side
 * (PageSwiper.open); elsewhere it just opens. Provided by App.vue, used by PageLink.
 */
export const OPEN_PAGE: InjectionKey<(path: string) => void> = Symbol('open page')
