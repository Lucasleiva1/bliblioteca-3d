# Progreso de Biblioteca 3D — v0.1.2

Fecha de actualización: 10 de septiembre de 2026.

Plan de referencia: `Plan-Biblioteca-Animaciones-3D-v1.0.0.md`.

## Identidad verificada

| Dato | Valor |
|---|---|
| Proyecto y producto | Biblioteca 3D |
| Raíz absoluta y raíz Git | `D:\PAGINAS WEB Y APP\bliblioteca-3d` |
| Remoto `origin` | `https://github.com/Lucasleiva1/bliblioteca-3d.git` |
| Paquete | `biblioteca-3d` |
| Identificador Tauri | `com.biblioteca3d.desktop` |
| Versión | `0.1.2` |
| Puerto de desarrollo | `1430` |

## Estado de las ocho etapas

| Etapa | Estado de v0.1.2 | Resultado |
|---|---|---|
| 1. Base técnica | Verificada | Tauri 2, React, TypeScript, Rust, SQLite y Three.js con identidad y datos propios. Un archivo corrupto falla de forma aislada. |
| 2. Shell y carpetas | Funcional | Biblioteca arriba, categorías a la izquierda, visor central, catálogo derecho y archivos abajo. Árbol, migas, entrar, subir, abrir y revelar; `D:\biblioteca-3d` se adopta automáticamente si existe. |
| 3. Visor y reproducción | Funcional | FBX, GLB y GLTF; clips, play, pausa, stop, cuadro anterior/siguiente, timeline, loop, velocidades, cámara, grilla, escala a 1,80 m y apoyo sobre el piso. |
| 4. Maniquí humanoide | Aprobada | Maniquí procedural masculino o femenino, transparente, con o sin palitos. Se genera sobre los huesos de cada animación y evita mezclar rigs incompatibles. |
| 5. Organización | Funcional | Favoritas, categorías editables y ordenables, arrastre para clasificar, Sin clasificar, nombre de juego, subcategoría, etiquetas, descripción y exportación JSON. |
| 6. Catálogo grande | Funcional inicial | 24 miniaturas ilustradas reutilizables, búsqueda, formato, orden, tres vistas y paginación de 24 animaciones. |
| 7. Ajustes y recuperación | Funcional | Tema, marca, preferencias de maniquí, respaldo SQLite versionado, restauración validada con copia de seguridad previa y diagnóstico. |
| 8. Verificación y entrega | Verificada para esta versión | Build web, pruebas Rust, fixture 3D, Clippy sin advertencias, revisión de accesibilidad, medición de columnas a 900 px e instalador NSIS v0.1.2. |

## Evidencia

- `npm run build`: correcto; sólo queda el aviso no bloqueante por el tamaño de Three.js.
- `npm test`: correcto; actualmente no hay pruebas frontend unitarias registradas.
- `npm run test:3d`: escena GLTF y clip de un segundo cargados correctamente.
- `cargo fmt --check`: correcto.
- `cargo test`: 4 pruebas correctas, 0 fallos.
- `cargo clippy --all-targets -- -D warnings`: correcto.
- Biblioteca real: 50 FBX detectados, 49 legibles con animación y 1 archivo inválido aislado.
- Medición a ancho mínimo de 900 px: Categorías 190 px, visor 390 px, catálogo 280 px; controles, tabla y transporte sin desbordamiento horizontal.
- El usuario aprobó visualmente el maniquí procedural y pidió conservarlo.

## Límites conocidos

- Las miniaturas son bocetos de referencia asignados por nombre; todavía no se renderizan automáticamente desde cada pose 3D.
- El catálogo pagina en memoria. No se midió todavía con 5.000 elementos ni en un segundo equipo limpio.
- La publicación en GitHub y el actualizador firmado no forman parte de esta entrega local.
- Las operaciones físicas de mover o renombrar originales permanecen fuera de la interfaz hasta contar con autorización explícita para probarlas sobre copias.

## Artefactos

- Se conservan `Biblioteca-3D-v0.1.0-x64-Setup.exe` y `Biblioteca-3D-v0.1.1-x64-Setup.exe` como versiones anteriores.
- La entrega nueva es `Biblioteca-3D-v0.1.2-x64-Setup.exe`; package, Cargo, Tauri, ProductVersion y FileVersion coinciden en 0.1.2.
- Tamaño: 3.181.115 bytes. SHA-256: `551484CE70E7EFFA0B4D3EEA67D7FC65E5CE02555A7DA741F991C1A64D1751A9`.

