// Tableau des allergènes pour la clientèle (information écrite obligatoire : règlement (UE) 1169/2011,
// décret 2015-447). Lot 4 bis : plats du menu seulement, groupés par rubrique, ● présent (rose néon) et
// ○ peut en contenir (jaune), au style de l'affiche du propriétaire (fond bleu nuit, cadre rose, logo, titre cyan).
// Trois rendus : écran (même affiche, défilement horizontal sur iPhone), PDF A4 paysage (pdf-lib), impression directe.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ALLERGENS, type Product, type Recipe } from '../../../../shared/payloads.ts'
import { Button, Notice, useToast } from '../../ui/components/index.ts'
import { BrandLogo } from '../../ui/brand.tsx'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconPrint } from '../../ui/icons.tsx'
import { BackButton, EmptyCard, PageTitle } from '../processes/common.tsx'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import {
  ALLERGEN_CALLOUT,
  ALLERGEN_NOTICE,
  ALLERGEN_TABLE_SUBTITLE,
  ALLERGEN_TABLE_TITLE,
  LEGEND_PRESENT,
  LEGEND_TRACES,
  menuAllergenTable,
  type AllergenTableGroup,
} from './allergenTable.ts'
import { loadDisplayFont, loadLabelFonts } from './fonts.ts'
import { printSheet } from './LabelPreview.tsx'
import { ALLERGEN_LABELS, formatLabelDate } from './model.ts'
import { buildAllergenTablePdf, POSTER, POSTER_HEADERS } from './pdf.ts'
import { canSharePdf, pdfFilename, sharePdf } from './printing.ts'

export { ALLERGEN_TABLE_TITLE }

