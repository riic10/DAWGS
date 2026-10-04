// Spark draws the splats from its last finished depth sort. While the woods
// remap their level of detail (~250 ms), that can be several frames old, so
// the dog's splats trail its live pose. Meshes that ride on the dog (the
// carried ball, the mouth interior) would keep moving and slide off the
// mouth, so pin them to the pose the shown splats were built from.
export function createSplatSync(spark) {
  const poses = new Map(); // accumulator -> [[object, matrixWorld, visible]]
  const pinned = [];
  let built = null, builtNow = false;

  return {
    // Call right after spark.update(), which builds the splats synchronously.
    record(objects) {
      builtNow = spark.current !== built;
      if (!builtNow) return;
      built = spark.current;
      const pose = poses.get(built) ?? [];
      let n = 0;
      for (const object of objects) object.traverse(o => {
        const entry = pose[n++] ??= [null, o.matrixWorld.clone(), true];
        entry[0] = o;
        entry[1].copy(o.matrixWorld);
        entry[2] = o.visible;
      });
      pose.length = n;
      poses.set(built, pose);
    },

    // Call before renderer.render(); a no-op when the shown splats are current.
    pin() {
      const pose = poses.get(spark.display);
      if (!pose || (builtNow && spark.display === built)) return;
      for (const [o, matrix, visible] of pose) {
        pinned.push([o, o.visible, o.matrixWorldAutoUpdate]);
        o.matrixWorld.copy(matrix);
        o.visible = visible;
        o.matrixWorldAutoUpdate = false;
      }
    },

    unpin() {
      for (const [o, visible, auto] of pinned) {
        o.visible = visible;
        o.matrixWorldAutoUpdate = auto;
      }
      pinned.length = 0;
      builtNow = false;
    },
  };
}
