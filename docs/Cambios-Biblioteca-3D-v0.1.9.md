# Cambios de Biblioteca 3D — v0.1.9

Fecha: 13 de septiembre de 2026.

Versión centrada en que las animaciones se vean bien: sin huesos que saltan, con capturas reales y con el formato BVH.

## Animaciones sin tirones

- El lector de FBX combinaba las rotaciones X, Y y Z de cada hueso por su posición en la lista, aunque cada eje trajera una cantidad distinta de claves. Ahora las combina por tiempo, así que ya no mezcla poses de momentos diferentes. Usa una copia local del lector de Three.js r180 (licencia MIT) con ese único cambio.
- Algunas capturas de movimiento traen grabados cuadros sueltos donde un pie o una pierna gira de golpe y vuelve enseguida (por ejemplo, 170° durante 1/30 s). Al abrir una animación, esos tramos de hasta 3 cuadros se reemplazan por el camino directo entre la pose anterior y la siguiente.
- La limpieza actúa solo en memoria: los archivos originales no se modifican.
- Solo revisa datos densos, de al menos 20 cuadros por segundo, y giros de 45° o más en un cuadro que vuelven al lugar de partida. Un giro rápido que se mantiene y las animaciones hechas a mano con poses separadas no se tocan.
- Resultado en el paquete `Animations` (2.548 animaciones de captura de movimiento): 915 animaciones tenían huesos que saltaban con el lector anterior; ahora ninguna conserva tirones de 1 o 2 cuadros.

## Formato BVH

- Los archivos BVH se listan, se filtran y se abren como un esqueleto con su animación.
- `Cargar Nuevo` acepta carpetas con BVH.

## Capturas de animaciones

- Las animaciones también reciben una captura real, no solo las piezas. El contador de arriba pasa a llamarse `Capturas`.
- La captura recorre el clip y elige la pose más expresiva en lugar del primer cuadro.
- Una animación que trae solo el esqueleto se fotografía con el maniquí.

## Visor

- La vista del esqueleto muestra una sola jerarquía: los FBX con el personaje dividido en cuerpo, cabeza, piernas y pies traían copias superpuestas que titilaban.
- Los personajes conservan sus materiales opacos; forzarlos a semitransparentes hacía parpadear las partes del cuerpo al moverse.
- La grilla queda apenas debajo del piso para que no parpadee con la suela.
- La repetición en bucle viene apagada: las capturas de movimiento se desplazan y, al repetir, el personaje saltaba al punto de partida.
- El esqueleto viene apagado por defecto.

## Comprobaciones

- `npm run build`, `npm test` (51 pruebas) y `npm run test:3d`: correctos.
- `cargo fmt --check`, `cargo test` (23 pruebas) y `cargo clippy --all-targets -- -D warnings`: correctos.
- Medición sobre las 2.629 animaciones del grupo `Animaciones`: tirones de 1 cuadro, de 716 a 0; de 2 cuadros, de 240 a 0; tramos de 3 cuadros, de 178 a 1. Se corrigieron 1.620 cuadros, sin valores inválidos. Los BVH de `kimodo` y el paquete de Mixamo no recibieron cambios.
- `sword and shield slash (2).fbx` no abre: el archivo trae un tipo de dato que el lector no reconoce. Ya fallaba antes de esta versión.
- Prueba de las animaciones en la app de desarrollo: correcta.
