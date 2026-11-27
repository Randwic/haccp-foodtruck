import { describe, expect, it } from 'vitest'
import { gs1Date, isValidGtin, normalizeGtin, parseGs1, readingFromBarcode } from './gtin.ts'
import { parseLabelText } from './parseLabel.ts'

const today = '2026-11-18'

describe('GTIN', () => {
  it('vérifie la clé de contrôle', () => {
    expect(isValidGtin('3017620422003')).toBe(true) // EAN-13
    expect(isValidGtin('3017620422004')).toBe(false)
    expect(isValidGtin('96385074')).toBe(true) // EAN-8
    expect(isValidGtin('036000291452')).toBe(true) // UPC-A
    expect(isValidGtin('12345')).toBe(false)
  })
  it('ramène UPC-A et GTIN-14 à 13 chiffres', () => {
    expect(normalizeGtin('036000291452')).toBe('0036000291452')
    expect(normalizeGtin('03017620422003')).toBe('3017620422003')
    expect(normalizeGtin('3 017620 422003')).toBe('3017620422003')
    expect(normalizeGtin('3017620422004')).toBeNull()
  })
  it('dates GS1 (jour 00 = fin de mois)', () => {
    expect(gs1Date('261125')).toBe('2026-11-25')
    expect(gs1Date('270200')).toBe('2027-02-28')
    expect(gs1Date('271332')).toBeUndefined()
  })
})

describe('codes GS1', () => {
  it('GS1-128 avec séparateur FNC1', () => {
    const r = readingFromBarcode(']C10103017620422003172611251' + '0' + 'AB12C\u001d3103001250')
    expect(r).toEqual({ gtin: '3017620422003', dlc: '2026-11-25', lot: 'AB12C' })
  })
  it('forme lisible avec parenthèses', () => {
    expect(readingFromBarcode('(01)03017620422003(15)270600(10)L2311A')).toEqual({ gtin: '3017620422003', ddm: '2027-06-30', lot: 'L2311A' })
  })
  it('QR GS1 Digital Link', () => {
    expect(readingFromBarcode('https://id.gs1.org/01/03017620422003/10/ABC-9?17=261201')).toEqual({ gtin: '3017620422003', lot: 'ABC-9', dlc: '2026-12-01' })
  })
  it('EAN-13 simple, ou rien d’utile', () => {
    expect(readingFromBarcode('3017620422003')).toEqual({ gtin: '3017620422003' })
    expect(readingFromBarcode('3017620422004')).toBeNull()
    expect(readingFromBarcode('bonjour')).toBeNull()
    expect(parseGs1('https://exemple.fr/menu')).toBeNull()
  })
})

describe('texte d’étiquette (OCR)', () => {
  it('étiquette française classique', () => {
    const t = `STEAK HACHE 15% MG\nA consommer jusqu'au : 25/11/2026\nLOT : L23115A\nEMB 29123`
    expect(parseLabelText(t, { today })).toEqual({ dlc: '2026-11-25', lot: 'L23115A' })
  })
  it('DDM avec mois et année seulement', () => {
    expect(parseLabelText('À consommer de préférence avant fin : 06/2027\nN° de lot : 2311-45', { today })).toEqual({ ddm: '2027-06-30', lot: '2311-45' })
  })
  it('ignore les dates d’emballage et d’abattage', () => {
    const t = 'Emballé le 18.11.26  DLC 28.11.26\nAbattu le 15/11/2026'
    expect(parseLabelText(t, { today })).toEqual({ dlc: '2026-11-28' })
  })
  it('mot-clé sur la ligne précédente, confusions O/0 et I/1', () => {
    const t = 'A consommer jusqu’au\n2O/I2/2026\nLot n° 98765'
    expect(parseLabelText(t, { today })).toEqual({ dlc: '2026-12-20', lot: '98765' })
  })
  it('lot préfixé par L et date seule sans mot-clé', () => {
    expect(parseLabelText('L2311A 02/12/26', { today })).toEqual({ lot: 'L2311A', dlc: '2026-12-02' })
  })
  it('date en toutes lettres et GTIN imprimé sous le code-barres', () => {
    const t = 'Best before 15 MAR 2027\nBatch: X77-2\n3 017620 422003'
    expect(parseLabelText(t, { today })).toEqual({ ddm: '2027-03-15', lot: 'X77-2', gtin: '3017620422003' })
  })
  it('date invraisemblable écartée, rien d’utile = null', () => {
    expect(parseLabelText('DLC 01/01/2001', { today })).toBeNull()
    expect(parseLabelText('Ingrédients : farine, eau, sel', { today })).toBeNull()
  })
})

