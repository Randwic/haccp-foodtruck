// Tableau des allergènes pour la clientèle (information écrite obligatoire : règlement (UE) 1169/2011,
// décret 2015-447) : recettes actives (et, au choix, produits) × 14 allergènes ; impression A4 paysage.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Product, Recipe } from '../../../../shared/payloads.ts'
import { Button, Notice, useToast } from '../../ui/components/index.ts'
import { useCore } from '../../ui/CoreContext.tsx'
import { IconCheck, IconPrint } from '../../ui/icons.tsx'
import { BackButton, EmptyCard, PageTitle } from '../processes/common.tsx'
import { DEFAULT_TIMEZONE } from '../temperatures/schedule.ts'
import { loadLabelFonts } from './fonts.ts'
import { printSheet } from './LabelPreview.tsx'
import { ALLERGEN_LABELS, ALLERGENS, formatLabelDate, orderAllergens, recipeAllergens } from './model.ts'
import { buildAllergenTablePdf, type AllergenTableGroup } from './pdf.ts'
import { canSharePdf, pdfFilename, sharePdf } from './printing.ts'

export const ALLERGEN_TABLE_TITLE = 'Space Diner – Allergènes'
export const ALLERGEN_LEGAL =
  'Information sur les 14 allergènes à déclaration obligatoire (règlement (UE) n° 1169/2011, annexe II ; décret n° 2015-447 du 17 avril 2015), établie d’après nos recettes et les fiches techniques de nos fournisseurs. ' +
  'Nos préparations sont réalisées dans une cuisine où ces allergènes sont présents : des traces ne peuvent être exclues. En cas d’allergie, adressez-vous à notre équipe avant de commander.'

const SHOW_PRODUCTS_KEY = 'haccp.allergens.show_products'

export interface AllergenRows {
  groups: AllergenTableGroup[]
  /** Dernière modification d'une recette ou d'un produit affiché (ISO), ou null. */
  updatedAt: string | null
}

/** Lignes du tableau : recettes actives (allergènes calculés), puis produits actifs si demandé. Pur. */
export function allergenRows(recipes: readonly Recipe[], products: readonly Product[], withProducts: boolean): AllergenRows {
  const active = recipes.filter((r) => r.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const shownProducts = withProducts ? products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'fr')) : []
  const used = new Set(active.flatMap((r) => r.ingredient_product_ids))
  const dates = [
    ...active.map((r) => r.updated_at),
    ...products.filter((p) => used.has(p.id)).map((p) => p.updated_at),
    ...shownProducts.map((p) => p.updated_at),
  ].sort()
  return {
    groups: [
      { title: 'Nos préparations', rows: active.map((r) => ({ name: r.name, allergens: recipeAllergens(r, products) })) },
      { title: 'Produits', rows: shownProducts.map((p) => ({ name: p.name, allergens: orderAllergens(p.allergens) })) },
    ].filter((g) => g.rows.length > 0),
    updatedAt: dates[dates.length - 1] ?? null,
  }
}

