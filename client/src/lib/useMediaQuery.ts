import { useEffect, useState } from 'react'

const matchesQuery = (query: string): boolean => (
  typeof window !== 'undefined' && window.matchMedia(query).matches
)

export default function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesQuery(query))

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const handleChange = () => setMatches(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [query])

  return matches
}
