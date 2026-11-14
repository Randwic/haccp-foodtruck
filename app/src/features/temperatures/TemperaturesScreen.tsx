import { useState } from 'react'
import { Button, Notice } from '../../ui/components/index.ts'
import { IconChevronLeft } from '../../ui/icons.tsx'
import { describeThreshold, formatTemperature } from '../../ui/temperature.ts'
import { CorrectiveActionFlow } from '../corrective-action/CorrectiveActionFlow.tsx'
import { CorrectionView } from './CorrectionView.tsx'
import { EnclosureList } from './EnclosureList.tsx'
import { whenLabel } from './format.ts'
import { HistoryView } from './HistoryView.tsx'
import { ReadingEntry } from './ReadingEntry.tsx'
import type { Reading } from './readings.ts'
import { enclosureThreshold, useTemperatureStatus } from './useTemperatureData.ts'

type Back = { name: 'list' } | { name: 'history'; equipmentId: string | null }
type View =
  | Back
  | { name: 'entry'; equipmentId: string }
  | { name: 'correct'; readingId: string; back: Back }
  | { name: 'action'; relatedRecordId: string; equipmentId: string; value_c: number; time: string; back: Back }

/** Module Températures : relevés des enceintes, action corrective, historique et corrections. */
export function TemperaturesScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload, now, statuses } = useTemperatureStatus()
  const [view, setView] = useState<View>({ name: 'list' })

  const backButton = (label: string, onClick: () => void) => (
    <Button variant="ghost" onClick={onClick} icon={<IconChevronLeft size={22} />} className="-ml-3 mb-2 px-3 text-accent">
      {label}
    </Button>
  )

  const actionFor = (r: Reading, back: Back): View => ({
    name: 'action',
    relatedRecordId: r.latest.id,
    equipmentId: r.equipmentId,
    value_c: r.value_c,
    time: r.time,
    back,
  })

  let body
  if (error && !data) {
    body = <Notice>Lecture impossible : {error}</Notice>
  } else if (!data) {
    body = <p className="text-[17px] text-fg-muted">Chargement…</p>
  } else if (view.name === 'action') {
    const eq = data.enclosures.find((e) => e.id === view.equipmentId)
    const threshold = eq ? enclosureThreshold(eq, data.thresholds) : null
    return (
      <CorrectiveActionFlow
        key={view.relatedRecordId}
        relatedRecordId={view.relatedRecordId}
        subject={eq?.name ?? 'Enceinte'}
        detail={
          <>
            <span className="font-semibold text-danger tabular-nums">{formatTemperature(view.value_c)}</span> relevé {whenLabel(view.time, now, data.timeZone)}
            {threshold ? ` · seuil ${describeThreshold(threshold)}` : ''}
          </>
        }
        onDone={async () => {
          await reload()
          setView(view.back)
        }}
      />
    )
  } else if (view.name === 'entry') {
    const eq = data.enclosures.find((e) => e.id === view.equipmentId)
    body = (
      <>
        {backButton('Températures', () => setView({ name: 'list' }))}
        {eq ? (
          <ReadingEntry
            equipment={eq}
            status={statuses.find((s) => s.equipment.id === eq.id)}
            data={data}
            now={now}
            onSaved={async (rec, payload) => {
              await reload()
              setView(
                payload.in_range
                  ? { name: 'list' }
                  : { name: 'action', relatedRecordId: rec.id, equipmentId: eq.id, value_c: payload.value_c, time: rec.device_time, back: { name: 'list' } },
              )
            }}
          />
        ) : (
          <Notice>Cette enceinte n’est plus en service.</Notice>
        )}
      </>
    )
  } else if (view.name === 'correct') {
    const reading = data.readings.find((r) => r.id === view.readingId)
    body = (
      <>
        {backButton('Historique', () => setView(view.back))}
        {reading ? (
          <CorrectionView
            reading={reading}
            equipment={data.enclosures.find((e) => e.id === reading.equipmentId)}
            data={data}
            now={now}
            onCancel={() => setView(view.back)}
            onSaved={async (rec, replacement) => {
              await reload()
              // Nouvelle valeur hors seuil sans action déjà faite : action corrective obligatoire.
              if (!replacement.in_range && reading.correctiveActions.length === 0) {
                setView({ name: 'action', relatedRecordId: rec.id, equipmentId: reading.equipmentId, value_c: replacement.value_c, time: reading.time, back: view.back })
              } else {
                setView(view.back)
              }
            }}
          />
        ) : (
          <Notice>Relevé introuvable.</Notice>
        )}
      </>
    )
  } else if (view.name === 'history') {
    const back: Back = view
    body = (
      <>
        {backButton('Températures', () => setView({ name: 'list' }))}
        <HistoryView
          data={data}
          now={now}
          equipmentId={view.equipmentId}
          onFilter={(equipmentId) => setView({ name: 'history', equipmentId })}
          onCorrect={(r) => setView({ name: 'correct', readingId: r.id, back })}
          onCorrectiveAction={(r) => setView(actionFor(r, back))}
        />
      </>
    )
  } else {
    body = (
      <>
        {backButton('Accueil', onBack)}
        <EnclosureList
          data={data}
          statuses={statuses}
          now={now}
          onSelect={(equipmentId) => setView({ name: 'entry', equipmentId })}
          onHistory={() => setView({ name: 'history', equipmentId: null })}
          onCorrectiveAction={(r) => setView(actionFor(r, { name: 'list' }))}
        />
      </>
    )
  }

  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6 sm:pt-6">{body}</main>
}