export function AllergenTableScreen({ onBack, backLabel = 'Retour' }: { onBack: () => void; backLabel?: string }) {
  const core = useCore()
  const toast = useToast()
  const [refs, setRefs] = useState<{ products: Product[]; recipes: Recipe[]; tz: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [withProducts, setWithProducts] = useState(() => {
    try {
      return localStorage.getItem(SHOW_PRODUCTS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; key: string } | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      Promise.all([core.listProducts({ includeInactive: true }), core.listRecipes(), core.getEstablishment()]).then(
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

  const rows = useMemo(() => (refs ? allergenRows(refs.recipes, refs.products, withProducts) : null), [refs, withProducts])
  const updatedLabel = rows?.updatedAt ? `Mis à jour le ${formatLabelDate(rows.updatedAt, refs!.tz)}` : ''
  const key = rows ? JSON.stringify([rows, updatedLabel]) : ''

  // PDF prêt avant le toucher (partage iOS).
  useEffect(() => {
    if (!rows || rows.groups.length === 0) return
    let alive = true
    loadLabelFonts()
      .then((fonts) => buildAllergenTablePdf({ title: ALLERGEN_TABLE_TITLE, groups: rows.groups, updatedLabel, legal: ALLERGEN_LEGAL }, fonts))
      .then(
        (bytes) => alive && setPdf({ bytes, key }),
        () => {},
      )
    return () => {
      alive = false
    }
  }, [rows, updatedLabel, key])
  const ready = pdf && pdf.key === key ? pdf.bytes : null

  const toggleProducts = () => {
    const v = !withProducts
    setWithProducts(v)
    try {
      localStorage.setItem(SHOW_PRODUCTS_KEY, v ? '1' : '0')
    } catch {
      /* sans importance */
    }
  }
  const share = async () => {
    if (!ready) return
    try {
      await sharePdf(ready, pdfFilename('allergenes', 'space-diner'), ALLERGEN_TABLE_TITLE)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">
      <BackButton label={backLabel} onClick={onBack} />
      <PageTitle
        title="Tableau des allergènes"
        subtitle="Information écrite pour la clientèle, à afficher près du point de vente (format A4)."
        actions={
          <>
            <Button variant="secondary" onClick={() => printSheet('a4')} disabled={!rows || rows.groups.length === 0}>
              Impression directe
            </Button>
            <Button onClick={share} disabled={!ready} icon={<IconPrint size={20} />}>
              {!ready && rows && rows.groups.length > 0 ? 'Préparation du PDF…' : canSharePdf() ? 'Imprimer / Partager (A4)' : 'Imprimer (PDF A4)'}
            </Button>
          </>
        }
      />
      {error && <Notice>Lecture impossible : {error}</Notice>}
      {!rows && !error && <p className="text-[17px] text-fg-muted">Chargement…</p>}
      {rows && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-12 cursor-pointer items-center gap-3 text-[16px] font-medium text-fg">
              <input type="checkbox" checked={withProducts} onChange={toggleProducts} className="h-6 w-6 accent-[var(--accent)]" />
              Afficher aussi les produits (vendus tels quels ou en supplément)
            </label>
            {updatedLabel && <p className="text-[15px] font-semibold text-fg-muted">{updatedLabel}</p>}
          </div>
          {rows.groups.length === 0 ? (
            <EmptyCard>Aucune recette active. Le gérant les ajoute dans Gestion › Recettes.</EmptyCard>
          ) : (
            <AllergenGrid groups={rows.groups} />
          )}
          <p className="mt-4 max-w-4xl text-[14px] leading-relaxed text-fg-subtle">{ALLERGEN_LEGAL}</p>
          <p className="mt-2 max-w-4xl text-[14px] font-medium text-fg-muted">
            Allergènes calculés à partir des fiches Produits et Recettes : à vérifier sur vos fiches fournisseurs et votre PMS avant affichage.
          </p>
          {rows.groups.length > 0 && <A4PrintSheet groups={rows.groups} updatedLabel={updatedLabel} />}
        </>
      )}
    </main>
  )
}

/** Grille lisible : plats en lignes, 14 allergènes en colonnes, coches nettes (icône + texte accessible). */
function AllergenGrid({ groups }: { groups: AllergenTableGroup[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="w-full min-w-[62rem] table-fixed border-collapse text-left">
        <caption className="sr-only">Allergènes présents par plat</caption>
        <thead>
          <tr className="bg-sunken">
            <th scope="col" className="sticky left-0 z-10 w-48 bg-sunken px-4 py-3 align-bottom text-[14px] font-semibold text-fg">
              Plat / préparation
            </th>
            {ALLERGENS.map((a) => (
              <th key={a} scope="col" className="border-l border-line px-1 py-3 text-center align-bottom text-[11.5px] leading-tight font-semibold break-words text-fg-muted">
                {ALLERGEN_LABELS[a]}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th colSpan={ALLERGENS.length + 1} scope="colgroup" className="bg-surface px-4 pt-4 pb-1.5 text-[13px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                {g.title}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.name} className="border-t border-line even:bg-canvas/40">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-[16px] font-semibold text-fg">
                  {r.name}
                </th>
                {ALLERGENS.map((a) => {
                  const has = r.allergens.includes(a)
                  return (
                    <td key={a} className="border-l border-line px-1 py-2 text-center">
                      {has ? (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-fg text-canvas" role="img" aria-label={`Contient : ${ALLERGEN_LABELS[a]}`}>
                          <IconCheck size={18} strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="sr-only">Non</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

/** Vue d'impression directe A4 paysage (noir et blanc). */
function A4PrintSheet({ groups, updatedLabel }: { groups: AllergenTableGroup[]; updatedLabel: string }) {
  if (typeof document === 'undefined') return null
  const cell = { border: '0.5pt solid #999', padding: '4pt 2pt', textAlign: 'center' as const }
  return createPortal(
    <div id="a4-print-root" aria-hidden="true" style={{ fontFamily: 'system-ui, sans-serif', color: '#000', padding: '10mm' }}>
      <style>{'@page { size: A4 landscape; margin: 0 }'}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: '22pt', fontWeight: 900, margin: 0 }}>{ALLERGEN_TABLE_TITLE}</h1>
        <p style={{ fontSize: '10pt', fontWeight: 700, margin: 0 }}>{updatedLabel}</p>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '6mm', fontSize: '9pt' }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'left', width: '50mm', background: '#000', color: '#fff' }}>Plat / préparation</th>
            {ALLERGENS.map((a) => (
              <th key={a} style={{ ...cell, background: '#000', color: '#fff', fontSize: '7pt' }}>
                {ALLERGEN_LABELS[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) => [
            <tr key={g.title}>
              <td colSpan={ALLERGENS.length + 1} style={{ padding: '6pt 2pt 2pt', fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase' }}>
                {g.title}
              </td>
            </tr>,
            ...g.rows.map((r) => (
              <tr key={`${g.title}-${r.name}`}>
                <td style={{ ...cell, textAlign: 'left', fontWeight: 700, fontSize: '10pt' }}>{r.name}</td>
                {ALLERGENS.map((a) => (
                  <td key={a} style={{ ...cell, fontSize: '13pt', fontWeight: 900 }}>
                    {r.allergens.includes(a) ? 'X' : ''}
                  </td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
      </table>
      <p style={{ fontSize: '8pt', marginTop: '6mm', color: '#333' }}>{ALLERGEN_LEGAL}</p>
      <p style={{ fontSize: '8pt', fontWeight: 700 }}>X = allergène présent dans le plat.</p>
    </div>,
    document.body,
  )
}
