# Biblioteca 3D

Proyecto independiente para organizar y previsualizar animaciones 3D. ROXWANA Biblioteca Visual es referencia de experiencia, nunca destino de escrituras ni fuente de identidad técnica.

## Identidad

- Producto visible: `Biblioteca 3D`
- Paquete: `biblioteca-3d`
- Identificador Tauri: `com.biblioteca3d.desktop`
- Puerto de desarrollo: `1430`
- Datos, caché y actualizador deben ser exclusivos de este producto.

## Contratos de seguridad

- Escanear, reproducir, clasificar y generar caché nunca modifica originales.
- Cada FBX, GLB o GLTF es una entrada individual, aunque comparta carpeta.
- Categoría de juego y carpeta física son conceptos separados.
- Toda operación física debe ser explícita, validar rutas y tratar dependencias.
- No recorrer ninguna carpeta técnica `_biblioteca-3d`.
- Un archivo corrupto falla de forma aislada y no bloquea el catálogo.

## Plan

El plan aprobado de referencia está en el Escritorio como `Plan-Biblioteca-Animaciones-3D-v1.0.0.md`. Mantener el progreso por etapas 1 a 8.
