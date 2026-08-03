export function drawZombieBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  wave: number,
  arenaArt: HTMLImageElement,
): void {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#101e1c');
  gradient.addColorStop(0.55, '#17221b');
  gradient.addColorStop(1, '#080d0d');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  if (arenaArt.complete && arenaArt.naturalWidth) {
    context.globalAlpha = 0.72;
    context.drawImage(arenaArt, 0, 0, width, height);
    context.globalAlpha = 1;
  }

  context.globalAlpha = 0.2;
  context.strokeStyle = '#789d78';
  context.lineWidth = 1;
  for (let x = -height; x < width + height; x += 72) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height, height);
    context.stroke();
  }
  for (let y = 70; y < height; y += 72) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  for (let index = 0; index < 22; index += 1) {
    const x = (index * 173 + wave * 23) % width;
    const y = (index * 97 + wave * 13) % height;
    context.fillStyle = index % 4 === 0 ? '#b8e5a0' : '#5a806b';
    context.globalAlpha = 0.2 + (index % 3) * 0.08;
    context.fillRect(x, y, 2 + index % 3, 2 + index % 2);
  }
  context.globalAlpha = 1;
}
