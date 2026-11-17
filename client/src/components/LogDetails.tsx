const LABELS: Record<string, string> = {
  mode: 'Mode',
  startPaths: 'Scan paths',
  candidateCount: 'Candidates',
  sampleIds: 'Candidate samples',
  invalidPaths: 'Unavailable paths',
  imported: 'Imported',
  errors: 'Errors',
  importedSamples: 'Imported samples',
  failureSamples: 'Failed items',
  invalidCoverUpdates: 'Invalid covers updated',
  invalidCoverSamples: 'Invalid cover samples',
  durationMs: 'Duration',
  total: 'Items checked',
  updated: 'Updated',
  markedMissing: 'Marked missing',
  updatedSamples: 'Updated samples',
  missingSamples: 'Missing samples',
  errorSamples: 'Error samples',
  error: 'Error',
}

const IDENTITY_FIELDS = new Set(['id', 'rjcode', 'title'])

const labelFor = (key: string) => LABELS[key] || key
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/^./, char => char.toUpperCase())

const scalarFor = (key: string, value: unknown) => {
  if (key === 'durationMs' && typeof value === 'number') {
    if (value < 1000) return `${value} ms`
    if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`
    return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
  }
  if (key === 'mode' && typeof value === 'string') {
    return ({
      'new-only': 'New works only',
      full: 'Full library',
      'metadata-only': 'Metadata only',
      alignment: 'Path alignment',
      'dry-run': 'Dry run',
    } as Record<string, string>)[value] || value
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === null) return 'None'
  return String(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

function ObjectItem({ value }: { value: Record<string, unknown> }) {
  const id = value.rjcode || value.id
  const title = value.title
  const summary = [
    id ? `RJ${String(id).replace(/^RJ/i, '')}` : '',
    title ? String(title) : '',
  ].filter(Boolean).join(' — ')
  const details = Object.entries(value).filter(([key]) => !IDENTITY_FIELDS.has(key))

  return (
    <div className="terminal-log-item">
      {summary && <div className="terminal-log-item__title">{summary}</div>}
      {details.map(([key, detail]) => (
        <div className={`terminal-log-item__detail${key === 'error' ? ' terminal-log-item__detail--error' : ''}`} key={key}>
          <span>{labelFor(key)}:</span> {isRecord(detail) || Array.isArray(detail) ? JSON.stringify(detail) : scalarFor(key, detail)}
        </div>
      ))}
    </div>
  )
}

function DetailValue({ name, value }: { name: string; value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="terminal-log-none">None</span>
    if (value.every(isRecord)) {
      return <div className="terminal-log-items">{value.map((item, index) => <ObjectItem key={`${String(item.id || item.rjcode || '')}-${index}`} value={item} />)}</div>
    }
    return (
      <ul className="terminal-log-list">
        {value.map((item, index) => <li key={`${String(item)}-${index}`}>{scalarFor(name, item)}</li>)}
      </ul>
    )
  }
  if (isRecord(value)) return <ObjectItem value={value} />
  return <span className={name === 'error' ? 'terminal-log-value--error' : ''}>{scalarFor(name, value)}</span>
}

export function LogDetails({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return <div className="terminal-log-data"><DetailValue name="details" value={data} /></div>
  }

  return (
    <dl className="terminal-log-data">
      {Object.entries(data).map(([key, value]) => (
        <div className={`terminal-log-field terminal-log-field--${key}`} key={key}>
          <dt>{labelFor(key)}</dt>
          <dd><DetailValue name={key} value={value} /></dd>
        </div>
      ))}
    </dl>
  )
}
