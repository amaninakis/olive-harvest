<script setup lang="ts">
import type { TaskType } from '../core/types'
import { useTranslation } from 'i18next-vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  addDays,
  monthGrid,
  parseISODate,
  seasonLabel,
  seasonOf,
  todayISO,
} from '../core/dates'
import { formatMoney, formatNumber, formatYield } from '../core/format'
import {
  greetingName,
  greetingTime,
  homeFocus,
  latestActivity,
  nextHarvest,
  oilInStock,
  oilSold,
  relativeDay,
  taskRing,
  weekDays,
} from '../core/home'
import { stockLevels } from '../core/oil'
import { oilEstimate, oliveEstimate, yearSummary } from '../core/yearReport'
import { formatLocale } from '../i18n'
import { account } from '../sync/account'
import AppIcon from '../ui/AppIcon.vue'
import { entryDetails } from '../ui/entryDetails'
import { canDo, taskName, useFarm } from '../ui/farm'
import OilDrop from '../ui/OilDrop.vue'
import PageLink from '../ui/PageLink.vue'
import SwipeTrack from '../ui/SwipeTrack.vue'
import TaskIcon from '../ui/TaskIcon.vue'

/**
 * The home page: the season at a glance, this week, and the latest work. What leads changes
 * with the time of year (core/home.ts): the harvest's ring in its months; the other tasks in
 * season (one ring, a field checklist or several small rings) with the harvest countdown when
 * it is near; then olives and oil in the harvest, or oil in stock and sold the rest of the
 * year.
 */
const { t: translate } = useTranslation()
const farm = useFarm()
const router = useRouter()

const today = todayISO()
const startMonth = computed(() => farm.value.settings.seasonStartMonth)
const season = computed(() => seasonOf(today, startMonth.value))

const seeWork = computed(() => canDo(farm.value, 'work', 'see'))
const editWork = computed(() => canDo(farm.value, 'work', 'change'))
const seeOil = computed(() => canDo(farm.value, 'oil', 'see'))
const editOil = computed(() => canDo(farm.value, 'oil', 'change'))
const seeMoney = computed(() => canDo(farm.value, 'money', 'see'))
const seeReports = computed(() => canDo(farm.value, 'reports', 'see'))
/** "Details ›" to This year's report, for the olives and oil figures. */
const figuresLink = computed(() => seeOil.value && seeReports.value)

/* ---------- greeting ---------- */
/**
 * "Καλημέρα!" as the page's title, with the person's name ("Καλημέρα, Νίκο!") only when it
 * fits beside the logo and gear in full; otherwise the name is left out rather than cut.
 */
const showName = ref(true)
const greeting = computed(() => {
  const hello = translate(`home.greeting.${greetingTime(new Date().getHours())}`)
  const name = greetingName(account.user?.username)

  return name && showName.value
    ? translate('home.greetingName', { greeting: hello, name })
    : translate('home.greetingAlone', { greeting: hello })
})
const head = useTemplateRef<HTMLElement>('head')
const title = useTemplateRef<HTMLElement>('title')
/** Try the name, and drop it if the title would end in "…". */
async function fitGreeting() {
  showName.value = true
  await nextTick()
  if (title.value && title.value.scrollWidth > title.value.clientWidth) {
    showName.value = false
  }
}
let headObserver: ResizeObserver | undefined
onMounted(() => {
  void fitGreeting()
  // The header's width changes only with the screen (not with the title), so this settles.
  headObserver = new ResizeObserver(() => void fitGreeting())
  if (head.value) {
    headObserver.observe(head.value)
  }
})
onBeforeUnmount(() => headObserver?.disconnect())
const dateLine = computed(() =>
  new Intl.DateTimeFormat(formatLocale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parseISODate(today)),
)

/* ---------- the season card ---------- */
const focus = computed(() => homeFocus(farm.value.taskTypes, today))
const inHarvest = computed(() => focus.value.kind === 'harvest')

function ringFor(task: TaskType) {
  return taskRing({
    task,
    taskTypes: farm.value.taskTypes,
    fields: farm.value.fields,
    entries: farm.value.entries,
    today,
    seasonStartMonth: startMonth.value,
  })
}
/** One task leads (the harvest, or the only task in season): a big ring or a checklist. */
const mainTask = computed(() => {
  if (focus.value.kind === 'harvest') {
    return focus.value.task
  }

  return focus.value.kind === 'tasks' && focus.value.tasks.length === 1
    ? focus.value.tasks[0]
    : undefined
})
const mainRing = computed(() => (mainTask.value ? ringFor(mainTask.value) : undefined))
/**
 * The ring card is on show: "Details ›" then goes in its top line, which has room, so it
 * costs no height; otherwise it gets its own row above the two figures.
 */
