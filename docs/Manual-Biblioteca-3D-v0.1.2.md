# Manual breve — Biblioteca 3D v0.1.2

## Primer inicio

Si existe `D:\biblioteca-3d`, la aplicación la abre como biblioteca inicial. También puede elegirse otra carpeta desde **Biblioteca actual**. El escaneo reconoce cada FBX, GLB y GLTF como una animación independiente y nunca modifica sus archivos al reproducir o clasificar.

## Distribución

- **Arriba:** biblioteca física y árbol de carpetas.
- **Izquierda:** Todas, Favoritas, Sin clasificar y categorías.
- **Centro:** visor 3D y reproducción.
- **Derecha:** catálogo paginado, buscador, filtros y vistas.
- **Abajo:** archivos de la carpeta y metadatos de la animación elegida.

## Maniquí y reproducción

En **Ajustes** puede elegirse maniquí masculino o femenino y activar o quitar los palitos. En el visor, **Personaje**, **Esqueleto** y **Grid** se controlan por separado. La barra inferior permite detener, avanzar o retroceder un cuadro, reproducir, elegir clip, mover la línea de tiempo, cambiar velocidad y repetir.

## Clasificación

Cree, cambie de nombre, ordene o elimine categorías desde **Ajustes**. Arrastre una tarjeta hacia una categoría para clasificarla o hacia **Sin clasificar** para quitar la categoría. En **Metadatos** puede completar nombre para juego, subcategoría, etiquetas y descripción. Todo se guarda en SQLite sin renombrar el original.

## Recuperación

Desde **Ajustes** puede exportar el catálogo a JSON, crear un respaldo, restaurar un respaldo elegido o consultar el diagnóstico. La restauración valida la base seleccionada y crea automáticamente una copia de seguridad de la base actual antes de reemplazar sus datos.

## Atajos

- `Ctrl+F`: enfoca el buscador.
- `Flecha arriba` / `Flecha abajo`: animación anterior o siguiente.
- `Escape`: cierra Ajustes y menús abiertos.

Un FBX, GLB o GLTF dañado muestra su propio error y permite seguir usando el resto del catálogo.

