# Visor de recorridos virtuales 360 · React + TypeScript + Tailwind

Base funcional del visor: panorámica equirectangular a pantalla completa, capa de
interfaz superpuesta y **joystick virtual** en la esquina inferior izquierda que
mueve el `yaw` y el `pitch` de la cámara.

Diseñado *mobile-first*: el pulgar izquierdo gira, el derecho hace zoom y
reencuadra, y los cambios de habitación viven arriba para no estorbar.

---

## 1. Arranque

```bash
npm install
npm run dev
```

Vite imprime dos URLs. La segunda (**Network**) sirve para abrirlo desde el
celular en el mismo Wi-Fi, que es donde de verdad se prueba un joystick.

Otros comandos:

```bash
npm run build       # tsc + build de producción
npm run typecheck   # solo tipos
npm run lint        # oxlint
```

---

## 2. Dependencias que se instalaron y por qué

```bash
# Proyecto base
npm create vite@latest visor-tour-360 -- --template react-ts

# Motor 3D
npm install three @react-three/fiber
npm install -D @types/three

# Estilos (Tailwind v4: plugin de Vite, sin tailwind.config.js)
npm install -D tailwindcss @tailwindcss/vite
```

Versiones con las que se construyó y verificó:

| Paquete            | Versión |
| ------------------ | ------- |
| react / react-dom  | 19.2    |
| three              | 0.185   |
| @react-three/fiber | 9.7     |
| tailwindcss        | 4.3     |
| vite               | 8.2     |
| typescript         | 6.0     |

**No se usó `pannellum-react`.** Ese paquete no recibe una publicación desde
2020 y declara `peerDependencies` de React 16, así que con React 18/19 la
instalación falla o queda en un estado inconsistente. Además su cámara tiene su
propia inercia interna: para moverla con un joystick habría que llamar
`setYaw()` en cada frame peleándose con su animación. Con React Three Fiber la
cámara es tuya y el joystick le escribe directo.

`@react-three/drei` **no** está instalado: no hacía falta para esta base. Si más
adelante quieres `<Html>`, `useTexture`, controles listos, etc.:

```bash
npm install @react-three/drei
```

**Tailwind v4 no lleva `tailwind.config.js`.** El tema vive en `src/index.css`
dentro del bloque `@theme`. Si vienes de la v3, ese es el cambio que más
confunde.

---

## 3. Estructura

```
src/
├── App.tsx                     Monta <TourViewer tour={demoTour} />
├── index.css                   Tailwind v4 + tema de marca (@theme) + reset móvil
├── data/tour.ts                Habitaciones y hotspots del recorrido
├── lib/
│   ├── types.ts                Tour, TourScene, Hotspot
│   ├── math.ts                 clamp, damp, wrap, (yaw,pitch) → Vector3
│   ├── tourEngine.ts           * El objeto mutable que conecta UI <-> cámara
│   ├── useDragLook.ts          Arrastrar para mirar + pellizco para zoom
│   ├── useKeyboardLook.ts      Flechas / WASD en escritorio
│   └── useEquirectTexture.ts   Carga y caché de panorámicas
└── components/
    ├── TourViewer.tsx          Composición: canvas + overlay + estados
    ├── tour/
    │   ├── CameraRig.tsx       * Traduce el input a rotación de cámara
    │   └── PanoSphere.tsx      La esfera 360 y el fundido entre habitaciones
    └── ui/
        ├── Joystick.tsx        * Joystick con Pointer Events
        ├── HotspotLayer.tsx    Marcadores DOM proyectados sobre la escena
        ├── RoomBar.tsx         Selector de habitaciones
        ├── Compass.tsx         Brújula
        ├── ZoomControls.tsx    + / −
        ├── InfoSheet.tsx       Panel inferior de los hotspots informativos
        ├── LoadingVeil.tsx     Spinner de carga
        └── DebugAngles.tsx     Badge con yaw/pitch/fov (solo en dev)

tools/make_test_panoramas.py    Genera las panorámicas de prueba
```

Las tres piezas marcadas con `*` son las que importa entender. El resto es
decoración reemplazable.

---

## 4. Cómo se conecta el joystick con la cámara

### El puente: un objeto mutable, no `useState`

Un pulgar genera unos 120 eventos por segundo. Si cada uno pasara por
`useState`, React re-renderizaría el árbol 120 veces por segundo y el visor se
arrastraría en un celular de gama media.

En vez de eso todo viaja por un objeto que nunca cambia de identidad
(`src/lib/tourEngine.ts`):

```
Joystick / arrastre / zoom  --escriben-->  engine.input   --lee-->  CameraRig (useFrame)
CameraRig  --escribe cada frame-->  engine.readout  --lee (rAF propio)-->  Brújula, hotspots, badge
```

React solo se entera de los cambios "grandes": habitación, carga, panel abierto.
El movimiento de la cámara no provoca ni un render.

Por eso el linter marca varios `react/immutability`: están silenciados a
propósito, con la razón escrita arriba de cada archivo.

