# Visor de recorridos virtuales 360 · React + TypeScript + Tailwind

Dos mitades que viven en la misma página estática:

**VER** · panorámica equirectangular a pantalla completa, capa de interfaz
superpuesta y **joystick virtual** en la esquina inferior izquierda que mueve el
`yaw` y el `pitch` de la cámara. Es lo que ve quien recibe el link.

**CREAR** · el recorrido se arma **desde el celular**: se abre la cámara, se gira
sobre el propio eje siguiendo unos puntos guía y el visor cose las fotos en una
equirectangular; o se sube una foto 360 que ya se tenga. Después se nombran las
habitaciones, se colocan los puntos tocando la escena y todo queda guardado en el
teléfono, con un archivo `.tour` para respaldarlo o pasarlo a otro dispositivo.

Sin servidor, sin cuenta y sin instalar nada: sigue siendo un sitio estático.

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
npm run build:pages # compila a docs/ para GitHub Pages
```

Con el servidor de desarrollo corriendo hay dos páginas de diagnóstico:

| Página                          | Para qué |
| ------------------------------- | -------- |
| `/prueba.html`                  | Abrirla **en el celular**: dice si hay https, cámara, sensores, WebGL y espacio |
| `/tools/pruebas/costura.html`   | Verifica la costura reconstruyendo una panorámica conocida (sección 11) |

Y una tercera, que se corre desde la terminal:

```bash
node tools/pruebas/memoria.mjs http://localhost:5173/   # memoria de video (sección 10)
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
├── App.tsx                     Enrutador: decide entre VER y CREAR
├── index.css                   Tailwind v4 + tema de marca (@theme) + reset móvil
├── data/tour.ts                El recorrido de ejemplo
├── lib/
│   ├── types.ts                Tour, TourScene, Hotspot
│   ├── math.ts                 * ángulos, y las proyecciones pantalla <-> escena
│   ├── tourEngine.ts           * El objeto mutable que conecta UI <-> cámara
│   ├── useDragLook.ts          Arrastrar para mirar + pellizco para zoom
│   ├── useKeyboardLook.ts      Flechas / WASD en escritorio
│   ├── useEquirectTexture.ts   Carga y caché de panorámicas
│   ├── useHashRoute.ts         Rutas dentro del # (funcionan en GitHub Pages)
│   ├── dispositivo.ts          * Qué se permite según la memoria del aparato
│   ├── texturasVivas.ts        Puente que evita que la lista importe three.js
│   ├── capture/                ── armar la panorámica ──
│   │   ├── orientation.ts      * ¿hacia dónde apunta el teléfono?
│   │   ├── camera.ts           getUserMedia, lentes, errores en español
│   │   ├── frames.ts           congelar tomas, brillo, calibrar el FOV
│   │   ├── plan.ts             a dónde hay que apuntar y en qué orden
│   │   ├── stitcher.ts         * la costura equirectangular en la GPU
│   │   └── importar.ts         fotos 360, panorámicas de celular y GPano
│   └── store/                  ── guardar y compartir ──
│       ├── idb.ts              IndexedDB a pelo
│       ├── tours.ts            CRUD, blobs y resolución a Tour de runtime
│       ├── zip.ts              escritor y lector de ZIP sin dependencias
│       ├── paquete.ts          el archivo .tour
│       ├── quota.ts            espacio del navegador
│       └── ids.ts              identificadores
└── components/
    ├── TourViewer.tsx          Composición del visor: escena + overlay + estados
    ├── tour/
    │   ├── Escena360.tsx       Canvas + rig + esfera (lo comparten visor y editor)
    │   ├── CameraRig.tsx       * Traduce el input a rotación de cámara
    │   ├── PanoSphere.tsx      La esfera 360 y el fundido entre habitaciones
    │   └── ViewerGuard.tsx     Red de seguridad de WebGL
    ├── ui/                     Joystick, hotspots, brújula, zoom, hojas…
    └── crear/                  ── las pantallas de creación ──
        ├── Inicio.tsx          Mis recorridos
        ├── EditorRecorrido.tsx Habitaciones, orden, exportar
        ├── Capturar.tsx        * Captura guiada con la cámara
        ├── GuiaCaptura.tsx     Los puntos guía dibujados sobre el video
        ├── SubirFoto.tsx       Importar una foto que ya existe
        ├── EditorPuntos.tsx    Colocar hotspots sobre la escena
        ├── PuntosEditables.tsx Marcadores arrastrables
        ├── VisorGuardado.tsx   Abre un recorrido guardado
        └── ui.tsx              Botones, campos, hojas

