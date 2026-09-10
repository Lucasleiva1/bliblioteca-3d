# Biblioteca 3D

Aplicación nativa de Windows para recorrer carpetas y previsualizar animaciones 3D sin modificar los archivos originales.

## Funciones disponibles

- Elegir y recordar una carpeta de biblioteca.
- Árbol recursivo con carpetas vacías, conteos, volver y subir de nivel.
- Tabla inferior con carpetas, animaciones y archivos auxiliares.
- Abrir carpetas y revelar archivos en el Explorador de Windows.
- Catálogo individual de archivos FBX, GLB y GLTF.
- GLTF con archivos `.bin` e imágenes locales, validados dentro de la biblioteca.
- Visor Three.js con maniquí humanoide procedural masculino o femenino, opción con/sin palitos, grilla, cámara, clips, reproducción, pausa, stop, timeline, loop y velocidades.
- Búsqueda, vistas compacta/grilla/lista y favoritas.
- Categorías y metadatos SQLite por animación: nombre para juego, subcategoría, etiquetas y descripción, sin modificar el archivo original.
- Nombre, logo y tema configurables para permitir otras marcas.

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
- Versión actual: `0.1.0`
- Puerto de desarrollo: `1430`

El repositorio de destino es `https://github.com/Lucasleiva1/bliblioteca-3d.git`. No se reutiliza la identidad ni los datos de ROXWANA. `tests/fixtures/animated-triangle.gltf` es un modelo mínimo generado para comprobar el cargador y no forma parte de la biblioteca del usuario.

## Datos y seguridad

La raíz elegida se guarda en SQLite dentro de los datos locales de la aplicación. El escaneo no sigue enlaces y excluye cualquier carpeta `_biblioteca-3d`. Las lecturas de modelos y recursos asociados se validan para impedir rutas fuera de la biblioteca activa. Favoritas, tema y marca se guardan localmente en el perfil de la aplicación.

El plan completo está en el Escritorio como `Plan-Biblioteca-Animaciones-3D-v1.0.0.md`. El estado real de las ocho etapas se mantiene en `docs/Progreso-Biblioteca-3D-v0.1.0.md`.
