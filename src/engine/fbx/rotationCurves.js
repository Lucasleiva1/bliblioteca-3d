/** Sample each independently keyed FBX axis at the same instant, preserving original keys. */
export function synchronizeRotationCurves(curves) {
  const times = [...new Set(['x', 'y', 'z'].flatMap(axis => curves[axis].times))].sort((a,b) => a-b);
  const result = {};
  for (const axis of ['x', 'y', 'z']) {
    const curve = curves[axis];
    let index = 0;
    const values = times.map(time => {
      while (index + 1 < curve.times.length && curve.times[index + 1] <= time) index++;
      if (time <= curve.times[0] || index === curve.times.length - 1) return curve.values[index];
      const fraction = (time - curve.times[index]) / (curve.times[index + 1] - curve.times[index]);
      return curve.values[index] + fraction * (curve.values[index + 1] - curve.values[index]);
    });
    result[axis] = { ...curve, times, values };
  }
  return result;
}
