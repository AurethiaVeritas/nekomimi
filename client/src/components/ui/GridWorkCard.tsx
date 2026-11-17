import { memo, useEffect, useRef, useState, type ComponentProps } from 'react'
import { Link } from 'react-router-dom'
import { rememberLastAnchor } from '../../lib/scroll'
import WorkCard from './WorkCard'
import './GridWorkCard.css'

// One observer for the grid, rather than one observer per cover/card.
let observer: IntersectionObserver | undefined
const waiting = new Map<Element, () => void>()
function observeCard(element: Element, reveal: () => void) {
  if (typeof IntersectionObserver === 'undefined') {
    reveal()
    return () => {}
  }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      waiting.get(entry.target)?.()
      waiting.delete(entry.target)
      observer?.unobserve(entry.target)
    }
  }, { rootMargin: '600px' })
  waiting.set(element, reveal)
  observer.observe(element)
  return () => {
    waiting.delete(element)
    observer?.unobserve(element)
    if (!waiting.size) {
      observer?.disconnect()
      observer = undefined
    }
  }
}

// Keep lightweight anchor slots in document flow. Mount card contents only near
// the viewport, and let content-visibility skip layout/paint after scrolling away.
export default memo(function GridWorkCard({ work }: Pick<ComponentProps<typeof WorkCard>, 'work'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (ref.current) return observeCard(ref.current, () => setVisible(true))
  }, [])

  // Cards are already mounted only near the viewport. Start each cover request
  // then so the stall timer cannot race the browser's native lazy loader.
  return (
    <div ref={ref} id={`work-${work.id}`} className="work-card-wrapper grid-work-card">
      {visible ? (
        <WorkCard work={work} anchorId={null} imageLoading="eager" onOpen={() => rememberLastAnchor(`work-${work.id}`)} />
      ) : (
        <Link
          className="grid-work-card__placeholder"
          to={`/work/${work.id}`}
          aria-label={`Open ${work.title || work.rjcode || `Work ${work.id}`}`}
          onClick={() => rememberLastAnchor(`work-${work.id}`)}
        />
      )}
    </div>
  )
})
