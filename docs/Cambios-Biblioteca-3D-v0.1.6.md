# Cambios de Biblioteca 3D — v0.1.6

Fecha: 10 de septiembre de 2026.

Versión centrada en despejar la pantalla y devolverle espacio al visor, que es lo que el usuario mira.

## Pantalla de tres columnas

- Se quitó la franja inferior con las pestañas Archivos y Metadatos, y la tabla de contenido de carpeta.
- Se quitó la barra de migas del centro, que repetía el nombre de la biblioteca ya visible arriba.
- Categorías, visor y catálogo ocupan todo el alto disponible.
- El visor ganó 252 píxeles de alto respecto de v0.1.5.

## Columna de categorías ajustable

- Barra divisoria arrastrable entre categorías y visor, entre 150 y 420 píxeles.
- Botón para ocultar la columna por completo; al ocultarla el visor gana el ancho entero.
- Arrastrar nunca oculta la columna: esconderla es exclusivo del botón.
- Con la columna oculta la barra sigue siendo arrastrable y la trae de vuelta.
- El ancho y el estado se recuerdan entre sesiones.

## Franja de datos del archivo

- Entre el visor y el reproductor, sin modificar el reproductor.
- Muestra formato, nombre, tamaño, fecha de modificación y carpeta contenedora.
- No repite duración, tiempo ni clips, que ya figuran en el reproductor.
- Botón para abrir la carpeta real y dejar el archivo seleccionado en el Explorador.
- Botón para editar los metadatos de la animación en curso.

## Metadatos en panel flotante

- El editor de nombre para juego, categoría, subcategoría, etiquetas y descripción se abre sobre el visor.
- Se cierra con `Escape`, con la cruz o tocando fuera del panel.
- Con el panel abierto las flechas no cambian de animación.

## Catálogo despejado

- Las tarjetas conservan únicamente el corazón de favoritas.
- Al liberar espacio vuelven a entrar siete animaciones por pantalla en vista compacta.

## Ubicación de la biblioteca

- El botón `BIBLIOTECA ACTUAL` abre una ventana flotante que muestra la ruta vinculada.
- Reemplaza a la franja de carpetas que desplazaba el contenido hacia abajo.
- Se eliminó el árbol de carpetas: la clasificación se hace por categorías.
- El catálogo abre en `Todas las animaciones`.

## Visor 3D

- Rueda del ratón presionada y arrastrar: girar alrededor del modelo.
- Rueda hacia adelante y atrás: acercar y alejar.
- Botón derecho y arrastrar: desplazar el modelo.
- Distancia de cámara limitada entre 0,25 y 60 para no perder el modelo de vista.

## Correcciones

- La animación dejaba de reproducirse y volvía a arrancar sola. El rastreo automático de la biblioteca, que corre cada sesenta segundos y al volver a la ventana, entregaba objetos nuevos aunque los archivos estuvieran intactos y el visor recargaba la animación desde cero. Ahora compara ruta, tamaño y fecha, y conserva la animación en curso cuando el archivo no cambió.
- Las barras de desplazamiento usaban el estilo blanco del sistema. Ahora siguen el tema de la aplicación y acompañan el cambio a tema claro.

## Comprobaciones

- `npm run build`: correcto, con el aviso no bloqueante por el tamaño de Three.js.
- `npm test`: correcto, sin pruebas frontend registradas.
- `npm run test:3d`: escena GLTF y clip de un segundo cargados.
- `cargo fmt --check`, `cargo test` y `cargo clippy --all-targets -- -D warnings`: correctos.
- Controles del visor verificados con gestos reales sobre el lienzo.
- Barra y plegado de la columna verificados midiendo anchos antes y después de cada gesto.
