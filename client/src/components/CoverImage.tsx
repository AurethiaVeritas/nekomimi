import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { withBasePath } from '../lib/basePath'
import placeholder from '../assets/cover-placeholder.svg'

const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
const STALLED_IMAGE_TIMEOUT_MS = 12_000

type CoverImageProps = {
  coverPath: string | null;
  workId: number | string;
  alt?: string;
  className?: string;
  maxRetries?: number;
  loading?: 'lazy' | 'eager';
  fetchPriority?: 'auto' | 'high' | 'low';
  deferUntilVisible?: boolean;
};

/**
 * CoverImage component with retry logic for handling partial/failed image loads.
 * Automatically retries loading on error and provides fallback to placeholder.
 *
 * @param {Object} props
 * @param {string|null} props.coverPath - Server cover path (if exists)
 * @param {number|string} props.workId - Work ID for constructing cover URL
 * @param {string} props.alt - Alt text for the image
 * @param {string} [props.className] - Additional CSS classes
 * @param {number} [props.maxRetries=2] - Maximum number of retry attempts
 * @param {string} [props.loading='lazy'] - Native image loading attribute
 * @param {'auto'|'high'|'low'} [props.fetchPriority='auto'] - Native image fetch priority
 * @param {boolean} [props.deferUntilVisible=false] - Delay loading covers until the image is near the viewport
 */
export default function CoverImage({
  coverPath,
  workId,
  alt = 'cover',
  className = '',
  maxRetries = 2,
  loading = 'lazy',
  fetchPriority = 'auto',
  deferUntilVisible = false,
}: CoverImageProps) {
  const imageSrc = useMemo(() =>
    coverPath ? withBasePath(`/cover/${workId}`) : placeholder,
    [coverPath, workId]
  )
  const idleSrc = deferUntilVisible && loading !== 'eager' && coverPath ? BLANK_IMAGE : imageSrc

  const imgRef = useRef<HTMLImageElement | null>(null)
  const [shouldLoad, setShouldLoad] = useState(() => !deferUntilVisible || loading === 'eager' || !coverPath)
  const [src, setSrc] = useState<string>(() => (shouldLoad ? imageSrc : idleSrc))
  // Once our visibility observer releases a deferred cover, let the browser
  // fetch it immediately instead of applying a second lazy-loading threshold.
  const browserLoading = deferUntilVisible && shouldLoad ? 'eager' : loading
  const [isLoaded, setIsLoaded] = useState(false)
  const retryCount = useRef(0)
  const retryTimerRef = useRef<number | null>(null)
  const stallTimerRef = useRef<number | null>(null)

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current)
      stallTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    retryCount.current = 0
    clearRetryTimer()
    clearStallTimer()
    setIsLoaded(false)
    setShouldLoad(!deferUntilVisible || loading === 'eager' || !coverPath)
    setSrc(!deferUntilVisible || loading === 'eager' || !coverPath ? imageSrc : idleSrc)

    return () => {
      clearRetryTimer()
      clearStallTimer()
    }
  }, [clearRetryTimer, clearStallTimer, coverPath, deferUntilVisible, idleSrc, imageSrc, loading])

  useEffect(() => {
    if (!deferUntilVisible || loading === 'eager' || !coverPath || shouldLoad) return
    const el = imgRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true)
      setSrc(imageSrc)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        setIsLoaded(false)
        setShouldLoad(true)
        setSrc(imageSrc)
        observer.disconnect()
      },
      { rootMargin: '1200px 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [coverPath, deferUntilVisible, imageSrc, loading, shouldLoad])

  const retryCoverLoad = useCallback(() => {
    if (!coverPath || retryTimerRef.current !== null) return

    clearStallTimer()

    retryCount.current += 1

    if (retryCount.current <= maxRetries) {
      // Retry with cache-busting parameter
      const url = withBasePath(`/cover/${workId}`)
      const separator = url.includes('?') ? '&' : '?'
      const retryUrl = `${url}${separator}_retry=${retryCount.current}&_t=${Date.now()}`

      // Small delay before retry to avoid hammering the server
      retryTimerRef.current = window.setTimeout(() => {
        setIsLoaded(false)
        setSrc(retryUrl)
        retryTimerRef.current = null
      }, 500 * retryCount.current) // Exponential backoff: 500ms, 1000ms, etc.
    } else {
      // Max retries exceeded, fallback to placeholder
      setIsLoaded(true)
      setSrc(placeholder)
    }
  }, [clearStallTimer, coverPath, workId, maxRetries])

  const handleError = useCallback(() => {
    // Don't retry if already showing placeholder
    if (!coverPath || src === placeholder || src === BLANK_IMAGE) return
    retryCoverLoad()
  }, [coverPath, retryCoverLoad, src])

  const revealWhenDecoded = useCallback((img: HTMLImageElement) => {
    const requestedSrc = img.currentSrc
    const reveal = () => {
      if (imgRef.current === img && img.currentSrc === requestedSrc && img.complete && img.naturalWidth > 0) {
        setIsLoaded(true)
      }
    }
    if (typeof img.decode === 'function') {
      void img.decode().then(reveal, reveal)
    } else {
      reveal()
    }
  }, [])

  const handleLoad = useCallback(() => {
    if (src === BLANK_IMAGE) return
    clearRetryTimer()
    clearStallTimer()
    const img = imgRef.current
    if (img) revealWhenDecoded(img)
  }, [clearRetryTimer, clearStallTimer, revealWhenDecoded, src])

  useEffect(() => {
    const img = imgRef.current
    if (!img || src === BLANK_IMAGE) return
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      clearRetryTimer()
      clearStallTimer()
      revealWhenDecoded(img)
    }
  }, [clearRetryTimer, clearStallTimer, revealWhenDecoded, src])

  useEffect(() => {
    clearStallTimer()
    if (!coverPath || !shouldLoad || src === placeholder || src === BLANK_IMAGE || isLoaded) return

    stallTimerRef.current = window.setTimeout(() => {
      const img = imgRef.current
      stallTimerRef.current = null
      if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setIsLoaded(true)
        return
      }
      retryCoverLoad()
    }, STALLED_IMAGE_TIMEOUT_MS)

    return clearStallTimer
  }, [clearStallTimer, coverPath, isLoaded, retryCoverLoad, shouldLoad, src])

  const isImageReady = isLoaded || src === placeholder

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={`${className} ${isImageReady ? 'cover-image--loaded' : 'cover-image--loading'}`.trim()}
      onError={handleError}
      onLoad={handleLoad}
      loading={browserLoading}
      fetchPriority={fetchPriority}
      decoding="async"
    />
  )
}
