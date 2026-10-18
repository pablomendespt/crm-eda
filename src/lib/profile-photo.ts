export async function prepareProfilePhoto(file: File): Promise<string> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler a imagem.")); };
    image.src = url;
  });
  const side = Math.min(source.naturalWidth, source.naturalHeight);
  const sx = (source.naturalWidth - side) / 2;
  const sy = (source.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.drawImage(source, sx, sy, side, side, 0, 0, 320, 320);
  return canvas.toDataURL("image/jpeg", 0.82);
}