### La matemática (`src/components/tour/CameraRig.tsx`)

La cámara está en el origen y mira por defecto hacia `-Z`. Con orden de Euler
`YXZ` (primero yaw en el eje Y del mundo, después pitch en el eje X ya girado,
igual que una cámara en primera persona):

```ts
camera.rotation.order = 'YXZ'
camera.rotation.y = -yaw   * (Math.PI / 180)
camera.rotation.x = +pitch * (Math.PI / 180)
```

**El signo negativo del yaw es la parte que casi siempre sale al revés.** En
three.js, girar `+θ` sobre Y lleva la mirada de `-Z` hacia `-X`, y `-X` está a la
*izquierda* de la cámara. O sea: `+rotation.y` = mirar a la izquierda. Como
queremos "joystick a la derecha → cámara a la derecha", se invierte.

El joystick no da una posición absoluta sino una **velocidad angular**:

```ts
targetYaw   += axis.x * velocidad * dt
targetPitch += axis.y * velocidad * dt
```

Multiplicar por `dt` (y no por frame) hace que gire igual a 60 y a 120 Hz.
Después, el ángulo real persigue al objetivo con una interpolación exponencial
(`damp`), que es de donde sale la inercia.

Tres decisiones que no son obvias y que evitan bugs feos:

- **El yaw interno nunca se normaliza.** Crece sin límite y puede valer 3000°. Si
  se envolviera a (−180, 180] el suavizado daría un latigazo de vuelta completa
  cada vez que cruzas la costura. Solo se normaliza para mostrarlo en la brújula.
- **La velocidad escala con el FOV.** Con zoom cerrado, el mismo giro en grados
  recorre muchos más píxeles en pantalla; escalando por `fov/75` el joystick se
  siente igual de preciso con y sin zoom.
- **`dt` se topa en 100 ms, no en 16.** Topar cerca del framerate normal haría que
  en un equipo lento el joystick girara *más despacio*, porque se descartaría
  parte del tiempo transcurrido. Con 100 ms aguanta hasta 10 fps sin penalizar y
  sigue evitando el salto que produce volver a una pestaña en segundo plano.

### El joystick (`src/components/ui/Joystick.tsx`)

Componente propio con Pointer Events en lugar de una librería:

- `setPointerCapture` mantiene el gesto vivo aunque el dedo se salga del
  círculo, que es justo lo que pasa cuando alguien empuja fuerte para girar.
- La posición del knob se escribe directo al DOM (`style.transform`), sin estado.
- `touch-action: none` es **obligatorio**: sin eso el navegador se queda con el
  gesto para hacer scroll y el joystick deja de recibir `pointermove`.
- Modo `floating` (por defecto): la base aparece donde pongas el pulgar dentro
  de la zona, como en los shooters móviles. Perdona muchísimo la puntería.
- Zona muerta del 8 % y curva de respuesta cuadrática: control fino cerca del
  centro, velocidad completa en el borde.

---

## 5. Meter tus panorámicas

1. Deja los JPG en `public/panoramas/`.
2. Que sean **equirectangulares 2:1** (6000×3000, 8192×4096…). Para web, el punto
   dulce es **4096×2048 en JPG calidad 80**: se ve bien y pesa ~1 MB. Arriba de
   8192 px muchos celulares ya no pueden con la textura.
3. Edita `src/data/tour.ts`: `image`, `name` y los `hotspots`.

Los ángulos van en **grados**: `yaw` 0 es el frente de la escena y crece hacia la
derecha; `pitch` 0 es el horizonte y crece hacia arriba.

Para sacar los ángulos de un hotspot sin adivinar: corre `npm run dev`, apunta la
cámara justo a donde lo quieres y copia los números del badge que aparece bajo la
barra de habitaciones (solo sale en desarrollo).

Las panorámicas incluidas son sintéticas y sirven para **verificar**: traen
rejilla de 15°, horizonte marcado y las letras N / E / S / O en su yaw correcto.
Al arrancar debe verse la **N** centrada; empujando el joystick a la derecha debe
aparecer la **E**. Se regeneran con:

```bash
npm run panoramas:demo      # requiere Python 3 con Pillow
```

---

## 6. Vestirlo con tu marca

Casi todo sale de `src/index.css`, en el bloque `@theme`:

```css
@theme {
  --color-brand-500: oklch(0.72 0.16 72);   /* acento: joystick, hotspots, activo */
  --color-ink-900:   oklch(0.17 0.015 260); /* vidrio del HUD */
  --radius-hud:      1.25rem;
}
```

Cambiar esos valores repinta el joystick, los hotspots, la barra de habitaciones
y los botones de zoom. El "vidrio" del HUD es la utilidad `hud-glass`, definida
en el mismo archivo.

Para el logo: `TourViewer.tsx`, en la tarjeta de la barra superior.

---

## 7. Ajustes rápidos

