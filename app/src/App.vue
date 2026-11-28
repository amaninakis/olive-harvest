<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import type { IconName } from './ui/icons'
import { useTranslation } from 'i18next-vue'
import { computed, provide, useTemplateRef, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { type Area, can, PRESETS } from './core/access'
import { todayISO } from './core/dates'
import { landingPage } from './core/landing'
import { pickLanguage } from './core/locale'
import { localDb } from './db/db'
import { FarmRepo } from './db/repo'
import { chosenLanguage, dateFormatPref, deviceLanguage, setLanguage } from './i18n'
import AccountScreen from './screens/AccountScreen.vue'
import NewPasswordScreen from './screens/NewPasswordScreen.vue'
import SetupWizard from './screens/SetupWizard.vue'
import { accessTo, account, retryLoad, signOut } from './sync/account'
import AppIcon from './ui/AppIcon.vue'
import AppLogo from './ui/AppLogo.vue'
import AppToast from './ui/AppToast.vue'
import { hasDraft } from './ui/draft'
import { type FarmData, provideFarm } from './ui/farm'
import { useLiveQuery } from './ui/live'
import { OPEN_PAGE } from './ui/pageLink'
import PageSheet from './ui/PageSheet.vue'
import PageSwiper from './ui/PageSwiper.vue'
import { isSheetPath, sheetBackdrop, sheetParent } from './ui/sheet'

/** The grove data on this phone (picked before the app started). */
const db = localDb()

const { t: translate } = useTranslation()
const route = useRoute()
const router = useRouter()

/**
 * The task form slides up as a sheet over the page it was opened from (the home page when the
 * app opens on it), which stays drawn beneath it, dimmed and out of reach.
 */
const sheetOpen = computed(() => isSheetPath(route.path))
let routesSeen = 0
watch(
  () => route.fullPath,
  (path) => {
    if (route.matched.length === 0) {
      return // the router has not read the address yet
    }
    routesSeen += 1
    if (!isSheetPath(route.path)) {
      sheetBackdrop.value = path
    } else if (routesSeen === 1) {
      sheetBackdrop.value = sheetParent(route.path) // opened directly: over its own tab
    }
  },
  { immediate: true },
)
const backdrop = computed(
  () => router.resolve(sheetBackdrop.value) as RouteLocationNormalizedLoaded,
)
function closeSheet() {
  void router.push(sheetBackdrop.value)
}

function notDeleted<T extends { deletedAt?: number }>(rows: T[]) {
  return rows.filter((row) => !row.deletedAt)
}

const farmId = useLiveQuery(async () => (await db.meta.get('currentFarmId'))?.value ?? '')

const data = useLiveQuery(
  async () => {
    const id = farmId.value
    if (!id) {
      return null
    }
    const [
      farm,
      settings,
      fields,
      units,
      taskTypes,
      entries,
      mills,
      chargeTypes,
      locations,
      extractions,
      stockMovements,
      categories,
      transactions,
    ] = await Promise.all([
      db.farms.get(id),
      db.settings.get(id),
      db.fields.where('farmId').equals(id).toArray(),
      db.units.where('farmId').equals(id).toArray(),
      db.taskTypes.where('farmId').equals(id).toArray(),
      db.entries.where('farmId').equals(id).toArray(),
      db.mills.where('farmId').equals(id).toArray(),
      db.chargeTypes.where('farmId').equals(id).toArray(),
      db.locations.where('farmId').equals(id).toArray(),
      db.extractions.where('farmId').equals(id).toArray(),
      db.stockMovements.where('farmId').equals(id).toArray(),
      db.categories.where('farmId').equals(id).toArray(),
      db.transactions.where('farmId').equals(id).toArray(),
    ])
    if (!farm || !settings) {
      return null
    }

    return {
      farmName: farm.name,
      settings,
      fields: notDeleted(fields),
      units: notDeleted(units),
      taskTypes: notDeleted(taskTypes),
      entries: notDeleted(entries),
      mills: notDeleted(mills),
      chargeTypes: notDeleted(chargeTypes),
      locations: notDeleted(locations),
      extractions: notDeleted(extractions),
      stockMovements: notDeleted(stockMovements),
      categories: notDeleted(categories),
      transactions: notDeleted(transactions),
    }
  },
  () => farmId.value,
)

const repo = computed(() => (farmId.value ? new FarmRepo(farmId.value) : null))

const farm = computed<FarmData>(() => ({
  repo: repo.value!,
  ...data.value!,
  access: accessTo(farmId.value) ?? { role: 'user', permissions: PRESETS.worker },
}))
provideFarm(farm)

// The grove's language is only the starting point; a choice made on this phone wins.
watch(
  () => data.value?.settings.language,
  (lng) => setLanguage(pickLanguage(chosenLanguage(), lng, deviceLanguage())),
  { immediate: true },
)

watch(
  () => data.value?.settings.dateFormat,
  (format) => (dateFormatPref.value = format ?? 'auto'),
  { immediate: true },
)

const state = computed(() => {
  if (account.mode === 'checking') {
    return 'loading'
  }
  // With a server, nothing is shown until someone signs in…
  if (account.mode === 'server' && !account.user) {
    return 'account'
  }
  // A first sign-in with a temporary password: they choose their own first.
  if (account.mode === 'server' && account.user?.mustChangePassword) {
    return 'new-password'
  }
  // …and their data has arrived (so the first-time setup is never shown by mistake).
  if (account.mode === 'server' && account.loading !== 'idle') {
    return 'loading-data'
  }
  // Signed in, but in no grove and not allowed to start one.
  if (account.mode === 'server' && !farmId.value && !account.user?.mayCreateGrove) {
    return 'no-access'
  }
  if (farmId.value === undefined || (farmId.value && data.value === undefined)) {
    return 'loading'
  }
  if (!farmId.value || !data.value || !repo.value || !data.value.settings.setupDone) {
    return 'setup'
  }

  return 'ready'
})

/*
 * Where the app opens. An installed app always starts at "/", also after the phone closed
 * it in the background, so once the data is ready the first page is chosen from today's
 * state (see core/landing.ts). Opening a link to another page is left alone, and this
 * happens only once, at start.
 */
let landed = false
watch(
  state,
  async (current) => {
    if (landed || current !== 'ready') {
      return
    }
    landed = true
    await router.isReady()
    if (route.path !== '/' || Object.keys(route.query).length > 0) {
      return
    }
    const grove = farm.value
    const to = landingPage({
      today: todayISO(),
      entries: grove.entries,
      fields: grove.fields,
      taskTypes: grove.taskTypes,
      seasonStartMonth: grove.settings.seasonStartMonth,
      drafts: {
        extraction: hasDraft(grove.repo.farmId, 'extraction'),
        task: hasDraft(grove.repo.farmId, 'today'),
      },
      may: {
        enterWork: can(grove.access, 'work', 'change'),
        enterOil: can(grove.access, 'oil', 'change'),
      },
    })
    if (to !== '/') {
      await router.replace(to)
    }
  },
  { immediate: true },
)

/**
 * The menu: only the pages this person may use. On phones it is a bar at the bottom with the
 * home page, Oil, Money and Reports, and a raised + in the middle for logging work; History
 * is opened from the home page and Settings from its gear. On a computer it is a side menu
 * with every page, and "Log work" under the logo.
 */
interface NavItem {
  to: string
  icon: IconName
  label: string
  exact?: boolean
  /** Needed to see the page in the menu (none: always there). */
  area?: Area
  level?: 'see' | 'change'
  /** Only in the computer's side menu, not in the phone's bar (and not swiped to). */
  computerOnly?: boolean
}
const NAV: NavItem[] = [
  { to: '/', icon: 'home', label: 'nav.home', exact: true },
  {
    to: '/journal',
    icon: 'history',
    label: 'nav.journal',
    area: 'work',
    level: 'see',
    computerOnly: true,
  },
  { to: '/oil', icon: 'oil', label: 'nav.oil', area: 'oil', level: 'see' },
  { to: '/money', icon: 'money', label: 'nav.money', area: 'money', level: 'see' },
  { to: '/reports', icon: 'reports', label: 'nav.reports', area: 'reports', level: 'see' },
  { to: '/settings', icon: 'settings', label: 'nav.settings', computerOnly: true },
]
const nav = computed(() =>
  NAV.filter((item) => !item.area || can(farm.value.access, item.area, item.level)).map(
    (item) => ({ ...item, label: translate(item.label) }),
  ),
)
/** The tabs a swipe moves between: the ones in the phone's bar. */
const tabs = computed(() =>
  nav.value.filter((item) => !item.computerOnly).map((item) => item.to),
)
const mayLogWork = computed(() => can(farm.value.access, 'work', 'change'))
/** The + sits in the middle of the phone's bar: after half of its tabs. */
const plusSlot = computed(() => Math.ceil(tabs.value.length / 2))
/** Where an item sits in the phone's bar (CSS order), leaving the middle to the +. */
function phoneOrder(to: string) {
  const index = tabs.value.indexOf(to)
  return index < plusSlot.value ? index : index + 1
}

/** Whether a tab of the bottom menu is the one open (its own page or one opened from it). */
function isOpen(item: NavItem) {
  return item.exact ? route.path === '/' : route.path.startsWith(item.to)
}

const pageSwiper = useTemplateRef<InstanceType<typeof PageSwiper>>('pageSwiper')

/**
 * A tab chosen in the bottom menu slides in from its side, like a swipe. Ctrl- or middle-click
 * still opens it in a new browser tab.
 */
function openTab(event: MouseEvent, to: string) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return
  }
  event.preventDefault()
  if (pageSwiper.value) {
    void pageSwiper.value.open(to)
  } else {
    void router.push(to)
  }
}

