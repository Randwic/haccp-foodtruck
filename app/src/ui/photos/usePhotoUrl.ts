import { useEffect, useState } from 'react'
import { useManager } from '../../manager/ManagerContext.tsx'
import { useCore } from '../CoreContext.tsx'

export type PhotoLoad = { state: 'loading' } | { state: 'ok'; url: string } | { state: 'missing' }

/**
 * Adresse affichable d'une photo : copie locale (hors-ligne) sinon, si le gérant est connecté,
 * téléchargement depuis le bucket privé `photos`. L'URL objet est libérée au démontage.
 */
export function usePhotoUrl(path: string | null): PhotoLoad {
  const core = useCore()
  const manager = useManager()
  const [load, setLoad] = useState<PhotoLoad>({ state: 'loading' })

  useEffect(() => {
    if (!path) {
      setLoad({ state: 'missing' })
      return
    }
    let alive = true
    let url: string | null = null
    setLoad({ state: 'loading' })
    ;(async () => {
      let blob = await core.getPhoto(path).catch(() => null)
      if (!blob && (await manager.sessionEmail().catch(() => null)) !== null) {
        blob = await manager.downloadPhoto(path).catch(() => null)
      }
      if (!alive) return
      if (!blob || typeof URL.createObjectURL !== 'function') {
        setLoad({ state: 'missing' })
        return
      }
      url = URL.createObjectURL(blob)
      setLoad({ state: 'ok', url })
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [core, manager, path])

  return load
}