tools/make_test_panoramas.py    Genera las panorámicas de prueba
tools/pruebas/costura.html      Banco de pruebas de la costura (sección 11)
tools/pruebas/memoria.mjs       Mide la memoria de video de verdad (sección 10)
public/prueba.html              Diagnóstico de compatibilidad del teléfono
```

Las piezas marcadas con `*` son las que importa entender. El resto es
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

## 5. Crear un recorrido desde el celular

Se entra por el botón de la barra de arriba (**Mis recorridos**) o directo a
`#/inicio`. El flujo completo es:

```
Mis recorridos → Nuevo recorrido → Agregar habitación
                                    ├─ Tomarla con la cámara  → captura guiada
                                    └─ Usar una foto que ya tengo
                                  → nombrarla → colocar los puntos → Ver
                                  → Preparar archivo → compartir el .tour
```

Si una foto salió mal, **Ajustes → Volver a tomarla** (o *Cambiar la foto*)
reemplaza solo la imagen: el nombre de la habitación, sus puntos y su vista de
entrada se quedan como estaban.

### Requisito que sorprende a todo el mundo: https

`getUserMedia` y los sensores de orientación **solo existen en un contexto
seguro**. La URL *Network* que imprime `npm run dev`
(`http://192.168.x.x:5173`) **no lo es**: el visor carga, se ve bien, y la
cámara simplemente nunca abre.

Tres salidas, de mejor a peor:

1. Publicar en GitHub Pages (sección 11) y abrir ese link en el celular. Es
   https de verdad y es como lo va a usar la gente.
2. Abrirlo en `http://localhost` con el cable y el reenvío de puertos del
   navegador de escritorio (`chrome://inspect` → Port forwarding). `localhost`
   cuenta como seguro.
3. Un túnel https (`cloudflared tunnel --url http://localhost:5173`).

Lo demás —subir fotos, editar, colocar puntos, exportar— sí funciona sobre
http, así que el `npm run dev` sigue sirviendo para el 80 % del trabajo.

`public/prueba.html` (queda publicado como `/prueba.html`) responde esto y lo
demás de un vistazo: si la página es segura, si hay cámara, si hay sensores, si
el teléfono aguanta un lienzo de 4096 y si se puede guardar.

### Cómo se arma la panorámica

Entra: una foto de la cámara y la orientación del teléfono al tomarla.
Sale: una equirectangular 2:1 idéntica en formato a las que ya consumía el visor.

**Los sensores.** `alpha/beta/gamma` se convierten a un cuaternión con la
referencia clásica de `DeviceOrientationControls`, con dos correcciones que no
son evidentes: un giro de −90° sobre X (porque la cámara mira por la *espalda*
del teléfono, no por su punta) y otro por `screen.orientation.angle` (porque al
girar el teléfono el sistema rota la pantalla pero no los ejes del sensor).

Se sigue el evento **relativo** —giroscopio puro— y no el absoluto, aunque este
último venga referido al norte: el dato absoluto lleva magnetómetro adentro, y
un magnetómetro dentro de una casa se brinca varios grados cada vez que pasa
cerca de un marco de acero o del cableado del muro. Entre dos fotos seguidas eso
se ve como una pared partida. La brújula se usa una sola vez, al principio, para
anotar dónde quedó el norte.

**El plan de fotos** (`src/lib/capture/plan.ts`) dice a dónde apuntar. Tiene dos
detalles que solo aparecen midiendo:

- Una foto al cenit **no cubre un casquete, cubre un rectángulo**: alrededor del
  polo solo alcanza para todas las direcciones hasta `min(hfov, vfov)/2` grados.
  Si el anillo de más arriba no llega hasta ahí, queda una faja sin fotografiar
  a unos 60° de altura — y a pedazos, que se ve peor que un hueco limpio. Por eso
  el anillo más alto se coloca donde tenga que estar y los intermedios se
  reparten parejo hasta ahí.
