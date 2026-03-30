<script setup lang="ts">
/**
 * Carrusel "Trust" (pasos): activo grande + título, resto escalonado (~72% cascada),
 * orden circular (el activo siempre primero), dots + teclado + swipe infinito.
 * Navegación 100 % programática (overflow:hidden) — sin scroll sync, sin jumps, sin pausa.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, useTemplateRef } from 'vue';
import { onKeyDown } from '@vueuse/core';
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
const track = useTemplateRef<HTMLElement>('track');

const activeIdx = ref(0);

/** Orden circular: primero el activo, luego los siguientes y al final los que "dan la vuelta". */
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

let enterTimeline: Timeline | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stopEnterAnimations() {
  enterTimeline?.revert();
  enterTimeline = null;
}

function getSlideEls(): HTMLElement[] {
  const t = track.value;
  if (!t) return [];
  return Array.from(t.querySelectorAll<HTMLElement>('[data-trust-slide]'));
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

      tl.add(visual, { opacity: [0.93, 1], scale: [0.92, 1.012, 1], duration: 600, ease: 'out(3)' }, 0);

      if (badge) {
        tl.add(badge, { opacity: 0, scale: 0.84, duration: 0 }, 0);
        tl.add(badge, { opacity: [0, 1], scale: [0.84, 1.06, 1], duration: 500, ease: 'out(2.2)' }, 68);
      }

      if (caption) {
        tl.add(caption, { opacity: 0, y: 11, duration: 0 }, 0);
        tl.add(caption, { opacity: [0, 1], y: [11, 0], duration: 420, ease: 'outQuart' }, 132);
      }

      enterTimeline = tl;
    });
  });
}

function slideAria(s: TrustSlide): string {
  if (s.plain) return `Paso ${s.step}: ${s.plain}`;
  return `Paso ${s.step}: ${s.labelBefore}${s.labelBold}${s.labelAfter}`.replace(/\s+/g, ' ').trim();
}

function onImgError(s: TrustSlide, e: Event) {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.getAttribute('src') === s.fallback) return;
  img.src = s.fallback;
}

// ─── Swipe via pointer events ───────────────────────────────────────────────
// Usamos pointer events (no touch/scroll) para detectar swipe en ambas direcciones.
// Con overflow:hidden no hay scroll que intercepte el gesto.

let swipePointerId: number | null = null;
let swipeStartX = 0;
let swipeStartY = 0;
/** Si pointermove indica gesto vertical dominante, cancelar swipe horizontal. */
let swipeAborted = false;

function onTrackPointerDown(e: PointerEvent) {
  if (swipePointerId !== null) return;
  swipePointerId = e.pointerId;
  swipeStartX = e.clientX;
  swipeStartY = e.clientY;
  swipeAborted = false;
  // Capturar el puntero para recibir pointerup aunque salga del elemento
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
}

function onTrackPointerMove(e: PointerEvent) {
  if (e.pointerId !== swipePointerId || swipeAborted) return;
  const dx = Math.abs(e.clientX - swipeStartX);
  const dy = Math.abs(e.clientY - swipeStartY);
  // Si el movimiento vertical supera al horizontal antes de los 12px, abortar
  if (dy > dx && dy > 8) swipeAborted = true;
}

function onTrackPointerUp(e: PointerEvent) {
  if (e.pointerId !== swipePointerId) return;
  const pid = swipePointerId;
  swipePointerId = null;

  if (swipeAborted) return;

  const dx = e.clientX - swipeStartX;
  const dy = e.clientY - swipeStartY;

  // Requiere componente horizontal dominante y al menos 36px de desplazamiento
  if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

  const n = props.slides.length;
  if (!n) return;

  try { (e.currentTarget as HTMLElement).releasePointerCapture(pid); } catch { /* noop */ }

  if (dx < 0) goTo((activeIdx.value + 1) % n);       // swipe izquierda → siguiente
  else        goTo((activeIdx.value - 1 + n) % n);   // swipe derecha  → anterior
}

function onTrackPointerCancel(e: PointerEvent) {
  if (e.pointerId === swipePointerId) {
    swipePointerId = null;
    swipeAborted = true;
  }
}

// ─── Tap en tarjeta inactiva ─────────────────────────────────────────────────
let tapPid: number | null = null;
let tapStartX = 0;
let tapStartY = 0;
let tapSourceIdx = -1;
let tapDomIdx = -1;

