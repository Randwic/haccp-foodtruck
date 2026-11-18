// Préparation de la photo avant la lecture du texte (OCR). Fonctions pures sur des niveaux de gris,
// testées dans prepare.test.ts. Une vraie photo d'étiquette n'a rien d'un scan : éclairage inégal,
// reflets, fond coloré, et souvent un lot / une DLC imprimés en points (jet d'encre). Sans préparation,
// le moteur de lecture ne voit rien ; on lui donne donc plusieurs versions nettoyées de l'image.

export interface Gray {
  w: number
  h: number
  /** Une valeur 0 (noir) à 255 (blanc) par pixel, ligne par ligne. */
  px: Uint8ClampedArray
}

/** Niveaux de gris depuis des pixels RGBA (canvas). */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const px = new Uint8ClampedArray(w * h)
  for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000
  return { w, h, px }
}

/** Moyenne locale (carré de côté 2r+1) calculée par image intégrale : rapide quel que soit r. */
export function boxMean(g: Gray, r: number): Float32Array {
  const { w, h, px } = g
  const W = w + 1
  const sum = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += px[y * w + x]
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]
      out[y * w + x] = s / ((y1 - y0) * (x1 - x0))
    }
  }
  return out
}

/**
 * Éclairage remis à plat : chaque pixel est divisé par la clarté moyenne autour de lui. Les ombres,
 * reflets et fonds colorés deviennent un blanc uniforme, l'encre reste foncée.
 */
export function flatten(g: Gray, r: number): Gray {
  const bg = boxMean(g, r)
  const px = new Uint8ClampedArray(g.px.length)
  for (let i = 0; i < px.length; i++) px[i] = (g.px[i] / Math.max(bg[i], 1)) * 235
  return { w: g.w, h: g.h, px }
}

/** Flou léger (moyenne sur 2r+1) : les points d'une impression jet d'encre se rejoignent en traits. */
export function blur(g: Gray, r: number): Gray {
  const m = boxMean(g, r)
  return { w: g.w, h: g.h, px: Uint8ClampedArray.from(m) }
}

/**
 * Noir et blanc selon le voisinage (méthode de Sauvola simplifiée) : un pixel est de l'encre s'il est
 * nettement plus foncé que la moyenne autour de lui. Résiste aux dégradés et aux reflets.
 */
export function binarize(g: Gray, r: number, k = 0.12): Gray {
  const mean = boxMean(g, r)
  const px = new Uint8ClampedArray(g.px.length)
  for (let i = 0; i < px.length; i++) px[i] = g.px[i] < mean[i] * (1 - k) ? 0 : 255
  return { w: g.w, h: g.h, px }
}

/** Pixels RGBA (pour un canvas) depuis des niveaux de gris. */
export function toRgba(g: Gray): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(g.px.length * 4)
  for (let i = 0, j = 0; i < g.px.length; i++, j += 4) {
    out[j] = out[j + 1] = out[j + 2] = g.px[i]
    out[j + 3] = 255
  }
  return out
}

/** Minimum local (carré 2r+1) : l'encre foncée s'épaissit, les trous entre les points se bouchent. */
export function darken(g: Gray, r: number): Gray {
  const { w, h } = g
  const tmp = new Uint8ClampedArray(w * h)
  const px = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.min(m, g.px[y * w + k])
      tmp[y * w + x] = m
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 255
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.min(m, tmp[k * w + x])
      px[y * w + x] = m
    }
  return { w, h, px }
}

/** Image réduite d'un facteur entier n (moyenne de chaque carré n×n). */
export function shrink(g: Gray, n: number): Gray {
  const w = Math.floor(g.w / n)
  const h = Math.floor(g.h / n)
  const px = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) s += g.px[(y * n + j) * g.w + x * n + i]
      px[y * w + x] = s / (n * n)
    }
  return { w, h, px }
}
