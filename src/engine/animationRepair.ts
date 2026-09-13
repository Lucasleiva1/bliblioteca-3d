import * as THREE from "three";

/** Giro mínimo de ida y de vuelta para sospechar de un tramo: el cuerpo no gira tanto en un cuadro y vuelve. */
const SPIKE_MIN_DEGREES = 45;
/** Largo máximo del tramo sospechoso, en cuadros. Más largo ya puede ser un movimiento real. */
const SPIKE_MAX_FRAMES = 3;
/**
 * Solo se revisan datos densos, como los de una captura de movimiento (al menos 20 cuadros por
 * segundo). Una animación hecha a mano, con poses separadas, queda afuera y no se toca.
 */
const SECONDS_PER_FRAME = 1 / 20;

/**
 * Busca tramos de `width` cuadros seguidos que se alejan mucho de la pose anterior y vuelven a la
 * siguiente, y los reemplaza por el camino directo entre esas dos poses.
 */
function repairTrackWindows(track: THREE.QuaternionKeyframeTrack, width: number) {
  const { times, values } = track;
  const minAngle = THREE.MathUtils.degToRad(SPIKE_MIN_DEGREES);
  // Margen por el redondeo de los tiempos y por las claves intermedias que agrega el cargador FBX.
  const maxSpan = (width + 1) * SECONDS_PER_FRAME + 0.005;
  const before = new THREE.Quaternion();
  const first = new THREE.Quaternion();
  const last = new THREE.Quaternion();
  const after = new THREE.Quaternion();
  const fixed = new THREE.Quaternion();
  let repaired = 0;
  for (let start = 1; start + width < times.length; start += 1) {
    const end = start + width;
    const span = times[end] - times[start - 1];
    if (span > maxSpan) continue;
    before.fromArray(values, (start - 1) * 4);
    first.fromArray(values, start * 4);
    last.fromArray(values, (end - 1) * 4);
    after.fromArray(values, end * 4);
    const out = before.angleTo(first);
    const back = last.angleTo(after);
    // Un cuadro suelto alcanza con que salte de un lado; un tramo más largo tiene que irse y volver.
    const jump = width === 1 ? Math.max(out, back) : Math.min(out, back);
    if (jump < minAngle || before.angleTo(after) > jump / 3) continue;
    for (let index = start; index < end; index += 1) {
      const fraction = span > 0 ? (times[index] - times[start - 1]) / span : 0.5;
      fixed.copy(before).slerp(after, fraction).toArray(values, index * 4);
    }
    repaired += width;
  }
  return repaired;
}

/**
 * Algunas capturas de movimiento traen cuadros sueltos donde un hueso apunta a cualquier lado y
 * enseguida vuelve (por ejemplo, un pie que gira 170° durante 1/30 s). Están grabados así en el
 * archivo y se ven como un tic. Se corrigen solo en memoria: el archivo no se modifica. Devuelve
 * cuántos cuadros se corrigieron.
 */
export function repairQuaternionSpikes(clips: THREE.AnimationClip[]) {
  let repaired = 0;
  for (const clip of clips) {
    for (const track of clip.tracks) {
      if (!(track instanceof THREE.QuaternionKeyframeTrack)) continue;
      // Corregir un tramo puede dejar a la vista otro: se repasa hasta que no quede nada que cambiar.
      for (let round = 0; round < 3; round += 1) {
        let changed = 0;
        for (let width = 1; width <= SPIKE_MAX_FRAMES; width += 1) changed += repairTrackWindows(track, width);
        repaired += changed;
        if (!changed) break;
      }
    }
  }
  return repaired;
}
