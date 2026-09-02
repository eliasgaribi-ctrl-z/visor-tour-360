# Visor de recorridos virtuales 360 · React + TypeScript + Tailwind

## Verlo en tu iPhone ahora mismo

**[Abrir el visor →](https://eliasgaribi-ctrl-z.github.io/visor-tour-360/)**

Es un link normal: no hay que instalar nada ni crear cuenta.

1. Ábrelo en **Safari** (en iOS todos los navegadores usan el motor de Safari
   por dentro, pero "Agregar a inicio" solo aparece ahí).
2. Para que se sienta como una app propia: toca **Compartir** (el cuadrado con
   la flecha hacia arriba, abajo en la barra) → **Agregar a pantalla de
   inicio**. Queda un ícono que abre el visor a pantalla completa, sin la
   barra de direcciones de Safari.
3. Lo primero que se ve es un **recorrido de ejemplo** (panorámicas con
   rejilla, para probar que todo funciona) — no tu casa. Para **crear el
   tuyo con la cámara del teléfono**, toca el botón naranja **"Crear el
   mío"** que aparece arriba, en la barra superior: te manda a *Mis
   recorridos* → **Nuevo recorrido** → **Tomarla con la cámara**. Hace falta
   ese mismo link https para que la cámara abra — la URL de red que imprime
   `npm run dev` no sirve para eso. Ver la sección 5.

> **¿El link de arriba no carga (404 o página en blanco)?** Es que GitHub
> Pages todavía no está activado en este repositorio — el sitio compilado ya
> vive en la carpeta `docs/`, solo falta prenderlo. En GitHub:
> **Settings → Pages → Source: Deploy from a branch → rama `main`, carpeta
> `/docs` → Save**. En uno o dos minutos el link empieza a funcionar. Más
> detalles en la sección 13.

---

Dos mitades que viven en la misma página estática:

**VER** · panorámica equirectangular a pantalla completa, capa de interfaz
superpuesta y **joystick virtual** en la esquina inferior izquierda que mueve el
`yaw` y el `pitch` de la cámara. Es lo que ve quien recibe el link.

**CREAR** · el recorrido se arma **desde el celular**: se abre la cámara, se gira
sobre el propio eje siguiendo unos puntos guía y el visor cose las fotos en una
equirectangular; o se sube una foto 360 que ya se tenga. Después se nombran las
habitaciones, se colocan los puntos tocando la escena y todo queda guardado en el
teléfono, con un archivo `.tour` para respaldarlo o pasarlo a otro dispositivo.

Sin cuenta y sin instalar nada, y el visor es un sitio estático. Hay **una sola
pieza opcional con servidor**: si quieres poder mandarle una casa a un cliente
por link, la sección 14 monta un Worker de Cloudflare que la guarda. Sin
configurarlo, todo lo demás funciona igual y los recorridos no salen del
teléfono.

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
npm test            # vitest run (las pruebas de unidad; sección 12)
npm run build:pages # compila a docs/ para GitHub Pages
```

En cada push a `main` y en cada pull request, `.github/workflows/ci.yml` corre
`npm run lint`, `npm run build` y `npm test`, más una cuarta cosa que se explica
en la sección 12. `npm run typecheck` no está en el CI porque `npm run build` ya
hace `tsc -b`. Node va clavado a la versión del `.nvmrc` y del campo `engines`:
**22.12**.

Con el servidor de desarrollo corriendo hay dos páginas de diagnóstico:

| Página                          | Para qué |
| ------------------------------- | -------- |
| `/prueba.html`                  | Abrirla **en el celular**: dice si hay https, cámara, sensores, WebGL y espacio |
| `/tools/pruebas/costura.html`   | Verifica la costura reconstruyendo una panorámica conocida (sección 12) |

Y una tercera, que se corre desde la terminal:

```bash
node tools/pruebas/memoria.mjs http://localhost:5173/       # memoria de video (sección 10)
node tools/pruebas/rendimiento.mjs http://localhost:5173/   # batería, respuesta y movimiento (sección 11)
node tools/pruebas/tactil.mjs http://localhost:5173/        # tamaño de lo que se toca (sección 11)
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
│   ├── math.test.ts            (las pruebas viven junto a lo que prueban)
│   ├── tourEngine.ts           * El objeto mutable que conecta UI <-> cámara
│   ├── useDragLook.ts          Arrastrar para mirar + pellizco para zoom
│   ├── useKeyboardLook.ts      Flechas / WASD en escritorio
│   ├── useEquirectTexture.ts   Carga y caché de panorámicas
│   ├── useHashRoute.ts         Rutas dentro del # (funcionan en GitHub Pages)
│   ├── dispositivo.ts          * Qué se permite según la memoria del aparato
│   ├── webgl.ts                ¿Hay WebGL 2? Una pregunta, una sola respuesta
│   ├── movimiento.ts           ¿El aparato pidió "reducir movimiento"?
│   ├── texturasVivas.ts        Puente que evita que la lista importe three.js
│   ├── capture/                ── armar la panorámica ──
│   │   ├── orientation.ts      * ¿hacia dónde apunta el teléfono?
│   │   ├── camera.ts           getUserMedia, lentes, errores en español
│   │   ├── frames.ts           congelar tomas, brillo, calibrar el FOV
│   │   ├── plan.ts             a dónde hay que apuntar y en qué orden
│   │   ├── frames.test.ts      · plan.test.ts
│   │   ├── stitcher.ts         * la costura equirectangular en la GPU
│   │   └── importar.ts         fotos 360, panorámicas de celular y GPano
│   └── store/                  ── guardar y compartir ──
│       ├── idb.ts              IndexedDB a pelo
│       ├── tours.ts            CRUD, blobs y resolución a Tour de runtime
│       ├── zip.ts              escritor y lector de ZIP sin dependencias
│       ├── zip.test.ts         nombres de entrada que se salen de su carpeta
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
tools/pruebas/rendimiento.mjs   Batería, tirones y que todo responda (sección 11)
tools/pruebas/tactil.mjs        Que todo mida ≥44 px para el pulgar (sección 11)
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
cubre **el 100.0000 % en todas**.

Cuántas fotos son, con la cámara típica de un celular (66° en el lado largo del
sensor) y el teléfono **parado**, que es como se sostiene: el fotograma queda de
52° × 66° y `planDeCaptura` pide **38 fotos** para el cuarto completo, o **12**
si solo se da la vuelta del horizonte. Eran 29 hasta que el avance entre fotos
dejó de ser un 80 % fijo y pasó a descontar la tolerancia del disparador: dos
fotos vecinas pueden salir desviadas 11° cada una y hacia lados contrarios, y
sin descontarlo el plan prometía una cobertura que la captura real no entregaba.
Los dos números salen de correr la propia función, no de contarlos a mano.

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

Con eso se llena `src/data/tour.ts` y `npm run build:pages` deja el recorrido
publicado en su propio link, sin que el cliente tenga que importar nada.

**No es copiar y pegar el JSON entero**, aunque durante un tiempo esta misma
sección prometía que sí. El `recorrido.json` que escribe `paquete.ts` tiene un
envoltorio y unos nombres de campo que el `Tour` de `src/lib/types.ts` no
conoce. La conversión es corta, pero hay que hacerla:

| En `recorrido.json`                      | En `src/data/tour.ts`              | Qué cambia                                              |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `recorrido.title` / `.subtitle`          | `title` / `subtitle`               | Suben un nivel: en el JSON cuelgan de `recorrido`        |
| `recorrido.startSceneId`                 | `startSceneId`                     | Igual, un nivel arriba                                   |
| `recorrido.scenes[]`                     | `scenes[]`                         | Igual, un nivel arriba                                   |
| `scene.archivo` (`fotos/000.jpg`)        | `image: asset('panoramas/000.jpg')` | **Cambia de nombre y de ruta.** Sin `asset()` da 404 en Pages |
| `scene.miniatura` (`fotos/000.min.jpg`)  | `thumbnail: asset(...)`            | Mismo cambio de nombre y de ruta. Es opcional            |
| `scene.id` / `name` / `initialYaw`       | iguales                            | —                                                        |
| `scene.hotspots[]`                       | `hotspots[]`                       | **Esto sí es copiar y pegar**: mismo tipo `Hotspot`, mismos `yaw`/`pitch` en grados |
| `formato`, `version`, `exportadoEn`      | no existen                         | Se tiran: son del sobre del `.tour`                      |
| `recorrido.id`, `recorrido.createdAt`    | no existen                         | Se tiran                                                 |
| `scene.origin`, `coverageDeg`, `createdAt` | no existen                       | Se tiran: son de la captura, no del recorrido publicado  |

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

Casi todo son props de `<CameraRig>` (que se monta dentro del `<Canvas>` de
`src/components/tour/Escena360.tsx`, no de `TourViewer.tsx`) o de `<Joystick>`
(ese sí en `TourViewer.tsx`):

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

- La utilidad **`alto-pantalla`** de `src/index.css` para el alto de pantalla
  completa, nunca la unidad `dvh` a secas. `dvh` es lo correcto —descuenta la
  barra del navegador, y sin eso el joystick se queda debajo del borde— pero no
  existe antes de iOS 15.4, y un `height` que el navegador no entiende no deja
  el contenedor "un poco mal": lo deja en altura **cero**, con la app montada y
  la pantalla vacía. La utilidad hace la escalera: `100vh`,
  `-webkit-fill-available`, y `dvh` detrás de un `@supports`. Para el tope de
  las hojas de abajo, `alto-max-hoja`.
- `viewport-fit=cover` + `env(safe-area-inset-*)`: los controles esquivan el
  notch y la barra de gestos.
- `user-scalable=no`: sin eso, el pellizco para hacer zoom en la panorámica hace
  zoom en la *página*.
- `touch-action: none`: nada de scroll accidental sobre el visor. Va aparte de
  `overscroll-behavior: none`, que también está puesto pero es de Safari 16: en
  un iPhone más viejo vuelve el rebote elástico al llegar al borde. Molesta y ya;
  el scroll de las hojas sigue funcionando.
- `dpr={aparato().dpr}`: se limita el device pixel ratio; renderizar a 3x en un
  celular moderno tira el framerate a la mitad sin que se note la diferencia. No
  es un número fijo: `src/lib/dispositivo.ts` entrega `[1, 2]` en un teléfono
  normal y `1` a secas en uno modesto, junto con el ancho de textura y cuántas
  fotos precargar (sección 10).

### Hasta qué iPhone llega: son dos pisos, no uno

La pregunta "¿funciona en mi celular?" no tiene una sola respuesta, y tratarla
como si la tuviera es lo que produce pantallas negras sin explicación. Hay dos
requisitos distintos y viven en capas distintas:

| Qué se quiere hacer | Desde | Qué lo limita |
| -------------------- | ----- | ------------- |
| Cargar la página, ver el menú, editar el recorrido, importar y exportar el `.tour` | **Safari 13** (iOS 13, de 2019) | Que el navegador pueda **leer** el archivo JavaScript y **pintar** el CSS |
| Ver el recorrido en 3D y capturar con la cámara | **Safari 15** (iOS 15, de 2021) | WebGL 2: three.js r185 pide un contexto `webgl2` y nada más — la rama de WebGL 1 se quitó en r163 |

El piso de abajo cuesta dos cosas, y las dos son fáciles de romper sin darse
cuenta:

- **El `target` del build** (`vite.config.ts`) baja hasta `safari13`. Vite
  compila por defecto para Safari 16 y arriba, y un navegador que no entiende la
  sintaxis no falla a medias: no ejecuta nada y la pantalla se queda negra.
- **El plugin `aplanarCapas`** (también en `vite.config.ts`). **No lo quites.**
  Tailwind v4 envuelve todo lo que genera en `@layer`, y `@layer` existe desde
  Safari 15.4: una regla-arroba que el navegador no conoce no se ignora a
  medias, se descarta **ella y su bloque entero**. Medido en la hoja publicada:
  44 109 de 48 672 bytes, el **90.6 %**, viven dentro de una capa. Ahí está el
  preflight, los colores, `.absolute`, `.flex`, `.hud-glass` y hasta la propia
  `.alto-pantalla` que se escribió para que un iPhone viejo no se quedara sin
  altura. Sin el plugin, en Safari 13 la app monta y se pinta **sin una sola
  regla de estilo**, y encima falla en silencio: la red de seguridad de
  `index.html` se dispara cuando `#root` se queda vacío o atorado en un velo de
  carga, y una app montada sin estilos no es ninguna de las dos cosas — tiene
  hijos y ya terminó. No hay opción de configuración que lo evite, y Lightning
  CSS con targets `safari13` tampoco: la semántica de `@layer` es de **orden**,
  no de sintaxis, y no existe forma general de bajarla.

El piso de arriba lo vigila `src/lib/webgl.ts`, que pide `webgl2` **y nada más**
antes de montar el `<Canvas>`. Aceptar un contexto WebGL 1 como bueno era peor
que no detectar nada: el canvas se montaba y el motor reventaba adentro, y ese
error no lo atrapa la frontera de React —R3F crea el renderer en un `configure()`
asíncrono al que nadie le pone `.catch`, o sea que es una promesa rechazada y no
una excepción de render—. Lo que se veía en un iPhone con iOS 13 no era una
pantalla negra: era el velo de "Cargando panorámica…" girando para siempre, que
para diagnosticar es todavía peor.

Por eso el mensaje de `ViewerGuard` cambia según **cuál** de los dos falta. Si
falta WebGL 2 no dice "cierra pestañas y vuelve a cargar": ahí no hay nada que
cerrar, y mandar a alguien a repetir un gesto que no puede funcionar es peor que
no decir nada.

Para saber en qué piso está un teléfono concreto sin adivinar, ábrele
**`/prueba.html`**: trae una fila de "WebGL 2 (lo que necesita el visor)" con el
mismo criterio que aplica el visor, y otra de "WebGL 1" solo como dato.

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

## 11. Trabajar poco: batería, calor y tirones

Un recorrido se **mira parado** la mayor parte del tiempo. La persona apunta a
una esquina, lee la medida de un cuarto, se queda pensando. En todos esos
segundos el visor no tiene nada nuevo que pintar — y sin embargo el camino
normal de three.js redibuja la escena sesenta veces por segundo pase lo que
pase, más un `requestAnimationFrame` por cada pieza del HUD.

Medido con la CPU limitada 4x (que se parece a un celular de gama media):

| Estado                       | Antes                        | Ahora        |
| ---------------------------- | ---------------------------- | ------------ |
| Parado, sin tocar nada       | 11 dibujos/s · 43 cuadros/s  | **0 · 0**    |
| Arrastrando para mirar       | 31 dibujos/s                 | 28 dibujos/s |

O sea: quieto, el visor **no gasta absolutamente nada**, y moviéndose responde
igual que antes. En un teléfono eso es batería y es calor — y el calor importa
el doble aquí, porque una captura de una habitación dura dos minutos con la
cámara encendida, y un teléfono caliente baja la resolución del video a media
panorámica.

### Cómo funciona: un solo timbre

El canvas usa `frameloop="demand"` y las piezas del HUD comparten un solo pulso
(`src/lib/tourEngine.ts`). Las dos capas duermen hasta que alguien toca el
timbre:

```
joystick / arrastre / zoom / teclado / cambio de cuarto
        └──> engine.invalidar()  ──┬──> redibuja el canvas 3D
                                   └──> despierta el pulso del HUD (250 ms)

CameraRig, mientras la cámara se sigue acomodando ──> vuelve a tocar el timbre
```

El `CameraRig` toca el timbre en cada cuadro mientras el ángulo o el zoom sigan
persiguiendo a su objetivo, así que la inercia se sostiene sola y se apaga cuando
de verdad se detiene.

**La regla que hay que recordar**, y está escrita en el propio `tourEngine.ts`:
todo lo que cambie lo que se ve tiene que llamar a `invalidar()`. Un control
nuevo que se olvide de hacerlo no truena — simplemente deja la imagen congelada,
que es peor. Por eso `tools/pruebas/rendimiento.mjs` recorre **todas** las
formas de mover la cámara y comprueba una por una que respondan.

### Decodificar la foto fuera del hilo principal

Cambiar de habitación congelaba la pantalla **900 ms**. No era la descarga —el
JPEG pesa un megabyte— sino convertir 4096×2048 píxeles comprimidos en 33 MB de
mapa de bits, en el mismo hilo que dibuja la interfaz.

Ahora se decodifica con `createImageBitmap`, que trabaja en otro hilo y de paso
reduce la imagen mientras la decodifica (lo que en un teléfono modesto es
justamente lo que hace falta). El congelamiento bajó a **~600 ms**, y en un
aparato de gama baja —que además trabaja a 2048— a **170-460 ms**.

Hay un detalle que puede dejar la panorámica **de cabeza**: WebGL sube las
imágenes al revés y three lo compensa con `flipY`, pero `flipY` **no funciona
con un ImageBitmap**. Hay que pedirle el volteo al propio `createImageBitmap`, y
esa opción no está en todos los navegadores. Como equivocarse no truena —solo
deja la foto invertida— no se supone: se prueba una vez, con una imagen de dos
píxeles de la que se conoce el resultado, y si el navegador no la respeta se usa
el camino de siempre con una etiqueta `<img>`.

### Y no precargar en el peor momento

Las habitaciones vecinas se precargan **1.4 segundos después** de entrar, y
escalonadas entre sí. Subir una textura a la tarjeta gráfica bloquea el hilo
principal; hacerlo justo cuando el usuario acaba de entrar le sumaba ese bloqueo
al de la foto que sí está esperando. Ahora se bajan mientras mira alrededor.

```bash
node tools/pruebas/rendimiento.mjs http://localhost:5173/
```

### Que todo se pueda tocar con el pulgar

Apple pide **44 px** de lado como mínimo para cualquier cosa que se toque
(Android pide 48). Debajo de eso el pulgar falla y la gente toca dos veces, o
toca lo de junto. `tools/pruebas/tactil.mjs` recorre las once pantallas en un
iPhone SE simulado —la más chica que sigue siendo común— y mide cada control.

La primera pasada encontró seis que no llegaban, y varios eran de los que más se
tocan:

| Control                                  | Antes  | Ahora |
| ---------------------------------------- | ------ | ----- |
| Barra de habitaciones (lo más tocado)    | 36 px  | 44 px |
| Marcadores de los puntos, en la escena   | 40 px  | 44 px |
| La × de las hojas                        | 32 px  | 44 px |
| Flechas para reordenar habitaciones      | 32×28  | 44×44 |
| Botón de regresar del editor de puntos   | 40 px  | 44 px |
| "Tómala con la cámara" (era un enlace)   | 20 px  | 44 px |

```bash
node tools/pruebas/tactil.mjs http://localhost:5173/
```

### El zoom encima de un marcador

El HUD y los marcadores **no** viven dentro del div del canvas: son su hermano,
en una capa encima. Un evento de rueda encima de un marcador sube por *su* rama
del árbol y nunca pasa por el manejador del visor — así que ahí el zoom no hacía
nada.

Se notaba poco porque depende de hacia dónde quedó mirando la cámara, y por eso
mismo la prueba salía roja una de cada tres veces sin explicación aparente. El
manejador de rueda ahora se cuelga también de la capa del HUD (`useWheelZoom` en
`src/lib/useDragLook.ts`); como las dos capas son hermanas, no se dispara dos
veces.

El **arrastre** sigue sin girar la cámara cuando empieza encima de un marcador,
y es a propósito (`data-no-drag`): ahí el gesto es "voy a tocar este punto".

La prueba dejó de apretar siempre en el mismo píxel: ahora pregunta qué hay
debajo del cursor y prueba la rueda en los dos sitios, sobre la foto y sobre un
marcador.

### Si el teléfono pidió menos movimiento

Quien enciende **"Reducir movimiento"** (iOS: Accesibilidad › Movimiento;
Android: "Quitar animaciones") no está pidiendo una interfaz más sobria: hay
gente a la que un paneo suave o un fundido a pantalla completa le provoca mareo
de verdad. Un visor 360 es de lo peor en ese sentido, porque el movimiento ocupa
**toda** la pantalla y no queda un borde quieto donde descansar la vista.

Durante un tiempo esta sección dio el ajuste por atendido cuando solo lo estaba
a medias: se apagaba el adorno y se dejaba en pie lo que de verdad marea. Hoy
son **tres** cosas, y las tres cuelgan de `src/lib/movimiento.ts`:

| Qué se apaga | Dónde | Qué pasa en su lugar |
| ------------- | ----- | -------------------- |
| El aro que late en los puntos de enlace | `src/index.css`, `@media (prefers-reduced-motion: reduce)` | El aro se queda quieto y translúcido; el marcador se sigue distinguiendo por su color |
| La inercia de la cámara | `CameraRig.tsx`, el suavizado | La cámara se planta en su objetivo de un solo cuadro, sin `damp` |
| El fundido entre habitaciones | `PanoSphere.tsx`, `fadeSeconds` | Pasa de 0.55 s a 0: el cuarto nuevo aparece de golpe |

La que más importa de las tres es la del medio, y no por el arrastre: cuando se
arrastra con el dedo el objetivo va pegado al dedo de todos modos y el suavizado
casi no se nota. La que marea es la animación de los puntos — tocar un hotspot
dispara un paneo de casi un segundo con la panorámica entera barriendo la
pantalla.

Tres detalles del código que no son obvios:

- **`menosMovimiento()` es una función, no una constante.** El ajuste se puede
  cambiar con la aplicación abierta (en iOS está a dos toques en el centro de
  control). Leerlo una sola vez al arrancar dejaría al visor moviéndose igual
  hasta recargar la página.
- **El `MediaQueryList` se guarda.** `CameraRig` pregunta esto en cada cuadro, o
  sea hasta 120 veces por segundo, y `matchMedia()` crea un objeto nuevo en cada
  llamada: sería basura que alguien tiene que recoger justo mientras se dibuja.
  Se crea una vez y se le lee `.matches`, que es una lectura viva.
- **En `CameraRig` va después del clamp de pitch.** Copiar el objetivo antes de
  toparlo dejaría el pitch pasarse de los 85° y la panorámica se retorcería en el
  polo, que es exactamente lo que el clamp evita.

La rueda de "cargando" **no** se toca: ahí el movimiento sí dice algo —que la
foto viene en camino— y congelarla se leería como que se trabó.

La regla CSS vive **fuera** de `@layer base`, y se emite **después** de las
utilidades. En Tailwind v4 las capas mandan más que la especificidad: dentro de
`base`, `.animate-ping` habría perdido siempre contra la utilidad del mismo
nombre, que vive en `utilities`. Y esa colocación es también lo que hace que el
plugin `aplanarCapas` (sección 9) sea seguro: al quitar los envoltorios en el
bundle de producción las dos reglas quedan con la misma especificidad (0-1-0) y
gana la de más abajo, que es la que ya ganaba. Es la única regla del proyecto que
depende del orden de las capas; si algún día se mueve dentro de una, hay que
revisar el plugin.

---

## 12. Qué se verificó

### Lo que corre solo: `npm test` y el CI

```bash
npm test        # vitest run
```

Las pruebas viven **junto al archivo que prueban**, con el sufijo `.test.ts`.
Son cuatro, y ninguna toca el DOM: geometría, bytes y ZIP.

| Archivo                        | Qué defiende |
| ------------------------------ | ------------ |
| `src/lib/math.test.ts`         | `wrap180` en sus bordes (−180 y 540 tienen que dar 180, nunca −180), `wrap360`, el camino corto de `shortestDelta`, y la ida y vuelta `vector3ToYawPitch(yawPitchToVector3(y, p))` sobre una malla de direcciones |
| `src/lib/store/zip.test.ts`    | `readZip(createZip(...))` con acentos y con entradas de más de 64 kB, y sobre todo la tabla de `nombreSeguro`: `'../x'`, `'/x'`, `'a\\b'`, `'a/../b'` tienen que salir rechazados. Es la que más vale: un `.tour` lo manda un desconocido |
| `src/lib/capture/frames.test.ts` | `fovDe` y `ladoLargoDesdeHorizontal` como inversas en cualquier forma de fotograma, que el campo corto salga de la tangente y no de una regla de tres, y `mediana` con lista vacía, impar y par (y que no reordene el arreglo que le pasaron) |
| `src/lib/capture/plan.test.ts` | Que el plan de captura cubra de verdad: cada dirección de la esfera tiene que caer dentro del **rectángulo** hfov × vfov de alguna foto, más cenit, nadir, ids sin repetir y cada anillo cerrando en el yaw 360 sin salto |

Esa última merece una nota, porque el invariante fácil de escribir está mal. La
cobertura de una foto **no** es un casquete de radio `hfov/2`: es un rectángulo
de hfov × vfov, y las esquinas del rectángulo llegan más lejos que su lado
corto. Con la prueba escrita como casquete sale roja el día uno **sin que haya
nada roto**: con el teléfono parado y el lente de 66° la peor dirección queda a
27.0° del centro de su foto contra los 26.0° que el casquete exigiría, y con el
gran angular de 100° a 45.0° contra 41.8°. La correcta proyecta cada dirección
al marco local de cada punto y revisa `|x/z| ≤ tan(hfov/2)` **y**
`|y/z| ≤ tan(vfov/2)`, por separado.

Lleva además un **control negativo**, que es la parte que hace que la prueba
valga algo: si cada foto abarcara un 15 % menos de lo planeado, tiene que
aparecer un hueco. Sin eso, la prueba de arriba podría estar pasando por un
signo mal puesto en la cuenta y no porque el plan esté bien.

`vitest.config.ts` está aparte del `vite.config.ts` a propósito: si no existe,
Vitest levanta React, Tailwind y el plugin que aplana las capas del CSS para
correr cuatro archivos de aritmética. `environment: 'node'` porque ninguna toca
el DOM.

Y todo eso lo vuelve a correr **`.github/workflows/ci.yml`** en cada push a
`main` y en cada pull request, con la versión de Node clavada a la misma que
dicen `.nvmrc` y el campo `engines` del `package.json` (22.12): `npm ci`,
`npm run lint`, `npm run build` (que ya incluye `tsc -b`) y `npm test`.

El último paso del CI es el que menos se ve venir:

```yaml
- run: npm run build:pages && git add -A docs && git diff --cached --quiet -- docs
```

El sitio publicado es la carpeta `docs/` guardada en el repositorio, así que se
puede cambiar el código, olvidar regenerarla y dejar el link mostrando la
versión de hace tres semanas sin que nadie se entere. El `git add -A` no es de
adorno: cada build renombra los archivos con un hash del contenido, o sea que un
cambio en el código no *modifica* `index-abc123.js`, crea un `index-def456.js`
nuevo, que para git es un archivo sin seguir. `git diff` a secas no mira los
archivos sin seguir, así que el paso pasaba en verde con `docs/` desactualizado,
que es exactamente lo que se quería atrapar.

Lo de aquí abajo, en cambio, se corrió a mano: son pruebas de navegador y de
GPU, con Playwright o abriendo una página. No están en el CI.

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
volteada disparan la diferencia.

La cámara simulada es de 240×426 px, o sea un teléfono parado, y de ahí salen
40.1° × 66.0°. El número de tomas **no está escrito a mano** en la página: se lo
pide a `planDeCaptura`, que hoy devuelve **102** para esa forma de fotograma.

| Medición                                     | Resultado                    |
| -------------------------------------------- | ---------------------------- |
| Cobertura de la esfera                       | 100.00 % ✓                   |
| Diferencia media contra el original          | **1.40 / 255 niveles** ✓     |
| N / E / S / O y el cenit en su lugar          | Δ ≤ 2 niveles ✓              |
| Tiempo de costura                            | 19 ms por toma               |

> Los números de esa tabla son de la última corrida registrada, cuando el plan
> pedía 30 tomas para el mismo lente. Después el avance entre fotos dejó de ser
> un 80 % fijo y pasó a descontar la tolerancia del disparador, y el plan subió
> a 102. El tiempo por toma no depende de cuántas sean, pero la diferencia media
> sí puede haberse movido: hay que volver a abrir la página para refrescarla.

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
| Parado, el visor no dibuja ni un cuadro (CPU limitada 4x)                   | 0/s ✓     |
| Las 8 formas de mover la cámara responden con el dibujo a pedido            | ✓         |
| La rueda hace zoom también encima de un marcador (antes no)                 | ✓         |
| Todo lo que se toca mide ≥ 44 px, en 11 pantallas y un iPhone SE            | ✓         |
| Con «reducir movimiento», el aro deja de latir y la rueda sigue girando     | ✓         |
| Con «reducir movimiento», la cámara no arrastra inercia y el fundido entre habitaciones no ocurre | sin prueba automática |
| Cambio de habitación: el congelamiento bajó de 900 ms a ~600 (170 en gama baja) | ✓     |
| Errores de consola en todo el recorrido anterior                  | ninguno ✓ |

---

## 13. Publicarlo en internet (GitHub Pages)

El visor es una página estática: no necesita servidor, base de datos ni nada que
se quede corriendo. Se compila una vez y el resultado se sube tal cual.

```bash
npm run build:pages     # compila a docs/ con rutas relativas
git add docs && git commit -m "publica el visor" && git push
```

En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` /
`docs`**. En un par de minutos queda en
`https://<usuario>.github.io/<repositorio>/`, que es un link normal: nadie tiene
que instalar nada ni crear una cuenta.

Aquí decía "se abre en cualquier celular" y eso no es cierto tal cual. La página
**carga** en cualquier celular desde Safari 13 —para eso está el target del
build y el plugin que aplana las capas del CSS—, pero el recorrido en 3D pide
WebGL 2, que es Safari 15. En un iPhone con iOS 13 o 14 el link abre, se ve la
interfaz y sale un mensaje explicando qué falta, en vez de una pantalla negra.
Los dos pisos, con lo que se puede hacer en cada uno, están en la sección 9.

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

## 14. Enseñar una casa por link (Cloudflare)

Hasta aquí, un recorrido armado en el celular vive **en ese celular**. La ruta
`#/ver/<id>` parece compartible, pero el id se busca en el almacén de quien
abre: al cliente le sale "no se encontró". La única forma de enseñar una casa
era mandar el archivo `.tour` y pedirle al otro que lo importara — que nadie
hace.

Esta sección lo arregla. Es la **única parte del proyecto que tiene servidor**, y
es opcional: si no la configuras, todo lo demás funciona exactamente igual.

### Qué se monta

Un Worker de Cloudflare con un bucket de R2 detrás (`worker/`). Guarda las casas
publicadas y las entrega. Nada más: sin cuentas, sin base de datos, sin sesiones.

```bash
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket create visor-tours
npx wrangler secret put CLAVE_PUBLICACION     # inventa una larga y guárdala
npx wrangler deploy
```

Wrangler imprime la dirección al terminar. Con esa dirección se compila el
visor:

```bash
cd ..
VITE_PUBLICAR_BASE=https://visor-tours.TU-CUENTA.workers.dev npm run build:pages
```

Y en `worker/wrangler.toml`, `APP_BASE` tiene que apuntar de vuelta a donde vive
el visor (hoy, la URL de GitHub Pages). El Worker la necesita para rebotar a
quien abra el link.

Sin `VITE_PUBLICAR_BASE`, el botón de publicar **no aparece** y el visor se
comporta como siempre.

### Cómo se usa

En el editor de un recorrido, **Enseñar por link → Publicar**. La primera vez
pide la clave; queda guardada en ese teléfono. Al terminar sale el link, listo
para pegar en WhatsApp.

Cuando la casa se vende: **Quitar de internet**. El link deja de abrir y las
fotos se borran del bucket.

### Las tres decisiones, y por qué

**Quién puede subir · una clave compartida.** Viaja en el encabezado
`Authorization` y vive como secreto del Worker. **No está en el paquete de la
app**, y eso no es un descuido: el JavaScript de un sitio estático lo lee
cualquiera, así que una clave metida ahí sería pública el día uno. La escribe la
persona una vez en su teléfono. Si se pierde un aparato, se cambia el secreto
del Worker con `wrangler secret put` y listo.

Sin esto, cualquiera que encuentre la dirección puede llenarte el bucket, y la
cuenta la pagas tú.

**Quién puede ver · quien tenga el link.** La llave son 128 bits de azar (26
letras de un alfabeto sin caracteres que se confundan): no se llega probando.
Todas las respuestas llevan `X-Robots-Tag: noindex, nofollow` y hay un
`robots.txt` que cierra el sitio entero — una casa en venta puede estar
habitada, y su interior no tiene por qué quedar en Google. Es lo mismo que hacen
Matterport y Kuula.

**Qué se puede subir · solo JPEG**, con tope por foto, por cantidad y por peso
total. El manifiesto se vuelve a sanear en el Worker aunque el teléfono ya lo
haya hecho: lo que llega por la red es de quien tenga la clave, y una clave
compartida entre varios teléfonos acaba en más manos de las previstas.

### El detalle que hace que WhatsApp enseñe la tarjeta

El link que se comparte apunta al Worker (`/t/<llave>`), no directo al visor. El
robot que arma la vista previa de WhatsApp **no ejecuta JavaScript**: si le
mandáramos la app, leería un `index.html` vacío y enseñaría un link pelón. Esa
ruta devuelve una página con el título, la descripción y la miniatura ya
escritos en el HTML, y a una persona la rebota al visor.

El rebote va en JavaScript y no con un 302 justamente porque un 302 se lo
llevaría también el robot.

### Qué cuesta

El plan gratis de Cloudflare da 10 GB en R2 y 100 000 peticiones al día. Una
casa de seis cuartos son unos 9 MB, así que caben más de mil casas antes de
pagar nada.

---

## 15. Siguientes pasos naturales

- Reordenar habitaciones arrastrando en vez de con flechas.
- Planta arquitectónica con la posición de cada escena, con el cono de hacia
  dónde se está mirando. Depende de tener un plano por casa.
- Corrección de nivel: enderezar el horizonte de una panorámica capturada a
  pulso, ya que el ladeo de cada toma se conoce.
- Compensar la exposición contra la mediana de todas las tomas y no contra la
  primera: hoy, si la primera foto apunta a la ventana, toda la panorámica
  queda sesgada. En Safari no se puede bloquear la exposición por hardware, así
  que el software es la única defensa.
- Recoser en un Web Worker, para que armar la panorámica no congele la pantalla.
- Mosaicos multirresolución si vas a usar panorámicas mayores a 8K.

Dos que estaban en esta lista y **ya están hechas**: mirar moviendo el teléfono
(sección 5) y la alineación por correlación entre tomas, que hoy corrige la
deriva del giroscopio al cerrar la vuelta.

### Lo que se consideró y se dejó fuera, con su razón

- **Modo VR con WebXR (`@react-three/xr`).** Estaba en la lista de siguientes
  pasos de aquí arriba y no debía estar: **Safari no implementa la WebXR Device
  API** ni en iOS ni en iPadOS (solo en visionOS 2). Para el objetivo declarado
  de este proyecto —que una casa se enseñe desde el iPhone que traiga quien
  sea— está muerto: no es que se vea mal, es que la API no existe. Lo que sí da
  casi toda esa sensación por una fracción del trabajo es el **giroscopio al
  ver**, que está en la lista de arriba y cuya parte cara —permiso de iOS,
  ángulo de pantalla, fusión con `webkitCompassHeading` para el norte real— ya
  está escrita en `src/lib/capture/orientation.ts`.
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
  completa (`alto-pantalla`); nunca está fuera de la vista mientras está montado.
  Lo que sí aplicaba de esa idea era no descargar el motor 3D en las pantallas
  que no lo usan, y eso está hecho con `lazy()` (sección 10).
- **Quitar el vidrio esmerilado (`backdrop-filter`) del HUD.** Parecía caro: un
  desenfoque del fondo obliga al compositor a releer lo que hay detrás, y los
  marcadores se recolocan en cada cuadro. La primera medición decía que costaba
  el doble en el peor cuadro… y estaba mal: había tres navegadores midiendo a la
  vez. Repetida en limpio, con y sin desenfoque, la diferencia arrastrando es
  ninguna: mediana 70 contra 69 ms, p95 131 contra 134. Se queda como está.
