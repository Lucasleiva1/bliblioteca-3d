export interface RotationCurve {
  times: number[];
  values: number[];
}

export function synchronizeRotationCurves<T extends RotationCurve>(curves: { x: T; y: T; z: T }): { x: T; y: T; z: T };
