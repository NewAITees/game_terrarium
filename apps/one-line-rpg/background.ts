// Parallax background from the American Forest biome atlas.
// The atlas top band holds 5 vertical silhouette layers, each 256px wide.
// x = 0,256,512,768,1024 → nearest(dark forest) .. farthest(teal sky).

const LAYER_W = 256;
const LAYER_SY = 0;
const LAYER_SH = 300; // silhouette band height inside the 640-tall atlas

export class Parallax {
  readonly img = new Image();
  ready = false;
  private scroll = 0;
  constructor(src: string) {
    this.img.onload = () => { this.ready = true; };
    this.img.src = src;
  }

  /** Advance scroll; call once per frame. `speed` in px/s of the nearest layer. */
  update(dt: number, speed = 40): void { this.scroll += dt * speed; }

  /**
   * Draw all layers so their bottoms sit at `horizonY`, with a sky fill above.
   * Farther layers scroll slower for depth.
   */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, horizonY: number): void {
    // sky gradient underneath (also a fallback before the atlas loads)
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#8fb7c9');
    sky.addColorStop(1, '#cfe0e2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizonY);
    if (!this.ready) return;

    ctx.imageSmoothingEnabled = false;
    // far (layer 4) → near (layer 0)
    for (let layer = 4; layer >= 0; layer--) {
      const depth = (layer + 1) / 5;          // 1 = far
      const speed = 1 - depth * 0.82;          // near moves fastest
      const scale = horizonY / LAYER_SH * 1.05;
      const drawW = LAYER_W * scale;
      const drawH = LAYER_SH * scale;
      const top = horizonY - drawH;
      const offset = ((this.scroll * speed) % drawW + drawW) % drawW;
      for (let x = -offset; x < W + drawW; x += drawW) {
        ctx.drawImage(
          this.img, layer * LAYER_W, LAYER_SY, LAYER_W, LAYER_SH,
          x, top, drawW, drawH,
        );
      }
    }
  }
}