const ringShown = computed(
  () => seeWork.value && !!mainTask.value && mainRing.value?.unit === 'trees',
)
/** Several tasks in season: a small ring each. */
const smallRings = computed(() =>
  focus.value.kind === 'tasks' && focus.value.tasks.length > 1
    ? focus.value.tasks.map((task) => ({ task, ring: ringFor(task) }))
    : [],
)
/** This month's name as it stands alone ("Σεπτέμβριος", not "Σεπτεμβρίου"). */
const monthName = computed(
  () =>
    new Intl.DateTimeFormat(formatLocale.value, { month: 'long', year: 'numeric' })
      .formatToParts(parseISODate(today))
      .find((part) => part.type === 'month')?.value ?? '',
)

function fieldName(id: string) {
  return farm.value.fields.find((field) => field.id === id)?.name ?? ''
}

function amountOf(ring: { unit: 'trees' | 'fields'; done: number; total: number }) {
  return translate(ring.unit === 'trees' ? 'home.treesOf' : 'home.fieldsOf', {
    done: formatNumber(ring.done, formatLocale.value, 0),
    total: formatNumber(ring.total, formatLocale.value, 0),
  })
}

function fraction(ring: { done: number; total: number }) {
  return ring.total > 0 ? Math.min(ring.done / ring.total, 1) : 0
}

/** A ring's arc: the circle's length, and how much of it is drawn. */
function arc(part: number, radius: number) {
  const length = 2 * Math.PI * radius
  return `${(length * part).toFixed(1)} ${length.toFixed(1)}`
}

/** The fields still to do, for the checklist. */
const fieldsLeft = computed(() =>
  (mainRing.value?.fields ?? []).filter((field) => !field.finished).map((field) => field.name),
)

/* ---------- harvest countdown (outside the harvest, when it is near) ---------- */
const COUNTDOWN_DAYS = 140
const countdown = computed(() => {
  if (inHarvest.value || !seeWork.value) {
    return undefined
  }
  const next = nextHarvest({
    entries: farm.value.entries,
    taskTypes: farm.value.taskTypes,
    today,
    seasonStartMonth: startMonth.value,
  })
  if (!next || next.days > COUNTDOWN_DAYS) {
    return undefined
  }
  const when =
    next.days < 14
      ? translate('home.inDays', { count: next.days })
      : translate('home.inWeeks', { count: Math.round(next.days / 7) })
  const started = new Intl.DateTimeFormat(formatLocale.value, {
    day: 'numeric',
    month: 'long',
  }).format(parseISODate(next.lastStart))

  return { when, started }
})
const harvestTask = computed(() =>
  farm.value.taskTypes.find((type) => type.inputKind === 'harvest' && !type.archived),
)

/* ---------- the two tiles ---------- */
const summary = computed(() =>
  yearSummary({
    season: season.value,
    entries: farm.value.entries,
    extractions: farm.value.extractions,
    fields: farm.value.fields,
    taskTypes: farm.value.taskTypes,
    seasonStartMonth: startMonth.value,
  }),
)
/**
 * Olives of the year: weighed at the mill, plus an estimate (≈) for those not taken to the
 * mill yet, from what each unit weighed (see oliveEstimate, the same as in This year's
 * report). Without any way to tell their weight yet, the units collected.
 */
const olives = computed(() =>
  oliveEstimate({
    season: season.value,
    entries: farm.value.entries,
    extractions: farm.value.extractions,
    units: farm.value.units,
    harvestTypeIds: new Set(
      farm.value.taskTypes
        .filter((type) => type.inputKind === 'harvest' && !type.deletedAt)
        .map((type) => type.id),
    ),
    seasonStartMonth: startMonth.value,
  }),
)
/** Olive oil: delivered so far, plus what the olives not weighed yet should give (≈). */
const oil = computed(() =>
  oilEstimate({
    season: season.value,
    extractions: farm.value.extractions,
    olives: olives.value,
    seasonStartMonth: startMonth.value,
  }),
)

function kgText(value: number) {
  return formatNumber(value, formatLocale.value, 0)
}