- El paso horizontal de cada anillo lo manda **la orilla de abajo de la foto**,
  no su centro: ahí la vuelta todavía es larga y la foto abarca menos grados de
  yaw. Midiendo por el centro queda un triángulo sin cubrir entre foto y foto.

Barriendo la esfera con más de un millón de direcciones, para dieciséis formas
de encuadre distintas (de 30° a 100°, en vertical y en horizontal), el plan
cubre **el 100.0000 % en todas**. Un cuarto completo con la cámara típica de un
celular en vertical son 29 fotos.

**La costura** (`src/lib/capture/stitcher.ts`) proyecta **al revés**. Lo
intuitivo sería deformar la foto y pegarla sobre el lienzo, pero entonces los
triángulos que cruzan la costura de 360° se dibujan atravesando toda la imagen y
cerca de los polos la malla se estira hasta romperse. Aquí se recorre el
**lienzo** y para cada píxel se pregunta a qué dirección corresponde y si esa
dirección cae dentro de la foto:

```
píxel del lienzo → (yaw, pitch) → dirección → espacio de la cámara
                 → coordenada dentro de la foto → color
```

Así no existe la costura (yaw y yaw−360 son la misma dirección, y el seno y el
coseno no notan la diferencia) ni el problema de los polos (no hay malla que
estirar). Cada toma se dibuja con alfa premultiplicado y desvanecido en los
bordes; al final se divide el color entre el alfa acumulado, que es lo que evita
el halo oscuro alrededor de la primera foto.

**El campo de visión se calibra solo.** Ningún navegador dice cuál es el campo
de visión de la lente: `getSettings()` da resolución y cuadros por segundo, y
nada más. Se arranca de 66° (equivalente a 26 mm) y se mide durante la captura:
el giroscopio dice cuánto giró el teléfono y la correlación dice cuánto se
corrió la imagen; de esas dos cosas sale la distancia focal.

La medición se toma **mientras el usuario gira**, no entre foto y foto. La
razón: la correlación supone que la imagen se DESPLAZÓ, y eso solo es cierto de
a poquito, porque una lente proyecta en perspectiva y al girar mucho el
contenido además se estira hacia una orilla. Medido sobre panorámicas reales,
la correlación vale 0.86 con 5° de giro, 0.5 con 15° y ya es ruido con 35°.
Entre dos fotos del plan hay más de treinta grados; entre dos miniaturas del
barrido, unos pocos. Con el pico afinado por interpolación parabólica, doce
mediciones de prueba salieron todas dentro de 0.7° del valor real.

Al terminar, si la medición cambió, **se vuelven a coser todas las fotos** con
el valor calibrado. Es la diferencia entre una panorámica que cierra y una en
la que las paredes no empatan: cinco grados de error se acumulan vuelta tras
vuelta.

Por eso cada toma se guarda (JPEG chico + su cuaternión): permite recoser, y de
paso hace que **Deshacer** funcione aunque el lienzo sea acumulativo.

### Subir una foto que ya existe

Tres casos, y el visor propone el correcto:

| Origen | Qué se hace |
| ------ | ----------- |
| Foto 360 de una cámara esférica | Ya es 2:1: solo se ajusta de tamaño |
| Panorámica del modo Panorámica del celular | Se reproyecta de cilíndrica a equirectangular renglón por renglón; un deslizador dice cuánto se giró y se ve el resultado en vivo |
| Foto normal | Se proyecta como la vería la lente; el resto del cuarto queda vacío |

Si la imagen trae metadatos **GPano** —los escriben Insta360, Ricoh Theta,
Photo Sphere y Facebook— no hay nada que adivinar: dicen exactamente qué pedazo
de la esfera es esa imagen y se coloca sola.

### Dónde queda guardado

En **IndexedDB**, con las fotos como Blob en un almacén aparte del JSON del
recorrido: listar "Mis recorridos" lee unos pocos KB en vez de jalar todas las
panorámicas a memoria.

