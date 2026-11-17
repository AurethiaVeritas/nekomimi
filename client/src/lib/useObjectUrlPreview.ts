import { useCallback, useEffect, useState } from 'react'

export function useObjectUrlPreview() {
  const [url, setUrl] = useState('')

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  const setFile = useCallback((file: Blob | null) => {
    setUrl(file ? URL.createObjectURL(file) : '')
  }, [])

  const clear = useCallback(() => setUrl(''), [])

  return { url, setFile, clear }
}
