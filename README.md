# Biblioteca 3D

Aplicación nativa de Windows para recorrer carpetas y previsualizar piezas y animaciones 3D sin modificar los archivos originales.

## Funciones disponibles

- Elegir y recordar una carpeta de biblioteca.
- Usar `D:\\biblioteca-3d` automáticamente como biblioteca inicial cuando exista.
- Árbol recursivo con carpetas vacías, conteos, volver y subir de nivel.
- Espacio de trabajo de tres columnas a pantalla completa: categorías, visor y catálogo de miniaturas.
- Abrir carpetas y revelar archivos en el Explorador de Windows.
- Catálogo individual de archivos FBX, GLB y GLTF.
- Accesos fijos a Todo, Sin categoría, cada grupo de la biblioteca y Favoritas.
- Las categorías de un grupo se despliegan únicamente al abrir ese grupo.
- El panel lateral permite buscar categorías, crear subgrupos dentro de cada grupo y plegarlos.
- Las categorías y los subgrupos se pueden arrastrar para cambiar su orden o agrupación visual; esta organización se guarda en SQLite y nunca mueve las carpetas ni los modelos originales.
- El botón `+` crea categorías manuales en el grupo elegido y la flecha contigua crea subgrupos; las miniaturas se pueden arrastrar a una categoría manual o a Sin categoría.
- Grupos: cada carpeta de la raíz de la biblioteca es un grupo (`Piezas`, `Animaciones` y cualquier otra, por ejemplo `contruccion`) y aparece en la lista fija de arriba junto a Todo, Sin categoría y Favoritas. Solo el grupo `Animaciones` se muestra como animación; el resto se muestra como pieza, con materiales y foto.
- Dentro de cada grupo: `Categoría` (también `Categoria` o `Categorías`) contiene una carpeta por categoría; `Varios` guarda lo que va sin categoría. Al abrir o reescanear, a cada grupo se le crean las carpetas `Categoría`, `Varios` y `Cargar Nuevo` que le falten, respetando la variante que ya exista.
- Las categorías sin ningún FBX, GLB o GLTF legible no aparecen hasta que tengan alguno.
- Carga automática por grupo: una carpeta soltada en `<grupo>\\Cargar Nuevo` se mueve sola a `<grupo>\\Categoría\\<nombre de la carpeta>` y sus modelos se suman a la lista sin reescanear la biblioteca. El botón "Cargar nuevo" abre la bandeja del grupo que se está mirando. El vigilante observa únicamente las carpetas `Cargar Nuevo`; al abrir la app se procesa lo que haya quedado pendiente.
- Miniaturas reales de piezas: la app fotografía cada pieza fuera de pantalla (personajes de frente, objetos del lado más reconocible) y guarda un WebP de 256 × 256 en una carpeta `_cache` junto al modelo, con el nombre `<archivo>.webp`. La foto tiene la misma fecha que el modelo: si el modelo cambia, se vuelve a sacar. Las carpetas `_cache` viajan con la carpeta al moverla o copiarla y nunca aparecen como contenido de la biblioteca.
- Al abrir o reescanear se fotografían solo las piezas sin foto, de a una y en segundo plano, con el progreso arriba y botón de pausa; lo que llega por `Cargar Nuevo` y lo visible en la columna derecha pasan primero. Si una foto sale vacía o negra, o la pieza es solo animación sin modelo, queda `<archivo>.fallo.txt` con el motivo y no se reintenta hasta que el archivo cambie.
- Texturas externas: los FBX buscan sus imágenes por nombre en su carpeta y en las vecinas (hasta dos niveles arriba, sin salir de la categoría), también en TGA; los GLTF hacen lo mismo con imágenes faltantes y, si no aparecen, se dibujan sin esa textura. Los materiales marcados como invisibles por error se muestran opacos.
- La carga espera a que Windows termine de copiar. Si la categoría ya existe, el contenido se suma adentro; si algún archivo choca con uno existente no se mueve nada y el motivo queda visible. Los archivos sueltos y las carpetas sin FBX, GLB ni GLTF quedan esperando en `Cargar Nuevo`.
- Las piezas conservan sus materiales originales y se muestran sin la transparencia, el maniquí ni el esqueleto de las animaciones.
- GLTF con archivos `.bin` e imágenes locales, validados dentro de la biblioteca.
- Visor Three.js con maniquí humanoide procedural masculino o femenino, opción con/sin palitos, grilla, cámara, clips, reproducción, pausa, stop, timeline, loop y velocidades.
- Búsqueda, vistas compacta/grilla/lista y favoritas.
- Catálogo paginado de 24 elementos con filtros de formato y orden.
- Categorías automáticas por carpeta y categorías manuales guardadas en SQLite, separadas por grupo.
- Metadatos SQLite por elemento: nombre para juego, subcategoría, etiquetas y descripción, sin modificar el archivo original.
- Los metadatos se editan en un panel flotante que se abre desde cada tarjeta y se cierra con `Escape`.
- Nombre, logo y tema configurables para permitir otras marcas.
- Respaldo, restauración protegida, exportación JSON y diagnóstico local.
- Atajos: `Ctrl+F` busca, flechas arriba/abajo recorren animaciones y `Escape` cierra paneles flotantes.

## Desarrollo

```powershell
npm install
npm run tauri -- dev
```

Comprobaciones:

```powershell
npm run build
npm run test:3d
cd src-tauri
cargo test
```

## Identidad

- Producto: `Biblioteca 3D`
- Paquete: `biblioteca-3d`
- Identificador: `com.biblioteca3d.desktop`
- Versión actual: `0.1.7`
- Puerto de desarrollo: `1430`

El repositorio de destino es `https://github.com/Lucasleiva1/bliblioteca-3d.git`. No se reutiliza la identidad ni los datos de ROXWANA. `tests/fixtures/animated-triangle.gltf` es un modelo mínimo generado para comprobar el cargador y no forma parte de la biblioteca del usuario.

## Datos y seguridad

La raíz elegida se guarda en SQLite dentro de los datos locales de la aplicación. El escaneo no sigue enlaces y excluye cualquier carpeta `_biblioteca-3d`, `_cache` o `Cargar Nuevo`. La app solo puede leer imágenes de texturas que estén dentro de la biblioteca activa. Las lecturas de modelos y recursos asociados se validan para impedir rutas fuera de la biblioteca activa. Favoritas, tema y marca se guardan localmente en el perfil de la aplicación.

El plan completo está en el Escritorio como `Plan-Biblioteca-Animaciones-3D-v1.0.0.md`. El estado de las ocho etapas está en `docs/Progreso-Biblioteca-3D-v0.1.2.md`, el uso diario en `docs/Manual-Biblioteca-3D-v0.1.2.md` y el cambio más reciente en `docs/Cambios-Biblioteca-3D-v0.1.7.md`.
