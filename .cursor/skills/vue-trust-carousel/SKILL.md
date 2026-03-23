---
name: vue-trust-carousel
description: >-
  Implementa el carrusel de la sección Trust (Probusiness) en Vue 3 dentro de Astro:
  slide activo grande con título, escalado en cascada ~72% por tier, ventana 3+peek,
  centrado, dots/teclado/scroll, contentX + navPending para últimos slides. Usar cuando
  se pida carrusel Trust, TrustCarousel, pasos consolidado, o migrar el carrusel a Vue.
---

# Carrusel Trust (Vue + Astro)

## Ubicación en el proyecto

- **Componente:** `src/components/TrustCarousel.vue` (isla con `client:visible` o `client:load`).
- **Sección:** `src/components/TrustSection.astro` importa el Vue y pasa `slides={slides}`.
- **DOM:** `useTemplateRef<HTMLElement>('track')` + `ref="track"` (una sola ref; no hay API declarativa para `scrollTo`/`scrollLeft` sin elemento).
- **Scroll:** `@vueuse/core` → `useScroll(track, { throttle, onStop })` y `watch(x, …)` en lugar de `@scroll` en plantilla.
- **Teclado:** `onKeyDown` en `onMounted` con `{ target: document }` (evita `document` en SSR); comprobar `document.activeElement === track`.

## Reglas de producto / UX

1. **Activo:** una tarjeta ancha y alta; solo ella muestra badge + caption.
2. **Cascada:** cada tier respecto al activo usa `--trust-cascade-ratio` (0.72 ≈ 60–80 % de la anterior); anchos `W`, `W*r`, `W*r²`, …
3. **Vista:** clip con `max-width` = activo + dos escalonados + gaps + `--trust-peek`.
4. **Centrado:** wrap flex column `align-items: center`; track `align-items: center`; slides `justify-content: center`.
5. **Animación:** **anime.js v4** (`createTimeline` desde `animejs`): escala del `.trust-slide-visual` `[0.88, 1.04, 1]`, meta `opacity`/`y`, badge `scale`/`opacity` en paralelo (tiempo 0). Sin keyframes CSS para entrada. `revert()` al cambiar de slide rápido y en `onBeforeUnmount`. Si `prefers-reduced-motion`, no se lanza timeline.

## Lógica de scroll (no usar `offsetLeft` del slide vs `scrollLeft`)

- **`contentX(slide, track)`:** `track.scrollLeft + slide.getBoundingClientRect().left - track.getBoundingClientRect().left`.
- **`activeIndexFromScroll()`:** distancia mínima a `scrollLeft`; en el **fondo** (`scrollLeft >= maxScroll - ε`), si el último slide empieza “después” del scroll, devolver **último índice**; si no, el mayor `i` con `contentX(i) ≤ scrollLeft + ε`.
- **Dots / teclado (`goTo(i)`):** primero `activeIdx = i` (reflow tiers), luego `navPendingIndex = i`, doble `requestAnimationFrame`, `scrollTo({ left: clamp(contentX, 0, maxScroll), behavior: 'smooth' })`. Al terminar: `scrollend` + timeout ~520 ms llaman a `resolvePendingNav()` que hace `activeIdx = pending` **sin** sustituir por `activeIndexFromScroll()` (evita saltar del 5/6 al anterior).
- **Scroll manual:** si `navPendingIndex === null`, actualizar `activeIdx` desde `activeIndexFromScroll()` en `requestAnimationFrame` (throttle).

## Datos

- Props `slides`: `step`, `labelBefore`, `labelBold`, `labelAfter`, `figma`, `fallback`, opcional `plain`, `boldIsStrong`.
- Fallback de imagen: `@error` en `<img>` asigna `fallback` si aún no está.

## Astro

```astro
---
import TrustCarousel from './TrustCarousel.vue';
---
<TrustCarousel client:visible slides={slides} />
```

Usar `client:load` si el carrusel debe hidratarse antes (above the fold).

## Ajuste de tamaño viewport

- Variables en `.trust-carousel-wrap`: `--trust-w-lg`, `--trust-v-active`, `--trust-peek`, `--trust-cascade-ratio`.
- Tras cambiar `--trust-w-lg`, el `max-width` del clip (misma fórmula en CSS) debe seguir representando “3 tarjetas + peek”.