const olivesLine = computed(() => {
  const { weighedKg, estimatedKg, totalKg } = olives.value
  if (estimatedKg > 0) {
    return {
      value: `≈\u00A0${kgText(totalKg)}`,
      unit: 'kg',
      note:
        weighedKg > 0
          ? translate('home.weighedPlusEstimate', {
              weighed: kgText(weighedKg),
              estimated: kgText(estimatedKg),
            })
          : translate('home.estimateNotWeighed'),
    }
  }
  if (weighedKg > 0) {
    return {
      value: kgText(weighedKg),
      unit: 'kg',
      note: translate('home.productions', { count: summary.value.productions }),
    }
  }
  const [unitId, amount] =
    Object.entries(summary.value.units).sort((left, right) => right[1] - left[1])[0] ?? []
  const unit = farm.value.units.find((x) => x.id === unitId)
  if (!unit || !amount) {
    return { value: '0', unit: 'kg', note: translate('home.noProductions') }
  }

  return {
    value: kgText(amount),
    unit: unit.name,
    note: translate('home.notWeighed'),
  }
})
const oilLine = computed(() => {
  const { netMadeKg, expectedNetKg } = oil.value
  if (expectedNetKg > 0) {
    return {
      value: `≈\u00A0${kgText(netMadeKg + expectedNetKg)}`,
      note:
        netMadeKg > 0
          ? translate('home.madePlusEstimate', {
              made: kgText(netMadeKg),
              estimated: kgText(expectedNetKg),
            })
          : translate('home.estimateFromOlives'),
    }
  }

  if (oil.value.missing.includes('yield')) {
    // Olives are waiting, but without any production yet there is no yield to go by.
    return { value: kgText(summary.value.netOilKg), note: translate('home.estimateLater') }
  }

  return {
    value: kgText(summary.value.netOilKg),
    note:
      summary.value.oliveKg > 0
        ? translate('home.yield', {
            value: formatYield(
              summary.value.oliveKg,
              summary.value.oilKg,
              farm.value.settings.yieldFormat,
              formatLocale.value,
            ),
          })
        : translate('home.seasonOf', { season: seasonLabel(season.value) }),
  }
})

const stock = computed(() =>
  oilInStock(
    stockLevels(
      farm.value.extractions,
      farm.value.stockMovements,
      startMonth.value,
      farm.value.transactions,
    ),
  ),
)
const stockNote = computed(() => {
  if (stock.value.kg <= 0) {
    return translate('home.noStock')
  }
  const places = translate('home.places', { count: stock.value.places })
  const seasons = stock.value.vintages.map((vintage) => seasonLabel(vintage)).join(', ')

  return `${places} · ${seasons}`
})
const sold = computed(() => oilSold(farm.value.transactions, Number(today.slice(0, 4))))
const soldNote = computed(() => {
  if (sold.value.kg <= 0) {
    return translate('home.noSales')
  }
  if (!seeMoney.value) {
    return ''
  }
  const loc = formatLocale.value
  const money = formatMoney(sold.value.amount, loc)

  return sold.value.pricePerKg
    ? `${money} · ${formatMoney(sold.value.pricePerKg, loc)}/kg`
    : money
})

/* ---------- this week, and this month on a computer ---------- */
const typeById = computed(() => new Map(farm.value.taskTypes.map((type) => [type.id, type])))
/** Up to three colours a day: one per task type worked, and the mill's when oil was made. */
function dotsOn(date: string) {
  const colours: string[] = []
  for (const entry of farm.value.entries) {
    const colour =
      entry.date === date ? typeById.value.get(entry.taskTypeId)?.color : undefined
    if (colour && !colours.includes(colour)) {
      colours.push(colour)
    }
  }
  if (farm.value.extractions.some((x) => x.date === date)) {
    colours.push('var(--oil-entry)')
  }

  return colours.slice(0, 3)
}
/** Which week the strip shows: 0 this week, -1 last week, and so on (never ahead). */
const weekShift = ref(0)
function weekAt(shift: number) {
  return weekDays(addDays(today, shift * 7)).map((date) => ({
    date,
    day: Number(date.slice(8)),
    weekday: new Intl.DateTimeFormat(formatLocale.value, { weekday: 'short' }).format(
      parseISODate(date),
    ),
    dots: dotsOn(date),
    future: date > today,
  }))
}
const week = computed(() => weekAt(weekShift.value))
const weekTitle = computed(() => {
  if (weekShift.value === 0) {
    return translate('home.week')
  }
  if (weekShift.value === -1) {
    return translate('home.lastWeek')
  }
  const days = week.value
  const range = new Intl.DateTimeFormat(formatLocale.value, {
    day: 'numeric',
    month: 'short',
  }).formatRange(parseISODate(days[0].date), parseISODate(days[6].date))

  return translate('home.weekOf', { range })
})
const monthTitle = computed(() =>
  new Intl.DateTimeFormat(formatLocale.value, { month: 'long', year: 'numeric' }).format(
    parseISODate(today),
  ),
)
const calendar = computed(() =>
  monthGrid(Number(today.slice(0, 4)), Number(today.slice(5, 7))).map((date) =>
    date
      ? { date, day: Number(date.slice(8)), dots: dotsOn(date), future: date > today }
      : null,
  ),
)
const weekdayNames = computed(() => weekAt(0).map((day) => day.weekday))