El navegador puede borrar eso —Safari en iOS limpia los sitios que pasan siete
días sin abrirse, y cualquier teléfono lo hace si se queda sin espacio—, así que
**Preparar archivo** genera un `.tour`: un ZIP normal, sin comprimir, con el
manifiesto y las fotos adentro. Se puede abrir con cualquier descompresor, se
manda por WhatsApp y se vuelve a importar en otro teléfono.

El botón va en dos pasos a propósito (*Preparar* y luego *Compartir*): en iOS,
compartir solo se permite mientras dure la activación que dejó el toque del
usuario, y armar un ZIP de varios megabytes se la acaba.

### Pasarle el recorrido a alguien más

Dos caminos, según a quién:

**A otra persona con el link del visor.** Le mandas el `.tour` (por WhatsApp,
correo, lo que sea), esa persona abre el visor, entra a *Mis recorridos* y toca
**Abrir archivo**. Queda guardado en su teléfono igual que en el tuyo.

**Como un link público, para un cliente.** El `.tour` es un ZIP: se descomprime
y adentro están `recorrido.json` y las fotos.

```bash
unzip casa-en-tlajomulco.tour -d recorrido
cp recorrido/fotos/*.jpg public/panoramas/     # las panorámicas
cat recorrido/recorrido.json                   # nombres, ángulos y puntos
```

Con eso se llena `src/data/tour.ts` (mismos campos, `image` con `asset(...)`) y
`npm run build:pages` deja el recorrido publicado en su propio link, sin que el
cliente tenga que importar nada. El `recorrido.json` ya trae los `hotspots` con
sus `yaw`/`pitch` en la misma convención, así que es copiar y pegar.

---

## 6. Meter tus panorámicas (a mano, sin el editor)

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

## 7. Vestirlo con tu marca

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

## 8. Ajustes rápidos

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

## 9. Notas de móvil que ya están resueltas

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

## 10. Memoria de video: lo que de verdad tumba un celular

El error que rompe un recorrido virtual en un teléfono no es el framerate: es la
memoria de video. Safari en iOS mata la pestaña alrededor de los **384 MB**, y
lo hace sin avisar — la escena se queda en negro o la página se recarga sola.

Y la trampa es que **un JPEG no ocupa en la tarjeta gráfica lo que pesa en
disco: se descomprime.** Una equirectangular de 4096×2048 son
`4096 · 2048 · 4 = 33 MB`, más un tercio de mipmaps: unos 45 MB por habitación.
Ocho habitaciones cargadas a la vez ya no caben.

### Lo que se hizo, y lo que se midió

`tools/pruebas/memoria.mjs` parchea WebGL **antes** de que corra la app y cuenta
los objetos de GPU de verdad, atribuyendo cada textura a su contexto: cuando un
contexto muere, sus texturas mueren con él aunque nadie haya llamado a
`deleteTexture`. No le cree a nadie, mide.

```bash
npm run dev                                   # en otra terminal
npm i -D playwright && npx playwright install chromium
node tools/pruebas/memoria.mjs http://localhost:5173/
node tools/pruebas/memoria.mjs http://localhost:5173/ modesto   # finge gama baja
```

**Encontró una fuga de verdad:** cada montaje del canvas abría un contexto WebGL
y ninguno se soltaba. Entrar y salir tres veces del editor de puntos dejaba seis
contextos vivos; un iPhone tolera entre ocho y dieciséis. `renderer.dispose()`
**no** cierra el contexto — solo suelta lo que three tenía adentro. La única
forma es `forceContextLoss()`, y ahora se llama al desmontar `Escena360`.

Con eso, y con el tope del caché de texturas, un recorrido de siete habitaciones
mide así:

| Medición                                   | Aparato normal | Gama baja |
| ------------------------------------------ | -------------- | --------- |
| Al abrir la primera habitación             | 32 MB          | 8 MB      |
| Tras pasar por las 7                       | **160 MB**     | **40 MB** |
| Tras una segunda vuelta completa           | 160 MB         | 40 MB     |
| Al salir del visor                         | **0 MB**       | 0 MB      |
| Contextos WebGL vivos al salir             | **0**          | 0         |

Lo que hace que esos números se queden ahí:

