const VERSION = "v0.1.1";

export function thumbnailForAnimation(fileName: string) {
  const name = fileName.toLocaleLowerCase();
  let pose = "idle";
  if (name.includes("paladin")) pose = "character";
  else if (name.includes("sheath sword 1")) pose = "sheath-high";
  else if (name.includes("sheath sword 2")) pose = "sheath-low";
  else if (name.includes("180 turn")) pose = "turn-180";
  else if (name.includes("crouch block idle")) pose = "crouch-block-idle";
  else if (name.includes("crouch block")) pose = "crouch-block";
  else if (name.includes("block idle")) pose = "block-idle";
  else if (name.includes("crouch idle")) pose = "crouch-idle";
  else if (name.includes("crouching")) pose = "crouching";
  else if (name.includes("crouch")) pose = "crouch";
  else if (name.includes("attack")) pose = "attack";
  else if (name.includes("block")) pose = "block";
  else if (name.includes("casting")) pose = "casting";
  else if (name.includes("death")) pose = "death";
  else if (name.includes("impact")) pose = "impact";
  else if (name.includes("jump")) pose = "jump";
  else if (name.includes("kick")) pose = "kick";
  else if (name.includes("power up")) pose = "power-up";
  else if (name.includes("run")) pose = "run";
  else if (name.includes("slash")) pose = "slash";
  else if (name.includes("strafe")) pose = "strafe";
  else if (name.includes("turn")) pose = "turn";
  else if (name.includes("walk")) pose = "walk";
  return `/thumbnails/poses/${pose}-${VERSION}.webp`;
}
