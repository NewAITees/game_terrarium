// Sprite-sheet animation helper for One-Line RPG.
// A sheet is a uniform grid of frames (fw x fh), read row-major (index = row*cols + col).
// Animations are named frame ranges; the ANIM tables in one_line_rpg.ts are the single
// place to retune which frame index maps to which state after visual calibration.

export type Anim = {
  /** first frame index (row-major) */ start: number;
  /** number of frames */ frames: number;
  /** frames per second */ fps: number;
  /** loop or hold on last frame */ loop: boolean;
};

export class Sheet {
  readonly img = new Image();
  ready = false;
  constructor(
    src: string,
    readonly fw: number,
    readonly fh: number,
    readonly cols: number,
  ) {
    this.img.onload = () => { this.ready = true; };
    this.img.src = src;
  }

  /** Frame index for an animation at elapsed time (seconds). */
  frameAt(a: Anim, t: number): number {
    if (a.frames <= 1) return a.start;
    const step = Math.floor(t * a.fps);
    const local = a.loop ? step % a.frames : Math.min(step, a.frames - 1);
    return a.start + local;
  }

  /** Progress 0..1 through a one-shot animation (clamped). */
  progress(a: Anim, t: number): number {
    const total = a.frames / a.fps;
    return total <= 0 ? 1 : Math.min(1, t / total);
  }

  /**
   * Draw frame `index` so its bottom-center sits at (cx, groundY), scaled.
   * `flip` mirrors horizontally (sheets face right; enemies moving left flip).
   */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    index: number,
    cx: number,
    groundY: number,
    scale: number,
    flip: boolean,
  ): void {
    if (!this.ready) return;
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const sx = col * this.fw;
    const sy = row * this.fh;
    const dw = this.fw * scale;
    const dh = this.fh * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, groundY);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(this.img, sx, sy, this.fw, this.fh, -dw / 2, -dh, dw, dh);
    ctx.restore();
  }
}
