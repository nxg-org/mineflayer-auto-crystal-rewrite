import { Vec3 } from "vec3";

const point = new Vec3(8, 8, 11);
const begin = new Vec3(0, 0, 0);
const cursor = new Vec3(0, 0, 0);
const end = new Vec3(16, 16, 16);

let blocks = [];
const maxDistance = 5;
let yOff = 0;
let yNeg = false;

for (cursor.y = point.y; begin.y <= cursor.y && cursor.y < end.y; ) {
  //   for (cursor.x = begin.x; cursor.x < end.x; cursor.x++) {
  //     for (cursor.z = begin.z; cursor.z < end.z; cursor.z++) {
  let xOff = 0;
  let xNeg = false;
  for (cursor.x = point.x; begin.x <= cursor.x && cursor.x < end.x; ) {
    let zOff = 0;
    let zNeg = false;
    for (cursor.z = point.z; begin.z <= cursor.z && cursor.z < end.z; ) {
      if (cursor.distanceTo(point) <= maxDistance) {
        blocks.push(cursor.clone());
      }
      zOff += 1;
      zNeg = !zNeg;
      cursor.z += zNeg ? -zOff : zOff;
    }
    xOff += 1;
    xNeg = !xNeg;
    cursor.x += xNeg ? -xOff : xOff;
  }
  //     }
  //   }
  yOff += 1;
  yNeg = !yNeg;
  cursor.y += yNeg ? -yOff : yOff;
}

blocks.sort((a, b) => a.x - b.x);
console.log(blocks.length);
blocks = [];

for (cursor.y = begin.y; cursor.y < end.y; cursor.y++) {
  for (cursor.x = begin.x; cursor.x < end.x; cursor.x++) {
    for (cursor.z = begin.z; cursor.z < end.z; cursor.z++) {
      if (cursor.distanceTo(point) <= maxDistance) {
        blocks.push(cursor.clone());
      }
    }
  }
}
blocks.sort((a, b) => a.x - b.x);
console.log(blocks.length);
