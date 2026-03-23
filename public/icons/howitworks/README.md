# Iconos Figma → `HowItWorks.astro`

Origen: [Figma 4003-204](https://www.figma.com/design/ytKtPJwjbmgRlAmik1SM2x/LANDING-PAGE-PROBUSINESS--Copy-?node-id=4003-204).

El componente usa URLs temporales del MCP (`figma.com/api/mcp/asset/...`, ~7 días). Para fijarlos en el proyecto:

1. Descarga cada PNG/SVG desde Figma (o con las URLs mientras sigan vivas).
2. Guarda como `step-1.png` … `step-6.png` (paso 4 = dos archivos si separas capas).
3. En el frontmatter de `HowItWorks.astro`, cambia `icon` a `/icons/howitworks/step-N.png`.

UUID de referencia (MCP):  
`77b177e7…` (1), `4b607ea2…` (2), `b53882de…` (3), `05df9cac…` + `7bc5e27d…` (4), `e019c95b…` (5), `05c16af3…` (6).  
Camión: `d2c3b3b6…`
