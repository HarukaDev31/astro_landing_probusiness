<script setup lang="ts">
/**
 * Carrusel “Trust” (pasos): activo grande + título, resto escalonado (~72% cascada),
 * ventana 3 visibles + peek, orden circular (el activo siempre primero; tras el último siguen los primeros),
 * scroll + dots + teclado infinito.
 * Animaciones de entrada: anime.js (createTimeline), no keyframes CSS.
 */
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick, useTemplateRef } from 'vue';
import { useScroll, onKeyDown } from '@vueuse/core';
import { createTimeline, type Timeline } from 'animejs';

export interface TrustSlide {
  step: number;
  labelBefore: string;
  labelBold: string;
  labelAfter: string;
  figma: string;
  fallback: string;
  plain?: string;
  boldIsStrong?: boolean;
}

const props = defineProps<{
  slides: TrustSlide[];
}>();

const trackId = `trust-track-${Math.random().toString(36).slice(2, 9)}`;
/** Única referencia al DOM: el scroll horizontal no se puede hacer 100 % declarativo sin un elemento. */
const track = useTemplateRef<HTMLElement>('track');

const activeIdx = ref(0);

/** Orden circular: primero el activo, luego los siguientes y al final los que “dan la vuelta”. */
const orderedSlides = computed(() => {
  const n = props.slides.length;
  const a = activeIdx.value;
  return Array.from({ length: n }, (_, k) => {
    const sourceIndex = (a + k) % n;
    return { slide: props.slides[sourceIndex]!, sourceIndex };
  });
});

const activeSlide = computed(() => {
  const n = props.slides.length;
  if (n === 0) return null;
  return props.slides[activeIdx.value % n] ?? null;
});
const navPendingIndex = ref<number | null>(null);

let navLockTimer: ReturnType<typeof setTimeout> | null = null;
let enterTimeline: Timeline | null = null;
/** Tras goTo: no pisar la sincronización al soltar scroll unos ms (scroll instant + medición). */
let suppressScrollSyncUntil = 0;
/** Un frame sin transición de anchos para medir bien y evitar “layout + smooth scroll” a la vez (tosco). */
const snapLayout = ref(false);

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stopEnterAnimations() {
  enterTimeline?.revert();
  enterTimeline = null;
}

function runEnterAnimations() {
  stopEnterAnimations();
  if (prefersReducedMotion()) return;

  void nextTick(() => {
    requestAnimationFrame(() => {
      const list = getSlideEls();
      /* Con orden circular, el slide activo es siempre el primero en el DOM */
      const article = list[0];
      if (!article) return;

      const visual = article.querySelector<HTMLElement>('.trust-slide-visual');
      const meta = article.querySelector<HTMLElement>('.trust-slide-meta');
      const badge = meta?.querySelector<HTMLElement>('.trust-badge');
      const caption = meta?.querySelector<HTMLElement>('.trust-caption');
      if (!visual) return;

      const tl = createTimeline({
        autoplay: true,
        onComplete: () => {
          if (enterTimeline === tl) enterTimeline = null;
        },
      });

      /*
       * Entrada escalonada: imagen primero (peso visual), badge, luego texto.
       * Opacidad + scale suaves; overshoot leve en foto; badge sin outBack tan seco.
       */
      tl.add(
        visual,
        {
          opacity: [0.93, 1],
          scale: [0.92, 1.012, 1],
          duration: 600,
          ease: 'out(3)',
        },
        0,
      );

      if (badge) {
        tl.add(badge, { opacity: 0, scale: 0.84, duration: 0 }, 0);
        tl.add(
          badge,
          {
            opacity: [0, 1],
            scale: [0.84, 1.06, 1],
            duration: 500,
            ease: 'out(2.2)',
          },
          68,
        );
      }

      if (caption) {
        tl.add(caption, { opacity: 0, y: 11, duration: 0 }, 0);
        tl.add(
          caption,
          {
            opacity: [0, 1],
            y: [11, 0],
            duration: 420,
            ease: 'outQuart',
          },
          132,
        );
      }

      enterTimeline = tl;
    });
  });
}