/** Links inside pages (e.g. the home page's "Ημερολόγιο ›") slide in like the bottom menu. */
provide(OPEN_PAGE, (path: string) => {
  if (pageSwiper.value) {
    void pageSwiper.value.open(path)
  } else {
    void router.push(path)
  }
})

/** Pages that need an area: opening one without access goes to the first page allowed. */
const PAGE_ACCESS: { prefix: string; area: Area; level: 'see' | 'change' }[] = [
  { prefix: '/new', area: 'work', level: 'change' },
  { prefix: '/entry/', area: 'work', level: 'change' },
  { prefix: '/journal', area: 'work', level: 'see' },
  { prefix: '/oil/', area: 'oil', level: 'change' },
  { prefix: '/oil', area: 'oil', level: 'see' },
  { prefix: '/money/', area: 'money', level: 'change' },
  { prefix: '/money', area: 'money', level: 'see' },
  { prefix: '/reports', area: 'reports', level: 'see' },
]
watch(
  () => [route.path, state.value, farm.value.access] as const,
  ([path, current]) => {
    if (current !== 'ready') {
      return
    }
    const rule = PAGE_ACCESS.find((page) => path.startsWith(page.prefix))
    if (rule && !can(farm.value.access, rule.area, rule.level)) {
      void router.replace('/')
    }
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="state === 'loading'" class="splash">
    <AppLogo size="large" light />
    <span class="splash-text">{{ $t('common.loading') }}</span>
  </div>
  <AccountScreen v-else-if="state === 'account'" />
  <NewPasswordScreen v-else-if="state === 'new-password'" />
  <main v-else-if="state === 'no-access'" class="setup loading-data">
    <h1>{{ $t('account.noGroveTitle') }}</h1>
    <p class="muted">{{ $t('account.noGroveHelp') }}</p>
    <button type="button" class="btn ghost" @click="signOut()">
      {{ $t('account.signOut') }}
    </button>
  </main>
  <main v-else-if="state === 'loading-data'" class="setup loading-data">
    <template v-if="account.loading === 'loading'">
      <div class="spinner" aria-hidden="true"></div>
      <h1>{{ $t('account.loadingTitle') }}</h1>
      <p class="muted">{{ $t('account.loadingHelp') }}</p>
    </template>
    <template v-else>
      <h1>{{ $t('account.loadFailedTitle') }}</h1>
      <p class="muted">{{ $t('account.loadFailedHelp') }}</p>
      <button type="button" class="btn primary big block" @click="retryLoad()">
        {{ $t('account.tryAgain') }}
      </button>
    </template>
  </main>
  <SetupWizard v-else-if="state === 'setup'" />
  <div v-else class="shell">
    <header class="brand-bar">
      <AppLogo />
      <RouterLink
        to="/settings"
        class="brand-settings"
        :aria-label="translate('nav.settings')"
      >
        <AppIcon name="settings" :size="22" />
      </RouterLink>
    </header>
    <PageSwiper ref="pageSwiper" :tabs="tabs">
      <div
        class="page-host current"
        :inert="sheetOpen || undefined"
        :aria-hidden="sheetOpen || undefined"
      >
        <RouterView
          :key="sheetOpen ? backdrop.path : route.path"
          :route="sheetOpen ? backdrop : undefined"
        />
      </div>
    </PageSwiper>
    <Transition name="sheet" appear>
      <PageSheet v-if="sheetOpen" @close="closeSheet">
        <RouterView :key="route.path" />
      </PageSheet>
    </Transition>
    <nav class="bottom-nav">
      <div class="nav-logo"><AppLogo /></div>
      <RouterLink
        v-if="mayLogWork"
        to="/new"
        class="nav-new"
        :style="{ '--phone-order': plusSlot }"
        :aria-label="translate('nav.newTask')"
      >
        <span class="nav-new-button" aria-hidden="true"
          ><AppIcon name="plus" :size="28"
        /></span>
        <span class="nav-new-text">{{ $t('nav.newTask') }}</span>
      </RouterLink>
      <RouterLink v-for="item in nav" :key="item.to" v-slot="{ href }" :to="item.to" custom>
        <a
          :href="href"
          :class="{ 'active': isOpen(item), 'computer-only': item.computerOnly }"
          :style="item.computerOnly ? undefined : { '--phone-order': phoneOrder(item.to) }"
          :aria-current="isOpen(item) ? 'page' : undefined"
          @click="openTab($event, item.to)"
        >
          <span class="nav-icon" aria-hidden="true">
            <AppIcon :name="item.icon" :size="24" />
          </span>
          <span>{{ item.label }}</span>
        </a>
      </RouterLink>
    </nav>
    <AppToast />
  </div>
</template>
