# Biblioteca 3D — v0.1.10

## GLTF que no abrían

La política de seguridad de la ventana impedía que Three.js leyera los buffers integrados (`data:`) y las dependencias empaquetadas en memoria (`blob:`). El resultado era «Failed to load buffer» incluso para archivos válidos como Adventurer.gltf.

Se permiten esos dos esquemas locales en `connect-src`, manteniendo las restricciones a conexiones externas. El lector y los archivos originales no cambian.

## Mensajes de error

Los errores ya no imprimen el contenido base64 completo de un modelo. Se reemplazan las URL de datos y recursos temporales por una descripción, se limita el mensaje a 500 caracteres y se mantiene dentro del visor.

## Compatibilidad BVH

Se conservan las mejoras presentes en el proyecto para los nombres de huesos de Kimodo (`Neck1`, `HeadEnd`, `LeftLeg`/`LeftShin`). Si una animación no trae malla y no se puede construir un maniquí, el visor muestra su esqueleto para que no quede vacío.

## Verificación

- 55 pruebas de frontend y 23 pruebas Rust correctas.
- Compilación web y fixture GLTF animada correctos.
- `scripts/verify-gltf-csp.mjs` reproduce el bloqueo con la política anterior y comprueba carga y dibujo con la política corregida, tanto para buffers integrados como para dependencias externas. Admite rutas de GLTF reales como argumentos.
- Prueba en navegador de fondo con las dos variantes de Adventurer.gltf de la biblioteca del usuario: 15 y 17 mallas, 24 clips por variante y 72 poses evaluadas por archivo sin matrices inválidas.

Esta corrección corresponde al mantenimiento y verificación de la etapa 8 del plan de referencia; no altera el alcance de las etapas 1 a 7.

El instalador conserva la identidad y el directorio de datos de Biblioteca 3D. La actualización está firmada con la misma clave que la versión instalada.