function slideAria(s: TrustSlide): string {
  if (s.plain) return `Paso ${s.step}: ${s.plain}`;
  return `Paso ${s.step}: ${s.labelBefore}${s.labelBold}${s.labelAfter}`.replace(/\s+/g, ' ').trim();
}

function getSlideEls(): HTMLElement[] {
  const t = track.value;
  if (!t) return [];
  return Array.from(t.querySelectorAll<HTMLElement>('[data-trust-slide]'));
}

function contentX(slide: HTMLElement, container: HTMLElement): number {
  return container.scrollLeft + slide.getBoundingClientRect().left - container.getBoundingClientRect().left;
}

/** Índice en el DOM (0 = primero = slide activo lógico antes de reordenar). */
function domIndexFromScroll(): number {
  const list = getSlideEls();
  const el = track.value;
  if (!list.length || !el) return 0;

  const sl = el.scrollLeft;
  let best = 0;
  let bestDist = Infinity;
  list.forEach((slide, i) => {
    const cx = contentX(slide, el);
    const d = Math.abs(cx - sl);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function clearNavTimer() {
  if (navLockTimer != null) {
    window.clearTimeout(navLockTimer);
    navLockTimer = null;
  }
}

function resolvePendingNav() {
  clearNavTimer();
  const pending = navPendingIndex.value;
  if (pending === null) return;
  navPendingIndex.value = null;
  activeIdx.value = pending;
  suppressScrollSyncUntil = performance.now() + 380;
}

function onImgError(s: TrustSlide, e: Event) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.getAttribute('src') === s.fallback) return;
  img.src = s.fallback;
}

/** Arrastre / gesto: permitir sincronizar al soltar de inmediato. */
function onTrackPointerDown() {
  suppressScrollSyncUntil = 0;
}

/** Tap / clic en una tarjeta lateral: llevar ese paso al frente (sin confundir con arrastre). */
const slidePointerDown = ref<{
  x: number;
  y: number;
  pid: number;
  sourceIndex: number;
  domIndex: number;
} | null>(null);

function onSlidePointerDown(e: PointerEvent, sourceIndex: number, domIndex: number) {
  if (e.button !== 0 && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  slidePointerDown.value = {
    x: e.clientX,
    y: e.clientY,
    pid: e.pointerId,
    sourceIndex,
    domIndex,
  };
}

function onSlidePointerUp(e: PointerEvent, sourceIndex: number, domIndex: number) {
  const start = slidePointerDown.value;
  if (!start || start.pid !== e.pointerId) return;
  slidePointerDown.value = null;
  if (start.sourceIndex !== sourceIndex || start.domIndex !== domIndex) return;
  if (domIndex === 0) return;
  const dx = Math.abs(e.clientX - start.x);
  const dy = Math.abs(e.clientY - start.y);
  if (dx > 16 || dy > 16) return;
  goTo(sourceIndex);
}

function onSlidePointerCancel(e: PointerEvent) {
  const start = slidePointerDown.value;
  if (start && start.pid === e.pointerId) slidePointerDown.value = null;
}

/**
 * Al terminar el scroll: no reordenar durante el arrastre (solo aquí).
 * El índice DOM `d` sumado al activo da el slide lógico en bucle.
 */
function syncActiveAfterScrollStop() {
  if (navPendingIndex.value != null) return;
  if (typeof performance !== 'undefined' && performance.now() < suppressScrollSyncUntil) return;

  const el = track.value;
  if (!el) return;
  const n = props.slides.length;
  if (n === 0) return;

  const d = domIndexFromScroll();
  const L = (activeIdx.value + d) % n;

  if (L !== activeIdx.value) {
    activeIdx.value = L;
    return;
  }

  if (el.scrollLeft !== 0) {
    snapLayout.value = true;
    requestAnimationFrame(() => {
      el.scrollTo({ left: 0, behavior: 'instant' });
      snapLayout.value = false;
    });
  }
}

function onTrackScrollStop() {
  resolvePendingNav();
  syncActiveAfterScrollStop();
}

watch(activeIdx, (next, prev) => {
  if (prev != null && prev >= 0 && next !== prev) {
    runEnterAnimations();
  }
  void nextTick(() => {
    requestAnimationFrame(() => {
      const el = track.value;
      if (!el || el.scrollLeft === 0) return;
      snapLayout.value = true;
      requestAnimationFrame(() => {
        el.scrollTo({ left: 0, behavior: 'instant' });
        snapLayout.value = false;
      });
    });
  });
});

/** idle: tras arrastre, onStop alinea índice y scroll (el activo sigue primero). */
useScroll(track, {
  throttle: 32,
  idle: 280,
  onStop: onTrackScrollStop,
});

let stopKeyNav: (() => void) | undefined;

function goTo(i: number) {
  const n = props.slides.length;
  if (i < 0 || i >= n) return;
  if (i === activeIdx.value && navPendingIndex.value === null) return;

  activeIdx.value = i;
  navPendingIndex.value = i;
  suppressScrollSyncUntil = performance.now() + 400;
  clearNavTimer();
  snapLayout.value = true;

  void nextTick(() => {
    requestAnimationFrame(() => {
      const el = track.value;
      if (el) el.scrollTo({ left: 0, behavior: 'instant' });
      snapLayout.value = false;
      resolvePendingNav();
    });
  });

  navLockTimer = window.setTimeout(() => resolvePendingNav(), 450);
}

onMounted(() => {
  stopKeyNav = onKeyDown(
    ['ArrowLeft', 'ArrowRight'],
    (e) => {
      const el = track.value;
      const n = props.slides.length;
      if (!el || n === 0 || document.activeElement !== el) return;
      e.preventDefault();
      const cur = activeIdx.value;
      if (e.key === 'ArrowRight') goTo((cur + 1) % n);
      else goTo((cur - 1 + n) % n);
    },
    { target: document },
  );
});

onBeforeUnmount(() => {
  clearNavTimer();
  stopEnterAnimations();
  stopKeyNav?.();
});
</script>

<template>
  <div class="trust-carousel-root">
    <header v-if="activeSlide" class="trust-header" aria-labelledby="trust-heading">
      <p class="trust-eyebrow">Confía en nosotros</p>
      <Transition name="trust-head-swap" mode="out-in">
        <h2 :id="'trust-heading'" :key="activeIdx" class="trust-title">
          <template v-if="activeSlide.plain">
            <span class="trust-title-line trust-title-line--accent-full">{{ activeSlide.plain }}</span>
          </template>
          <template v-else>
            <span class="trust-title-line">
              {{ activeSlide.labelBefore
              }}<span
                class="trust-title-accent-inline"
                :class="{ 'trust-title-accent-inline--eb': activeSlide.boldIsStrong }"
                >{{ activeSlide.labelBold }}</span
              >{{ activeSlide.labelAfter }}
            </span>
          </template>
        </h2>
      </Transition>
      <p class="trust-tagline">
        <span class="trust-tagline-line">Más de <span class="trust-tagline-accent">10 años</span> consolidando</span>
        <span class="trust-tagline-line">carga desde China</span>
      </p>
    </header>

    <div class="trust-carousel-wrap">
      <div class="trust-carousel-clip">
        <div
          :id="trackId"
          ref="track"
          class="trust-carousel"
          :class="{ 'trust-carousel--snap-layout': snapLayout }"
          tabindex="0"
          role="region"
          aria-label="Etapas del consolidado"
          @pointerdown.passive="onTrackPointerDown"
        >
        <article
          v-for="(item, j) in orderedSlides"
          :key="item.slide.step"
          class="trust-slide"
          :class="{ 'trust-slide--active': j === 0, 'trust-slide--selectable': j !== 0 }"
          data-trust-slide
          :data-trust-tier="String(Math.min(j, 4))"
          :data-trust-source-index="String(item.sourceIndex)"
          :aria-label="slideAria(item.slide)"
          :aria-current="j === 0 ? 'step' : undefined"
          @pointerdown="onSlidePointerDown($event, item.sourceIndex, j)"
          @pointerup="onSlidePointerUp($event, item.sourceIndex, j)"
          @pointercancel="onSlidePointerCancel"
        >
          <div class="trust-slide-visual">
            <img
              :src="item.slide.figma"
              alt=""
              class="trust-slide-img"
              width="369"
              height="491"
              loading="lazy"
              decoding="async"
              @error="onImgError(item.slide, $event)"
            />
          </div>
          <div class="trust-slide-meta">
            <span class="trust-badge" aria-hidden="true">{{ item.slide.step }}</span>
            <p class="trust-caption">
              <template v-if="item.slide.plain">{{ item.slide.plain }}</template>
              <template v-else>
                {{ item.slide.labelBefore }}
                <span
                  class="trust-caption-strong"
                  :class="{ 'trust-caption-strong--eb': item.slide.boldIsStrong }"
                >{{ item.slide.labelBold }}</span>{{ item.slide.labelAfter }}
              </template>
            </p>
          </div>
        </article>
        </div>
      </div>

      <div class="trust-dots" role="tablist" aria-label="Paso del carrusel">
        <button
          v-for="(_, i) in slides"
          :key="i"
          type="button"
          class="trust-dot"
          :class="{ 'trust-dot--active': i === activeIdx }"
          role="tab"
          :aria-selected="i === activeIdx"
          :aria-controls="trackId"
          @click="goTo(i)"
        >
          <span class="visually-hidden">Paso {{ i + 1 }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .trust-carousel-root {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .trust-header {
    text-align: left;
    margin-bottom: clamp(36px, 5vw, 52px);
    max-width: 44rem;
  }

  .trust-eyebrow {
    font-family: 'Sora', var(--font-heading), system-ui, sans-serif;
    font-size: clamp(14px, 1.8vw, 20px);
    font-weight: 400;
    line-height: 1.26;
    color: #ff733b;
    text-transform: uppercase;
    margin: 0 0 clamp(16px, 2.2vw, 24px);
    letter-spacing: 0.04em;
  }

  .trust-title {
    font-family: 'Epilogue', var(--font-heading), system-ui, sans-serif;
    font-size: clamp(2.25rem, 5.5vw, 4rem);
    font-weight: 300;
    color: #fff;
    letter-spacing: -0.06em;
    line-height: 0.98;
    margin: 0 0 clamp(14px, 2vw, 20px);
    min-height: 2.2em;
  }

  .trust-title-line {
    display: block;
  }

  .trust-title-line--accent-full {
    background: linear-gradient(90deg, #ff5410 0%, #ff733b 75.48%, #ff5410 100%);
    background-size: 120% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
    font-weight: 500;
  }

  .trust-title-accent-inline {
    font-weight: 500;
    background: linear-gradient(90deg, #ff5410 0%, #ff733b 75.48%, #ff5410 100%);
    background-size: 120% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
  }

  .trust-title-accent-inline--eb {
    font-weight: 700;
  }

  .trust-tagline {
    margin: 0;
    font-family: 'Epilogue', var(--font-body), system-ui, sans-serif;
    font-size: clamp(1rem, 2.2vw, 1.2rem);
    font-weight: 400;
    line-height: 1.2;
    letter-spacing: -0.03em;
    color: rgba(255, 255, 255, 0.72);
  }

  .trust-tagline-line {
    display: block;
  }

  .trust-tagline-line:first-child {
    margin-bottom: 0.08em;
  }

  .trust-tagline-accent {
    font-weight: 500;
    color: rgba(255, 255, 255, 0.88);
  }

  .trust-head-swap-enter-active,
  .trust-head-swap-leave-active {
    transition:
      opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .trust-head-swap-enter-from,
  .trust-head-swap-leave-to {
    opacity: 0;
    transform: translateY(10px);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Mismo inicio horizontal que “Confía en nosotros” (sin centrar en el contenedor). */
  .trust-carousel-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: min(80vw, 100%);
    max-width: 100%;
    margin-inline: 0;
    margin:0 auto;
    box-sizing: border-box;
    --trust-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --trust-gap: clamp(12px, 1.8vw, 20px);
    --trust-cascade-ratio: 0.72;
    --trust-r2: calc(var(--trust-cascade-ratio) * var(--trust-cascade-ratio));
    --trust-r3: calc(var(--trust-r2) * var(--trust-cascade-ratio));
    --trust-r4: calc(var(--trust-r3) * var(--trust-cascade-ratio));
    /* Tarjeta activa: más grande según viewport (carrusel ~80vw) */
    --trust-w-lg: clamp(220px, 46vw, 460px);
    --trust-v-active: min(62vh, min(600px, 70vw));
    --trust-peek: clamp(24px, 5.5vw, 48px);
  }

  .trust-carousel-clip {
    overflow: hidden;
    width: 100%;
    max-width: 100%;
    margin-inline: 0;
    /* Aire vertical: sombras y scale en la animación no pegan contra el clip */
    padding-block: clamp(10px, 2vw, 18px);
    box-sizing: border-box;
  }

  .trust-carousel {
    display: flex;
    align-items: center;
    gap: var(--trust-gap);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    /* programmatic scroll usa 'instant'; el arrastre sigue siendo nativo */
    scroll-behavior: auto;
    padding: 8px 0 12px;
    padding-inline: clamp(4px, 1vw, 8px);
    scrollbar-width: none;
    -ms-overflow-style: none;
    outline: none;
  }

  /* Un frame: anchos/altos al nuevo tier sin interpolar → medición y scroll precisos, menos lag */
  .trust-carousel--snap-layout .trust-slide {
    transition: none;
  }

  .trust-carousel--snap-layout .trust-slide-visual {
    transition: none;
  }

  .trust-carousel::-webkit-scrollbar {
    display: none;
  }

  .trust-slide {
    --trust-slot: calc(var(--trust-w-lg) * var(--trust-r4));
    flex: 0 0 var(--trust-slot);
    width: var(--trust-slot);
    min-width: 0;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: clamp(10px, 1.8vw, 16px);
    transition:
      flex-basis 0.42s var(--trust-ease),
      width 0.42s var(--trust-ease);
  }

  .trust-slide--selectable {
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .trust-slide[data-trust-tier='0'] {
    --trust-slot: var(--trust-w-lg);
  }

  .trust-slide[data-trust-tier='1'] {
    --trust-slot: calc(var(--trust-w-lg) * var(--trust-cascade-ratio));
  }

  .trust-slide[data-trust-tier='2'] {
    --trust-slot: calc(var(--trust-w-lg) * var(--trust-r2));
  }

  .trust-slide[data-trust-tier='3'] {
    --trust-slot: calc(var(--trust-w-lg) * var(--trust-r3));
  }

  .trust-slide[data-trust-tier='4'] {
    --trust-slot: calc(var(--trust-w-lg) * var(--trust-r4));
  }

  .trust-slide-visual {
    /* Fallback sin container queries */
    border-radius: clamp(16px, 4.2vw, 52px);
    overflow: hidden;
    background: #1a1a1a;
    /*
     * Evitar recorte con object-fit: cover: si width=100% y aspect-ratio chocan con max-height,
     * la caja queda “aplastada” y la foto se corta. Limitar ancho al que cabe en max-height (3:4).
     */
    width: min(100%, calc(var(--trust-v-active) * var(--trust-r4) * 3 / 4));
    margin-inline: auto;
    aspect-ratio: 3 / 4;
    max-height: calc(var(--trust-v-active) * var(--trust-r4));
    transform-origin: center center;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    transition:
      aspect-ratio 0.42s var(--trust-ease),
      max-height 0.42s var(--trust-ease),
      box-shadow 0.45s ease;
  }

  /* Radio exacto ~12.5% del ancho de cada tarjeta (48/369 en Figma) */
  @supports (width: 1cqw) {
    .trust-slide-visual {
      border-radius: clamp(14px, 12.5cqw, 56px);
    }
  }

  .trust-slide--active .trust-slide-visual {
    will-change: transform;
    aspect-ratio: 369 / 491;
    max-height: var(--trust-v-active);
    /* Misma lógica: caber en max-height manteniendo 369:491 (Figma) */
    width: min(100%, calc(var(--trust-v-active) * 369 / 491));
    margin-inline: auto;
    transform: scale(1);
    box-shadow:
      0 28px 64px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 106, 41, 0.22),
      0 14px 44px rgba(255, 83, 15, 0.22);
  }

  .trust-slide:not(.trust-slide--active)[data-trust-tier='1'] .trust-slide-visual {
    max-height: calc(var(--trust-v-active) * var(--trust-cascade-ratio));
    width: min(100%, calc(var(--trust-v-active) * var(--trust-cascade-ratio) * 3 / 4));
  }

  .trust-slide:not(.trust-slide--active)[data-trust-tier='2'] .trust-slide-visual {
    max-height: calc(var(--trust-v-active) * var(--trust-r2));
    width: min(100%, calc(var(--trust-v-active) * var(--trust-r2) * 3 / 4));
  }

  .trust-slide:not(.trust-slide--active)[data-trust-tier='3'] .trust-slide-visual {
    max-height: calc(var(--trust-v-active) * var(--trust-r3));
    width: min(100%, calc(var(--trust-v-active) * var(--trust-r3) * 3 / 4));
  }

  .trust-slide:not(.trust-slide--active)[data-trust-tier='4'] .trust-slide-visual {
    max-height: calc(var(--trust-v-active) * var(--trust-r4));
    width: min(100%, calc(var(--trust-v-active) * var(--trust-r4) * 3 / 4));
  }

  .trust-slide-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
    filter: grayscale(100%);
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .trust-slide--active:hover .trust-slide-img {
    transform: scale(1.03);
  }

  .trust-slide-meta {
    display: none;
    flex-direction: row;
    align-items: flex-start;
    gap: 14px;
    min-height: 0;
  }

  .trust-slide--active .trust-slide-meta {
    display: flex;
  }

  .trust-badge {
    flex-shrink: 0;
    width: clamp(46px, 3.2vw, 60px);
    height: clamp(46px, 3.2vw, 60px);
    border-radius: clamp(11px, 0.9vw, 16px);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Sora', var(--font-heading), system-ui, sans-serif;
    font-size: clamp(1.15rem, 2.4vw, 1.45rem);
    font-weight: 400;
    line-height: 1;
    color: #fff;
    text-shadow: 0 0 25px rgba(255, 255, 255, 0.35);
    background: linear-gradient(90deg, #ff5410 0%, #ff733b 46.5%, #ff5410 100%);
    border: 0.5px solid #ff6a29;
    box-shadow: 0 1px 18px 12px rgba(255, 106, 41, 0.18);
  }

  @supports (width: 1cqw) {
    .trust-badge {
      width: clamp(46px, 14cqw, 72px);
      height: clamp(46px, 14cqw, 72px);
      border-radius: clamp(10px, 3.5cqw, 18px);
      font-size: clamp(1.1rem, 5.2cqw, 1.65rem);
    }
  }

  .trust-caption {
    margin: 0;
    padding-top: 4px;
    font-family: 'Epilogue', var(--font-body), system-ui, sans-serif;
    font-size: clamp(1rem, 2vw, 1.35rem);
    font-weight: 400;
    color: #fff;
    line-height: 1.15;
    letter-spacing: -0.01em;
    flex: 1;
    min-width: 0;
  }

  .trust-caption-strong {
    font-weight: 600;
  }

  .trust-caption-strong--eb {
    font-weight: 700;
  }

  .trust-dots {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    margin-top: clamp(24px, 4vw, 36px);
    width: 100%;
    max-width: 100%;
  }

  .trust-dot {
    width: 10px;
    height: 10px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: #5c5c5c;
    cursor: pointer;
    transition:
      background 0.35s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.35s cubic-bezier(0.34, 1.2, 0.64, 1),
      box-shadow 0.35s ease;
  }

  .trust-dot--active {
    background: linear-gradient(90deg, #ff5410, #ff733b);
    transform: scale(1.35);
    box-shadow: 0 0 12px rgba(255, 106, 41, 0.45);
  }

  .trust-dot:hover:not(.trust-dot--active) {
    background: #8a8a8a;
  }

  .trust-dot:focus-visible {
    outline: 2px solid #ff733b;
    outline-offset: 3px;
  }

  @media (min-width: 900px) {
    .trust-carousel-wrap {
      --trust-w-lg: clamp(280px, 38vw, 500px);
      --trust-v-active: min(64vh, min(640px, 58vw));
      --trust-peek: clamp(28px, 4.2vw, 52px);
    }
  }

  @media (min-width: 1200px) {
    .trust-carousel-wrap {
      --trust-w-lg: clamp(300px, 34vw, 520px);
      --trust-v-active: min(66vh, 680px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .trust-slide,
    .trust-slide-visual,
    .trust-slide-meta,
    .trust-slide-img,
    .trust-dot {
      transition: none !important;
    }

    .trust-slide-visual {
      transform: scale(1);
    }
  }
</style>