Casi todo son props de `<CameraRig>` (en `TourViewer.tsx`) o de `<Joystick>`:

| Qué quieres cambiar              | Dónde                                 | Valor actual |
| -------------------------------- | ------------------------------------- | ------------ |
| Velocidad de giro                | `CameraRig maxSpeedDeg`               | 90 °/s       |
| Inercia (más alto = más seco)    | `CameraRig smoothing`                 | 12           |
| Tope de inclinación              | `CameraRig maxPitchDeg`               | 85°          |
| Rango de zoom                    | `CameraRig minFov` / `maxFov`         | 30° – 100°   |
| Invertir el eje vertical         | `CameraRig invertY`                   | `false`      |
| Tamaño del joystick              | `Joystick size` / `knobSize`          | 124 / 54 px  |
| Zona muerta                      | `Joystick deadZone`                   | 0.08         |
| Curva de respuesta               | `Joystick curve`                      | 2            |
| Joystick fijo en vez de flotante | `Joystick mode="fixed"`               | `floating`   |
| Zona táctil del pulgar           | clase `h-40 w-40` en `TourViewer.tsx` | 160 px       |

---

## 8. Notas de móvil que ya están resueltas

- `h-[100dvh]` en vez de `100vh`: `vh` no descuenta la barra del navegador y el
  joystick se queda debajo del borde de la pantalla.
- `viewport-fit=cover` + `env(safe-area-inset-*)`: los controles esquivan el
  notch y la barra de gestos.
- `user-scalable=no`: sin eso, el pellizco para hacer zoom en la panorámica hace
  zoom en la *página*.
- `overscroll-behavior: none` y `touch-action: none`: nada de rebote ni scroll
  accidental sobre el visor.
- `dpr={[1, 2]}`: se limita el device pixel ratio; renderizar a 3x en un celular
  moderno tira el framerate a la mitad sin que se note la diferencia.

---

## 9. Qué se verificó

Automatizado con Playwright sobre Chromium, viewport de celular (390×844, 2x):

| Prueba                                                | Resultado                 |
| ----------------------------------------------------- | ------------------------- |
| Yaw inicial y foto no espejeada                       | N centrada, yaw 0° ✓      |
| Joystick a la derecha → cámara a la derecha           | yaw creciente ✓           |
| Velocidad a deflexión máxima                          | 91 °/s (objetivo 90) ✓    |
| Curva cuadrática a media deflexión                    | 17.7 °/s (teórico 17.5) ✓ |
| Joystick arriba → mirar arriba, con tope              | pitch → 85° exacto ✓      |
| Zona muerta con micro-empujón                         | sin deriva ✓              |
| Arrastrar el dedo a la izquierda → girar a la derecha | yaw creciente ✓           |
| Zoom con botones y con rueda                          | FOV 75° → 65° ✓           |
| Reencuadrar                                           | vuelve a 0° / 0° / 75° ✓  |
| Hotspot: aparece, se toca y cambia de habitación      | Sala → Cocina ✓           |
| Flechas / WASD en escritorio                          | ✓                         |
| Errores de consola                                    | ninguno ✓                 |

> El framerate en esa verificación es bajo (~9 fps) porque Chromium corre con
> renderizado por software. En un dispositivo con GPU va a 60 fps.

---

## 10. Publicarlo en internet (GitHub Pages)

El visor es una página estática: no necesita servidor, base de datos ni nada que
se quede corriendo. Se compila una vez y el resultado se sube tal cual.

```bash
npm run build:pages     # compila a docs/ con rutas relativas
git add docs && git commit -m "publica el visor" && git push
```

En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` /
`docs`**. En un par de minutos queda en
`https://<usuario>.github.io/<repositorio>/`, que es un link normal: se abre en
cualquier celular, sin instalar nada y sin cuenta.

Dos detalles que hacen que esto funcione y que conviene no romper:

- El build usa `--base=./` y las panorámicas se resuelven con el helper
  `asset()` de `src/lib/assets.ts`. Sin las dos cosas, una ruta absoluta como
  `/panoramas/sala.jpg` se va a la raíz del dominio y devuelve 404: pantalla
  negra sin ningún mensaje. Cualquier archivo nuevo que vivas en `public/` debe
  pasar por `asset()`.
- `docs/.nojekyll` evita que GitHub procese la carpeta con Jekyll.

Para un dominio propio (`recorridos.thiqa.mx`, por ejemplo) sirve la misma
carpeta: Pages acepta dominio personalizado, o se sube `docs/` por FTP a
cualquier hosting.

---

## 11. Siguientes pasos naturales

- Hotspots colocados visualmente en vez de a mano (clic sobre la escena y se
  guarda el yaw/pitch del badge).
- Giroscopio (`DeviceOrientationEvent`) para mirar moviendo el teléfono.
- Modo VR con WebXR (`@react-three/xr`).
- Planta arquitectónica con la posición de cada escena.
- Mosaicos multirresolución si vas a usar panorámicas mayores a 8K.
