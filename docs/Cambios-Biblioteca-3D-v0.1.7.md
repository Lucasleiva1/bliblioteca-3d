# Cambios de Biblioteca 3D — v0.1.7

Fecha: 11 de septiembre de 2026.

Versión centrada en ordenar la biblioteca por grupos y categorías, cargar contenido nuevo sin tocar nada a mano y ver cada pieza en su miniatura.

## Grupos de la biblioteca

- Cada carpeta de la raíz de la biblioteca es un grupo: `Piezas`, `Animaciones` y cualquier otra, por ejemplo `contruccion`.
- Los grupos aparecen en la lista fija de arriba, junto a Todo, Sin categoría y Favoritas, con su cantidad de elementos.
- Dentro de cada grupo, `Categoría` (también `Categoria` o `Categorías`) contiene una carpeta por categoría; `Varios` guarda lo que va sin categoría.
- Al abrir la app o reescanear, a cada grupo se le crean las carpetas `Categoría`, `Varios` y `Cargar Nuevo` que le falten, respetando la variante que ya exista para no duplicarla.
- Solo el grupo `Animaciones` se trata como animación; el resto se muestra como pieza.
- Las categorías sin ningún FBX, GLB o GLTF legible no aparecen hasta que tengan alguno.
- Los grupos manuales de la columna de categorías pasan a llamarse subgrupos.

## Piezas y animaciones separadas

- Las piezas conservan sus materiales originales y se ven sin la transparencia, el maniquí ni el esqueleto de las animaciones.
- Un archivo de pieza que solo trae animación busca su modelo compañero dentro del mismo pack (por ejemplo, la carpeta `Mesh` de un personaje).
- Categorías manuales separadas por grupo; las miniaturas se arrastran a una categoría manual o a Sin categoría.
- Categorías y subgrupos se ordenan arrastrándolos; el orden se guarda sin mover carpetas ni archivos.

## Cargar Nuevo

- Cada grupo tiene su bandeja `<grupo>\Cargar Nuevo`. Una carpeta soltada ahí se mueve sola a `<grupo>\Categoría\<nombre de la carpeta>`.
- El vigilante observa únicamente las carpetas `Cargar Nuevo`; nunca recorre el resto de la biblioteca.
- Espera a que Windows termine de copiar antes de mover nada.
- Si la categoría ya existe, el contenido se suma adentro. Si algún archivo choca con uno existente, no se mueve nada y el motivo queda visible.
- Los archivos sueltos y las carpetas sin FBX, GLB ni GLTF quedan esperando con su motivo.
- Lo que llega se suma a la lista sin reescanear, con un aviso y un botón para ir a la categoría nueva.
- Lo que quedó pendiente con la app cerrada se procesa al abrirla.
- El botón "Cargar nuevo" abre la bandeja del grupo que se está mirando.

## Miniaturas reales

- La app fotografía cada pieza fuera de pantalla, de a una y en segundo plano: personajes de frente, objetos del lado más reconocible, sobre fondo oscuro.
- Cada foto es un WebP de 256 × 256 de unos 3,5 KB, guardado en una carpeta `_cache` junto al modelo como `<archivo>.webp`. Las carpetas `_cache` viajan con la carpeta al moverla o copiarla.
- La foto lleva la misma fecha que su modelo: si el modelo cambia, se vuelve a sacar; si no, se reutiliza.
- Progreso visible arriba (`Fotos 325 / 2852`) con botón de pausa. Primero se fotografía lo que llega por `Cargar Nuevo` y lo visible en la columna derecha.
- Control de calidad: una foto vacía se reintenta con los materiales opacos y una foto negra con doble luz; lo que no se puede fotografiar queda con `<archivo>.fallo.txt` y su motivo, y no se reintenta hasta que el archivo cambie.
- Resultado en la biblioteca actual: 2.849 de 2.852 piezas con foto. Las tres restantes no tienen modelo que mostrar o les falta un archivo de datos.

## Visor y texturas

- Los FBX buscan sus texturas por nombre en su carpeta y en las vecinas, hasta dos niveles arriba y sin salir de la categoría. Resuelve los FBX que guardan la ruta de la computadora del autor.
- Los GLTF buscan del mismo modo las imágenes que faltan y, si no aparecen, se dibujan sin esa textura en vez de fallar.
- Texturas TGA.
- Una textura que no se puede cargar ya no pinta la pieza de negro: se muestra su color base.
- Materiales marcados como invisibles por error se muestran opacos.
- Mallas con varios materiales y sin asignación se dibujan enteras en vez de desaparecer.
- Entorno de estudio para que las piezas metálicas no se vean negras.
- Los modelos viajan del motor a la pantalla en binario, en lugar de una lista de números en texto, lo que acelera la carga de archivos grandes.

## Correcciones

- Guardar el orden de las categorías fallaba cuando existía alguna categoría manual.
- Un archivo suelto dentro de `Categoría` ya no crea una categoría con el nombre del archivo.

## Comprobaciones

- `npm run build`, `npm test` (41 pruebas) y `npm run test:3d`: correctos.
- `cargo fmt --check`, `cargo test` (23 pruebas) y `cargo clippy --all-targets -- -D warnings`: correctos.
- Carga por `Cargar Nuevo` verificada con carpetas reales: categoría nueva, categoría existente, choque de nombres y foto automática de lo que llega.
- Grupo `contruccion` verificado en la app: sus nueve packs aparecen como categorías y los nueve sin modelos legibles quedan ocultos.
