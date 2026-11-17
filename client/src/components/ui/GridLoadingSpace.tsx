import type { RefObject } from 'react'
import LoadingSpinner from './LoadingSpinner'
import { useI18n } from '../../lib/i18n'
import './GridWorkCard.css'

export default function GridLoadingSpace({ sentinelRef, height, loading }: {
  sentinelRef: RefObject<HTMLDivElement | null>
  height: number
  loading: boolean
}) {
  const { t } = useI18n()
  return (
    <div ref={sentinelRef} className="grid-loading-space" style={{ height }}>
      {loading ? (
        <div className="grid-loading-space__status" role="status">
          <LoadingSpinner size="sm" label={t('Loading more works…')} />
        </div>
      ) : null}
    </div>
  )
}