export function AllergenTableScreen({ onBack, backLabel = 'Retour' }: { onBack: () => void; backLabel?: string }) {
  const core = useCore()
  const toast = useToast()
  const [refs, setRefs] = useState<{ products: Product[]; recipes: Recipe[]; tz: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; key: string } | null>(null)

  useEffect(() => {
    let alive = true
    // Désactivés compris : un plat actif peut utiliser un produit / une préparation désactivés (allergènes gardés).
    const load = () =>
      Promise.all([core.listProducts({ includeInactive: true }), core.listRecipes({ includeInactive: true }), core.getEstablishment()]).then(
        ([products, recipes, e]) => alive && setRefs({ products, recipes, tz: e?.timezone || DEFAULT_TIMEZONE }),
        (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
      )
    void load()
    const off = core.onSyncStatusChange(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [core])

  const table = useMemo(() => (refs ? menuAllergenTable(refs.recipes, refs.products) : null), [refs])
  const updatedLabel = table?.updatedAt ? `Mis à jour le ${formatLabelDate(table.updatedAt, refs!.tz)}` : ''
  const key = table ? JSON.stringify([table.groups, updatedLabel]) : ''
  const empty = !table || table.groups.length === 0

  // PDF prêt avant le toucher (partage iOS).
  useEffect(() => {
    if (!table || table.groups.length === 0) return
    let alive = true
    Promise.all([loadLabelFonts(), loadDisplayFont()])
      .then(([fonts, display]) => buildAllergenTablePdf({ groups: table.groups, updatedLabel }, fonts, display))
      .then(
        (bytes) => alive && setPdf({ bytes, key }),
        () => {},
      )
    return () => {
      alive = false
    }
  }, [table, updatedLabel, key])
  const ready = pdf && pdf.key === key ? pdf.bytes : null

  const share = async () => {
    if (!ready) return
    try {
      await sharePdf(ready, pdfFilename('allergenes', 'space-diner'), `Space Diner – ${ALLERGEN_TABLE_TITLE}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
      <BackButton label={backLabel} onClick={onBack} />
      <PageTitle
        title="Tableau des allergènes"
        subtitle="Affiche pour la clientèle (plats du menu), à poser près du point de vente — A4 paysage."
        actions={
          <>
            <Button variant="secondary" onClick={() => printSheet('a4')} disabled={empty}>
              Impression directe
            </Button>
            <Button onClick={share} disabled={!ready} icon={<IconPrint size={20} />}>
              {!ready && !empty ? 'Préparation du PDF…' : canSharePdf() ? 'Imprimer / Partager (A4)' : 'Imprimer (PDF A4)'}
            </Button>
          </>
        }
      />
      {error && <Notice>Lecture impossible : {error}</Notice>}
      {!table && !error && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {table && (
        <>
          {table.groups.length === 0 ? (
            <EmptyCard>Aucun plat du menu. Le gérant les ajoute dans Gestion › Recettes › Menu.</EmptyCard>
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
              <AllergenPoster groups={table.groups} updatedLabel={updatedLabel} />
            </div>
          )}
          <p className="mt-4 max-w-4xl text-[14px] font-medium text-fg-muted">
            Allergènes calculés à partir des fiches Produits et Recettes (préparations comprises) : à vérifier sur vos fiches fournisseurs et votre PMS avant affichage.
          </p>
          {table.groups.length > 0 && <A4PrintSheet groups={table.groups} updatedLabel={updatedLabel} />}
        </>
      )}
    </main>
  )
}

const display = { fontFamily: "'Bowlby One', system-ui, sans-serif", fontWeight: 400 } as const

function Present({ size = 10 }: { size?: number }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: POSTER.pink }} />
}
function Trace({ size = 10 }: { size?: number }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', border: `1.5px solid ${POSTER.yellow}`, boxSizing: 'border-box' }} />
}

/**
 * L'affiche, identique à l'écran et à l'impression directe (couleurs fixes de la charte, quel que soit le thème).
 * Tableau accessible : en-têtes de colonnes et de lignes, chaque case porte « Présent » / « Peut en contenir ».
 */
export function AllergenPoster({ groups, updatedLabel, print = false }: { groups: AllergenTableGroup[]; updatedLabel: string; print?: boolean }) {
  const cell = 'px-0 text-center align-middle'
  return (
    <section
      aria-label="Tableau des allergènes"
      className={`relative min-w-[60rem] ${print ? '' : 'rounded-2xl shadow-card'}`}
      style={{ color: POSTER.white, background: POSTER.navy, border: `5px solid ${POSTER.pink}`, padding: print ? '9mm 11mm 7mm' : '26px 34px 22px', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
    >
      <header className="flex items-center gap-6">
        <BrandLogo size={print ? 86 : 96} title="Space Diner" />
        <div className="min-w-0 flex-1">
          <h2 style={{ ...display, color: POSTER.cyan, fontSize: print ? 34 : 38, lineHeight: 1.05, letterSpacing: '0.01em' }}>{ALLERGEN_TABLE_TITLE.toUpperCase()}</h2>
          <p className="mt-1 font-bold" style={{ color: POSTER.yellow, fontSize: print ? 14 : 16 }}>
            {ALLERGEN_TABLE_SUBTITLE}
          </p>
        </div>
        {updatedLabel && (
          <p className="self-start text-[12px]" style={{ color: POSTER.chrome }}>
            {updatedLabel}
          </p>
        )}
      </header>

      <table className="mt-4 w-full table-fixed border-collapse">
        <caption className="sr-only">Allergènes par plat du menu : présent ou peut en contenir</caption>
        <colgroup>
          <col style={{ width: '31%' }} />
          {ALLERGENS.map((a, i) => (
            <col key={a} style={{ background: i % 2 === 1 ? POSTER.band : 'transparent' }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              Plat
            </th>
            {ALLERGENS.map((a) => (
              <th key={a} scope="col" className="h-[92px] px-0 pb-2 align-bottom" aria-label={ALLERGEN_LABELS[a]}>
                <span className="mx-auto block text-[12.5px] leading-none font-bold whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  {POSTER_HEADERS[a]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th colSpan={ALLERGENS.length + 1} scope="colgroup" className="pt-3 pb-1 text-left" style={{ background: POSTER.navy, borderBottom: `1.5px solid ${POSTER.cyan}` }}>
                <span style={{ ...display, color: POSTER.cyan, fontSize: 15, letterSpacing: '0.02em' }}>{g.title.toUpperCase()}</span>
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.name} style={{ borderBottom: `1px solid ${POSTER.rule}` }}>
                <th scope="row" className="py-2 pr-3 pl-2 text-left text-[15px] leading-snug font-bold">
                  {r.name}
                </th>
                {ALLERGENS.map((a) => {
                  const present = r.allergens.includes(a)
                  const trace = !present && r.traces.includes(a)
                  return (
                    <td key={a} className={cell}>
                      {present ? (
                        <span role="img" aria-label={`Présent : ${ALLERGEN_LABELS[a]}`} className="inline-flex">
                          <Present />
                        </span>
                      ) : trace ? (
                        <span role="img" aria-label={`Peut en contenir : ${ALLERGEN_LABELS[a]}`} className="inline-flex">
                          <Trace />
                        </span>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <footer className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-[40rem] text-[13px] leading-relaxed">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Present /> {LEGEND_PRESENT}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Trace /> {LEGEND_TRACES}
            </span>
          </p>
          {ALLERGEN_NOTICE.map((t) => (
            <p key={t} className="mt-1">
              {t}
            </p>
          ))}
        </div>
        <p className="text-right" style={{ ...display, color: POSTER.yellow, fontSize: 17, lineHeight: 1.35 }}>
          {ALLERGEN_CALLOUT[0]}
          <br />
          {ALLERGEN_CALLOUT[1]}
        </p>
      </footer>
    </section>
  )
}

/** Vue d'impression directe A4 paysage : la même affiche, couleurs imprimées (print-color-adjust). */
function A4PrintSheet({ groups, updatedLabel }: { groups: AllergenTableGroup[]; updatedLabel: string }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div id="a4-print-root" aria-hidden="true" style={{ width: '297mm', height: '210mm', overflow: 'hidden', background: POSTER.navy }}>
      <style>{'@page { size: A4 landscape; margin: 0 }'}</style>
      <AllergenPoster groups={groups} updatedLabel={updatedLabel} print />
    </div>,
    document.body,
  )
}