function openDay(date: string) {
  void router.push({ path: '/journal', query: { date } })
}

/* ---------- the latest work and productions ---------- */
const latest = computed(() =>
  latestActivity(
    seeWork.value ? farm.value.entries : [],
    seeOil.value ? farm.value.extractions : [],
    4,
  ),
)
function whenLabel(date: string) {
  const relative = relativeDay(date, today)
  if (relative) {
    return translate(`home.${relative}`)
  }

  return new Intl.DateTimeFormat(formatLocale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(parseISODate(date))
}

function millName(id: string | undefined) {
  return farm.value.mills.find((mill) => mill.id === id)?.name
}
</script>

<template>
  <main class="page home">
    <header ref="head" class="page-head home-head">
      <h1 ref="title">{{ greeting }}</h1>
    </header>

    <p v-if="!inHarvest" class="home-date muted">{{ dateLine }}</p>

    <!-- The harvest countdown, outside the harvest when it is near -->
    <section v-if="countdown" class="card home-countdown">
      <div>
        <p class="muted small">{{ $t('home.nextHarvest') }}</p>
        <p class="home-big-line">{{ countdown.when }}</p>
        <p class="muted small">{{ $t('home.lastStart', { date: countdown.started }) }}</p>
      </div>
      <span
        v-if="harvestTask"
        class="home-task-dot"
        :style="{ '--c': harvestTask.color }"
        aria-hidden="true"
      >
        <TaskIcon :icon="harvestTask.icon" :size="24" />
      </span>
    </section>

    <!-- The task that leads: a ring, or a field checklist for work done per field -->
    <template v-if="seeWork && mainTask && mainRing">
      <section v-if="mainRing.unit === 'trees'" class="card home-ring">
        <svg class="ring" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
          <circle class="ring-track" cx="48" cy="48" r="42" />
          <circle
            v-if="mainRing.done > 0"
            class="ring-fill"
            cx="48"
            cy="48"
            r="42"
            :stroke-dasharray="arc(fraction(mainRing), 42)"
            transform="rotate(-90 48 48)"
          />
          <text x="48" y="48" class="ring-text">
            {{ Math.round(fraction(mainRing) * 100) }}%
          </text>
        </svg>
        <span class="home-ring-text">
          <span class="home-ring-label">
            <!-- The whole card opens the task form (or the journal): this link covers it -->
            <RouterLink
              :to="editWork ? '/new' : '/journal'"
              class="muted small home-ring-open"
              >{{ $t('home.thisYear', { task: taskName(translate, mainTask) }) }}</RouterLink
            >
            <PageLink v-if="figuresLink" to="/reports" class="home-link">
              {{ $t('home.details') }} ›
            </PageLink>
          </span>
          <strong class="home-big-line">{{ amountOf(mainRing) }}</strong>
          <span class="muted small">
            <AppIcon name="check" :size="14" class="inline-icon" />
            {{
              $t('home.fieldsFinished', {
                done: mainRing.fieldsFinished,
                total: mainRing.fieldsTotal,
              })
            }}
          </span>
          <span v-if="mainRing.next" class="small">
            {{ $t('home.carryOn') }} <strong>{{ fieldName(mainRing.next.fieldId) }}</strong>
            <template v-if="mainRing.next.remaining">
              · {{ $t('journal.trees', { count: mainRing.next.remaining }) }}
            </template>
          </span>
        </span>
      </section>

      <section v-else class="card home-checklist">
        <div class="home-checklist-head">
          <div>
            <p class="muted small">
              {{ taskName(translate, mainTask) }} · <span class="cap">{{ monthName }}</span>
            </p>
            <p class="home-big-line">{{ amountOf(mainRing) }}</p>
          </div>
          <span class="home-task-dot" :style="{ '--c': mainTask.color }" aria-hidden="true">
            <TaskIcon :icon="mainTask.icon" :size="22" />
          </span>
        </div>
        <ul class="home-fields">
          <li
            v-for="field in mainRing.fields"
            :key="field.fieldId"
            :class="{ done: field.finished }"
          >
            <AppIcon v-if="field.finished" name="check" :size="16" />
            <span v-else class="home-open-dot" aria-hidden="true"></span>
            <span>{{ field.name }}</span>
            <span class="sr-only">{{
              field.finished ? $t('home.done') : $t('home.notDone')
            }}</span>
          </li>
        </ul>
        <p class="muted small">
          {{
            fieldsLeft.length
              ? $t('home.left', { fields: fieldsLeft.join(', ') })
              : $t('home.allDone')
          }}
        </p>
      </section>
    </template>

    <!-- Several tasks in season: a small ring each -->
    <section v-if="seeWork && smallRings.length" class="card home-rings">
      <div class="home-checklist-head">
        <h2>{{ $t('home.seasonTasks') }}</h2>
        <span class="muted small cap">{{ monthName }}</span>
      </div>
      <div class="home-small-rings">
        <RouterLink
          v-for="{ task, ring } in smallRings"
          :key="task.id"
          :to="editWork ? '/new' : '/journal'"
          class="home-small-ring"
        >
          <span class="home-small-ring-art">
            <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden="true">
              <circle class="ring-track" cx="38" cy="38" r="33" />
              <circle
                v-if="ring.done > 0"
                class="ring-fill"
                cx="38"
                cy="38"
                r="33"
                :stroke-dasharray="arc(fraction(ring), 33)"
                transform="rotate(-90 38 38)"
              />
            </svg>
            <span class="home-task-dot mini" :style="{ '--c': task.color }" aria-hidden="true">
              <TaskIcon :icon="task.icon" :size="18" />
            </span>
          </span>
          <strong>{{ taskName(translate, task) }}</strong>
          <span class="muted small">{{ amountOf(ring) }}</span>
        </RouterLink>
      </div>
    </section>

    <!-- Olives and oil in the harvest; oil in stock and sold the rest of the year -->
    <div v-if="figuresLink && !ringShown" class="home-checklist-head home-figures-head">
      <PageLink to="/reports" class="home-link">{{ $t('home.moreInfo') }} ›</PageLink>
    </div>
    <div v-if="seeOil" class="home-tiles">
      <template v-if="inHarvest">
        <RouterLink to="/oil" class="card home-tile">
          <span class="muted small">{{ $t('home.olives') }}</span>
          <span class="home-figure"
            >{{ olivesLine.value }} <small>{{ olivesLine.unit }}</small></span
          >
          <span class="muted small">{{ olivesLine.note }}</span>
        </RouterLink>
        <RouterLink to="/oil" class="card home-tile">
          <span class="muted small">{{ $t('home.oil') }}</span>
          <span class="home-figure">{{ oilLine.value }} <small>kg</small></span>
          <span class="muted small">{{ oilLine.note }}</span>
        </RouterLink>
      </template>
      <template v-else>
        <RouterLink to="/oil" class="card home-tile">
          <span class="muted small">{{ $t('home.stock') }}</span>
          <span class="home-figure"
            >{{ formatNumber(stock.kg, formatLocale, 0) }} <small>kg</small></span
          >
          <span class="muted small">{{ stockNote }}</span>
        </RouterLink>
        <RouterLink :to="seeMoney ? '/money' : '/oil'" class="card home-tile">
          <span class="muted small">{{ $t('home.sold') }}</span>
          <span class="home-figure"
            >{{ formatNumber(sold.kg, formatLocale, 0) }} <small>kg</small></span
          >
          <span class="muted small">{{ soldNote }}</span>
        </RouterLink>
      </template>
    </div>

    <!-- This week (phones); this month (computers) -->
    <section v-if="seeWork" class="card home-week">
      <div class="home-checklist-head">
        <h2>{{ weekTitle }}</h2>
        <button
          v-if="weekShift !== 0"
          type="button"
          class="chip selected home-this-week"
          @click="weekShift = 0"
        >
          {{ $t('common.today') }}
        </button>
        <PageLink to="/journal" class="home-link">{{ $t('home.journal') }} ›</PageLink>
      </div>
      <SwipeTrack
        v-slot="{ offset }"
        :can-go="(step) => weekShift + step <= 0"
        @step="(step) => (weekShift += step)"
      >
        <div class="home-days">
          <button
            v-for="day in weekAt(weekShift + offset)"
            :key="day.date"
            type="button"
            class="home-day"
            :class="{ today: day.date === today, future: day.future }"
            :disabled="day.future"
            :aria-label="whenLabel(day.date)"
            @click="openDay(day.date)"
          >
            <span class="muted">{{ day.weekday }}</span>
            <strong>{{ day.day }}</strong>
            <span class="home-dots" aria-hidden="true">
              <i v-for="(colour, i) in day.dots" :key="i" :style="{ background: colour }"></i>
            </span>
          </button>
        </div>
      </SwipeTrack>
    </section>

    <section v-if="seeWork" class="card home-month">
      <div class="home-checklist-head">
        <h2 class="cap">{{ monthTitle }}</h2>
        <PageLink to="/journal" class="home-link">{{ $t('home.journal') }} ›</PageLink>
      </div>
      <div class="home-calendar">
        <span v-for="(name, i) in weekdayNames" :key="`w${i}`" class="muted small">{{
          name
        }}</span>
        <template v-for="(cell, i) in calendar" :key="i">
          <button
            v-if="cell"
            type="button"
            class="home-cal-day"
            :class="{ today: cell.date === today, future: cell.future }"
            :disabled="cell.future"
            :aria-label="whenLabel(cell.date)"
            @click="openDay(cell.date)"
          >
            <span>{{ cell.day }}</span>
            <span class="home-dots" aria-hidden="true">
              <i v-for="(colour, j) in cell.dots" :key="j" :style="{ background: colour }"></i>
            </span>
          </button>
          <span v-else></span>
        </template>
      </div>
    </section>

    <!-- The latest work and productions -->
    <section v-if="seeWork || seeOil" class="home-latest">
      <div class="home-checklist-head">
        <h2>{{ $t('home.latest') }}</h2>
        <PageLink v-if="seeWork" to="/journal" class="home-link"
          >{{ $t('home.allWork') }} ›</PageLink
        >
      </div>
      <p v-if="latest.length === 0" class="card muted">{{ $t('home.nothingYet') }}</p>
      <ul v-else class="card home-list">
        <li
          v-for="item in latest"
          :key="item.kind === 'entry' ? item.entry.id : item.extraction.id"
        >
          <RouterLink
            v-if="item.kind === 'entry'"
            :to="
              editWork
                ? `/entry/${item.entry.id}`
                : { path: '/journal', query: { date: item.date } }
            "
            class="home-row"
          >
            <span
              class="home-task-dot"
              :style="{ '--c': typeById.get(item.entry.taskTypeId)?.color ?? '#777' }"
              aria-hidden="true"
            >
              <TaskIcon :icon="typeById.get(item.entry.taskTypeId)?.icon" :size="20" />
            </span>
            <span class="home-row-text">
              <strong>
                {{ typeById.get(item.entry.taskTypeId) ? taskName(translate, typeById.get(item.entry.taskTypeId)!) : '' }}
                · {{ fieldName(item.entry.fieldId) }}
              </strong>
              <small class="muted">
                {{ whenLabel(item.date)
                }}<template
                  v-if="entryDetails(item.entry, farm.units, translate, formatLocale)"
                >
                  ·
                  {{ entryDetails(item.entry, farm.units, translate, formatLocale) }}</template
                >
              </small>
            </span>
          </RouterLink>
          <RouterLink
            v-else
            :to="
              editOil
                ? `/oil/${item.extraction.id}`
                : { path: '/journal', query: { date: item.date } }
            "
            class="home-row"
          >
            <span class="home-task-dot oil" aria-hidden="true"><OilDrop /></span>
            <span class="home-row-text">
              <strong>
                {{ $t('extraction.title')
                }}<template v-if="millName(item.extraction.millId)">
                  · {{ millName(item.extraction.millId) }}</template
                >
              </strong>
              <small class="muted">
                {{ whenLabel(item.date) }} ·
                {{
                  $t('home.oilKg', {
                    kg: formatNumber(item.extraction.oilKg, formatLocale, 0),
                  })
                }}
              </small>
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>