- **El caché de texturas tiene tope** (`src/lib/useEquirectTexture.ts`): guarda
  las cinco últimas y suelta el resto. Y nunca expulsa la que se está viendo —
  sin esa protección, precargar a las vecinas podía liberar la textura en
  pantalla y dejar el cuarto en negro.
- **En gama baja la foto se sube a 2048 y no a 4096**
  (`src/lib/dispositivo.ts`): la cuarta parte de memoria. No se nota, porque en
  esos aparatos además se dibuja a 1x: a 75° de campo de visión se ve como un
  quinto del ancho de la panorámica, o sea 410 px repartidos en una pantalla de
  390. No sobra resolución que perder.
- **`antialias: false`** en el canvas del visor. El suavizado de bordes sirve
  para las aristas de la geometría, y aquí no hay aristas: toda la pantalla es
  una esfera con una foto encima. Lo único que hacía era reservar un búfer
  multimuestreado, de dos a cuatro veces el normal, para no mejorar un píxel.
- **Solo se precargan una o dos habitaciones vecinas**, no todas. Un cuarto con
  cinco puertas llenaba el caché de golpe con habitaciones a las que quizá nadie
  iba a entrar.
- El costurero de la captura ya soltaba su propio contexto con
  `forceContextLoss()` desde el principio, y la vista previa de "foto normal"
  reutiliza uno solo en vez de crear y destruir uno por cada movimiento del
  deslizador.

### El peso de la descarga

Las pantallas que no dibujan en 3D ya no arrastran el motor gráfico. `App.tsx`
carga con `lazy()` las cinco pantallas que usan three, y `store/tours.ts` habla
con el caché de texturas por una indirección (`src/lib/texturasVivas.ts`) en vez
de importarlo:

| Pantalla                    | JavaScript descargado |
| --------------------------- | --------------------- |
| Mis recorridos              | **226 kB**            |
| El visor                    | 1 109 kB              |

Antes, abrir la lista de recorridos bajaba los 1 109 kB completos para pintar
unos renglones de texto.

---

## 11. Qué se verificó

### El visor

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

### La costura

`tools/pruebas/costura.html` (se abre con `npm run dev`, en
`/tools/pruebas/costura.html`) es una prueba de extremo a extremo de toda la
cadena de matemáticas. La idea: si la costura está bien hecha, tiene que poder
**reconstruir una panorámica que ya conocemos**.

1. Toma una equirectangular real de `public/panoramas/`.
2. Simula la cámara del teléfono: para cada punto del plan de captura recorta lo
   que vería una cámara apuntando ahí. Esa proyección "de ida" está escrita a
   mano y aparte, en JavaScript.
3. Le da esas tomas al costurero, que hace la proyección "de vuelta" en la GPU.
4. Compara el resultado contra el original.

Un signo invertido, una costura que no cierra, un polo roto o una imagen
volteada disparan la diferencia. Resultado con 30 tomas simuladas de una cámara
vertical de 40° × 66°:

| Medición                                     | Resultado                    |
| -------------------------------------------- | ---------------------------- |
| Cobertura de la esfera                       | 100.00 % ✓                   |
| Diferencia media contra el original          | **1.40 / 255 niveles** ✓     |
| N / E / S / O y el cenit en su lugar          | Δ ≤ 2 niveles ✓              |
| Tiempo de costura                            | 19 ms por toma               |

La misma página verifica la **calibración del campo de visión**: simula dos
tomas con un lente conocido y un giro conocido, y comprueba que el estimador
recupere el lente sin que nadie se lo diga. Doce combinaciones (lentes de 40°,
50° y 62°; giros de 5°, 8°, 12° y 16°) salieron todas **dentro de 0.7°** del
valor real.

> Esta prueba encontró un defecto de verdad: con los giros grandes que hay entre
> dos fotos del plan, la correlación no alcanzaba el umbral y la calibración
> nunca llegaba a medir nada. De ahí salió moverla al barrido continuo.

### El resto