function onSlidePointerDown(e: PointerEvent, sourceIndex: number, domIndex: number) {
  if (domIndex === 0) return; // la activa no necesita tap
  if (e.button !== 0 && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  tapPid = e.pointerId;
  tapStartX = e.clientX;
  tapStartY = e.clientY;
  tapSourceIdx = sourceIndex;
  tapDomIdx = domIndex;
}

function onSlidePointerUp(e: PointerEvent, sourceIndex: number, domIndex: number) {
  if (e.pointerId !== tapPid || domIndex !== tapDomIdx) { tapPid = null; return; }
  tapPid = null;
  if (Math.abs(e.clientX - tapStartX) > 16 || Math.abs(e.clientY - tapStartY) > 16) return;
  goTo(sourceIndex);
}

function onSlidePointerCancel(e: PointerEvent) {
  if (e.pointerId === tapPid) tapPid = null;
}

// ─── Navegación ──────────────────────────────────────────────────────────────
function goTo(i: number) {
  const n = props.slides.length;
  if (i < 0 || i >= n || i === activeIdx.value) return;
  activeIdx.value = i;
  runEnterAnimations();
}

let stopKeyNav: (() => void) | undefined;

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
      else                        goTo((cur - 1 + n) % n);
    },
    { target: document },
  );
});

onBeforeUnmount(() => {
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
          tabindex="0"
          role="region"
          aria-label="Etapas del consolidado"
          @pointerdown="onTrackPointerDown"
          @pointermove="onTrackPointerMove"
          @pointerup="onTrackPointerUp"
          @pointercancel="onTrackPointerCancel"
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

  .trust-carousel-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: min(80vw, 100%);
    max-width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
    --trust-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --trust-gap: clamp(12px, 1.8vw, 20px);
    --trust-cascade-ratio: 0.72;
    --trust-r2: calc(var(--trust-cascade-ratio) * var(--trust-cascade-ratio));
    --trust-r3: calc(var(--trust-r2) * var(--trust-cascade-ratio));
    --trust-r4: calc(var(--trust-r3) * var(--trust-cascade-ratio));
    --trust-w-lg: clamp(220px, 46vw, 460px);
    --trust-v-active: min(62vh, min(600px, 70vw));
    --trust-peek: clamp(24px, 5.5vw, 48px);
  }

  .trust-carousel-clip {
    overflow: hidden;
    width: 100%;
    max-width: 100%;
    /* Aire vertical: sombras y scale en la animación no pegan contra el clip */
    padding-block: clamp(10px, 2vw, 18px);
    box-sizing: border-box;
  }

  .trust-carousel {
    display: flex;
    align-items: center;
    gap: var(--trust-gap);
    /* Sin scroll: la navegación es 100 % programática.
       Esto evita el race condition scroll-reset ↔ reorder del DOM (jumps + pausa). */
    overflow: hidden;
    /* Permitir scroll vertical de página mientras se gestiona horizontal aquí */
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    padding: 8px 0 12px;
    padding-inline: clamp(4px, 1vw, 8px);
    outline: none;
    cursor: grab;
  }

  .trust-carousel:active {
    cursor: grabbing;
  }

  .trust-slide {
    --trust-slot: calc(var(--trust-w-lg) * var(--trust-r4));
    flex: 0 0 var(--trust-slot);
    width: var(--trust-slot);
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: clamp(10px, 1.8vw, 16px);
    transition:
      flex-basis 0.52s var(--trust-ease),
      width 0.52s var(--trust-ease);
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
    border-radius: clamp(16px, 4.2vw, 52px);
    overflow: hidden;
    background: #1a1a1a;
    width: min(100%, calc(var(--trust-v-active) * var(--trust-r4) * 3 / 4));
    margin-inline: auto;
    aspect-ratio: 3 / 4;
    max-height: calc(var(--trust-v-active) * var(--trust-r4));
    transform-origin: center center;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    transition:
      aspect-ratio 0.52s var(--trust-ease),
      max-height 0.52s var(--trust-ease),
      box-shadow 0.55s ease;
  }

  @supports (width: 1cqw) {
    .trust-slide-visual {
      border-radius: clamp(14px, 12.5cqw, 56px);
    }
  }

  .trust-slide--active .trust-slide-visual {
    will-change: transform;
    aspect-ratio: 369 / 491;
    max-height: var(--trust-v-active);
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
    transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
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