describe('étiquettes réelles (jet d’encre, relief)', () => {
  it('date espacée et lot sans mot-clé sur la ligne suivante', () => {
    expect(parseLabelText("À consommer jusqu'au :\n27 11 26 07:31\n22982629304", { today })).toEqual({ dlc: '2026-11-27', lot: '22982629304' })
  })
  it('lot collé à la date, heure à la ligne', () => {
    expect(parseLabelText('MG26298R99A 27/11/26\n11:38', { today })).toEqual({ dlc: '2026-11-27', lot: 'MG26298R99A' })
  })
  it('« J07/12 » : jour et mois sans année', () => {
    expect(parseLabelText('J07/12 17:06\nP7', { today })).toEqual({ dlc: '2026-12-07' })
    expect(parseLabelText('J05/01', { today })).toEqual({ dlc: '2027-01-05' })
  })
  it('année mal lue en points (« 2826 »)', () => {
    expect(parseLabelText("A CONS. JUSQU'AU 28/11/2826\nL:2326C 14:32", { today })).toEqual({ dlc: '2026-11-28', lot: 'L2326C' })
  })
  it('pas de lot inventé sans date', () => {
    expect(parseLabelText('ABC123456 bonjour', { today })).toBeNull()
  })
})

describe('sorties du moteur de lecture moderne', () => {
  it('date collée à l’heure, mot-clé sans espaces', () => {
    expect(parseLabelText('Aconsommerjusqu\n27.112607:31\n22982629304', { today })).toEqual({ dlc: '2026-11-27', lot: '22982629304' })
  })
  it('« J0712 » sans barre', () => {
    expect(parseLabelText('J0712\nMILSANI\nFromage BLANC', { today })).toEqual({ dlc: '2026-12-07' })
  })
  it('lot court sans mot-clé sous la date (« N374 14:00 »), DDM annoncée plus haut', () => {
    const t = "À consommer de préférence avant le/\nN° de lot : voir sur l'étiquette.\nConditions de conservation : avant\nVolume net : 0,5L\n08/09/27\nN374 14:00"
    expect(parseLabelText(t, { today })).toEqual({ ddm: '2027-09-08', lot: 'N374' })
    // Lecture en points : lettre détachée, heure collée ou espacée.
    expect(parseLabelText('08/09/27\nN 374 14 : 00', { today })).toEqual({ dlc: '2027-09-08', lot: 'N374' })
    expect(parseLabelText('08/09/27\nN37414:00', { today })).toEqual({ dlc: '2027-09-08', lot: 'N374' })
  })
  it('pas de lot pris dans une année ou une heure seules', () => {
    expect(parseLabelText('A consommer jusqu’au 27/11/2026\n2026 14:00', { today })).toEqual({ dlc: '2026-11-27' })
  })
  it('une vraie date l’emporte sur un nombre qui ressemble à une date collée', () => {
    expect(parseLabelText('Lot 271126\nDLC 30/11/2026', { today })).toEqual({ dlc: '2026-11-30', lot: '271126' })
  })
})

describe('moteur moderne : zones de texte et décodage', () => {
  it('trouve une ligne horizontale et une verticale', async () => {
    const { boxesFromProbMap } = await import('./paddle.ts')
    const w = 100
    const h = 100
    const prob = new Float32Array(w * h)
    for (let y = 10; y < 18; y++) for (let x = 10; x < 70; x++) prob[y * w + x] = 0.9 // ligne horizontale
    for (let y = 30; y < 95; y++) for (let x = 85; x < 92; x++) prob[y * w + x] = 0.9 // ligne verticale
    const boxes = boxesFromProbMap(prob, w, h).sort((a, b) => a.cy - b.cy)
    expect(boxes).toHaveLength(2)
    expect(Math.abs(Math.sin(boxes[0].angle))).toBeLessThan(0.1)
    expect(boxes[0].length).toBeGreaterThan(60)
    expect(Math.abs(Math.sin(boxes[1].angle))).toBeGreaterThan(0.9)
  })
  it('décodage CTC : répétitions et vides retirés', async () => {
    const { ctcDecode } = await import('./paddle.ts')
    const chars = ['', 'A', 'B', ' ']
    const steps = [1, 1, 0, 1, 2, 2, 3, 2] // A A _ A B B espace B
    const data = new Float32Array(steps.length * 4)
    steps.forEach((c, t) => (data[t * 4 + c] = 0.9))
    expect(ctcDecode(data, steps.length, 4, chars).text).toBe('AAB B')
  })
})
