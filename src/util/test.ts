import { Vec3 } from "vec3";

const point = new Vec3(7, 2, 7);
const begin = new Vec3(0, 0, 0);
const cursor = new Vec3(0, 0, 0);
const end = new Vec3(16, 16, 16);

let blocks = [];
const maxDistance = 5;
const count = 50;
let yOff = 0;
let yNeg = false;
let yBounce = true;
outer: for (cursor.y = point.y; begin.y <= cursor.y && cursor.y < end.y; ) {
  console.log("cursor.y:", cursor.y);
  for (cursor.x = begin.x; cursor.x < end.x; cursor.x++) {
    for (cursor.z = begin.z; cursor.z < end.z; cursor.z++) {
      if (cursor.distanceTo(point) <= maxDistance) {
        blocks.push(cursor.clone());
      }
    }
  }
  //   for (cursor.x = begin.x; cursor.x < end.x; cursor.x++) {
  //     for (cursor.z = begin.z; cursor.z < end.z; cursor.z++) {
  // let xOff = 0;
  // let xNeg = false;
  // let xBounce = true;
  // for (cursor.x = point.x; begin.x <= cursor.x && cursor.x < end.x; ) {
  //   console.log("cursor.x:", cursor.x, xBounce);
  //   let zOff = 0;
  //   let zNeg = false;
  //   let zBounce = true;
  //   for (cursor.z = point.z; begin.z <= cursor.z && cursor.z < end.z; ) {
  //     if (cursor.distanceTo(point) <= maxDistance) {
  //       blocks.push(cursor.clone());
  //     }

  //     if (blocks.length >= count) break outer;

  //     if (zBounce) {
  //       zOff += 1;
  //       zNeg = !zNeg;
  //       cursor.z += zNeg ? -zOff : zOff;

  //       if (cursor.z < begin.z) {
  //         cursor.z += (zNeg ? zOff : -zOff) + 1;
  //         zBounce = false;
  //       }

  //       if (cursor.z >= end.z) {
  //         cursor.z += (zNeg ? zOff : -zOff) - 1;
  //         zBounce = false;
  //       }
  //     } else {
  //       cursor.z += zNeg ? 1 : -1;
  //     }
  //   }

  //   if (xBounce) {
  //     xOff += 1;
  //     xNeg = !xNeg;
  //     cursor.x += xNeg ? -xOff : xOff;

  //     if (cursor.x < begin.x) {
  //       cursor.x += (xNeg ? xOff : -xOff) + 1;
  //       xBounce = false;
  //     }

  //     if (cursor.x >= end.x) {
  //       cursor.x += (xNeg ? xOff : -xOff) - 1;
  //       xBounce = false;
  //     }
  //   } else {
  //     cursor.x += xNeg ? 1 : -1;
  //   }
  // }
  if (yBounce) {
    yOff += 1;
    yNeg = !yNeg;
    cursor.y += yNeg ? -yOff : yOff;

    if (cursor.y < begin.y) {
      cursor.y += (yNeg ? yOff : -yOff) + 1;
      yBounce = false;
    }

    if (cursor.y >= end.y) {
      cursor.y += (yNeg ? yOff : -yOff) - 1;
      yBounce = false;
    }
  } else {
    cursor.y += yNeg ? 1 : -1;
  }
}


function twoListsSameElements(first: Vec3[], second: Vec3[]) {
  return first.every(first => second.find(second => second.equals(first))) && second.every(second => first.find(first => second.equals(first)))
}



blocks.sort((a, b) => a.distanceTo(point) - b.distanceTo(point));
// blocks = blocks.slice(0, 50)
console.log(blocks.map((b) => [b, b.distanceTo(point)]));
let blocks1 = [];

for (cursor.y = begin.y; cursor.y < end.y; cursor.y++) {
  for (cursor.x = begin.x; cursor.x < end.x; cursor.x++) {
    for (cursor.z = begin.z; cursor.z < end.z; cursor.z++) {
      if (cursor.distanceTo(point) <= maxDistance) {
        blocks1.push(cursor.clone());
      }
    }
  }
}
blocks1.sort((a, b) => a.distanceTo(point) - b.distanceTo(point));
// blocks1 = blocks1.slice(0, 50)
console.log(blocks1.map((b) => [b, b.distanceTo(point)]));

console.log(twoListsSameElements(blocks, blocks1));

// const map = new Map<number, number>();

// map.set(1, 10);
// map.set(1, 10);
// map.set(1, 10);
// map.set(1, 10);
// map.set(1, 10);
// map.set(1, 10);

// for (const [key, val] of map.entries()) {
//   console.log("hey!")
// }