| Prueba                                                            | Resultado |
| ----------------------------------------------------------------- | --------- |
| Crear recorrido → subir foto → guardar → colocar punto → ver       | ✓         |
| Punto de enlace entre dos habitaciones                            | ✓         |
| Exportar `.tour` y volver a importarlo (ida y vuelta completa)     | ✓         |
| ZIP escrito por el visor, abierto con `unzip` y con `zipfile`      | CRC ✓, nombres UTF-8 ✓ |
| ZIP hecho por otra herramienta con deflate, leído por el visor     | ✓         |
| CRC-32 contra el valor de referencia (`"123456789"` → `cbf43926`) | ✓         |
| Captura guiada con cámara y sensores simulados: disparo automático, cobertura, armado y guardado | ✓ |
| Captura a mano en un teléfono sin sensores (fantasma de la toma anterior)   | ✓ |
| Cobertura del plan de fotos: 16 formas de encuadre × 1 M de direcciones     | 100.0000 % ✓ |
| El recorrido importado conserva habitaciones, nombres y puntos              | ✓         |
| El sitio publicado, servido desde un subdirectorio como en GitHub Pages     | ✓         |
| Tocar un punto lo selecciona sin moverlo; arrastrarlo sí lo mueve           | ✓         |
| Reemplazar la foto de una habitación conservando su nombre y sus puntos     | ✓         |
| Conversión sensores → (yaw, pitch): 9 posturas verificadas contra sus valores esperados | ✓ |
| Memoria de video con 7 habitaciones: acotada y liberada al salir            | 160 MB / 0 MB ✓ |
| Contextos WebGL: se sueltan al desmontar en vez de acumularse               | ✓         |
| Errores de consola en todo el recorrido anterior                  | ninguno ✓ |

---

## 12. Publicarlo en internet (GitHub Pages)

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

## 13. Siguientes pasos naturales

- Reordenar habitaciones arrastrando en vez de con flechas.
- Planta arquitectónica con la posición de cada escena.
- Modo VR con WebXR (`@react-three/xr`).
- Giroscopio también al **ver** el recorrido, para mirar moviendo el teléfono
  (la conversión de sensores ya está hecha en `src/lib/capture/orientation.ts`).
- Corrección de nivel: enderezar el horizonte de una panorámica capturada a
  pulso, ya que el ladeo de cada toma se conoce.
- Alineación fina entre tomas por correlación, no solo por sensores, para
  quitar el resto del error de paralaje.
- Mosaicos multirresolución si vas a usar panorámicas mayores a 8K.

### Lo que se consideró y se dejó fuera, con su razón

- **Texturas comprimidas KTX2/Basis.** La cuenta es correcta: una textura
  comprimida se queda comprimida en la tarjeta gráfica y ahorraría de dos a
  ocho veces la memoria. Pero las panorámicas de este visor **las produce el
  teléfono**, así que habría que codificar Basis en el navegador: un wasm de
  más de un megabyte y varios segundos por foto, justo en el momento de menos
  memoria disponible. Y rompería lo mejor del archivo `.tour`, que hoy se
  descomprime con cualquier herramienta y trae JPEG que se abren en cualquier
  lado. Bajar la resolución en los aparatos modestos da la misma mejora de 4×
  sin nada de eso (sección 10). Valdría la pena solo si se pasa a servir
  recorridos ya procesados desde un servidor.
- **Gaussian Splatting (`@sparkjsdev/spark`).** Es otro producto, no una
  mejora de este: un escaneo volumétrico no se puede *crear* con el flujo de
  cámara que tiene esta app — necesita entrenar el modelo, que hoy se hace en
  un servidor con GPU o en un servicio de paga. Además el paquete pesa 30 MB y
  un solo archivo de escena son decenas o cientos de MB, contra el megabyte de
  una equirectangular. Es una decisión de producto con su propia canalización,
  y merece su propia rama.
- **`gltf-transform`.** No hay ni un modelo glTF en el proyecto: es un visor de
  fotos 360, no de geometría.
- **`IntersectionObserver` para diferir el canvas.** El visor ocupa la pantalla
  completa (`h-[100dvh]`); nunca está fuera de la vista mientras está montado.
  Lo que sí aplicaba de esa idea era no descargar el motor 3D en las pantallas
  que no lo usan, y eso está hecho con `lazy()` (sección 10).
